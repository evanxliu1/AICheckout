import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { PILOT_CATALOG } from '@ai-checkout/rewards-core';
import { localCatalogFixture } from './lib/local-catalog-fixture.mjs';

// Real signed HTTP requests and database locks; the SDK transport is intercepted.
// These invented terms test application safety, not model quality or issuer facts.
const fixture = await localCatalogFixture({ curation: 'openai-extraction-intercepted' });
const { reviewer, request, ok, published } = fixture;
const config = { host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres',
  connectionTimeoutMillis: 5000, statement_timeout: 10000, application_name: 'aicheckout-application-test' };
const owner = new pg.Client(config), blocker = new pg.Client(config);
let blocking = false, pending = [];

async function lockDraft(id) {
  await blocker.query('begin'); blocking = true;
  await blocker.query('select id from catalog_private.drafts where id=$1 for update', [id]);
}
async function unlockDraft() { await blocker.query('rollback'); blocking = false; }
async function waitForApplications(count) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const result = await owner.query(`select count(*)::int as count from pg_stat_activity
      where datname='postgres' and wait_event_type='Lock' and query like '%apply_reviewed_extraction%'`);
    if (result.rows[0].count === count) return;
    await delay(25);
  }
  throw new Error(`Expected ${count} application requests waiting for the draft lock`);
}
function apply(path, body) {
  // Attach both handlers before checking the lock so a transport failure stays observed.
  return request(path, { token: reviewer.token, method: 'POST', body })
    .then(result => ({ result }), error => ({ error }));
}
async function makeExtraction(source, catalog) {
  const draft = ok(await request('/v1/review/drafts', { token: reviewer.token, method: 'POST', body: {
    catalog: { ...catalog, version: `synthetic-application.${randomUUID().slice(0, 8)}` },
    sourceDocumentIds: [source.id], baseSequence: published.sequence,
  } }));
  const path = `/v1/review/drafts/${draft.id}/extractions`;
  const { run } = ok(await request(path, { token: reviewer.token, method: 'POST', body: {
    cardId: 'capital-one-quicksilver', expectedRevision: draft.revision, requestKey: randomUUID(),
  } }));
  assert.equal(run.trace.status, 'evidence_valid');
  return { draft, run, path: `${path}/${run.id}/apply`, body: {
    expectedRevision: draft.revision, expectedHash: draft.catalog_hash,
    reviewNote: 'Reviewed synthetic evidence for the concurrent-application safety test.',
    conditionReviews: [{ index: 0, coverage: 'existing-rules', ruleIds: ['quicksilver-base'],
      note: 'The all-eligible category represents the synthetic eligibility condition.' }],
  } };
}

try {
  await Promise.all([owner.connect(), blocker.connect()]);
  const date = new Date().toISOString().slice(0, 10), catalog = structuredClone(PILOT_CATALOG);
  catalog.cards = catalog.cards.slice(0, 1); catalog.sources = catalog.sources.slice(0, 1);
  catalog.verifiedAt = `${date}T00:00:00Z`; catalog.expiresAt = new Date(Date.now() + 86400000).toISOString();
  catalog.sources[0].checkedOn = date; catalog.sources[0].title = 'Synthetic application safety test; invented terms';
  const source = ok(await request('/v1/review/sources', { token: reviewer.token, method: 'POST', body: {
    sourceKey: catalog.sources[0].id, title: catalog.sources[0].title, url: catalog.sources[0].url, checkedOn: date,
    body: 'SYNTHETIC REVIEW TEST: invented terms, not issuer evidence. Earn 2.5% on all eligible purchases. There is no annual spending cap. No activation is required.',
  } }));
  const before = ok(await request('/v1/catalog'));
  const first = await makeExtraction(source, catalog);
  await lockDraft(first.draft.id);
  pending = [apply(first.path, first.body), apply(first.path, first.body)];
  await waitForApplications(2); await unlockDraft();
  const outcomes = await Promise.all(pending);
  for (const outcome of outcomes) { if (outcome.error) throw outcome.error; ok(outcome.result); }
  const applied = outcomes[0].result.body;
  assert.deepEqual(outcomes[1].result.body, applied, 'Concurrent identical requests must acknowledge one application');
  assert.equal(applied.draft.revision, first.draft.revision + 1);
  assert.equal(applied.draft.catalog.cards[0].rules[0].rateBps, 250);
  assert.equal(applied.draft.catalog.expiresAt, catalog.expiresAt);
  assert.equal((await owner.query('select count(*)::int as count from catalog_private.extraction_applications where run_id=$1', [first.run.id])).rows[0].count, 1);
  assert.deepEqual(ok(await request('/v1/catalog')), before);
  console.log('PASS: simultaneous identical human applications create one draft revision and one audit record, without publication.');

  ok(await request(`/v1/review/drafts/${first.draft.id}`, { token: reviewer.token, method: 'PUT', body: {
    expectedRevision: applied.draft.revision, catalog: applied.draft.catalog,
    sourceDocumentIds: [source.id], baseSequence: published.sequence,
  } }));
  assert.equal((await request(first.path, { token: reviewer.token, method: 'POST', body: first.body })).status, 409);
  console.log('PASS: an old application retry cannot overwrite a later human edit.');

  const expiring = await makeExtraction(source, catalog);
  const claims = JSON.parse(Buffer.from(reviewer.token.split('.')[1], 'base64url').toString('utf8'));
  const expiry = new Date(Date.now() + 1800);
  // Set the deadline before the request obtains its live-session share lock.
  await owner.query('update auth.sessions set not_after=$1 where id=$2 and user_id=$3', [expiry, claims.session_id, reviewer.id]);
  await lockDraft(expiring.draft.id);
  pending = [apply(expiring.path, expiring.body)];
  await waitForApplications(1);
  await delay(Math.max(0, expiry.getTime() - Date.now() + 80));
  await unlockDraft();
  const [expired] = await Promise.all(pending);
  if (expired.error) throw expired.error;
  assert.equal(expired.result.status, 403);
  assert.equal((await owner.query('select revision from catalog_private.drafts where id=$1', [expiring.draft.id])).rows[0].revision, expiring.draft.revision);
  assert.equal((await owner.query('select count(*)::int as count from catalog_private.extraction_applications where run_id=$1', [expiring.run.id])).rows[0].count, 0);
  assert.deepEqual(ok(await request('/v1/catalog')), before);
  console.log('PASS: session expiry during a real database lock wait denies application and leaves the draft and public catalog unchanged.');
} finally {
  if (blocking) await unlockDraft();
  await Promise.all(pending);
  await Promise.allSettled([owner.end(), blocker.end()]);
  await fixture.close();
}
