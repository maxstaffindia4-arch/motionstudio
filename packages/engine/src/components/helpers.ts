import type { Anchor, PxOffset } from '../canvas/geometry.js';
import type {
  AnimationSpec,
  Element,
  ImageElement,
  Placement,
  ShapeElement,
  StackElement,
  TextElement,
  TextStyle,
  ShapeStyle,
  ImageStyle,
  StackStyle,
} from '../elements/schema.js';
import type { AssetRef, StyleValue } from '../elements/style.js';

interface Base {
  id: string;
  start?: number;
  duration: number;
  anchor?: Anchor;
  offset?: PxOffset;
  flow?: boolean;
  animation?: { in?: AnimationSpec | undefined; out?: AnimationSpec | undefined };
}

function placement(b: Base): Placement {
  if (b.flow) return { flow: true };
  return {
    anchor: b.anchor ?? 'center',
    offset: { x: b.offset?.x ?? 0, y: b.offset?.y ?? 0 },
  };
}

function timing(b: Base) {
  return {
    id: b.id,
    start: b.start ?? 0,
    duration: b.duration,
    placement: placement(b),
    animation: b.animation ?? {},
  };
}

export function txt(
  b: Base & { content: string; style?: TextStyle }
): TextElement {
  return { type: 'text', content: b.content, style: b.style ?? {}, ...timing(b) };
}

export function shp(
  b: Base & { shape: 'rect' | 'pill' | 'line'; style?: ShapeStyle }
): ShapeElement {
  return { type: 'shape', shape: b.shape, style: b.style ?? {}, ...timing(b) };
}

export function img(
  b: Base & { asset: AssetRef; style?: ImageStyle }
): ImageElement {
  return { type: 'image', asset: b.asset, style: b.style ?? {}, ...timing(b) };
}

export function stk(
  b: Base & {
    direction?: 'row' | 'column' | 'grid';
    columns?: number;
    gap?: number;
    align?: 'start' | 'center' | 'end' | 'stretch';
    justify?: 'start' | 'center' | 'end' | 'between' | 'around';
    wrap?: boolean;
    style?: StackStyle;
    children: Element[];
  }
): StackElement {
  return {
    type: 'stack',
    direction: b.direction ?? 'column',
    ...(b.columns !== undefined ? { columns: b.columns } : {}),
    gap: b.gap ?? 24,
    ...(b.align !== undefined ? { align: b.align } : {}),
    ...(b.justify !== undefined ? { justify: b.justify } : {}),
    ...(b.wrap !== undefined ? { wrap: b.wrap } : {}),
    style: b.style ?? {},
    children: b.children,
    ...timing(b),
  };
}

/** Convenience: token reference for a style value. */
export function tok(path: string): StyleValue {
  return { token: path };
}
