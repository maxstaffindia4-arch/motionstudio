import { z } from 'zod';
import type { ComponentDef, ComponentContext } from './types.js';
import { shp, stk, txt } from './helpers.js';
import type { Element, ShapeStyle } from '../elements/schema.js';

const Colorish = z.union([z.string(), z.object({ token: z.string() })]);

const Params = z.object({
  text: z.string().min(1).default('Headline'),
  /** Accent color used for the sweeping band and text glow. */
  accentColor: Colorish.default({ token: 'colors.accent' }),
  /** Glow band width, px @1080. */
  bandWidth: z.number().min(40).max(600).default(220),
  /** Glow blur radius, px @1080. */
  glowBlur: z.number().min(8).max(120).default(42),
  /** Sweep passes over the clip. */
  passes: z.number().int().min(1).max(4).default(1)
});
type Params = z.infer<typeof Params>;

function build(params: Params, ctx: ComponentContext): Element[] {
  const D = ctx.durationSec;
  const u = ctx.unit;
  const fs = 96;

  // Sweeping band(s): oversized skewed strips that whip across the frame.
  // Transform-only x travel; no blend modes or full-frame filters (A6/A7).
  const bandW = params.bandWidth;
  const bandH = Math.round(fs * 2.4);
  const travel = Math.ceil((ctx.canvas.width * 1.4) / u);
  const sweepDur = Math.min(1.6, Math.max(0.4, D / (params.passes + 0.6)));
  const bands: Element[] = Array.from({ length: params.passes }, (_, i) =>
    shp({
      id: `glow-band-${i}`,
      shape: 'rect',
      start: 0.15 + i * sweepDur * 0.7,
      duration: Math.min(sweepDur + 0.3, Math.max(0.5, D - 0.15 - i * sweepDur * 0.7)),
      anchor: 'center',
      style: {
        width: bandW,
        height: bandH,
        color: params.accentColor,
        opacity: 0.3,
        rotation: -12,
      } satisfies ShapeStyle,
      animation: {
        in: { preset: 'whip', direction: 'right', distance: travel, duration: sweepDur, delay: 0 },
      },
    })
  );

  // Headline sits in an overflow:hidden mask; the compiler pads the mask by
  // the glow radius so text-shadow is not clipped (A7).
  const headline = stk({
    id: 'glow-mask',
    duration: D,
    anchor: 'center',
    direction: 'column',
    align: 'center',
    justify: 'center',
    gap: 0,
    style: {
      overflow: 'hidden',
      // Numeric padding (@1080 units); compiler adds glow-radius padding on top.
      padding: 70,
    },
    animation: { in: { preset: 'fade-scale', delay: 0.1 } },
    children: [
      txt({
        id: 'glow-text',
        content: params.text,
        duration: Math.max(0.4, D - 0.35),
        start: 0.35,
        flow: true,
        style: {
          fontSize: fs,
          fontWeight: 900,
          color: '#FFFFFF',
          letterSpacing: -1,
          align: 'center',
          glow: { color: params.accentColor, blur: params.glowBlur },
          shadow: `0 ${Math.round(6 * u)}px ${Math.round(30 * u)}px rgba(0,0,0,0.45)`,
        },
      }),
    ],
  });

  return [...bands, headline];
}

export const glowSweep: ComponentDef<Params> = {
  id: 'glow-sweep',
  name: 'Glow Sweep',
  description: 'Headline with light bands sweeping behind and layered glow shadows.',
  example: '{"text":"Launch Faster","accentColor":"#F59E0B","passes":2}',
  paramsSchema: Params,
  defaults: Params.parse({}),
  paramFields: [
    { id: 'text', type: 'text', label: 'Headline', group: 'Content' },
    { id: 'accentColor', type: 'color', label: 'Glow accent', group: 'Color' },
    { id: 'bandWidth', type: 'number', label: 'Band width (px @1080)', min: 40, max: 600, step: 10, group: 'Motion' },
    { id: 'glowBlur', type: 'number', label: 'Glow blur (px @1080)', min: 8, max: 120, step: 4, group: 'Motion' },
    { id: 'passes', type: 'number', label: 'Sweep passes', min: 1, max: 4, step: 1, group: 'Motion' },
  ],
  build,
};
