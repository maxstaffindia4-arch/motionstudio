#!/usr/bin/env tsx
/**
 * Dev CLI: compile a component scene to out/<name>/index.html.
 *
 *   tsx scripts/compile.ts --component text-slam \
 *     --params '{"text":"Hello"}' --canvas vertical --output transparent
 *
 * Optional: --duration <sec> --target preview|render --name <dir> --tokens '<json>'
 * Output is ready for `npx hyperframes render` or browser preview.
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScene } from '../src/components/registry.js';
import { compileScene } from '../src/compile.js';
import { CanvasSpecSchema, presetCanvas, type CanvasSpec } from '../src/canvas/schema.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GSAP_SRC = join(PKG_ROOT, 'assets', 'gsap.min.js');

interface Args {
  component?: string;
  params?: string;
  canvas?: string;
  output?: string;
  duration?: string;
  target?: string;
  name?: string;
  tokens?: string;
  outDir?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined || !a.startsWith('--')) continue;
    const key = a.slice(2) as keyof Args;
    const val = argv[i + 1];
    if (val !== undefined && !val.startsWith('--')) {
      (out as Record<string, string>)[key] = val;
      i++;
    } else {
      (out as Record<string, string>)[key] = 'true';
    }
  }
  return out;
}

function usage(): never {
  console.error(
    'usage: tsx scripts/compile.ts --component <id> [--params \'<json>\'] ' +
      '[--canvas landscape|vertical|square|\'<json>\'] [--output transparent|opaque] ' +
      '[--duration <sec>] [--target preview|render] [--name <dir>] [--tokens \'<json>\'] [--out-dir <dir>]'
  );
  process.exit(2);
}

function resolveCanvas(args: Args): CanvasSpec {
  const raw = args.canvas ?? 'landscape';
  const overrides: Record<string, unknown> = {};
  if (args.output !== undefined) overrides.output = args.output;
  if (args.duration !== undefined) overrides.durationSec = Number(args.duration);
  if (raw === 'landscape' || raw === 'vertical' || raw === 'square') {
    return presetCanvas(raw, overrides);
  }
  // custom: JSON object merged over a landscape base for defaults
  try {
    const custom = JSON.parse(raw) as Record<string, unknown>;
    return CanvasSpecSchema.parse({ ...presetCanvas('landscape'), ...custom, ...overrides });
  } catch {
    usage();
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.component === undefined) usage();

  const canvas = resolveCanvas(args);
  // '@path.json' reads JSON from a file (avoids shell quoting issues).
  const readJson = (v: string | undefined): unknown => {
    if (v === undefined) return undefined;
    const raw = v.startsWith('@') ? readFileSync(v.slice(1), 'utf8') : v;
    return JSON.parse(raw) as unknown;
  };
  const params = readJson(args.params) ?? {};
  const tokens = readJson(args.tokens) as never;

  const scene = buildScene(args.component, params, canvas, tokens);
  const target = args.target === 'preview' ? 'preview' : 'render';
  const { html, warnings } = compileScene(scene, { target });

  const name = args.name ?? `${args.component}-${canvas.width}x${canvas.height}`;
  const outDir = args.outDir ?? join(PKG_ROOT, 'out', name);
  const assetsDir = join(outDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html, 'utf8');
  if (existsSync(GSAP_SRC)) {
    copyFileSync(GSAP_SRC, join(assetsDir, 'gsap.min.js'));
  }

  console.log(`wrote ${join(outDir, 'index.html')}`);
  if (warnings.length > 0) {
    console.log('warnings:');
    for (const w of warnings) console.log(`  [${w.severity}] ${w.code}: ${w.message}`);
  }
}

main();
