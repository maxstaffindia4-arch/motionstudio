#!/usr/bin/env tsx
/**
 * Phase 0 spike: generate HyperFrames fixture compositions with the engine.
 * Run from repo root:  pnpm exec tsx spikes/render/scripts/gen-fixtures.ts
 *
 * Writes spikes/render/fixtures/<name>/index.html (+ assets/gsap.min.js)
 * and spikes/render/fixtures/manifest.json consumed by render-all.ts/verify.ts.
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScene } from '../../../packages/engine/src/components/registry.js';
import { compileScene } from '../../../packages/engine/src/compile.js';
import { presetCanvas, CanvasSpecSchema, type CanvasSpec } from '../../../packages/engine/src/canvas/schema.js';
import { unit } from '../../../packages/engine/src/canvas/geometry.js';
import type { SceneSpec } from '../../../packages/engine/src/scene/schema.js';
import type { Element } from '../../../packages/engine/src/elements/schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');
const GSAP = join(HERE, '..', '..', '..', 'packages', 'engine', 'assets', 'gsap.min.js');

interface FixtureDef {
  component: string;
  params: unknown;
  /** 'custom' uses CUSTOM_CANVAS; otherwise a preset name. */
  canvas: 'landscape' | 'vertical' | 'square' | 'custom';
}

const CUSTOM_CANVAS = CanvasSpecSchema.parse({
  width: 1280,
  height: 720,
  durationSec: 5,
  output: 'transparent',
  safeMargins: 'action',
});

function canvasFor(name: FixtureDef['canvas']): CanvasSpec {
  if (name === 'custom') return CUSTOM_CANVAS;
  return presetCanvas(name, { output: 'transparent', durationSec: 5 });
}

const COMPONENT_FIXTURES: FixtureDef[] = [
  { component: 'text-slam', params: { text: 'Transparent overlays, rendered right.', highlightWords: 'Transparent' }, canvas: 'landscape' },
  { component: 'text-slam', params: { text: 'Transparent overlays, rendered right.', highlightWords: 'Transparent' }, canvas: 'vertical' },
  { component: 'text-slam', params: { text: 'Transparent overlays, rendered right.', highlightWords: 'Transparent' }, canvas: 'square' },
  { component: 'text-slam', params: { text: 'Transparent overlays, rendered right.', highlightWords: 'Transparent' }, canvas: 'custom' },

  { component: 'number-counter', params: { target: 70, suffix: '%', label: 'Cost reduction vs local hiring' }, canvas: 'landscape' },
  { component: 'number-counter', params: { target: 70, suffix: '%', label: 'Cost reduction vs local hiring' }, canvas: 'vertical' },
  { component: 'number-counter', params: { target: 70, suffix: '%', label: 'Cost reduction vs local hiring' }, canvas: 'square' },
  { component: 'number-counter', params: { target: 70, suffix: '%', label: 'Cost reduction vs local hiring' }, canvas: 'custom' },

  { component: 'glow-sweep', params: { text: 'Launch Faster', accentColor: '#F59E0B', passes: 2, glowBlur: 60 }, canvas: 'landscape' },
  { component: 'glow-sweep', params: { text: 'Launch Faster', accentColor: '#F59E0B', passes: 2, glowBlur: 60 }, canvas: 'vertical' },
  { component: 'glow-sweep', params: { text: 'Launch Faster', accentColor: '#F59E0B', passes: 2, glowBlur: 60 }, canvas: 'square' },
  { component: 'glow-sweep', params: { text: 'Launch Faster', accentColor: '#F59E0B', passes: 2, glowBlur: 60 }, canvas: 'custom' },
];

/**
 * glow-torture: large text-shadow + box-shadow glows (blur 20–120px) on a
 * transparent canvas — the Motion Lab "box artifact" regression fixture.
 * Geometry is computed per canvas so all four aspect ratios work.
 */
function tortureScene(canvas: CanvasSpec): SceneSpec {
  const D = canvas.durationSec;
  const u = unit(canvas);
  const px = (v: number) => Math.round(v * u);

  const card = (
    id: string,
    anchor: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
    offset: { x: number; y: number },
    blur: number,
    label: string,
    start: number
  ): Element => ({
    type: 'stack',
    id,
    direction: 'column',
    gap: 24,
    start,
    duration: Math.max(0.4, D - start),
    placement: { anchor, offset: { x: px(offset.x), y: px(offset.y) } },
    style: {
      background: 'rgba(18,18,28,0.88)',
      borderRadius: px(24),
      borderColor: '#FFFFFF',
      borderWidth: 1,
      padding: `${px(36)}px ${px(56)}px`,
      glow: { color: '#FF2D95', blur: px(blur) },
    },
    animation: { in: { preset: 'fade-scale', delay: 0.1 } },
    children: [
      {
        type: 'shape',
        id: `${id}-dot`,
        shape: 'pill',
        start,
        duration: Math.max(0.4, D - start),
        placement: { flow: true },
        style: { width: px(56), height: px(56), color: '#FF2D95' },
        animation: {},
      },
      {
        type: 'text',
        id: `${id}-label`,
        content: label,
        start: start + 0.15,
        duration: Math.max(0.4, D - start - 0.15),
        placement: { flow: true },
        style: { fontSize: px(34), fontWeight: 700, color: '#FFFFFF' },
        animation: { in: { preset: 'pop' } },
      },
    ],
  });

  return {
    specVersion: 1,
    canvas,
    background: { kind: 'none' },
    elements: [
      {
        type: 'text',
        id: 'tort-glow-text',
        content: 'GLOW',
        start: 0.2,
        duration: Math.max(0.4, D - 0.2),
        placement: { anchor: 'center', offset: { x: 0, y: px(-canvas.height * 0.18) } },
        style: {
          fontSize: px(150),
          fontWeight: 900,
          color: '#FFFFFF',
          letterSpacing: -2,
          glow: { color: '#00E5FF', blur: px(90) },
          shadow: `0 ${px(8)}px ${px(40)}px rgba(0,0,0,0.5)`,
        },
        animation: { in: { preset: 'slam' } },
      },
      card('tort-card-blur20', 'top-left', { x: 90, y: 90 }, 20, 'blur 20', 0.5),
      card('tort-card-blur45', 'top-right', { x: -90, y: 90 }, 45, 'blur 45', 0.7),
      card('tort-card-blur70', 'bottom-left', { x: 90, y: -90 }, 70, 'blur 70', 0.9),
      card('tort-card-blur120', 'bottom-right', { x: -90, y: -90 }, 120, 'blur 120', 1.1),
    ],
  };
}

const TORTURE_CANVASES: FixtureDef['canvas'][] = ['landscape', 'vertical', 'square', 'custom'];

/**
 * NEGATIVE CONTROL — deliberately reproduces the Motion Lab "box artifact":
 * an opaque plate inside an overflow:hidden clip box that cuts the glow off
 * at a straight edge. The glow-box detector MUST fail on this fixture.
 * Hand-authored (not engine output) so it is not a valid engine scene.
 */
function negativeGlowBoxHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
html,body{margin:0;padding:0;width:1920px;height:1080px;overflow:hidden;background:transparent}
#root{position:relative;width:100%;height:100%}
.anchor{position:absolute;inset:0;display:flex;justify-content:center;align-items:center}
.clip{will-change:transform,opacity}
#neg-clip{overflow:hidden;width:640px;height:240px;background:#101018}
#neg-text{font-family:"Montserrat","Inter","Helvetica Neue","Arial",sans-serif;font-size:150px;font-weight:900;color:#FFFFFF;line-height:1;white-space:nowrap;padding:30px 10px;text-shadow:0 0 90px #FF2D95,0 0 40px #FF2D95}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="5" data-width="1920" data-height="1080">
<div class="anchor"><div id="neg-clip" class="clip" data-start="0" data-duration="5"><div id="neg-text">GLOW</div></div></div>
</div>
<script src="assets/gsap.min.js"></script>
<script>
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
tl.fromTo('#neg-clip', { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'power4.out' }, 0.2);
window.__timelines["main"] = tl;
tl.seek(0);
</script>
</body>
</html>
`;
}

interface ManifestEntry {
  name: string;
  component: string;
  dir: string;
  canvas: { width: number; height: number; fps: number; durationSec: number; output: string };
}

interface NegativeEntry {
  name: string;
  /** Composition dir to render. Defaults to fixtures/<name>. */
  dir?: string;
  /** 'full' = MOV+WebM pipeline; 'mp4-native' = hyperframes --format mp4 only. */
  mode: 'full' | 'mp4-native';
  canvas: ManifestEntry['canvas'];
  /** Checks that MUST fail for the control to be valid. */
  expectFail: string[];
}

function writeComposition(name: string, scene: SceneSpec): void {
  const dir = join(FIXTURES, name);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  const { html, warnings } = compileScene(scene);
  if (warnings.length > 0) {
    console.log(`  [warn] ${name}: ${warnings.map((w) => w.code).join(', ')}`);
  }
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  if (existsSync(GSAP)) copyFileSync(GSAP, join(dir, 'assets', 'gsap.min.js'));
}

function main(): void {
  const manifest: ManifestEntry[] = [];
  let n = 0;

  for (const f of COMPONENT_FIXTURES) {
    const canvas = canvasFor(f.canvas);
    const name = `${f.component}-${f.canvas}`;
    writeComposition(name, buildScene(f.component, f.params, canvas));
    manifest.push({
      name,
      component: f.component,
      dir: `fixtures/${name}`,
      canvas: { width: canvas.width, height: canvas.height, fps: canvas.fps, durationSec: canvas.durationSec, output: canvas.output },
    });
    n++;
  }

  for (const cname of TORTURE_CANVASES) {
    const canvas = canvasFor(cname);
    const name = `glow-torture-${cname}`;
    writeComposition(name, tortureScene(canvas));
    manifest.push({
      name,
      component: 'glow-torture',
      dir: `fixtures/${name}`,
      canvas: { width: canvas.width, height: canvas.height, fps: canvas.fps, durationSec: canvas.durationSec, output: canvas.output },
    });
    n++;
  }

  // --- negative controls (rendered by render-all, asserted-fail by verify) ---
  const negatives: NegativeEntry[] = [];

  {
    const canvas = canvasFor('landscape');
    const name = 'negative-glow-box';
    const dir = join(FIXTURES, name);
    mkdirSync(join(dir, 'assets'), { recursive: true });
    writeFileSync(join(dir, 'index.html'), negativeGlowBoxHtml(), 'utf8');
    if (existsSync(GSAP)) copyFileSync(GSAP, join(dir, 'assets', 'gsap.min.js'));
    negatives.push({
      name,
      mode: 'full',
      canvas: { width: canvas.width, height: canvas.height, fps: canvas.fps, durationSec: canvas.durationSec, output: canvas.output },
      expectFail: ['mov.glow-box', 'webm.glow-box'],
    });
    n++;
  }

  {
    // Native hyperframes MP4 has no alpha — detector must fail on it.
    // (Native WebM was tried first: hyperframes 0.9.59 DOES emit
    // ALPHA_MODE=1, so it is not a valid negative — see phase0-report.md.)
    const canvas = canvasFor('landscape');
    negatives.push({
      name: 'negative-native-mp4',
      dir: 'fixtures/glow-sweep-landscape',
      mode: 'mp4-native',
      canvas: { width: canvas.width, height: canvas.height, fps: canvas.fps, durationSec: canvas.durationSec, output: canvas.output },
      expectFail: ['mp4.glow-box', 'mp4.transparent-pixels'],
    });
  }

  writeFileSync(
    join(FIXTURES, 'manifest.json'),
    JSON.stringify({ fixtures: manifest, negatives }, null, 2),
    'utf8'
  );
  console.log(`wrote ${n} fixtures + ${negatives.length} negative controls to ${FIXTURES}`);
}

main();
