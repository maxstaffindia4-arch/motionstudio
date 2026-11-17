import { z } from 'zod';
import { ANCHORS } from '../canvas/geometry.js';
import { AssetRefSchema, StyleValueSchema, type AssetRef, type StyleValue } from './style.js';

/**
 * Animation presets. The compiler maps each preset + role to a GSAP
 * fromTo descriptor; easing is chosen BY ROLE unless overridden.
 * Only opacity / x / y / scale / rotation (and xPercent/yPercent) are emitted.
 */
export const ANIMATION_PRESETS = [
  'slam',
  'pop',
  'slide',
  'fade-scale',
  'wipe',
  'counter',
  'strike',
  /** Pass-through sweep: from -distance to +distance (whip transitions, streaks). */
  'whip'
] as const;

export const AnimationSpecSchema = z.object({
  preset: z.enum(ANIMATION_PRESETS),
  /** 'arrival' (default) uses tokens.easings.arrival; 'exit' uses exit easing. */
  role: z.enum(['arrival', 'exit']).optional(),
  easing: z.string().optional(),
  /** Seconds; defaults per preset scaled by motion intensity. */
  duration: z.number().positive().optional(),
  /** Travel distance in px at unit=1 for slide/wipe/slam. */
  distance: z.number().positive().optional(),
  /** Slide direction (slide preset; default 'up'). */
  direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  /** Seconds after element start before the entrance begins. */
  delay: z.number().min(0).optional(),
  /** strike preset: dim the element to 60% after the line lands (default true). */
  dimAfter: z.boolean().optional()
});
export type AnimationSpec = z.infer<typeof AnimationSpecSchema>;

export const OffsetSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0)
});
export type Offset = z.infer<typeof OffsetSchema>;

/**
 * Placement: anchored (9-point grid + px offset, rendered via a flex
 * wrapper inside the safe area) or flow (normal-flow child of a stack).
 */
export const PlacementSchema = z.union([
  z.object({
    anchor: z.enum(ANCHORS),
    offset: OffsetSchema.default({ x: 0, y: 0 })
  }),
  z.object({ flow: z.literal(true) })
]);
export type Placement = z.infer<typeof PlacementSchema>;

export function isFlowPlacement(p: Placement): p is { flow: true } {
  return 'flow' in p;
}

const TimingSchema = {
  id: z.string().min(1),
  start: z.number().min(0),
  duration: z.number().positive(),
  placement: PlacementSchema,
  animation: z
    .object({
      in: AnimationSpecSchema.optional(),
      out: AnimationSpecSchema.optional()
    })
    .default({})
};

export const TextStyleSchema = z.object({
  fontSize: z.number().positive().optional(),
  fontFamily: z.union([z.string(), z.array(z.string())]).optional(),
  color: StyleValueSchema.optional(),
  fontWeight: z.union([z.number(), z.string()]).optional(),
  textTransform: z.enum(['none', 'uppercase', 'capitalize']).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  lineHeight: z.union([z.number(), z.string()]).optional(),
  letterSpacing: z.union([z.number(), z.string()]).optional(),
  /** Extra text-shadow layers appended after token shadows. */
  shadow: z.string().optional(),
  /** Glow via text-shadow/box-shadow only — never filters/blend modes. */
  glow: z
    .object({
      color: StyleValueSchema.optional(),
      blur: z.number().positive().optional()
    })
    .optional(),
  background: StyleValueSchema.optional(),
  borderRadius: z.union([z.number(), z.string()]).optional(),
  padding: z.union([z.number(), z.string()]).optional(),
  opacity: z.number().min(0).max(1).optional()
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const ShapeStyleSchema = z.object({
  width: z.union([z.number(), z.string()]).optional(),
  height: z.union([z.number(), z.string()]).optional(),
  color: StyleValueSchema.optional(),
  radius: z.union([z.number(), z.string()]).optional(),
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(1).optional()
});
export type ShapeStyle = z.infer<typeof ShapeStyleSchema>;

export const ImageStyleSchema = z.object({
  width: z.union([z.number(), z.string()]).optional(),
  height: z.union([z.number(), z.string()]).optional(),
  fit: z.enum(['cover', 'contain', 'fill']).optional(),
  opacity: z.number().min(0).max(1).optional()
});
export type ImageStyle = z.infer<typeof ImageStyleSchema>;

export const StackStyleSchema = z.object({
  background: StyleValueSchema.optional(),
  borderRadius: z.union([z.number(), z.string()]).optional(),
  padding: z.union([z.number(), z.string()]).optional(),
  opacity: z.number().min(0).max(1).optional(),
  /** 'hidden' enables overflow clipping — compiler adds glow padding (A7). */
  overflow: z.enum(['hidden', 'visible']).optional(),
  borderColor: StyleValueSchema.optional(),
  borderWidth: z.number().min(0).optional(),
  /** Box-shadow glow: emitted as `box-shadow: 0 0 <blur>px <color>` (no filters/blend modes). */
  glow: z
    .object({
      color: StyleValueSchema.optional(),
      blur: z.number().positive().optional()
    })
    .optional()
});
export type StackStyle = z.infer<typeof StackStyleSchema>;

interface ElementTiming {
  id: string;
  start: number;
  duration: number;
  placement: Placement;
  animation: { in?: AnimationSpec | undefined; out?: AnimationSpec | undefined };
}

export interface TextElement extends ElementTiming {
  type: 'text';
  content: string;
  style: TextStyle;
}
export interface ShapeElement extends ElementTiming {
  type: 'shape';
  shape: 'rect' | 'pill' | 'line';
  style: ShapeStyle;
}
export interface ImageElement extends ElementTiming {
  type: 'image';
  asset: AssetRef;
  style: ImageStyle;
}
export interface StackElement extends ElementTiming {
  type: 'stack';
  direction: 'row' | 'column' | 'grid';
  columns?: number | undefined;
  gap: number;
  align?: 'start' | 'center' | 'end' | 'stretch' | undefined;
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | undefined;
  wrap?: boolean | undefined;
  style: StackStyle;
  children: Element[];
}
export type Element = TextElement | ShapeElement | ImageElement | StackElement;

export const ElementSchema: z.ZodType<Element, z.ZodTypeDef, unknown> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    content: z.string(),
    style: TextStyleSchema.default({}),
    ...TimingSchema
  }),
  z.object({
    type: z.literal('shape'),
    shape: z.enum(['rect', 'pill', 'line']),
    style: ShapeStyleSchema.default({}),
    ...TimingSchema
  }),
  z.object({
    type: z.literal('image'),
    asset: AssetRefSchema,
    style: ImageStyleSchema.default({}),
    ...TimingSchema
  }),
  z.object({
    type: z.literal('stack'),
    direction: z.enum(['row', 'column', 'grid']).default('column'),
    columns: z.number().int().min(1).max(12).optional(),
    gap: z.number().min(0).default(0),
    align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
    justify: z.enum(['start', 'center', 'end', 'between', 'around']).optional(),
    /** flex-wrap for row stacks (ignored by grid). */
    wrap: z.boolean().optional(),
    style: StackStyleSchema.default({}),
    children: z.array(z.lazy(() => ElementSchema)).min(1),
    ...TimingSchema
  })
]);

export { StyleValueSchema };
export type { StyleValue };
