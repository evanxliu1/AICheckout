begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,is_anonymous) values
  ('95000000-0000-4000-8000-000000000001',false),('95000000-0000-4000-8000-000000000002',false);
insert into auth.sessions(id,user_id) values
  ('96000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001'),
  ('96000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000002');
insert into catalog_private.reviewers(user_id) values('95000000-0000-4000-8000-000000000001');

-- Synthetic events (Phase 15.2). Fixture values are not claims about real shoppers or stores.
create function pg_temp.ev(kind text, extra jsonb default '{}', install text default 'c3a1e9b2-0d4f-4a6b-8c7d-1e2f3a4b5c6d')
returns jsonb language sql as $$
  select jsonb_build_object(
    'event_id', gen_random_uuid(), 'type', kind, 'client_at', '2026-10-19T12:00:00Z',
    'install_id', install::uuid, 'install_month', '2026-10', 'days_since_install', '1-6',
    'consent_version', 1, 'schema_version', 1, 'extension_version', '2.1.0',
    'catalog_version', '2026-10-05.renewal.1', 'merchants_version', '2026-10-11.mcc.3',
    'reader_version', 'generic-reader-v1')
  || case kind
       when 'recommendation_shown' then '{"surface":"badge","view":"amount","withheld_reason":null,"page":"cart",
         "store_kind":"named","evidence_basis":"issuer","category":"electronics","amount_cents":12999,
         "amount_kind":"total","top_card_id":"capital-one-quicksilver","cards_count":3,"ranking_may_change":false}'::jsonb
       when 'store_suggested' then '{"domain":"shop.example","page":"cart"}'::jsonb
       when 'problem_reported' then '{"domain":"shop.example","reason":"wrong-amount","view":"amount","withheld_reason":null}'::jsonb
       when 'wallet_changed' then '{"card_ids":["capital-one-quicksilver"]}'::jsonb
       when 'badge_expanded' then '{"view":"amount"}'::jsonb
       else '{}'::jsonb end
  || extra;
$$;
create function pg_temp.batch(variadic events jsonb[]) returns jsonb language sql as $$
  select jsonb_agg(e) from unnest(events) e;
$$;
create function pg_temp.events_count() returns bigint language sql as $$ select count(*) from telemetry.events; $$;

-- Validator (the bulk of the cases run through scripts/test-catalog-parity.mjs against the Zod schema).
select ok(telemetry.valid_event_v1(pg_temp.ev('consent_granted')),'a consent event is valid');
select ok(telemetry.valid_event_v1(pg_temp.ev('recommendation_shown')),'a recommendation event is valid');
select ok(telemetry.valid_event_v1(pg_temp.ev('store_suggested', '{}', null)),'a tap event without an install id is valid');
select ok(not telemetry.valid_event_v1(null),'null fails');
select ok(not telemetry.valid_event_v1(pg_temp.ev('consent_granted', '{}', null)),'an automatic event without an install id fails');
select ok(not telemetry.valid_event_v1(pg_temp.ev('consent_granted', '{"domain":"shop.example"}')),'a domain on an automatic event fails');
select ok(not telemetry.valid_event_v1(pg_temp.ev('recommendation_shown', '{"category":"groceries"}')),'an unknown category fails');
select ok(not telemetry.valid_event_v1(pg_temp.ev('recommendation_shown', '{"amount_cents":null}')),'the amount view without an amount fails');
select ok(not telemetry.valid_event_v1(pg_temp.ev('consent_granted', '{"client_at":"2026-02-30T00:00:00Z"}')),'an invalid calendar date fails');
select ok(not telemetry.valid_event_v1(pg_temp.ev('offer_click')),'a reserved type fails');

-- The schema is private: no client role reads or writes the tables or the reviewer functions.
set local role anon;
select throws_ok('select * from telemetry.events','42501',null,'anonymous cannot read events');
select throws_ok('select * from telemetry.install_days','42501',null,'anonymous cannot read counters');
select throws_ok($q$insert into telemetry.events(event_id,type,client_at,event) values(gen_random_uuid(),'x',now(),'{}')$q$,'42501',null,'anonymous cannot insert directly');
select throws_ok('select public.telemetry_summary(7)','42501',null,'anonymous cannot call the reviewer summary');
select throws_ok('select public.telemetry_store_suggestions()','42501',null,'anonymous cannot call the store suggestions');
select throws_ok('select telemetry.valid_event_v1(''{}'')','42501',null,'anonymous cannot call the private validator');
reset role;
set local role service_role;
select throws_ok('select * from telemetry.events','42501',null,'service role has no telemetry table grant');
select throws_ok('select public.ingest_events(''[]'')','42501',null,'service role cannot ingest');
reset role;
set local role authenticated;
select throws_ok('select * from telemetry.events','42501',null,'a signed-in user cannot read events');
reset role;

-- Ingest as anon: validation, dedupe, the batch caps.
set local role anon;
select is(public.ingest_events(pg_temp.batch(pg_temp.ev('consent_granted'), pg_temp.ev('recommendation_shown'))),
  '{"accepted":2,"dropped":0}'::jsonb,'two valid events are accepted');
select throws_ok('select public.ingest_events(null)','22023',null,'a null batch is refused');
select throws_ok('select public.ingest_events(''[]'')','22023',null,'an empty batch is refused');
select throws_ok('select public.ingest_events(''{}'')','22023',null,'an object is refused');
select throws_ok($q$select public.ingest_events(pg_temp.batch(pg_temp.ev('consent_granted'), pg_temp.ev('consent_granted','{"url":"https://shop.example"}')))$q$,
  '22023',null,'a batch with one invalid event is refused whole');
select throws_ok($q$select public.ingest_events((select jsonb_agg(pg_temp.ev('badge_expanded')) from generate_series(1,51)))$q$,
  '22023',null,'51 events are refused');
select lives_ok($q$select public.ingest_events((select jsonb_agg(pg_temp.ev('badge_expanded')) from generate_series(1,50)))$q$,'50 events are accepted');
select throws_ok($q$select public.ingest_events(pg_temp.batch(pg_temp.ev('consent_granted') || jsonb_build_object('pad', repeat('x', 140000))))$q$,
  '22023',null,'a batch over the byte cap is refused');
select set_config('test.dup', pg_temp.ev('wallet_changed')::text, true);
select is(public.ingest_events(pg_temp.batch(current_setting('test.dup')::jsonb, current_setting('test.dup')::jsonb)),
  '{"accepted":1,"dropped":1}'::jsonb,'a repeated event id in one batch is stored once');
select is(public.ingest_events(pg_temp.batch(current_setting('test.dup')::jsonb)),
  '{"accepted":0,"dropped":1}'::jsonb,'a repeated event id in a later batch is dropped');
select is(public.ingest_events(pg_temp.batch(pg_temp.ev('store_suggested','{}',null), pg_temp.ev('problem_reported','{}',null))),
  '{"accepted":2,"dropped":0}'::jsonb,'tap events without an install id are accepted');
reset role;
select is(pg_temp.events_count(), 55::bigint, 'every accepted event is one row');
select is((select count(*) from telemetry.events where install_id is null), 2::bigint, 'tap events without an id are stored without one');
select is((select count from telemetry.install_days where install_id='c3a1e9b2-0d4f-4a6b-8c7d-1e2f3a4b5c6d' and day=(now() at time zone 'UTC')::date),
  53, 'the day counter counts the stored events of the install, not the dropped ones');
select is((select count(*) from telemetry.install_days), 1::bigint, 'events without an install id are not counted');
select is((select event_id::text from telemetry.events where type='wallet_changed'), current_setting('test.dup')::jsonb->>'event_id', 'the row keys the client event id');

-- The per-install day cap.
update telemetry.install_days set count = 499 where install_id='c3a1e9b2-0d4f-4a6b-8c7d-1e2f3a4b5c6d';
set local role anon;
select is(public.ingest_events(pg_temp.batch(pg_temp.ev('badge_expanded'), pg_temp.ev('badge_expanded'), pg_temp.ev('badge_expanded','{}','d4b2f0c3-1e5a-4b7c-9d8e-2f3a4b5c6d7e'))),
  '{"accepted":2,"dropped":1}'::jsonb,'the 500th event of the day is accepted, the 501st dropped, another install is unaffected');
select is(public.ingest_events(pg_temp.batch(pg_temp.ev('badge_expanded'))),
  '{"accepted":0,"dropped":1}'::jsonb,'a capped install stores nothing more that day');
reset role;
select is((select count from telemetry.install_days where install_id='c3a1e9b2-0d4f-4a6b-8c7d-1e2f3a4b5c6d'), 500, 'the counter stops at the cap');

-- Pruning on ingest: rows older than 90 days go, newer ones stay.
insert into telemetry.events(event_id, install_id, type, client_at, received_at, event)
  select (e->>'event_id')::uuid, (e->>'install_id')::uuid, e->>'type', (e->>'client_at')::timestamptz, now() - interval '91 days', e
  from pg_temp.ev('consent_granted','{}','e5c3a1d4-2f6b-4c8d-ae9f-3a4b5c6d7e8f') e;
insert into telemetry.events(event_id, install_id, type, client_at, received_at, event)
  select (e->>'event_id')::uuid, (e->>'install_id')::uuid, e->>'type', (e->>'client_at')::timestamptz, now() - interval '89 days', e
  from pg_temp.ev('consent_granted','{}','e5c3a1d4-2f6b-4c8d-ae9f-3a4b5c6d7e8f') e;
insert into telemetry.install_days(install_id, day, count) values('e5c3a1d4-2f6b-4c8d-ae9f-3a4b5c6d7e8f', (now() at time zone 'UTC')::date - 91, 1);
set local role anon;
select lives_ok($q$select public.ingest_events(pg_temp.batch(pg_temp.ev('badge_expanded','{}','d4b2f0c3-1e5a-4b7c-9d8e-2f3a4b5c6d7e')))$q$,'an ingest call prunes');
reset role;
select is((select count(*) from telemetry.events where received_at < now() - interval '90 days'), 0::bigint, 'the 91-day-old row was pruned');
select is((select count(*) from telemetry.events where install_id='e5c3a1d4-2f6b-4c8d-ae9f-3a4b5c6d7e8f'), 1::bigint, 'the 89-day-old row stays');
select is((select count(*) from telemetry.install_days where day < (now() at time zone 'UTC')::date - 90), 0::bigint, 'old day counters were pruned');

-- Reviewer reads.
set local role anon;
select throws_ok('select public.telemetry_summary(7)','42501',null,'anonymous still cannot read the summary');
reset role;
select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000002","session_id":"96000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok('select public.telemetry_summary(7)','42501','Reviewer authorization required','a non-reviewer cannot read the summary');
select throws_ok('select public.telemetry_store_suggestions()','42501','Reviewer authorization required','a non-reviewer cannot read the suggestions');
reset role;
select set_config('request.jwt.claims','{"sub":"95000000-0000-4000-8000-000000000001","session_id":"96000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('test.rows', pg_temp.events_count()::text, true);
select set_config('test.suggested_at', (select to_jsonb(received_at)::text from telemetry.events where type='store_suggested'), true);
set local role authenticated;
select throws_ok('select public.telemetry_summary(0)','22023',null,'a zero-day window is refused');
select throws_ok('select public.telemetry_summary(91)','22023',null,'a 91-day window is refused');
select is(public.telemetry_summary(7)->'events', to_jsonb(current_setting('test.rows')::int - 1), 'the summary counts the rows of the last 7 days (not the 89-day-old one)');
select is(public.telemetry_summary(90)->'events', to_jsonb(current_setting('test.rows')::int), 'the 90-day summary counts every row');
select is(public.telemetry_summary(7)->'installs', '2'::jsonb, 'the summary counts distinct installs with an id');
select is((select count(*) from jsonb_array_elements(public.telemetry_summary(7)->'by_type')), 6::bigint, 'the summary lists each type seen');
select is((select e->'count' from jsonb_array_elements(public.telemetry_summary(7)->'by_type') e where e->>'type'='badge_expanded'), '53'::jsonb, 'the per-type count is right');
select is((select count(*) from jsonb_array_elements(public.telemetry_summary(7)->'by_day')), 1::bigint, 'one UTC day in the window');
select is(public.telemetry_store_suggestions(), jsonb_build_array(jsonb_build_object(
  'domain','shop.example','count',1,'installs',0,
  'last_seen',current_setting('test.suggested_at')::jsonb)),
  'the suggestions aggregate one domain with no identified installs');
select throws_ok('select * from telemetry.events','42501',null,'the reviewer still has no table grant');
reset role;

-- Delete my data.
set local role anon;
select is(public.delete_install('c3a1e9b2-0d4f-4a6b-8c7d-1e2f3a4b5c6d'), '{"deleted":54}'::jsonb, 'delete removes the install''s rows and reports the count');
select is(public.delete_install('c3a1e9b2-0d4f-4a6b-8c7d-1e2f3a4b5c6d'), '{"deleted":0}'::jsonb, 'a repeated delete removes nothing');
select throws_ok('select public.delete_install(null)','22023',null,'a null install id is refused');
reset role;
select is((select count(*) from telemetry.events where install_id='c3a1e9b2-0d4f-4a6b-8c7d-1e2f3a4b5c6d'), 0::bigint, 'no event of the deleted install remains');
select is((select count(*) from telemetry.install_days where install_id='c3a1e9b2-0d4f-4a6b-8c7d-1e2f3a4b5c6d'), 0::bigint, 'no counter of the deleted install remains');
select is((select count(*) from telemetry.events where install_id is null), 2::bigint, 'tap events without an id are untouched');

-- Revocation applies to the reviewer reads too.
delete from auth.sessions where id='96000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok('select public.telemetry_summary(7)','42501',null,'a deleted session cannot read the summary');
reset role;

select * from finish();
rollback;
