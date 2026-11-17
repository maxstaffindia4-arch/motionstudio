import { describe, expect, it } from 'vitest';
import { anchorFlex, anchorPoint, safeArea, safeInset, unit } from '../src/canvas/geometry.js';
import { CANVAS_PRESETS, CanvasSpecSchema, presetCanvas } from '../src/canvas/schema.js';

const base = { width: 1920, height: 1080, fps: 30, durationSec: 5, output: 'opaque' as const, safeMargins: 'action' as const };

describe('CanvasSpecSchema', () => {
  it('applies defaults', () => {
    const c = CanvasSpecSchema.parse({ width: 100, height: 100, durationSec: 3 });
    expect(c.fps).toBe(30);
    expect(c.output).toBe('opaque');
    expect(c.safeMargins).toBe('action');
  });

  it('rejects invalid values', () => {
    expect(() => CanvasSpecSchema.parse({ width: 0, height: 100, durationSec: 1 })).toThrow();
    expect(() =>
      CanvasSpecSchema.parse({ width: 100, height: 100, durationSec: 1, output: 'alpha' })
    ).toThrow();
  });
});

describe('presets', () => {
  it('defines landscape, vertical, square', () => {
    expect(CANVAS_PRESETS.landscape).toEqual({ width: 1920, height: 1080 });
    expect(CANVAS_PRESETS.vertical).toEqual({ width: 1080, height: 1920 });
    expect(CANVAS_PRESETS.square).toEqual({ width: 1080, height: 1080 });
  });

  it('presetCanvas builds a full spec with overrides', () => {
    const c = presetCanvas('vertical', { output: 'transparent' });
    expect(c.width).toBe(1080);
    expect(c.height).toBe(1920);
    expect(c.output).toBe('transparent');
  });
});

describe('unit', () => {
  it('is orientation-agnostic (short side / 1080)', () => {
    expect(unit(base)).toBe(1);
    expect(unit({ width: 1080, height: 1920 })).toBe(1);
    expect(unit({ width: 2160, height: 3840 })).toBe(2);
    expect(unit({ width: 540, height: 960 })).toBe(0.5);
  });
});

describe('safeArea', () => {
  it('action = 5% inset per side (90% area)', () => {
    const c = CanvasSpecSchema.parse(base);
    expect(safeInset(c)).toEqual({ x: 96, y: 54 });
    const a = safeArea(c);
    expect(a).toEqual({ x: 96, y: 54, width: 1728, height: 972 });
  });

  it('title = 10% inset per side (80% area)', () => {
    const c = CanvasSpecSchema.parse({ ...base, safeMargins: 'title' });
    expect(safeInset(c)).toEqual({ x: 192, y: 108 });
    const a = safeArea(c);
    expect(a.width / c.width).toBeCloseTo(0.8);
    expect(a.height / c.height).toBeCloseTo(0.8);
  });

  it('off = no inset', () => {
    const c = CanvasSpecSchema.parse({ ...base, safeMargins: 'off' });
    expect(safeArea(c)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});

describe('anchorPoint', () => {
  const c = CanvasSpecSchema.parse(base);

  it('center anchor hits safe-area center', () => {
    const a = safeArea(c);
    expect(anchorPoint(c, 'center')).toEqual({ x: a.x + a.width / 2, y: a.y + a.height / 2 });
  });

  it('corners hit safe-area corners', () => {
    const a = safeArea(c);
    expect(anchorPoint(c, 'top-left')).toEqual({ x: a.x, y: a.y });
    expect(anchorPoint(c, 'bottom-right')).toEqual({ x: a.x + a.width, y: a.y + a.height });
  });

  it('applies offset', () => {
    expect(anchorPoint(c, 'center', { x: 10, y: -5 })).toEqual({
      x: safeArea(c).x + safeArea(c).width / 2 + 10,
      y: safeArea(c).y + safeArea(c).height / 2 - 5
    });
  });
});

describe('anchorFlex', () => {
  it('maps anchors to flex alignment', () => {
    expect(anchorFlex('top-left')).toEqual({ justify: 'flex-start', align: 'flex-start' });
    expect(anchorFlex('center')).toEqual({ justify: 'center', align: 'center' });
    expect(anchorFlex('bottom-right')).toEqual({ justify: 'flex-end', align: 'flex-end' });
    expect(anchorFlex('bottom')).toEqual({ justify: 'center', align: 'flex-end' });
  });
});
