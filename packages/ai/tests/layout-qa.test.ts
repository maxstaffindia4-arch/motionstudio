import { describe, it, expect, afterAll } from 'vitest';
import { layoutQA, closeLayoutBrowser, stageScene } from '../src/index.js';
import type { CanvasSpec, SceneSpec } from '@motion-studio/engine';

function canvas(over: Partial<CanvasSpec> = {}): CanvasSpec {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    durationSec: 4,
    output: 'opaque',
    safeMargins: 'action',
    ...over,
  };
}

function scene(elements: SceneSpec['elements'], c: CanvasSpec, over: Partial<SceneSpec> = {}): SceneSpec {
  return {
    specVersion: 1,
    canvas: c,
    background: { kind: 'solid', color: '#101018' },
    elements,
    ...over,
  };
}

function textEl(id: string, content: string, over: Record<string, unknown> = {}) {
  return {
    type: 'text' as const,
    id,
    content,
    start: 0,
    duration: 4,
    placement: { anchor: 'center' as const, offset: { x: 0, y: 0 } },
    style: {},
    animation: {},
    ...over,
  };
}

const LONG_WORD = 'W'.repeat(400);

afterAll(async () => {
  await closeLayoutBrowser();
});

describe('layoutQA', () => {
  it('flags a horizontally overflowing text scene on landscape AND vertical', async () => {
    for (const c of [
      canvas(),
      canvas({ width: 1080, height: 1920 }),
    ]) {
      const s = scene([textEl('headline', LONG_WORD, { style: { fontSize: 64 } })], c);
      const staged = stageScene(s);
      try {
        const r = await layoutQA(staged, c);
        // oversized text must be flagged (outside-canvas and/or text-overflow)
        expect(r.ok, `canvas ${c.width}x${c.height}`).toBe(false);
        expect(r.issues.some((i) => i.severity === 'error')).toBe(true);
      } finally {
        staged.cleanup();
      }
    }
  });

  it('flags text clipped by an overflow-hidden stack', async () => {
    const c = canvas();
    const s = scene(
      [
        {
          type: 'stack' as const,
          id: 'card',
          direction: 'column' as const,
          gap: 24,
          start: 0,
          duration: 4,
          placement: { anchor: 'center' as const, offset: { x: 0, y: 0 } },
          style: { width: 300, overflow: 'hidden' as const },
          animation: {},
          children: [
            {
              type: 'text' as const,
              id: 'card-text',
              content: LONG_WORD,
              start: 0,
              duration: 4,
              placement: { flow: true as const },
              style: { fontSize: 32 },
              animation: {},
            },
          ],
        },
      ],
      c
    );
    const staged = stageScene(s);
    try {
      const r = await layoutQA(staged, c);
      expect(r.issues.some((i) => i.code === 'text-overflow' && i.severity === 'error')).toBe(true);
    } finally {
      staged.cleanup();
    }
  });

  it('flags empty frames when nothing is visible', async () => {
    const c = canvas({ durationSec: 3 });
    const s = scene(
      [textEl('ghost', 'invisible', { style: { opacity: 0 } })],
      c
    );
    const staged = stageScene(s);
    try {
      const r = await layoutQA(staged, c);
      expect(r.issues.some((i) => i.code === 'empty-frame' && i.severity === 'error')).toBe(true);
    } finally {
      staged.cleanup();
    }
  });

  it('warns on font below unit-scaled floor, exempts caption/label/footnote roles', async () => {
    const c = canvas();
    const s = scene(
      [
        textEl('tiny', 'tiny text', { style: { fontSize: 12 } }),
        textEl('caption-note', 'small caption', {
          placement: { anchor: 'bottom' as const, offset: { x: 0, y: -40 } },
          style: { fontSize: 12 },
        }),
      ],
      c
    );
    const staged = stageScene(s);
    try {
      const r = await layoutQA(staged, c);
      const small = r.issues.filter((i) => i.code === 'font-too-small');
      expect(small.some((i) => i.elementId === 'tiny')).toBe(true);
      expect(small.some((i) => i.elementId === 'caption-note')).toBe(false);
      // warnings only — not blocking
      expect(r.ok).toBe(true);
    } finally {
      staged.cleanup();
    }
  });

  it('passes a clean scene', async () => {
    const c = canvas();
    const s = scene([textEl('headline', 'Clean headline')], c);
    const staged = stageScene(s);
    try {
      const r = await layoutQA(staged, c);
      expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
      expect(r.sampledAt.length).toBeGreaterThanOrEqual(3);
    } finally {
      staged.cleanup();
    }
  });
});
