/** Context-aware escaping for generated HTML/CSS/JS. */

export function escText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escAttr(s: string): string {
  return escText(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Escape a string for use inside a single-quoted JS string literal. */
export function escJsString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/** CSS string literal (double-quoted). */
export function escCssString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

/** Quote a font family name unless it's a CSS generic. */
const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace',
  'ui-rounded', 'emoji', 'math', 'fangsong'
]);

export function fontFamilyCss(stack: string[]): string {
  return stack
    .map((f) => {
      const name = f.trim();
      if (GENERIC_FAMILIES.has(name.toLowerCase())) return name;
      return /[\s,]/.test(name) || /[A-Z]/.test(name) ? `"${escCssString(name)}"` : name;
    })
    .join(', ');
}
