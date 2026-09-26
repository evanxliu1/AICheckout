import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson } from '../apps/api/src/curation/canonical.ts';
import { build } from 'esbuild';
import { PILOT_CATALOG } from '@ai-checkout/rewards-core';
import { localCatalogFixture } from './lib/local-catalog-fixture.mjs';
import { verifyCurationConnection } from './lib/verify-curation-connection.mjs';

const evaluationModule = await build({ entryPoints: ['apps/api/src/curation/evaluation.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { observationFromRun } = await import(`data:text/javascript;base64,${Buffer.from(evaluationModule.outputFiles[0].text).toString('base64')}`);

// Compiled API + real signed sessions + a dedicated non-owner PostgreSQL LOGIN.
// Both providers are explicitly synthetic refusals. The real SDK uses a blocked,
// intercepted transport. Test prices exercise reservations, not actual spending.
async function verifyHttp(curation) {
  const fixture = await localCatalogFixture({ curation });
  const { reviewer, ordinary, request, ok } = fixture;
  const sdk = curation === 'openai-intercepted';
  try {
    const date = new Date().toISOString().slice(0, 10), catalog = structuredClone(PILOT_CATALOG);
    const sourceKey = 'capital-one-quicksilver-benefits';
    const source = ok(await request('/v1/review/sources', { token: reviewer.token, method: 'POST', body: {
      sourceKey, title: 'Synthetic extraction HTTP verification; not issuer evidence',
      url: 'https://www.capitalone.com/learn-grow/money-management/quicksilver-card-benefits/', checkedOn: date,
      body: 'Synthetic local integration text only. No model is called; the fixture provider refuses extraction.',
    } }));
    catalog.version = `synthetic-extraction.${randomUUID().slice(0, 8)}`;
    catalog.verifiedAt = `${date}T00:00:00Z`; catalog.expiresAt = new Date(Date.now() + 86400000).toISOString();
    catalog.cards = catalog.cards.filter(card => card.id === 'capital-one-quicksilver');
    catalog.sources = [{ id: sourceKey, title: source.title, url: source.url, checkedOn: date }];
    const draftInput = { catalog, sourceDocumentIds: [source.id], baseSequence: fixture.published.sequence };
    const draft = ok(await request('/v1/review/drafts', { token: reviewer.token, method: 'POST', body: draftInput }));
    const path = `/v1/review/drafts/${draft.id}/extractions`;
    const input = { cardId: 'capital-one-quicksilver', expectedRevision: draft.revision, requestKey: randomUUID() };
    const post = (body = input, token = reviewer.token) => request(path, { method: 'POST', token, body });

    assert.equal((await request(path, { method: 'POST', body: input })).status, 401);
    assert.equal((await post(input, ordinary.token)).status, 403);
    const parts = reviewer.token.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); claims.sub = ordinary.id;
    parts[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
    assert.equal((await post(input, parts.join('.'))).status, 401);
    for (const field of ['actor', 'sources', 'profileId', 'autoPublish']) {
      assert.equal((await post({ ...input, [field]: 'forged' })).status, 400);
    }
    assert.equal((await post({ ...input, expectedRevision: draft.revision + 1 })).status, 409);
    console.log('PASS: anonymous, ordinary, forged-token, client-authority, and stale-draft requests cannot execute.');

    const before = ok(await request('/v1/catalog'));
    const started = ok(await post()), run = started.run;
    assert.equal(started.executed, true); assert.equal(run.state, 'finished');
    assert.equal(run.requested_by, reviewer.id); assert.equal(run.session_id, claims.session_id);
    assert.equal(run.trace.runId, run.id); assert.equal(run.trace.status, 'refused');
    assert.equal(run.trace.provider.id, sdk ? 'openai' : 'fixture'); assert.equal(run.trace.attempts.length, 1);
    assert.deepEqual(run.trace.attempts[0].usage, { inputTokens: sdk ? 100 : 0, outputTokens: sdk ? 20 : 0 });
    assert.equal(run.reserved_microusd, sdk ? 112384 : 0); assert.equal(run.trace.accountedMicrousd, sdk ? 140 : 0);
    if (sdk) assert.deepEqual(run.trace.attempts[0].providerResponse, { id: 'resp_synthetic_http', model: 'gpt-synthetic-2026-09-25' });
    assert.deepEqual(run.context.origin, { draftId: draft.id, revision: draft.revision, catalogHash: draft.catalog_hash });
    assert.equal(run.context.versions.context, 'captured-text-json.3');
    assert.equal(run.context.hash, createHash('sha256').update(canonicalJson({ system: run.context.system, user: run.context.user,
      jsonSchema: run.context.jsonSchema, sourcePolicy: run.context.versions.sourcePolicy })).digest('hex'), 'The saved JSONB context must reproduce its original semantic hash');
    const documents = JSON.parse(run.context.user).documents;
    assert.equal(documents.length, 1); assert.equal(documents[0].documentId, source.id);
    assert.equal(documents[0].body, source.body); assert.equal(documents[0].contentHash, source.content_hash);
    const observation = observationFromRun('synthetic-http-roundtrip', run);
    assert.equal(observation.input.documents[0].id, source.id); assert.equal(observation.input.documents[0].body, source.body);
    assert.deepEqual(observation.trace, run.trace);
    assert.equal(Object.hasOwn(run, 'execution_token_hash'), false);
    assert.deepEqual(ok(await request(`/v1/review/runs/${run.id}`, { token: reviewer.token })), { run });
    assert.equal((await request(`/v1/review/runs/${run.id}`, { token: ordinary.token })).status, 403);
    assert.equal((await request(`/v1/review/runs/${run.id}`)).status, 401);
    assert.equal((await request(`/v1/review/runs/${randomUUID()}`, { token: reviewer.token })).status, 404);
    console.log('PASS: the scoped database login records a privately inspectable refusal; saved JSONB context hashes and evaluation replay identity survive the round trip.');

    const duplicate = ok(await post());
    assert.equal(duplicate.executed, false); assert.deepEqual(duplicate.run, run);
    const updated = ok(await request(`/v1/review/drafts/${draft.id}`, { method: 'PUT', token: reviewer.token,
      body: { ...draftInput, expectedRevision: draft.revision } }));
    assert.equal(updated.revision, draft.revision + 1);
    assert.equal((await post()).status, 409);
    const conflict = await post({ ...input, expectedRevision: updated.revision });
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error, 'curation_changed');
    assert.deepEqual(ok(await request('/v1/catalog')), before);
    console.log('PASS: retry reads the same run; reusing its key for a changed draft conflicts; extraction never publishes.');

    const logout = await fixture.signOut(reviewer.token); assert.ok(logout.ok);
    assert.equal((await post({ ...input, expectedRevision: updated.revision, requestKey: randomUUID() })).status, 403);
    assert.equal((await request(`/v1/review/runs/${run.id}`, { token: reviewer.token })).status, 403);
    console.log('PASS: sign-out revokes both execution and inspection while the old signed token is otherwise unexpired.');
  } finally { await fixture.close(); }
}

await verifyCurationConnection();
await verifyHttp(true);
console.log('Checking the same signed HTTP path with the real SDK and a blocked/intercepted provider transport:');
await verifyHttp('openai-intercepted');
