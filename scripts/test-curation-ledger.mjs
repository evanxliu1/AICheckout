import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import pg from 'pg';

// Local-only fixture. No hosted environment, provider key, service purchase, or email.
const bundle = await build({
  entryPoints: ['apps/api/src/curation/ledger.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { createCurationLedger, executeRecordedExtraction } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const config = {
  host: '127.0.0.1',
  port: 54322,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
  application_name: 'aicheckout-curation-test',
};
const [owner, blocker, first, second] = Array.from({ length: 4 }, () => new pg.Client(config)),
  clients = [owner, blocker, first, second];
const actor = { userId: randomUUID(), sessionId: randomUUID() },
  profileId = `fixture-${randomUUID()}`;
let previousPolicy,
  locked = false,
  pending = [],
  calls = 0;
const ledgers = [first, second].map((client) =>
  createCurationLedger((sql, params) => client.query(sql, params)),
);
let holdProvider, releaseProvider;
const providerFor = (profile) => ({
  id: profile.provider,
  model: profile.model,
  mode: profile.mode,
  pricing: { input: profile.input_price, output: profile.output_price },
  invoke: async () => {
    calls++;
    if (holdProvider) await holdProvider;
    return {
      finishReason: 'refusal',
      text: 'Synthetic refusal fixture, not a model evaluation.',
      usage: { inputTokens: 100, outputTokens: 20 },
    };
  },
});
function outcome(promise) {
  return promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
}
async function waitForBlocked(count) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const { rows } = await owner.query(
      "select count(*)::int as waiting from pg_stat_activity where pid=any($1::int[]) and wait_event_type='Lock'",
      [[first.processID, second.processID]],
    );
    if (rows[0].waiting === count) return;
    await delay(20);
  }
  throw new Error('Expected concurrent ledger requests to wait on the admission lock.');
}
try {
  await Promise.all(clients.map((client) => client.connect()));
  await owner.query('select pg_advisory_lock(722093117)');
  previousPolicy = (await owner.query('select * from catalog_private.curation_policy where singleton'))
    .rows[0];
  assert.equal(
    (await owner.query('select count(*)::int as count from catalog_private.curation_runs')).rows[0].count,
    0,
    'Use a clean local ledger; preserve non-test run history.',
  );
  await owner.query('insert into auth.users(id,is_anonymous) values($1,false)', [actor.userId]);
  await owner.query('insert into auth.sessions(id,user_id) values($1,$2)', [actor.sessionId, actor.userId]);
  await owner.query('insert into catalog_private.reviewers(user_id) values($1)', [actor.userId]);
  const source = (
    await owner.query(
      `insert into catalog_private.source_documents(source_key,title,url,checked_on,body,created_by)
    values('capital-one-quicksilver-benefits','Synthetic ledger integration evidence',
      'https://www.capitalone.com/learn-grow/money-management/quicksilver-card-benefits/',current_date,'Synthetic 1.5% terms; no real model call.',$1) returning to_jsonb(source_documents) as doc`,
      [actor.userId],
    )
  ).rows[0].doc;
  const input = { cardId: 'capital-one-quicksilver', documents: [source] };
  await owner.query(
    `insert into catalog_private.curation_profiles(id,enabled,provider,model,mode,input_price,output_price)
    values($1,true,'fixture','synthetic-v1','fixture',0,0)`,
    [profileId],
  );
  await owner.query(
    'update catalog_private.curation_policy set enabled=true,max_concurrent=1,daily_run_limit=20 where singleton',
  );
  await Promise.all([first, second].map((client) => client.query('set role aicheckout_curation_executor')));
  const run = (ledger, requestKey) =>
    executeRecordedExtraction({ input, actor, requestKey, profileId, ledger, providerFor });

  // Real row-lock contention: two API instances, one idempotency key, one invocation.
  await blocker.query('begin');
  locked = true;
  await blocker.query('select * from catalog_private.curation_policy where singleton for update');
  const key = randomUUID();
  pending = [outcome(run(ledgers[0], key)), outcome(run(ledgers[1], key))];
  await waitForBlocked(2);
  await blocker.query('rollback');
  locked = false;
  const pair = await Promise.all(pending);
  pending = [];
  assert(
    pair.every((result) => result.value),
    pair.find((result) => result.error)?.error?.message,
  );
  assert.equal(pair.filter((result) => result.value.executed).length, 1);
  assert.equal(calls, 1);
  const completed = pair.find((result) => result.value.executed).value.run;
  assert.equal(completed.state, 'finished');
  assert.equal(completed.trace.runId, completed.id);
  assert.equal(completed.trace.status, 'refused');
  assert.equal(completed.reserved_microusd, 0);
  assert.equal(completed.trace.attempts.length, 1);
  assert.equal((await run(ledgers[1], key)).executed, false);
  assert.equal(calls, 1);
  console.log(
    'PASS: concurrent duplicate requests execute once; full trace persists and retry reads the same run.',
  );

  // A separate request cannot use an occupied execution slot.
  holdProvider = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  pending = [outcome(run(ledgers[0], randomUUID()))];
  for (let i = 0; i < 100 && calls < 2; i++) await delay(10);
  assert.equal(calls, 2);
  await assert.rejects(
    run(ledgers[1], randomUUID()),
    (error) => error.code === 'curation_capacity_exhausted',
  );
  releaseProvider();
  holdProvider = null;
  assert((await pending[0]).value);
  pending = [];
  console.log('PASS: different requests share the same database concurrency limit.');

  // A process that lost its result write must not be replayed on retry/restart.
  const uncertainKey = randomUUID();
  const unavailableFinish = {
    ...ledgers[0],
    finish: async () => {
      throw new Error('Synthetic connection failure after invocation');
    },
  };
  await assert.rejects(
    run(unavailableFinish, uncertainKey),
    (error) => error.code === 'curation_result_unconfirmed',
  );
  const priorCalls = calls,
    unknown = await run(ledgers[1], uncertainKey);
  assert.equal(unknown.executed, false);
  assert.equal(unknown.run.state, 'running');
  assert.equal(calls, priorCalls);
  await assert.rejects(
    run(ledgers[1], randomUUID()),
    (error) => error.code === 'curation_capacity_exhausted',
  );
  // This test owns/awaited the exact stopped operation; simulate an elapsed recovery deadline.
  await owner.query(
    "update catalog_private.curation_runs set deadline_at=clock_timestamp()-interval '1 second' where id=$1",
    [unknown.run.id],
  );
  await owner.query('select catalog_private.interrupt_curation_run($1,$2)', [
    unknown.run.id,
    'Synthetic operation finished; result persistence deliberately failed.',
  ]);
  assert.equal((await run(ledgers[1], uncertainKey)).executed, false);
  console.log(
    'PASS: uncertain completion preserves the claim; confirmed recovery never replays a provider call.',
  );

  // Two metered-profile requests competing for a single full-run allowance. Provider is still a zero-cost script.
  await owner.query(
    "update catalog_private.curation_profiles set mode='metered',input_price=1000000,output_price=2000000 where id=$1",
    [profileId],
  );
  await owner.query(
    'update catalog_private.curation_policy set max_concurrent=2,daily_budget_microusd=112384,lifetime_budget_microusd=112384 where singleton',
  );
  await blocker.query('begin');
  locked = true;
  await blocker.query('select * from catalog_private.curation_policy where singleton for update');
  pending = [outcome(run(ledgers[0], randomUUID())), outcome(run(ledgers[1], randomUUID()))];
  await waitForBlocked(2);
  await blocker.query('rollback');
  locked = false;
  const budgetRace = await Promise.all(pending);
  pending = [];
  assert.equal(budgetRace.filter((result) => result.value).length, 1);
  assert.equal(budgetRace.find((result) => result.error).error.code, 'curation_budget_exhausted');
  assert.equal(
    (await owner.query('select sum(reserved_microusd)::int as amount from catalog_private.curation_runs'))
      .rows[0].amount,
    112384,
  );
  console.log(
    'PASS: simultaneous instances cannot overspend the durable full-run reservation. No paid provider was called.',
  );
} finally {
  releaseProvider?.();
  if (locked) await blocker.query('rollback');
  await Promise.all(pending);
  if (previousPolicy) {
    await owner.query('begin');
    try {
      await owner.query('delete from catalog_private.curation_runs where requested_by=$1', [actor.userId]);
      await owner.query('delete from catalog_private.curation_profiles where id=$1', [profileId]);
      await owner.query('delete from catalog_private.source_documents where created_by=$1', [actor.userId]);
      await owner.query('delete from auth.users where id=$1', [actor.userId]);
      await owner.query(
        `update catalog_private.curation_policy set enabled=$1,lifetime_budget_microusd=$2,daily_budget_microusd=$3,daily_run_limit=$4,max_concurrent=$5 where singleton`,
        [
          previousPolicy.enabled,
          previousPolicy.lifetime_budget_microusd,
          previousPolicy.daily_budget_microusd,
          previousPolicy.daily_run_limit,
          previousPolicy.max_concurrent,
        ],
      );
      await owner.query('commit');
    } catch (error) {
      await owner.query('rollback');
      throw error;
    }
  }
  await Promise.all(clients.map((client) => client.end()));
}
