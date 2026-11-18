#!/usr/bin/env tsx
/**
 * Phase 0 spike: verify rendered outputs without manual eyeballing.
 *
 * Checks per fixture:
 *  - ffprobe: MOV master pix_fmt is yuva444p12le; WebM reports alpha (yuva420p)
 *  - transparency: alpha==0 pixels composite to EXACTLY the backdrop colour
 *    (red/black/white/green) — done in Node on ffmpeg-extracted RGBA
 *  - GLOW BOX TEST (glow-torture/glow-sweep + negative controls, MOV + WebM):
 *    PRIMARY check is minExt — glow must extend past the solid content core.
 *    Also ringMax (alpha outside content bbox) and faintHits (low-alpha
 *    rectangular plate edges). edgeHits is informational only.
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
interface NegativeEntry {
  name: string;
  mode: 'full' | 'mp4-native';
  canvas: ManifestEntry['canvas'];
  expectFail: string[];
}
interface ComparisonEntry {
  name: string;
  dir: string;
  mode: 'webm-native';
  canvas: ManifestEntry['canvas'];
  compareTo: string;
}
interface Manifest {
  fixtures: ManifestEntry[];
  negatives?: NegativeEntry[];
  comparisons?: ComparisonEntry[];
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
  const args = ['-y'];
  // This ffmpeg build's native vp9 decoder drops the alpha side-channel;
  // the libvpx-vp9 decoder preserves it (verified in the spike).
  if (file.toLowerCase().endsWith('.webm')) args.push('-c:v', 'libvpx-vp9');
  args.push('-ss', String(tSec), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-');
  const res = spawnSync(FFMPEG, args, {
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
const FAINT_STEP = 8;     // min alpha jump for a faint (low-alpha) rectangular edge
const FAINT_IN_MIN = 8;   // inside alpha must exceed this to count as a plate
const FAINT_OUT = 6;      // outside-side alpha ceiling (must be ~transparent)

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

  // A true box edge repeats the same position across MANY lines: count edge
  // positions per coordinate. `horizontal` scans rows (detects vertical edges).
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

/**
 * Faint-box variant of findBoxEdges: catches a long straight edge where the
 * inside alpha is low (<LOW_ALPHA_MAX) but well above transparent and the
 * outside is ~0. A low-alpha rectangular plate merges into the content mask
 * so minExt looks clean — this scan is what catches it.
 */
function findFaintEdges(info: AlphaInfo): string[] {
  const { w, h, alpha } = info;
  const at = (x: number, y: number) => alpha[y * w + x]!;
  const findings: string[] = [];
  // Faint plates are large: observed bad edges span 500-1200 lines, while
  // legit glow/card boundaries top out ~87 — 150 separates them cleanly.
  const MIN_RUN = 150;

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
        if (step >= FAINT_STEP && inside > FAINT_IN_MIN && inside < LOW_ALPHA_MAX && outside <= FAINT_OUT) {
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

interface Component {
  minX: number; minY: number; maxX: number; maxY: number;
  pixels: number[];
}

/** 4-connected components of the alpha>ALPHA_ON mask (BFS). */
function componentsOf(info: AlphaInfo): Component[] {
  const { w, h, alpha } = info;
  const seen = new Uint8Array(w * h);
  const out: Component[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || alpha[s]! <= ALPHA_ON) continue;
    const pixels: number[] = [];
    let minX = w, minY = h, maxX = -1, maxY = -1;
    stack.push(s);
    seen[s] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      pixels.push(i);
      const x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      // 4-neighbours
      if (x > 0 && !seen[i - 1] && alpha[i - 1]! > ALPHA_ON) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && !seen[i + 1] && alpha[i + 1]! > ALPHA_ON) { seen[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && !seen[i - w] && alpha[i - w]! > ALPHA_ON) { seen[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && !seen[i + w] && alpha[i + w]! > ALPHA_ON) { seen[i + w] = 1; stack.push(i + w); }
    }
    out.push({ minX, minY, maxX, maxY, pixels });
  }
  return out;
}

interface GlowMetrics {
  /** Smallest glow-skirt extension (px) across all components/times. */
  minExt: number | null;
  /** Largest alpha found in the ring outside the content bbox. */
  maxRing: number;
  /** Total straight-edge hits across all times (informational only). */
  edgeHits: number;
  /** Total faint-edge hits across all times (low-alpha plate detector). */
  faintHits: number;
}

function glowBoxCheck(
  file: string, w: number, h: number, times: number[]
): { pass: boolean; detail: string; metrics: GlowMetrics } {
  const problems: string[] = [];
  const metrics: GlowMetrics = { minExt: null, maxRing: 0, edgeHits: 0, faintHits: 0 };
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
    metrics.maxRing = Math.max(metrics.maxRing, ringMax);
    if (ringMax > ALPHA_ON) problems.push(`t=${t}: alpha ${ringMax} in ${R}px ring outside bbox`);

    // 2) edgeHits is INFORMATIONAL ONLY — no longer gates pass/fail.
    //    minExt (check 3) is the primary glow-box check.
    const edges = findBoxEdges(info);
    metrics.edgeHits += edges.length;

    // 2b) faint rectangular plate: low-alpha hard edge is a box artifact even
    //     when the plate merges into the content mask (minExt can't see it).
    const faint = findFaintEdges(info);
    metrics.faintHits += faint.length;
    if (faint.length > 0) problems.push(`t=${t}: faint-edge ${faint.slice(0, 3).join('; ')}`);

    // 3) Glow must extend BEYOND the solid content, per connected component:
    //    bbox(alpha>16) vs bbox(alpha>200). If a glow were clipped at the
    //    element/mask bounds the two boxes would coincide — the box artifact.
    for (const comp of componentsOf(info)) {
      let sMinX = w, sMinY = h, sMaxX = -1, sMaxY = -1, solid = 0;
      for (const i of comp.pixels) {
        if (info.alpha[i]! > 200) {
          solid++;
          const x = i % w, y = (i / w) | 0;
          if (x < sMinX) sMinX = x;
          if (x > sMaxX) sMaxX = x;
          if (y < sMinY) sMinY = y;
          if (y > sMaxY) sMaxY = y;
        }
      }
      if (solid === 0) continue; // no solid core — can't assess glow skirt
      // skirt = how far the solid core sits INSIDE the glow bbox (>=0).
      const ext = Math.min(
        sMinX - comp.minX, comp.maxX - sMaxX,
        sMinY - comp.minY, comp.maxY - sMaxY
      );
      metrics.minExt = metrics.minExt === null ? ext : Math.min(metrics.minExt, ext);
      if (ext < 6) {
        problems.push(`t=${t}: comp@(${comp.minX},${comp.minY}) glow does not extend past solid content (ext=${ext}px)`);
      }
    }
  }
  const m =
    `minExt=${metrics.minExt ?? 'n/a'}px ringMax=${metrics.maxRing} edgeHits=${metrics.edgeHits} faintHits=${metrics.faintHits}`;
  return {
    pass: problems.length === 0,
    detail: problems.length ? `${problems.join(' | ')} [${m}]` : `clean (${m})`,
    metrics,
  };
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
  const manifest = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')) as Manifest;
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
      const tags = (vs?.tags ?? {}) as Record<string, string>;
      const alphaMode = tags.alpha_mode ?? tags.ALPHA_MODE;
      const hasAlpha =
        /yuva|rgba|gbrap/.test(pix) ||
        alphaMode === '1' ||
        JSON.stringify(vs?.side_data ?? []).includes('alpha');
      row(f.name, 'webm.alpha', hasAlpha, `pix_fmt=${pix} alpha_mode=${alphaMode ?? '-'} codec=${vs?.codec_name}`);
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

  // --- negative controls: detector MUST fail on deliberately broken output ---
  const controls: Array<{ name: string; check: string; expected: string; actualPass: boolean | null; ok: boolean; detail: string }> = [];
  for (const neg of manifest.negatives ?? []) {
    const { width: w, height: h } = neg.canvas;
    const times = [0.6, 1.4, 2.2, 3.0, 3.8].filter((t) => t < neg.canvas.durationSec - 0.3);
    for (const expect of neg.expectFail) {
      const dot = expect.indexOf('.');
      const stage = expect.slice(0, dot);
      const check = expect.slice(dot + 1);
      const file = join(OUT, `${neg.name}.${stage}`);
      let res: { pass: boolean; detail: string } | null = null;
      if (existsSync(file)) {
        if (check === 'glow-box') res = glowBoxCheck(file, w, h, times);
        else if (check === 'transparent-pixels') res = transparencyCheck(file, w, h, Math.min(2, neg.canvas.durationSec / 2));
      }
      const actualPass = res?.pass ?? null;
      // Control is valid only if the check FAILS (or output is missing).
      const ok = actualPass === false || res === null;
      const detail = res?.detail ?? 'output missing';
      controls.push({ name: neg.name, check: expect, expected: 'fail', actualPass, ok, detail });
      row(`neg:${neg.name}`, `${check} (expect-fail)`, ok, detail);
    }
  }

  // --- informational comparisons: native WebM vs MOV-derived WebM ---
  // NOT pass/fail — reported for information only; pipeline unchanged.
  const compRenders = (renderReport as { comparisons?: Array<{ name: string; compareTo: string; file: string; bytes: number; ok: boolean }> }).comparisons ?? [];
  const comparisons: Array<Record<string, unknown>> = [];
  for (const c of manifest.comparisons ?? []) {
    const rr = compRenders.find((x) => x.name === c.name);
    const nativeFile = rr?.file ?? join(OUT, `${c.name}.webm`);
    const derivedFile = join(OUT, `${c.compareTo}.webm`);
    const { width: w, height: h } = c.canvas;
    const t = Math.min(2, c.canvas.durationSec / 2);
    const nvs = existsSync(nativeFile) ? ffprobeStreams(nativeFile).find((s) => s.codec_type === 'video') : undefined;
    const npix = nvs?.pix_fmt ?? 'MISSING';
    const nTags = (nvs?.tags ?? {}) as Record<string, string>;
    const nAlphaMode = nTags.alpha_mode ?? nTags.ALPHA_MODE;
    const nAlpha =
      /yuva|rgba|gbrap/.test(npix) ||
      nAlphaMode === '1' ||
      JSON.stringify(nvs?.side_data ?? []).includes('alpha');
    const nClean = existsSync(nativeFile) ? transparencyCheck(nativeFile, w, h, t) : null;
    const dClean = existsSync(derivedFile) ? transparencyCheck(derivedFile, w, h, t) : null;
    comparisons.push({
      name: c.name,
      compareTo: c.compareTo,
      nativeWebm: {
        file: nativeFile,
        bytes: rr?.bytes ?? null,
        ok: rr?.ok ?? false,
        pixFmt: npix,
        alphaMode: nAlphaMode ?? null,
        hasAlpha: nAlpha,
        transparentPixels: nClean?.pass ?? null,
        transparentDetail: nClean?.detail ?? 'missing',
      },
      derivedWebm: {
        file: derivedFile,
        bytes: renders.get(c.compareTo)?.webm?.bytes ?? null,
        transparentPixels: dClean?.pass ?? null,
        transparentDetail: dClean?.detail ?? 'missing',
      },
    });
    console.log(
      `INFO  compare ${c.name}: native alpha=${nAlpha} transparent=${nClean?.pass ?? 'n/a'} (${((rr?.bytes ?? 0) / 1048576).toFixed(1)} MB)` +
      ` vs derived transparent=${dClean?.pass ?? 'n/a'} (${(((renders.get(c.compareTo)?.webm?.bytes ?? 0)) / 1048576).toFixed(1)} MB)`
    );
  }

  // --- summary ---
  const fails = rows.filter((r) => !r.pass);
  const out = {
    generatedAt: new Date().toISOString(),
    total: rows.length,
    passed: rows.length - fails.length,
    failed: fails.length,
    rows,
    negativeControls: controls,
    comparisons,
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
