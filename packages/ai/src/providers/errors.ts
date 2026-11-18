/** Typed provider failures. Messages are always secret-redacted. */
export type ProviderErrorKind =
  | 'invalid_key'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'model_not_found'
  | 'timeout'
  | 'bad_output'
  | 'provider_error';

export class AiError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryAfterMs?: number;
  readonly status?: number;

  constructor(kind: ProviderErrorKind, message: string, opts: { retryAfterMs?: number; status?: number; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'AiError';
    this.kind = kind;
    if (opts.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
    if (opts.status !== undefined) this.status = opts.status;
  }
}

/** Kinds the quality loop must NOT try to repair — they need user action. */
export function isNonRepairable(err: unknown): err is AiError {
  return (
    err instanceof AiError &&
    (err.kind === 'invalid_key' ||
      err.kind === 'rate_limited' ||
      err.kind === 'quota_exceeded' ||
      err.kind === 'model_not_found' ||
      err.kind === 'timeout')
  );
}
