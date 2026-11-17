import type { Element } from '../elements/schema.js';
import { isFlowPlacement } from '../elements/schema.js';
import { entrancePlan, exitPlan, round3, type MotionContext, type TweenValues } from '../elements/animation.js';
import { resolveStyleValue } from '../elements/style.js';
import { anchorFlex, safeInset } from '../canvas/geometry.js';
import type { RenderContext } from './context.js';
import { px, pxNum } from './context.js';
import { escAttr, escText, fontFamilyCss } from './escape.js';

export interface TweenCall {
  time: number;
  id: string;
  seq: number;
  code: string;
}

export interface RenderState {
  seq: number;
  counterVars: number;
  preludes: string[];
}

export interface Rendered {
  html: string;
  tweens: TweenCall[];
  preludes: string[];
}

const MIN_GAP = 24; // unit-relative minimum; emitted px = gap * unit

export function newRenderState(): RenderState {
  return { seq: 0, counterVars: 0, preludes: [] };
}

export function renderElements(
  elements: Element[],
  ctx: RenderContext,
  state: RenderState
): Rendered {
  const out: Rendered = { html: '', tweens: [], preludes: state.preludes };
  for (const el of elements) {
    const r = renderElement(el, ctx, state);
    out.html += r.html;
    out.tweens.push(...r.tweens);
  }
  return out;
}

function renderElement(el: Element, ctx: RenderContext, state: RenderState): Rendered {
  const inner = renderInner(el, ctx, state);
  const clip = clipOpen(el, ctx) + inner.html + '</div>';
  const tweens = [...inner.tweens, ...elementTweens(el, ctx, state)];

  if (isFlowPlacement(el.placement)) {
    return { html: clip, tweens, preludes: [] };
  }
  // Anchored: flex wrapper inset to the safe area (A1) — never absolute left/top.
  const f = anchorFlex(el.placement.anchor);
  const i = safeInset(ctx.canvas);
  const o = el.placement.offset;
  const wrap =
    `<div class="anchor" style="top:${round3(i.y)}px;left:${round3(i.x)}px;` +
    `right:${round3(i.x)}px;bottom:${round3(i.y)}px;display:flex;` +
    `justify-content:${f.justify};align-items:${f.align};` +
    `transform:translate(${round3(o.x)}px,${round3(o.y)}px)">` +
    clip +
    '</div>';
  return { html: wrap, tweens, preludes: [] };
}

function clipOpen(el: Element, ctx: RenderContext): string {
  return (
    `<div id="${escAttr(el.id)}" class="clip" data-start="${fmt(el.start)}" ` +
    `data-duration="${fmt(el.duration)}" style="${escAttr(declsFor(el, ctx))}">`
  );
}

function renderInner(el: Element, ctx: RenderContext, state: RenderState): Rendered {
  const out: Rendered = { html: '', tweens: [], preludes: [] };
  const wipe = el.animation.in?.preset === 'wipe';
  const glowPad = descendantGlowRadius(el, ctx);
  const open = wipe
    ? `<div class="wipe-clip" style="overflow:hidden;padding:${round3(glowPad)}px">` +
      `<div id="${escAttr(el.id)}__wipe" class="wipe-inner">`
    : '';
  const close = wipe ? '</div></div>' : '';

  switch (el.type) {
    case 'text': {
      const strike = el.animation.in?.preset === 'strike';
      out.html =
        open +
        (strike
          ? `<span class="strike-host" style="position:relative;display:inline-block">${escText(el.content)}` +
            `<i id="${escAttr(el.id)}__strike" class="strike-line" aria-hidden="true"></i></span>`
          : escText(el.content)) +
        close;
      break;
    }
    case 'shape': {
      out.html = open + close;
      break;
    }
    case 'image': {
      out.html =
        open +
        `<img src="${escAttr(el.asset)}" alt="" style="display:block;width:100%;height:100%;object-fit:${el.style.fit ?? 'cover'}" />` +
        close;
      break;
    }
    case 'stack': {
      const kids = renderElements(el.children, ctx, state);
      out.html = open + kids.html + close;
      out.tweens.push(...kids.tweens);
      break;
    }
  }
  return out;
}

/** Inline style declarations for the clip element (values already resolved). */
function declsFor(el: Element, ctx: RenderContext): string {
  const d: string[] = [];
  const missing = (path: string) =>
    ctx.warnings.push({
      code: 'token-unresolved',
      severity: 'warning',
      message: `unresolved token '${path}'`,
      elementId: el.id,
    });
  const sv = (v: Parameters<typeof resolveStyleValue>[0]) =>
    resolveStyleValue(v, { tokens: ctx.tokens, onMissing: missing });
  const num = (v: number | string | undefined) => px(ctx, v);

  if ('opacity' in el.style && el.style.opacity !== undefined) {
    d.push(`opacity:${el.style.opacity}`);
  }

  if (el.type === 'text') {
    const s = el.style;
    const ff = s.fontFamily ?? ctx.tokens.fonts.display;
    d.push('font-family:' + fontFamilyCss(Array.isArray(ff) ? ff : [ff]));
    d.push(`font-size:${num(s.fontSize ?? 64)}`);
    if (s.fontWeight !== undefined) d.push(`font-weight:${s.fontWeight}`);
    d.push(`color:${s.color !== undefined ? sv(s.color) : ctx.tokens.colors.text}`);
    if (s.textTransform && s.textTransform !== 'none') d.push(`text-transform:${s.textTransform}`);
    if (s.align) d.push(`text-align:${s.align}`);
    if (s.lineHeight !== undefined) d.push(`line-height:${s.lineHeight}`);
    if (s.letterSpacing !== undefined)
      d.push(
        `letter-spacing:${typeof s.letterSpacing === 'number' ? `${round3(s.letterSpacing * ctx.unit)}px` : s.letterSpacing}`
      );
    const shadows: string[] = [ctx.tokens.shadows.text ?? 'none'];
    if (s.shadow) shadows.push(s.shadow);
    if (s.glow) {
      const blur = pxNum(ctx, s.glow.blur ?? (parseFloat(ctx.tokens.glow.blur) || 35));
      const color = s.glow.color !== undefined ? sv(s.glow.color) : ctx.tokens.glow.color;
      shadows.push(`0 0 ${round3(blur)}px ${color}`);
    }
    d.push(`text-shadow:${shadows.join(', ')}`);
    if (s.background !== undefined) d.push(`background:${sv(s.background)}`);
    if (s.borderRadius !== undefined) d.push(`border-radius:${num(s.borderRadius)}`);
    if (s.padding !== undefined) d.push(`padding:${num(s.padding)}`);
  }

  if (el.type === 'shape') {
    const s = el.style;
    const isLine = el.shape === 'line';
    d.push(`width:${num(s.width ?? (isLine ? 400 : 200))}`);
    d.push(`height:${num(s.height ?? (isLine ? 6 : 120))}`);
    d.push(`background:${s.color !== undefined ? sv(s.color) : ctx.tokens.colors.primary}`);
    if (el.shape === 'pill') d.push('border-radius:50%');
    else if (s.radius !== undefined) d.push(`border-radius:${num(s.radius)}`);
    else d.push(`border-radius:${round3(12 * ctx.unit)}px`);
    if (s.rotation) d.push(`transform:rotate(${s.rotation}deg)`);
  }

  if (el.type === 'image') {
    const s = el.style;
    d.push(`width:${num(s.width ?? 320)}`);
    d.push(`height:${num(s.height ?? 180)}`);
    d.push('overflow:hidden');
  }

  if (el.type === 'stack') {
    const s = el.style;
    if (el.direction === 'grid') {
      const cols = el.columns ?? Math.min(el.children.length, 4);
      d.push('display:grid');
      d.push(`grid-template-columns:repeat(${cols},1fr)`);
    } else {
      d.push('display:flex');
      d.push(`flex-direction:${el.direction}`);
      if (el.wrap) d.push('flex-wrap:wrap');
    }
    d.push(`gap:${round3(Math.max(el.gap, MIN_GAP) * ctx.unit)}px`);
    const alignMap = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' } as const;
    const justifyMap = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around' } as const;
    if (el.align) d.push(`align-items:${alignMap[el.align]}`);
    if (el.justify) d.push(`justify-content:${justifyMap[el.justify]}`);
    if (s.borderColor !== undefined && s.borderWidth !== undefined && s.borderWidth > 0) {
      const bcMissing = (path: string) =>
        ctx.warnings.push({ code: 'token-unresolved', severity: 'warning', message: `unresolved token '${path}'`, elementId: el.id });
      d.push(`border:${round3(s.borderWidth * ctx.unit)}px solid ${resolveStyleValue(s.borderColor, { tokens: ctx.tokens, onMissing: bcMissing })}`);
    }
    if (s.background !== undefined) d.push(`background:${sv(s.background)}`);
    if (s.borderRadius !== undefined) d.push(`border-radius:${num(s.borderRadius)}`);
    const gp = s.overflow === 'hidden' ? descendantGlowRadius(el, ctx) : 0;
    if (s.padding !== undefined) {
      if (typeof s.padding === 'number') {
        d.push(`padding:${round3(s.padding * ctx.unit + gp)}px`);
      } else {
        if (gp > 0) {
          ctx.warnings.push({
            code: 'glow-padding-skipped',
            severity: 'warning',
            message: `stack '${el.id}' has non-px padding; glow padding not applied`,
            elementId: el.id,
          });
        }
        d.push(`padding:${s.padding}`);
      }
    } else if (gp > 0) {
      d.push(`padding:${round3(gp)}px`);
    }
    if (s.overflow === 'hidden') d.push('overflow:hidden');
  }
  return d.join(';');
}

/** Max glow blur (px) in an element's subtree — pads overflow:hidden masks (A7). */
export function descendantGlowRadius(el: Element, ctx: RenderContext): number {
  let max = 0;
  const visit = (e: Element): void => {
    if (e.type === 'text' && e.style.glow) {
      const blur = e.style.glow.blur ?? (parseFloat(ctx.tokens.glow.blur) || 35);
      max = Math.max(max, pxNum(ctx, blur));
    }
    if (e.type === 'stack') e.children.forEach(visit);
  };
  visit(el);
  return round3(max);
}

/** GSAP calls for one element's entrance/exit animations. */
function elementTweens(el: Element, ctx: RenderContext, state: RenderState): TweenCall[] {
  const out: TweenCall[] = [];
  const push = (time: number, code: string) =>
    out.push({ time, id: el.id, seq: state.seq++, code });
  const sel = selFor(el.id);
  const motion: MotionContext = ctx.motion;
  const inPlan = entrancePlan(el.animation.in, motion);
  const abs = (t: number) => round3(el.start + t);

  switch (inPlan.kind) {
    case 'tween':
      push(abs(inPlan.at), tweenCall(sel, inPlan.from, inPlan.to, inPlan.duration, inPlan.ease, abs(inPlan.at)));
      break;
    case 'wipe':
      push(abs(inPlan.at), tweenCall(selFor(`${el.id}__wipe`), inPlan.from, inPlan.to, inPlan.duration, inPlan.ease, abs(inPlan.at)));
      break;
    case 'counter': {
      push(abs(inPlan.at), tweenCall(sel, inPlan.from, inPlan.to, inPlan.duration, inPlan.ease, abs(inPlan.at)));
      const target = el.type === 'text' ? parseFloat(el.content.replace(/,/g, '')) : NaN;
      if (Number.isFinite(target)) {
        const v = `__c${state.counterVars++}`;
        state.preludes.push(`const ${v} = { v: 0 };`);
        const factor = ctx.motion.motion === 'punchy' ? 0.8 : ctx.motion.motion === 'subtle' ? 1.25 : 1;
        const dur = el.animation.in?.duration ?? round3(1.6 * factor);
        const at = abs(inPlan.at + inPlan.duration * 0.4);
        push(at, counterCall(v, el.id, target, dur, at));
      } else {
        ctx.warnings.push({
          code: 'counter-non-numeric',
          severity: 'warning',
          message: `counter preset on element '${el.id}' has non-numeric content`,
          elementId: el.id,
        });
      }
      break;
    }
    case 'strike':
      if (el.type === 'text') {
        push(abs(inPlan.at), tweenCall(sel, { opacity: 0, y: 20 }, { opacity: 1, y: 0 }, 0.35, ctx.tokens.easings.arrival, abs(inPlan.at)));
        const strikeAt = abs(inPlan.strikeAt ?? inPlan.at + 0.6);
        const strikeDur = inPlan.strikeDuration ?? 0.35;
        push(strikeAt, `tl.fromTo(${selFor(`${el.id}__strike`)},{scaleX:0},{scaleX:1,transformOrigin:"0% 50%",duration:${strikeDur},ease:"${inPlan.ease}"},${strikeAt});`);
        if (inPlan.dimAfter) {
          const dimAt = round3(strikeAt + strikeDur);
          push(dimAt, `tl.to(${sel},{opacity:0.6,duration:0.2,ease:"power1.out"},${dimAt});`);
        }
      }
      break;
    case 'none':
      break;
  }

  const outPlan = exitPlan(el.animation.out, inPlan.duration, motion);
  if (outPlan) {
    const at = round3(el.start + el.duration - outPlan.duration);
    push(at, tweenCall(sel, outPlan.from, outPlan.to, outPlan.duration, outPlan.ease, at));
  }
  return out;
}

function counterCall(varName: string, id: string, target: number, duration: number, at: number): string {
  const safeId = id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return (
    `tl.to(${varName},{v:${target},duration:${duration},ease:"power2.out",` +
    `onUpdate:function(){var e=document.getElementById("${safeId}");` +
    `if(e)e.textContent=Math.round(this.v).toLocaleString();}},${at});`
  );
}

function tweenCall(
  sel: string,
  from: TweenValues,
  to: TweenValues,
  duration: number,
  ease: string,
  at: number
): string {
  const toObj: Record<string, unknown> = { ...to, duration, ease };
  return `tl.fromTo(${sel},${JSON.stringify(from)},${JSON.stringify(toObj)},${at});`;
}

export function selFor(id: string): string {
  const css = id.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `'[id="${css}"]'`;
}

function fmt(n: number): string {
  return String(round3(n));
}
