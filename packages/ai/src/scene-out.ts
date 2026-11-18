import { z } from 'zod';
import {
  BackgroundSchema,
  CanvasSpecSchema,
  COMPONENTS,
  presetCanvas,
  SceneSpecSchema,
  StyleTokensSchema,
  buildScene,
  validateScene,
  type CanvasSpec,
  type Element,
  type SceneSpec,
} from '@motion-studio/engine';
import { AiError } from './providers/errors.js';
import { extractTextItems, extractNumber, routeIntent } from './intent.js';
import type { GenerationSettings } from './types.js';

// ---------------------------------------------------------------------------
// settings → canvas (authoritative — model values are always overwritten)
// ---------------------------------------------------------------------------

export function settingsToCanvas(settings: GenerationSettings): CanvasSpec {
  const base =
    settings.canvas.preset === 'custom'
      ? { width: settings.canvas.width, height: settings.canvas.height }
      : { width: presetCanvas(settings.canvas.preset).width, height: presetCanvas(settings.canvas.preset).height };
  return CanvasSpecSchema.parse({
    ...base,
    fps: settings.fps ?? 30,
    durationSec: Math.min(30, Math.max(1, settings.durationSec ?? 5)),
    output: settings.output,
    safeMargins: settings.safeMargins ?? 'action',
  });
}

// ---------------------------------------------------------------------------
// model output → SceneSpec
// ---------------------------------------------------------------------------

const ComponentChoiceSchema = z.object({
  component: z.string().min(1),
  params: z.record(z.unknown()).optional(),
  tokens: StyleTokensSchema.deepPartial().optional(),
  theme: z.string().optional(),
  background: BackgroundSchema.optional(),
});

/** Union of the two accepted model output shapes. */
export const ModelOutputSchema = z.union([SceneSpecSchema, ComponentChoiceSchema]);
export type ModelOutput = z.infer<typeof ModelOutputSchema>;

export interface ParsedScene {
  scene: SceneSpec;
  /** Component id when shape A was used. */
  component: string | undefined;
}

/**
 * Parse raw model output (already schema-validated by generateObject, but
 * re-parse defensively for json mode / FakeProvider). Throws AiError
 * 'bad_output' on unrecognised shapes — repairable by the loop.
 */
export function parseModelOutput(raw: unknown, settings: GenerationSettings): ParsedScene {
  const canvas = settingsToCanvas(settings);
  const parsed = ModelOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AiError('bad_output', `model output failed schema validation: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const out = parsed.data;

  if ('specVersion' in out) {
    return { scene: enforceSettings(out, settings), component: undefined };
  }

  const def = COMPONENTS[out.component];
  if (!def) {
    throw new AiError(
      'bad_output',
      `unknown component '${out.component}'. Available: ${Object.keys(COMPONENTS).join(', ')}`
    );
  }
  let scene: SceneSpec;
  try {
    scene = buildScene(out.component, out.params ?? {}, canvas, out.tokens as never);
  } catch (e) {
    throw new AiError('bad_output', `component '${out.component}' params invalid: ${(e as Error).message.slice(0, 300)}`);
  }
  if (out.theme !== undefined) scene.theme = out.theme;
  if (out.background !== undefined) scene.background = out.background;
  return { scene: enforceSettings(scene, settings), component: out.component };
}

/** Overwrite canvas (and nothing else) with the authoritative settings canvas. */
export function enforceSettings(scene: SceneSpec, settings: GenerationSettings): SceneSpec {
  return { ...scene, canvas: settingsToCanvas(settings) };
}

/** Structural validation issues as strings (for repair prompts). */
export function sceneIssues(scene: SceneSpec): { errors: string[]; warnings: string[] } {
  const r = validateScene(scene);
  return { errors: r.errors, warnings: r.warnings.map((w) => w.message) };
}

// ---------------------------------------------------------------------------
// template strategy — deterministic component params from prompt text
// ---------------------------------------------------------------------------

export interface TemplatePlan {
  component: string;
  params: Record<string, unknown>;
  reason: string;
}

function joinItems(items: string[]): string {
  return items.join(' ');
}

/**
 * Deterministic template path: routeIntent picks the component, extracted
 * text items fill its params with schema defaults for everything else.
 * No LLM call — used for strategy 'template' and as the model-failure
 * fallback.
 */
export function buildTemplatePlan(prompt: string, routeComponent?: string): TemplatePlan | null {
  const component = routeComponent ?? routeIntent(prompt).component ?? 'text-slam';
  const def = COMPONENTS[component];
  if (!def) return null;
  const items = extractTextItems(prompt);
  const text = joinItems(items);
  const num = extractNumber(prompt);

  let params: Record<string, unknown> = {};
  switch (component) {
    case 'text-slam':
      params = { text: text || 'Your headline text', highlightWords: '' };
      break;
    case 'keyword-pop':
      params = { keyword: items[0] ?? 'KEYWORD', subtext: items.slice(1).join(' ') };
      break;
    case 'strike-checklist':
      params = { items: items.length ? items.join(',') : 'One,Two,Three' };
      break;
    case 'lower-third':
      params = { name: items[0] ?? 'Name', title: items[1] ?? '', company: items[2] ?? '' };
      break;
    case 'icon-cards':
      params = { heading: items[0] ?? '', cards: items.slice(1).join(',') || 'Feature,Feature,Feature' };
      break;
    case 'step-card':
      params = { badge: 'STEP 01', title: items[0] ?? 'Step title', description: items.slice(1).join(' ') };
      break;
    case 'end-card':
      params = { brandName: items[0] ?? 'Your Brand', ctaText: items[1] ?? '', website: '' };
      break;
    case 'caption-track':
      params = { text: text || 'caption words here' };
      break;
    case 'number-counter':
      params = { target: num ?? 100, label: items.join(' ') };
      break;
    case 'whip-transition':
      params = {};
      break;
    case 'glow-sweep':
      params = { text: text || 'Headline' };
      break;
    default:
      return null;
  }
  return { component, params, reason: `template fallback for '${component}'` };
}

// ---------------------------------------------------------------------------
// manual-element guard (amendment 3)
// ---------------------------------------------------------------------------

function indexElements(scene: SceneSpec): Map<string, { el: Element; parent?: Element[]; index: number }> {
  const map = new Map<string, { el: Element; parent?: Element[]; index: number }>();
  const walk = (els: Element[], parent?: Element[]) => {
    els.forEach((el, i) => {
      map.set(el.id, { el, ...(parent ? { parent } : {}), index: i });
      if (el.type === 'stack') walk(el.children, el.children);
    });
  };
  walk(scene.elements);
  return map;
}

function elementEquals(a: Element, b: Element): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** True when the user text mentions this element (id or text content). */
function isReferenced(el: Element, haystack: string): boolean {
  if (haystack.includes(el.id)) return true;
  if (el.type === 'text' && el.content && haystack.includes(el.content)) return true;
  return false;
}

/**
 * Post-generation guard: elements flagged `manual: true` in the PREVIOUS
 * scene may not be changed or removed by a generation/edit unless the
 * user's prompt/instruction references them. Reverts silently and reports
 * the reverted ids.
 */
export function applyManualGuard(
  next: SceneSpec,
  prev: SceneSpec | undefined,
  userText: string
): { scene: SceneSpec; reverted: string[] } {
  if (!prev) return { scene: next, reverted: [] };
  const prevIndex = indexElements(prev);
  const manualPrev = [...prevIndex.values()].filter((e) => e.el.manual === true);
  if (manualPrev.length === 0) return { scene: next, reverted: [] };

  const scene = structuredClone(next);
  const nextIndex = indexElements(scene);
  const reverted: string[] = [];

  for (const { el: prevEl, parent: prevParent, index: prevIndexInParent } of manualPrev) {
    if (isReferenced(prevEl, userText)) continue;
    const cur = nextIndex.get(prevEl.id);
    const changed = !cur || !elementEquals(cur.el, prevEl);
    if (!changed) continue;

    if (cur) {
      // Replace in place.
      const container = cur.parent ?? scene.elements;
      container[cur.index] = structuredClone(prevEl);
    } else {
      // Deleted — restore. Parent tracking isn't kept across scenes, so a
      // removed stack child is restored at top level (stub: still protects
      // the content; placement may differ).
      scene.elements.splice(Math.min(prevIndexInParent, scene.elements.length), 0, structuredClone(prevEl));
    }
    reverted.push(prevEl.id);
  }
  return { scene, reverted };
}
