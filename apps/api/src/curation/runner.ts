import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildContext } from './context.ts';
import { extractionInputSchema, extractionSchema, validateExtraction, validateInputs } from './extraction.ts';
import {
  replySchema,
  limitsSchema,
  providerIdentitySchema,
  type Status,
  type Attempt,
  type ExtractionTrace,
} from '@ai-checkout/catalog-review/curation';
export { extractionTraceSchema, type ExtractionTrace } from '@ai-checkout/catalog-review/curation';

export interface ExtractionProvider {
  id: string;
  model: string;
  mode: 'fixture' | 'metered';
  /** Configured maximum rates, in micro-USD per million tokens. Zero is fixture-only. */
  pricing: { input: number; output: number };
  invoke(request: {
    system: string;
    user: string;
    jsonSchema: unknown;
    maxOutputTokens: number;
    signal: AbortSignal;
  }): Promise<unknown>;
}
export class ProviderFailure extends Error {
  readonly category: 'transient' | 'rate-limit' | 'permanent';
  constructor(category: 'transient' | 'rate-limit' | 'permanent') {
    super(category);
    this.category = category;
  }
}
const MAX_INPUT_BYTES = 96_000,
  MAX_OUTPUT_BYTES = 65_536;
function cost(input: number, output: number, rates: { input: number; output: number }) {
  return Math.ceil((input * rates.input + output * rates.output) / 1_000_000);
}

/** Hard cancellation/deadline even when a faulty adapter ignores AbortSignal. */
async function bounded<T>(
  call: (signal: AbortSignal) => Promise<T>,
  duration: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => {
      controller.abort();
      reject(new Error('cancelled'));
    };
    parent?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, duration);
  });
  try {
    if (parent?.aborted) throw new Error('cancelled');
    return await Promise.race([Promise.resolve().then(() => call(controller.signal)), stopped]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) parent?.removeEventListener('abort', abort);
    controller.abort();
  }
}

/** Provider execution has no database/publication tools. HTTP access goes through the authenticated service and durable ledger. */
export async function runExtraction(
  rawInput: unknown,
  provider: ExtractionProvider,
  options: {
    limits?: z.input<typeof limitsSchema>;
    signal?: AbortSignal;
    runId?: string;
    beforeAttempt?: (signal: AbortSignal) => Promise<void>;
  } = {},
): Promise<ExtractionTrace> {
  const limits = limitsSchema.parse(options.limits ?? {}),
    started = performance.now(),
    now = Date.now();
  const identity = providerIdentitySchema.parse({
    id: provider.id,
    model: provider.model,
    mode: provider.mode,
    pricing: provider.pricing,
  });
  const trace: ExtractionTrace = {
    runId: options.runId ? z.uuid().parse(options.runId) : randomUUID(),
    startedAt: new Date(now).toISOString(),
    durationMs: 0,
    status: 'invalid_input',
    provider: identity,
    limits,
    documents: [],
    attempts: [],
    accountedMicrousd: 0,
    findings: [],
  };
  const elapsed = () => Math.max(0, performance.now() - started);
  const finish = (status: Status) => {
    trace.status = status;
    trace.durationMs = Math.round(elapsed());
    return trace;
  };
  const parsed = extractionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    trace.findings = parsed.error.issues
      .slice(0, 30)
      .map((issue) => ({ code: 'input_schema', path: issue.path.join('.') }));
    return finish('invalid_input');
  }
  const input = parsed.data;
  trace.documents = input.documents.map((document) => ({
    id: document.id,
    contentHash: document.content_hash,
  }));
  trace.findings = validateInputs(input, now);
  if (trace.findings.length) return finish('invalid_input');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_INPUT_BYTES) return finish('input_limit');
  const context = buildContext(input);
  trace.context = {
    hash: context.hash,
    versions: context.versions,
    inputTokenEstimate: context.inputTokenEstimate,
  };
  if (context.inputTokenEstimate > limits.maxInputTokens) return finish('input_limit');
  const reservation = cost(limits.maxInputTokens, limits.maxOutputTokens, identity.pricing);
  // A fresh reservation is needed for every attempt, including ambiguous-charge failures.
  for (let number = 1; number <= limits.maxAttempts; number++) {
    if (options.signal?.aborted) return finish('cancelled');
    const remaining = limits.totalTimeoutMs - elapsed();
    if (remaining <= 0) return finish('timeout');
    if (
      identity.mode === 'metered' &&
      (limits.budgetMicrousd === 0 || trace.accountedMicrousd + reservation > limits.budgetMicrousd)
    )
      return finish('budget_blocked');
    const attemptStart = performance.now();
    const attempt: Attempt = {
      number,
      durationMs: 0,
      outcome: 'provider_error',
      reservedMicrousd: reservation,
      accountedMicrousd: reservation,
    };
    trace.attempts.push(attempt);
    trace.accountedMicrousd += reservation;
    const endAttempt = (outcome: Attempt['outcome']) => {
      attempt.outcome = outcome;
      attempt.durationMs = Math.round(performance.now() - attemptStart);
    };
    try {
      const raw = await bounded(
        async (signal) => {
          await options.beforeAttempt?.(signal);
          if (signal.aborted) throw new Error('cancelled');
          return provider.invoke({
            system: context.system,
            user: context.user,
            jsonSchema: context.jsonSchema,
            maxOutputTokens: limits.maxOutputTokens,
            signal,
          });
        },
        Math.min(limits.attemptTimeoutMs, remaining),
        options.signal,
      );
      if (options.signal?.aborted) {
        endAttempt('cancelled');
        return finish('cancelled');
      }
      if (elapsed() >= limits.totalTimeoutMs || performance.now() - attemptStart >= limits.attemptTimeoutMs) {
        endAttempt('timeout');
        return finish('timeout');
      }
      const reply = replySchema.safeParse(raw);
      if (!reply.success) {
        endAttempt('invalid_output');
        return finish('invalid_output');
      }
      const { usage, text, finishReason } = reply.data;
      attempt.usage = usage;
      if (reply.data.providerResponse) attempt.providerResponse = reply.data.providerResponse;
      const measured = cost(usage.inputTokens, usage.outputTokens, identity.pricing);
      trace.accountedMicrousd += measured - attempt.accountedMicrousd;
      attempt.accountedMicrousd = measured;
      if (Buffer.byteLength(text, 'utf8') <= MAX_OUTPUT_BYTES) attempt.rawOutput = text;
      if (
        Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES ||
        usage.inputTokens > limits.maxInputTokens ||
        usage.outputTokens > limits.maxOutputTokens ||
        finishReason === 'length'
      ) {
        endAttempt('output_limit');
        return finish('output_limit');
      }
      if (finishReason === 'refusal') {
        endAttempt('refused');
        return finish('refused');
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(text);
      } catch {
        endAttempt('invalid_output');
        return finish('invalid_output');
      }
      const output = extractionSchema.safeParse(decoded);
      if (!output.success) {
        trace.findings = output.error.issues
          .slice(0, 30)
          .map((issue) => ({ code: 'output_schema', path: issue.path.join('.') }));
        endAttempt('invalid_output');
        return finish('invalid_output');
      }
      trace.extraction = output.data;
      trace.findings = validateExtraction(output.data, input);
      const status = trace.findings.length ? 'needs_review' : 'evidence_valid';
      endAttempt(status);
      return finish(status);
    } catch (failure) {
      if (options.signal?.aborted) {
        endAttempt('cancelled');
        return finish('cancelled');
      }
      if (failure instanceof Error && failure.message === 'timeout') {
        endAttempt('timeout');
        return finish('timeout');
      }
      if (failure instanceof ProviderFailure && failure.category !== 'permanent') {
        endAttempt(failure.category);
        if (number < limits.maxAttempts) {
          // Bounded backoff; neither invalid model output nor refusals trigger another model call.
          try {
            await bounded(
              (signal) =>
                new Promise<void>((resolve, reject) => {
                  const timer = setTimeout(resolve, 250);
                  signal.addEventListener(
                    'abort',
                    () => {
                      clearTimeout(timer);
                      reject(new Error('cancelled'));
                    },
                    { once: true },
                  );
                }),
              Math.max(1, limits.totalTimeoutMs - elapsed()),
              options.signal,
            );
          } catch {
            return finish(options.signal?.aborted ? 'cancelled' : 'timeout');
          }
          continue;
        }
      } else endAttempt('provider_error');
      return finish('provider_error');
    }
  }
  return finish('provider_error');
}
