import { CanvasSpecSchema } from './canvas/schema.js';
import { safeArea, safeInset, unit } from './canvas/geometry.js';
import { SceneSpecSchema } from './scene/schema.js';
import { DEFAULT_TOKENS, mergeTokens, THEMES } from './scene/tokens.js';
import { validateScene } from './scene/validate.js';
import { renderBackground } from './compiler/background.js';
import { newRenderState, renderElements } from './compiler/render-elements.js';
import { emitTimeline } from './compiler/timeline.js';
import { assembleHtml, staticCss, tokenCssVars } from './compiler/html.js';
import type { RenderContext } from './compiler/context.js';
import type { CompileOptions, CompileResult } from './compiler/types.js';

/**
 * Compile a SceneSpec (or raw JSON matching it) into a HyperFrames HTML
 * composition. Pure and deterministic: same input → byte-identical output.
 * Structural problems throw; soft-rule issues come back as warnings (A3).
 */
export function compileScene(input: unknown, opts: CompileOptions = {}): CompileResult {
  const scene = SceneSpecSchema.parse(input);
  const { errors, warnings } = validateScene(scene);
  if (errors.length > 0) {
    throw new Error(`scene validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }

  const target = opts.target ?? 'render';
  const canvas = scene.canvas;
  const u = unit(canvas);

  // Theme preset under user token overrides.
  let themePartial: Parameters<typeof mergeTokens>[1];
  if (scene.theme !== undefined) {
    const t = THEMES[scene.theme];
    if (t === undefined) {
      warnings.push({
        code: 'unknown-theme',
        severity: 'warning',
        message: `unknown theme '${scene.theme}' — ignored`,
      });
    } else {
      themePartial = t;
    }
  }
  const tokens = mergeTokens(mergeTokens(DEFAULT_TOKENS, themePartial), scene.tokens);

  const ctx: RenderContext = {
    canvas,
    tokens,
    unit: u,
    safe: safeArea(canvas),
    inset: safeInset(canvas),
    target,
    warnings,
    motion: { easings: tokens.easings, motion: tokens.motion },
  };

  const bg = renderBackground(scene.background, ctx);
  const state = newRenderState();
  const rendered = renderElements(scene.elements, ctx, state);

  const allTweens = [...bg.tweens, ...rendered.tweens];
  const timelineJs = emitTimeline(allTweens, [...state.preludes]);
  const bodyHtml = bg.html + rendered.html;

  const paramsJson = JSON.stringify({
    canvas: {
      width: canvas.width,
      height: canvas.height,
      fps: canvas.fps,
      durationSec: canvas.durationSec,
      output: canvas.output,
      safeMargins: canvas.safeMargins,
    },
    ...(scene.theme !== undefined ? { theme: scene.theme } : {}),
  });

  const html = assembleHtml({
    canvas,
    varsCss: tokenCssVars(tokens),
    staticCss: staticCss(canvas, u),
    extraCss: bg.css,
    bodyHtml,
    paramsJson,
    timelineJs,
  });

  return { html, assets: ['gsap.min.js'], warnings };
}

