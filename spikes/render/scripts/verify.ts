#!/usr/bin/env tsx
/**
 * Phase 0 spike: verify rendered outputs without manual eyeballing.
 *
 * Checks per fixture:
 *  - ffprobe: MOV master pix_fmt is yuva444p12le; WebM reports alpha (yuva420p)
 *  - transparency: alpha==0 pixels composite to EXACTLY the backdrop colour
 *    (red/black/white/green) — done in Node on ffmpeg-extracted RGBA
 *  - GLOW BOX TEST (glow-torture, MOV + WebM): alpha ~0 just outside the
 *    content bbox, smooth falloff, no rectangular low-alpha edge (box artifact)
 *  - number-counter: frames at 1s/2s/3s from the MOV differ (counter animates)
 *
 * Usage: tsx spikes/render/scripts/verify.ts [fixturesDir] [outDir]
 * Env: FFMPEG_PATH / FFPROBE_PATH.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPIKE = join(HERE, '..');
const FIXTURES = resolve(process.argv[2] ?? join(SPIKE, 'fixtures'));
const OUT = resolve(process.argv[3] ?? join(SPIKE, 'out'));
const TMP = join(OUT, '_verify');

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

interface ManifestEntry {
  name: string;
  component: string;
  dir: string;
  canvas: { width: number; height: number; fps: number; durationSec: number; output: string };
}
interface RenderResult {
  name: string;
  component: string;
  canvas: ManifestEntry['canvas'];
  mov?: { file: string; bytes: number; ms: number; ok: boolean };
  webm?: { file: string; bytes: number; ms: number; ok: boolean };
  chroma?: { file: string; bytes: number; ms: number; ok: boolean };
  full?: { file: string; bytes: number; ms: number; ok: boolean };
}

// ---------- helpers ----------

function run(cmd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { code: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function ffprobeStreams(file: string): any[] {
  const r = run(FFPROBE, ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', file]);
  if (r.code !== 0) return [];
  try { return JSON.parse(r.stdout).streams ?? []; } catch { return []; }
}

/** Extract one frame as raw RGBA (ffmpeg does decode+convert). Binary-safe. */
function extractRgbaBuf(file: string, tSec: number): Buffer | null {
  const res = spawnSync(FFMPEG, ['-y', '-ss', String(tSec), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.status !== 0) return null;
  return Buffer.from(res.stdout);
}

function sha(buf: Buffer): string {
  return createHash('md5').update(buf).digest('hex');
}

// ---------- pixel checks ----------

const BACKDROPS: Array<[string, [number, number, number]]> = [
  ['red', [255, 0, 0]],
  ['black', [0, 0, 0]],
  ['white', [255, 255, 255]],
  ['green', [0, 255, 0]],
];

/** Composite RGBA over a solid colour in Node (exact for alpha==0). */
function compositeOver(rgba: Buffer, w: number, h: number, bg: [number, number, number]): Buffer {
  const out = Buffer.alloc(w * h * 3);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const a = rgba[j + 3]! / 255;
    out[i * 3] = Math.round(rgba[j]! * a + bg[0] * (1 - a));
    out[i * 3 + 1] = Math.round(rgba[j + 1]! * a + bg[1] * (1 - a));
    out[i * 3 + 2] = Math.round(rgba[j + 2]! * a + bg[2] * (1 - a));
  }
  return out;
}

interface PixResult { pass: boolean; detail: string }

/** Fully transparent pixels must equal the backdrop exactly. */
function transparencyCheck(file: string, w: number, h: number, tSec: number): PixResult {
  const rgba = extractRgbaBuf(file, tSec);
  if (!rgba || rgba.length !== w * h * 4) return { pass: false, detail: 'frame extraction failed' };
  let transparent = 0;
  const failures: string[] = [];
  for (const [name, bg] of BACKDROPS) {
    const comp = compositeOver(rgba, w, h, bg);
    let bad = 0;
    let sampled = 0;
    // Sample a deterministic grid of alpha==0 pixels.
    for (let y = 0; y < h; y += 7) {
      for (let x = 0; x < w; x += 7) {
        const i = y * w + x;
        if (rgba[i * 4 + 3] === 0) {
          sampled++;
          const r = comp[i * 3]!, g = comp[i * 3 + 1]!, b = comp[i * 3 + 2]!;
          if (r !== bg[0] || g !== bg[1] || b !== bg[2]) {
            if (bad++ < 3) failures.push(`${name}@(${x},${y})=${r},${g},${b}`);
          }
        }
      }
    }
    transparent = Math.max(transparent, sampled);
    if (bad > 0) return { pass: false, detail: `${name}: ${bad} non-backdrop px e.g. ${failures.join('; ')}` };
    if (sampled === 0) return { pass: false, detail: `${name}: no transparent pixels found` };
  }
  return { pass: true, detail: `alpha==0 px composite exactly to all 4 backdrops (${transparent} samples)` };
}

// ---------- glow box test ----------

const ALPHA_ON = 16;      // "content present" threshold (0-255)
const EDGE_STEP = 60;     // alpha jump considered a hard edge
const LOW_ALPHA_MAX = 120; // inside-alpha below this = glow region, not solid content

interface AlphaInfo {
  w: number; h: number;
  alpha: Uint8Array;       // w*h
  minX: number; minY: number; maxX: number; maxY: number;
  count: number;
}

function alphaInfo(rgba: Buffer, w: number, h: number): AlphaInfo {
  const alpha = new Uint8Array(w * h);
  let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = rgba[(y * w + x) * 4 + 3]!;
      alpha[y * w + x] = a;
      if (a > ALPHA_ON) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { w, h, alpha, minX, minY, maxX, maxY, count };
}

/**
 * Detect a rectangular "box" edge: a long straight run (>=MIN_RUN px) where
 * alpha steps sharply (>=EDGE_STEP within 2px) while the inside alpha stays
 * in the glow range (<LOW_ALPHA_MAX) — i.e. a clipped semi-transparent halo,
 * not a solid element edge.
 */
function findBoxEdges(info: AlphaInfo): string[] {
  const { w, h, alpha } = info;
  const at = (x: number, y: number) => alpha[y * w + x]!;
  const findings: string[] = [];
  const MIN_RUN = 30;

  const scan = (horizontal: boolean) => {
    // For each line, walk it and record positions where a sharp low-alpha edge occurs.
    const lines = horizontal ? h : w;
    const len = horizontal ? w : h;
    for (let l = 0; l < lines; l++) {
      let runStart = -1;
      let runVal = -1;
      for (let i = 1; i < len; i++) {
        const a0 = horizontal ? at(i - 1, l) : at(l, i - 1);
        const a1 = horizontal ? at(i, l) : at(l, i);
        const a2 = horizontal ? at(Math.min(i + 1, len - 1), l) : at(l, Math.min(i + 1, len - 1));
        const inside = Math.max(a0, a1, a2);
        const outside = Math.min(a0, a1, a2);
        const step = Math.abs(a1 - a0) + Math.abs(a2 - a1);
        const lowEdge = step >= EDGE_STEP && inside > ALPHA_ON && inside < LOW_ALPHA_MAX && outside <= ALPHA_ON;
        const key = horizontal ? `y=${l}` : `x=${l}`;
        const pos = i;
        if (lowEdge) {
          if (runStart === -1) { runStart = pos; runVal = inside; }
        } else {
          if (runStart !== -1 && pos - runStart >= MIN_RUN) {
            // consecutive edge pixels on the SAME line = straight edge segment
            findings.push(`${horizontal ? 'h' : 'v'}-edge ${key} pos~${runStart} len=${pos - runStart} insideA=${runVal}`);
          }
          runStart = -1;
        }
      }
    }
  };
  // The run detection above is per-line; a true box edge repeats the same
  // position across MANY lines. Count edge positions per coordinate instead.
  const edgeAt = (horizontal: boolean): Map<number, number> => {
    const m = new Map<number, number>();
    const lines = horizontal ? h : w;
    const len = horizontal ? w : h;
    for (let l = 0; l < lines; l++) {
      for (let i = 1; i < len; i++) {
        const a0 = horizontal ? at(i - 1, l) : at(l, i - 1);
        const a1 = horizontal ? at(i, l) : at(l, i);
        const a2 = horizontal ? at(Math.min(i + 1, len - 1), l) : at(l, Math.min(i + 1, len - 1));
        const inside = Math.max(a0, a1, a2);
        const outside = Math.min(a0, a1, a2);
        const step = Math.abs(a1 - a0) + Math.abs(a2 - a1);
        if (step >= EDGE_STEP && inside > ALPHA_ON && inside < LOW_ALPHA_MAX && outside <= ALPHA_ON) {
          m.set(i, (m.get(i) ?? 0) + 1);
        }
      }
    }
    return m;
  };

  for (const [axis, m] of [['v', edgeAt(true)], ['h', edgeAt(false)]] as const) {
    for (const [pos, count] of m) {
      if (count >= MIN_RUN) findings.push(`${axis}-edge x/y=${pos} spans ${count} lines`);
    }
  }
  return findings;
}

function glowBoxCheck(file: string, w: number, h: number, times: number[]): { pass: boolean; detail: string } {
  const problems: string[] = [];
  for (const t of times) {
    const rgba = extractRgbaBuf(file, t);
    if (!rgba) { problems.push(`t=${t}: extraction failed`); continue; }
    const info = alphaInfo(rgba, w, h);
    if (info.count === 0) { problems.push(`t=${t}: empty alpha`); continue; }

    // 1) ring just outside the alpha bbox must be fully transparent
    const R = 3;
    let ringMax = 0;
    for (let y = Math.max(0, info.minY - R); y <= Math.min(h - 1, info.maxY + R); y++) {
      for (let x = Math.max(0, info.minX - R); x <= Math.min(w - 1, info.maxX + R); x++) {
        const inside = x >= info.minX && x <= info.maxX && y >= info.minY && y <= info.maxY;
        if (inside) continue;
        ringMax = Math.max(ringMax, info.alpha[y * w + x]!);
      }
    }
    if (ringMax > ALPHA_ON) problems.push(`t=${t}: alpha ${ringMax} in ${R}px ring outside bbox`);

    // 2) no rectangular low-alpha edge (box artifact)
    const edges = findBoxEdges(info);
    if (edges.length > 0) problems.push(`t=${t}: ${edges.slice(0, 3).join('; ')}`);

    // 3) falloff: along the horizontal centre line, after alpha drops below
    //    ALPHA_ON it must not reappear (no detached halo/second box)
    const cy = Math.floor((info.minY + info.maxY) / 2);
    let seenOff = false, reappear = 0;
    for (let x = info.minX; x <= info.maxX; x++) {
      const a = info.alpha[cy * w + x]!;
      if (a <= ALPHA_ON) seenOff = true;
      else if (seenOff) reappear++;
    }
    if (reappear > w * 0.02) problems.push(`t=${t}: alpha reappears after falloff (${reappear}px)`);
  }
  return { pass: problems.length === 0, detail: problems.length ? problems.join(' | ') : 'clean' };
}

// ---------- main ----------

interface CheckRow {
  fixture: string;
  check: string;
  pass: boolean;
  detail: string;
}

const rows: CheckRow[] = [];
const row = (fixture: string, check: string, pass: boolean, detail: string) =>
  rows.push({ fixture, check, pass, detail });

function main(): void {
  mkdirSync(TMP, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')) as { fixtures: ManifestEntry[] };
  const renderReport = existsSync(join(OUT, 'render-report.json'))
    ? (JSON.parse(readFileSync(join(OUT, 'render-report.json'), 'utf8')) as { results: RenderResult[] })
    : { results: [] as RenderResult[] };
  const renders = new Map(renderReport.results.map((r) => [r.name, r]));

  for (const f of manifest.fixtures) {
    const { width: w, height: h } = f.canvas;
    const r = renders.get(f.name);
    const mov = r?.mov?.ok ? r.mov.file : join(OUT, `${f.name}.mov`);
    const webm = r?.webm?.ok ? r.webm.file : join(OUT, `${f.name}.webm`);

    // --- ffprobe checks ---
    if (existsSync(mov)) {
      const vs = ffprobeStreams(mov).find((s) => s.codec_type === 'video');
      const pix = vs?.pix_fmt ?? 'MISSING';
      row(f.name, 'mov.pix_fmt', pix === 'yuva444p12le', `pix_fmt=${pix} codec=${vs?.codec_name} ${vs?.width}x${vs?.height}`);
    } else {
      row(f.name, 'mov.pix_fmt', false, 'mov missing');
    }
    if (existsSync(webm)) {
      const vs = ffprobeStreams(webm).find((s) => s.codec_type === 'video');
      const pix = vs?.pix_fmt ?? 'MISSING';
      // VP9 alpha is signalled via the alpha_mode=1 tag; ffprobe reports the
      // base pix_fmt as yuv420p even when alpha is present (Motion Lab README).
      const hasAlpha =
        /yuva|rgba|gbrap/.test(pix) ||
        vs?.tags?.alpha_mode === '1' ||
        JSON.stringify(vs?.side_data ?? []).includes('alpha');
      row(f.name, 'webm.alpha', hasAlpha, `pix_fmt=${pix} alpha_mode=${vs?.tags?.alpha_mode ?? '-'} codec=${vs?.codec_name}`);
    } else {
      row(f.name, 'webm.alpha', false, 'webm missing');
    }

    // --- transparency: composite alpha==0 px over 4 backdrops ---
    if (existsSync(mov)) {
      const t = Math.min(2, f.canvas.durationSec / 2);
      const res = transparencyCheck(mov, w, h, t);
      row(f.name, 'mov.transparent-pixels', res.pass, res.detail);
    }
    if (existsSync(webm)) {
      const t = Math.min(2, f.canvas.durationSec / 2);
      const res = transparencyCheck(webm, w, h, t);
      row(f.name, 'webm.transparent-pixels', res.pass, res.detail);
    }

    // --- glow box test (glow-torture + glow-sweep) on MOV and WebM ---
    if (f.component === 'glow-torture' || f.component === 'glow-sweep') {
      const times = [0.6, 1.4, 2.2, 3.0, 3.8].filter((t) => t < f.canvas.durationSec - 0.3);
      if (existsSync(mov)) {
        const res = glowBoxCheck(mov, w, h, times);
        row(f.name, 'mov.glow-box', res.pass, res.detail);
      }
      if (existsSync(webm)) {
        const res = glowBoxCheck(webm, w, h, times);
        row(f.name, 'webm.glow-box', res.pass, res.detail);
      }
    }

    // --- counter frames differ (number-counter, MOV master) ---
    if (f.component === 'number-counter' && existsSync(mov)) {
      const hashes = [1, 2, 3].map((t) => {
        const b = extractRgbaBuf(mov, t);
        return b ? sha(b) : 'FAIL';
      });
      const pass = hashes.every((x) => x !== 'FAIL') && new Set(hashes).size === 3;
      row(f.name, 'mov.counter-animates', pass, `md5@1s/2s/3s=${hashes.join(',')}`);
    }
  }

  // --- summary ---
  const fails = rows.filter((r) => !r.pass);
  const out = {
    generatedAt: new Date().toISOString(),
    total: rows.length,
    passed: rows.length - fails.length,
    failed: fails.length,
    rows,
    timings: renderReport.results.map((r) => ({
      name: r.name,
      movMs: r.mov?.ms, webmMs: r.webm?.ms, chromaMs: r.chroma?.ms, fullMs: r.full?.ms,
      movMB: r.mov ? +(r.mov.bytes / 1048576).toFixed(1) : null,
      webmMB: r.webm ? +(r.webm.bytes / 1048576).toFixed(1) : null,
    })),
  };
  writeFileSync(join(OUT, 'verify-report.json'), JSON.stringify(out, null, 2), 'utf8');

  for (const r of rows) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.fixture}  ${r.check}  — ${r.detail}`);
  console.log(`\n${out.passed}/${out.total} checks passed, ${fails.length} failed`);
  process.exit(fails.length > 0 ? 1 : 0);
}

main();
