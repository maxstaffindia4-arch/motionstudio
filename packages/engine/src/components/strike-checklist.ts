import { z } from 'zod';
import type { ComponentDef, ComponentContext } from './types.js';
import { shp, stk, txt } from './helpers.js';
import type { Element } from '../elements/schema.js';

const Colorish = z.union([z.string(), z.object({ token: z.string() })]);

const Params = z.object({
  title: z.string().default(''),
  /** Comma-separated checklist items. */
  items: z.string().min(1).default('One,Two,Three'),
  cardBg: Colorish.default({ token: 'colors.surface' }),
  textColor: Colorish.default('#FFFFFF'),
  itemColor: Colorish.default({ token: 'colors.textMuted' }),
  /** Seconds between item reveals. */
  itemStep: z.number().min(0.1).max(1.5).default(0.35),
  /** Seconds between strikes once all items are shown. */
  strikeStep: z.number().min(0.2).max(2).default(0.7),
  dimAfterStrike: z.boolean().default(true)
});
type Params = z.infer<typeof Params>;

function build(params: Params, ctx: ComponentContext): Element[] {
  const D = ctx.durationSec;
  const u = ctx.unit;
  const itemList = params.items.split(',').map((s) => s.trim()).filter(Boolean);
  const n = itemList.length;

  // Old timing model: rows reveal at 0.5 + i*itemStep; strikes start after
  // the last reveal + 0.5s pause, then every strikeStep.
  const revealBase = 0.5;
  const strikeBase = revealBase + n * params.itemStep + 0.5;

  const rows: Element[] = itemList.map((item, i) => {
    const rowStart = revealBase + i * params.itemStep;
    const strikeAt = strikeBase + i * params.strikeStep;
    const textStart = Math.max(rowStart, Math.min(strikeAt - 0.2, D - 0.6));
    return stk({
      id: `row-${i}`,
      duration: Math.max(0.4, D - rowStart),
      start: rowStart,
      flow: true,
      direction: 'row',
      align: 'center',
      gap: 24,
      children: [
        shp({
          id: `bullet-${i}`,
          shape: 'rect',
          duration: Math.max(0.4, D - rowStart),
          start: rowStart,
          flow: true,
          style: {
            width: 44,
            height: 44,
            color: { token: 'colors.surfaceAlt' },
            radius: 10,
          },
        }),
        txt({
          id: `item-${i}`,
          content: item,
          duration: Math.max(0.4, D - textStart),
          start: textStart,
          flow: true,
          style: { fontSize: 38, fontWeight: 600, color: params.itemColor },
          animation: {
            in: {
              preset: 'strike',
              // strike lands at strikeAt absolute; delay is relative to element start
              duration: Math.max(0.2, strikeAt - textStart),
              dimAfter: params.dimAfterStrike,
            },
          },
        }),
      ],
    });
  });

  const children: Element[] = [];
  if (params.title) {
    children.push(
      txt({
        id: 'title',
        content: params.title,
        start: 0.2,
        duration: Math.max(0.4, D - 0.2),
        flow: true,
        style: {
          fontSize: 48,
          fontWeight: 800,
          color: params.textColor,
          letterSpacing: -0.5,
        },
        animation: { in: { preset: 'slide', direction: 'up', distance: 40 } },
      })
    );
  }
  children.push(
    stk({
      id: 'rows',
      duration: D,
      start: 0,
      flow: true,
      direction: 'column',
      align: 'start',
      gap: 24,
      children: rows,
    })
  );

  return [
    stk({
      id: 'card',
      duration: D,
      anchor: 'center',
      direction: 'column',
      align: 'start',
      gap: 40,
      style: {
        background: params.cardBg,
        borderRadius: 28,
        borderColor: { token: 'colors.white' },
        borderWidth: 1,
        padding: `${Math.round(56 * u)}px ${Math.round(72 * u)}px`,
      },
      animation: { in: { preset: 'fade-scale', delay: 0.1 } },
      children,
    }),
  ];
}

export const strikeChecklist: ComponentDef<Params> = {
  id: 'strike-checklist',
  name: 'Strike Checklist',
  description: 'Card of pain-point items that appear, then get struck through.',
  example: '{"title":"Hiring Headaches","items":"Recruitment,Office Space,Admin Overhead"}',
  paramsSchema: Params,
  defaults: Params.parse({}),
  paramFields: [
    { id: 'title', type: 'text', label: 'Header', group: 'Content' },
    { id: 'items', type: 'text', label: 'Items (comma-separated)', group: 'Content' },
    { id: 'itemStep', type: 'number', label: 'Item interval (s)', min: 0.1, max: 1.5, step: 0.05, group: 'Motion' },
    { id: 'strikeStep', type: 'number', label: 'Strike interval (s)', min: 0.2, max: 2, step: 0.1, group: 'Motion' },
    { id: 'dimAfterStrike', type: 'boolean', label: 'Dim struck items', group: 'Motion' },
    { id: 'cardBg', type: 'color', label: 'Card background', group: 'Color' },
    { id: 'textColor', type: 'color', label: 'Title color', group: 'Color' },
    { id: 'itemColor', type: 'color', label: 'Item color', group: 'Color' },
  ],
  build,
};
