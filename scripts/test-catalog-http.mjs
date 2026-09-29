import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createApp } from '../apps/api/src/app.ts';
import { createCatalogRepository } from '../apps/api/src/catalog-repository.ts';
import { createReviewRepository } from '../apps/api/src/review-repository.ts';
import { catalogResponseSchema } from '../packages/rewards-core/src/schema.ts';

// This test deliberately ignores hosted environment variables. Privileged credentials
// provision/delete synthetic LOCAL Auth users only; publication uses their real JWTs.
const status = JSON.parse(
  execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }),
);
assert.equal(status.API_URL, 'http://127.0.0.1:54321', 'Only the disposable local stack is allowed');
assert.ok(status.PUBLISHABLE_KEY && status.SERVICE_ROLE_KEY, 'Start local Auth and Data API services first');
const apiUrl = status.API_URL;
const publicKey = status.PUBLISHABLE_KEY;
const owner = new pg.Client({
  host: '127.0.0.1',
  port: 54322,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
  application_name: 'aicheckout-http-test',
});
const userIds = [],
  sourceIds = [],
  draftIds = [];
let initialHead,
  fixtureStarted = false,
  app,
  address;

async function request(path, { token, body, method = 'POST', admin = false } = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
    headers: {
      apikey: admin ? status.SERVICE_ROLE_KEY : publicKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(admin ? { Authorization: `Bearer ${status.SERVICE_ROLE_KEY}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
async function review(method, path, token, body) {
  const response = await fetch(`${address}/v1/review${path}`, {
    method,
    signal: AbortSignal.timeout(10000),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
function ok(result, label) {
  // Never dump token-bearing response bodies on an assertion failure.
  assert.ok(result.status >= 200 && result.status < 300, `${label}: HTTP ${result.status}`);
  return result.body;
}
async function account() {
  const email = `catalog-http-${randomUUID()}@example.test`,
    password = `Test-${randomUUID()}!`;
  const user = ok(
    await request('/auth/v1/admin/users', { admin: true, body: { email, password, email_confirm: true } }),
    'Create local test user',
  );
  userIds.push(user.id);
  const session = ok(
    await request('/auth/v1/token?grant_type=password', { body: { email, password } }),
    'Sign in',
  );
  assert.equal(session.user.id, user.id);
  assert.equal(typeof session.access_token, 'string');
  return { id: user.id, token: session.access_token };
}

try {
  await owner.connect();
  await owner.query('select pg_advisory_lock(722093117)');
  initialHead = (await owner.query('select release_sequence from public.catalog_head where singleton'))
    .rows[0].release_sequence;
  fixtureStarted = true;
  const readCatalog = createCatalogRepository(apiUrl, publicKey);
  app = createApp({ readCatalog, reviewRpc: createReviewRepository(apiUrl, publicKey) });
  address = await app.listen({ host: '127.0.0.1', port: 0 });
  const reviewer = await account(),
    ordinary = await account();
  await owner.query('insert into catalog_private.reviewers(user_id) values($1)', [reviewer.id]);

  const ordinaryResult = await review('GET', '/', ordinary.token);
  assert.equal(ordinaryResult.status, 403, 'A real non-reviewer session must be rejected');
  assert.equal((await review('GET', '/')).status, 401);
  const tokenParts = reviewer.token.split('.');
  tokenParts[2] = (tokenParts[2][0] === 'A' ? 'B' : 'A') + tokenParts[2].slice(1);
  assert.equal((await review('GET', '/', tokenParts.join('.'))).status, 401);
  const queue = ok(await review('GET', '/', reviewer.token), 'Reviewer queue');
  assert.equal(queue.reviewerId, reviewer.id);
  console.log(
    'PASS: Node API → signed sessions → reviewer membership; anonymous and tampered tokens are rejected.',
  );

  const date = new Date().toISOString().slice(0, 10),
    sourceKey = `http-${randomUUID()}`;
  const source = ok(
    await review('POST', '/sources', reviewer.token, {
      sourceKey,
      title: 'Synthetic HTTP-test terms',
      url: 'https://issuer.example/http-test',
      checkedOn: date,
      body: 'Synthetic test terms: 2% cash back on all eligible purchases.',
    }),
    'Capture evidence',
  );
  sourceIds.push(source.id);
  const catalog = {
    schemaVersion: 1,
    version: `http.${randomUUID()}`,
    verifiedAt: `${date}T00:00:00Z`,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    merchantIds: ['best-buy-us'],
    sources: [{ id: sourceKey, title: source.title, url: source.url, checkedOn: source.checked_on }],
    cards: [
      {
        id: 'http-test-card',
        name: 'Synthetic HTTP test card',
        shortName: 'HTTP test',
        rules: [
          {
            id: 'http-base',
            category: 'all-eligible',
            rateBps: 200,
            requiresActivation: false,
            sourceIds: [sourceKey],
          },
        ],
      },
    ],
  };
  const draft = ok(
    await review('POST', '/drafts', reviewer.token, {
      catalog,
      sourceDocumentIds: sourceIds,
      baseSequence: queue.head,
    }),
    'Save draft',
  );
  draftIds.push(draft.id);
  const detail = ok(await review('GET', `/drafts/${draft.id}`, reviewer.token), 'Review exact draft');
  assert.equal(detail.draft.catalog_hash, draft.catalog_hash);
  assert.equal(detail.sources[0].body, source.body);
  const approval = {
    expectedRevision: draft.revision,
    expectedHash: draft.catalog_hash,
    expectedHead: queue.head,
    reviewNote: 'Reviewed synthetic HTTP integration evidence; not real issuer terms.',
  };
  assert.equal((await review('POST', `/drafts/${draft.id}/publish`, ordinary.token, approval)).status, 403);
  assert.equal(
    (
      await review('POST', `/drafts/${draft.id}/publish`, reviewer.token, {
        ...approval,
        expectedRevision: draft.revision + 1,
      })
    ).status,
    409,
  );
  const release = ok(
    await review('POST', `/drafts/${draft.id}/publish`, reviewer.token, approval),
    'Publish reviewed draft',
  );
  assert.deepEqual(
    ok(await review('POST', `/drafts/${draft.id}/publish`, reviewer.token, approval), 'Retry publication'),
    release,
  );
  assert.deepEqual(
    ok(await review('GET', `/drafts/${draft.id}`, reviewer.token), 'Review published context').published,
    release,
  );
  console.log(
    'PASS: Node review API captures evidence, saves/reviews/publishes exact drafts, rejects stale approvals, and retries idempotently.',
  );

  const response = await fetch(`${address}/v1/catalog`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(catalogResponseSchema.parse(await response.json()), { release });
  console.log('PASS: Node HTTP API reads the real public head/snapshot join using only the publishable key.');

  ok(await request('/auth/v1/logout?scope=global', { token: reviewer.token }), 'Sign out reviewer');
  assert.equal((await review('GET', `/drafts/${draft.id}`, reviewer.token)).status, 403);
  assert.equal((await review('POST', `/drafts/${draft.id}/publish`, reviewer.token, approval)).status, 403);
  assert.deepEqual(await readCatalog(), release);
  console.log(
    'PASS: sign-out immediately removes review/publication authority while published rules remain public.',
  );
} finally {
  await app?.close();
  try {
    if (fixtureStarted) {
      await owner.query('begin');
      const releases = (
        await owner.query(
          'select release_sequence::text from catalog_private.publications where draft_id=any($1)',
          [draftIds],
        )
      ).rows.map((row) => row.release_sequence);
      const head = (
        await owner.query('select release_sequence::text from public.catalog_head where singleton for update')
      ).rows[0].release_sequence;
      if (releases.includes(head))
        await owner.query('update public.catalog_head set release_sequence=$1 where singleton', [
          initialHead,
        ]);
      await owner.query('delete from catalog_private.publications where draft_id=any($1)', [draftIds]);
      await owner.query('delete from catalog_private.drafts where id=any($1)', [draftIds]);
      await owner.query('delete from public.catalog_releases where sequence=any($1::bigint[])', [releases]);
      await owner.query('delete from catalog_private.source_documents where id=any($1)', [sourceIds]);
      await owner.query('commit');
    }
  } finally {
    await owner.end();
    for (const id of userIds)
      ok(
        await request(`/auth/v1/admin/users/${id}`, { method: 'DELETE', admin: true }),
        'Delete local test user',
      );
  }
}
