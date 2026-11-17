import { z } from 'zod';
import type { ComponentDef, ComponentContext } from './types.js';
import { stk, txt } from './helpers.js';
import type { Element } from '../elements/schema.js';

const Colorish = z.union([z.string(), z.object({ token: z.string() })]);

const Params = z.object({
  target: z.number().min(0).max(1_000_000).default(100),
  prefix: z.string().default(''),
  suffix: z.string().default(''),
  label: z.string().default(''),
  numberColor: Colorish.default({ token: 'colors.primary' }),
  cardBg: Colorish.default({ token: 'colors.surface' })
});
type Params = z.infer<typeof Params>;

function build(params: Params, ctx: ComponentContext): Element[] {
  const D = ctx.durationSec;
  const u = ctx.unit;
  const numFs = 120;
  const affixFs = 72;

  const numberRow = stk({
    id: 'num-row',
    duration: D,
    flow: true,
    direction: 'row',
    align: 'end',
    justify: 'center',
    gap: 24,
    children: [
      ...(params.prefix
        ? [
            txt({
              id: 'num-pre',
              content: params.prefix,
              duration: Math.max(0.4, D - 0.3),
              start: 0.3,
              flow: true,
              style: { fontSize: affixFs, fontWeight: 800, color: params.numberColor },
            }),
          ]
        : []),
      txt({
        id: 'num-val',
        content: String(params.target),
        duration: Math.max(0.4, D - 0.3),
        start: 0.3,
        flow: true,
        style: {
          fontSize: numFs,
          fontWeight: 900,
          color: params.numberColor,
          lineHeight: 1,
          letterSpacing: -2,
        },
        // A10: proxy onUpdate counter — pending real-render verification.
        animation: { in: { preset: 'counter', duration: 1.8 } },
      }),
      ...(params.suffix
        ? [
            txt({
              id: 'num-suf',
              content: params.suffix,
              duration: Math.max(0.4, D - 0.3),
              start: 0.3,
              flow: true,
              style: { fontSize: affixFs, fontWeight: 800, color: params.numberColor },
            }),
          ]
        : []),
    ],
  });

  const children: Element[] = [numberRow];
  if (params.label) {
    children.push(
      txt({
        id: 'num-label',
        content: params.label,
        start: 0.5,
        duration: Math.max(0.4, D - 0.5),
        flow: true,
        style: { fontSize: 32, fontWeight: 600, color: { token: 'colors.text' }, align: 'center' },
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
      align: 'center',
      gap: 24,
      style: {
        background: params.cardBg,
        borderRadius: 32,
        borderColor: { token: 'colors.white' },
        borderWidth: 1,
        padding: `${Math.round(60 * u)}px ${Math.round(100 * u)}px`,
      },
      animation: { in: { preset: 'pop', delay: 0.1 } },
      children,
    }),
  ];
}

export const numberCounter: ComponentDef<Params> = {
  id: 'number-counter',
  name: 'Number Counter',
  description: 'Large metric that counts up to a target with prefix/suffix and label.',
  example: '{"target":70,"suffix":"%","label":"Cost reduction vs local hiring"}',
  paramsSchema: Params,
  defaults: Params.parse({}),
  paramFields: [
    { id: 'target', type: 'number', label: 'Target number', min: 0, max: 1000000, group: 'Content' },
    { id: 'prefix', type: 'text', label: 'Prefix', group: 'Content' },
    { id: 'suffix', type: 'text', label: 'Suffix', group: 'Content' },
    { id: 'label', type: 'text', label: 'Label', group: 'Content' },
    { id: 'numberColor', type: 'color', label: 'Number color', group: 'Color' },
    { id: 'cardBg', type: 'color', label: 'Card background', group: 'Color' },
  ],
  build,
};
