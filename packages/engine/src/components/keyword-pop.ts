import { z } from 'zod';
import type { ComponentDef, ComponentContext } from './types.js';
import { stk, txt } from './helpers.js';
import type { Element } from '../elements/schema.js';

const Colorish = z.union([z.string(), z.object({ token: z.string() })]);

const Params = z.object({
  keyword: z.string().min(1).default('KEYWORD'),
  subtext: z.string().default(''),
  badgeBg: Colorish.default({ token: 'colors.surface' }),
  textColor: Colorish.default('#FFFFFF'),
  accentColor: Colorish.default({ token: 'colors.accent' }),
  fontSize: z.number().min(40).max(140).default(84)
});
type Params = z.infer<typeof Params>;

function build(params: Params, ctx: ComponentContext): Element[] {
  const D = ctx.durationSec;
  const u = ctx.unit;
  const badge = stk({
    id: 'pop-badge',
    duration: D,
    flow: true,
    direction: 'row',
    align: 'center',
    justify: 'center',
    gap: 0,
    style: {
      background: params.badgeBg,
      borderRadius: 9999,
      borderColor: params.accentColor,
      borderWidth: 3,
      padding: `${Math.round(28 * u)}px ${Math.round(64 * u)}px`,
    },
    animation: { in: { preset: 'pop', delay: 0.2 } },
    children: [
      txt({
        id: 'kw',
        content: params.keyword,
        duration: D,
        flow: true,
        style: {
          fontSize: params.fontSize,
          fontWeight: 800,
          color: params.textColor,
          textTransform: 'uppercase',
          letterSpacing: -0.5,
        },
      }),
    ],
  });

  const children: Element[] = [badge];
  if (params.subtext) {
    children.push(
      txt({
        id: 'sub',
        content: params.subtext,
        start: 0.5,
        duration: Math.max(0.4, D - 0.5),
        flow: true,
        style: { fontSize: 34, fontWeight: 500, color: { token: 'colors.textMuted' } },
        animation: { in: { preset: 'slide', direction: 'up', distance: 30, delay: 0 } },
      })
    );
  }

  return [
    stk({
      id: 'pop-wrap',
      duration: D,
      anchor: 'center',
      direction: 'column',
      align: 'center',
      gap: 32,
      children,
    }),
  ];
}

export const keywordPop: ComponentDef<Params> = {
  id: 'keyword-pop',
  name: 'Keyword Pop',
  description: 'Bouncy keyword badge with optional supporting subtext.',
  example: '{"keyword":"SCALABLE TEAMS","subtext":"Built for fast-growing businesses"}',
  paramsSchema: Params,
  defaults: Params.parse({}),
  paramFields: [
    { id: 'keyword', type: 'text', label: 'Keyword', group: 'Content' },
    { id: 'subtext', type: 'text', label: 'Subtext', group: 'Content' },
    { id: 'fontSize', type: 'number', label: 'Keyword size (px @1080)', min: 40, max: 140, group: 'Typography' },
    { id: 'badgeBg', type: 'color', label: 'Badge background', group: 'Color' },
    { id: 'textColor', type: 'color', label: 'Text color', group: 'Color' },
    { id: 'accentColor', type: 'color', label: 'Accent border', group: 'Color' },
  ],
  build,
};
