import { z } from 'zod';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createApp } from './app.ts';
import { createCatalogRepository } from './catalog-repository.ts';
import { createMerchantRepository } from './merchant-repository.ts';
import { createReviewRepository } from './review-repository.ts';
import { createTokenVerifier } from './review-auth.ts';
import { createCurationDatabase } from './curation/database.ts';
import { createCurationLedger } from './curation/ledger.ts';
import { fixtureRefusalProvider, type CurationExecution } from './curation/service.ts';
import { createOpenAIProviderFactory } from './curation/openai.ts';
import { createTelemetryRepository } from './telemetry-repository.ts';

const env = z
  .object({
    SUPABASE_URL: z.string().min(1),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    HOST: z.string().default('127.0.0.1'),
    REVIEW_DIST_DIR: z.string().min(1).optional(),
    SITE_DIST_DIR: z.string().min(1).optional(),
    CURATION_DATABASE_URL: z.string().min(1).optional(),
    CURATION_DATABASE_CA_FILE: z.string().min(1).optional(),
    CURATION_PROFILE_ID: z
      .string()
      .regex(/^[a-z0-9._-]{1,80}$/)
      .optional(),
    CURATION_ADAPTER: z.enum(['disabled', 'fixture-refusal', 'openai-responses']).default('disabled'),
    CURATION_ALLOW_METERED: z.enum(['false', 'true']).default('false'),
    OPENAI_API_KEY: z.string().min(1).max(4096).optional(),
    CURATION_RATE_LIMIT: z.coerce.number().int().min(1).max(60).default(3),
    // Telemetry (Phase 15.2): the kill switch, the Chrome extension ids whose Origin is accepted (empty: no
    // check, until the first Web Store upload assigns one), and the trusted proxy hops in front of the API.
    TELEMETRY_INGEST: z.enum(['on', 'off']).default('on'),
    EXTENSION_IDS: z
      .string()
      .regex(/^([a-p]{32}(,[a-p]{32})*)?$/)
      .default(''),
    TELEMETRY_PROXY_HOPS: z.coerce.number().int().min(0).max(4).default(0),
  })
  .safeParse(process.env);
if (!env.success)
  throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, with a valid optional PORT.');
const shutdown = new AbortController();
let curationDatabase: ReturnType<typeof createCurationDatabase> | undefined,
  curation: CurationExecution | undefined;
if (env.data.CURATION_ADAPTER !== 'disabled') {
  if (!env.data.CURATION_DATABASE_URL || !env.data.CURATION_PROFILE_ID)
    throw new Error('Configure the scoped curation database and profile.');
  const localUrl = (value: string) => {
    try {
      return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
    } catch {
      return false;
    }
  };
  if (
    env.data.CURATION_ADAPTER === 'fixture-refusal' &&
    ![env.data.CURATION_DATABASE_URL, env.data.SUPABASE_URL].every(localUrl)
  ) {
    throw new Error('The synthetic fixture adapter is restricted to local development databases.');
  }
  // Construction does not call a provider. Ledger admission still requires enabled
  // policy/profile and sufficient durable budgets before every metered run.
  const providerFor =
    env.data.CURATION_ADAPTER === 'fixture-refusal'
      ? fixtureRefusalProvider
      : createOpenAIProviderFactory({
          apiKey: env.data.OPENAI_API_KEY ?? '',
          allowMetered: env.data.CURATION_ALLOW_METERED === 'true',
        });
  let ca: string | undefined;
  if (env.data.CURATION_DATABASE_CA_FILE) {
    try {
      ca = await readFile(env.data.CURATION_DATABASE_CA_FILE, 'utf8');
    } catch {
      throw new Error('The curation database certificate could not be read.');
    }
  }
  curationDatabase = createCurationDatabase(env.data.CURATION_DATABASE_URL, ca);
  await curationDatabase.ready();
  curation = {
    ledger: createCurationLedger(curationDatabase.query),
    profileId: env.data.CURATION_PROFILE_ID,
    providerFor,
  };
}
const app = createApp({
  readCatalog: createCatalogRepository(env.data.SUPABASE_URL, env.data.SUPABASE_PUBLISHABLE_KEY),
  readMerchants: createMerchantRepository(env.data.SUPABASE_URL, env.data.SUPABASE_PUBLISHABLE_KEY),
  reviewRpc: createReviewRepository(env.data.SUPABASE_URL, env.data.SUPABASE_PUBLISHABLE_KEY),
  verifyReviewToken: createTokenVerifier(env.data.SUPABASE_URL, env.data.SUPABASE_PUBLISHABLE_KEY),
  logging: true,
  reviewRoot: env.data.REVIEW_DIST_DIR ? resolve(env.data.REVIEW_DIST_DIR) : undefined,
  reviewConfig: { supabaseUrl: env.data.SUPABASE_URL, publishableKey: env.data.SUPABASE_PUBLISHABLE_KEY },
  siteRoot: env.data.SITE_DIST_DIR ? resolve(env.data.SITE_DIST_DIR) : undefined,
  curation,
  shutdownSignal: shutdown.signal,
  curationLimit: env.data.CURATION_RATE_LIMIT,
  telemetryRpc: createTelemetryRepository(env.data.SUPABASE_URL, env.data.SUPABASE_PUBLISHABLE_KEY),
  telemetry: {
    ingest: env.data.TELEMETRY_INGEST,
    extensionIds: env.data.EXTENSION_IDS.split(',').filter(Boolean),
    proxyHops: env.data.TELEMETRY_PROXY_HOPS,
  },
});
if (curationDatabase)
  app.addHook('onClose', async () => {
    await curationDatabase!.close();
  });
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    shutdown.abort();
    void app.close();
  });
let address: string;
try {
  address = await app.listen({ port: env.data.PORT, host: env.data.HOST });
} catch {
  await app.close();
  throw new Error('The API could not start. Check its host, port, and configuration.');
}
// An IPC parent can discover an ephemeral port without a port-reservation race.
process.send?.({ type: 'listening', address });
