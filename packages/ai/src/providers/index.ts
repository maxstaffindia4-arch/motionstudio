import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { generateObject, generateText } from 'ai';
import type { LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { AiError, isNonRepairable } from './errors.js';
import { redactSecrets } from './redact.js';
import { FakeProvider } from './fake.js';

export type ProviderKind = 'google' | 'anthropic' | 'openai' | 'openai-compatible' | 'fake';
export type ProviderRef = ProviderKind | FakeProvider;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface GenerateStructuredArgs<S extends z.ZodTypeAny> {
  provider: ProviderRef;
  model: string;
  apiKey?: string;
  baseURL?: string;
  system?: string;
  messages: ChatMessage[];
  schema: S;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /** 'auto' tries schema mode then falls back to plain JSON + own validation. */
  structuredMode?: 'auto' | 'object' | 'json';
  /** Per-call timeout; combined with `signal` via AbortSignal.any. */
  timeoutMs?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface StructuredResult<T> {
  object: T;
  usage: TokenUsage;
  latencyMs: number;
  /** Which path produced the object — surfaced for provider-mode reporting. */
  mode: 'object' | 'json';
}

export interface ConnectionResult {
  ok: boolean;
  models?: string[];
  error?: AiError;
}

// ---------------------------------------------------------------------------
// provider construction (key lives only on this stack frame)
// ---------------------------------------------------------------------------

function languageModel(args: {
  provider: Exclude<ProviderKind, 'fake'>;
  model: string;
  apiKey?: string | undefined;
  baseURL?: string | undefined;
}): LanguageModel {
  const { provider, model, apiKey, baseURL } = args;
  switch (provider) {
    case 'google':
      if (!apiKey) throw new AiError('invalid_key', 'google provider requires apiKey');
      return createGoogleGenerativeAI({ apiKey })(model) as LanguageModel;
    case 'anthropic':
      if (!apiKey) throw new AiError('invalid_key', 'anthropic provider requires apiKey');
      return createAnthropic({ apiKey })(model) as LanguageModel;
    case 'openai':
      if (!apiKey) throw new AiError('invalid_key', 'openai provider requires apiKey');
      return createOpenAI({ apiKey })(model) as LanguageModel;
    case 'openai-compatible': {
      if (!baseURL) throw new AiError('provider_error', 'openai-compatible provider requires baseURL');
      const compat = createOpenAICompatible({
        name: 'openai-compatible',
        baseURL,
        apiKey: apiKey ?? 'unused',
      });
      return compat(model) as LanguageModel;
    }
  }
}

// ---------------------------------------------------------------------------
// error mapping
// ---------------------------------------------------------------------------

function statusOf(e: unknown): number | undefined {
  const anyE = e as Record<string, unknown> | undefined;
  const s = anyE?.statusCode ?? anyE?.status ?? (anyE?.response as Record<string, unknown> | undefined)?.status;
  return typeof s === 'number' ? s : undefined;
}

function responseBodyOf(e: unknown): string {
  const anyE = e as Record<string, unknown> | undefined;
  const parts = [anyE?.responseBody, anyE?.data, anyE?.error, anyE?.message];
  return parts.filter((p) => typeof p === 'string' && p).join(' ').slice(0, 4000);
}

function responseHeadersOf(e: unknown): Record<string, string> {
  const anyE = e as Record<string, unknown> | undefined;
  const h = (anyE?.responseHeaders ?? anyE?.headers ?? {}) as Record<string, string>;
  return typeof h === 'object' && h !== null ? h : {};
}

function retryAfterMsOf(e: unknown): number | undefined {
  const headers = responseHeadersOf(e);
  const ra = headers['retry-after'] ?? headers['Retry-After'];
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs)) return Math.max(0, Math.round(secs * 1000));
    const date = Date.parse(ra);
    if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  }
  const body = responseBodyOf(e);
  const m = body.match(/retry[-_ ]?after[^0-9]{0,20}(\d+(?:\.\d+)?)\s*(ms|s)?/i);
  if (m) {
    const n = Number(m[1]);
    return m[2]?.toLowerCase() === 'ms' ? Math.round(n) : Math.round(n * 1000);
  }
  return undefined;
}

const QUOTA_RE = /quota|billing|insufficient|credit|balance|exceeded your/i;

/** Map any thrown provider/SDK error to a typed, secret-redacted AiError. */
export function toAiError(e: unknown, secrets: Array<string | undefined> = []): AiError {
  if (e instanceof AiError) {
    return new AiError(e.kind, redactSecrets(e.message, secrets), {
      ...(e.retryAfterMs !== undefined ? { retryAfterMs: e.retryAfterMs } : {}),
      ...(e.status !== undefined ? { status: e.status } : {}),
    });
  }
  const name = (e as Error | undefined)?.name ?? '';
  const msg = redactSecrets(String((e as Error | undefined)?.message ?? e), secrets);
  const body = redactSecrets(responseBodyOf(e), secrets);
  const status = statusOf(e);
  const hay = `${name} ${msg} ${body}`;

  if (name === 'TimeoutError' || name === 'AbortError' || /timed?\s?out|deadline/i.test(hay)) {
    return new AiError('timeout', msg || 'provider call timed out', { cause: e });
  }
  if (/NoObjectGenerated|no object generated|could not parse|invalid json/i.test(hay) && /schema|object|json/i.test(hay)) {
    return new AiError('bad_output', msg || 'model did not return schema-valid output', { cause: e });
  }
  if (status === 401 || status === 403 || /invalid[_ ]?api[_ ]?key|unauthorized|permission|forbidden/i.test(hay)) {
    return new AiError('invalid_key', msg || 'provider rejected the API key', {
      ...(status !== undefined ? { status } : {}),
      cause: e,
    });
  }
  if (status === 404 || /model[_ ]?not[_ ]?found|does not exist|unknown model|no such model/i.test(hay)) {
    return new AiError('model_not_found', msg || 'model not found', {
      ...(status !== undefined ? { status } : {}),
      cause: e,
    });
  }
  if (status === 429 || /rate[_ ]?limit|too many requests|quota/i.test(hay)) {
    const retryAfterMs = retryAfterMsOf(e);
    const kind = QUOTA_RE.test(hay) ? 'quota_exceeded' : 'rate_limited';
    return new AiError(kind, msg || `provider ${kind}`, {
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      ...(status !== undefined ? { status } : {}),
      cause: e,
    });
  }
  return new AiError('provider_error', msg || 'provider call failed', {
    ...(status !== undefined ? { status } : {}),
    cause: e,
  });
}

// ---------------------------------------------------------------------------
// generateStructured
// ---------------------------------------------------------------------------

const JSON_MODE_SUFFIX = `\n\nRespond with ONLY a single JSON object — no markdown fences, no commentary.`;

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (signal) signals.push(signal);
  if (timeoutMs && timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

async function callJsonMode<S extends z.ZodTypeAny>(
  args: Omit<GenerateStructuredArgs<S>, 'provider' | 'model'> & { lm: LanguageModel }
): Promise<StructuredResult<z.infer<S>>> {
  const t0 = Date.now();
  const schemaJson = JSON.stringify(zodToJsonSchema(args.schema));
  const res = await generateText({
    model: args.lm,
    ...(args.system !== undefined ? { system: args.system } : {}),
    messages: [
      ...args.messages,
      {
        role: 'user',
        content: `Return ONLY the JSON object for the requested output. It must validate against this JSON Schema:\n${schemaJson}${JSON_MODE_SUFFIX}`,
      },
    ],
    ...(args.maxOutputTokens !== undefined ? { maxOutputTokens: args.maxOutputTokens } : {}),
    ...(args.signal ? { abortSignal: args.signal } : {}),
  });
  const text = res.text ?? '';
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new AiError('bad_output', 'model returned no JSON object', { cause: text.slice(0, 200) });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  } catch (e) {
    throw new AiError('bad_output', 'model returned unparseable JSON', { cause: e });
  }
  const object = args.schema.parse(parsed) as z.infer<S>;
  return {
    object,
    usage: {
      inputTokens: res.usage?.inputTokens ?? 0,
      outputTokens: res.usage?.outputTokens ?? 0,
      totalTokens: res.usage?.totalTokens ?? 0,
    },
    latencyMs: Date.now() - t0,
    mode: 'json',
  };
}

export async function generateStructured<S extends z.ZodTypeAny>(
  args: GenerateStructuredArgs<S>
): Promise<StructuredResult<z.infer<S>>> {
  // Fake provider: scripted, no network, no key.
  if (args.provider instanceof FakeProvider) {
    return args.provider.generate(args) as Promise<StructuredResult<z.infer<S>>>;
  }
  const kind = args.provider as Exclude<ProviderKind, 'fake'>;
  const secrets = [args.apiKey];
  const signal = combinedSignal(args.signal, args.timeoutMs);
  const callArgs = { ...args, ...(signal !== undefined ? { signal } : {}) };

  const mode = args.structuredMode ?? 'auto';
  const useObject = mode !== 'json';

  if (useObject) {
    try {
      const t0 = Date.now();
      const model = languageModel({ provider: kind, model: args.model, apiKey: args.apiKey, baseURL: args.baseURL });
      const res = await generateObject({
        model,
        schema: args.schema,
        ...(args.system !== undefined ? { system: args.system } : {}),
        messages: args.messages,
        ...(args.maxOutputTokens !== undefined ? { maxOutputTokens: args.maxOutputTokens } : {}),
        ...(signal ? { abortSignal: signal } : {}),
      });
      const u = res.usage;
      return {
        object: res.object as z.infer<S>,
        usage: {
          inputTokens: u?.inputTokens ?? 0,
          outputTokens: u?.outputTokens ?? 0,
          totalTokens: u?.totalTokens ?? 0,
        },
        latencyMs: Date.now() - t0,
        mode: 'object',
      };
    } catch (e) {
      const err = toAiError(e, secrets);
      // 'object' mode is explicit — never silently downgrade; auto falls
      // back to plain JSON + own zod validation on bad_output only.
      if (mode === 'object' || err.kind !== 'bad_output' || isNonRepairable(err)) {
        throw err;
      }
      const { provider: _p, model: _m, ...rest } = callArgs;
      const lm = languageModel({ provider: kind, model: args.model, apiKey: args.apiKey, baseURL: args.baseURL });
      try {
        return await callJsonMode({ ...rest, lm });
      } catch (e2) {
        throw toAiError(e2, secrets);
      }
    }
  }

  const { provider: _p, model: _m, ...rest } = callArgs;
  const lm = languageModel({ provider: kind, model: args.model, apiKey: args.apiKey, baseURL: args.baseURL });
  try {
    return await callJsonMode({ ...rest, lm });
  } catch (e) {
    throw toAiError(e, secrets);
  }
}

// ---------------------------------------------------------------------------
// testConnection
// ---------------------------------------------------------------------------

const PROBE_SCHEMA = z.object({ ok: z.boolean() });

async function listModels(args: {
  provider: Exclude<ProviderKind, 'fake'>;
  apiKey?: string;
  baseURL?: string;
}): Promise<string[] | undefined> {
  const { provider, apiKey, baseURL } = args;
  try {
    if (provider === 'google' && apiKey) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=100`);
      if (!r.ok) return undefined;
      const j = (await r.json()) as { models?: Array<{ name?: string }> };
      return (j.models ?? []).map((m) => (m.name ?? '').replace(/^models\//, '')).filter(Boolean);
    }
    if (provider === 'anthropic' && apiKey) {
      const r = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      });
      if (!r.ok) return undefined;
      const j = (await r.json()) as { data?: Array<{ id?: string }> };
      return (j.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    }
    if (provider === 'openai' && apiKey) {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${apiKey}` } });
      if (!r.ok) return undefined;
      const j = (await r.json()) as { data?: Array<{ id?: string }> };
      return (j.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    }
    if (provider === 'openai-compatible' && baseURL) {
      const r = await fetch(`${baseURL.replace(/\/$/, '')}/models`, {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      });
      if (!r.ok) return undefined;
      const j = (await r.json()) as { data?: Array<{ id?: string }> };
      return (j.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function testConnection(args: {
  provider: Exclude<ProviderKind, 'fake'>;
  model: string;
  apiKey?: string;
  baseURL?: string;
  timeoutMs?: number;
}): Promise<ConnectionResult> {
  try {
    await generateStructured({
      provider: args.provider,
      model: args.model,
      ...(args.apiKey !== undefined ? { apiKey: args.apiKey } : {}),
      ...(args.baseURL !== undefined ? { baseURL: args.baseURL } : {}),
      system: 'You answer with JSON only.',
      messages: [{ role: 'user', content: 'Reply with {"ok":true}.' }],
      schema: PROBE_SCHEMA,
      maxOutputTokens: 64,
      ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
    });
    const models = await listModels(args);
    return models ? { ok: true, models } : { ok: true };
  } catch (e) {
    return { ok: false, error: toAiError(e, [args.apiKey]) };
  }
}
