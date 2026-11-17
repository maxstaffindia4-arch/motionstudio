import type { CanvasSpec, CanvasPresetName } from '../canvas/schema.js';
import { CanvasSpecSchema, presetCanvas } from '../canvas/schema.js';
import { safeArea, safeInset, unit } from '../canvas/geometry.js';
import type { SceneSpec } from '../scene/schema.js';
import { DEFAULT_TOKENS, mergeTokens, type DeepPartialTokens, type StyleTokens } from '../scene/tokens.js';
import type { ComponentContext, ComponentDef } from './types.js';
import { COMPONENTS } from './index.js';

export { COMPONENTS };
export type { ComponentDef, ParamField } from './types.js';

function resolveCanvas(canvas: CanvasSpec | CanvasPresetName): CanvasSpec {
  if (typeof canvas === 'string') return presetCanvas(canvas);
  return CanvasSpecSchema.parse(canvas);
}

/**
 * Build a SceneSpec from a registered component.
 * `params` is validated by the component's zod schema (throws on invalid).
 * `tokens` is a partial override merged over DEFAULT_TOKENS.
 */
export function buildScene(
  componentId: string,
  params: unknown,
  canvas: CanvasSpec | CanvasPresetName,
  tokens?: DeepPartialTokens
): SceneSpec {
  const def = COMPONENTS[componentId];
  if (def === undefined) {
    throw new Error(`unknown component '${componentId}'. Available: ${Object.keys(COMPONENTS).join(', ')}`);
  }
  const c = resolveCanvas(canvas);
  const merged = mergeTokens(DEFAULT_TOKENS, tokens);
  const ctx: ComponentContext = {
    canvas: c,
    tokens: merged,
    unit: unit(c),
    safe: safeArea(c),
    inset: safeInset(c),
    durationSec: c.durationSec,
  };
  const parsed = def.paramsSchema.parse(params ?? {}) as never;
  const elements = def.build(parsed, ctx);
  return {
    specVersion: 1,
    canvas: c,
    ...(tokens !== undefined ? { tokens } : {}),
    background: { kind: 'none' },
    elements,
  };
}
