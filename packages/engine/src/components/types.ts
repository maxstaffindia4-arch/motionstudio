import type { z } from 'zod';
import type { CanvasSpec } from '../canvas/schema.js';
import type { Rect } from '../canvas/geometry.js';
import type { StyleTokens } from '../scene/tokens.js';
import type { Element } from '../elements/schema.js';

/** UI field descriptor for the future params panel (ported ParamFieldSchema). */
export interface ParamField {
  id: string;
  type: 'text' | 'color' | 'number' | 'easing' | 'time' | 'boolean' | 'select';
  label: string;
  group?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  description?: string;
}

export interface ComponentContext {
  canvas: CanvasSpec;
  /** Resolved tokens (defaults + theme + user overrides already merged). */
  tokens: StyleTokens;
  /** min(width,height)/1080 — scale all px-at-1080 values by this. */
  unit: number;
  /** Safe-area rect in px. */
  safe: Rect;
  /** Safe-area inset per side in px. */
  inset: { x: number; y: number };
  /** Canvas duration in seconds. */
  durationSec: number;
}

export interface ComponentDef<P = unknown> {
  id: string;
  name: string;
  description: string;
  /** Example params as a JSON string (shown in docs/UI). */
  example: string;
  paramsSchema: z.ZodType<P, z.ZodTypeDef, unknown>;
  defaults: P;
  paramFields: ParamField[];
  build(params: P, ctx: ComponentContext): Element[];
}
