import type { TweenCall } from './render-elements.js';

/**
 * Timeline emission (A9): DOM order follows the scene array; only the
 * GSAP calls are sorted by (time, element id, emission seq) for stable output.
 */
export function emitTimeline(tweens: TweenCall[], preludes: string[]): string {
  const sorted = [...tweens].sort(
    (a, b) => a.time - b.time || a.id.localeCompare(b.id) || a.seq - b.seq
  );
  const lines: string[] = [];
  for (const p of preludes) lines.push(`    ${p}`);
  for (const t of sorted) lines.push(`    ${t.code}`);
  return lines.join('\n');
}
