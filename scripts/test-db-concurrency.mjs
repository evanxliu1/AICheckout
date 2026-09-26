import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

// Deliberately local-only: never consumes DATABASE_URL or hosted credentials.
const config = { host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres',
  connectionTimeoutMillis: 5000, statement_timeout: 10000, application_name: 'aicheckout-concurrency-test' };
const [owner, blocker, first, second] = Array.from({ length: 4 }, () => new pg.Client(config));
const clients = [owner, blocker, first, second];
const userId = randomUUID();
const sessionId = randomUUID();
const sourceKey = `race-${randomUUID()}`;
const sourceIds = [];
const draftIds = [];
let initialHead;
let ownsFixture = false;
let blocking = false;
let pending = [];
const publishSql = 'select public.publish_catalog($1,$2,$3,$4,$5) as release';
const date = new Date().toISOString().slice(0, 10);

function catalog(version, expiresAt = new Date(Date.now() + 86400000).toISOString()) {
  return { schemaVersion: 1, version, verifiedAt: `${date}T00:00:00Z`, expiresAt,
    merchantIds: ['best-buy-us'],
    sources: [{ id: sourceKey, title: 'Synthetic race-test source', url: 'https://issuer.example/race', checkedOn: date }],
    cards: [{ id: 'race-card', name: 'Synthetic test card', shortName: 'Test', rules: [{
      id: 'race-base', category: 'all-eligible', rateBps: 150, requiresActivation: false, sourceIds: [sourceKey],
    }] }],
  };
}
async function makeDraft(client, payload, head) {
  const { rows } = await client.query('select public.save_catalog_draft(null,null,$1,$2,$3) as draft',
    [payload, sourceIds, head]);
  draftIds.push(rows[0].draft.id);
  return rows[0].draft;
}
function publish(client, draft, head) {
  // Attach the rejection handler immediately while the other connection is still running.
  return client.query(publishSql, [draft.id, draft.revision, draft.catalog_hash, head, 'Reviewed synthetic race-test evidence.'])
    .then(result => ({ ok: true, release: result.rows[0].release }), error => ({ ok: false, error }));
}
async function lockHead() {
  await blocker.query('begin');
  blocking = true;
  await blocker.query('select release_sequence from public.catalog_head where singleton for update');
}
async function unlockHead() {
  await blocker.query('rollback');
  blocking = false;
}
async function waitForBlocked(count) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const { rows } = await owner.query(`select count(*)::int as waiting from pg_stat_activity
      where pid=any($1::int[]) and wait_event_type='Lock'`, [[first.processID, second.processID]]);
    if (rows[0].waiting === count) return;
    await delay(25);
  }
  throw new Error(`Expected ${count} blocked publication(s)`);
}

try {
  await Promise.all(clients.map(client => client.connect()));
  // Prevent two copies of this test from sharing the single catalog head.
  await owner.query('select pg_advisory_lock(722093117)');
  initialHead = (await owner.query('select release_sequence from public.catalog_head where singleton')).rows[0].release_sequence;
  await owner.query('insert into auth.users(id,is_anonymous) values($1,false)', [userId]);
  ownsFixture = true;
  await owner.query('insert into auth.sessions(id,user_id) values($1,$2)', [sessionId, userId]);
  await owner.query('insert into catalog_private.reviewers(user_id) values($1)', [userId]);
  for (const client of [first, second]) {
    await client.query('set role authenticated');
    await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: userId, session_id: sessionId, role: 'authenticated' })]);
  }
  const captured = await first.query('select public.capture_catalog_source($1,$2,$3,$4,$5) as source',
    [sourceKey, 'Synthetic race-test source', 'https://issuer.example/race', date, 'Synthetic terms: 1.5% base rewards.']);
  sourceIds.push(captured.rows[0].source.id);

  const drafts = await Promise.all([
    makeDraft(first, catalog(`race-a.${randomUUID()}`), initialHead),
    makeDraft(second, catalog(`race-b.${randomUUID()}`), initialHead),
  ]);
  await lockHead();
  pending = [publish(first, drafts[0], initialHead), publish(second, drafts[1], initialHead)];
  await waitForBlocked(2);
  await unlockHead();
  const results = await Promise.all(pending);
  assert.equal(results.filter(result => result.ok).length, 1, 'Only one competing draft may advance the head');
  assert.equal(results.find(result => !result.ok).error.code, '40001', 'Losing publication must require another review');
  const winner = results.find(result => result.ok).release;
  assert.equal((await owner.query('select release_sequence::text from public.catalog_head')).rows[0].release_sequence, String(winner.sequence));
  assert.equal((await owner.query('select count(*)::int from catalog_private.publications where draft_id=any($1)', [draftIds])).rows[0].count, 1);
  console.log('PASS: simultaneous publications commit one release and reject the stale competing draft.');

  // Expiry can occur while the request waits for the head lock. Use real clocks/locks.
  const expiry = new Date(Date.now() + 1200);
  const expiring = await makeDraft(first, catalog(`race-expiry.${randomUUID()}`, expiry.toISOString()), winner.sequence);
  await lockHead();
  pending = [publish(first, expiring, winner.sequence)];
  await waitForBlocked(1);
  await delay(Math.max(0, expiry.getTime() - Date.now() + 80));
  await unlockHead();
  const [expired] = await Promise.all(pending);
  assert.equal(expired.ok, false);
  assert.equal(expired.error.message, 'Catalog is not currently valid');
  assert.equal((await owner.query('select release_sequence::text from public.catalog_head')).rows[0].release_sequence, String(winner.sequence));
  console.log('PASS: a catalog expiring during a lock wait cannot publish or change the head.');

  // A session can also expire during a wait, even though its signed token remains valid.
  const sessionExpiry = new Date(Date.now() + 1200);
  const fresh = await makeDraft(first, catalog(`race-session.${randomUUID()}`), winner.sequence);
  await owner.query('update auth.sessions set not_after=$1 where id=$2', [sessionExpiry, sessionId]);
  await lockHead();
  pending = [publish(first, fresh, winner.sequence)];
  await waitForBlocked(1);
  await delay(Math.max(0, sessionExpiry.getTime() - Date.now() + 80));
  await unlockHead();
  const [expiredSession] = await Promise.all(pending);
  assert.equal(expiredSession.ok, false);
  assert.equal(expiredSession.error.code, '42501');
  console.log('PASS: a session expiring during a lock wait loses publication authority.');
} finally {
  if (blocking) await unlockHead();
  await Promise.all(pending);
  try {
    if (ownsFixture) {
      // Delete only this run's generated fixtures; leave any other local work intact.
      await owner.query('begin');
      const releases = (await owner.query('select release_sequence::text from catalog_private.publications where draft_id=any($1)', [draftIds])).rows.map(row => row.release_sequence);
      const head = (await owner.query('select release_sequence::text from public.catalog_head where singleton for update')).rows[0].release_sequence;
      if (releases.includes(head)) await owner.query('update public.catalog_head set release_sequence=$1 where singleton', [initialHead]);
      await owner.query('delete from catalog_private.publications where draft_id=any($1)', [draftIds]);
      await owner.query('delete from catalog_private.drafts where id=any($1)', [draftIds]);
      await owner.query('delete from public.catalog_releases where sequence=any($1::bigint[])', [releases]);
      await owner.query('delete from catalog_private.source_documents where id=any($1)', [sourceIds]);
      await owner.query('delete from auth.users where id=$1', [userId]);
      await owner.query('commit');
    }
  } finally {
    await Promise.allSettled(clients.map(client => client.end()));
  }
}
