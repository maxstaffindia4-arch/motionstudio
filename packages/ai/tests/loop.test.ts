import { describe, it, expect } from 'vitest';
import {
  generateAnimation,
  FakeProvider,
  type GenerationInput,
  type StageName,
} from '../src/index.js';
import type { SceneSpec } from '@motion-studio/engine';

const SETTINGS = { canvas: { preset: 'landscape' } as const, output: 'opaque' as const, durationSec: 4 };

function input(over: Partial<GenerationInput> = {}): GenerationInput {
  return { prompt: 'a headline that says Hello', settings: SETTINGS, ...over };
}

function textScene(text: string, over: Record<string, unknown> = {}): SceneSpec {
  return {
    specVersion: 1,
    canvas: { width: 1920, height: 1080, fps: 30, durationSec: 4, output: 'opaque', safeMargins: 'action' },
    background: { kind: 'solid', color: '#101018' },
    elements: [
      {
        type: 'text',
        id: 'headline',
        content: text,
        start: 0,
        duration: 4,
        placement: { anchor: 'center', offset: { x: 0, y: 0 } },
        style: { fontSize: 96 },
        animation: {},
        ...over,
      },
    ],
  };
}

const OPTS = { model: 'fake-model', qa: false } as const;

describe('generateAnimation — llm strategy', () => {
  it('returns ok on first valid response', async () => {
    const fake = new FakeProvider([{ respond: { component: 'text-slam', params: { text: 'Hello World' } } }]);
    const stages: StageName[] = [];
    const r = await generateAnimation(input(), {
      ...OPTS,
      provider: fake,
      onStage: (s) => stages.push(s),
    });
    expect(r.status).toBe('ok');
    expect(r.strategy).toBe('llm');
    expect(r.repairAttempts).toBe(0);
    expect(r.scene.canvas.width).toBe(1920);
    expect(r.html).toContain('gsap.min.js');
    expect(r.usage.totalTokens).toBeGreaterThan(0);
    expect(stages).toContain('generate');
    expect(stages).toContain('compile');
    expect(stages).toContain('lint');
    expect(fake.calls).toHaveLength(1);
  });

  it('repairs after schema-invalid output, then succeeds', async () => {
    const fake = new FakeProvider([
      { respond: { bogus: 'not a scene' } },
      { respond: { component: 'text-slam', params: { text: 'Recovered' } } },
    ]);
    const r = await generateAnimation(input(), { ...OPTS, provider: fake });
    expect(r.status).toBe('ok');
    expect(r.repairAttempts).toBe(1);
    expect(fake.calls).toHaveLength(2);
    // repair feedback reached the model
    expect(fake.calls[1]!.messages.at(-1)!.content).toContain('REPAIR PASS 1');
  });

  it('repairs a verbatim-blocking scene', async () => {
    const fake = new FakeProvider([
      { respond: textScene('wrong text') },
      { respond: textScene('say "Exact Phrase" now') },
    ]);
    const r = await generateAnimation(
      input({ prompt: 'headline that says "Exact Phrase"' }),
      { ...OPTS, provider: fake }
    );
    expect(r.status).toBe('ok');
    expect(r.repairAttempts).toBe(1);
  });

  it('fails all repairs and yields needs_review (template also blocked)', async () => {
    const fake = new FakeProvider([
      { respond: textScene('nope') },
      { respond: textScene('still nope') },
      { respond: textScene('nope again') },
    ]);
    const r = await generateAnimation(input({ lockedText: ['NEEDLE'] }), {
      ...OPTS,
      provider: fake,
      maxRepairs: 2,
    });
    expect(r.status).toBe('needs_review');
    expect(r.repairAttempts).toBe(2);
    expect(r.issues.some((i) => i.stage === 'verbatim')).toBe(true);
    expect(fake.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('falls back to template on non-repairable provider error', async () => {
    const { AiError } = await import('../src/index.js');
    const fake = new FakeProvider([{ respond: new AiError('invalid_key', 'bad key') }]);
    const r = await generateAnimation(input({ prompt: 'lower third: Jane Doe / Product Lead' }), {
      ...OPTS,
      provider: fake,
    });
    expect(r.fellBackToTemplate).toBe(true);
    expect(r.strategy).toBe('llm');
    expect(['ok', 'needs_review']).toContain(r.status);
  });
});

describe('generateAnimation — template strategy', () => {
  it('produces a scene with zero provider calls', async () => {
    const fake = new FakeProvider([]);
    const r = await generateAnimation(input({ prompt: 'lower third: Jane Doe / Product Lead' }), {
      ...OPTS,
      provider: fake,
      strategy: 'template',
    });
    expect(r.strategy).toBe('template');
    expect(fake.calls).toHaveLength(0);
    expect(r.scene.elements.length).toBeGreaterThan(0);
  });
});

describe('generateAnimation — controls', () => {
  it('rejects on pre-aborted signal', async () => {
    const fake = new FakeProvider([{ respond: { component: 'text-slam', params: { text: 'x' } } }]);
    const ac = new AbortController();
    ac.abort();
    await expect(
      generateAnimation(input(), { ...OPTS, provider: fake, signal: ac.signal })
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  it('reports per-stage latency via onStage', async () => {
    const fake = new FakeProvider([{ respond: { component: 'text-slam', params: { text: 'Timed' } } }]);
    const seen: Array<{ stage: string; latencyMs: number }> = [];
    await generateAnimation(input(), {
      ...OPTS,
      provider: fake,
      onStage: (stage, info) => seen.push({ stage, latencyMs: info.latencyMs }),
    });
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const s of seen) expect(s.latencyMs).toBeGreaterThanOrEqual(0);
    expect(seen.map((s) => s.stage)).toContain('generate');
  });
});
