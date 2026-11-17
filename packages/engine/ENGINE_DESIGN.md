# Motion Studio — Engine Package Design (Phase 1)

A pure, isomorphic TypeScript library that compiles a structured **Scene** (JSON) into a
HyperFrames-compatible HTML composition. No UI, no AI, no Node APIs in `src/`.

## Goals & hard constraints

- **Isomorphic**: `src/` must never import `fs`, `path`, `child_process`, etc., and must
  never call `Date.now`, `performance.now`, `setTimeout`, `requestAnimationFrame`,
  `Math.random`. Same input → byte-identical output (deterministic ordering everywhere).
- **No `any` in the public API.** Zod schemas are the source of truth; exported types are
  `z.infer<...>`.
- **Files under ~300 lines**, split by responsibility.
- **Any canvas**: width/height/fps/duration/output are data, not constants. All sizing
  derives from `unit(canvas) = min(width, height) / 1080` and the anchor grid.
- **HyperFrames rules** (from updated `knowledge/hyperframes-rules.md`):
  - one root `<div id="root" data-composition-id="main" data-start="0" data-duration data-width data-height>`
  - paused GSAP timeline on `window.__timelines["main"]`, then `tl.seek(0)`
  - timed elements use `class="clip"` + `data-start` + `data-duration`
  - never tween `display`/`visibility`/`autoAlpha` on `.clip`
  - GSAP loaded from local `assets/gsap.min.js` (path reported in `assets[]`; no remote URLs)
  - multi-item layouts use flex/grid with explicit `gap` (≥ 24·unit), never stacked absolutes
  - animate only `opacity`, `x`, `y`, `scale`, `rotation` (+ `xPercent`/`yPercent`, which
    are transform values, for panning oversized layers)
  - ease by role: arrivals `power4.out`/`expo.out`, exits `power3.in`/`power2.in` at
    ~40–50% of entrance duration, pops `back.out(1.7)`/`back.out(2)`
  - stagger: 40–80ms lists, 60–120ms words; ≥2s holds for hero text

## Source material reviewed (updated `motion-lab-main` repo)

- `knowledge/hyperframes-rules.md` — official HF spec (see above).
- `src/common/theme-colors.ts` — `THEME_PALETTES` (celebration/birthday/urgency/success/
  tech/luxury/**brand = Staff India red**), `detectTheme(prompt)`, `resolvePalette(...)`.
  `detectTheme`/`resolvePalette` are prompt-parsing → Phase 2. Palette *values* are ported
  minus the Staff India `brand` entry as optional named theme presets.
- `src/common/archetypes.ts` — 11 archetypes, `TemplateParamsSchema`, timing helpers
  (`findTimingIssue`/`applyTimingFix` → become compile warnings), `routeArchetype` /
  `extractTextItems` / `parseBeats` / `formatTextByContext` (prompt→params → Phase 2;
  casing rules become `textTransform` styles — see A4).
- `src/common/templates.ts` + `src/server/templates/render.ts` — the 11 renderers;
  `render.ts` is the better model (deterministic, normal-flow flex/grid, `.clip`).

## Deviations from the old Motion Lab code (requirements win)

1. **GSAP is local, not CDN**: old `templates.ts` used `cdn.jsdelivr.net`; new compiler
   emits `<script src="assets/gsap.min.js">` and reports `assets[]`.
2. **Animations are spec-level**: components only *build Scene elements*; the compiler
   owns all HTML/CSS/GSAP emission, so invariants hold by construction.
3. **Old code breaks rules we now enforce** — all fixed by design:
   - `strike-checklist` tweens `width` → we tween `scaleX` on the strike line.
   - `glow-sweep` uses `mix-blend-mode: overlay` + tweens `left` → skewed gradient bar on
     `x`/`xPercent` inside `overflow:hidden` (see A7 for glow padding).
   - `caption-track` tweens `color` → word highlight via opacity/scale on accent-colored
     duplicate spans.
   - `whip-transition` tweens `x` in % on skewed bars — already compliant; keep.
   - All hardcoded `1920px/1080px` → derived from canvas spec.
   - `autoAlpha`/`display`/`visibility` never tweened.
4. "Hero 72–110px, body ≥40px @1080p" becomes unit-scaled equivalents.

## Module layout (`packages/engine`)

```
packages/engine/
  package.json          # @motion-studio/engine, type: module
  tsconfig.json         # strict, ES2022, moduleResolution bundler
  ENGINE_DESIGN.md      # this file
  assets/gsap.min.js    # vendored pinned GSAP (D8)
  scripts/
    compile.ts          # dev CLI (Node APIs allowed — outside src/)
  src/
    index.ts            # public barrel
    canvas/
      schema.ts         # CanvasSpec zod + presets
      geometry.ts       # unit(), safeArea(), anchorPoint(), rects
    scene/
      schema.ts         # SceneSpec zod (specVersion: 1)
      tokens.ts         # StyleTokens schema, defaults, themes, resolve()
      validate.ts       # cross-field checks → warnings
    elements/
      schema.ts         # Element union: text | shape | image | stack
      style.ts          # StyleValue literal|{token}; resolveStyle()
      animation.ts      # AnimationSpec presets → from/to descriptors
    compiler/
      escape.ts         # esc() for HTML/attr/CSS/JS
      css.ts            # tokens→CSS vars, element→rules
      html.ts           # document shell, background layer, root
      timeline.ts       # elements → GSAP calls (sorted by start,id)
      compile.ts        # compileScene(scene, opts) orchestrator
    components/
      types.ts          # ComponentDef, ComponentContext, ParamField
      registry.ts       # COMPONENTS + buildScene()
      text-slam.ts … glow-sweep.ts   # 11 files
  tests/                # vitest
```

## Types (sketches — final shapes live in the zod schemas)

### Canvas (`canvas/schema.ts`, `canvas/geometry.ts`)

```ts
CanvasSpecSchema = {
  width: int>0, height: int>0,
  fps: int 1..120 = 30,
  durationSec: number>0,
  output: 'transparent' | 'opaque' = 'opaque',
  safeMargins: 'off' | 'title' | 'action' = 'action',
}
CANVAS_PRESETS = { landscape: 1920x1080, vertical: 1080x1920, square: 1080x1080 }
unit(c)            = min(w,h)/1080
safeArea(c)        = Rect  // inset per side: action 5%, title 10%, off 0 (A2)
anchorPoint(c,a,o) = {x,y} // px of 9-point anchor + offset (pure math, tests/tools)
```

Safe-area insets are **percent of that canvas dimension per side**: `action` (90% area)
= 5% inset, `title` (80% area) = 10% inset, `off` = 0.

### Anchored placement — flex wrappers, not absolute left/top (A1)

An element with `placement: { anchor, offset:{x,y} }` is emitted as:

```html
<div class="anchor anchor-center" style="--ax:..;--ay:..">   <!-- position:absolute; inset:safeArea; display:flex -->
  <div id="el" class="clip ...">…</div>                        <!-- the timed element -->
</div>
```

- `.anchor` is `position:absolute; inset:{safeInsetPx}` + `display:flex` with
  `justify-content`/`align-items` derived from the anchor (`left|center|right` ×
  `top|center|bottom`). The child is a normal-flow flex item — never absolute, never
  manually positioned. This keeps every anchored element inside the safe area **by
  construction** (offsets may push it out → see validate warnings).
- `offset` is applied as a static `transform: translate(x,y)` on the **wrapper** (the
  wrapper is never animated, so no transform conflict with the child's tweens).
- `placement: { flow: true }` = normal-flow child of the parent stack; no wrapper.
- Top-level anchored elements get one wrapper each; wrappers are direct children of
  `#root` (root is `position:relative`).

### Tokens (`scene/tokens.ts`)

```ts
StyleTokensSchema = {
  colors: record(string),
  fonts: { display: FontStack, body: FontStack, mono?: FontStack },
  radii: record(string),
  shadows: record(string),          // each may be multi-layer "a, b"
  glow: { color, blur, strength? },
  easings: { arrival='power4.out', exit='power3.in', pop='back.out(1.7)', strike? },
  motion: 'subtle'|'standard'|'punchy' = 'standard',
  locked: string[] = [],            // token paths reserved for brand enforcement
}
DEFAULT_TOKENS                    // neutral, no brand names
THEMES = { neutral, celebration, birthday, urgency, success, tech, luxury }
                                  // ported from theme-colors.ts minus 'brand'
resolveStyleValue(literal|{token:'a.b'}, tokens) -> string  // warn+fallback on miss
```

### AssetRef (A5)

```ts
AssetRefSchema = z.string().refine(s =>
  !/^[a-z]+:/i.test(s) && !s.startsWith('/') && !s.startsWith('//') &&
  !s.split(/[\\/]/).includes('..'))
// accepted: 'assets/foo.png', 'foo.png', './assets/x.svg' — rejected: URLs, absolute, traversal
```

Used by `image` elements and `background.kind='image'`. Compiler emits the path verbatim.

### Scene (`scene/schema.ts`)

```ts
SceneSpecSchema = {
  specVersion: literal(1),
  canvas: CanvasSpecSchema,
  tokens?: DeepPartial<StyleTokens>,
  background: BackgroundSpec,
  elements: Element[] min 1,
}
```

**Background** discriminated union on `kind`:

- `none`
- `solid { color: StyleValue, previewOnly?: boolean }`
- `gradient { type:'linear'|'radial', angle?, stops:[{color:StyleValue, offset:0..1}], previewOnly? }`
- `animated-gradient { animate:'pan'|'cycle', angle?, durationSec?,
    stops?: [...], colors?: [StyleValue, StyleValue], previewOnly? }`
  - `pan`: one oversized layer (`width/height: 200%`) with `repeating-linear-gradient`,
    tweened `xPercent`/`yPercent` 0→-50 over `durationSec` (default canvas duration),
    `ease:'none'` — deterministic, seamless by construction (A6).
  - `cycle`: two gradient layers cross-faded via `opacity` tweens — used when the intent
    is color change, not motion.
- `image { asset: AssetRef, fit?: 'cover'|'contain'|'fill', previewOnly? }`

`previewOnly: true` → emitted **only** when `compileScene(scene, { target:'preview' })`
(A8). Default target is `'render'`. Non-`none` background on `output:'transparent'` →
warning `background-on-transparent` (still emitted — D4).

**Element** discriminated union on `type`:

```ts
ElementBase = {
  id: string,                    // unique within scene → DOM id
  start: number >= 0,            // seconds
  duration: number > 0,
  placement: { anchor, offset:{x,y} } | { flow: true },
  style: ElementStyle,           // shared: color?, opacity?, padding?, etc.
  animation: { in?: AnimSpec, out?: AnimSpec },
}
text  = { content: string (verbatim — never trimmed/altered, A4),
          style: { fontSize?, fontFamily?, color?, weight?,
                    textTransform?: 'none'|'uppercase'|'capitalize',
                    align?, lineHeight?, letterSpacing?, glow?, shadow? } }
shape = { shape: 'rect'|'pill'|'line',
          style: { width?, height?, color?, radius?, rotation?, opacity? } }
image = { asset: AssetRef, style: { width?, height?, fit? } }
stack = { direction: 'row'|'column'|'grid',
          columns?: int (grid only), gap: number >= 0 (clamped, A3),
          align?, justify?, padding?, style?,
          children: Element[] }   // children must be placement.flow
```

`AnimSpec = { preset: 'slam'|'pop'|'slide'|'fade-scale'|'wipe'|'counter'|'strike',
role?: 'arrival'|'exit', easing?, duration?, distance? }` → compiler maps to `fromTo`
descriptors with role-based easing (arrival `power4.out`, pop `back.out(1.7)`, exit
`power3.in` ~40–50% shorter). Only transform/opacity props emitted.

- `counter`: text element with numeric content; compiler emits proxy-object tween
  `{v:0→N}` with `onUpdate` writing `textContent` (see **A10 verification**).
- `strike`: emits child `.strike-line` animated `scaleX` 0→1 (transform, not width).
- `wipe`: `overflow:hidden` wrapper + inner element `x` translate (A6/D6).

### Style values & text casing (A4)

`StyleValue = literal | { token: 'path.to.value' }`. Text `content` is **never** trimmed,
case-folded or altered — casing is expressed only via `style.textTransform`
(`uppercase` covers the old `formatTextByContext` uppercasing; `capitalize` approximates
title-case — noted deviation since CSS can't do true title-case).

### Warnings & soft rules (A3)

```ts
interface CompileWarning {
  code: string;                 // e.g. 'gap-below-min', 'token-unresolved',
                                // 'background-on-transparent', 'safe-area-overflow'
  severity: 'warning' | 'error';
  message: string;
  elementId?: string;
}
compileScene(scene, opts?: { target?: 'preview'|'render' }):
  { html, assets, warnings }
```

Soft rules **auto-clamp and warn**, never reject: `gap < 24*unit` → clamp to `24*unit`
+ warning; unresolved token → fallback + warning; offset pushing an anchored element
outside safeArea → warning (geometry is checked with estimated box = anchor point, since
real text metrics need a browser — pure-math conservative check on anchor+offset only).
Only **structural** errors throw: Zod parse failures, duplicate element ids, `flow`
child outside a stack, `stack` child with anchor placement, timings exceeding canvas
duration by >1 frame? (no — end>duration is a warning `element-outlives-canvas`).

### Glow clipping (A7)

Any container with `overflow:hidden` that can contain glowing descendants is padded by
the glow radius so `text-shadow`/`box-shadow` isn't clipped: the compiler tracks each
element's glow radius (`tokens.glow.blur` or explicit `style.glow.blur`), and wrappers
it generates (`wipe`, `stack` with `overflow:'hidden'`, background pan layer is exempt —
it has no glowing children) get `padding: {glowPad}px`. `glow-sweep`'s shimmer mask is
the canonical case; a dedicated test fixture asserts the padding equals the blur radius.

### DOM order & timeline order (A9)

Elements are emitted into the DOM **in scene array order** (stack children in their
declared order). Only the *timeline calls* are sorted by `(start, id)` for stable output.
Background layer is always first inside `#root`.

### Counter verification (A10)

`counter` uses `tl.to(proxy, { v: target, onUpdate: () => el.textContent = ... })`.
GSAP fires `onUpdate` on `seek()`, so it *should* be deterministic — but this must be
verified against a real `hyperframes render`: seek to 1s, 2s, 3s and confirm different
numbers. **Verification step** (Phase 5 tooling): render `tests/fixtures/counter.html`
at those times and diff `textContent`. If it fails, fallback = rolling-digit columns
(`translateY` per digit, transform-only). Until verified, `counter` is marked
experimental in component docs.

### Compiler output

```ts
compileScene(scene, { target = 'render' } = {}) => {
  html: string,
  assets: string[],        // ['gsap.min.js'] — caller copies next to index.html
  warnings: CompileWarning[],
}
```

HTML skeleton (deterministic string building):

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  :root { /* --color-*, --font-*, --radius-*, --shadow-*, --glow-*, --ease-* */ }
  html, body { margin:0; padding:0; width:{w}px; height:{h}px; overflow:hidden;
               background:{transparent|#…}; }
  #root { position:relative; width:100%; height:100%; }
  .anchor { position:absolute; display:flex; }
  /* generated per-element rules, stable order */
</style>
<script src="assets/gsap.min.js"></script>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{d}"
     data-width="{w}" data-height="{h}">
  <!-- background layer (non-clip) then elements in scene order -->
</div>
<script>
window.__timelines = window.__timelines || {};
window.__PARAMS = {…resolved params…};
const tl = gsap.timeline({ paused: true });
/* tl.fromTo/tl.to lines sorted by (start, id) */
window.__timelines["main"] = tl;
tl.seek(0);
</script>
</body>
</html>
```

- Transparent output: `background: transparent` on html/body/root.
- Legibility: `text-shadow` composed from `tokens.shadows` layers.
- Glow: `text-shadow`/`box-shadow` only. No backdrop-filter, blend modes, or
  full-frame filters.

### Components

```ts
interface ComponentContext { canvas; tokens: ResolvedTokens; durationSec; unit; safe }
interface ComponentDef<P> {
  id; name; description; example;            // example = params JSON string
  paramsSchema: ZodType<P>; defaults: P;
  paramFields: ParamField[];                 // {id,type,label,group,min,max,step,options?}
  build(params: P, ctx: ComponentContext): Element[];
}
COMPONENTS: Record<id, ComponentDef>
buildScene(componentId, params, canvas, tokensOrTheme?): SceneSpec
```

All 11 archetypes: `text-slam, keyword-pop, strike-checklist, lower-third, icon-cards,
step-card, end-card, caption-track, number-counter, whip-transition, glow-sweep`.
Everything scales via `unit(canvas)` and anchors into `safeArea`; no per-orientation
code. Param `min`s that are px-at-1080p are stored in schema as *unit-relative* numbers
(multiplied by `unit` inside `build`) so vertical/square work unchanged.

Ported engine concerns: `findTimingIssue`→warnings, `formatTextByContext`→`textTransform`,
`THEME_PALETTES`→theme presets. Phase 2 keeps: `routeArchetype`, `extractTextItems`,
`parseBeats`, `detectTheme`, `resolvePalette`, LLM/repair.

### Dev CLI (`scripts/compile.ts`, tsx — Node APIs OK outside src/)

```
tsx scripts/compile.ts --component text-slam --params '{"text":"Hello"}'
     --canvas vertical --output transparent [--duration 4] [--target preview]
     [--theme celebration] [--out out/text-slam]
```

Writes `out/<name>/index.html`, copies `assets/gsap.min.js` from vendored
`packages/engine/assets/`. Previewable / `npx hyperframes render`-able.

### Tests (vitest)

- schema: valid/invalid scenes; AssetRef rejects URLs/`..`/absolute
- determinism: `compileScene` twice → identical html
- matrix: 11 components × 4 canvases → compiles; expected warnings only
- invariants on every output: root attrs, one paused timeline, no `http(s)://`
  (except xmlns), no forbidden time APIs, every `.clip` has data-start+data-duration,
  no `display:`/`visibility:`/`autoAlpha` inside `tl.*` calls, DOM order = scene order
- geometry: anchored elements resolve inside safeArea (pure math)
- soft rules: gap<24·unit → warning + clamped value present in CSS; gradient on
  transparent → warning; `previewOnly` background absent at target=render, present at
  preview
- glow clipping: glow-sweep fixture's mask container padding == glow blur radius
- counter fixture exists for the A10 render verification
- optional `lint:hf` script: `npx hyperframes lint` on `out/` fixtures (devDep only)

## Decision log

- **D1** whip = skewed bars on `x`%; glow-sweep = shimmer bar on `x`/`xPercent` in
  `overflow:hidden` (no blend modes).
- **D2** strike line = `scaleX` transform.
- **D3** caption highlight = opacity/scale on accent duplicates (no color tween).
- **D4** transparent + non-none background → warn `background-on-transparent`, still emit.
- **D5** counter = proxy `onUpdate` textContent — **provisional pending A10 verification**.
- **D6** wipe = overflow-hidden wrapper + inner `x`.
- **D7** superseded by A6: pan = oversized layer transform; cycle = opacity cross-fade.
- **D8** vendored `gsap.min.js` in `packages/engine/assets/`.
- **D9** monorepo root with `pnpm-workspace.yaml`, engine at `packages/engine`.
- **D10** AssetRef = validated relative path string (A5).
- **D11** theme presets minus Staff India `brand`; detection → Phase 2.
- **A1–A10** = user amendments (2026-11-17): flex-wrapper anchors; safe insets 5%/10%;
  soft-rule warnings + auto-clamp; verbatim text + CSS text-transform; AssetRef;
  pan-vs-cycle animated gradient; glow padding + fixture; `target: preview|render` +
  `previewOnly`; DOM order vs sorted timeline; counter verification step.
