import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toAiError, AiError, isNonRepairable, generateStructured, FakeProvider } from '../src/index.js';

const KEY = 'sk-test-secret-abcdef123456';

describe('toAiError mapping', () => {
  it('maps 401/403 to invalid_key', () => {
    expect(toAiError({ statusCode: 401, message: 'unauthorized' }).kind).toBe('invalid_key');
    expect(toAiError({ statusCode: 403 }).kind).toBe('invalid_key');
  });

  it('maps 429 with quota body to quota_exceeded, plain 429 to rate_limited', () => {
    const quota = toAiError({ statusCode: 429, responseBody: 'insufficient_quota: billing' });
    expect(quota.kind).toBe('quota_exceeded');
    const rl = toAiError({ statusCode: 429, responseBody: 'rate limit exceeded' });
    expect(rl.kind).toBe('rate_limited');
  });

  it('extracts retryAfter from Retry-After header', () => {
    const e = toAiError({ statusCode: 429, responseHeaders: { 'retry-after': '7' } });
    expect(e.kind).toBe('rate_limited');
    expect(e.retryAfterMs).toBe(7000);
  });

  it('maps 404 to model_not_found', () => {
    expect(toAiError({ statusCode: 404, message: 'model not found' }).kind).toBe('model_not_found');
  });

  it('maps timeouts', () => {
    const t = new Error('aborted');
    t.name = 'TimeoutError';
    expect(toAiError(t).kind).toBe('timeout');
    expect(toAiError(new Error('Request timed out')).kind).toBe('timeout');
  });

  it('maps unparseable model output to bad_output', () => {
    expect(toAiError(new Error('NoObjectGeneratedError: could not parse the response')).kind).toBe('bad_output');
  });

  it('falls back to provider_error', () => {
    expect(toAiError(new Error('socket hang up')).kind).toBe('provider_error');
    expect(toAiError({ statusCode: 500 }).kind).toBe('provider_error');
  });
});

describe('key redaction', () => {
  it('never leaks the api key in error messages', () => {
    const err = toAiError(new Error(`401 invalid key ${KEY} provided`), [KEY]);
    expect(err.message).not.toContain(KEY);
    expect(err.message).toContain('[redacted]');
  });

  it('redacts keys inside AiError re-wraps too', () => {
    const inner = new AiError('invalid_key', `bad key ${KEY}`);
    const outer = toAiError(inner, [KEY]);
    expect(outer.message).not.toContain(KEY);
  });

  it('isNonRepairable covers auth/quota/timeout only', () => {
    expect(isNonRepairable(new AiError('rate_limited', 'x'))).toBe(true);
    expect(isNonRepairable(new AiError('quota_exceeded', 'x'))).toBe(true);
    expect(isNonRepairable(new AiError('invalid_key', 'x'))).toBe(true);
    expect(isNonRepairable(new AiError('timeout', 'x'))).toBe(true);
    expect(isNonRepairable(new AiError('model_not_found', 'x'))).toBe(true);
    expect(isNonRepairable(new AiError('bad_output', 'x'))).toBe(false);
    expect(isNonRepairable(new AiError('provider_error', 'x'))).toBe(false);
    expect(isNonRepairable(new Error('x'))).toBe(false);
  });
});

describe('generateStructured with FakeProvider', () => {
  const schema = z.object({ scene: z.string(), count: z.number() });

  it('returns parsed object + usage', async () => {
    const fake = new FakeProvider([{ respond: { scene: 'a', count: 2 } }]);
    const res = await generateStructured({
      provider: fake,
      model: 'fake-1',
      messages: [{ role: 'user', content: 'hi' }],
      schema,
    });
    expect(res.object).toEqual({ scene: 'a', count: 2 });
    expect(res.usage.totalTokens).toBeGreaterThan(0);
    expect(res.mode).toBe('object');
    expect(fake.calls).toHaveLength(1);
  });

  it('throws scripted errors and records the call', async () => {
    const fake = new FakeProvider([{ respond: new AiError('rate_limited', 'slow down', { retryAfterMs: 500 }) }]);
    await expect(
      generateStructured({ provider: fake, model: 'm', messages: [{ role: 'user', content: 'x' }], schema })
    ).rejects.toMatchObject({ kind: 'rate_limited', retryAfterMs: 500 });
    expect(fake.calls).toHaveLength(1);
  });

  it('matches scripted entries by content', async () => {
    const fake = new FakeProvider([
      { match: 'repair', respond: { scene: 'fixed', count: 1 } },
      { respond: { scene: 'first', count: 0 } },
    ]);
    const a = await generateStructured({ provider: fake, model: 'm', messages: [{ role: 'user', content: 'please repair this' }], schema });
    const b = await generateStructured({ provider: fake, model: 'm', messages: [{ role: 'user', content: 'hello' }], schema });
    expect(a.object.scene).toBe('fixed');
    expect(b.object.scene).toBe('first');
  });
});
