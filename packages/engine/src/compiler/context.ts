import type { CanvasSpec } from '../canvas/schema.js';
import type { Rect } from '../canvas/geometry.js';
import type { StyleTokens } from '../scene/tokens.js';
import type { CompileTarget, CompileWarning } from './types.js';
import type { MotionContext } from '../elements/animation.js';

export interface RenderContext {
  canvas: CanvasSpec;
  tokens: StyleTokens;
  unit: number;
  /** Safe-area rect in px. */
  safe: Rect;
  /** Safe-area inset per side in px. */
  inset: { x: number; y: number };
  target: CompileTarget;
  warnings: CompileWarning[];
  motion: MotionContext;
}

export function px(ctx: RenderContext, v: number | string): string;
export function px(ctx: RenderContext, v: number | string | undefined): string | undefined;
export function px(ctx: RenderContext, v: number | string | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'string') return v;
  return `${round3(v * ctx.unit)}px`;
}

/** Numeric px value scaled by unit (for glow radii, offsets in computations). */
export function pxNum(ctx: RenderContext, v: number): number {
  return v * ctx.unit;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function fmtTime(n: number): string {
  const r = round3(n);
  return Number.isInteger(r) ? String(r) : String(r);
}
