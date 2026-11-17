import type { AnimationSpec } from './schema.js';
import type { Easings } from '../scene/tokens.js';
import type { MotionIntensity } from '../scene/tokens.js';

/**
 * Maps AnimationSpec presets to GSAP from/to descriptors.
 * Easing is chosen BY ROLE (arrival/exit/pop) unless overridden;
 * only opacity, x, y, scale, rotation, xPercent, yPercent are ever emitted.
 */

export interface TweenValues {
  opacity?: number;
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  xPercent?: number;
  yPercent?: number;
}

export interface EntrancePlan {
  kind: 'tween' | 'wipe' | 'counter' | 'strike' | 'none';
  from: TweenValues;
  to: TweenValues;
  duration: number;
  ease: string;
  /** Seconds after element start. */
  at: number;
  /** strike: when the line starts (absolute within element). */
  strikeAt?: number;
  strikeDuration?: number;
  dimAfter?: boolean;
}

export interface ExitPlan {
  from: TweenValues;
  to: TweenValues;
  duration: number;
  ease: string;
  at: number;
}

export interface MotionContext {
  easings: Easings;
  motion: MotionIntensity;
  /** min(width,height)/1080 — distances are spec'd at unit=1 and scaled by this. */
  unit: number;
}

const INTENSITY_FACTOR: Record<MotionIntensity, number> = {
  subtle: 1.25,
  standard: 1,
  punchy: 0.8
};

function d(base: number, ctx: MotionContext, override?: number): number {
  return override ?? round3(base * INTENSITY_FACTOR[ctx.motion]);
}

export function entrancePlan(spec: AnimationSpec | undefined, ctx: MotionContext): EntrancePlan {
  const at = spec?.delay ?? 0;
  if (!spec) {
    return { kind: 'none', from: {}, to: {}, duration: 0, ease: '', at: 0 };
  }
  const role = spec.role ?? 'arrival';
  const ease = spec.easing ?? (role === 'exit' ? ctx.easings.exit : spec.preset === 'pop' ? ctx.easings.pop : ctx.easings.arrival);
  const dist = (spec.distance ?? 60) * ctx.unit;

  switch (spec.preset) {
    case 'slam':
      return {
        kind: 'tween',
        from: { opacity: 0, scale: 1.8, y: -dist * 0.6 },
        to: { opacity: 1, scale: 1, y: 0 },
        duration: d(0.38, ctx, spec.duration),
        ease,
        at
      };
    case 'pop':
      return {
        kind: 'tween',
        from: { opacity: 0, scale: 0.5 },
        to: { opacity: 1, scale: 1 },
        duration: d(0.5, ctx, spec.duration),
        ease: spec.easing ?? ctx.easings.pop,
        at
      };
    case 'slide': {
      const dir = slideVector(spec, ctx.unit);
      return {
        kind: 'tween',
        from: { opacity: 0, x: dir.x, y: dir.y },
        to: { opacity: 1, x: 0, y: 0 },
        duration: d(0.45, ctx, spec.duration),
        ease,
        at
      };
    }
    case 'fade-scale':
      return {
        kind: 'tween',
        from: { opacity: 0, scale: 0.92 },
        to: { opacity: 1, scale: 1 },
        duration: d(0.45, ctx, spec.duration),
        ease,
        at
      };
    case 'wipe':
      return {
        kind: 'wipe',
        from: { opacity: 0, xPercent: -100 },
        to: { opacity: 1, xPercent: 0 },
        duration: d(0.5, ctx, spec.duration),
        ease,
        at
      };
    case 'counter':
      return {
        kind: 'counter',
        from: { opacity: 0, scale: 0.9 },
        to: { opacity: 1, scale: 1 },
        duration: d(0.4, ctx, spec.duration),
        ease,
        at
      };
    case 'whip': {
      // Pass-through sweep: travels the full distance so the element exits
      // frame (whip-transition bars, glow streaks). direction 'left' mirrors.
      const mirrored = spec.direction === 'left';
      const from = mirrored ? dist : -dist;
      const to = mirrored ? -dist : dist;
      return {
        kind: 'tween',
        from: { x: from },
        to: { x: to },
        duration: d(0.9, ctx, spec.duration),
        ease: spec.easing ?? 'expo.inOut',
        at
      };
    }
    case 'strike':
      return {
        kind: 'strike',
        from: {},
        to: {},
        duration: 0,
        ease: ctx.easings.strike ?? 'power2.out',
        at,
        strikeAt: at + (spec.duration ?? 0.6),
        strikeDuration: d(0.35, ctx),
        dimAfter: spec.dimAfter ?? true
      };
  }
}

function slideVector(spec: AnimationSpec, unit: number): { x: number; y: number } {
  const dist = (spec.distance ?? 60) * unit;
  switch (spec.direction) {
    case 'down':
      return { x: 0, y: -dist };
    case 'left':
      return { x: dist, y: 0 };
    case 'right':
      return { x: -dist, y: 0 };
    default:
      return { x: 0, y: dist }; // 'up' default: element rises into place
  }
}

export function exitPlan(
  spec: AnimationSpec | undefined,
  entranceDuration: number,
  ctx: MotionContext
): ExitPlan | null {
  if (!spec) return null;
  const ease = spec.easing ?? ctx.easings.exit;
  // Exits are 40–50% shorter than entrances (motion rules). When the entrance
  // is instant/unknown (strike, none), fall back to a 0.3s base.
  const base = spec.duration ?? (entranceDuration > 0 ? entranceDuration * 0.45 : 0.3);
  const cap = entranceDuration > 0 ? entranceDuration * 0.5 : 0.3;
  const duration = d(Math.min(base, cap), ctx);
  const dist = (spec.distance ?? 40) * ctx.unit;
  const dir = spec.preset === 'slide' ? slideVector(spec, ctx.unit) : { x: 0, y: -dist * 0.4 };
  return {
    from: { opacity: 1, x: 0, y: 0, scale: 1 },
    to: { opacity: 0, x: dir.x * 0.4, y: dir.y * 0.4, scale: 0.96 },
    duration,
    ease,
    at: 0 // positioned by caller: element.start + element.duration - duration
  };
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
