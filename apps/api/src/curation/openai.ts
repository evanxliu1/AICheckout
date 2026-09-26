import OpenAI from 'openai';
import { z } from 'zod';
import { readBoundedJson } from '@ai-checkout/catalog-client';
import type { CurationProfile } from './ledger';
import { ProviderFailure, type ExtractionProvider } from './runner';

export const OPENAI_RESPONSE_BYTES = 524288;
const endpoint = 'https://api.openai.com/v1/responses';
const tokens = z.number().int().min(0).max(1_000_000);
const responseSchema = z.object({ id: z.string().regex(/^resp_[a-zA-Z0-9_-]+$/).max(200), model: z.string().min(1).max(120),
  status: z.enum(['completed', 'incomplete']), error: z.null(),
  incomplete_details: z.object({ reason: z.enum(['max_output_tokens', 'content_filter']) }).nullable(),
  usage: z.object({ input_tokens: tokens, output_tokens: tokens, total_tokens: z.number().int().min(0).max(2_000_000) }),
  output: z.array(z.unknown()).max(20),
});
const messageSchema = z.object({ type: z.literal('message'), role: z.literal('assistant'), status: z.enum(['completed', 'incomplete']),
  content: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('output_text'), text: z.string() }),
    z.object({ type: z.literal('refusal'), refusal: z.string() }),
  ])).min(1).max(8),
});
class InvalidTransportResponse extends Error { constructor() { super('Invalid bounded provider response.'); } }

/** Bound the entire HTTP body BEFORE the SDK parses it, including non-success replies. */
function boundedTransport(fetcher: typeof fetch): typeof fetch {
  return async (url, init) => {
    if (String(url) !== endpoint || init?.method !== 'POST') throw new InvalidTransportResponse();
    const response = await fetcher(url, { ...init, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    try {
      if (response.status < 200 || response.status >= 600 || response.status === 204 || response.status === 205 || response.status === 304) throw new InvalidTransportResponse();
      const normalized = new Response(response.body, { status: 200, headers: response.headers });
      const body = await readBoundedJson(normalized, OPENAI_RESPONSE_BYTES);
      // Remove stale length/encoding headers after rebuilding the already bounded JSON.
      return new Response(JSON.stringify(body), { status: response.status, headers: { 'content-type': 'application/json' } });
    } catch { throw new InvalidTransportResponse(); }
    finally { if (!response.body?.locked) await response.body?.cancel().catch(() => undefined); }
  };
}

/** The factory accepts operator configuration only. A key alone never enables spending. */
export function createOpenAIProviderFactory({ apiKey, allowMetered, fetcher = fetch }: {
  apiKey: string; allowMetered: boolean; fetcher?: typeof fetch;
}): (profile: CurationProfile) => ExtractionProvider {
  if (!allowMetered || !apiKey || apiKey.length > 4096 || /\s/.test(apiKey)) throw new Error('Metered curation requires explicit configuration.');
  const client = new OpenAI({ apiKey, adminAPIKey: null, organization: null, project: null, webhookSecret: null,
    baseURL: 'https://api.openai.com/v1', maxRetries: 0, timeout: 30000, logLevel: 'off', fetch: boundedTransport(fetcher) });
  return profile => {
    if (profile.provider !== 'openai' || profile.mode !== 'metered' || profile.input_price <= 0 || profile.output_price <= 0 ||
      !/^gpt-[a-zA-Z0-9._-]+-\d{4}-\d{2}-\d{2}$/.test(profile.model)) throw new Error('Unsupported OpenAI extraction profile; configure a dated GPT snapshot and positive price ceilings.');
    return { id: 'openai', model: profile.model, mode: 'metered', pricing: { input: profile.input_price, output: profile.output_price },
      invoke: async request => {
        try {
          const raw = await client.responses.create({ model: profile.model, instructions: request.system,
            input: [{ role: 'user', content: request.user }],
            text: { format: { type: 'json_schema', name: 'issuer_extraction', strict: true, schema: z.record(z.string(), z.unknown()).parse(request.jsonSchema) } },
            max_output_tokens: request.maxOutputTokens, stream: false, background: false, store: false,
            tools: [], tool_choice: 'none', truncation: 'disabled', service_tier: 'default',
          }, { signal: request.signal });
          const result = responseSchema.parse(raw);
          if (result.model !== profile.model || result.usage.total_tokens !== result.usage.input_tokens + result.usage.output_tokens ||
            (result.status === 'completed' && result.incomplete_details !== null) ||
            (result.status === 'incomplete' && result.incomplete_details === null)) throw new InvalidTransportResponse();
          const messages = [];
          for (const item of result.output) {
            if (item && typeof item === 'object' && 'type' in item && item.type === 'reasoning') continue;
            messages.push(messageSchema.parse(item)); // Tools and unknown output kinds are never executed or accepted.
          }
          if (messages.length > 1 || (result.status === 'completed' && (messages.length !== 1 || messages[0].status !== 'completed'))) throw new InvalidTransportResponse();
          const content = messages.flatMap(message => message.content);
          const text = content.flatMap(part => part.type === 'output_text' ? [part.text] : []).join('');
          const refusals = content.flatMap(part => part.type === 'refusal' ? [part.refusal] : []);
          if (refusals.length && text) throw new InvalidTransportResponse();
          const finishReason = result.incomplete_details?.reason === 'max_output_tokens' ? 'length' :
            refusals.length || result.incomplete_details?.reason === 'content_filter' ? 'refusal' : 'stop';
          return { finishReason, text: refusals.length ? refusals.join('\n') : text,
            usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens },
            providerResponse: { id: result.id, model: result.model } };
        } catch (error) {
          // Never pass SDK error bodies/headers/credentials to callers, traces, or logs.
          if (request.signal.aborted || error instanceof InvalidTransportResponse || error instanceof z.ZodError ||
            (error instanceof Error && error.cause instanceof InvalidTransportResponse) || error instanceof OpenAI.APIConnectionTimeoutError) throw new ProviderFailure('permanent');
          if (error instanceof OpenAI.APIError && error.status === 429 && error.code !== 'insufficient_quota') throw new ProviderFailure('rate-limit');
          if (error instanceof OpenAI.APIConnectionError || (error instanceof OpenAI.APIError &&
            (error.status === 408 || error.status === 409 || (error.status !== undefined && error.status >= 500)))) throw new ProviderFailure('transient');
          throw new ProviderFailure('permanent');
        }
      },
    };
  };
}
