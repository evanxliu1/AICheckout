begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Test instrumentation only; rolled back. Production executor has no extension-schema usage.
grant usage on schema extensions to aicheckout_curation_executor;
insert into auth.users(id,is_anonymous) values('61000000-0000-4000-8000-000000000001',false),('61000000-0000-4000-8000-000000000002',false);
insert into auth.sessions(id,user_id) values('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001');
insert into catalog_private.reviewers(user_id) values('61000000-0000-4000-8000-000000000001');
insert into catalog_private.source_documents(id,source_key,title,url,checked_on,body) values
  ('63000000-0000-4000-8000-000000000001','test-ledger','Synthetic ledger terms','https://issuer.example/test',current_date,'Synthetic evidence only.');
insert into catalog_private.curation_profiles(id,enabled,provider,model,mode,input_price,output_price) values
  ('test-free',true,'fixture','synthetic-v1','fixture',0,0),('test-metered',true,'fixture','synthetic-v1','metered',1000000,2000000);
-- Snapshot the context while the fixture owner can read the source table.
select set_config('test.context',jsonb_build_object('system','Synthetic test','user',jsonb_build_object(
  'target',jsonb_build_object('cardId','capital-one-quicksilver'),'documents',jsonb_build_array(jsonb_build_object(
    'documentId',s.id,'sourceKey',s.source_key,'url',s.url,'checkedOn',s.checked_on,'contentHash',s.content_hash,'body',s.body)))::text,
  'jsonSchema','{}'::jsonb,'versions','{}'::jsonb,'hash',repeat('a',64),'inputTokenEstimate',100)::text,true)
  from catalog_private.source_documents s where id='63000000-0000-4000-8000-000000000001';
create function pg_temp.context() returns jsonb language sql as $$ select current_setting('test.context')::jsonb; $$;
create function pg_temp.claim(p_key uuid default '64000000-0000-4000-8000-000000000001',p_profile text default 'test-free')
returns jsonb language sql as $$ select catalog_private.claim_curation_run('61000000-0000-4000-8000-000000000001',
  '62000000-0000-4000-8000-000000000001',p_key,p_profile,'capital-one-quicksilver',array['63000000-0000-4000-8000-000000000001'::uuid],pg_temp.context()); $$;
create function pg_temp.run_id() returns uuid language sql as $$ select (current_setting('test.claim')::jsonb->'run'->>'id')::uuid; $$;
create function pg_temp.token() returns text language sql as $$ select current_setting('test.claim')::jsonb->>'executionToken'; $$;
create function pg_temp.trace() returns jsonb language sql as $$ select jsonb_build_object('runId',pg_temp.run_id(),
  'context',jsonb_build_object('hash',repeat('a',64)),'status','cancelled'); $$;

set local role anon;
select throws_ok('select public.get_curation_run(gen_random_uuid())','42501',null,'anonymous clients cannot read private runs');
set local role authenticated;
select throws_ok('select pg_temp.claim()','42501',null,'signed clients cannot manufacture execution claims');
select throws_ok('select * from catalog_private.curation_runs','42501',null,'signed clients cannot read raw run tables');
select throws_ok('update catalog_private.curation_policy set enabled=true','42501',null,'signed clients cannot enable spending');
set local role service_role;
select throws_ok('select pg_temp.claim()','42501',null,'generic service key has no curation authority');
set local role aicheckout_curation_executor;
select throws_ok('select pg_temp.claim()','55000','Curation is disabled','curation disabled by default');
select throws_ok('update catalog_private.curation_policy set enabled=true','42501',null,'executor cannot alter its budget');
select throws_ok('insert into catalog_private.reviewers(user_id) values(gen_random_uuid())','42501',null,'executor cannot grant human reviewer authority');
select throws_ok($q$select public.publish_catalog(gen_random_uuid(),1,repeat('a',64),null,'Unapproved model publication')$q$,
  '42501',null,'executor cannot publish even with plausible publication arguments');
reset role;
update catalog_private.curation_policy set enabled=true;
set local role aicheckout_curation_executor;
select throws_ok($q$select pg_temp.claim('64000000-0000-4000-8000-000000000002','test-metered')$q$,'54000','Curation budget exhausted','zero budget blocks metered execution');
select throws_ok($q$select catalog_private.claim_curation_run('61000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'test-free','capital-one-quicksilver',array['63000000-0000-4000-8000-000000000001'::uuid],pg_temp.context())$q$,
  '42501',null,'executor cannot attribute a request to an unauthorized human');
select throws_ok($q$select catalog_private.claim_curation_run('61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'test-free','capital-one-quicksilver',array['63000000-0000-4000-8000-000000000099'::uuid],pg_temp.context())$q$,
  '22023','Unknown source document','unknown sources do not create a run');
select set_config('test.claim',pg_temp.claim()::text,true);
select throws_ok($q$select catalog_private.claim_curation_run('61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'test-free','capital-one-quicksilver',array['63000000-0000-4000-8000-000000000001'::uuid],
  jsonb_set(pg_temp.context(),'{user}',to_jsonb(replace(pg_temp.context()->>'user','Synthetic evidence only.','Forged evidence.'))))$q$,
  '22023','Context does not match immutable sources','context cannot substitute text under a real source ID');
select is((current_setting('test.claim')::jsonb->>'claimed')::boolean,true,'first request receives one execution claim');
select is((current_setting('test.claim')::jsonb->'run'->>'reserved_microusd')::bigint,0::bigint,'fixture reservation costs zero');
select is((pg_temp.claim()->>'claimed')::boolean,false,'idempotent retry never receives execution authority');
select ok(not(pg_temp.claim() ? 'executionToken'),'retry cannot recover an execution token');
select ok(not(pg_temp.claim()->'run' ? 'execution_token_hash'),'internal claim hash is not exposed');
select throws_ok($q$select pg_temp.claim('64000000-0000-4000-8000-000000000001','test-metered')$q$,'40001',null,'changed input cannot reuse an idempotency key');
select throws_ok($q$select pg_temp.claim('64000000-0000-4000-8000-000000000003')$q$,'53300','Curation capacity exhausted','concurrency slot is enforced');
select lives_ok('select catalog_private.check_curation_execution(pg_temp.run_id(),pg_temp.token())','live claim can begin an attempt');
select throws_ok($q$select catalog_private.finish_curation_run(pg_temp.run_id(),'forged',pg_temp.trace())$q$,'42501',null,'wrong execution token cannot finalize');
select throws_ok($q$select catalog_private.finish_curation_run(pg_temp.run_id(),pg_temp.token(),jsonb_set(pg_temp.trace(),'{runId}',to_jsonb(gen_random_uuid())))$q$,
  '22023',null,'trace must identify its exact run');
select lives_ok('select catalog_private.finish_curation_run(pg_temp.run_id(),pg_temp.token(),pg_temp.trace())','executor records completion');
select lives_ok('select catalog_private.finish_curation_run(pg_temp.run_id(),pg_temp.token(),pg_temp.trace())','lost completion response is safely retryable');
select throws_ok($q$select catalog_private.finish_curation_run(pg_temp.run_id(),pg_temp.token(),pg_temp.trace()||'{"status":"evidence_valid"}'::jsonb)$q$,
  '40001',null,'finished trace cannot be overwritten');
select throws_ok('select catalog_private.check_curation_execution(pg_temp.run_id(),pg_temp.token())','55000',null,'finished run cannot start another call');
reset role;
select set_config('request.jwt.claims','{"sub":"61000000-0000-4000-8000-000000000001","session_id":"62000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.get_curation_run(pg_temp.run_id())->>'state','finished','authorized reviewer can inspect persisted result');
select ok(not(public.get_curation_run(pg_temp.run_id()) ? 'execution_token_hash'),'reviewer cannot read execution capability');
select throws_ok('select catalog_private.finish_curation_run(pg_temp.run_id(),pg_temp.token(),pg_temp.trace())','42501',null,'reviewer cannot forge server trace despite knowing the test token');
reset role;
update catalog_private.curation_policy set daily_budget_microusd=112384,lifetime_budget_microusd=112384;
set local role aicheckout_curation_executor;
select set_config('test.claim',pg_temp.claim('64000000-0000-4000-8000-000000000002','test-metered')::text,true);
select is((current_setting('test.claim')::jsonb->'run'->>'reserved_microusd')::bigint,112384::bigint,'both possible attempts are reserved before execution');
select lives_ok('select catalog_private.finish_curation_run(pg_temp.run_id(),pg_temp.token(),pg_temp.trace())','failed or cancelled result can be persisted');
select throws_ok($q$select pg_temp.claim('64000000-0000-4000-8000-000000000004','test-metered')$q$,'54000',null,'cancellation does not refund uncertain costs');
reset role;
select is((select sum(reserved_microusd) from catalog_private.curation_runs),112384::numeric,'durable reservation survives result write');
update catalog_private.curation_policy set daily_run_limit=2;
set local role aicheckout_curation_executor;
select throws_ok($q$select pg_temp.claim('64000000-0000-4000-8000-000000000005')$q$,'53300',null,'daily request count limits free runs too');
reset role;
update catalog_private.curation_policy set daily_run_limit=20;
set local role aicheckout_curation_executor;
select set_config('test.claim',pg_temp.claim('64000000-0000-4000-8000-000000000005')::text,true);
reset role;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='62000000-0000-4000-8000-000000000001';
set local role aicheckout_curation_executor;
select throws_ok('select catalog_private.check_curation_execution(pg_temp.run_id(),pg_temp.token())','42501',null,'revoked session prevents another provider attempt');
select lives_ok('select catalog_private.finish_curation_run(pg_temp.run_id(),pg_temp.token(),pg_temp.trace())','revocation does not prevent recording an already-started outcome');
reset role;
update auth.sessions set not_after=null where id='62000000-0000-4000-8000-000000000001';
set local role aicheckout_curation_executor;
select set_config('test.claim',pg_temp.claim('64000000-0000-4000-8000-000000000006')::text,true);
reset role;
select throws_ok($q$select catalog_private.interrupt_curation_run(pg_temp.run_id(),'Confirmed stopped test process')$q$,'55000',null,'operator cannot interrupt a claim before its deadline');
update catalog_private.curation_runs set deadline_at=clock_timestamp()-interval '1 second' where id=pg_temp.run_id();
set local role aicheckout_curation_executor;
select throws_ok('select catalog_private.check_curation_execution(pg_temp.run_id(),pg_temp.token())','55000',null,'expired execution claim cannot start another attempt');
select throws_ok($q$select pg_temp.claim('64000000-0000-4000-8000-000000000007')$q$,'53300',null,'expiry alone does not assume the old process stopped');
select throws_ok($q$select catalog_private.interrupt_curation_run(pg_temp.run_id(),'Confirmed stopped test process')$q$,'42501',null,'executor cannot release its own uncertain concurrency slot');
reset role;
select lives_ok($q$select catalog_private.interrupt_curation_run(pg_temp.run_id(),'Confirmed stopped test process')$q$,'operator records confirmed recovery');
set local role aicheckout_curation_executor;
select is((pg_temp.claim('64000000-0000-4000-8000-000000000006')->>'claimed')::boolean,false,'recovered run is never re-executed by retry');
select throws_ok('select catalog_private.finish_curation_run(pg_temp.run_id(),pg_temp.token(),pg_temp.trace())','40001',null,'late completion cannot replace interrupted history');
reset role;
select * from finish();
rollback;
