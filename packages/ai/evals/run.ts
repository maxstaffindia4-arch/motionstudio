/**
 * Golden-prompt eval CLI.
 *
 *   pnpm eval --provider <google|anthropic|openai|openai-compatible|fake> --model <m> [--key-env NAME] [--runs N]
 *
 * --key-env names the env var holding the API key (default: provider-specific
 * conventional names). Keys are never printed. Writes evals/report-<date>.md.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateAnimation,
  FakeProvider,
  buildTemplatePlan,
  routeIntent,
  extractQuotedText,
  type GenerationInput,
  type GenerationResult,
  type GenerationSettings,
  type ProviderKind,
} from '../src/index.js';
import type { SceneSpec, Element } from '@motion-studio/engine';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(HERE, 'golden.json');

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

interface Args {
  provider: ProviderKind | 'fake';
  model: string;
  keyEnv?: string;
  runs: number;
  qa: boolean;
  strategy?: 'llm' | 'template';
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const provider = (get('provider') ?? 'fake') as Args['provider'];
  const model = get('model') ?? (provider === 'fake' ? 'fake-model' : '');
  if (!model) throw new Error('--model is required for non-fake providers');
  const runs = Number(get('runs') ?? '3');
  const keyEnv = get('key-env');
  const strategy = get('strategy');
  return {
    provider,
    model,
    ...(keyEnv ? { keyEnv } : {}),
    runs: Number.isFinite(runs) && runs > 0 ? Math.floor(runs) : 3,
    qa: !argv.includes('--no-qa'),
    ...(strategy === 'llm' || strategy === 'template' ? { strategy } : {}),
  };
}

function apiKeyFor(provider: string, keyEnv?: string): string | undefined {
  if (provider === 'fake') return undefined;
  const envName =
    keyEnv ??
    ({ google: 'GEMINI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' } as Record<string, string>)[provider] ??
    'AI_API_KEY';
  const v = process.env[envName];
  if (!v) throw new Error(`API key env var ${envName} is not set (use --key-env to override)`);
  return v;
}

// ---------------------------------------------------------------------------
// golden types
// ---------------------------------------------------------------------------

interface GoldenExpect {
  component?: string;
  containsText?: string[];
  canvas?: { width: number; height: number };
  backgroundKind?: string;
  ok?: boolean;
}

interface GoldenEntry {
  id: string;
  prompt: string;
  settings?: Partial<GenerationSettings> & { canvas?: GenerationSettings['canvas'] };
  lockedText?: string[];
  edit?: { basePrompt: string; instruction: string };
  expect: GoldenExpect;
}

interface GoldenFile {
  defaults?: { settings?: GenerationSettings };
  prompts: GoldenEntry[];
}

// ---------------------------------------------------------------------------
// fake provider responder — deterministic scenes derived from the prompt
// ---------------------------------------------------------------------------

function lastUserText(messages: Array<{ role: string; content: string }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') return messages[i]!.content;
  }
  return '';
}

/** Extract the ## REQUEST section (prompt only, no edit-mode JSON tail). */
function requestText(userMsg: string): string {
  const m = userMsg.match(/## REQUEST\n([\s\S]*?)(?:\n\n## EDIT MODE|$)/);
  return (m?.[1] ?? userMsg).trim();
}

function firstTextElement(scene: SceneSpec): Element | undefined {
  const walk = (els: Element[]): Element | undefined => {
    for (const el of els) {
      if (el.type === 'text') return el;
      if (el.type === 'stack') {
        const hit = walk(el.children);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return walk(scene.elements);
}

function fakeResponder(call: { messages: Array<{ role: string; content: string }> }): unknown {
  const userMsg = lastUserText(call.messages);
  const req = requestText(userMsg);

  // Edit mode: return the previous scene with its first text element rewritten.
  if (userMsg.includes('## EDIT MODE')) {
    const m = userMsg.match(/```json\n([\s\S]*?)```/);
    if (m) {
      try {
        const prev = JSON.parse(m[1]!) as SceneSpec;
        const quoted = extractQuotedText(req);
        const plan = buildTemplatePlan(req);
        const next = structuredClone(prev);
        const el = firstTextElement(next);
        if (el && el.type === 'text') {
          el.content = quoted[0] ?? (plan?.params.text as string | undefined) ?? el.content;
        }
        return next;
      } catch {
        /* fall through to fresh generation */
      }
    }
  }

  const route = routeIntent(req);
  const plan = buildTemplatePlan(req, route.component);
  if (!plan) return { component: 'text-slam', params: { text: 'Your headline text' } };
  const out: Record<string, unknown> = { component: plan.component, params: plan.params };
  if (/gradient/i.test(req)) {
    out.background = {
      kind: 'gradient',
      type: 'linear',
      angle: 90,
      stops: [
        { color: '#7c3aed', offset: 0 },
        { color: '#db2777', offset: 1 },
      ],
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// expectations
// ---------------------------------------------------------------------------

function checkExpect(r: GenerationResult, exp: GoldenExpect): string[] {
  const fails: string[] = [];
  const wantOk = exp.ok ?? true;
  if (wantOk && r.status !== 'ok') fails.push(`status=${r.status}`);
  if (exp.component !== undefined) {
    if (r.component !== exp.component) fails.push(`component=${r.component ?? 'custom-scene'} (want ${exp.component})`);
  }
  if (exp.canvas) {
    if (r.scene.canvas.width !== exp.canvas.width || r.scene.canvas.height !== exp.canvas.height) {
      fails.push(`canvas=${r.scene.canvas.width}x${r.scene.canvas.height}`);
    }
  }
  if (exp.backgroundKind !== undefined && r.scene.background.kind !== exp.backgroundKind) {
    fails.push(`background=${r.scene.background.kind}`);
  }
  return fails;
}

// ---------------------------------------------------------------------------
// cost table (USD per 1M tokens) — extend as needed; unknown → null
// ---------------------------------------------------------------------------

const PRICES: Record<string, { in: number; out: number }> = {
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.5-pro': { in: 1.25, out: 10 },
  'gemini-2.0-flash': { in: 0.1, out: 0.4 },
  'claude-sonnet-4-5': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-4.1': { in: 2, out: 8 },
};

function estCost(model: string, input: number, output: number): number | null {
  const key = Object.keys(PRICES).find((k) => model.includes(k));
  if (!key) return null;
  const p = PRICES[key]!;
  return (input / 1e6) * p.in + (output / 1e6) * p.out;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

interface RunRecord {
  entry: GoldenEntry;
  run: number;
  passed: boolean;
  fails: string[];
  status: string;
  repairAttempts: number;
  fellBack: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
}

async function runOnce(
  entry: GoldenEntry,
  defaults: GoldenFile['defaults'],
  args: Args,
  apiKey: string | undefined,
  providerInstance: FakeProvider | undefined
): Promise<RunRecord> {
  const settings: GenerationSettings = {
    ...(defaults?.settings ?? {}),
    ...(entry.settings ?? {}),
    canvas: entry.settings?.canvas ?? defaults?.settings?.canvas ?? { preset: 'landscape' },
    output: entry.settings?.output ?? defaults?.settings?.output ?? 'opaque',
  } as GenerationSettings;

  const input: GenerationInput = {
    prompt: entry.prompt,
    settings,
    ...(entry.lockedText ? { lockedText: entry.lockedText } : {}),
  };

  // edit-follow-up: synthesize `previous` via the deterministic template path
  if (entry.edit) {
    const prev = await generateAnimation(
      { prompt: entry.edit.basePrompt, settings },
      {
        provider: providerInstance ?? (args.provider as ProviderKind),
        model: args.model,
        ...(apiKey ? { apiKey } : {}),
        strategy: 'template',
        qa: false,
      }
    );
    input.previous = { scene: prev.scene, instruction: entry.edit.instruction };
  }

  const t0 = Date.now();
  try {
    const r = await generateAnimation(input, {
      provider: providerInstance ?? (args.provider as ProviderKind),
      model: args.model,
      ...(args.strategy ? { strategy: args.strategy } : {}),
      qa: args.qa,
      maxRepairs: 2,
    });
    const fails = checkExpect(r, entry.expect);
    return {
      entry,
      run: 0,
      passed: fails.length === 0,
      fails,
      status: r.status,
      repairAttempts: r.repairAttempts,
      fellBack: r.fellBackToTemplate === true,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      latencyMs: Date.now() - t0,
    };
  } catch (e) {
    return {
      entry,
      run: 0,
      passed: false,
      fails: ['threw'],
      status: 'error',
      repairAttempts: 0,
      fellBack: false,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - t0,
      error: (e as Error).message.slice(0, 200),
    };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenFile;
  const apiKey = apiKeyFor(args.provider, args.keyEnv);

  // fresh FakeProvider per run keeps call history clean
  const records: RunRecord[] = [];
  for (const entry of golden.prompts) {
    for (let n = 0; n < args.runs; n++) {
      const inst = args.provider === 'fake' ? new FakeProvider([{ respond: fakeResponder }]) : undefined;
      const rec = await runOnce(entry, golden.defaults, args, apiKey, inst);
      rec.run = n + 1;
      records.push(rec);
      const mark = rec.passed ? 'PASS' : 'FAIL';
      console.log(`${mark} ${entry.id} run ${n + 1}/${args.runs} (${rec.status}, ${rec.repairAttempts} repairs, ${(rec.latencyMs / 1000).toFixed(1)}s)${rec.fails.length ? ' — ' + rec.fails.join('; ') : ''}`);
    }
  }

  // aggregate
  const byId = new Map<string, RunRecord[]>();
  for (const r of records) {
    const arr = byId.get(r.entry.id) ?? [];
    arr.push(r);
    byId.set(r.entry.id, arr);
  }
  const totalRuns = records.length;
  const totalPass = records.filter((r) => r.passed).length;
  const totalRepairs = records.filter((r) => r.repairAttempts > 0).length;
  const totalIn = records.reduce((s, r) => s + r.inputTokens, 0);
  const totalOut = records.reduce((s, r) => s + r.outputTokens, 0);
  const totalLat = records.reduce((s, r) => s + r.latencyMs, 0);
  const cost = estCost(args.model, totalIn, totalOut);

  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `# AI eval report — ${date}`,
    '',
    `- provider: \`${args.provider}\`  model: \`${args.model}\`  runs/prompt: ${args.runs}  qa: ${args.qa}`,
    `- prompts: ${golden.prompts.length}  total runs: ${totalRuns}`,
    `- **pass rate: ${((totalPass / totalRuns) * 100).toFixed(1)}%** (${totalPass}/${totalRuns})`,
    `- repair rate: ${((totalRepairs / totalRuns) * 100).toFixed(1)}% of runs needed ≥1 repair`,
    `- tokens: ${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out`,
    `- est. cost: ${cost !== null ? `$${cost.toFixed(4)}` : 'n/a (unknown model pricing)'}`,
    `- total latency: ${(totalLat / 1000).toFixed(1)}s  (avg ${(totalLat / totalRuns / 1000).toFixed(2)}s/run)`,
    '',
    '## Per-prompt',
    '',
    '| prompt | pass | repairs | avg latency | notes |',
    '|---|---|---|---|---|',
  ];
  for (const [id, rs] of byId) {
    const p = rs.filter((r) => r.passed).length;
    const rep = rs.filter((r) => r.repairAttempts > 0).length;
    const lat = rs.reduce((s, r) => s + r.latencyMs, 0) / rs.length / 1000;
    const notes = rs.flatMap((r) => r.fails).slice(0, 3).join('; ') || (rs.some((r) => r.fellBack) ? 'template fallback used' : '');
    lines.push(`| ${id} | ${p}/${rs.length} | ${rep}/${rs.length} | ${lat.toFixed(1)}s | ${notes} |`);
  }
  lines.push('');

  mkdirSync(HERE, { recursive: true });
  const outPath = join(HERE, `report-${date}.md`);
  writeFileSync(outPath, lines.join('\n'));
  console.log(`\nwrote ${outPath}`);
  console.log(`pass rate: ${((totalPass / totalRuns) * 100).toFixed(1)}%`);

  if (totalPass / totalRuns < 0.8) {
    console.error('FAIL: pass rate below 80%');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
