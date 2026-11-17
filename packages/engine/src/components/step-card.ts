import { z } from 'zod';
import type { ComponentDef, ComponentContext } from './types.js';
import { stk, txt } from './helpers.js';
import type { Element } from '../elements/schema.js';

const Colorish = z.union([z.string(), z.object({ token: z.string() })]);

const Params = z.object({
  badge: z.string().default('STEP 01'),
  title: z.string().min(1).default('Step title'),
  description: z.string().default(''),
  badgeColor: Colorish.default({ token: 'colors.primary' }),
  cardBg: Colorish.default({ token: 'colors.surface' })
});
type Params = z.infer<typeof Params>;

function build(params: Params, ctx: ComponentContext): Element[] {
  const D = ctx.durationSec;
  const u = ctx.unit;

  const badge = stk({
    id: 'badge',
    duration: Math.max(0.4, D - 0.3),
    start: 0.3,
    flow: true,
    direction: 'row',
    align: 'center',
    justify: 'center',
    style: {
      background: params.badgeColor,
      borderRadius: 9999,
      padding: `${Math.round(10 * u)}px ${Math.round(26 * u)}px`,
    },
    animation: { in: { preset: 'pop' } },
    children: [
      txt({
        id: 'badge-t',
        content: params.badge,
        duration: Math.max(0.4, D - 0.3),
        start: 0.3,
        flow: true,
        style: { fontSize: 22, fontWeight: 800, color: '#FFFFFF', letterSpacing: 2, textTransform: 'uppercase' },
      }),
    ],
  });

  const children: Element[] = [badge];
  children.push(
    txt({
      id: 'step-title',
      content: params.title,
      start: 0.45,
      duration: Math.max(0.4, D - 0.45),
      flow: true,
      style: { fontSize: 52, fontWeight: 800, color: '#FFFFFF', letterSpacing: -0.5 },
      animation: { in: { preset: 'slide', direction: 'up', distance: 24 } },
    })
  );
  if (params.description) {
    children.push(
      txt({
        id: 'step-desc',
        content: params.description,
        start: 0.6,
        duration: Math.max(0.4, D - 0.6),
        flow: true,
        style: { fontSize: 28, fontWeight: 500, color: { token: 'colors.textMuted' }, lineHeight: 1.5 },
        animation: { in: { preset: 'slide', direction: 'up', distance: 24 } },
      })
    );
  }

  return [
    stk({
      id: 'card',
      duration: D,
      anchor: 'center',
      direction: 'column',
      align: 'start',
      gap: 28,
      style: {
        background: params.cardBg,
        borderRadius: 28,
        borderColor: { token: 'colors.white' },
        borderWidth: 1,
        padding: `${Math.round(64 * u)}px ${Math.round(80 * u)}px`,
      },
      animation: { in: { preset: 'fade-scale', delay: 0.1 } },
      children,
    }),
  ];
}

export const stepCard: ComponentDef<Params> = {
  id: 'step-card',
  name: 'Step Card',
  description: 'Process card with step badge, title and description.',
  example: '{"badge":"STEP 01","title":"Tell Us What You Need","description":"We handle the rest."}',
  paramsSchema: Params,
  defaults: Params.parse({}),
  paramFields: [
    { id: 'badge', type: 'text', label: 'Badge', group: 'Content' },
    { id: 'title', type: 'text', label: 'Title', group: 'Content' },
    { id: 'description', type: 'text', label: 'Description', group: 'Content' },
    { id: 'badgeColor', type: 'color', label: 'Badge color', group: 'Color' },
    { id: 'cardBg', type: 'color', label: 'Card background', group: 'Color' },
  ],
  build,
};
