// The AI Designer's agent loop: Claude edits the live project through TOOLS.
// UI-free so the panel and the live tests run the exact same loop.
import type Anthropic from '@anthropic-ai/sdk';
import { create } from './claude';
import { TOOLS, runTool } from './tools';
import type { AISettings } from '../state/store';

export const DESIGNER_SYSTEM = `You are the AI Designer inside Homerise, a home design app. You edit the user's live project through tools.
Coordinates are meters: x right, y down (the plan's "front"/street side is usually +y). Rooms are polygons; walls have openings.
Workflow: call get_plan first, then make precise edits with the tools, then reply briefly (1–3 sentences) describing what changed. For a new house or a big redesign, use create_house.
Use search_catalog to find furniture ids before add_item. Keep furniture inside rooms, clear of doors, with walking space. Prefer against_wall for wall-hugging furniture.
Never invent ids. If something isn't possible with the tools, say so plainly.`;

export type DesignerEvent = { kind: 'text'; text: string } | { kind: 'tool'; name: string; summary: string; ok: boolean };

/**
 * Run one user request to completion. Mutates `history` (append-only) on success.
 * On failure the whole exchange — including the user's message — is rolled back so
 * the conversation stays valid (no tool_use without its tool_result).
 */
export async function runDesigner(
  ai: AISettings,
  history: Anthropic.Beta.BetaMessageParam[],
  request: string,
  opts: { onEvent?: (e: DesignerEvent) => void; shouldStop?: () => boolean; maxTurns?: number } = {},
): Promise<{ turns: number; toolCalls: number }> {
  const start = history.length;
  history.push({ role: 'user', content: request });
  let toolCalls = 0, turn = 0;
  try {
    for (; turn < (opts.maxTurns ?? 24) && !opts.shouldStop?.(); turn++) {
      const m = await create(ai, { max_tokens: 16000, system: DESIGNER_SYSTEM, tools: TOOLS, messages: history } as never);
      history.push({ role: 'assistant', content: m.content as never });
      const said = m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim();
      if (said) opts.onEvent?.({ kind: 'text', text: said });
      if (m.stop_reason !== 'tool_use') break;
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const b of m.content) {
        if (b.type !== 'tool_use') continue;
        const r = runTool(b.name, (b.input ?? {}) as Record<string, unknown>);
        toolCalls++;
        opts.onEvent?.({ kind: 'tool', name: b.name, summary: r.summary, ok: r.ok });
        results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(r.result).slice(0, 60000), is_error: !r.ok });
      }
      history.push({ role: 'user', content: results });
    }
    // stopped mid-tool-loop: the last message is tool results; that's a valid end for the next user turn
    // only if followed by an assistant reply, so close it out.
    if (history[history.length - 1]?.role === 'user' && history.length > start + 1) {
      history.push({ role: 'assistant', content: [{ type: 'text', text: '(stopped)' }] });
    }
  } catch (e) {
    history.length = start;
    throw e;
  }
  return { turns: turn + 1, toolCalls };
}
