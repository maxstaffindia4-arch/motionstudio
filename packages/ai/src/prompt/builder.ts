import type { GenerationInput, GenerationSettings } from '../types.js';
import type { RouteHint } from '../intent.js';
import { buildMemorySection } from '../memory.js';
import { sceneSpecDoc } from './spec-docs.js';
import { catalogText } from './catalog.js';
import { presetCanvas, unit, safeArea, CanvasSpecSchema } from '@motion-studio/engine';

export const PROMPT_VERSION = 'p2-2026-11-18';

const HF_RULES_ESSENTIALS = `## HYPERFRAMES RULES (what the compiler emits — respect them in custom scenes)
- Deterministic, seekable GSAP timeline paused and registered on window.__timelines["main"].
- No remote URLs: no CDN scripts, remote images or fonts. Local assets/ or inline SVG/CSS only.
- Animate only opacity/translate/scale/rotate via the timeline — never layout properties, never Date.now/setTimeout/Math.random.
- Keep critical text inside the safe area; body text >= 48px at 1080p reference (scale by canvas unit).
- Multi-item layouts use flex/grid with explicit gap (min 24 spec units); never stack absolutely-positioned items without distinct offsets.
- Verbatim-marked text must be preserved exactly — never rewrite, spell-check or drop words.`;

function canvasFacts(settings: GenerationSettings): { canvas: ReturnType<typeof presetCanvas>; text: string } {
  const canvas =
    settings.canvas.preset === 'custom'
      ? CanvasSpecSchema.parse({
          width: settings.canvas.width,
          height: settings.canvas.height,
          fps: settings.fps ?? 30,
          durationSec: settings.durationSec ?? 5,
          output: settings.output,
          safeMargins: settings.safeMargins ?? 'action',
        })
      : presetCanvas(settings.canvas.preset, {
          fps: settings.fps ?? 30,
          durationSec: settings.durationSec ?? 5,
          output: settings.output,
          safeMargins: settings.safeMargins ?? 'action',
        });
  const u = unit(canvas);
  const safe = safeArea(canvas);
  const text = [
    `- size: ${canvas.width}x${canvas.height} @ ${canvas.fps}fps, duration ${canvas.durationSec}s`,
    `- unit (min side / 1080): ${u.toFixed(3)} — px values in the scene are at unit=1 reference`,
    `- output: ${canvas.output}${canvas.output === 'transparent' ? ' (background must be {"kind":"none"} or previewOnly)' : ''}`,
    `- safeMargins: ${canvas.safeMargins} → safe area ${Math.round(safe.width)}x${Math.round(safe.height)} at (${Math.round(safe.x)},${Math.round(safe.y)})`,
    `- motion intensity: ${settings.motion ?? 'standard'}`,
  ].join('\n');
  return { canvas, text };
}

export interface BuiltPrompts {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  memoryTokens: number;
}

export function buildPrompts(
  input: GenerationInput,
  hints: { route: RouteHint; theme?: string }
): BuiltPrompts {
  const { canvas, text: canvasText } = canvasFacts(input.settings);
  const memory = buildMemorySection(input.projectMemory);

  const systemParts: string[] = [
    `You are a senior motion-graphics engineer producing Motion Studio scene specifications (PROMPT_VERSION ${PROMPT_VERSION}).`,
    '',
    '## OUTPUT CONTRACT',
    'Return ONE JSON object — either shape A {"component","params",...} for a known component, or shape B a full SceneSpec. No HTML, no markdown fences, no commentary.',
    'Canvas, duration, fps and output mode are enforced by code — do NOT invent your own canvas values; the canvas facts below are authoritative.',
    '',
    sceneSpecDoc(),
    '',
    catalogText(),
    '',
    HF_RULES_ESSENTIALS,
    '',
    '## CANVAS FACTS (authoritative — enforced after generation)',
    canvasText,
  ];
  if (input.settings.background) {
    systemParts.push(`- requested background style: ${input.settings.background} (hint — express via scene.background or component params)`);
  }
  if (input.settings.anchor) {
    systemParts.push(`- preferred anchor: ${input.settings.anchor} (hint)`);
  }
  if (memory.text) {
    systemParts.push('', memory.text);
  }
  systemParts.push(
    '',
    'The current user request overrides earlier project instructions when they conflict.'
  );

  const userParts: string[] = [];
  if (hints.route.component) {
    userParts.push(
      `HINT (not a constraint): this prompt resembles the '${hints.route.component}' component (${hints.route.reason}). Prefer it unless the request clearly needs something else.`
    );
  }
  if (hints.theme) {
    userParts.push(`HINT: theme '${hints.theme}' may fit — set scene.theme or matching token colors if appropriate.`);
  }
  userParts.push('', '## REQUEST', input.prompt);

  if (input.previous) {
    userParts.push(
      '',
      '## EDIT MODE',
      `Apply this instruction to the previous scene: "${input.previous.instruction}"`,
      'Return the FULL updated scene JSON. Preserve element ids and every property the instruction does not mention.',
      'Previous scene:',
      '```json',
      JSON.stringify(input.previous.scene, null, 2),
      '```'
    );
  }

  return {
    system: systemParts.join('\n'),
    messages: [{ role: 'user', content: userParts.join('\n') }],
    memoryTokens: memory.tokens,
  };
}
