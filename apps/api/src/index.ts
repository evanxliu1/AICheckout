import { z } from 'zod';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createApp } from './app.js';
import { createCatalogRepository } from './catalog-repository.js';
import { createReviewRepository } from './review-repository.js';
import { createCurationDatabase } from './curation/database';
import { createCurationLedger } from './curation/ledger';
import { fixtureRefusalProvider, type CurationExecution } from './curation/service';
import { createOpenAIProviderFactory } from './curation/openai';

const env = z.object({
  SUPABASE_URL: z.string().min(1), SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000), HOST: z.string().default('127.0.0.1'),
  REVIEW_DIST_DIR: z.string().min(1).optional(),
  CURATION_DATABASE_URL: z.string().min(1).optional(), CURATION_DATABASE_CA_FILE: z.string().min(1).optional(),
  CURATION_PROFILE_ID: z.string().regex(/^[a-z0-9._-]{1,80}$/).optional(),
  CURATION_ADAPTER: z.enum(['disabled', 'fixture-refusal', 'openai-responses']).default('disabled'),
  CURATION_ALLOW_METERED: z.enum(['false', 'true']).default('false'),
  OPENAI_API_KEY: z.string().min(1).max(4096).optional(),
  CURATION_RATE_LIMIT: z.coerce.number().int().min(1).max(60).default(3),
}).safeParse(process.env);
if (!env.success) throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, with a valid optional PORT.');
const shutdown = new AbortController();
let curationDatabase: ReturnType<typeof createCurationDatabase> | undefined, curation: CurationExecution | undefined;
if (env.data.CURATION_ADAPTER !== 'disabled') {
  if (!env.data.CURATION_DATABASE_URL || !env.data.CURATION_PROFILE_ID) throw new Error('Configure the scoped curation database and profile.');
  const localUrl = (value: string) => { try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname); } catch { return false; } };
  if (env.data.CURATION_ADAPTER === 'fixture-refusal' && ![env.data.CURATION_DATABASE_URL, env.data.SUPABASE_URL].every(localUrl)) {
    throw new Error('The synthetic fixture adapter is restricted to local development databases.');
  }
  // Construction does not call a provider. Ledger admission still requires enabled
  // policy/profile and sufficient durable budgets before every metered run.
  const providerFor = env.data.CURATION_ADAPTER === 'fixture-refusal' ? fixtureRefusalProvider : createOpenAIProviderFactory({
    apiKey: env.data.OPENAI_API_KEY ?? '', allowMetered: env.data.CURATION_ALLOW_METERED === 'true',
  });
  let ca: string | undefined;
  if (env.data.CURATION_DATABASE_CA_FILE) {
    try { ca = await readFile(env.data.CURATION_DATABASE_CA_FILE, 'utf8'); }
    catch { throw new Error('The curation database certificate could not be read.'); }
  }
  curationDatabase = createCurationDatabase(env.data.CURATION_DATABASE_URL, ca);
  await curationDatabase.ready();
  curation = { ledger: createCurationLedger(curationDatabase.query), profileId: env.data.CURATION_PROFILE_ID, providerFor };
}
const app = createApp({ readCatalog: createCatalogRepository(env.data.SUPABASE_URL, env.data.SUPABASE_PUBLISHABLE_KEY),
  reviewRpc: createReviewRepository(env.data.SUPABASE_URL, env.data.SUPABASE_PUBLISHABLE_KEY), logging: true,
  reviewRoot: env.data.REVIEW_DIST_DIR ? resolve(env.data.REVIEW_DIST_DIR) : undefined,
  reviewConfig: { supabaseUrl: env.data.SUPABASE_URL, publishableKey: env.data.SUPABASE_PUBLISHABLE_KEY }, curation,
  shutdownSignal: shutdown.signal, curationLimit: env.data.CURATION_RATE_LIMIT });
if (curationDatabase) app.addHook('onClose', async () => { await curationDatabase!.close(); });
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => { shutdown.abort(); void app.close(); });
let address: string;
try { address = await app.listen({ port: env.data.PORT, host: env.data.HOST }); }
catch { await app.close(); throw new Error('The API could not start. Check its host, port, and configuration.'); }
// An IPC parent can discover an ephemeral port without a port-reservation race.
process.send?.({ type: 'listening', address });
