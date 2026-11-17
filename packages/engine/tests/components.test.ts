import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/compile.js';
import { buildScene, COMPONENTS } from '../src/components/registry.js';
import { presetCanvas, CanvasSpecSchema, type CanvasSpec } from '../src/canvas/schema.js';

const CUSTOM: CanvasSpec = CanvasSpecSchema.parse({
  width: 1280,
  height: 800,
  durationSec: 6,
  output: 'opaque',
  safeMargins: 'action',
});

const CANVASES: Array<[string, () => CanvasSpec]> = [
  ['landscape', () => presetCanvas('landscape', { durationSec: 6 })],
  ['vertical', () => presetCanvas('vertical', { durationSec: 6 })],
  ['square', () => presetCanvas('square', { durationSec: 6 })],
  ['custom', () => CUSTOM],
];

/** Minimal valid params per component (required fields only). */
const PARAMS: Record<string, unknown> = {
  'text-slam': { text: 'Big launch energy', highlightWords: 'launch' },
  'keyword-pop': { keyword: 'SCALABLE', subtext: 'Built for growth' },
  'strike-checklist': { title: 'Headaches', items: 'Hiring,Office,Admin' },
  'lower-third': { name: 'Jane Doe', title: 'CEO', company: 'Acme' },
  'icon-cards': { heading: 'Features', cards: 'Talent,Office,Recruiting' },
  'step-card': { badge: 'STEP 1', title: 'Onboard', description: 'We handle it' },
  'end-card': { brandName: 'Acme', website: 'acme.com', ctaText: 'Learn more' },
  'caption-track': { text: 'remote teams scale fast', activeIndex: 1 },
  'number-counter': { target: 70, suffix: '%', label: 'cost saved' },
  'whip-transition': {},
  'glow-sweep': { text: 'Shine Bright', passes: 2 },
};

function checkInvariants(html: string, canvas: CanvasSpec) {
  expect(html).toContain('data-composition-id="main"');
  expect(html).toContain(`data-width="${canvas.width}"`);
  expect(html).toContain(`data-height="${canvas.height}"`);
  expect(html).toContain(`data-duration="${canvas.durationSec}"`);
  expect(html.match(/id="root"/g)).toHaveLength(1);
  expect(html).toContain('gsap.timeline({ paused: true })');
  expect(html).toContain('window.__timelines["main"] = tl');
  expect(html).toContain('tl.seek(0)');
  expect(html).not.toMatch(/https?:\/\//);
  expect(html).not.toMatch(/Date\.now|performance\.now|setTimeout|setInterval|requestAnimationFrame|Math\.random/);
  for (const m of html.matchAll(/<div[^>]*class="[^"]*\bclip\b[^"]*"[^>]*>/g)) {
    expect(m[0]).toContain('data-start=');
    expect(m[0]).toContain('data-duration=');
  }
  const tl = html.slice(html.indexOf('const tl ='));
  expect(tl).not.toMatch(/display|visibility|autoAlpha/);
  expect(html).toContain('src="assets/gsap.min.js"');
}

describe('component library', () => {
  it('exposes all 11 archetypes', () => {
    expect(Object.keys(COMPONENTS).sort()).toEqual([
      'caption-track',
      'end-card',
      'glow-sweep',
      'icon-cards',
      'keyword-pop',
      'lower-third',
      'number-counter',
      'step-card',
      'strike-checklist',
      'text-slam',
      'whip-transition',
    ]);
  });

  for (const [cname, makeCanvas] of CANVASES) {
    for (const [id, params] of Object.entries(PARAMS)) {
      it(`${id} × ${cname} compiles cleanly`, () => {
        const c = makeCanvas();
        const scene = buildScene(id, params, c);
        const { html, warnings } = compileScene(scene);
        expect(warnings).toEqual([]);
        checkInvariants(html, c);
      });
    }
  }

  it('rejects unknown component ids', () => {
    expect(() => buildScene('nope', {}, 'landscape')).toThrow(/unknown component/);
  });

  it('glow-sweep pads the overflow-hidden mask by the glow radius (A7)', () => {
    const scene = buildScene('glow-sweep', { text: 'Glow', glowBlur: 40 }, 'landscape');
    const { html } = compileScene(scene);
    expect(html).toContain('overflow:hidden');
    // padding = 70*unit(1) + glowPad 40 = 110px on the mask
    expect(html).toContain('padding:110px');
    expect(html).toContain('text-shadow:');
    expect(html).not.toContain('mix-blend-mode');
    expect(html).not.toContain('backdrop-filter');
  });

  it('whip-transition uses transform-only bars, no left tweens', () => {
    const scene = buildScene('whip-transition', {}, 'landscape');
    const { html } = compileScene(scene);
    const tl = html.slice(html.indexOf('const tl ='));
    expect(tl).not.toMatch(/\bleft\s*:|\btop\s*:/);
    expect(tl).toContain('"x":');
  });

  it('anchored component output stays inside the safe area', () => {
    // action-safe on 1080x1920 = 5% → 54px x / 96px y insets
    const scene = buildScene('lower-third', { name: 'A', bottomOffset: 0, sideOffset: 0 }, 'vertical');
    const { html, warnings } = compileScene(scene);
    expect(warnings.filter((w) => w.code === 'safe-area-overflow')).toEqual([]);
    expect(html).toContain('class="anchor"');
  });
});
