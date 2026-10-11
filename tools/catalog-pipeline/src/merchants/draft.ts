// Stage 3, draft: gpt-5.6-luna at xhigh through `codex exec` (local subscription, apps/api/src/curation/codex.ts), one
// call per store, from the captures only, with the prompt file merchant-draft.2 (issuer captures as the windows around
// the store's name plus the windows around the issuer's category definitions). The reply is gated (Zod, quotes
// verbatim and at most 25 words, catalog brands, the store's own sources) and written to drafts/<domain>.json; the raw
// reply goes to the gitignored traces/. Refused under CI or RENDER. The model proposes `candidateCategory`; it never
// sets `category` (apply does, from the evidence rule).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CATALOG_V3 } from '../../../../packages/rewards-core/src/catalog-v3.ts';
import { MERCHANT_CATEGORIES_V3 } from '../../../../packages/rewards-core/src/types.ts';
import { sha256Hex } from '../hash.ts';
import { writeJsonAtomic } from '../state.ts';
import type { Env } from '../run.ts';
import {
  PROMPT_FILE,
  PROMPT_VERSION,
  draftFileSchema,
  draftJsonSchema,
  draftSchema,
  loadBatch,
  manifestFileSchema,
  readJson,
  researchFileSchema,
  writeState,
} from './files.ts';
import type { Batch, ManifestEntry } from './files.ts';
import { definitionWindows } from './capture.ts';
import { draftGate } from './packets.ts';

export const DRAFT_MODEL = { model: 'gpt-5.6-luna', effort: 'xhigh' as const, attemptTimeoutMs: 600_000 };
/** Characters of each document shown to the model (store pages first; the harness admits about 64k input tokens). */
const DOC_LIMITS = { 'store-page': 14_000, 'mcc-lookup': 6_000, 'issuer-terms': 8_000 } as const;

export interface DraftDocument {
  id: string;
  kind: ManifestEntry['kind'];
  url: string;
  text: string;
}

/** The user message: the brand list, the store, and its documents (issuer captures as windows around the name). */
export function userMessage(
  domain: string,
  name: string,
  hosts: string[],
  documents: DraftDocument[],
): string {
  const brands = CATALOG_V3.brands.map((b) => `${b.id}: ${b.name}`).join('\n');
  const docs = documents
    .map(
      (doc) => `### Source ${doc.id} (${doc.kind}; ${doc.url})\n${doc.text.slice(0, DOC_LIMITS[doc.kind])}`,
    )
    .join('\n\n');
  return [
    `Store: ${domain} ("${name}"; hosts: ${hosts.join(', ')})`,
    `Categories: ${MERCHANT_CATEGORIES_V3.join(', ')}`,
    `Catalog brands (id: name):\n${brands}`,
    `Documents:\n\n${docs}`,
  ].join('\n\n');
}

export async function runDraft(
  env: Env,
  batchId: string,
  { only }: { only?: string[] } = {},
): Promise<number> {
  if (env.env.CI || env.env.RENDER) {
    env.log('draft: model stages never run on CI or Render.');
    return 1;
  }
  const batch = await loadBatch(env.root, batchId);
  if (batch.state.stages.capture.status !== 'done') {
    env.log('draft: capture is not done.');
    return 1;
  }
  const promptText = await readFile(join(env.root, PROMPT_FILE), 'utf8');
  const promptSha256 = sha256Hex(promptText);
  const research = await readJson(join(batch.dir, 'research.json'), researchFileSchema);
  const manifest = await readJson(join(batch.dir, 'manifest.json'), manifestFileSchema);
  const { createCodexProvider } = await import('../../../../apps/api/src/curation/codex.ts');
  const provider = await createCodexProvider({
    model: DRAFT_MODEL.model,
    reasoningEffort: DRAFT_MODEL.effort,
    outputTokens: 'visible',
  });
  await mkdir(join(batch.dir, 'drafts'), { recursive: true });
  await mkdir(join(batch.dir, 'traces'), { recursive: true });
  let failed = 0;
  for (const store of research.stores) {
    if (only && !only.includes(store.domain)) continue;
    const existing = batch.state.stores[store.domain]?.draft;
    if (existing?.status === 'done' && batch.state.stages.draft.status !== 'stale' && !only) continue;
    const documents: DraftDocument[] = [];
    for (const source of manifest.sources.filter((s) => s.domain === store.domain)) {
      const full = await readFile(join(batch.dir, 'captures', `${source.id}.txt`), 'utf8');
      let text = full;
      if (source.kind === 'issuer-terms') {
        const named = await readFile(
          join(batch.dir, 'captures', `${source.id}.windows.${store.domain}.txt`),
          'utf8',
        ).catch(() => full);
        const definitions = definitionWindows(full).join('\n\n[…]\n\n');
        text = definitions
          ? `${named}\n\n[category definitions elsewhere on this page]\n\n${definitions}`
          : named;
      }
      documents.push({ id: source.id, kind: source.kind, url: source.url, text });
    }
    const started = Date.now();
    const user = userMessage(store.domain, store.name, store.hosts, documents);
    let status: 'done' | 'failed-gate' | 'provider-error' | 'timeout' = 'done';
    let usage = { inputTokens: 0, outputTokens: 0 };
    try {
      const reply = (await provider.invoke({
        system: promptText,
        user,
        jsonSchema: draftJsonSchema,
        maxOutputTokens: 8192,
        signal: AbortSignal.timeout(DRAFT_MODEL.attemptTimeoutMs),
      })) as { text: string; usage: { inputTokens: number; outputTokens: number } };
      usage = reply.usage;
      await writeFile(
        join(batch.dir, 'traces', `${store.domain}.json`),
        JSON.stringify({ user, reply }, null, 2),
      );
      const parsed = draftSchema.safeParse(JSON.parse(reply.text));
      if (!parsed.success) {
        status = 'failed-gate';
        env.log(
          `${store.domain}: draft rejected by schema: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`,
        );
      } else {
        await writeJsonAtomic(
          join(batch.dir, 'drafts', `${store.domain}.json`),
          draftFileSchema.parse({
            schemaVersion: 1,
            batch: batch.id,
            promptVersion: PROMPT_VERSION,
            promptSha256,
            model: DRAFT_MODEL.model,
            effort: DRAFT_MODEL.effort,
            draftedOn: env.now().toISOString().slice(0, 10),
            usage,
            durationMs: Date.now() - started,
            draft: { ...parsed.data, domain: store.domain },
          }),
        );
        const errors = await draftGate(batch, store.domain);
        if (errors.length) {
          status = 'failed-gate';
          env.log(`${store.domain}: draft gate failed:\n  - ${errors.join('\n  - ')}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status = /timeout|abort/i.test(message) ? 'timeout' : 'provider-error';
      env.log(`${store.domain}: ${status} (${message.split('\n')[0]})`);
    }
    if (status !== 'done') failed += 1;
    batch.state.stores[store.domain] = {
      ...batch.state.stores[store.domain],
      draft: {
        status,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        durationMs: Date.now() - started,
        finishedAt: env.now().toISOString(),
      },
    };
    await writeState(batch.dir, batch.state, env.now());
    env.log(
      `${store.domain}: ${status} in ${Math.round((Date.now() - started) / 1000)} s, ${usage.inputTokens} in / ${usage.outputTokens} out tokens.`,
    );
  }
  const all = research.stores.every((s) => batch.state.stores[s.domain]?.draft?.status === 'done');
  const now = env.now();
  batch.state.stages.draft = {
    status: all ? 'done' : 'failed-gate',
    finishedAt: now.toISOString(),
    attempts: (batch.state.stages.draft.attempts ?? 0) + 1,
    inputSha256: promptSha256,
  };
  await writeState(batch.dir, batch.state, now);
  const totals = research.stores.reduce(
    (acc, s) => {
      const d = batch.state.stores[s.domain]?.draft;
      return d
        ? { input: acc.input + d.inputTokens, output: acc.output + d.outputTokens, ms: acc.ms + d.durationMs }
        : acc;
    },
    { input: 0, output: 0, ms: 0 },
  );
  env.log(
    `draft: ${research.stores.length - failed} of ${research.stores.length} drafted; ${totals.input} input / ${totals.output} output tokens, ${Math.round(totals.ms / 1000)} s model time.`,
  );
  return failed ? 1 : 0;
}

export { type Batch };
