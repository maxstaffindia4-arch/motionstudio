import type { CanvasSpec, SafeMargin } from './schema.js';

export const REFERENCE_SIDE = 1080;

/** Scale factor: 1.0 at 1080 on the short side, orientation-agnostic. */
export function unit(canvas: Pick<CanvasSpec, 'width' | 'height'>): number {
  return Math.min(canvas.width, canvas.height) / REFERENCE_SIDE;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Per-side inset fraction for each safe-margin mode (A2). */
const SAFE_INSET: Record<SafeMargin, number> = {
  off: 0,
  action: 0.05, // 90% action-safe → 5% inset per side
  title: 0.1 // 80% title-safe → 10% inset per side
};

export function safeInset(canvas: CanvasSpec): { x: number; y: number } {
  const f = SAFE_INSET[canvas.safeMargins];
  return { x: canvas.width * f, y: canvas.height * f };
}

/** The rectangle all critical content must stay inside. */
export function safeArea(canvas: CanvasSpec): Rect {
  const i = safeInset(canvas);
  return { x: i.x, y: i.y, width: canvas.width - i.x * 2, height: canvas.height - i.y * 2 };
}

export const ANCHORS = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right'
] as const;

export type Anchor = (typeof ANCHORS)[number];

export interface PxOffset {
  x: number;
  y: number;
}

/**
 * Pixel position of a 9-point anchor within the safe area, plus an offset.
 * Pure math helper — used by tests and tools. The compiler itself positions
 * anchored elements with flex wrappers (see ENGINE_DESIGN.md A1), which keeps
 * them inside the safe area by construction.
 */
export function anchorPoint(
  canvas: CanvasSpec,
  anchor: Anchor,
  offset: PxOffset = { x: 0, y: 0 }
): { x: number; y: number } {
  const a = safeArea(canvas);
  const col = anchor.endsWith('left') ? 0 : anchor.endsWith('right') ? 1 : 0.5;
  const row = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? 1 : 0.5;
  return { x: a.x + a.width * col + offset.x, y: a.y + a.height * row + offset.y };
}

/** Flex alignment mapping for an anchor, used to build `.anchor` wrappers. */
export function anchorFlex(anchor: Anchor): {
  justify: 'flex-start' | 'center' | 'flex-end';
  align: 'flex-start' | 'center' | 'flex-end';
} {
  const justify = anchor.endsWith('left')
    ? 'flex-start'
    : anchor.endsWith('right')
      ? 'flex-end'
      : 'center';
  const align = anchor.startsWith('top')
    ? 'flex-start'
    : anchor.startsWith('bottom')
      ? 'flex-end'
      : 'center';
  return { justify, align };
}
