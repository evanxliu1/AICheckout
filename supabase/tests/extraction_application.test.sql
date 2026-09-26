begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
grant usage on schema extensions to aicheckout_curation_executor;
insert into auth.users(id,is_anonymous) values('71000000-0000-4000-8000-000000000001',false),('71000000-0000-4000-8000-000000000002',false);
insert into auth.sessions(id,user_id) values('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001');
insert into catalog_private.reviewers(user_id) values('71000000-0000-4000-8000-000000000001');
insert into catalog_private.source_documents(id,source_key,title,url,checked_on,body) values
('73000000-0000-4000-8000-000000000001','test-apply','Synthetic SQL terms','https://issuer.example/test',current_date,'Synthetic 2.5% eligible terms.');
insert into catalog_private.drafts(id,catalog,source_document_ids) values('74000000-0000-4000-8000-000000000001',jsonb_build_object(
  'schemaVersion',1,'version','synthetic-sql-apply.1','verifiedAt',to_char(current_date,'YYYY-MM-DD')||'T00:00:00Z',
  'expiresAt',to_char(current_date+1,'YYYY-MM-DD')||'T00:00:00Z','merchantIds',jsonb_build_array('best-buy-us'),
  'sources',jsonb_build_array(jsonb_build_object('id','test-apply','title','Synthetic SQL terms','url','https://issuer.example/test','checkedOn',current_date)),
  'cards','[{"id":"capital-one-quicksilver","name":"Synthetic test","shortName":"Synthetic","rules":[{"id":"quicksilver-base","category":"all-eligible","rateBps":150,"requiresActivation":false,"sourceIds":["test-apply"]}]}]'::jsonb
),array['73000000-0000-4000-8000-000000000001'::uuid]);
select set_config('test.apply.hash',catalog_hash,true) from catalog_private.drafts where id='74000000-0000-4000-8000-000000000001';
select set_config('test.apply.context',jsonb_build_object('system','Synthetic SQL boundary test','user',jsonb_build_object('target',jsonb_build_object('cardId','capital-one-quicksilver'),
  'documents',jsonb_build_array(jsonb_build_object('documentId',id,'sourceKey',source_key,'url',url,'checkedOn',checked_on,'contentHash',content_hash,'body',body)))::text,
  'jsonSchema','{}'::jsonb,'versions','{}'::jsonb,'hash',repeat('a',64),'inputTokenEstimate',100,
  'origin',jsonb_build_object('draftId','74000000-0000-4000-8000-000000000001','revision',1,'catalogHash',current_setting('test.apply.hash')))::text,true)
  from catalog_private.source_documents where id='73000000-0000-4000-8000-000000000001';
insert into catalog_private.curation_profiles(id,enabled,provider,model,mode,input_price,output_price) values('test-apply',true,'fixture','synthetic-v1','fixture',0,0);
update catalog_private.curation_policy set enabled=true;
select set_config('test.apply.claim',catalog_private.claim_curation_run('71000000-0000-4000-8000-000000000001','72000000-0000-4000-8000-000000000001',gen_random_uuid(),
  'test-apply','capital-one-quicksilver',array['73000000-0000-4000-8000-000000000001'::uuid],current_setting('test.apply.context')::jsonb)::text,true);
create function pg_temp.run_id() returns uuid language sql as $$ select (current_setting('test.apply.claim')::jsonb->'run'->>'id')::uuid; $$;
-- SQL boundary fixture, not a valid model trace/evidence evaluation. Full traces are tested through the compiled HTTP/browser path.
select catalog_private.finish_curation_run(pg_temp.run_id(),current_setting('test.apply.claim')::jsonb->>'executionToken',jsonb_build_object('runId',pg_temp.run_id(),
  'context',jsonb_build_object('hash',repeat('a',64)),'status','evidence_valid','findings','[]'::jsonb,'extraction',
  '{"schemaVersion":1,"cardId":"capital-one-quicksilver","rules":[{"ruleId":"quicksilver-base","rateBps":{"state":"known","value":250},"category":{"state":"known","value":"all-eligible"},"activation":{"state":"known","value":false},"cap":{"state":"known","kind":"none","amountCents":null,"period":null}}],"conditions":[{"kind":"eligibility","text":"Eligible purchases only."}],"issues":[]}'::jsonb));
select set_config('test.apply.trace',trace::text,true) from catalog_private.curation_runs where id=pg_temp.run_id();
select set_config('test.apply.head',coalesce((select release_sequence::text from public.catalog_head where singleton),'none'),true);
create function pg_temp.reviews() returns jsonb language sql as $$ select '[{"index":0,"coverage":"existing-rules","ruleIds":["quicksilver-base"],"note":"The all-eligible rule covers this eligibility condition."}]'::jsonb; $$;
create function pg_temp.apply(p_reviews jsonb default pg_temp.reviews(),p_revision integer default 1,p_hash text default current_setting('test.apply.hash'))
returns jsonb language sql as $$ select public.apply_reviewed_extraction('74000000-0000-4000-8000-000000000001',pg_temp.run_id(),p_revision,p_hash,p_reviews,'Reviewed the synthetic facts and all conditions.'); $$;
set local role anon;
select throws_ok('select public.list_draft_extractions(gen_random_uuid())','42501',null,'anonymous users cannot list private runs');
select throws_ok('select pg_temp.apply()','42501',null,'anonymous users cannot apply extraction');
set local role authenticated;
select throws_ok('select public.list_draft_extractions(gen_random_uuid())','42501',null,'ordinary authenticated users cannot list runs');
select throws_ok('select pg_temp.apply()','42501',null,'ordinary authenticated users cannot apply');
select throws_ok('select * from catalog_private.extraction_applications','42501',null,'reviewers have no raw audit table access');
set local role service_role;
select throws_ok('select pg_temp.apply()','42501',null,'service key cannot apply as a human');
select throws_ok('delete from catalog_private.extraction_applications','42501',null,'service key cannot erase audit records');
set local role aicheckout_curation_executor;
select throws_ok('select pg_temp.apply()','42501',null,'model executor cannot apply extraction');
select throws_ok($q$update catalog_private.extraction_applications set review_note='forged model review'$q$,'42501',null,'executor cannot forge a review record');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub','71000000-0000-4000-8000-000000000001','session_id','72000000-0000-4000-8000-000000000001',
  'role','authenticated','exp',extract(epoch from clock_timestamp())+3600)::text,true);
set local role authenticated;
select is(jsonb_array_length(public.list_draft_extractions('74000000-0000-4000-8000-000000000001')->'runs'),1,'reviewer can recover the saved run');
select throws_ok('select public.get_draft_extraction(gen_random_uuid(),pg_temp.run_id())','P0002',null,'run must belong to the selected draft');
select throws_ok($q$select pg_temp.apply('[]')$q$,'22023',null,'omitted condition review is rejected');
select throws_ok($q$select pg_temp.apply(jsonb_set(pg_temp.reviews(),'{0,coverage}','"ignore"'))$q$,'22023',null,'conditions cannot be discarded');
select throws_ok($q$select pg_temp.apply(jsonb_set(pg_temp.reviews(),'{0,ruleIds}','["invented"]'))$q$,'22023',null,'condition cannot refer to an invented rule');
select throws_ok($q$select pg_temp.apply(jsonb_set(pg_temp.reviews(),'{0,note}','"short"'))$q$,'22023',null,'condition needs an explicit explanation');
select throws_ok($q$select pg_temp.apply(pg_temp.reviews(),99)$q$,'40001',null,'stale draft revision is rejected');
select throws_ok($q$select pg_temp.apply(pg_temp.reviews(),1,repeat('f',64))$q$,'40001',null,'different catalog hash is rejected');
reset role;
-- Owner-only fixture mutation verifies stored refusal/unsupported facts fail closed even via direct RPC.
update catalog_private.curation_runs set trace=jsonb_set(trace,'{status}','"needs_review"') where id=pg_temp.run_id();
set local role authenticated;
select throws_ok('select pg_temp.apply()','22023',null,'unresolved extraction cannot be applied');
reset role;
update catalog_private.curation_runs set trace=jsonb_set(current_setting('test.apply.trace')::jsonb,'{extraction,issues}','[{"code":"unsupported-condition"}]') where id=pg_temp.run_id();
set local role authenticated;
select throws_ok('select pg_temp.apply()','22023',null,'unsupported conditions cannot be acknowledged away');
reset role;
update catalog_private.curation_runs set trace=current_setting('test.apply.trace')::jsonb where id=pg_temp.run_id();
set local role authenticated;
select is((pg_temp.apply()->'draft'->>'revision')::integer,2,'explicit human review creates exactly one new revision');
select is((pg_temp.apply()->'draft'#>>'{catalog,cards,0,rules,0,rateBps}')::integer,250,'known extracted rate is applied');
select is((pg_temp.apply()->'draft'->>'revision')::integer,2,'exact retry returns the same application without a second edit');
select is(public.get_draft_extraction('74000000-0000-4000-8000-000000000001',pg_temp.run_id())->'application'->'condition_reviews',pg_temp.reviews(),'condition decisions remain attached to their immutable run');
reset role;
select is((select count(*)::integer from catalog_private.extraction_applications where run_id=pg_temp.run_id()),1,'one durable human review exists');
select is((select applied_by from catalog_private.extraction_applications where run_id=pg_temp.run_id()),'71000000-0000-4000-8000-000000000001'::uuid,'actor comes from live authenticated identity');
select is(coalesce((select release_sequence::text from public.catalog_head where singleton),'none'),current_setting('test.apply.head'),'applying never changes the published head');
update catalog_private.drafts set revision=3 where id='74000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok('select pg_temp.apply()','40001',null,'retry cannot overwrite later manual changes');
reset role;
delete from auth.sessions where id='72000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($q$select public.list_draft_extractions('74000000-0000-4000-8000-000000000001')$q$,'42501',null,'revoked session cannot recover private runs');
select throws_ok('select pg_temp.apply()','42501',null,'revoked session cannot apply or replay human review');
reset role;
select * from finish();
rollback;
