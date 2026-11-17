import { z } from 'zod';
import type { ComponentDef, ComponentContext } from './types.js';
import { stk, txt, tok } from './helpers.js';
import type { Element } from '../elements/schema.js';

const Colorish = z.union([z.string(), z.object({ token: z.string() })]);

const Params = z.object({
  heading: z.string().default(''),
  /** Comma-separated card titles (1–8). */
  cards: z.string().min(1).default('Feature,Feature,Feature'),
  cardBg: Colorish.default({ token: 'colors.surface' }),
  primaryColor: Colorish.default({ token: 'colors.primary' })
});
type Params = z.infer<typeof Params>;

const ICONS = ['✦', '▣', '◎', '◷', '⬢', '◈', '✚', '◉'];

function build(params: Params, ctx: ComponentContext): Element[] {
  const D = ctx.durationSec;
  const u = ctx.unit;
  const cardList = params.cards.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const landscape = ctx.canvas.width >= ctx.canvas.height;
  const columns = landscape ? Math.min(cardList.length, 4) : Math.min(cardList.length, 2);

  const cards: Element[] = cardList.map((title, i) =>
    stk({
      id: `card-${i}`,
      duration: Math.max(0.4, D - 0.4 - i * 0.22),
      start: 0.4 + i * 0.22,
      flow: true,
      direction: 'column',
      align: 'center',
      justify: 'center',
      gap: 24,
      style: {
        background: params.cardBg,
        borderRadius: 24,
        borderColor: { token: 'colors.white' },
        borderWidth: 1,
        padding: `${Math.round(48 * u)}px ${Math.round(32 * u)}px`,
      },
      animation: { in: { preset: 'pop' } },
      children: [
        txt({
          id: `icon-${i}`,
          content: ICONS[i % ICONS.length] ?? '✦',
          duration: Math.max(0.4, D - 0.4 - i * 0.22),
          start: 0.4 + i * 0.22,
          flow: true,
          style: { fontSize: 56, color: params.primaryColor, lineHeight: 1 },
        }),
        txt({
          id: `card-t-${i}`,
          content: title,
          duration: Math.max(0.4, D - 0.4 - i * 0.22),
          start: 0.4 + i * 0.22,
          flow: true,
          style: {
            fontSize: 30,
            fontWeight: 700,
            color: { token: 'colors.text' },
            align: 'center',
            lineHeight: 1.3,
          },
        }),
      ],
    })
  );

  const children: Element[] = [];
  if (params.heading) {
    children.push(
      txt({
        id: 'heading',
        content: params.heading,
        start: 0.1,
        duration: Math.max(0.4, D - 0.1),
        flow: true,
        style: { fontSize: 52, fontWeight: 800, color: '#FFFFFF', letterSpacing: -0.5 },
        animation: { in: { preset: 'slide', direction: 'up', distance: 30 } },
      })
    );
  }
  children.push(
    stk({
      id: 'grid',
      duration: D,
      start: 0,
      flow: true,
      direction: 'grid',
      columns,
      gap: 32,
      align: 'stretch',
      justify: 'center',
      children: cards,
    })
  );

  return [
    stk({
      id: 'wrap',
      duration: D,
      anchor: 'center',
      direction: 'column',
      align: 'center',
      gap: 48,
      children,
    }),
  ];
}

export const iconCards: ComponentDef<Params> = {
  id: 'icon-cards',
  name: 'Icon Cards',
  description: 'Grid of feature cards with icons and staggered pop-in.',
  example: '{"heading":"Everything You Need","cards":"Talent,Office,Recruiting,Flex"}',
  paramsSchema: Params,
  defaults: Params.parse({}),
  paramFields: [
    { id: 'heading', type: 'text', label: 'Heading', group: 'Content' },
    { id: 'cards', type: 'text', label: 'Card titles (comma-separated)', group: 'Content' },
    { id: 'primaryColor', type: 'color', label: 'Icon color', group: 'Color' },
    { id: 'cardBg', type: 'color', label: 'Card background', group: 'Color' },
  ],
  build,
};
