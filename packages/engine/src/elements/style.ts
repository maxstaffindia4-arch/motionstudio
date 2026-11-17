import { z } from 'zod';
import { resolveTokenPath, type StyleTokens } from '../scene/tokens.js';

/**
 * A style value is either a literal or a token reference.
 * Token refs look like { token: 'colors.primary' }.
 */
export const TokenRefSchema = z.object({ token: z.string().min(1) });
export type TokenRef = z.infer<typeof TokenRefSchema>;

export const StyleValueSchema = z.union([z.string(), z.number(), TokenRefSchema]);
export type StyleValue = z.infer<typeof StyleValueSchema>;

export function isTokenRef(v: StyleValue): v is TokenRef {
  return typeof v === 'object' && v !== null && 'token' in v;
}

export interface ResolveContext {
  tokens: StyleTokens;
  /** Called when a token path can't be resolved; returns fallback string. */
  onMissing?: (path: string) => void;
}

/**
 * Resolve a StyleValue to a CSS-ready string.
 * Missing tokens warn (via onMissing) and fall back to 'inherit'-safe defaults
 * handled by the caller — here we return the fallback or empty string.
 */
export function resolveStyleValue(v: StyleValue, ctx: ResolveContext): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  const hit = resolveTokenPath(ctx.tokens, v.token);
  if (hit !== undefined) return hit;
  ctx.onMissing?.(v.token);
  return '';
}

/**
 * Asset references are local relative paths only (A5).
 * Rejects URLs, protocol-relative, absolute and traversal paths.
 */
export const AssetRefSchema = z
  .string()
  .min(1)
  .refine(
    (s) =>
      !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) &&
      !s.startsWith('/') &&
      !s.startsWith('//') &&
      !s.split(/[\\/]/).includes('..'),
    { message: 'asset must be a local relative path (no URLs, absolute paths or "..")' }
  );
export type AssetRef = z.infer<typeof AssetRefSchema>;
