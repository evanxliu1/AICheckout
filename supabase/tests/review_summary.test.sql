begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Review summary (Stage 2 M8): source metadata without bodies, and one body on demand.
insert into auth.users(id,is_anonymous) values
  ('85000000-0000-4000-8000-000000000001',false),
  ('85000000-0000-4000-8000-000000000002',false);
insert into auth.sessions(id,user_id) values
  ('86000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001'),
  ('86000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000002');
insert into catalog_private.reviewers(user_id) values('85000000-0000-4000-8000-000000000001');

create function pg_temp.catalog() returns jsonb language sql as $$
  select jsonb_build_object(
    'schemaVersion',1,'version','summary-test.1',
    'verifiedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD')||'T00:00:00Z',
    'expiresAt',to_char((now() at time zone 'UTC') + interval '30 days','YYYY-MM-DD')||'T00:00:00Z',
    'merchantIds',jsonb_build_array('best-buy-us'),
    'sources',jsonb_build_array(jsonb_build_object('id','summary-terms','title','Synthetic summary terms',
      'url','https://issuer.example/summary','checkedOn',to_char(now() at time zone 'UTC','YYYY-MM-DD'))),
    'cards','[{"id":"summary-card","name":"Synthetic card","shortName":"Test","rules":[
      {"id":"summary-base","category":"all-eligible","rateBps":150,"requiresActivation":false,"sourceIds":["summary-terms"]}
    ]}]'::jsonb
  );
$$;

set local role anon;
select throws_ok('select public.get_catalog_review_summary(null)','42501',null,'anonymous cannot call the summary RPC');
select throws_ok('select public.get_catalog_review_source(null,null)','42501',null,'anonymous cannot read a source');
reset role;

select set_config('request.jwt.claims','{"sub":"85000000-0000-4000-8000-000000000002","session_id":"86000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($q$select public.get_catalog_review_summary('87000000-0000-4000-8000-000000000001')$q$,
  '42501','Reviewer authorization required','signed-in non-reviewer cannot read a summary');
select throws_ok($q$select public.get_catalog_review_source('87000000-0000-4000-8000-000000000001','87000000-0000-4000-8000-000000000002')$q$,
  '42501','Reviewer authorization required','signed-in non-reviewer cannot read a source');
reset role;

select set_config('request.jwt.claims','{"sub":"85000000-0000-4000-8000-000000000001","session_id":"86000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
-- A multibyte body: the summary reports characters, not bytes.
select set_config('test.source',public.capture_catalog_source('summary-terms','Synthetic summary terms',
  'https://issuer.example/summary',(now() at time zone 'UTC')::date,'Synthetic terms: 1.5% back. 界')::text,true);
select set_config('test.other',public.capture_catalog_source('summary-other','Unattached terms',
  'https://issuer.example/other',(now() at time zone 'UTC')::date,'Unattached synthetic terms.')::text,true);
select set_config('test.draft',public.save_catalog_draft(null,null,pg_temp.catalog(),
  array[(current_setting('test.source')::jsonb->>'id')::uuid],null)::text,true);
select set_config('test.summary',public.get_catalog_review_summary(
  (current_setting('test.draft')::jsonb->>'id')::uuid)::text,true);

select is(current_setting('test.summary')::jsonb->'draft',
  public.get_catalog_review((current_setting('test.draft')::jsonb->>'id')::uuid)->'draft',
  'summary carries the same draft as the full review');
select is(current_setting('test.summary')::jsonb->'head',
  public.get_catalog_review((current_setting('test.draft')::jsonb->>'id')::uuid)->'head','summary carries the head');
select ok(current_setting('test.summary')::jsonb ? 'published','summary carries the published snapshot key');
select is(current_setting('test.summary')::jsonb->>'reviewerId','85000000-0000-4000-8000-000000000001','summary names the reviewer');
select is(jsonb_array_length(current_setting('test.summary')::jsonb->'sources'),1,'summary lists only attached sources');
select ok(not (current_setting('test.summary')::jsonb->'sources'->0 ? 'body'),'summary never includes a source body');
select is((current_setting('test.summary')::jsonb->'sources'->0->>'body_chars')::integer,29,'summary reports the body length in characters');
select is(current_setting('test.summary')::jsonb->'sources'->0,
  (public.get_catalog_review((current_setting('test.draft')::jsonb->>'id')::uuid)->'sources'->0) - 'body'
    || jsonb_build_object('body_chars',29),
  'summary metadata equals the full review without the body');

select is(public.get_catalog_review_source((current_setting('test.draft')::jsonb->>'id')::uuid,
  (current_setting('test.source')::jsonb->>'id')::uuid),current_setting('test.source')::jsonb,
  'an attached source is returned with its body');
select throws_ok($q$select public.get_catalog_review_source((current_setting('test.draft')::jsonb->>'id')::uuid,
  (current_setting('test.other')::jsonb->>'id')::uuid)$q$,'P0002','Source not found','a source not attached to the draft is not returned');
select throws_ok($q$select public.get_catalog_review_source('87000000-0000-4000-8000-000000000001',
  (current_setting('test.source')::jsonb->>'id')::uuid)$q$,'P0002','Source not found','an unknown draft returns no source');
select throws_ok($q$select public.get_catalog_review_summary('87000000-0000-4000-8000-000000000001')$q$,
  'P0002','Draft not found','an unknown draft has no summary');
select throws_ok('select public.get_catalog_review_summary(null)','P0002','Draft not found','the summary needs a draft');
select throws_ok('select * from catalog_private.source_documents','42501',null,'reviewer still has no direct private-table access');
reset role;

select * from finish();
rollback;
