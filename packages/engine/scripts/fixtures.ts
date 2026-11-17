#!/usr/bin/env tsx
/**
 * Generates HyperFrames fixture compositions into out/fixtures/ and runs
 * `hyperframes lint` on each. Dev-only (hyperframes is a devDependency).
 *
 *   pnpm lint:hf
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildScene } from '../src/components/registry.js';
import { compileScene } from '../src/compile.js';
import { presetCanvas, CanvasSpecSchema } from '../src/canvas/schema.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GSAP_SRC = join(PKG_ROOT, 'assets', 'gsap.min.js');
const OUT = join(PKG_ROOT, 'out', 'fixtures');

const FIXTURES: Array<{ name: string; component: string; params: unknown; canvas: unknown }> = [
  {
    name: 'text-slam-vertical',
    component: 'text-slam',
    params: { text: 'Running a business is hard enough.', highlightWords: 'hard,enough.' },
    canvas: presetCanvas('vertical', { output: 'transparent', durationSec: 6 }),
  },
  {
    name: 'lower-third-landscape',
    component: 'lower-third',
    params: { name: 'Sarah Jenkins', title: 'Operations Director', company: 'Acme' },
    canvas: presetCanvas('landscape', { durationSec: 6 }),
  },
  {
    name: 'glow-sweep-square',
    component: 'glow-sweep',
    params: { text: 'Launch Faster', accentColor: '#F59E0B', passes: 2 },
    canvas: presetCanvas('square', { durationSec: 6 }),
  },
  {
    name: 'number-counter-custom',
    component: 'number-counter',
    params: { target: 70, suffix: '%', label: 'Cost reduction' },
    canvas: CanvasSpecSchema.parse({ width: 1280, height: 800, durationSec: 6, output: 'opaque', safeMargins: 'action' }),
  },
];

let failed = false;
for (const f of FIXTURES) {
  const dir = join(OUT, f.name);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  const { html, warnings } = compileScene(buildScene(f.component, f.params, f.canvas as never));
  if (warnings.length > 0) {
    console.log(`${f.name}: engine warnings: ${warnings.map((w) => w.code).join(', ')}`);
  }
  writeFileSync(join(dir, 'index.html'), html, 'utf8');
  if (existsSync(GSAP_SRC)) copyFileSync(GSAP_SRC, join(dir, 'assets', 'gsap.min.js'));

  const res = spawnSync(`hyperframes lint "${join(dir, 'index.html')}" --json`, {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    shell: true,
  });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const errors = (out.match(/"severity":\s*"error"/g) ?? []).length;
  console.log(`${f.name}: lint exit=${res.status} errors=${errors}`);
  if (res.status !== 0 || errors > 0) {
    failed = true;
    console.log(out.slice(-2000));
  }
}
process.exit(failed ? 1 : 0);
