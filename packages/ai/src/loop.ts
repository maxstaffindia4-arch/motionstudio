import {
  buildScene,
  validateScene,
  type SceneSpec,
} from '@motion-studio/engine';
import { generateStructured } from './providers/index.js';
import { AiError, isNonRepairable } from './providers/errors.js';
import type { StructuredResult, TokenUsage } from './providers/index.js';
import { buildPrompts } from './prompt/builder.js';
import { routeIntent, detectThemeHint } from './intent.js';
import {
  ModelOutputSchema,
  parseModelOutput,
  buildTemplatePlan,
  applyManualGuard,
  enforceSettings,
  settingsToCanvas,
} from './scene-out.js';
import { stageScene } from './stage.js';
import { lintScene } from './lint.js';
import { layoutQA } from './layout-qa.js';
import { verbatimRequirements, checkVerbatim, visibleText } from './verbatim.js';
import type {
  GenerateAnimationOptions,
  GenerationInput,
  GenerationIssue,
  GenerationResult,
  StageMetrics,
  StageName,
} from './types.js';

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

interface Attempt {
  scene: SceneSpec;
  html: string;
  issues: GenerationIssue[];
  blocking: number;
}

interface Ctx {
  input: GenerationInput;
  opts: GenerateAnimationOptions;
  stages: StageMetrics[];
  usage: TokenUsage;
}

function emit(ctx: Ctx, stage: StageName, t0: number, extra?: Partial<StageMetrics>): void {
  const latencyMs = Date.now() - t0;
  const m: StageMetrics = { stage, latencyMs, ...extra };
  ctx.stages.push(m);
  ctx.opts.onStage?.(stage, {
    stage,
    latencyMs,
    ...(extra?.attempt !== undefined ? { attempt: extra.attempt } : {}),
    ...(extra?.detail !== undefined ? { detail: extra.detail } : {}),
    ...(extra?.inputTokens !== undefined ? { inputTokens: extra.inputTokens } : {}),
    ...(extra?.outputTokens !== undefined ? { outputTokens: extra.outputTokens } : {}),
  });
}

function blockingCount(issues: GenerationIssue[]): number {
  return issues.filter((i) => i.severity === 'error').length;
}

// ---------------------------------------------------------------------------
// per-attempt pipeline: guard → validate → compile → lint → QA → verbatim
// ---------------------------------------------------------------------------

async function evaluateScene(ctx: Ctx, input: SceneSpec): Promise<Attempt> {
  const issues: GenerationIssue[] = [];
  let scene = input;

  // manual-element guard (edits only)
  if (ctx.input.previous) {
    const userText = `${ctx.input.prompt}\n${ctx.input.previous.instruction}`;
    const guarded = applyManualGuard(scene, ctx.input.previous.scene, userText);
    if (guarded.reverted.length > 0) {
      scene = guarded.scene;
      issues.push({
        severity: 'warning',
        stage: 'manual-guard',
        message: `manual elements preserved (reverted model changes): ${guarded.reverted.join(', ')}`,
      });
    }
  }

  // structural validation
  const v = validateScene(scene);
  for (const e of v.errors) issues.push({ severity: 'error', stage: 'scene', message: e });
  for (const w of v.warnings) {
    issues.push({
      severity: 'warning',
      stage: 'scene',
      message: w.message,
      ...(w.elementId ? { elementId: w.elementId } : {}),
    });
  }
  if (v.errors.length > 0) {
    return { scene, html: '', issues, blocking: blockingCount(issues) };
  }

  // compile
  let html = '';
  let compileWarnings: { code: string; message: string; elementId?: string }[] = [];
  const tCompile = Date.now();
  try {
    const staged = stageScene(scene);
    try {
      html = staged.html;
      compileWarnings = staged.compile.warnings;
    } finally {
      staged.cleanup();
    }
    emit(ctx, 'compile', tCompile, { detail: `${compileWarnings.length} warnings` });
  } catch (e) {
    issues.push({
      severity: 'error',
      stage: 'compile',
      message: `compile failed: ${(e as Error).message.slice(0, 400)}`,
    });
    return { scene, html: '', issues, blocking: blockingCount(issues) };
  }
  for (const w of compileWarnings) {
    issues.push({
      severity: 'warning',
      stage: 'compile',
      message: w.message,
      ...(w.elementId ? { elementId: w.elementId } : {}),
    });
  }

  // lint
  try {
    const t0 = Date.now();
    const r = await lintScene(scene, { timeoutMs: ctx.opts.timeouts?.['lint'] ?? 60_000 });
    try {
      for (const f of r.lint.findings) {
        issues.push({
          severity: f.severity === 'error' ? 'error' : 'warning',
          stage: 'lint',
          message: `[${f.code}] ${f.message}`,
          ...(f.elementId ? { elementId: f.elementId } : {}),
        });
      }
      emit(ctx, 'lint', t0, { detail: `${r.lint.errorCount} errors, ${r.lint.warningCount} warnings` });
    } finally {
      r.cleanup();
    }
  } catch (e) {
    issues.push({
      severity: 'warning',
      stage: 'lint',
      message: `lint unavailable: ${(e as Error).message.slice(0, 200)}`,
    });
  }

  // layout QA (pooled browser)
  if (ctx.opts.qa !== false) {
    try {
      const t0 = Date.now();
      const staged = stageScene(scene);
      try {
        const qa = await layoutQA(staged, scene.canvas, {
          timeoutMs: ctx.opts.timeouts?.['layout-qa'] ?? 15_000,
        });
        for (const i of qa.issues) {
          issues.push({
            severity: i.severity,
            stage: 'layout-qa',
            message: `[${i.code}] ${i.message}`,
            ...(i.elementId ? { elementId: i.elementId.split('×')[0] } : {}),
          });
        }
        emit(ctx, 'layout-qa', t0, { detail: `${qa.issues.length} issues @ ${qa.sampledAt.length} timestamps` });
      } finally {
        staged.cleanup();
      }
    } catch (e) {
      issues.push({
        severity: 'warning',
        stage: 'layout-qa',
        message: `layout QA unavailable: ${(e as Error).message.slice(0, 200)}`,
      });
    }
  }

  // verbatim text lock
  const reqs = verbatimRequirements(ctx.input.prompt, ctx.input.lockedText ?? []);
  if (reqs.length > 0) {
    const t0 = Date.now();
    const check = checkVerbatim(visibleText(html), reqs);
    if (!check.ok) {
      issues.push({
        severity: 'error',
        stage: 'verbatim',
        message: `required text missing from output: ${check.missing.map((m) => `"${m}"`).join(', ')}`,
      });
    }
    emit(ctx, 'verbatim', t0, { detail: `${reqs.length} locked, ${check.missing.length} missing` });
  }

  return { scene, html, issues, blocking: blockingCount(issues) };
}

// ---------------------------------------------------------------------------
// template strategy — deterministic, no LLM
// ---------------------------------------------------------------------------

async function runTemplate(ctx: Ctx, routeComponent?: string): Promise<Attempt | null> {
  const t0 = Date.now();
  const plan = buildTemplatePlan(ctx.input.prompt, routeComponent);
  emit(ctx, 'template', t0, { detail: plan ? plan.component : 'no plan' });
  if (!plan) return null;
  try {
    const canvas = settingsToCanvas(ctx.input.settings);
    const scene = enforceSettings(
      buildScene(plan.component, plan.params, canvas) as SceneSpec,
      ctx.input.settings
    );
    return await evaluateScene(ctx, scene);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// generateAnimation
// ---------------------------------------------------------------------------

export async function generateAnimation(
  input: GenerationInput,
  opts: GenerateAnimationOptions
): Promise<GenerationResult> {
  const ctx: Ctx = { input, opts, stages: [], usage: { ...ZERO_USAGE } };

  const route = routeIntent(input.prompt);
  const theme = detectThemeHint(input.prompt);
  emit(ctx, 'route', Date.now(), { detail: route.component ?? 'no match' });

  const strategy = opts.strategy ?? 'llm';
  const maxRepairs = opts.maxRepairs ?? 2;

  const finish = (
    a: Attempt,
    repairAttempts: number,
    strat: 'llm' | 'template',
    extra?: Partial<GenerationResult>
  ): GenerationResult => ({
    status: a.blocking === 0 ? 'ok' : 'needs_review',
    scene: a.scene,
    html: a.html,
    issues: a.issues,
    repairAttempts,
    usage: ctx.usage,
    stages: ctx.stages,
    strategy: strat,
    route: {
      ...(route.component !== undefined ? { component: route.component } : {}),
      confidence: route.confidence,
      reason: route.reason,
    },
    ...extra,
  });

  // ---- template strategy ----
  if (strategy === 'template') {
    const a = await runTemplate(ctx, route.component);
    if (a) return finish(a, 0, 'template');
    throw new AiError('bad_output', 'template strategy produced no plan');
  }

  // ---- llm strategy ('auto' currently aliases 'llm' pending evals) ----
  const { system, messages } = buildPrompts(input, {
    route,
    ...(theme !== undefined ? { theme } : {}),
  });
  const convo: Array<{ role: 'user' | 'assistant'; content: string }> = [...messages];
  let best: Attempt | null = null;
  const generateTimeout = opts.timeouts?.generate ?? 120_000;

  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    opts.signal?.throwIfAborted();
    const t0 = Date.now();
    let parsedScene: SceneSpec;
    try {
      const structured = (await generateStructured({
        provider: opts.provider,
        model: opts.model,
        ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        ...(opts.baseURL !== undefined ? { baseURL: opts.baseURL } : {}),
        system,
        messages: convo,
        schema: ModelOutputSchema,
        timeoutMs: generateTimeout,
        ...(opts.signal ? { signal: opts.signal } : {}),
      })) as StructuredResult<unknown>;
      ctx.usage = addUsage(ctx.usage, structured.usage);
      parsedScene = parseModelOutput(structured.object, input.settings).scene;
      emit(ctx, 'generate', t0, {
        attempt,
        detail: `mode=${structured.mode}`,
        inputTokens: structured.usage.inputTokens,
        outputTokens: structured.usage.outputTokens,
      });
    } catch (e) {
      emit(ctx, 'generate', t0, { attempt, detail: 'failed' });
      if (e instanceof AiError && isNonRepairable(e)) {
        // auth/quota/model errors: don't burn repairs — fall back to template
        const fb = await runTemplate(ctx, route.component);
        if (fb) return finish(fb, attempt, 'llm', { fellBackToTemplate: true });
        throw e;
      }
      const msg = e instanceof AiError ? `[${e.kind}] ${e.message}` : (e as Error).message;
      if (attempt >= maxRepairs) {
        const fb = await runTemplate(ctx, route.component);
        if (fb) return finish(fb, attempt, 'llm', { fellBackToTemplate: true });
        if (best) return finish(best, attempt, 'llm');
        throw e instanceof AiError ? e : new AiError('provider_error', msg);
      }
      convo.push({
        role: 'user',
        content: `REPAIR PASS ${attempt + 1}: the previous response could not be used.\nError: ${msg.slice(0, 800)}\nReturn ONLY the corrected JSON object.`,
      });
      continue;
    }

    // evaluate the candidate scene
    const tEval = Date.now();
    const result = await evaluateScene(ctx, parsedScene);
    emit(ctx, 'validate', tEval, { attempt, detail: `${result.blocking} blocking` });

    if (!best || result.blocking < best.blocking) best = result;
    if (result.blocking === 0) return finish(result, attempt, 'llm');

    if (attempt < maxRepairs) {
      const issueText = result.issues
        .filter((i) => i.severity === 'error')
        .slice(0, 12)
        .map((i) => `- [${i.stage}] ${i.message}`)
        .join('\n');
      convo.push({
        role: 'user',
        content:
          `REPAIR PASS ${attempt + 1}: your previous scene failed these checks. Fix ALL of them and return the full corrected JSON object.\n${issueText}`,
      });
    }
  }

  // exhausted repairs — best attempt as needs_review; template only if better
  const fb = await runTemplate(ctx, route.component);
  if (fb && fb.blocking <= (best?.blocking ?? Infinity)) {
    return finish(fb, maxRepairs, 'llm', { fellBackToTemplate: true });
  }
  return finish(best!, maxRepairs, 'llm');
}
