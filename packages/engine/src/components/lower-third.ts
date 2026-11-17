import { z } from 'zod';
import type { ComponentDef, ComponentContext } from './types.js';
import { shp, stk, txt } from './helpers.js';
import type { Element } from '../elements/schema.js';

const Colorish = z.union([z.string(), z.object({ token: z.string() })]);

const Params = z.object({
  name: z.string().min(1).default('Jane Doe'),
  title: z.string().default(''),
  company: z.string().default(''),
  cardBg: Colorish.default({ token: 'colors.surface' }),
  accentColor: Colorish.default({ token: 'colors.accent' }),
  /** Lift above the bottom safe-area edge, px @1080. */
  bottomOffset: z.number().min(0).max(400).default(120),
  /** Left inset inside the safe area, px @1080. */
  sideOffset: z.number().min(0).max(400).default(100)
});
type Params = z.infer<typeof Params>;

function build(params: Params, ctx: ComponentContext): Element[] {
  const D = ctx.durationSec;
  const u = ctx.unit;
  const nameFs = 40;
  const subFs = 24;
  const padY = 28;
  const padX = 48;
  // Approximate bar height from type metrics (deterministic, no DOM measurement).
  const barH = Math.round(nameFs * 1.25 + subFs * 1.45 + padY * 2);

  const subtitle = [params.title, params.company].filter(Boolean).join(' · ');

  return [
    stk({
      id: 'lt-card',
      duration: D,
      anchor: 'bottom-left',
      offset: { x: params.sideOffset * u, y: -params.bottomOffset * u },
      direction: 'row',
      align: 'stretch',
      style: {
        background: params.cardBg,
        borderRadius: 16,
        padding: 0,
      },
      animation: {
        in: { preset: 'slide', direction: 'left', distance: 80 },
        out: { preset: 'slide', direction: 'left', duration: 0.4, role: 'exit' },
      },
      children: [
        shp({
          id: 'lt-bar',
          shape: 'rect',
          duration: D,
          flow: true,
          style: { width: 12, height: barH, color: params.accentColor },
        }),
        stk({
          id: 'lt-body',
          duration: D,
          flow: true,
          direction: 'column',
          gap: 24,
          style: { padding: `${Math.round(padY * u)}px ${Math.round(padX * u)}px` },
          children: [
            txt({
              id: 'lt-name',
              content: params.name,
              duration: Math.max(0.4, D - 0.3),
              start: 0.3,
              flow: true,
              style: { fontSize: nameFs, fontWeight: 800, color: '#FFFFFF', letterSpacing: -0.5 },
            }),
            ...(subtitle
              ? [
                  txt({
                    id: 'lt-sub',
                    content: subtitle,
                    duration: Math.max(0.4, D - 0.3),
                    start: 0.3,
                    flow: true,
                    style: { fontSize: subFs, fontWeight: 500, color: { token: 'colors.textMuted' } },
                  }),
                ]
              : []),
          ],
        }),
      ],
    }),
  ];
}

export const lowerThird: ComponentDef<Params> = {
  id: 'lower-third',
  name: 'Lower Third',
  description: 'Broadcast-style name/title bar anchored to the lower safe area.',
  example: '{"name":"Sarah Jenkins","title":"Operations Director","company":"Acme"}',
  paramsSchema: Params,
  defaults: Params.parse({}),
  paramFields: [
    { id: 'name', type: 'text', label: 'Name', group: 'Content' },
    { id: 'title', type: 'text', label: 'Title / role', group: 'Content' },
    { id: 'company', type: 'text', label: 'Company', group: 'Content' },
    { id: 'bottomOffset', type: 'number', label: 'Bottom offset (px @1080)', min: 0, max: 400, group: 'Layout' },
    { id: 'sideOffset', type: 'number', label: 'Side offset (px @1080)', min: 0, max: 400, group: 'Layout' },
    { id: 'cardBg', type: 'color', label: 'Card background', group: 'Color' },
    { id: 'accentColor', type: 'color', label: 'Accent bar', group: 'Color' },
  ],
  build,
};
