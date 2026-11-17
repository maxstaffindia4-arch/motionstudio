import { z } from 'zod';

export const SafeMarginSchema = z.enum(['off', 'title', 'action']);
export type SafeMargin = z.infer<typeof SafeMarginSchema>;

export const CanvasSpecSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().int().min(1).max(120).default(30),
  durationSec: z.number().positive(),
  output: z.enum(['transparent', 'opaque']).default('opaque'),
  safeMargins: SafeMarginSchema.default('action')
});

export type CanvasSpec = z.infer<typeof CanvasSpecSchema>;

export interface CanvasPreset {
  name: string;
  spec: Omit<CanvasSpec, 'fps' | 'durationSec' | 'output' | 'safeMargins'>;
}

export const CANVAS_PRESETS = {
  landscape: { width: 1920, height: 1080 },
  vertical: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 }
} as const;

export type CanvasPresetName = keyof typeof CANVAS_PRESETS;

export function presetCanvas(
  name: CanvasPresetName,
  overrides?: Partial<CanvasSpec>
): CanvasSpec {
  return CanvasSpecSchema.parse({
    ...CANVAS_PRESETS[name],
    fps: 30,
    durationSec: 5,
    output: 'opaque',
    safeMargins: 'action',
    ...overrides
  });
}
