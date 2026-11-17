import { z } from 'zod';
import { CanvasSpecSchema } from '../canvas/schema.js';
import { ElementSchema } from '../elements/schema.js';
import { AssetRefSchema, StyleValueSchema } from '../elements/style.js';
import { StyleTokensSchema } from './tokens.js';

const GradientStopSchema = z.object({
  color: StyleValueSchema,
  /** 0..1 position along the gradient axis. */
  offset: z.number().min(0).max(1)
});

const previewOnly = { previewOnly: z.boolean().optional() } as const;

/**
 * Background layers. `previewOnly` backgrounds are emitted only when
 * compileScene is called with { target: 'preview' } (A8).
 */
export const BackgroundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('solid'),
    color: StyleValueSchema,
    ...previewOnly
  }),
  z.object({
    kind: z.literal('gradient'),
    type: z.enum(['linear', 'radial']).default('linear'),
    /** Degrees; CSS convention (0deg = to top, 90deg = to right). */
    angle: z.number().min(0).max(360).optional(),
    stops: z.array(GradientStopSchema).min(2),
    ...previewOnly
  }),
  z.object({
    kind: z.literal('animated-gradient'),
    /**
     * 'pan': one oversized layer with repeating-linear-gradient moved by
     * xPercent/yPercent (transform-only, seamless-ish).
     * 'cycle': two gradient layers cross-faded via opacity — for color changes.
     */
    animate: z.enum(['pan', 'cycle']),
    angle: z.number().min(0).max(360).optional(),
    durationSec: z.number().positive().optional(),
    stops: z.array(GradientStopSchema).min(2).optional(),
    /** Two endpoint colors used by 'cycle' when stops are absent. */
    colors: z.tuple([StyleValueSchema, StyleValueSchema]).optional(),
    ...previewOnly
  }),
  z.object({
    kind: z.literal('image'),
    asset: AssetRefSchema,
    fit: z.enum(['cover', 'contain', 'fill']).optional(),
    ...previewOnly
  })
]);
export type Background = z.infer<typeof BackgroundSchema>;

export const SceneSpecSchema = z.object({
  specVersion: z.literal(1),
  canvas: CanvasSpecSchema,
  /** Partial token overrides merged over DEFAULT_TOKENS (+ optional theme). */
  tokens: StyleTokensSchema.deepPartial().optional(),
  /** Named theme preset (see THEMES) applied under `tokens`. */
  theme: z.string().optional(),
  background: BackgroundSchema.default({ kind: 'none' }),
  elements: z.array(ElementSchema).min(1)
});

export type SceneSpec = z.infer<typeof SceneSpecSchema>;
