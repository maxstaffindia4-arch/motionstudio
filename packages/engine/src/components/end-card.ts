import { z } from 'zod';
import type { ComponentDef, ComponentContext } from './types.js';
import { shp, stk, txt } from './helpers.js';
import type { Element } from '../elements/schema.js';

const Colorish = z.union([z.string(), z.object({ token: z.string() })]);

const Params = z.object({
  brandName: z.string().min(1).default('Your Brand'),
  website: z.string().default(''),
  ctaText: z.string().default(''),
  primaryColor: Colorish.default({ token: 'colors.primary' }),
  cardBg: Colorish.default({ token: 'colors.surface' })
});
type Params = z.infer<typeof Params>;

function build(params: Params, ctx: ComponentContext): Element[] {
  const D = ctx.durationSec;
  const u = ctx.unit;

  const brandRow = stk({
    id: 'brand-row',
    duration: D,
    flow: true,
    direction: 'row',
    align: 'center',
    gap: 24,
    children: [
      shp({
        id: 'logo-dot',
        shape: 'pill',
        duration: D,
        flow: true,
        style: { width: 64, height: 64, color: params.primaryColor },
      }),
      txt({
        id: 'brand',
        content: params.brandName,
        duration: D,
        flow: true,
        style: { fontSize: 56, fontWeight: 800, color: '#FFFFFF', letterSpacing: -0.5 },
      }),
    ],
  });

  const children: Element[] = [brandRow];
  if (params.website) {
    children.push(
      txt({
        id: 'site',
        content: params.website,
        start: 0.4,
        duration: Math.max(0.4, D - 0.4),
        flow: true,
        style: { fontSize: 34, fontWeight: 600, color: { token: 'colors.textMuted' } },
        animation: { in: { preset: 'fade-scale' } },
      })
    );
  }
  if (params.ctaText) {
    children.push(
      stk({
        id: 'cta',
        duration: Math.max(0.4, D - 0.5),
        start: 0.5,
        flow: true,
        direction: 'row',
        align: 'center',
        justify: 'center',
        style: {
          background: params.primaryColor,
          borderRadius: 9999,
          padding: `${Math.round(22 * u)}px ${Math.round(56 * u)}px`,
        },
        animation: { in: { preset: 'pop' } },
        children: [
          txt({
            id: 'cta-t',
            content: params.ctaText,
            duration: Math.max(0.4, D - 0.5),
            start: 0.5,
            flow: true,
            style: { fontSize: 32, fontWeight: 700, color: '#FFFFFF' },
          }),
        ],
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
      gap: 36,
      style: {
        background: params.cardBg,
        borderRadius: 36,
        borderColor: { token: 'colors.white' },
        borderWidth: 1,
        padding: `${Math.round(72 * u)}px ${Math.round(110 * u)}px`,
      },
      animation: { in: { preset: 'fade-scale', delay: 0.1 } },
      children,
    }),
  ];
}

export const endCard: ComponentDef<Params> = {
  id: 'end-card',
  name: 'End Card',
  description: 'Outro card with brand mark, website and CTA button.',
  example: '{"brandName":"Acme","website":"acme.com","ctaText":"Learn More"}',
  paramsSchema: Params,
  defaults: Params.parse({}),
  paramFields: [
    { id: 'brandName', type: 'text', label: 'Brand name', group: 'Content' },
    { id: 'website', type: 'text', label: 'Website', group: 'Content' },
    { id: 'ctaText', type: 'text', label: 'CTA text', group: 'Content' },
    { id: 'primaryColor', type: 'color', label: 'Primary accent', group: 'Color' },
    { id: 'cardBg', type: 'color', label: 'Card background', group: 'Color' },
  ],
  build,
};
