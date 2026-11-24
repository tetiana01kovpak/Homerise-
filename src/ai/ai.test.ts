// Offline tests for the Claude integration glue (no network).
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';

const calls: unknown[] = [];
let script: (() => unknown)[] = [];
vi.mock('./claude', async (orig) => {
  const real = await orig<typeof import('./claude')>();
  return { ...real, create: vi.fn(async (_s: unknown, p: unknown) => { calls.push(structuredClone(p)); const f = script.shift(); if (!f) throw new Error('no scripted reply'); return f(); }) };
});

const { aiToVector } = await import('../vision/planImport');
const { runDesigner } = await import('./designer');
const { isOAuthToken, client } = await import('./claude');

const AI = { apiKey: 'sk-ant-api03-test', model: 'claude-opus-5-5', effort: 'medium' as const };
const msg = (content: unknown[], stop_reason: string) => ({ content, stop_reason }) as unknown as Anthropic.Beta.BetaMessage;

describe('aiToVector', () => {
  const r = { metersPerPixel: 0.02, notes: '', walls: [{ x1: 0, y1: 0, x2: 500, y2: 0, thickness_px: 10 }], openings: [{ x: 250, y: 0, width_px: 45, kind: 'door' }], rooms: [{ name: 'Living', type: 'living', label_x: 250, label_y: 100 }] };
  it('maps AI-image pixels to meters (no downscale)', () => {
    const { vec, metersPerPixel } = aiToVector(r, { aiScale: 1, fallbackMpp: 0.05 });
    expect(metersPerPixel).toBeCloseTo(0.02);
    expect(vec.walls[0].b.x).toBeCloseTo(10);
    expect(vec.openings[0].width).toBeCloseTo(0.9);
    expect(vec.rooms![0].at!.y).toBeCloseTo(2);
  });
  it('keeps meters correct when the image sent to Claude was downscaled', () => {
    // working image 2x larger than the AI image: same physical plan
    const { vec, metersPerPixel } = aiToVector(r, { aiScale: 0.5, fallbackMpp: 0.05 });
    expect(metersPerPixel).toBeCloseTo(0.01); // per working-image pixel
    expect(vec.walls[0].b.x).toBeCloseTo(10); // still a 10 m wall
  });
  it('overall width overrides the scale', () => {
    const { vec } = aiToVector(r, { aiScale: 0.5, fallbackMpp: 0.05, widthM: 12 });
    expect(vec.walls[0].b.x).toBeCloseTo(12);
  });
  it('falls back to the CV scale when Claude returns nonsense', () => {
    const { metersPerPixel } = aiToVector({ ...r, metersPerPixel: 0 }, { aiScale: 1, fallbackMpp: 0.03 });
    expect(metersPerPixel).toBeCloseTo(0.03);
  });
});

describe('runDesigner', () => {
  beforeEach(() => { calls.length = 0; script = []; });
  it('runs tools and keeps an append-only, valid history', async () => {
    script = [
      () => msg([{ type: 'tool_use', id: 't1', name: 'get_plan', input: {} }], 'tool_use'),
      () => msg([{ type: 'text', text: 'Done.' }], 'end_turn'),
    ];
    const h: Anthropic.Beta.BetaMessageParam[] = [];
    const r = await runDesigner(AI, h, 'look at the plan');
    expect(r.toolCalls).toBe(1);
    expect(h.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect((h[2].content as { type: string }[])[0].type).toBe('tool_result');
  });
  it('rolls back the whole exchange when a call fails mid-loop', async () => {
    const h: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }];
    script = [
      () => msg([{ type: 'tool_use', id: 't1', name: 'get_plan', input: {} }], 'tool_use'),
      () => { throw new Error('boom'); },
    ];
    await expect(runDesigner(AI, h, 'do it')).rejects.toThrow('boom');
    expect(h).toHaveLength(2); // no orphaned tool_use / tool_result
    script = [() => msg([{ type: 'text', text: 'ok' }], 'end_turn')];
    await runDesigner(AI, h, 'again');
    expect(h.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });
});

describe('credentials', () => {
  it('detects subscription OAuth tokens and refuses them with a helpful message', () => {
    expect(isOAuthToken('sk-ant-oat01-abc')).toBe(true);
    expect(isOAuthToken('sk-ant-api03-abc')).toBe(false);
    expect(() => client({ ...AI, apiKey: 'sk-ant-oat01-abc' })).toThrow(/API key/);
  });
});
