import type { Background } from '../scene/schema.js';
import type { RenderContext } from './context.js';
import { round3 } from './context.js';
import { resolveStyleValue } from '../elements/style.js';
import { escCssString } from './escape.js';
import { selFor } from './render-elements.js';
import type { TweenCall } from './render-elements.js';

export interface RenderedBackground {
  html: string;
  tweens: TweenCall[];
  /** Extra <style> rules needed by the background (e.g. .bg-pan). */
  css: string;
}

/**
 * Background layer — always first inside #root, never a .clip.
 * previewOnly backgrounds are skipped unless target === 'preview' (A8).
 */
export function renderBackground(bg: Background, ctx: RenderContext): RenderedBackground {
  if (bg.kind === 'none') return { html: '', tweens: [], css: '' };
  if ('previewOnly' in bg && bg.previewOnly && ctx.target !== 'preview') {
    return { html: '', tweens: [], css: '' };
  }

  const missing = (path: string) =>
    ctx.warnings.push({ code: 'token-unresolved', severity: 'warning', message: `unresolved token '${path}' in background` });
  const sv = (v: Parameters<typeof resolveStyleValue>[0]) =>
    resolveStyleValue(v, { tokens: ctx.tokens, onMissing: missing });

  const base = 'position:absolute;inset:0';
  const tweens: TweenCall[] = [];
  const push = (time: number, code: string) => tweens.push({ time, id: '__bg', seq: tweens.length, code });

  switch (bg.kind) {
    case 'solid':
      return { html: `<div class="bg" style="${base};background:${sv(bg.color)}"></div>`, tweens, css: '' };

    case 'gradient': {
      const stops = [...bg.stops].sort((a, b) => a.offset - b.offset);
      const stopCss = stops.map((s) => `${sv(s.color)} ${round3(s.offset * 100)}%`).join(', ');
      const gradient =
        bg.type === 'radial'
          ? `radial-gradient(circle at center, ${stopCss})`
          : `linear-gradient(${bg.angle ?? 180}deg, ${stopCss})`;
      return { html: `<div class="bg" style="${base};background:${gradient}"></div>`, tweens, css: '' };
    }

    case 'image':
      return {
        html: `<div class="bg" style="${base};background-image:url('${escCssString(bg.asset)}');background-size:cover;background-position:center"></div>`,
        tweens,
        css: '',
      };

    case 'animated-gradient': {
      const dur = bg.durationSec ?? ctx.canvas.durationSec;
      if (bg.animate === 'cycle') {
        // Two counter-phase gradients cross-faded via opacity (A6/D7).
        const [c1, c2] = cycleColors(bg, sv);
        const half = round3(dur / 2);
        const idA = '__bgA';
        const idB = '__bgB';
        push(0, `tl.fromTo(${selFor(idA)},{opacity:1},{opacity:0,duration:${half},ease:"sine.inOut"},0);`);
        push(half, `tl.fromTo(${selFor(idB)},{opacity:0},{opacity:1,duration:${half},ease:"sine.inOut"},${half});`);
        return {
          html:
            `<div id="${idB}" class="bg" style="${base};background:linear-gradient(${bg.angle ?? 90}deg, ${c2} 0%, ${c1} 100%)"></div>` +
            `<div id="${idA}" class="bg" style="${base};background:linear-gradient(${bg.angle ?? 90}deg, ${c1} 0%, ${c2} 100%);opacity:1"></div>`,
          tweens,
          css: '',
        };
      }
      // 'pan': one oversized layer with repeating-linear-gradient moved by
      // xPercent/yPercent — transform-only (A6). Single drift, no loop seam.
      const stops = bg.stops ?? defaultStops(bg.colors);
      const angle = bg.angle ?? 90;
      const stopCss = [...stops]
        .sort((a, b) => a.offset - b.offset)
        .map((s) => `${sv(s.color)} ${round3(s.offset * 100)}%`)
        .join(', ');
      const axis = panAxis(angle);
      const pct = axis === 'x' ? 'xPercent' : 'yPercent';
      const id = '__bgPan';
      push(0, `tl.fromTo(${selFor(id)},{${pct}:0},{${pct}:-20,duration:${round3(dur)},ease:"none"},0);`);
      return {
        html:
          `<div id="${id}" class="bg bg-pan" style="${base};width:200%;height:200%;` +
          `left:-50%;top:-50%;right:auto;bottom:auto;` +
          `background:repeating-linear-gradient(${angle}deg, ${stopCss})"></div>`,
        tweens,
        css: '',
      };
    }
  }
}

function cycleColors(
  bg: Extract<Background, { kind: 'animated-gradient' }>,
  sv: (v: Parameters<typeof resolveStyleValue>[0]) => string
): [string, string] {
  if (bg.colors) return [sv(bg.colors[0]), sv(bg.colors[1])];
  const stops = bg.stops ?? [];
  const first = stops[0];
  const last = stops[stops.length - 1];
  return [first ? sv(first.color) : '#000', last ? sv(last.color) : '#fff'];
}

function defaultStops(colors: [Parameters<typeof resolveStyleValue>[0], Parameters<typeof resolveStyleValue>[0]] | undefined) {
  return [
    { color: colors?.[0] ?? '#000000', offset: 0 },
    { color: colors?.[1] ?? '#ffffff', offset: 1 }
  ];
}

/** Dominant pan axis from CSS gradient angle (0deg=to top, 90deg=to right). */
function panAxis(angle: number): 'x' | 'y' {
  const rad = (angle * Math.PI) / 180;
  return Math.abs(Math.sin(rad)) >= Math.abs(Math.cos(rad)) ? 'x' : 'y';
}

