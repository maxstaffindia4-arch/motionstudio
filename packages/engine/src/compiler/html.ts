import type { CanvasSpec } from '../canvas/schema.js';
import type { StyleTokens } from '../scene/tokens.js';
import { fontFamilyCss } from './escape.js';
import { round3 } from './context.js';

/** Strip characters that could break out of a CSS declaration. */
function cssSafe(v: string): string {
  return v.replace(/[;{}<>]/g, '');
}

export function tokenCssVars(tokens: StyleTokens): string {
  const decls: string[] = [];
  for (const [k, v] of Object.entries(tokens.colors)) {
    decls.push(`--color-${k}:${cssSafe(v)}`);
  }
  for (const [k, stack] of Object.entries(tokens.fonts)) {
    if (stack) decls.push(`--font-${k}:${fontFamilyCss(stack)}`);
  }
  for (const [k, v] of Object.entries(tokens.radii)) {
    decls.push(`--radius-${k}:${cssSafe(v)}`);
  }
  for (const [k, v] of Object.entries(tokens.shadows)) {
    decls.push(`--shadow-${k}:${cssSafe(v)}`);
  }
  decls.push(`--glow-color:${cssSafe(tokens.glow.color)}`);
  decls.push(`--glow-blur:${cssSafe(tokens.glow.blur)}`);
  decls.push(`--ease-arrival:${cssSafe(tokens.easings.arrival)}`);
  decls.push(`--ease-exit:${cssSafe(tokens.easings.exit)}`);
  decls.push(`--ease-pop:${cssSafe(tokens.easings.pop)}`);
  if (tokens.easings.strike) decls.push(`--ease-strike:${cssSafe(tokens.easings.strike)}`);
  decls.push(`--motion:${tokens.motion}`);
  return decls.join(';');
}

export function staticCss(canvas: CanvasSpec, unit: number): string {
  const strikeH = round3(10 * unit);
  const bodyBg = canvas.output === 'transparent' ? 'transparent' : 'var(--color-background,#0B0F19)';
  return `html,body{margin:0;padding:0;width:${canvas.width}px;height:${canvas.height}px;overflow:hidden;background:${bodyBg}}
body{font-family:var(--font-body)}
#root{position:relative;width:100%;height:100%}
.anchor{position:absolute;display:flex}
.clip{will-change:transform,opacity}
.wipe-clip{overflow:hidden}
.wipe-inner{will-change:transform}
.strike-host{position:relative;display:inline-block}
.strike-line{position:absolute;left:0;top:56%;width:100%;height:${strikeH}px;background:var(--color-accent,#8B5CF6);border-radius:${round3(strikeH / 2)}px;transform:translateY(-50%) scaleX(0);transform-origin:0 50%;pointer-events:none}
.bg{pointer-events:none}
img{border:0}`;
}

export interface DocumentParts {
  canvas: CanvasSpec;
  varsCss: string;
  staticCss: string;
  extraCss: string;
  bodyHtml: string;
  paramsJson: string;
  timelineJs: string;
}

export function assembleHtml(p: DocumentParts): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
:root{${p.varsCss}}
${p.staticCss}
${p.extraCss}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${p.canvas.durationSec}" data-width="${p.canvas.width}" data-height="${p.canvas.height}">
${p.bodyHtml}</div>
<script src="assets/gsap.min.js"></script>
<script>
window.__timelines = window.__timelines || {};
window.__PARAMS = ${p.paramsJson};
const tl = gsap.timeline({ paused: true });
${p.timelineJs}
window.__timelines["main"] = tl;
tl.seek(0);
</script>
</body>
</html>
`;
}
