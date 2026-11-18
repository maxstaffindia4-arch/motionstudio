import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { safeArea, unit, type CanvasSpec } from '@motion-studio/engine';
import type { StagedComposition } from './stage.js';

/**
 * Layout QA — canvas-agnostic DOM measurement port of Motion Lab
 * layout-qa.ts. Loads the compiled composition in headless Chromium,
 * seeks the paused GSAP timeline to several timestamps, and measures
 * bounding boxes. No 1920x1080 constants: viewport = canvas size,
 * safe area comes from the engine geometry.
 */

export type LayoutSeverity = 'error' | 'warning';

export interface LayoutIssue {
  code:
    | 'text-overflow'
    | 'outside-canvas'
    | 'outside-safe-area'
    | 'text-overlap'
    | 'font-too-small'
    | 'empty-frame';
  severity: LayoutSeverity;
  message: string;
  /** DOM id of the .clip element (engine element id). */
  elementId?: string;
  /** Timestamp (s) at which the issue was observed. */
  at?: number;
}

export interface LayoutQaResult {
  ok: boolean;
  issues: LayoutIssue[];
  /** Timestamps sampled (seconds). */
  sampledAt: number[];
}

export interface LayoutQaOptions {
  /** Max seconds per page operation before giving up on this sample. */
  timeoutMs?: number;
  /** Roles exempt from the font floor (id-prefix convention). */
  fontExemptRoles?: string[];
}

// ---------------------------------------------------------------------------
// shared browser pool — one Chromium instance reused across generations
// ---------------------------------------------------------------------------

let sharedBrowser: Promise<Browser> | undefined;

function getBrowser(): Promise<Browser> {
  if (!sharedBrowser) {
    sharedBrowser = chromium.launch({ headless: true }).catch((e) => {
      sharedBrowser = undefined;
      throw e;
    });
  }
  return sharedBrowser;
}

/** Close the pooled browser (call from tests / process shutdown). */
export async function closeLayoutBrowser(): Promise<void> {
  const b = sharedBrowser;
  sharedBrowser = undefined;
  if (b) {
    const browser = await b.catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// in-page measurement
// ---------------------------------------------------------------------------

interface DomBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  fontPx: number;
  text: string;
  scrollW: number;
  scrollH: number;
  clientW: number;
  clientH: number;
}

interface FrameSample {
  boxes: DomBox[];
  visibleCount: number;
}

const SAMPLE_FN = `(t, cfg) => {
  const tl = window.__timelines && window.__timelines['main'];
  if (tl && typeof tl.seek === 'function') tl.seek(t);
  const W = cfg.width, H = cfg.height;
  const safe = cfg.safe;
  const minFont = cfg.minFontPx;
  const exempt = cfg.exemptRoles;
  const issues = [];
  const clips = Array.from(document.querySelectorAll('.clip'));
  const leaf = clips.filter((el) => !el.querySelector('.clip'));
  const boxes = [];
  for (const el of leaf) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    const op = parseFloat(cs.opacity || '1');
    const box = {
      id: el.id || '',
      x: r.x, y: r.y, w: r.width, h: r.height,
      opacity: op,
      fontPx: parseFloat(cs.fontSize || '0'),
      text: (el.textContent || '').trim(),
      scrollW: el.scrollWidth, scrollH: el.scrollHeight,
      clientW: el.clientWidth, clientH: el.clientHeight,
    };
    if (box.w <= 0.5 || box.h <= 0.5 || op <= 0.01) continue;
    boxes.push(box);
    const hasText = box.text.length > 0;
    const isTextLeaf = hasText && box.fontPx > 0;
    if (!isTextLeaf) continue;
    const role = (box.id.split('-')[0] || '').toLowerCase();
    const fontExempt = exempt.includes(role);

    if (r.x < -0.5 || r.y < -0.5 || r.x + r.w > W + 0.5 || r.y + r.h > H + 0.5) {
      issues.push({ code: 'outside-canvas', severity: 'error',
        message: 'element extends outside the canvas', elementId: box.id, at: t });
    } else if (safe && (r.x < safe.x - 0.5 || r.y < safe.y - 0.5 ||
               r.x + r.w > safe.x + safe.w + 0.5 || r.y + r.h > safe.y + safe.h + 0.5)) {
      issues.push({ code: 'outside-safe-area', severity: 'warning',
        message: 'element extends outside the safe area', elementId: box.id, at: t });
    }
    // Horizontal overflow is strict; vertical gets tolerance — tight line-height
    // (e.g. lineHeight:1 icon glyphs) makes scrollHeight exceed clientHeight by
    // font metrics (~10%) without any visible clipping.
    const hOver = el.scrollWidth > el.clientWidth + 1;
    const vOver = el.scrollHeight > el.clientHeight + Math.max(8, el.clientHeight * 0.15);
    if (hOver || vOver) {
      issues.push({ code: 'text-overflow', severity: 'error',
        message: 'text overflows its container (scroll > client size)', elementId: box.id, at: t });
    } else {
      // clipped by an overflow:hidden/clip ancestor → visually cut off
      let p = el.parentElement;
      let clipped = false;
      while (p && p.id !== 'root' && !clipped) {
        const pcs = getComputedStyle(p);
        const ov = (pcs.overflow + ' ' + pcs.overflowX + ' ' + pcs.overflowY);
        if (/hidden|clip|scroll|auto/.test(ov)) {
          const pr = p.getBoundingClientRect();
          if (r.x < pr.x - 1 || r.y < pr.y - 1 ||
              r.x + r.w > pr.x + pr.width + 1 || r.y + r.h > pr.y + pr.height + 1) {
            clipped = true;
          }
        }
        p = p.parentElement;
      }
      if (clipped) {
        issues.push({ code: 'text-overflow', severity: 'error',
          message: 'text is clipped by an overflow-hidden ancestor', elementId: box.id, at: t });
      }
    }
    if (!fontExempt && box.fontPx < minFont) {
      issues.push({ code: 'font-too-small', severity: 'warning',
        message: 'font-size ' + box.fontPx.toFixed(1) + 'px below minimum ' + minFont.toFixed(1) + 'px',
        elementId: box.id, at: t });
    }
  }
  // overlap: leaf text blocks intersecting >10% of the smaller box
  const texts = boxes.filter((b) => b.text.length > 0 && b.fontPx > 0);
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const inter = ix * iy;
      if (inter <= 0) continue;
      const smaller = Math.min(a.w * a.h, b.w * b.h);
      if (smaller > 0 && inter / smaller > 0.10) {
        issues.push({ code: 'text-overlap', severity: 'warning',
          message: 'text blocks overlap by >10%', elementId: a.id + '×' + b.id, at: t });
      }
    }
  }
  return { issues, visibleCount: boxes.length, empty: boxes.length === 0 };
}`;

function sampleTimes(canvas: CanvasSpec): number[] {
  const d = canvas.durationSec;
  const candidates = [0, d * 0.2, d * 0.5, d * 0.8, Math.max(0, d - 0.05)];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const t of candidates) {
    const r = Math.round(t * 1000) / 1000;
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

/**
 * Run layout QA against a staged composition. Returns aggregated issues
 * (deduped by code+elementId, keeping the first timestamp seen).
 */
export async function layoutQA(
  staged: StagedComposition,
  canvas: CanvasSpec,
  opts: LayoutQaOptions = {}
): Promise<LayoutQaResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const browser = await getBrowser();
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  try {
    context = await browser.newContext({
      viewport: { width: canvas.width, height: canvas.height },
      deviceScaleFactor: 1,
    });
    page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    await page.goto(pathToFileURL(join(staged.dir, 'index.html')).href, {
      waitUntil: 'load',
      timeout: timeoutMs,
    });
    // fonts/layout settle
    await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());

    const u = unit(canvas);
    const safe = safeArea(canvas);
    const cfg = {
      width: canvas.width,
      height: canvas.height,
      safe: { x: safe.x, y: safe.y, w: safe.width, h: safe.height },
      minFontPx: 40 * u,
      exemptRoles: opts.fontExemptRoles ?? ['caption', 'label', 'footnote'],
    };

    const times = sampleTimes(canvas);
    const issues: LayoutIssue[] = [];
    const seen = new Set<string>();
    let emptySamples = 0;
    for (const t of times) {
      const sample = (await page.evaluate(
        `(${SAMPLE_FN})(${JSON.stringify(t)}, ${JSON.stringify(cfg)})`
      )) as { issues: LayoutIssue[]; visibleCount: number; empty: boolean };
      if (sample.empty) emptySamples++;
      for (const issue of sample.issues) {
        const key = `${issue.code}|${issue.elementId ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push(issue);
      }
    }
    // Empty frames are normal during intro/outro — only fail when the scene
    // is empty at (nearly) every sampled timestamp.
    if (emptySamples === times.length) {
      issues.push({
        code: 'empty-frame',
        severity: 'error',
        message: `no visible elements at any of ${times.length} sampled timestamps`,
      });
    } else if (emptySamples > times.length / 2) {
      issues.push({
        code: 'empty-frame',
        severity: 'warning',
        message: `${emptySamples}/${times.length} sampled timestamps have no visible elements`,
      });
    }
    return {
      ok: !issues.some((i) => i.severity === 'error'),
      issues,
      sampledAt: times,
    };
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
  }
}
