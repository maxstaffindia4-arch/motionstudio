import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/compile.js';
import { presetCanvas } from '../src/canvas/schema.js';
import type { SceneSpec } from '../src/scene/schema.js';

function scene(overrides: Record<string, unknown> = {}): SceneSpec {
  return {
    specVersion: 1,
    canvas: presetCanvas('landscape', { durationSec: 6 }),
    background: { kind: 'none' },
    elements: [
      {
        type: 'text',
        id: 'hero',
        content: 'Hello World',
        start: 0.5,
        duration: 4,
        placement: { anchor: 'center', offset: { x: 0, y: 0 } },
        style: { fontSize: 80 },
        animation: { in: { preset: 'slam' }, out: { preset: 'fade-scale' } }
      },
      {
        type: 'stack',
        id: 'row',
        direction: 'row',
        gap: 40,
        start: 1,
        duration: 3,
        placement: { anchor: 'bottom', offset: { x: 0, y: -40 } },
        style: {},
        animation: { in: { preset: 'slide', direction: 'up' } },
        children: [
          { type: 'text', id: 'c1', content: 'One', start: 0, duration: 3, placement: { flow: true }, style: {}, animation: { in: { preset: 'pop' } } },
          { type: 'shape', id: 'c2', shape: 'pill', start: 0, duration: 3, placement: { flow: true }, style: { width: 60, height: 60, color: '#fff' }, animation: {} }
        ]
      }
    ],
    ...overrides
  } as SceneSpec;
}

function invariants(html: string, canvas = { w: 1920, h: 1080, d: 6 }) {
  // exactly one root with required attributes
  expect(html).toContain(`data-composition-id="main"`);
  expect(html).toContain(`data-start="0"`);
  expect(html).toContain(`data-duration="${canvas.d}"`);
  expect(html).toContain(`data-width="${canvas.w}"`);
  expect(html).toContain(`data-height="${canvas.h}"`);
  expect(html.match(/id="root"/g)).toHaveLength(1);
  // one paused timeline registered + seek
  expect(html).toContain('gsap.timeline({ paused: true })');
  expect(html).toContain('window.__timelines["main"] = tl');
  expect(html).toContain('tl.seek(0)');
  // no remote URLs (xmlns allowed)
  expect(html).not.toMatch(/https?:\/\//);
  // no forbidden time APIs
  expect(html).not.toMatch(/Date\.now|performance\.now|setTimeout|setInterval|requestAnimationFrame|Math\.random/);
  // every .clip has data-start and data-duration
  const clips = html.match(/class="[^"]*\bclip\b[^"]*"/g) ?? [];
  for (const m of html.matchAll(/<div[^>]*class="[^"]*\bclip\b[^"]*"[^>]*>/g)) {
    expect(m[0]).toContain('data-start=');
    expect(m[0]).toContain('data-duration=');
  }
  expect(clips.length).toBeGreaterThan(0);
  // no display/visibility/autoAlpha tweens
  const tlSection = html.slice(html.indexOf('const tl ='));
  expect(tlSection).not.toMatch(/display|visibility|autoAlpha/);
  // local gsap only
  expect(html).toContain('src="assets/gsap.min.js"');
  expect(html).not.toContain('cdn.jsdelivr');
}

describe('compileScene', () => {
  it('produces deterministic byte-identical output', () => {
    const a = compileScene(scene());
    const b = compileScene(scene());
    expect(a.html).toBe(b.html);
    expect(a.assets).toEqual(['gsap.min.js']);
  });

  it('satisfies HyperFrames invariants', () => {
    invariants(compileScene(scene()).html);
  });

  it('emits flex-wrapper anchors inside the safe area', () => {
    const { html } = compileScene(scene());
    expect(html).toContain('class="anchor"');
    // action safe on 1920x1080 = 5% → 96px/54px insets
    expect(html).toContain('top:54px;left:96px');
    expect(html).toContain('justify-content:center');
  });

  it('scales with unit() for vertical canvas', () => {
    const s = scene({ canvas: presetCanvas('vertical', { durationSec: 6 }) });
    const { html, warnings } = compileScene(s);
    invariants(html, { w: 1080, h: 1920, d: 6 });
    // fontSize 80 * unit(1) = 80px — same spec value, different canvas
    expect(html).toContain('font-size:80px');
    expect(warnings.filter((w) => w.code === 'safe-area-overflow')).toHaveLength(0);
  });

  it('clamps gap below minimum with a warning (A3)', () => {
    const s = scene();
    (s.elements[1] as { gap: number }).gap = 10;
    const { html, warnings } = compileScene(s);
    expect(warnings.map((w) => w.code)).toContain('gap-below-min');
    expect(html).toContain('gap:24px'); // clamped to 24 * unit(1)
  });

  it('warns on gradient background over transparent canvas', () => {
    const t = scene({
      canvas: presetCanvas('landscape', { output: 'transparent', durationSec: 6 }),
      background: { kind: 'gradient', type: 'linear', stops: [{ color: '#f00', offset: 0 }, { color: '#00f', offset: 1 }] }
    });
    const { warnings, html } = compileScene(t);
    expect(warnings.map((w) => w.code)).toContain('background-on-transparent');
    expect(html).toContain('background:transparent');
    expect(html).toContain('linear-gradient');
  });

  it('does not warn for gradient on opaque canvas', () => {
    const s = scene({
      background: { kind: 'gradient', type: 'linear', stops: [{ color: '#f00', offset: 0 }, { color: '#00f', offset: 1 }] }
    });
    expect(compileScene(s).warnings.map((w) => w.code)).not.toContain('background-on-transparent');
  });

  it('emits previewOnly backgrounds only for target=preview (A8)', () => {
    const s = scene({
      background: { kind: 'solid', color: '#123456', previewOnly: true }
    });
    const render = compileScene(s, { target: 'render' });
    const preview = compileScene(s, { target: 'preview' });
    expect(render.html).not.toContain('#123456');
    expect(preview.html).toContain('#123456');
  });

  it('keeps DOM order = scene order while sorting timeline calls', () => {
    const s = scene({
      elements: [
        { type: 'text', id: 'late', content: 'L', start: 4, duration: 1, placement: { anchor: 'top', offset: { x: 0, y: 0 } }, style: {}, animation: {} },
        { type: 'text', id: 'early', content: 'E', start: 0, duration: 1, placement: { anchor: 'bottom', offset: { x: 0, y: 0 } }, style: {}, animation: {} }
      ]
    });
    const { html } = compileScene(s);
    const lateIdx = html.indexOf('id="late"');
    const earlyIdx = html.indexOf('id="early"');
    expect(lateIdx).toBeLessThan(earlyIdx); // DOM order preserved
  });

  it('throws on structural errors (duplicate ids)', () => {
    const s = scene({
      elements: [
        { type: 'text', id: 'dup', content: 'A', start: 0, duration: 1, placement: { anchor: 'center', offset: { x: 0, y: 0 } }, style: {}, animation: {} },
        { type: 'text', id: 'dup', content: 'B', start: 0, duration: 1, placement: { anchor: 'top', offset: { x: 0, y: 0 } }, style: {}, animation: {} }
      ]
    });
    expect(() => compileScene(s)).toThrow(/duplicate/);
  });

  it('resolves token references and warns on missing tokens', () => {
    const s = scene({
      tokens: { colors: { primary: '#ABCDEF' } },
      elements: [
        { type: 'shape', id: 'tok', shape: 'rect', start: 0, duration: 1, placement: { anchor: 'center', offset: { x: 0, y: 0 } }, style: { color: { token: 'colors.primary' }, width: 10, height: 10 }, animation: {} },
        { type: 'shape', id: 'bad', shape: 'rect', start: 0, duration: 1, placement: { anchor: 'top', offset: { x: 0, y: 0 } }, style: { color: { token: 'colors.nope' }, width: 10, height: 10 }, animation: {} }
      ]
    });
    const { html, warnings } = compileScene(s);
    expect(html).toContain('#ABCDEF');
    expect(warnings.map((w) => w.code)).toContain('token-unresolved');
  });

  it('uppercase via CSS text-transform, content verbatim (A4)', () => {
    const s = scene({
      elements: [
        { type: 'text', id: 'cap', content: '  MixedCase Text  ', start: 0, duration: 2, placement: { anchor: 'center', offset: { x: 0, y: 0 } }, style: { textTransform: 'uppercase' }, animation: {} }
      ]
    });
    const { html } = compileScene(s);
    expect(html).toContain('  MixedCase Text  ');
    expect(html).toContain('text-transform:uppercase');
    expect(html).not.toContain('MIXEDCASE TEXT');
  });

  it('counter emits proxy onUpdate tween', () => {
    const s = scene({
      elements: [
        { type: 'text', id: 'num', content: '70', start: 0, duration: 3, placement: { anchor: 'center', offset: { x: 0, y: 0 } }, style: { fontSize: 120 }, animation: { in: { preset: 'counter' } } }
      ]
    });
    const { html } = compileScene(s);
    expect(html).toContain('onUpdate:function()');
    expect(html).toContain('v:70');
    expect(html).toContain('toLocaleString()');
  });

  it('strike emits scaleX line, never width tween', () => {
    const s = scene({
      elements: [
        { type: 'text', id: 'hit', content: 'Target', start: 0, duration: 4, placement: { anchor: 'center', offset: { x: 0, y: 0 } }, style: {}, animation: { in: { preset: 'strike', delay: 1 } } }
      ]
    });
    const { html } = compileScene(s);
    expect(html).toContain('strike-line');
    expect(html).toContain('scaleX:0');
    const tl = html.slice(html.indexOf('const tl ='));
    expect(tl).not.toMatch(/width\s*:/);
  });

  it('emits box-shadow for stack glow and pads overflow-hidden masks', () => {
    const s = scene({
      elements: [
        {
          type: 'stack', id: 'glowy', direction: 'column', gap: 24, start: 0, duration: 3,
          placement: { anchor: 'center', offset: { x: 0, y: 0 } },
          style: { overflow: 'hidden', glow: { color: '#FF0000', blur: 40 } },
          animation: {},
          children: [
            { type: 'text', id: 'gt', content: 'Glow', start: 0, duration: 3, placement: { flow: true }, style: {}, animation: {} }
          ]
        }
      ]
    });
    const { html } = compileScene(s);
    expect(html).toContain('box-shadow:0 0 40px #FF0000');
    expect(html).toContain('overflow:hidden');
    expect(html).toContain('padding:40px');
  });

  it('rejects invalid asset refs at schema level', () => {
    const s = scene({
      elements: [
        { type: 'image', id: 'img', asset: 'https://evil.com/x.png', start: 0, duration: 1, placement: { anchor: 'center', offset: { x: 0, y: 0 } }, style: {}, animation: {} }
      ]
    });
    expect(() => compileScene(s)).toThrow();
  });
});
