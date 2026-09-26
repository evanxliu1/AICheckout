import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';

export async function localCatalogFixture({ curation = false } = {}) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const status = JSON.parse(execFileSync(join(root, 'node_modules/.bin/supabase'), ['status', '-o', 'json'],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(status.API_URL, 'http://127.0.0.1:54321', 'Tests may only use the local disposable stack');
  const users = [], sourceIds = [], draftIds = [];
  const db = new pg.Client({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres',
    connectionTimeoutMillis: 5000, statement_timeout: 10000, application_name: 'aicheckout-review-browser' });
  let app, exit, initialHead, started = false, address, curationProfile, curationLogin, previousPolicy;
  const curationEnv = { CURATION_ADAPTER: 'disabled', CURATION_ALLOW_METERED: 'false', OPENAI_API_KEY: 'sk-SYNTHETIC-DISABLED', CURATION_TEST_OUTPUT: 'refusal' };
  async function auth(path, body, admin = false, method = 'POST') {
    const response = await fetch(`${status.API_URL}/auth/v1/${path}`, { method, signal: AbortSignal.timeout(10000),
      headers: { apikey: admin ? status.SERVICE_ROLE_KEY : status.PUBLISHABLE_KEY, 'Content-Type': 'application/json',
        ...(admin ? { Authorization: `Bearer ${status.SERVICE_ROLE_KEY}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.ok(response.ok, `Local test account operation failed (${response.status})`);
    return response.status === 204 ? null : response.json();
  }
  async function account(reviewer) {
    const email = `review-ui-${randomUUID()}@example.test`, password = `Test-${randomUUID()}!`;
    const user = await auth('admin/users', { email, password, email_confirm: true }, true);
    users.push(user.id);
    if (reviewer) await db.query('insert into catalog_private.reviewers(user_id) values($1)', [user.id]);
    const session = await auth('token?grant_type=password', { email, password });
    return { id: user.id, email, password, token: session.access_token };
  }
  async function request(path, { token, body, method = 'GET' } = {}) {
    const response = await fetch(`${address}${path}`, { method, signal: AbortSignal.timeout(10000),
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }
  function ok(result) { assert.equal(result.status, 200, `Fixture API operation failed (${result.status})`); return result.body; }
  async function close() {
    if (app) {
      app.kill('SIGTERM'); if (app.connected) app.disconnect();
      const force = setTimeout(() => app.kill('SIGKILL'), 5000).unref();
      await exit; clearTimeout(force);
    }
    try {
      if (started) {
        await db.query('begin');
        // Include records made through the browser, scoped only to this run's users.
        const ids = (await db.query('select id from catalog_private.drafts where created_by=any($1::uuid[])', [users])).rows.map(row => row.id);
        await db.query('delete from catalog_private.extraction_applications where draft_id=any($1::uuid[])', [ids]);
        await db.query('delete from catalog_private.curation_runs where requested_by=any($1::uuid[])', [users]);
        const releases = (await db.query('select release_sequence::text from catalog_private.publications where draft_id=any($1::uuid[])', [ids])).rows.map(row => row.release_sequence);
        const head = (await db.query('select release_sequence::text from public.catalog_head where singleton for update')).rows[0].release_sequence;
        if (releases.includes(head)) await db.query('update public.catalog_head set release_sequence=$1 where singleton', [initialHead]);
        await db.query('delete from catalog_private.publications where draft_id=any($1::uuid[])', [ids]);
        await db.query('delete from catalog_private.drafts where id=any($1::uuid[])', [ids]);
        await db.query('delete from public.catalog_releases where sequence=any($1::bigint[])', [releases]);
        await db.query('delete from catalog_private.source_documents where created_by=any($1::uuid[])', [users]);
        if (curationProfile) await db.query('delete from catalog_private.curation_profiles where id=$1', [curationProfile]);
        if (previousPolicy) await db.query(`update catalog_private.curation_policy set enabled=$1,lifetime_budget_microusd=$2,daily_budget_microusd=$3,daily_run_limit=$4,max_concurrent=$5 where singleton`,
          [previousPolicy.enabled, previousPolicy.lifetime_budget_microusd, previousPolicy.daily_budget_microusd, previousPolicy.daily_run_limit, previousPolicy.max_concurrent]);
        await db.query('commit');
        if (curationLogin) await db.query(`drop role ${pg.escapeIdentifier(curationLogin)}`);
      }
    } finally {
      await db.end();
      for (const id of users) await auth(`admin/users/${id}`, undefined, true, 'DELETE');
    }
  }
  try {
    await db.connect(); await db.query('select pg_advisory_lock(722093117)');
    initialHead = (await db.query('select release_sequence from public.catalog_head where singleton')).rows[0].release_sequence;
    started = true;
    const reviewer = await account(true), ordinary = await account(false);
    if (curation) {
      previousPolicy = (await db.query('select * from catalog_private.curation_policy where singleton')).rows[0];
      assert.equal((await db.query('select count(*)::int as count from catalog_private.curation_runs')).rows[0].count, 0, 'Curation HTTP verification requires a disposable local ledger');
      curationProfile = `http-${randomUUID()}`; curationLogin = `checkout_test_${randomUUID().replaceAll('-', '')}`;
      const databasePassword = randomUUID();
      await db.query(`create role ${pg.escapeIdentifier(curationLogin)} login password ${pg.escapeLiteral(databasePassword)} nosuperuser nocreatedb nocreaterole noreplication nobypassrls`);
      await db.query(`grant aicheckout_curation_executor to ${pg.escapeIdentifier(curationLogin)}`);
      const sdk = ['openai-intercepted', 'openai-extraction-intercepted'].includes(curation);
      await db.query(`insert into catalog_private.curation_profiles(id,enabled,provider,model,mode,input_price,output_price)
        values($1,true,$2,$3,$4,$5,$6)`, [curationProfile, sdk ? 'openai' : 'fixture', sdk ? 'gpt-synthetic-2026-09-25' : 'synthetic-refusal-v1',
        sdk ? 'metered' : 'fixture', sdk ? 1000000 : 0, sdk ? 2000000 : 0]);
      await db.query('update catalog_private.curation_policy set enabled=true,daily_run_limit=20,max_concurrent=1,lifetime_budget_microusd=$1,daily_budget_microusd=$1 where singleton', [sdk ? 112384 * (curation === 'openai-extraction-intercepted' ? 3 : 1) : 0]);
      const databaseUrl = new URL('postgresql://127.0.0.1:54322/postgres'); databaseUrl.username = curationLogin; databaseUrl.password = databasePassword;
      Object.assign(curationEnv, { CURATION_ADAPTER: 'fixture-refusal', CURATION_DATABASE_URL: databaseUrl.href, CURATION_PROFILE_ID: curationProfile, CURATION_RATE_LIMIT: '30' });
      if (sdk) Object.assign(curationEnv, { CURATION_ADAPTER: 'openai-responses', CURATION_ALLOW_METERED: 'true', OPENAI_API_KEY: 'sk-SYNTHETIC-HTTP-TEST' });
      if (curation === 'openai-extraction-intercepted') curationEnv.CURATION_TEST_OUTPUT = 'extraction';
    }
    // SDK verification intercepts the fixed provider URL before the server loads.
    // The preload refuses all other external transport; it cannot contact a model.
    app = fork(join(root, 'apps/api/dist/index.js'), [], { execArgv: ['openai-intercepted', 'openai-extraction-intercepted'].includes(curation) ? ['--import', join(root, 'scripts/fixtures/openai-refusal-preload.mjs')] : [], silent: true, cwd: root,
      env: { ...process.env, SUPABASE_URL: status.API_URL, SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
        REVIEW_DIST_DIR: join(root, 'apps/review/dist'), PORT: '0', HOST: '127.0.0.1', ...curationEnv } });
    app.stdout.resume(); app.stderr.resume(); exit = once(app, 'exit');
    address = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Compiled API startup timed out')), 10000).unref();
      app.once('message', message => { clearTimeout(deadline); message.type === 'listening' ? resolve(message.address) : reject(new Error('Unexpected API startup message')); });
      app.once('error', reject); app.once('exit', () => { clearTimeout(deadline); reject(new Error('Compiled API exited before startup')); });
    });
    assert.equal(new URL(address).hostname, '127.0.0.1');
    const stamp = randomUUID().slice(0, 8), date = new Date().toISOString().slice(0, 10), sourceKey = `synthetic-ui-${stamp}`;
    const source = ok(await request('/v1/review/sources', { token: reviewer.token, method: 'POST', body: {
      sourceKey, title: 'Synthetic issuer terms for browser verification', url: 'https://issuer.example/review-test',
      checkedOn: date, body: 'Synthetic old terms: 1.5% on eligible purchases. No annual cap. No activation.' } }));
    sourceIds.push(source.id);
    const catalog = { schemaVersion: 1, version: `synthetic-base.${stamp}`, verifiedAt: `${date}T00:00:00Z`,
      expiresAt: new Date(Date.now() + 86400000).toISOString(), merchantIds: ['best-buy-us'],
      sources: [{ id: sourceKey, title: source.title, url: source.url, checkedOn: date }],
      cards: [{ id: 'synthetic-review-card', name: 'Synthetic review card', shortName: 'Review card', rules: [
        { id: 'synthetic-base-rule', category: 'all-eligible', rateBps: 150, requiresActivation: false, sourceIds: [sourceKey] },
      ] }] };
    const queue = ok(await request('/v1/review/', { token: reviewer.token }));
    const base = ok(await request('/v1/review/drafts', { token: reviewer.token, method: 'POST', body: { catalog, sourceDocumentIds: sourceIds, baseSequence: queue.head } }));
    draftIds.push(base.id);
    const published = ok(await request(`/v1/review/drafts/${base.id}/publish`, { token: reviewer.token, method: 'POST', body: {
      expectedRevision: base.revision, expectedHash: base.catalog_hash, expectedHead: queue.head, reviewNote: 'Synthetic baseline for browser verification only.' } }));
    const proposed = structuredClone(catalog); proposed.version = `synthetic-candidate.${stamp}`; proposed.cards[0].rules[0].rateBps = 250;
    const draft = ok(await request('/v1/review/drafts', { token: reviewer.token, method: 'POST', body: {
      catalog: proposed, sourceDocumentIds: [], baseSequence: published.sequence } }));
    draftIds.push(draft.id);
    return { root, address, reviewer, ordinary, draft, published, request, ok, close,
      signOut: token => fetch(`${status.API_URL}/auth/v1/logout?scope=local`, { method: 'POST',
        headers: { apikey: status.PUBLISHABLE_KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }) };
  } catch (error) { await close(); throw error; }
}
