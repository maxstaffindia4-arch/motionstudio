#!/usr/bin/env tsx
/**
 * Phase 0 spike: render every fixture to a ProRes 4444 MOV alpha master,
 * then derive WebM (VP9 alpha) and MP4 (chroma + opaque) with ffmpeg —
 * the exact Motion Lab method (src/server/hyperframes.ts).
 *
 * Usage (repo root or container):
 *   tsx spikes/render/scripts/render-all.ts [fixturesDir] [outDir]
 * Env: FFMPEG_PATH / FFPROBE_PATH override binary locations.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPIKE = join(HERE, '..');
const FIXTURES = resolve(process.argv[2] ?? join(SPIKE, 'fixtures'));
const OUT = resolve(process.argv[3] ?? join(SPIKE, 'out'));
const REPORT = join(OUT, 'render-report.json');
const FFMPEG_BIN = process.env.FFMPEG_PATH ?? 'ffmpeg';

interface ManifestEntry {
  name: string;
  component: string;
  dir: string;
  canvas: { width: number; height: number; fps: number; durationSec: number; output: string };
}

function which(bin: string): string {
  const env = bin === 'ffmpeg' ? process.env.FFMPEG_PATH : process.env.FFPROBE_PATH;
  if (env && existsSync(env)) return env;
  return bin;
}

function run(cmd: string, args: string[], cwd?: string): { code: number; ms: number; tail: string } {
  const t0 = Date.now();
  // hyperframes shells out to ffmpeg/ffprobe itself — make sure its dir is on PATH.
  const ffDir = FFMPEG_BIN !== 'ffmpeg' ? dirname(FFMPEG_BIN) : undefined;
  const env = ffDir && !process.env.PATH?.includes(ffDir)
    ? { ...process.env, PATH: `${ffDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` }
    : process.env;
  const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  const ms = Date.now() - t0;
  const tail = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.split('\n').slice(-5).join('\n');
  return { code: res.status ?? 1, ms, tail };
}

function hyperframesBin(): { cmd: string; prefix: string[] } {
  // Prefer the engine's devDependency (pnpm nests it under packages/engine);
  // fall back to a root install or a global `hyperframes` on PATH.
  const candidates = [
    join(SPIKE, '..', '..', 'packages', 'engine', 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs'),
    join(SPIKE, '..', '..', 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs'),
  ];
  for (const local of candidates) {
    if (existsSync(local)) return { cmd: process.execPath, prefix: [local] };
  }
  return { cmd: 'hyperframes', prefix: [] };
}

interface RenderResult {
  name: string;
  component: string;
  canvas: ManifestEntry['canvas'];
  mov?: { file: string; bytes: number; ms: number; ok: boolean; error?: string };
  webm?: { file: string; bytes: number; ms: number; ok: boolean; error?: string };
  chroma?: { file: string; bytes: number; ms: number; ok: boolean; error?: string };
  full?: { file: string; bytes: number; ms: number; ok: boolean; error?: string };
}

function derive(ffmpeg: string, args: string[], outFile: string): { ok: boolean; ms: number; error?: string } {
  const t0 = Date.now();
  const res = run(ffmpeg, ['-y', ...args, outFile]);
  const ms = Date.now() - t0;
  if (res.code !== 0 || !existsSync(outFile)) {
    return { ok: false, ms, error: res.tail.slice(-400) };
  }
  return { ok: true, ms };
}

function main(): void {
  const manifest = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')) as { fixtures: ManifestEntry[] };
  mkdirSync(OUT, { recursive: true });
  const ffmpeg = which('ffmpeg');
  const hf = hyperframesBin();
  const results: RenderResult[] = [];

  for (const f of manifest.fixtures) {
    const compDir = join(FIXTURES, f.name);
    const base = join(OUT, f.name);
    const movPath = `${base}.mov`;
    const entry: RenderResult = { name: f.name, component: f.component, canvas: f.canvas };
    console.log(`\n=== ${f.name} (${f.canvas.width}x${f.canvas.height}) ===`);

    // 1) Native MOV master (ProRes 4444 alpha) — exact Motion Lab flags.
    const r = run(hf.cmd, [...hf.prefix, 'render', compDir, '-o', movPath, '--format', 'mov', '--fps', String(f.canvas.fps)], compDir);
    if (r.code === 0 && existsSync(movPath)) {
      entry.mov = { file: movPath, bytes: stat(movPath), ms: r.ms, ok: true };
      console.log(`  mov ok (${(entry.mov.bytes / 1048576).toFixed(1)} MB, ${(r.ms / 1000).toFixed(1)}s)`);
    } else {
      entry.mov = { file: movPath, bytes: 0, ms: r.ms, ok: false, error: r.tail.slice(-400) };
      console.log(`  mov FAILED: ${entry.mov.error}`);
      results.push(entry);
      continue;
    }

    // 2) Derived WebM VP9 alpha — exact Motion Lab ffmpeg args.
    const w = derive(ffmpeg, [
      '-i', movPath,
      '-c:v', 'libvpx-vp9',
      '-pix_fmt', 'yuva420p',
      '-crf', '24',
      '-b:v', '0',
      '-auto-alt-ref', '0',
      '-row-mt', '1',
      '-an',
    ], `${base}.webm`);
    entry.webm = { file: `${base}.webm`, bytes: w.ok ? stat(`${base}.webm`) : 0, ms: w.ms, ok: w.ok, error: w.error };
    console.log(`  webm ${w.ok ? 'ok' : 'FAILED'} (${(entry.webm.bytes / 1048576).toFixed(1)} MB, ${(w.ms / 1000).toFixed(1)}s)`);

    // 3) Derived MP4s composited over the MOV alpha master.
    //    Motion Lab hardcodes 1920x1080; parameterized here per canvas (same method).
    const s = `${f.canvas.width}x${f.canvas.height}`;
    for (const [key, color, file] of [
      ['chroma', '0x00FF00', `${base}-chroma.mp4`],
      ['full', '0x0B0F19', `${base}-full.mp4`],
    ] as const) {
      const d = derive(ffmpeg, [
        '-f', 'lavfi',
        '-i', `color=c=${color}:s=${s}:r=${f.canvas.fps}`,
        '-i', movPath,
        '-filter_complex', '[0:v][1:v]overlay=shortest=1,format=yuv420p',
        '-c:v', 'libx264',
        '-crf', '18',
        '-preset', 'medium',
        '-pix_fmt', 'yuv420p',
        '-an',
      ], file);
      entry[key] = { file, bytes: d.ok ? stat(file) : 0, ms: d.ms, ok: d.ok, error: d.error };
      console.log(`  ${key} ${d.ok ? 'ok' : 'FAILED'} (${(entry[key]!.bytes / 1048576).toFixed(1)} MB, ${(d.ms / 1000).toFixed(1)}s)`);
    }

    results.push(entry);
  }

  writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), ffmpeg, results }, null, 2), 'utf8');
  console.log(`\nreport: ${REPORT}`);
}

function stat(p: string): number {
  try { return existsSync(p) ? statSync(p).size : 0; } catch { return 0; }
}

main();
