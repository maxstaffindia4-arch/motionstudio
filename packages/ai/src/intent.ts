import type { Anchor } from '@motion-studio/engine';

/**
 * Intent routing — ports of Motion Lab `routeArchetype` / theme detection,
 * DEMOTED TO HINTS: the result is injected into the prompt for the model,
 * never enforced in code.
 */

export interface RouteHint {
  component?: string;
  confidence: number;
  reason: string;
}

const RULES: Array<{ component: string; pattern: RegExp; reason: string }> = [
  { component: 'strike-checklist', pattern: /\bstrike[- ]?through|\bstrike|\bchecklist\b/i, reason: 'prompt mentions strike-through or checklist' },
  { component: 'text-slam', pattern: /\bslam|\bsmash|\bimpact\b/i, reason: 'prompt mentions a slam/impact entrance' },
  { component: 'keyword-pop', pattern: /\bkeyword|\bpop\b/i, reason: 'prompt mentions keyword pops' },
  { component: 'lower-third', pattern: /lower[- ]third|\bname bar\b|\btitle bar\b/i, reason: 'prompt asks for a lower third' },
  { component: 'icon-cards', pattern: /\bicon|\bcards?\b/i, reason: 'prompt asks for icon cards' },
  { component: 'step-card', pattern: /\bstep\b|\bprocess\b|\bworkflow\b/i, reason: 'prompt describes steps' },
  { component: 'end-card', pattern: /\bend card\b|\bcta\b|\bsubscribe\b|\blogo outro\b/i, reason: 'prompt asks for an end card' },
  { component: 'caption-track', pattern: /\bcaption|\bsubtitle|\bsub-?title\b/i, reason: 'prompt asks for captions' },
  { component: 'number-counter', pattern: /\bcounter|\bcount[- ]?up|\bpercent|\b\d+%\b/i, reason: 'prompt asks for a counter' },
  { component: 'whip-transition', pattern: /\bwhip|\bswipe|\btransition\b/i, reason: 'prompt asks for a whip transition' },
  { component: 'glow-sweep', pattern: /\bglow|\bsweep|\bshine\b/i, reason: 'prompt asks for a glow sweep' },
];

/** Rules-first classifier — deterministic, no tokens spent. */
export function routeIntent(prompt: string): RouteHint {
  for (const rule of RULES) {
    if (rule.pattern.test(prompt)) {
      return { component: rule.component, confidence: 0.8, reason: rule.reason };
    }
  }
  return { confidence: 0.3, reason: 'no archetype rule matched' };
}

/** Keyword → engine theme preset (THEMES keys). Hint only. */
const THEME_RULES: Array<{ theme: string; pattern: RegExp }> = [
  { theme: 'celebration', pattern: /\bcelebrat|\bfestiv|\bparty\b/i },
  { theme: 'birthday', pattern: /\bbirthday|\bbirth\b|\bcake\b/i },
  { theme: 'urgency', pattern: /\burgent|\bdeadline|\blimited time|\bhurry\b/i },
  { theme: 'success', pattern: /\bsuccess|\bwin|\bachievement|\bmilestone\b/i },
  { theme: 'tech', pattern: /\btech|\bai\b|\bsoftware|\bstartup|\bdigital\b/i },
  { theme: 'luxury', pattern: /\bluxury|\bpremium|\belegant|\bhigh[- ]?end\b/i },
];

export function detectThemeHint(prompt: string): string | undefined {
  for (const rule of THEME_RULES) {
    if (rule.pattern.test(prompt)) return rule.theme;
  }
  return undefined;
}

/** Split a "TEXT: A / B / C" section into items; fall back to quoted text. */
export function extractTextItems(prompt: string): string[] {
  const textSection = prompt.match(/TEXT:\s*([\s\S]*?)\s*\/\s*(?:STYLE|BEATS|OUTPUT|SHOT)\b/is);
  if (textSection) {
    const parts = (textSection[1] ?? '')
      .split(/\s*\/\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length) return parts;
  }
  const quoted = prompt.match(/"([^"]+)"|“([^”]+)”/);
  if (quoted) return [(quoted[1] || quoted[2] || '').trim()].filter(Boolean);

  const phrase = prompt.match(
    /(?:overlay\s+text|on-?screen\s+text|text)\s*(?:animates?\s+in|reads?|says?|shows?|:)?\s*([A-Z][\w'’,-]*(?:\s+[A-Z][\w'’,-]*){0,4})/
  );
  if (phrase) return [(phrase[1] ?? '').trim()].filter(Boolean);

  // "Label: A / B / C" — colon followed by 2+ capitalized segments split by '/'.
  const labelled = prompt.match(/:\s*([A-Z][^"“”\n]*(?:\s*\/\s*[A-Z][^"“”\n]*)+)/);
  if (labelled) {
    const parts = (labelled[1] ?? '')
      .split(/\s*\/\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) return parts;
  }
  return [];
}

/** First bare number in the prompt (for number-counter target etc.). */
export function extractNumber(prompt: string): number | undefined {
  const m = prompt.match(/(\d[\d,]*)/);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

/** Anchor keyword hint → engine Anchor. */
export function detectAnchorHint(prompt: string): Anchor | undefined {
  if (/\btop[- ]?left|\bupper left\b/i.test(prompt)) return 'top-left';
  if (/\btop[- ]?right|\bupper right\b/i.test(prompt)) return 'top-right';
  if (/\bbottom[- ]?left|\blower left\b|\blower third\b/i.test(prompt)) return 'bottom-left';
  if (/\bbottom[- ]?right|\blower right\b/i.test(prompt)) return 'bottom-right';
  if (/\btop\b|\bupper\b|\bheadline\b/i.test(prompt)) return 'top';
  if (/\bbottom\b|\blower\b/i.test(prompt)) return 'bottom';
  if (/\bleft\b/i.test(prompt)) return 'left';
  if (/\bright\b/i.test(prompt)) return 'right';
  if (/\bcenter(?:ed)?\b/i.test(prompt)) return 'center';
  return undefined;
}
