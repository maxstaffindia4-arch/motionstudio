import type { CanvasSpec } from '../canvas/schema.js';
import { safeArea, anchorPoint, unit } from '../canvas/geometry.js';
import { isFlowPlacement, type Element } from '../elements/schema.js';
import type { SceneSpec } from './schema.js';
import type { CompileWarning } from '../compiler/types.js';

export interface ValidationResult {
  /** Structural problems — compileScene throws on these. */
  errors: string[];
  /** Soft-rule findings — compileScene returns these as warnings. */
  warnings: CompileWarning[];
}

const MIN_GAP_UNIT = 24;

/**
 * Cross-field validation. Schema (zod) handles per-field shape; this handles
 * relationships: unique ids, placement rules, timing vs canvas, safe-area
 * geometry (conservative — anchor point + offset only, no text metrics),
 * gap minimums (warning + clamp, never rejection — A3).
 */
export function validateScene(scene: SceneSpec): ValidationResult {
  const errors: string[] = [];
  const warnings: CompileWarning[] = [];
  const canvas = scene.canvas;

  if (scene.background.kind !== 'none' && canvas.output === 'transparent') {
    warnings.push({
      code: 'background-on-transparent',
      severity: 'warning',
      message: `background '${scene.background.kind}' on a transparent canvas will render as an opaque layer inside a transparent frame`,
    });
  }

  const ids = new Set<string>();
  const area = safeArea(canvas);

  const visit = (el: Element, insideStack: boolean, path: string): void => {
    if (ids.has(el.id)) {
      errors.push(`duplicate element id '${el.id}' (${path})`);
    }
    ids.add(el.id);

    if (insideStack) {
      if (!isFlowPlacement(el.placement)) {
        errors.push(`element '${el.id}' inside a stack must use placement { flow: true }`);
      }
    } else if (isFlowPlacement(el.placement)) {
      errors.push(`top-level element '${el.id}' cannot use placement { flow: true }`);
    }

    // Timing: elements may not start before 0 (schema) — ends past canvas = warning.
    const end = el.start + el.duration;
    if (end > canvas.durationSec + 1e-6) {
      warnings.push({
        code: 'element-outlives-canvas',
        severity: 'warning',
        message: `element '${el.id}' ends at ${round2(end)}s but canvas duration is ${canvas.durationSec}s`,
        elementId: el.id,
      });
    }
    if (el.animation.out && el.animation.out.role !== 'exit') {
      warnings.push({
        code: 'exit-without-exit-role',
        severity: 'warning',
        message: `element '${el.id}' has an 'out' animation without role:'exit' — exit easing may not apply`,
        elementId: el.id,
      });
    }

    // Safe-area check for anchored elements: anchor point + offset must stay inside.
    if (!isFlowPlacement(el.placement)) {
      const p = anchorPoint(canvas, el.placement.anchor, el.placement.offset);
      if (p.x < area.x - 1e-6 || p.x > area.x + area.width + 1e-6 ||
          p.y < area.y - 1e-6 || p.y > area.y + area.height + 1e-6) {
        warnings.push({
          code: 'safe-area-overflow',
          severity: 'warning',
          message: `element '${el.id}' anchor+offset resolves outside the safe area`,
          elementId: el.id,
        });
      }
    }

    if (el.type === 'stack') {
      // gap is unit-relative: minimum 24 * unit(canvas) px = 24 in spec units.
      const minGapSpec = MIN_GAP_UNIT;
      const minGapPx = round2(MIN_GAP_UNIT * unit(canvas));
      if (el.gap < minGapSpec - 1e-6) {
        warnings.push({
          code: 'gap-below-min',
          severity: 'warning',
          message: `stack '${el.id}' gap ${round2(el.gap)} < minimum ${MIN_GAP_UNIT} (=${minGapPx}px at this canvas); will be clamped`,
          elementId: el.id,
        });
      }
      el.children.forEach((child, i) => visit(child, true, `${path}/${el.id}[${i}]`));
    }
  };

  scene.elements.forEach((el, i) => visit(el, false, `elements[${i}]`));
  return { errors, warnings };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
