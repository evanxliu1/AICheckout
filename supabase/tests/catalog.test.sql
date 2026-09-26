begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Real Supabase auth tables and actual database roles. Claims below are test fixtures,
-- not signed HTTP tokens; token verification is a separate API integration gate.
insert into auth.users(id,is_anonymous) values
  ('10000000-0000-4000-8000-000000000001',false),
  ('10000000-0000-4000-8000-000000000002',false);
insert into auth.sessions(id,user_id) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
insert into catalog_private.reviewers(user_id) values('10000000-0000-4000-8000-000000000001');

create function pg_temp.catalog(ver text default 'test.1') returns jsonb language sql as $$
  select jsonb_build_object(
    'schemaVersion',1,'version',ver,
    'verifiedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD')||'T00:00:00Z',
    'expiresAt',to_char((now() at time zone 'UTC') + interval '30 days','YYYY-MM-DD')||'T00:00:00Z',
    'merchantIds',jsonb_build_array('best-buy-us'),
    'sources',jsonb_build_array(jsonb_build_object('id','test-terms','title','Synthetic test terms',
      'url','https://issuer.example/terms','checkedOn',to_char(now() at time zone 'UTC','YYYY-MM-DD'))),
    'cards','[{"id":"test-card","name":"Synthetic card","shortName":"Test","rules":[
      {"id":"test-base","category":"all-eligible","rateBps":150,"requiresActivation":false,"sourceIds":["test-terms"]}
    ]}]'::jsonb
  );
$$;
create function pg_temp.current_draft() returns jsonb language sql as $$
  select current_setting('test.draft')::jsonb;
$$;
create function pg_temp.publish() returns jsonb language sql as $$
  select public.publish_catalog((pg_temp.current_draft()->>'id')::uuid,
    (pg_temp.current_draft()->>'revision')::integer,pg_temp.current_draft()->>'catalog_hash',
    (pg_temp.current_draft()->>'base_sequence')::bigint,'Reviewed synthetic fixture terms.');
$$;

select ok(catalog_private.valid_catalog_v1(pg_temp.catalog()),'valid engine-supported catalog passes');
select ok(not catalog_private.valid_catalog_v1(pg_temp.catalog()||'{"unexpected":true}'),'unknown keys fail');
select ok(not catalog_private.valid_catalog_v1(jsonb_set(pg_temp.catalog(),'{cards,0,rules,0,rateBps}','1.5')),'fractional basis points fail');
select ok(not catalog_private.valid_catalog_v1(jsonb_set(pg_temp.catalog(),'{cards,0,rules,0,rateBps}','10001')),'excessive rates fail');
select ok(not catalog_private.valid_catalog_v1(jsonb_set(pg_temp.catalog(),'{cards,0,rules,0,sourceIds}','["absent"]')),'missing rule source fails');
select ok(not catalog_private.valid_catalog_v1(jsonb_set(pg_temp.catalog(),'{cards,0,rules,0,requiresActivation}','true')),'unsupported base activation fails');
select ok(not catalog_private.valid_catalog_v1(jsonb_set(pg_temp.catalog(),'{cards,0,rules,0,annualCapCents}','50000')),'unsupported base cap fails');
select ok(not catalog_private.valid_catalog_v1(jsonb_set(pg_temp.catalog(),'{cards,0,rules,0,category}','"unknown"')),'unsupported category fails');
select ok(not catalog_private.valid_catalog_v1(jsonb_set(pg_temp.catalog(),'{sources,0,url}','"javascript:alert(1)"')),'non-HTTPS source fails');
select ok(not catalog_private.valid_catalog_v1(pg_temp.catalog()||jsonb_build_object('cards',
  (pg_temp.catalog()->'cards')||(pg_temp.catalog()->'cards'))),'duplicate card and rule identifiers fail');
select ok(not catalog_private.valid_catalog_v1(jsonb_set(pg_temp.catalog(),'{expiresAt}','"2099-01-01T00:00:00Z"')),'overlong catalog freshness fails');
select ok(not catalog_private.valid_catalog_v1(jsonb_set(pg_temp.catalog(),'{sources,0,checkedOn}','"2026-02-30"')),'invalid calendar date fails');
select ok(not catalog_private.valid_catalog_v1(null),'null catalog fails');

insert into public.credit_cards(name,rewards,is_active) values ('Visible fixture','{}',true),('Hidden fixture','{}',false);
set local role anon;
select is((select count(*) from public.credit_cards where name like '%fixture'),1::bigint,'legacy RLS exposes only active rows');
select throws_ok('truncate public.credit_cards','42501',null,'anonymous cannot truncate the legacy table');
select throws_ok('insert into public.credit_cards(name,rewards) values (''Unauthorized'',''{}'')','42501',null,'anonymous cannot insert legacy records');
select lives_ok('select * from public.catalog_head','public can read release head');
select is((select count(*) from public.catalog_releases),0::bigint,'unapproved seed is not public');
select throws_ok('select * from catalog_private.drafts','42501',null,'anonymous cannot read drafts');
select throws_ok('select public.get_catalog_review()','42501',null,'anonymous cannot call review RPC');
select throws_ok('select public.publish_catalog(null,null,null,null,''Unauthorized action'')','42501',null,'anonymous cannot publish');
select throws_ok('update public.catalog_head set release_sequence=null','42501',null,'public head cannot be overwritten');
reset role;

-- Spoofing user_metadata and app_metadata cannot turn a normal user into a reviewer.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","session_id":"20000000-0000-4000-8000-000000000002","role":"authenticated","user_metadata":{"admin":true},"app_metadata":{"admin":true}}',true);
set local role authenticated;
select throws_ok('select public.get_catalog_review()','42501','Reviewer authorization required','signed-in non-reviewer is rejected');
select throws_ok('select public.capture_catalog_source(''test'',''test'',''https://issuer.example'',current_date,''test'')','42501',null,'non-reviewer cannot capture sources');
select throws_ok('select public.save_catalog_draft(null,null,pg_temp.catalog(),''{}'',null)','42501',null,'non-reviewer cannot create drafts');
select throws_ok('select public.publish_catalog(null,null,null,null,''Unauthorized action'')','42501',null,'forged claims cannot publish');
select throws_ok('insert into catalog_private.reviewers(user_id) values(auth.uid())','42501',null,'users cannot grant themselves reviewer access');
reset role;

select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","session_id":"20000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok('select public.get_catalog_review()','reviewer can open review queue');
select throws_ok('select * from catalog_private.source_documents','42501',null,'reviewer still has no direct private-table access');
select throws_ok('insert into public.catalog_releases(catalog) values(pg_temp.catalog())','42501',null,'reviewer cannot bypass publication transaction');
select throws_ok('select catalog_private.require_reviewer()','42501',null,'internal authorization helper is not granted');
select set_config('test.source',public.capture_catalog_source('test-terms','Synthetic test terms',
  'https://issuer.example/terms',(now() at time zone 'UTC')::date,'Synthetic terms: 1.5% base rewards for tests only.')::text,true);
select is(public.capture_catalog_source('test-terms','Synthetic test terms','https://issuer.example/terms',
  (now() at time zone 'UTC')::date,'Synthetic terms: 1.5% base rewards for tests only.')->>'id',
  current_setting('test.source')::jsonb->>'id','same source capture is idempotent');
select throws_ok($q$select public.capture_catalog_source('test-terms','Changed title','https://issuer.example/terms',
  (now() at time zone 'UTC')::date,'Synthetic terms: 1.5% base rewards for tests only.')$q$,
  '22023','Existing source capture has different metadata','source identity cannot silently change');
select throws_ok($q$select public.save_catalog_draft(null,null,pg_temp.catalog(),
  array['30000000-0000-4000-8000-000000000099'::uuid],null)$q$,'22023','Invalid source document references','nonexistent source IDs are rejected');

select set_config('test.draft',public.save_catalog_draft(null,null,pg_temp.catalog(),'{}',null)::text,true);
select throws_ok('select pg_temp.publish()','22023','Source evidence is incomplete','unlinked source metadata cannot publish');
select is((select count(*) from public.catalog_releases),0::bigint,'failed publication leaves no release');
select is((public.get_catalog_review((pg_temp.current_draft()->>'id')::uuid)->'draft'->>'revision')::integer,1,'failed publication leaves draft unchanged');
select set_config('test.draft',public.save_catalog_draft((pg_temp.current_draft()->>'id')::uuid,1,pg_temp.catalog(),
  array[(current_setting('test.source')::jsonb->>'id')::uuid],null)::text,true);
select is((pg_temp.current_draft()->>'revision')::integer,2,'editing increments revision');
select throws_ok($q$select public.save_catalog_draft((pg_temp.current_draft()->>'id')::uuid,1,pg_temp.catalog(),'{}',null)$q$,
  '40001','Draft changed; review it again','stale edit cannot overwrite another revision');
select throws_ok($q$select public.publish_catalog((pg_temp.current_draft()->>'id')::uuid,1,
  pg_temp.current_draft()->>'catalog_hash',null,'Reviewed fixture terms.')$q$,'40001',null,'stale review cannot publish');
select throws_ok($q$select public.publish_catalog((pg_temp.current_draft()->>'id')::uuid,2,
  'wrong-hash',null,'Reviewed fixture terms.')$q$,'40001',null,'wrong content hash cannot publish');
select throws_ok($q$select public.publish_catalog((pg_temp.current_draft()->>'id')::uuid,2,
  pg_temp.current_draft()->>'catalog_hash',null,'')$q$,'22023',null,'explicit review note is required');
select set_config('test.release',pg_temp.publish()::text,true);
select is((select count(*) from public.catalog_releases),1::bigint,'approved draft creates exactly one release');
select is((select release_sequence from public.catalog_head),
  (current_setting('test.release')::jsonb->>'sequence')::bigint,'head points to the same committed release');
select is(pg_temp.publish()->>'sequence',current_setting('test.release')::jsonb->>'sequence','retry after lost response returns the same release');
select is(public.get_catalog_review((pg_temp.current_draft()->>'id')::uuid)->'published',current_setting('test.release')::jsonb,'review context contains the exact published snapshot');
select is(public.get_catalog_review((pg_temp.current_draft()->>'id')::uuid)->>'head',current_setting('test.release')::jsonb->>'sequence','review context head matches its published snapshot');
select throws_ok($q$select public.save_catalog_draft((pg_temp.current_draft()->>'id')::uuid,2,pg_temp.catalog(),'{}',null)$q$,
  '22023','Draft is immutable after review','published draft cannot change');
select throws_ok('update public.catalog_releases set catalog=pg_temp.catalog()','42501',null,'published snapshot cannot change through client credentials');
select throws_ok('delete from public.catalog_releases','42501',null,'published history cannot be deleted by reviewer');

-- A second draft based on the old head must be explicitly rebased and reviewed.
select set_config('test.draft',public.save_catalog_draft(null,null,pg_temp.catalog('test.2'),
  array[(current_setting('test.source')::jsonb->>'id')::uuid],null)::text,true);
select throws_ok('select pg_temp.publish()','40001','Catalog changed; rebase and review the draft','stale base cannot displace a newer release');
select set_config('test.draft',public.save_catalog_draft((pg_temp.current_draft()->>'id')::uuid,1,pg_temp.catalog('test.2'),
  array[(current_setting('test.source')::jsonb->>'id')::uuid],
  (current_setting('test.release')::jsonb->>'sequence')::bigint)::text,true);
select lives_ok('select pg_temp.publish()','rebased and reviewed draft publishes');
select is((select count(*) from public.catalog_releases),2::bigint,'correction keeps both releases');
reset role;
select is((select count(*) from catalog_private.publications where reviewed_by='10000000-0000-4000-8000-000000000001'),
  2::bigint,'private audit identifies the approving human for both releases');
select is((select count(*) from catalog_private.drafts where status='published'),2::bigint,'release and draft transitions commit together');
set local role anon;
select is((select count(*) from public.catalog_releases),2::bigint,'public can read published rules');
select throws_ok('select * from catalog_private.publications','42501',null,'public cannot read reviewer identity or review notes');
reset role;

-- Revocation is checked against live rows, even with an unchanged JWT.
update auth.sessions set not_after=now()-interval '1 second' where id='20000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok('select public.get_catalog_review()','42501',null,'expired database session is rejected');
reset role;
update auth.sessions set not_after=null where id='20000000-0000-4000-8000-000000000001';
update auth.users set banned_until=now()+interval '1 day' where id='10000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok('select public.get_catalog_review()','42501',null,'banned reviewer is rejected');
reset role;
update auth.users set banned_until=null,is_anonymous=true where id='10000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok('select public.get_catalog_review()','42501',null,'anonymous sign-in is rejected even if mistakenly granted membership');
reset role;
update auth.users set is_anonymous=false where id='10000000-0000-4000-8000-000000000001';
delete from catalog_private.reviewers where user_id='10000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok('select public.get_catalog_review()','42501',null,'removed reviewer membership takes effect immediately');
reset role;
insert into catalog_private.reviewers(user_id) values('10000000-0000-4000-8000-000000000001');
delete from auth.sessions where id='20000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok('select public.get_catalog_review()','42501',null,'deleted session rejects the still-unexpired token claims');
reset role;
set local role service_role;
select throws_ok('select public.publish_catalog(null,null,null,null,''Automated publication'')','42501',null,'service role cannot call the human publication RPC');
select throws_ok('insert into public.catalog_releases(catalog) values(pg_temp.catalog())','42501',null,'bypass-RLS role still has no table write grant');
reset role;

select * from finish();
rollback;
