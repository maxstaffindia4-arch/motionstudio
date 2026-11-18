import type { z } from 'zod';
import type { GenerateStructuredArgs, StructuredResult, ChatMessage } from './index.js';

export interface FakeCall {
  system?: string;
  messages: ChatMessage[];
  schemaDescription: string;
  latencyMs: number;
}

export interface FakeScriptEntry {
  /** Match against the concatenated user messages (substring or regex). */
  match?: string | RegExp;
  /** Object returned as the structured result, an Error/AiError to throw, or a responder fn. */
  respond:
    | unknown
    | Error
    | ((args: FakeCall) => unknown | Promise<unknown>);
}

/**
 * Deterministic provider for tests and CI. No keys, no network.
 * Entries are consumed in order; the first entry whose `match` hits (or
 * that has no match) answers. Unmatched calls beyond the script throw.
 */
export class FakeProvider {
  readonly calls: FakeCall[] = [];
  private queue: FakeScriptEntry[];

  constructor(script: FakeScriptEntry[] = []) {
    this.queue = [...script];
  }

  /** Append more scripted responses (useful across repair passes). */
  push(...entries: FakeScriptEntry[]): this {
    this.queue.push(...entries);
    return this;
  }

  reset(): void {
    this.calls.length = 0;
  }

  async generate<S extends z.ZodTypeAny>(
    args: GenerateStructuredArgs<S>
  ): Promise<StructuredResult<z.infer<S>>> {
    const t0 = Date.now();
    const userText = args.messages.map((m) => m.content).join('\n');
    const call: FakeCall = {
      ...(args.system !== undefined ? { system: args.system } : {}),
      messages: args.messages,
      schemaDescription: args.schema.description ?? args.schema._def?.typeName ?? 'schema',
      latencyMs: 0,
    };
    this.calls.push(call);

    // Find first matching entry; entries without `match` are wildcards.
    let idx = this.queue.findIndex((e) => {
      if (!e.match) return true;
      return typeof e.match === 'string' ? userText.includes(e.match) : e.match.test(userText);
    });
    if (idx < 0) idx = this.queue.findIndex((e) => !e.match);
    if (idx < 0) {
      throw new Error(`FakeProvider: no scripted response for call #${this.calls.length}`);
    }
    const entry = this.queue.splice(idx, 1)[0]!;
    let out = typeof entry.respond === 'function' ? await entry.respond(call) : entry.respond;
    if (out instanceof Error) throw out;
    const latencyMs = Date.now() - t0;
    call.latencyMs = latencyMs;

    // Validate against the caller's schema like a real provider would.
    const object = args.schema.parse(out) as z.infer<S>;
    const approx = Math.ceil(JSON.stringify(object ?? {}).length / 4);
    return {
      object,
      usage: { inputTokens: approx, outputTokens: approx, totalTokens: approx * 2 },
      latencyMs,
      mode: 'object',
    };
  }
}
