import { describe, it, expect } from 'vitest';
import { lintScene } from '../src/index.js';
import { presetCanvas, buildScene } from '@motion-studio/engine';

describe('lintScene', () => {
  it('runs hyperframes lint --json on a compiled scene', async () => {
    const canvas = presetCanvas('landscape', { durationSec: 4 });
    const scene = buildScene('text-slam', { text: 'Lint me', highlightWords: 'Lint' }, canvas);
    const r = await lintScene(scene, { timeoutMs: 90_000 });
    try {
      expect(r.lint.findings.length).toBeGreaterThanOrEqual(0);
      expect(typeof r.lint.errorCount).toBe('number');
      expect(r.html).toContain('gsap.min.js');
      // compile warnings surfaced separately
      expect(Array.isArray(r.compileWarnings)).toBe(true);
    } finally {
      r.cleanup();
    }
  }, 120_000);
});
