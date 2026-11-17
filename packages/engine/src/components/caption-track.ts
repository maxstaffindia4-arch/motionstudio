import { z } from 'zod';
import type { ComponentDef, ComponentContext } from './types.js';
import { stk, txt } from './helpers.js';
import type { Element } from '../elements/schema.js';

const Colorish = z.union([z.string(), z.object({ token: z.string() })]);

const Params = z.object({
  text: z.string().min(1).default('caption words here'),
  /** Index of the word rendered in the accent color (static highlight). */
  activeIndex: z.number().int().min(0).max(50).default(0),
  activeColor: Colorish.default({ token: 'colors.accent' }),
  /** Lift above bottom safe-area edge, px @1080. */
  bottomOffset: z.number().min(0).max(400).default(120)
});
type Params = z.infer<typeof Params>;

function build(params: Params, ctx: ComponentContext): Element[] {
  const D = ctx.durationSec;
  const u = ctx.unit;
  const words = params.text.trim().split(/\s+/).filter(Boolean);
  const n = Math.max(words.length, 1);
  // Words fade in sequence across the clip window.
  const interval = Math.max(0.15, (D - 0.6) / n);

  const wordEls: Element[] = words.map((w, i) => {
    const start = Math.min(0.2 + i * interval, Math.max(0, D - 0.5));
    const isActive = i === params.activeIndex;
    return txt({
      id: `w-${i}`,
      content: w,
      start,
      duration: Math.max(0.3, D - start),
      flow: true,
      style: {
        fontSize: 38,
        fontWeight: isActive ? 700 : 500,
        color: isActive ? params.activeColor : { token: 'colors.textMuted' },
      },
      animation: { in: { preset: 'fade-scale', duration: 0.25 } },
    });
  });

  return [
    stk({
      id: 'pill',
      duration: D,
      anchor: 'bottom',
      offset: { x: 0, y: -params.bottomOffset * u },
      direction: 'row',
      wrap: true,
      justify: 'center',
      align: 'center',
      gap: 24,
      style: {
        background: { token: 'colors.surfaceAlt' },
        borderRadius: 9999,
        borderColor: { token: 'colors.white' },
        borderWidth: 1,
        padding: `${Math.round(20 * u)}px ${Math.round(48 * u)}px`,
      },
      animation: { in: { preset: 'slide', direction: 'up', distance: 30, delay: 0.1 } },
      children: wordEls,
    }),
  ];
}

export const captionTrack: ComponentDef<Params> = {
  id: 'caption-track',
  name: 'Caption Track',
  description: 'Subtitle pill near the bottom; words stagger in, active word highlighted.',
  example: '{"text":"Hire dedicated remote specialists today","activeIndex":1}',
  paramsSchema: Params,
  defaults: Params.parse({}),
  paramFields: [
    { id: 'text', type: 'text', label: 'Caption words', group: 'Content' },
    { id: 'activeIndex', type: 'number', label: 'Active word index (0-based)', min: 0, max: 50, group: 'Content' },
    { id: 'activeColor', type: 'color', label: 'Active word color', group: 'Color' },
    { id: 'bottomOffset', type: 'number', label: 'Bottom offset (px @1080)', min: 0, max: 400, group: 'Layout' },
  ],
  build,
};
