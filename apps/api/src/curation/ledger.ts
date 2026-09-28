import { z } from 'zod';
import { buildContext } from './context.ts';
import { extractionInputSchema, validateInputs } from './extraction.ts';
import { runExtraction, type ExtractionProvider, type ExtractionTrace } from './runner.ts';

import {
  curationRunSchema,
  type CurationRun,
  type CurationProfile,
} from '@ai-checkout/catalog-review/curation';
export {
  curationRunSchema,
  type CurationRun,
  type CurationProfile,
} from '@ai-checkout/catalog-review/curation';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const claimSchema = z.discriminatedUnion('claimed', [
  z.strictObject({ claimed: z.literal(true), executionToken: hash, run: curationRunSchema }),
  z.strictObject({ claimed: z.literal(false), run: curationRunSchema }),
]);

/** Supply a bounded, parameterized connection under aicheckout_curation_executor, never postgres. */
export type LedgerQuery = (sql: string, parameters: unknown[]) => Promise<{ rows: { value: unknown }[] }>;
export class LedgerError extends Error {
  readonly code: string;
  readonly runId?: string;
  constructor(code: string, runId?: string) {
    super(code);
    this.code = code;
    this.runId = runId;
  }
}
export function createCurationLedger(query: LedgerQuery) {
  async function call(sql: string, parameters: unknown[]) {
    try {
      const result = await query(sql, parameters);
      if (result.rows.length !== 1) throw new Error('Unexpected database result');
      return result.rows[0].value;
    } catch (failure) {
      const code = failure && typeof failure === 'object' && 'code' in failure ? failure.code : null;
      throw new LedgerError(
        (
          {
            '42501': 'reviewer_access_required',
            '40001': 'curation_changed',
            '55000': 'curation_inactive',
            '54000': 'curation_budget_exhausted',
            '53300': 'curation_capacity_exhausted',
            '22023': 'invalid_curation_input',
          } as Record<string, string>
        )[String(code)] ?? 'curation_unavailable',
      );
    }
  }
  return {
    async claim(
      actor: { userId: string; sessionId: string },
      requestKey: string,
      profileId: string,
      cardId: string,
      sourceIds: string[],
      context: ReturnType<typeof buildContext>,
    ) {
      return claimSchema.parse(
        await call('select catalog_private.claim_curation_run($1,$2,$3,$4,$5,$6,$7) as value', [
          actor.userId,
          actor.sessionId,
          requestKey,
          profileId,
          cardId,
          sourceIds,
          context,
        ]),
      );
    },
    async check(id: string, token: string) {
      return curationRunSchema.parse(
        await call('select catalog_private.check_curation_execution($1,$2) as value', [id, token]),
      );
    },
    async finish(id: string, token: string, trace: ExtractionTrace) {
      return curationRunSchema.parse(
        await call('select catalog_private.finish_curation_run($1,$2,$3) as value', [id, token, trace]),
      );
    },
  };
}

/** Internal orchestration, not an authentication boundary. The HTTP service must
 * verify the human token through the existing signed-session review RPC before calling.
 * Neither identity, provider factory, profile ID, nor SQL connection comes from model output. */
export async function executeRecordedExtraction({
  input: rawInput,
  actor,
  requestKey,
  profileId,
  ledger,
  providerFor,
  signal,
  origin,
}: {
  input: unknown;
  actor: { userId: string; sessionId: string };
  requestKey: string;
  profileId: string;
  ledger: ReturnType<typeof createCurationLedger>;
  providerFor: (profile: CurationProfile) => ExtractionProvider;
  signal?: AbortSignal;
  origin?: { draftId: string; revision: number; catalogHash: string };
}): Promise<{ executed: boolean; run: CurationRun }> {
  z.uuid().parse(actor.userId);
  z.uuid().parse(actor.sessionId);
  z.uuid().parse(requestKey);
  if (signal?.aborted) throw new LedgerError('curation_cancelled');
  const input = extractionInputSchema.parse(rawInput);
  if (validateInputs(input, Date.now()).length || Buffer.byteLength(JSON.stringify(input), 'utf8') > 96000)
    throw new LedgerError('invalid_curation_input');
  const context = {
    ...buildContext(input),
    ...(origin
      ? {
          origin: z
            .strictObject({ draftId: z.uuid(), revision: z.number().int().positive(), catalogHash: hash })
            .parse(origin),
        }
      : {}),
  };
  const claim = await ledger.claim(
    actor,
    requestKey,
    profileId,
    input.cardId,
    input.documents.map((document) => document.id),
    context,
  );
  if (!claim.claimed) return { executed: false, run: claim.run };
  const { run, executionToken } = claim,
    profile = run.profile;
  let provider: ExtractionProvider;
  try {
    provider = providerFor(profile);
    if (
      provider.id !== profile.provider ||
      provider.model !== profile.model ||
      provider.mode !== profile.mode ||
      provider.pricing.input !== profile.input_price ||
      provider.pricing.output !== profile.output_price
    )
      throw new Error('Provider mismatch');
  } catch {
    // Record a configuration failure through the normal bounded trace path. No provider call.
    provider = {
      id: profile.provider,
      model: profile.model,
      mode: profile.mode,
      pricing: { input: profile.input_price, output: profile.output_price },
      invoke: async () => {
        throw new Error('Provider unavailable');
      },
    };
  }
  const trace = await runExtraction(input, provider, {
    runId: run.id,
    signal,
    limits: {
      budgetMicrousd: run.reserved_microusd,
      maxAttempts: profile.max_attempts,
      maxInputTokens: profile.max_input_tokens,
      maxOutputTokens: profile.max_output_tokens,
      attemptTimeoutMs: profile.attempt_timeout_ms,
      totalTimeoutMs: profile.total_timeout_ms,
    },
    beforeAttempt: async () => {
      await ledger.check(run.id, executionToken);
    },
  });
  try {
    return { executed: true, run: await ledger.finish(run.id, executionToken, trace) };
  } catch {
    throw new LedgerError('curation_result_unconfirmed', run.id);
  }
}
