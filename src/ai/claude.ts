// Claude API access from the browser (the user supplies their own API key, stored locally).
import Anthropic from '@anthropic-ai/sdk';
import type { AISettings } from '../state/store';
import type { HouseSpec } from '../model/spec';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Claude.ai / Claude Code subscription tokens (sk-ant-oat…) are not API keys and are refused for third-party apps. */
export const isOAuthToken = (k: string) => /^sk-ant-oat/i.test(k.trim());
export const OAUTH_MSG = 'That is a Claude subscription (OAuth) token, not an API key. Create an API key (starts with sk-ant-api) at console.anthropic.com and paste it here.';

export function client(s: AISettings) {
  if (!s.apiKey) throw new Error('Add your Claude API key in Settings to use AI features.');
  if (isOAuthToken(s.apiKey)) throw new Error(OAUTH_MSG);
  return new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

type CreateParams = Parameters<Anthropic['beta']['messages']['create']>[0];

/** messages.create with adaptive thinking, effort and server-side refusal fallback; retries without fallback if unsupported. */
export async function create(s: AISettings, params: Omit<CreateParams, 'model'>) {
  const c = client(s);
  const base = { model: s.model || 'claude-opus-5-5', thinking: { type: 'adaptive' }, ...params, output_config: { effort: s.effort, ...(params as { output_config?: object }).output_config } } as CreateParams;
  let msg;
  try {
    msg = await c.beta.messages.create({ ...base, betas: [FALLBACK_BETA], fallbacks: 'default', stream: false } as CreateParams);
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && /fallback/i.test(String(e.message))) msg = await c.beta.messages.create({ ...base, stream: false } as CreateParams);
    else throw friendly(e);
  }
  const m = msg as Anthropic.Beta.BetaMessage;
  if (m.stop_reason === 'refusal') throw new Error('Claude declined this request. Try rephrasing it.');
  return m;
}

export function friendly(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) return new Error('Your Claude API key was rejected. Check it in Settings.');
  if (e instanceof Anthropic.RateLimitError) return new Error('Rate limited by the Claude API — try again in a moment.');
  if (e instanceof Anthropic.NotFoundError) return new Error('Model not found — pick another model in Settings.');
  if (e instanceof Anthropic.APIConnectionError) return new Error('Could not reach the Claude API. Check your connection.');
  if (e instanceof Anthropic.APIError) return new Error(`Claude API error: ${e.message}`);
  return e instanceof Error ? e : new Error(String(e));
}

export function textOf(m: Anthropic.Beta.BetaMessage) {
  return m.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n');
}

function parseJSON<T>(m: Anthropic.Beta.BetaMessage): T {
  if (m.stop_reason === 'max_tokens') throw new Error('The response was cut off — try a simpler request.');
  const t = textOf(m).trim();
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  return JSON.parse(s >= 0 ? t.slice(s, e + 1) : t) as T;
}

// ---------------- Text → HouseSpec ----------------
const ROOM_TYPES = ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'wc', 'office', 'hall', 'garage', 'laundry', 'storage', 'closet', 'balcony', 'terrace', 'basement', 'utility', 'other'];
const CONN_KINDS = ['door', 'opening', 'doubleDoor', 'slidingDoor', 'frontDoor', 'garageDoor'];

export const HOUSE_SPEC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['name', 'levels', 'roof', 'front', 'exteriorColor', 'style'],
  properties: {
    name: { type: 'string' },
    style: { type: 'string' },
    front: { type: 'string', enum: ['top', 'bottom', 'left', 'right'] },
    exteriorColor: { type: 'string', description: 'hex color' },
    roof: { type: 'object', additionalProperties: false, required: ['kind', 'pitch', 'color'], properties: { kind: { type: 'string', enum: ['gable', 'hip', 'flat', 'shed'] }, pitch: { type: 'number' }, color: { type: 'string' } } },
    stairs: { type: 'object', additionalProperties: false, required: ['x', 'y', 'w', 'd', 'dir'], properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, d: { type: 'number' }, dir: { type: 'string', enum: ['up', 'down', 'left', 'right'] } } },
    levels: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['name', 'height', 'rooms', 'connections'],
        properties: {
          name: { type: 'string' }, height: { type: 'number' },
          rooms: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'type', 'x', 'y', 'w', 'd'], properties: { name: { type: 'string' }, type: { type: 'string', enum: ROOM_TYPES }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, d: { type: 'number' } } } },
          connections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['a', 'b', 'kind'], properties: { a: { type: 'string' }, b: { type: 'string' }, kind: { type: 'string', enum: CONN_KINDS } } } },
        },
      },
    },
  },
} as const;

const SPEC_SYSTEM = `You are an expert residential architect working inside Homerise, a floor-plan app.
Design houses as axis-aligned rectangular rooms in meters. Plan coordinates: x grows to the right, y grows downward; the "front" side faces the street.
Rules:
- Rooms on the same level must tile without overlapping (shared edges are walls). Keep the footprint compact; outer walls should form a clean outline.
- Every room must be reachable: list connections between rooms that share a wall (kind "door" for private rooms, "opening" between open-plan spaces) and one {"a": <entry room>, "b": "outside", "kind": "frontDoor"} on the entry level. Garages get {"a": "Garage", "b": "outside", "kind": "garageDoor"}.
- Realistic sizes: bedrooms ≥ 9 m² (primary 13–18), bathrooms 4–8 m², hallways ≥ 1.2 m wide, kitchens ≥ 8 m².
- Multi-level houses: levels ordered bottom → top, ground floor first unless there is a basement (name it "Basement"). Use the SAME outer footprint on stacked levels when possible. Provide "stairs" (a ~1.1 × 4 m rectangle) placed inside a hall/stair room that exists at the same x/y on every level it connects; "dir" is the direction of ascent ("up" = toward -y).
- Terraces/balconies use types "terrace"/"balcony" and sit outside the indoor footprint.
- Default level height 2.7 m (basement 2.5).
Return only the JSON object.`;

export async function aiTextToSpec(s: AISettings, prompt: string, current?: unknown): Promise<HouseSpec> {
  const m = await create(s, {
    max_tokens: 16000,
    system: SPEC_SYSTEM,
    messages: [{ role: 'user', content: `${current ? `Current design (for reference, revise it):\n${JSON.stringify(current)}\n\n` : ''}Design this home: ${prompt}` }],
    output_config: { format: { type: 'json_schema', schema: HOUSE_SPEC_SCHEMA as unknown as Record<string, unknown> } },
  } as Omit<CreateParams, 'model'>);
  const spec = parseJSON<HouseSpec>(m);
  spec.furnish = true; spec.landscape = true;
  return spec;
}

// ---------------- Image → plan ----------------
export interface AIPlanResult {
  metersPerPixel: number;
  walls: { x1: number; y1: number; x2: number; y2: number; thickness_px: number }[];
  openings: { x: number; y: number; width_px: number; kind: string }[];
  rooms: { name: string; type: string; label_x: number; label_y: number }[];
  notes: string;
}
const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['metersPerPixel', 'walls', 'openings', 'rooms', 'notes'],
  properties: {
    metersPerPixel: { type: 'number' },
    notes: { type: 'string' },
    walls: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['x1', 'y1', 'x2', 'y2', 'thickness_px'], properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, thickness_px: { type: 'number' } } } },
    openings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['x', 'y', 'width_px', 'kind'], properties: { x: { type: 'number' }, y: { type: 'number' }, width_px: { type: 'number' }, kind: { type: 'string', enum: ['door', 'doubleDoor', 'slidingDoor', 'frontDoor', 'garageDoor', 'window', 'wideWindow', 'opening'] } } } },
    rooms: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'type', 'label_x', 'label_y'], properties: { name: { type: 'string' }, type: { type: 'string', enum: ROOM_TYPES }, label_x: { type: 'number' }, label_y: { type: 'number' } } } },
  },
} as const;

export async function aiImageToPlan(s: AISettings, img: { base64: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; width: number; height: number }, detected?: { walls: { a: { x: number; y: number }; b: { x: number; y: number } }[]; metersPerPixel: number }, hint?: string): Promise<AIPlanResult> {
  const det = detected ? `\nA computer-vision pass detected these wall centerlines (pixels; may be incomplete or include noise):\n${JSON.stringify(detected.walls.slice(0, 160).map((w) => [Math.round(w.a.x), Math.round(w.a.y), Math.round(w.b.x), Math.round(w.b.y)]))}\nIts scale estimate: ${detected.metersPerPixel.toFixed(4)} m/px.` : '';
  const m = await create(s, {
    max_tokens: 16000,
    system: 'You convert architectural floor-plan images into precise vector data. Coordinates are in image pixels (origin top-left). Trace wall CENTERLINES as straight segments that meet exactly at corners and T-junctions (reuse identical coordinates). Include every interior and exterior wall. Report doors/windows/openings at their center point on the wall. Estimate metersPerPixel from printed dimensions if present, otherwise from standard door widths (~0.85–0.9 m) or typical room sizes. Name each room and give a point inside it.',
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } },
      { type: 'text', text: `Image size: ${img.width}×${img.height} px.${det}${hint ? `\nUser note: ${hint}` : ''}\nReturn the full vector plan.` },
    ] }],
    output_config: { format: { type: 'json_schema', schema: PLAN_SCHEMA as unknown as Record<string, unknown> } },
  } as Omit<CreateParams, 'model'>);
  return parseJSON<AIPlanResult>(m);
}

export async function testKey(s: AISettings) {
  const m = await create({ ...s, effort: 'low' }, { max_tokens: 64, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] } as Omit<CreateParams, 'model'>);
  return textOf(m);
}
