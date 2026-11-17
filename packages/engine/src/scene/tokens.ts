import { z } from 'zod';

/**
 * Style tokens: the only place raw color/font/shadow/easing values live.
 * The compiler emits resolved tokens as CSS custom properties on :root.
 * Defaults are deliberately neutral — no brand names.
 */

export const FontStackSchema = z.array(z.string().min(1)).min(1);
export type FontStack = z.infer<typeof FontStackSchema>;

export const EasingsSchema = z.object({
  /** Long-tailed ease-out for arrivals. */
  arrival: z.string().default('power4.out'),
  /** Accelerating ease-in for exits. */
  exit: z.string().default('power3.in'),
  /** Overshoot ease for pops/badges. */
  pop: z.string().default('back.out(1.7)'),
  strike: z.string().optional()
});
export type Easings = z.infer<typeof EasingsSchema>;

export const GlowTokensSchema = z.object({
  color: z.string(),
  /** Blur radius in px at unit = 1 (reference 1080p). */
  blur: z.string(),
  strength: z.number().min(0).max(1).optional()
});

export const StyleTokensSchema = z.object({
  colors: z.record(z.string()),
  fonts: z.object({
    display: FontStackSchema,
    body: FontStackSchema,
    mono: FontStackSchema.optional()
  }),
  radii: z.record(z.string()),
  shadows: z.record(z.string()),
  glow: GlowTokensSchema,
  easings: EasingsSchema,
  motion: z.enum(['subtle', 'standard', 'punchy']).default('standard'),
  /** Token paths reserved for enforced brand rules (carried, not enforced yet). */
  locked: z.array(z.string()).default([])
});

export type StyleTokens = z.infer<typeof StyleTokensSchema>;
export type MotionIntensity = StyleTokens['motion'];
export type DeepPartialTokens = z.infer<ReturnType<typeof StyleTokensSchema.deepPartial>>;

export const DEFAULT_TOKENS: StyleTokens = StyleTokensSchema.parse({
  colors: {
    background: '#0B0F19',
    surface: '#1E293B',
    surfaceAlt: '#0F172A',
    text: '#F8FAFC',
    textMuted: '#94A3B8',
    primary: '#3B82F6',
    accent: '#8B5CF6',
    danger: '#EF4444',
    warning: '#F97316',
    success: '#10B981',
    gold: '#F59E0B',
    white: '#FFFFFF',
    black: '#000000'
  },
  fonts: {
    display: ['Montserrat', 'Inter', 'Helvetica Neue', 'Arial', 'sans-serif'],
    body: ['Inter', 'Helvetica Neue', 'Arial', 'sans-serif'],
    mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
  },
  radii: {
    sm: '8px',
    md: '16px',
    lg: '28px',
    xl: '36px',
    pill: '9999px'
  },
  shadows: {
    text: '0 10px 30px rgba(0,0,0,0.85), 0 2px 8px rgba(0,0,0,0.6)',
    card: '0 25px 60px rgba(0,0,0,0.7)',
    soft: '0 4px 14px rgba(0,0,0,0.6)'
  },
  glow: {
    color: '#8B5CF6',
    blur: '35px'
  },
  easings: {},
  motion: 'standard',
  locked: []
});

/**
 * Optional named themes — palette values ported from the old
 * `theme-colors.ts` (Staff India `brand` entry deliberately excluded).
 * Each entry is a partial token override merged over DEFAULT_TOKENS.
 */
export const THEMES: Record<string, DeepPartialTokens> = {
  neutral: {},
  celebration: {
    colors: { primary: '#F59E0B', accent: '#EC4899' }
  },
  birthday: {
    colors: { primary: '#F59E0B', accent: '#A855F7' }
  },
  urgency: {
    colors: { primary: '#EF4444', accent: '#F97316' }
  },
  success: {
    colors: { primary: '#10B981', accent: '#06B6D4' }
  },
  tech: {
    colors: { primary: '#3B82F6', accent: '#8B5CF6' }
  },
  luxury: {
    colors: { primary: '#EAB308', accent: '#F8FAFC' }
  }
};

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep-merge partial tokens over defaults; records merge key-wise. */
export function mergeTokens(
  base: StyleTokens,
  partial: DeepPartialTokens | undefined
): StyleTokens {
  if (!partial) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) continue;
    const baseVal = (base as Record<string, unknown>)[key];
    if (isPlainObject(value) && isPlainObject(baseVal)) {
      out[key] = mergeRecords(baseVal, value);
    } else {
      out[key] = value;
    }
  }
  return StyleTokensSchema.parse(out);
}

function mergeRecords(
  base: Record<string, unknown>,
  partial: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(partial)) {
    if (v === undefined) continue;
    const bv = base[k];
    out[k] = isPlainObject(v) && isPlainObject(bv) ? mergeRecords(bv, v) : v;
  }
  return out;
}

/** Resolve a dotted token path like 'colors.primary' or 'fonts.display'. */
export function resolveTokenPath(tokens: StyleTokens, path: string): string | undefined {
  let cur: unknown = tokens;
  for (const seg of path.split('.')) {
    if (!isPlainObject(cur) && !Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
    if (cur === undefined) return undefined;
  }
  if (typeof cur === 'string') return cur;
  if (Array.isArray(cur)) return cur.map(String).join(', ');
  return undefined;
}
