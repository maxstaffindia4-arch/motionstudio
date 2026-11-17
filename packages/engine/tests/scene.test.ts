import { describe, expect, it } from 'vitest';
import { mergeTokens, resolveTokenPath, StyleTokensSchema, THEMES, DEFAULT_TOKENS } from '../src/scene/tokens.js';
import { SceneSpecSchema } from '../src/scene/schema.js';
import { validateScene } from '../src/scene/validate.js';
import { presetCanvas } from '../src/canvas/schema.js';

const canvas = presetCanvas('landscape', { durationSec: 6 });

function baseScene(extra: Record<string, unknown> = {}) {
  return {
    specVersion: 1,
    canvas,
    background: { kind: 'none' },
    elements: [
      {
        type: 'text',
        id: 't1',
        content: 'Hello',
        start: 0,
        duration: 3,
        placement: { anchor: 'center', offset: { x: 0, y: 0 } },
        style: {},
        animation: { in: { preset: 'slam' } }
      }
    ],
    ...extra
  };
}

describe('StyleTokens', () => {
  it('DEFAULT_TOKENS parses and has easings defaults', () => {
    expect(DEFAULT_TOKENS.easings.arrival).toBe('power4.out');
    expect(DEFAULT_TOKENS.easings.exit).toBe('power3.in');
    expect(DEFAULT_TOKENS.easings.pop).toBe('back.out(1.7)');
    expect(DEFAULT_TOKENS.colors.primary).toBeTruthy();
  });

  it('mergeTokens deep-merges records and applies theme', () => {
    const merged = mergeTokens(DEFAULT_TOKENS, THEMES.tech);
    expect(merged.colors.primary).toBe('#3B82F6');
    expect(merged.colors.text).toBe(DEFAULT_TOKENS.colors.text);
    const custom = mergeTokens(merged, { colors: { primary: '#123456' } });
    expect(custom.colors.primary).toBe('#123456');
    expect(custom.easings.arrival).toBe('power4.out');
  });

  it('resolveTokenPath resolves dotted paths', () => {
    expect(resolveTokenPath(DEFAULT_TOKENS, 'colors.primary')).toBe('#3B82F6');
    expect(resolveTokenPath(DEFAULT_TOKENS, 'fonts.display')).toContain('Montserrat');
    expect(resolveTokenPath(DEFAULT_TOKENS, 'colors.nope')).toBeUndefined();
    expect(resolveTokenPath(DEFAULT_TOKENS, 'nope.nope.nope')).toBeUndefined();
  });

  it('themes exclude Staff India brand palette', () => {
    expect(THEMES.brand).toBeUndefined();
    expect(Object.keys(THEMES)).toContain('celebration');
  });
});

describe('SceneSpecSchema', () => {
  it('parses a minimal valid scene', () => {
    const s = SceneSpecSchema.parse(baseScene());
    expect(s.specVersion).toBe(1);
    expect(s.elements).toHaveLength(1);
    expect(s.background.kind).toBe('none');
  });

  it('rejects bad specVersion, missing elements, bad anchor', () => {
    expect(() => SceneSpecSchema.parse(baseScene({ specVersion: 2 }))).toThrow();
    expect(() => SceneSpecSchema.parse(baseScene({ elements: [] }))).toThrow();
    const bad = baseScene();
    (bad.elements[0] as { placement: { anchor: string } }).placement.anchor = 'middle';
    expect(() => SceneSpecSchema.parse(bad)).toThrow();
  });

  it('rejects invalid asset refs (URL, absolute, traversal)', async () => {
    const { AssetRefSchema } = await import('../src/elements/style.js');
    expect(AssetRefSchema.safeParse('assets/foo.png').success).toBe(true);
    expect(AssetRefSchema.safeParse('foo.png').success).toBe(true);
    expect(AssetRefSchema.safeParse('https://x.com/a.png').success).toBe(false);
    expect(AssetRefSchema.safeParse('/abs/a.png').success).toBe(false);
    expect(AssetRefSchema.safeParse('assets/../secret.png').success).toBe(false);
    expect(AssetRefSchema.safeParse('C:\\x.png').success).toBe(false);
  });

  it('accepts nested stacks with flow children', () => {
    const s = SceneSpecSchema.parse(
      baseScene({
        elements: [
          {
            type: 'stack',
            id: 'st',
            direction: 'column',
            gap: 40,
            start: 0,
            duration: 5,
            placement: { anchor: 'center', offset: { x: 0, y: 0 } },
            style: {},
            animation: {},
            children: [
              { type: 'text', id: 'c1', content: 'A', start: 0, duration: 5, placement: { flow: true }, style: {}, animation: {} },
              {
                type: 'stack', id: 'st2', direction: 'row', gap: 30, start: 0, duration: 5,
                placement: { flow: true }, style: {}, animation: {},
                children: [
                  { type: 'shape', id: 'c2', shape: 'rect', start: 0, duration: 5, placement: { flow: true }, style: {}, animation: {} }
                ]
              }
            ]
          }
        ]
      })
    );
    expect(s.elements[0]?.type).toBe('stack');
  });
});

describe('validateScene', () => {
  it('warns on transparent canvas + non-none background', () => {
    const s = SceneSpecSchema.parse(
      baseScene({
        canvas: presetCanvas('landscape', { output: 'transparent' }),
        background: { kind: 'solid', color: '#fff' }
      })
    );
    const v = validateScene(s);
    expect(v.errors).toHaveLength(0);
    expect(v.warnings.map((w) => w.code)).toContain('background-on-transparent');
  });

  it('warns + flags gap below 24*unit (not an error)', () => {
    const s = SceneSpecSchema.parse(
      baseScene({
        elements: [
          {
            type: 'stack', id: 'st', direction: 'row', gap: 10, start: 0, duration: 5,
            placement: { anchor: 'center', offset: { x: 0, y: 0 } }, style: {}, animation: {},
            children: [
              { type: 'text', id: 'a', content: 'A', start: 0, duration: 5, placement: { flow: true }, style: {}, animation: {} },
              { type: 'text', id: 'b', content: 'B', start: 0, duration: 5, placement: { flow: true }, style: {}, animation: {} }
            ]
          }
        ]
      })
    );
    const v = validateScene(s);
    expect(v.errors).toHaveLength(0);
    expect(v.warnings.map((w) => w.code)).toContain('gap-below-min');
  });

  it('errors on duplicate ids and flow placement at top level', () => {
    const dup = SceneSpecSchema.parse(
      baseScene({
        elements: [
          { type: 'text', id: 'x', content: 'A', start: 0, duration: 2, placement: { anchor: 'center', offset: { x: 0, y: 0 } }, style: {}, animation: {} },
          { type: 'text', id: 'x', content: 'B', start: 0, duration: 2, placement: { anchor: 'top', offset: { x: 0, y: 0 } }, style: {}, animation: {} }
        ]
      })
    );
    expect(validateScene(dup).errors.join()).toContain('duplicate');

    const flowTop = SceneSpecSchema.parse(
      baseScene({
        elements: [
          { type: 'text', id: 'f', content: 'A', start: 0, duration: 2, placement: { flow: true }, style: {}, animation: {} }
        ]
      })
    );
    expect(validateScene(flowTop).errors.join()).toContain('flow');
  });

  it('warns when element outlives canvas and anchor leaves safe area', () => {
    const s = SceneSpecSchema.parse(
      baseScene({
        elements: [
          { type: 'text', id: 'late', content: 'A', start: 5, duration: 5, placement: { anchor: 'center', offset: { x: 5000, y: 0 } }, style: {}, animation: {} }
        ]
      })
    );
    const codes = validateScene(s).warnings.map((w) => w.code);
    expect(codes).toContain('element-outlives-canvas');
    expect(codes).toContain('safe-area-overflow');
  });
});
