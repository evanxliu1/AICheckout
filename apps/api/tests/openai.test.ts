import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createOpenAIProviderFactory, OPENAI_RESPONSE_BYTES } from '../src/curation/openai.ts';
import { runExtraction, ProviderFailure } from '../src/curation/runner.ts';
import { buildContext } from '../src/curation/context.ts';
import type { CurationProfile } from '../src/curation/ledger.ts';
import { extractionFixture } from './curation-fixture.ts';

// All SDK requests use an intercepted transport and a fake key/model. Accidental
// fallback to global fetch is an error, never a real model call.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected real transport')));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
function fixture() {
  const f = extractionFixture();
  const profile: CurationProfile = {
    id: 'adapter-test',
    enabled: true,
    provider: 'openai',
    model: 'gpt-synthetic-2026-09-25',
    mode: 'metered',
    input_price: 1000000,
    output_price: 2000000,
    max_input_tokens: 48000,
    max_output_tokens: 4096,
    max_attempts: 2,
    attempt_timeout_ms: 10000,
    total_timeout_ms: 15000,
  };
  const body = {
    id: 'resp_synthetic',
    model: profile.model,
    status: 'completed',
    error: null,
    incomplete_details: null,
    usage: { input_tokens: 2000, output_tokens: 350, total_tokens: 2350 },
    output: [
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: f.reply.text }],
      },
    ],
  };
  const json = (value: unknown = body, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  const fetcher = vi.fn<typeof fetch>(async () => json());
  const factory = createOpenAIProviderFactory({
    apiKey: 'sk-SYNTHETIC-NOT-A-KEY',
    allowMetered: true,
    fetcher,
  });
  const context = buildContext(f.input),
    controller = new AbortController();
  const invoke = () =>
    factory(profile).invoke({ ...context, maxOutputTokens: 4096, signal: controller.signal });
  return { ...f, profile, body, json, fetcher, factory, context, controller, invoke };
}
it('uses the actual SDK to send only the bounded context/schema and returns reported usage and response identity', async () => {
  vi.stubEnv('OPENAI_BASE_URL', 'https://untrusted.example/');
  vi.stubEnv('OPENAI_ORG_ID', 'unintended-org');
  vi.stubEnv('OPENAI_LOG', 'debug');
  const log = vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    f = fixture();
  const trace = await runExtraction(f.input, f.factory(f.profile), { limits: { budgetMicrousd: 112384 } });
  expect(trace.status).toBe('evidence_valid');
  expect(trace.accountedMicrousd).toBe(2700);
  expect(trace.attempts[0].providerResponse).toEqual({ id: 'resp_synthetic', model: f.profile.model });
  expect(f.fetcher).toHaveBeenCalledOnce();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
  const [url, options] = f.fetcher.mock.calls[0];
  expect(String(url)).toBe('https://api.openai.com/v1/responses');
  expect(options).toMatchObject({
    method: 'POST',
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
  expect(new Headers(options?.headers).get('openai-organization')).toBeNull();
  expect(JSON.parse(String(options?.body))).toEqual({
    model: f.profile.model,
    instructions: f.context.system,
    input: [{ role: 'user', content: f.context.user }],
    max_output_tokens: 4096,
    text: {
      format: { type: 'json_schema', name: 'issuer_extraction', strict: true, schema: f.context.jsonSchema },
    },
    stream: false,
    background: false,
    store: false,
    tools: [],
    tool_choice: 'none',
    truncation: 'disabled',
    service_tier: 'default',
  });
  expect(JSON.stringify(trace)).not.toContain('sk-SYNTHETIC');
});
it('requires explicit metered configuration and still makes no call under the default zero harness budget', async () => {
  const f = fixture();
  expect(() =>
    createOpenAIProviderFactory({ apiKey: 'fake', allowMetered: false, fetcher: f.fetcher }),
  ).toThrow('explicit configuration');
  expect(() => createOpenAIProviderFactory({ apiKey: '', allowMetered: true, fetcher: f.fetcher })).toThrow(
    'explicit configuration',
  );
  expect((await runExtraction(f.input, f.factory(f.profile))).status).toBe('budget_blocked');
  expect(f.fetcher).not.toHaveBeenCalled();
});
it.each(['provider', 'mode', 'input-price', 'output-price', 'alias'])(
  'rejects unsupported operator profile (%s)',
  (kind) => {
    const f = fixture();
    if (kind === 'provider') f.profile.provider = 'other';
    if (kind === 'mode') f.profile.mode = 'fixture';
    if (kind === 'input-price') f.profile.input_price = 0;
    if (kind === 'output-price') f.profile.output_price = 0;
    if (kind === 'alias') f.profile.model = 'gpt-synthetic';
    expect(() => f.factory(f.profile)).toThrow('Unsupported OpenAI extraction profile');
    expect(f.fetcher).not.toHaveBeenCalled();
  },
);
it.each(['refusal', 'tokens', 'filter'])('preserves %s and usage without a repair or retry', async (kind) => {
  const f = fixture(),
    body = structuredClone(f.body) as Record<string, unknown>;
  if (kind === 'refusal')
    body.output = [
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'refusal', refusal: 'Synthetic refusal.' }],
      },
    ];
  else {
    body.status = 'incomplete';
    body.incomplete_details = { reason: kind === 'tokens' ? 'max_output_tokens' : 'content_filter' };
    body.output = [];
  }
  f.fetcher.mockResolvedValueOnce(f.json(body));
  const trace = await runExtraction(f.input, f.factory(f.profile), { limits: { budgetMicrousd: 112384 } });
  expect(trace.status).toBe(kind === 'tokens' ? 'output_limit' : 'refused');
  expect(trace.attempts[0].usage).toEqual({ inputTokens: 2000, outputTokens: 350 });
  expect(f.fetcher).toHaveBeenCalledOnce();
});
it.each([
  'usage',
  'total',
  'model',
  'tool',
  'missing-message',
  'failed',
  'inconsistent-status',
  'mixed-refusal',
])('fails closed on malformed/unexpected %s without leaking provider data', async (kind) => {
  const f = fixture(),
    body = structuredClone(f.body) as Record<string, unknown>;
  if (kind === 'usage') delete body.usage;
  if (kind === 'total') body.usage = { input_tokens: 2000, output_tokens: 350, total_tokens: 2000 };
  if (kind === 'model') body.model = 'unexpected-model';
  if (kind === 'tool')
    body.output = [{ type: 'function_call', name: 'publish_catalog', arguments: 'SECRET_SENTINEL' }];
  if (kind === 'missing-message') body.output = [];
  if (kind === 'failed') {
    body.status = 'failed';
    body.error = { message: 'SECRET_SENTINEL' };
  }
  if (kind === 'inconsistent-status') body.incomplete_details = { reason: 'max_output_tokens' };
  if (kind === 'mixed-refusal')
    body.output = [
      {
        ...f.body.output[0],
        content: [...f.body.output[0].content, { type: 'refusal', refusal: 'SECRET_SENTINEL' }],
      },
    ];
  f.fetcher.mockResolvedValueOnce(f.json(body));
  const trace = await runExtraction(f.input, f.factory(f.profile), { limits: { budgetMicrousd: 112384 } });
  expect(trace.status).toBe('provider_error');
  expect(trace.accountedMicrousd).toBe(56192);
  expect(JSON.stringify(trace)).not.toContain('SECRET_SENTINEL');
  expect(f.fetcher).toHaveBeenCalledOnce();
});
it.each([400, 401, 403, 429, 500, 503])(
  'disables SDK retries for HTTP %s and exposes only a stable failure category',
  async (status) => {
    const f = fixture();
    f.fetcher.mockResolvedValueOnce(f.json({ error: { code: 'test', message: 'SECRET_SENTINEL' } }, status));
    const failure = await f.invoke().catch((error) => error);
    expect(failure).toBeInstanceOf(ProviderFailure);
    expect(String(failure)).not.toContain('SECRET');
    expect(failure).toMatchObject({
      category: status === 429 ? 'rate-limit' : status >= 500 ? 'transient' : 'permanent',
    });
    expect(f.fetcher).toHaveBeenCalledOnce();
  },
);
it('does not retry exhausted provider credit', async () => {
  const f = fixture();
  f.fetcher.mockResolvedValueOnce(
    f.json({ error: { code: 'insufficient_quota', message: 'SECRET_SENTINEL' } }, 429),
  );
  expect(
    (await runExtraction(f.input, f.factory(f.profile), { limits: { budgetMicrousd: 112384 } })).status,
  ).toBe('provider_error');
  expect(f.fetcher).toHaveBeenCalledOnce();
});
it('lets only the harness retry a transient response and retains the ambiguous first charge', async () => {
  const f = fixture();
  f.fetcher.mockResolvedValueOnce(f.json({ error: { message: 'Synthetic unavailable' } }, 503));
  const trace = await runExtraction(f.input, f.factory(f.profile), { limits: { budgetMicrousd: 112384 } });
  expect(trace.status).toBe('evidence_valid');
  expect(f.fetcher).toHaveBeenCalledTimes(2);
  expect(trace.attempts.map((attempt) => attempt.outcome)).toEqual(['transient', 'evidence_valid']);
  expect(trace.accountedMicrousd).toBe(58892);
});
it.each(['declared-size', 'stream-size', 'content-type', 'json', 'redirect'])(
  'bounds and rejects invalid transport (%s) before SDK parsing',
  async (kind) => {
    const f = fixture(),
      cancel = vi.fn();
    let response: Response;
    if (kind === 'declared-size' || kind === 'stream-size')
      response = new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(kind === 'stream-size' ? OPENAI_RESPONSE_BYTES + 1 : 1));
          },
          cancel,
        }),
        {
          headers: {
            'content-type': 'application/json',
            ...(kind === 'declared-size' ? { 'content-length': String(OPENAI_RESPONSE_BYTES + 1) } : {}),
          },
        },
      );
    else if (kind === 'content-type')
      response = new Response('SECRET_SENTINEL', { headers: { 'content-type': 'text/html' } });
    else if (kind === 'redirect')
      response = new Response('{}', {
        status: 302,
        headers: { 'content-type': 'application/json', location: 'https://untrusted.example' },
      });
    else response = new Response('SECRET_SENTINEL', { headers: { 'content-type': 'application/json' } });
    f.fetcher.mockResolvedValueOnce(response);
    await expect(f.invoke()).rejects.toMatchObject({ category: 'permanent' });
    expect(f.fetcher).toHaveBeenCalledOnce();
    if (kind === 'declared-size' || kind === 'stream-size') expect(cancel).toHaveBeenCalledOnce();
  },
);
it('passes cancellation to the SDK transport and never retries an aborted request', async () => {
  const f = fixture();
  let started!: () => void;
  const sent = new Promise<void>((resolve) => {
    started = resolve;
  });
  f.fetcher.mockImplementationOnce(async (_url, options) => {
    started();
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Synthetic abort', 'AbortError')),
        { once: true },
      );
    });
  });
  const pending = f.invoke();
  await sent;
  f.controller.abort();
  await expect(pending).rejects.toMatchObject({ category: 'permanent' });
  expect(f.fetcher).toHaveBeenCalledOnce();
});
