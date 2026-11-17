import { z } from 'zod';
import type { ComponentDef, ComponentContext } from './types.js';
import { stk, txt } from './helpers.js';
import type { Element } from '../elements/schema.js';

const Params = z.object({
  text: z.string().min(1).default('Your headline text'),
  /** Comma-separated words rendered in the accent color. */
  highlightWords: z.string().default(''),
  fontSize: z.number().min(40).max(160).default(72),
  fontWeight: z.union([z.number(), z.string()]).default(800),
  textColor: z.union([z.string(), z.object({ token: z.string() })]).default('#FFFFFF'),
  highlightColor: z.union([z.string(), z.object({ token: z.string() })]).default({ token: 'colors.accent' }),
  /** Seconds between word slams (60–120ms is the HF guideline; default slightly wider for readability). */
  stepDuration: z.number().min(0.05).max(0.6).default(0.28)
});
type Params = z.infer<typeof Params>;

function build(params: Params, ctx: ComponentContext): Element[] {
  const D = ctx.durationSec;
  const words = params.text.trim().split(/\s+/).filter(Boolean);
  const highlights = new Set(
    params.highlightWords.toLowerCase().split(',').map((s) => s.trim().replace(/[.,!?;:]/g, '')).filter(Boolean)
  );
  const step = params.stepDuration;

  const children = words.map((w, i) => {
    const clean = w.toLowerCase().replace(/[.,!?;:]/g, '');
    const isHl = highlights.has(clean);
    const start = Math.min(i * step, Math.max(0, D - 0.5));
    return txt({
      id: `w-${i}`,
      content: w,
      start,
      duration: Math.max(0.4, D - start),
      flow: true,
      style: {
        fontSize: params.fontSize,
        fontWeight: params.fontWeight,
        color: isHl ? params.highlightColor : params.textColor,
        letterSpacing: -0.5,
      },
      animation: { in: { preset: 'slam' } },
    });
  });

  return [
    stk({
      id: 'slam-words',
      duration: D,
      anchor: 'center',
      direction: 'row',
      wrap: true,
      justify: 'center',
      align: 'center',
      gap: Math.max(24, Math.round(params.fontSize * 0.28)),
      children,
    }),
  ];
}

export const textSlam: ComponentDef<Params> = {
  id: 'text-slam',
  name: 'Text Slam',
  description: 'High-impact word-by-word kinetic slam for hooks and titles.',
  example: '{"text":"Running a business is hard enough.","highlightWords":"hard,enough."}',
  paramsSchema: Params,
  defaults: Params.parse({}),
  paramFields: [
    { id: 'text', type: 'text', label: 'On-screen text', group: 'Content' },
    { id: 'highlightWords', type: 'text', label: 'Highlight words (comma-separated)', group: 'Content' },
    { id: 'fontSize', type: 'number', label: 'Font size (px @1080)', min: 40, max: 160, group: 'Typography' },
    { id: 'fontWeight', type: 'number', label: 'Font weight', min: 400, max: 900, step: 100, group: 'Typography' },
    { id: 'textColor', type: 'color', label: 'Text color', group: 'Color' },
    { id: 'highlightColor', type: 'color', label: 'Highlight color', group: 'Color' },
    { id: 'stepDuration', type: 'number', label: 'Word interval (s)', min: 0.05, max: 0.6, step: 0.02, group: 'Motion' },
  ],
  build,
};
