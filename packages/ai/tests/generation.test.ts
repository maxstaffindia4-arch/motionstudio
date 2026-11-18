import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildMemorySection,
  estimateTokens,
  memoryTokenEstimate,
  extractQuotedText,
  visibleText,
  checkVerbatim,
  verbatimRequirements,
  routeIntent,
  detectThemeHint,
  extractTextItems,
  settingsToCanvas,
  parseModelOutput,
  enforceSettings,
  buildTemplatePlan,
  applyManualGuard,
  buildPrompts,
  PROMPT_VERSION,
  sceneSpecDoc,
} from '../src/index.js';
import type { GenerationInput, GenerationSettings } from '../src/index.js';
import type { SceneSpec } from '@motion-studio/engine';

const SETTINGS: GenerationSettings = { canvas: { preset: 'landscape' }, output: 'transparent' };

function input(over: Partial<GenerationInput> = {}): GenerationInput {
  return { prompt: 'make a headline', settings: SETTINGS, ...over };
}

describe('memory injection', () => {
  it('full mode includes whole content; summary truncates; off excludes', () => {
    const big = 'x'.repeat(5000);
    const mem = {
      instructions: 'always use blue',
      files: [
        { name: 'a.md', mode: 'full' as const, content: 'FULLCONTENT' },
        { name: 'b.md', mode: 'summary' as const, content: big },
        { name: 'c.md', mode: 'off' as const, content: 'SECRET' },
      ],
    };
    const { text, tokens } = buildMemorySection(mem);
    expect(text).toContain('always use blue');
    expect(text).toContain('FULLCONTENT');
    expect(text).toContain('truncated');
    expect(text).not.toContain('SECRET');
    expect(tokens).toBe(estimateTokens(text));
    expect(memoryTokenEstimate(mem)).toBe(tokens);
  });

  it('empty memory → empty section', () => {
    expect(buildMemorySection(undefined).text).toBe('');
    expect(buildMemorySection({}).tokens).toBe(0);
  });
});

describe('verbatim', () => {
  it('extracts quoted spans', () => {
    expect(extractQuotedText('say "Hello World" and “Second”')).toEqual(['Hello World', 'Second']);
  });

  it('visibleText strips tags/scripts', () => {
    const html = '<div>Hello <b>World</b><script>var x=1</script></div>';
    expect(visibleText(html)).toBe('Hello World');
  });

  it('checkVerbatim reports missing strings', () => {
    const html = '<div>Launch Faster</div>';
    expect(checkVerbatim(html, ['Launch Faster']).ok).toBe(true);
    const r = checkVerbatim(html, ['Launch Faster', 'Missing Text']);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['Missing Text']);
  });

  it('verbatimRequirements merges quotes + lockedText deduped', () => {
    const req = verbatimRequirements('use "Exact Phrase"', ['Exact Phrase', 'Other']);
    expect(req).toEqual(['Exact Phrase', 'Other']);
  });
});

describe('intent hints', () => {
  it('routes known patterns', () => {
    expect(routeIntent('a lower third with my name').component).toBe('lower-third');
    expect(routeIntent('count up to 70%').component).toBe('number-counter');
    expect(routeIntent('nothing specific').component).toBeUndefined();
  });

  it('detects theme hints', () => {
    expect(detectThemeHint("my son's birthday")).toBe('birthday');
    expect(detectThemeHint('plain video')).toBeUndefined();
  });

  it('extracts text items from TEXT: sections', () => {
    expect(extractTextItems('TEXT: Alpha / Beta / Gamma / STYLE: x')).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});

describe('settingsToCanvas / enforceSettings', () => {
  it('builds canvas from preset + overrides', () => {
    const c = settingsToCanvas({ canvas: { preset: 'vertical' }, output: 'opaque', durationSec: 8, fps: 60 });
    expect(c).toMatchObject({ width: 1080, height: 1920, fps: 60, durationSec: 8, output: 'opaque' });
  });

  it('clamps duration to [1,30]', () => {
    expect(settingsToCanvas({ canvas: { preset: 'square' }, output: 'opaque', durationSec: 99 }).durationSec).toBe(30);
    expect(settingsToCanvas({ canvas: { preset: 'square' }, output: 'opaque', durationSec: 0.2 }).durationSec).toBe(1);
  });

  it('enforceSettings overwrites whatever the model returned', () => {
    const scene = parseModelOutput(
      {
        specVersion: 1,
        canvas: { width: 999, height: 999, durationSec: 99, output: 'opaque' },
        background: { kind: 'none' },
        elements: [
          {
            type: 'text', id: 't', content: 'Hi', start: 0, duration: 5,
            placement: { anchor: 'center', offset: { x: 0, y: 0 } },
            style: {}, animation: {},
          },
        ],
      },
      SETTINGS
    ).scene;
    expect(scene.canvas.width).toBe(1920);
    expect(scene.canvas.height).toBe(1080);
    expect(scene.canvas.output).toBe('transparent');
    expect(scene.canvas.durationSec).toBe(5);
  });
});

describe('parseModelOutput', () => {
  it('accepts component shape and builds scene', () => {
    const { scene, component } = parseModelOutput(
      { component: 'text-slam', params: { text: 'Hello World', highlightWords: 'World' } },
      SETTINGS
    );
    expect(component).toBe('text-slam');
    expect(scene.elements.length).toBeGreaterThan(0);
    expect(scene.canvas.width).toBe(1920);
  });

  it('rejects unknown component as bad_output', () => {
    expect(() => parseModelOutput({ component: 'nope', params: {} }, SETTINGS)).toThrowError(/bad_output|unknown component/);
  });

  it('rejects garbage', () => {
    expect(() => parseModelOutput({ foo: 1 }, SETTINGS)).toThrow();
    expect(() => parseModelOutput('not json', SETTINGS)).toThrow();
  });
});

describe('template plan', () => {
  it('maps prompt text into component params', () => {
    const plan = buildTemplatePlan('lower third: Jane Doe / Product Lead');
    expect(plan?.component).toBe('lower-third');
    expect(plan?.params.name).toBe('Jane Doe');
  });

  it('number-counter extracts target', () => {
    const plan = buildTemplatePlan('count up to 70% cost reduction', 'number-counter');
    expect(plan?.params.target).toBe(70);
  });
});

describe('manual guard', () => {
  const base: SceneSpec = {
    specVersion: 1,
    canvas: { width: 1920, height: 1080, fps: 30, durationSec: 5, output: 'transparent', safeMargins: 'action' },
    background: { kind: 'none' },
    elements: [
      {
        type: 'text', id: 'locked-text', content: 'DO NOT TOUCH', manual: true,
        start: 0, duration: 5, placement: { anchor: 'center', offset: { x: 0, y: 0 } },
        style: { fontSize: 80 }, animation: {},
      },
      {
        type: 'text', id: 'free-text', content: 'change me',
        start: 0, duration: 5, placement: { anchor: 'top', offset: { x: 0, y: 0 } },
        style: {}, animation: {},
      },
    ],
  };

  it('reverts unreferenced manual element changes', () => {
    const next = structuredClone(base);
    next.elements[0] = { ...next.elements[0]!, style: { fontSize: 200 } } as never;
    const { scene, reverted } = applyManualGuard(next, base, 'make it punchier');
    expect(reverted).toEqual(['locked-text']);
    expect((scene.elements[0] as { style: { fontSize: number } }).style.fontSize).toBe(80);
    // non-manual element untouched
    expect(scene.elements[1]).toEqual(next.elements[1]);
  });

  it('keeps manual element when prompt references it', () => {
    const next = structuredClone(base);
    next.elements[0] = { ...next.elements[0]!, style: { fontSize: 200 } } as never;
    const { reverted } = applyManualGuard(next, base, 'make "DO NOT TOUCH" bigger');
    expect(reverted).toEqual([]);
    expect((next.elements[0] as { style: { fontSize: number } }).style.fontSize).toBe(200);
  });

  it('restores a deleted manual element', () => {
    const next = structuredClone(base);
    next.elements = [next.elements[1]!];
    const { scene, reverted } = applyManualGuard(next, base, 'unrelated edit');
    expect(reverted).toEqual(['locked-text']);
    expect(scene.elements.some((e) => e.id === 'locked-text')).toBe(true);
  });
});

describe('prompt builder', () => {
  it('PROMPT_VERSION is set and system prompt is stable (snapshot)', () => {
    const { system, messages, memoryTokens } = buildPrompts(input(), {
      route: { component: 'text-slam', confidence: 0.8, reason: 'test' },
      theme: 'tech',
    });
    expect(PROMPT_VERSION).toBeTruthy();
    expect(system).toContain(PROMPT_VERSION);
    expect(system).toContain('SCENE SPEC');
    expect(system).toContain('COMPONENT CATALOG');
    expect(system).toContain('HYPERFRAMES RULES');
    expect(system).toContain('1920x1080');
    expect(messages[0]!.content).toContain('text-slam');
    expect(messages[0]!.content).toContain('make a headline');
    expect(memoryTokens).toBe(0);
    // Snapshot: hash the system prompt — bump PROMPT_VERSION when it changes.
    const hash = createHash('sha256').update(system).digest('hex').slice(0, 16);
    expect(hash).toBe('2bf0a7a3bc3ff55d');
  });

  it('sceneSpecDoc generates from live schemas', () => {
    const doc = sceneSpecDoc();
    expect(doc).toContain('specVersion');
    expect(doc).toContain("'slam'");
    expect(doc).toContain('elements');
    expect(doc).toContain('flow');
  });
});
