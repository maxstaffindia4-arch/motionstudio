import { z } from 'zod';
import type { ComponentDef, ComponentContext } from './types.js';
import { shp } from './helpers.js';
import type { Element, ShapeStyle } from '../elements/schema.js';
import type { StyleValue } from '../elements/style.js';

const Colorish = z.union([z.string(), z.object({ token: z.string() })]);

const Params = z.object({
  color1: Colorish.default({ token: 'colors.primary' }),
  color2: Colorish.default({ token: 'colors.accent' }),
  /** Travel direction of the leading bar. */
  direction: z.enum(['ltr', 'rtl']).default('ltr'),
  /** Sweep duration in seconds. */
  sweepDuration: z.number().min(0.3).max(3).default(0.9),
  /** Delay before the second bar follows, seconds. */
  stagger: z.number().min(0).max(0.5).default(0.08)
});
type Params = z.infer<typeof Params>;

function build(params: Params, ctx: ComponentContext): Element[] {
  const D = ctx.durationSec;
  const u = ctx.unit;
  const maxDim = Math.max(ctx.canvas.width, ctx.canvas.height);
  // Oversized skewed bars; travel distance carries them fully off-frame.
  const size = Math.ceil((maxDim * 1.6) / u);
  const travel = Math.ceil((maxDim * 1.6) / u);
  const sweep = Math.min(params.sweepDuration, Math.max(0.3, D - 0.4));
  const animDir = params.direction === 'ltr' ? 'right' : 'left';

  const bar = (id: string, color: StyleValue, delay: number): Element =>
    shp({
      id,
      shape: 'rect',
      start: 0.1 + delay,
      duration: Math.min(sweep + 0.3, Math.max(0.5, D - 0.1 - delay)),
      anchor: 'center',
      style: {
        width: size,
        height: size,
        color,
        rotation: params.direction === 'ltr' ? -12 : 12,
      } satisfies ShapeStyle,
      animation: {
        in: { preset: 'whip', direction: animDir as 'left' | 'right', distance: travel, duration: sweep },
      },
    });

  return [bar('whip-1', params.color2, 0), bar('whip-2', params.color1, params.stagger)];
}

export const whipTransition: ComponentDef<Params> = {
  id: 'whip-transition',
  name: 'Whip Transition',
  description: 'Fast kinetic bars whip across the frame as a transition wipe.',
  example: '{"color1":"#3B82F6","color2":"#8B5CF6","sweepDuration":0.9}',
  paramsSchema: Params,
  defaults: Params.parse({}),
  paramFields: [
    { id: 'color1', type: 'color', label: 'Leading color', group: 'Color' },
    { id: 'color2', type: 'color', label: 'Trailing color', group: 'Color' },
    { id: 'direction', type: 'select', label: 'Direction', group: 'Motion', options: ['ltr', 'rtl'] },
    { id: 'sweepDuration', type: 'number', label: 'Sweep duration (s)', min: 0.3, max: 3, step: 0.1, group: 'Motion' },
    { id: 'stagger', type: 'number', label: 'Bar stagger (s)', min: 0, max: 0.5, step: 0.02, group: 'Motion' },
  ],
  build,
};
