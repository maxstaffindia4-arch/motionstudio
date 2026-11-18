/**
 * Verbatim text lock: quoted spans in the user prompt + explicit
 * lockedText[] must appear EXACTLY in the compiled DOM text.
 * Ported from Motion Lab's visibleText/extractDraftedText approach.
 */

/** All "…" and “…” quoted spans in the prompt, in order, deduped. */
export function extractQuotedText(prompt: string): string[] {
  const out: string[] = [];
  const re = /"([^"\n]{1,200})"|“([^”\n]{1,200})”/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) {
    const s = (m[1] ?? m[2] ?? '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Strip tags/scripts/styles and normalize whitespace → visible DOM text. */
export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface VerbatimResult {
  ok: boolean;
  /** Required strings missing from the visible text. */
  missing: string[];
}

/**
 * Every required string must appear in the compiled HTML's visible text.
 * Comparison is exact (case-sensitive) after whitespace normalization on
 * both sides — quotes in the prompt are the contract.
 */
export function checkVerbatim(html: string, required: string[]): VerbatimResult {
  const hay = visibleText(html);
  const missing = required.filter((s) => {
    const needle = s.replace(/\s+/g, ' ').trim();
    return needle.length > 0 && !hay.includes(needle);
  });
  return { ok: missing.length === 0, missing };
}

/** Combine prompt quotes + explicit lockedText into the required set. */
export function verbatimRequirements(prompt: string, lockedText?: string[]): string[] {
  const out = extractQuotedText(prompt);
  for (const s of lockedText ?? []) {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}
