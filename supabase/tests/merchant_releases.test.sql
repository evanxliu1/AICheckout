begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,is_anonymous) values
  ('93000000-0000-4000-8000-000000000001',false),('93000000-0000-4000-8000-000000000002',false);
insert into auth.sessions(id,user_id) values
  ('94000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001'),
  ('94000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000002');
insert into catalog_private.reviewers(user_id) values('93000000-0000-4000-8000-000000000001');

-- A small synthetic merchant release (schema 1) verified today: an issuer page, a store page, a lookup and a
-- card-transaction dataset; a default store with a brand, an issuer-named supermarket, a corroborated drugstore,
-- a definition-based store, a processor, a disabled store and an mcc-based restaurant (2026-10-11). Fixture
-- values are not claims about real stores.
create function pg_temp.release(ver text default '2026-10-11.test.1') returns jsonb language sql as $$
  select jsonb_build_object(
    'schemaVersion',1,'version',ver,
    'verifiedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD')||'T00:00:00Z',
    'sources',jsonb_build_array(
      jsonb_build_object('id','issuer-terms','url','https://issuer.example/terms','kind','issuer-terms',
        'capturedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD'),'sha256',repeat('a',64)),
      jsonb_build_object('id','store-about','url','https://store.example/about','kind','store-page',
        'capturedAt',to_char((now() at time zone 'UTC') - interval '1 day','YYYY-MM-DD'),'sha256',repeat('b',64)),
      jsonb_build_object('id','store-mcc','url','https://lookup.example/store','kind','mcc-lookup',
        'capturedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD'),'sha256',repeat('c',64)),
      jsonb_build_object('id','mcc-dataset','url','https://opendata.example/pcard.csv','kind','mcc-dataset',
        'capturedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD'),'sha256',repeat('e',64))),
    'merchants','[
      {"id":"target-us","name":"Target","hosts":["target.com"],"kind":"merchant","physicalGoods":true,
       "category":"general-merchandise","evidence":{"basis":"default","sourceIds":[]},"brandIds":["target"],"disabled":false},
      {"id":"grocer-us","name":"Grocer","hosts":["grocer.example","shop.grocer.example"],"kind":"merchant","physicalGoods":true,
       "category":"supermarkets","evidence":{"basis":"issuer","sourceIds":["issuer-terms"]},"brandIds":[],"disabled":false},
      {"id":"pharmacy-us","name":"Pharmacy","hosts":["pharmacy.example"],"kind":"merchant","physicalGoods":true,
       "category":"drugstores","evidence":{"basis":"corroborated","sourceIds":["store-about","store-mcc"]},"brandIds":[],"disabled":false},
      {"id":"diner-us","name":"Diner & Co.","hosts":["diner.example"],"kind":"merchant","physicalGoods":false,
       "category":"dining","evidence":{"basis":"definition","sourceIds":["store-about","issuer-terms"]},"brandIds":[],"disabled":false},
      {"id":"paypal","name":"PayPal","hosts":["paypal.com"],"kind":"processor","physicalGoods":false,
       "category":"general-merchandise","evidence":{"basis":"default","sourceIds":[]},"brandIds":[],"disabled":false},
      {"id":"closed-us","name":"Closed Store","hosts":["closed.example"],"kind":"merchant","physicalGoods":true,
       "category":"general-merchandise","evidence":{"basis":"default","sourceIds":[]},"brandIds":[],"disabled":true},
      {"id":"coffee-us","name":"Coffee Chain","hosts":["coffee.example"],"kind":"merchant","physicalGoods":false,
       "category":"dining","evidence":{"basis":"mcc","sourceIds":["mcc-dataset"]},"brandIds":[],"disabled":false}
    ]'::jsonb);
$$;
create function pg_temp.valid(payload jsonb) returns boolean language sql as $$
  select catalog_private.valid_merchant_release_v1(payload) and catalog_private.valid_merchant_release(payload);
$$;
create function pg_temp.head() returns jsonb language sql as $$
  select to_jsonb(r) from public.merchant_head h join public.merchant_releases r on r.sequence=h.release_sequence;
$$;
create function pg_temp.publish(payload jsonb, note text default 'Agent-verified merchant release; checked by the coordinator.') returns jsonb language sql as $$
  select public.publish_merchant_release(payload,
    (select release_sequence from public.merchant_head), pg_temp.head()->>'release_hash', note);
$$;

-- Validator.
select ok(pg_temp.valid(pg_temp.release()),'synthetic merchant release is valid');
select ok(not pg_temp.valid(null),'null release fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{schemaVersion}','2')),'schema 2 fails');
select ok(not pg_temp.valid(pg_temp.release()||'{"expiresAt":"2026-12-01T00:00:00Z"}'),'unknown field fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{version}','"seed.1"')),'version without a date fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants}','[]')),'no merchants fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,0,hosts}','["Target.com"]')),'upper-case host fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,0,hosts}','["127.0.0.1"]')),'IPv4 host fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,0,hosts}','["grocer.example"]')),'host shared by two records fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,0,hosts}','["target.com","target.com"]')),'repeated host fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,0,name}','"<b>Target</b>"')),'name with markup fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,0,category}','"groceries"')),'unknown category fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,0,category}','"electronics"')),'bonus category on default evidence fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,0,evidence,sourceIds}','["store-about"]')),'default evidence citing a source fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,1,evidence,sourceIds}','["store-about"]')),'issuer evidence without issuer terms fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,2,evidence,sourceIds}','["store-about"]')),'corroborated evidence without a lookup fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,3,evidence,sourceIds}','["store-about","store-mcc"]')),'definition evidence without issuer terms fails');
select ok(pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,3,kind}','"marketplace"')),'definition evidence on a dining marketplace is valid');
select ok(not pg_temp.valid(jsonb_set(jsonb_set(pg_temp.release(),'{merchants,3,kind}','"marketplace"'),'{merchants,3,category}','"drugstores"')),'definition evidence on a marketplace outside dining fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,2,evidence,sourceIds}','["store-about","missing"]')),'unknown source id fails');
select ok(not pg_temp.valid(jsonb_set(jsonb_set(pg_temp.release(),'{merchants,6,evidence,sourceIds}','["store-mcc"]'),'{sources}',
  (select jsonb_agg(s) from jsonb_array_elements(pg_temp.release()->'sources') s where s->>'id'<>'mcc-dataset'))),'mcc evidence without a dataset fails');
select ok(pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,6,kind}','"marketplace"')),'mcc evidence on a dining marketplace is valid');
select ok(not pg_temp.valid(jsonb_set(jsonb_set(pg_temp.release(),'{merchants,6,kind}','"marketplace"'),'{merchants,6,category}','"supermarkets"')),'mcc evidence on a marketplace outside dining fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,6,kind}','"processor"')),'mcc evidence on a processor fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{sources,3,kind}','"blog"')),'unknown source kind fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,4,physicalGoods}','true')),'processor with physical goods fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,4,brandIds}','["target"]')),'processor with a brand fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{sources,0,url}','"https://user:pw@issuer.example/terms"')),'source URL with credentials fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{sources,0,url}','"http://issuer.example/terms"')),'source over http fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{sources,0,capturedAt}',
  to_jsonb(to_char((now() at time zone 'UTC') + interval '1 day','YYYY-MM-DD')))),'source captured after verification fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{sources,0,capturedAt}','"2026-02-30"')),'invalid calendar date fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{sources}',(pg_temp.release()->'sources')||
  jsonb_build_object('id','uncited','url','https://x.example/','kind','store-page',
    'capturedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD'),'sha256',repeat('d',64)))),'a source no record cites fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.release(),'{merchants,0,disabled}','"true"')),'disabled as a string fails');

-- Public read, no public or service-role writes.
set local role anon;
select lives_ok('select * from public.merchant_head','public can read the merchant head');
select is((select count(*) from public.merchant_releases),0::bigint,'no merchant release before the first publication');
select throws_ok('select public.publish_merchant_release(pg_temp.release(),null,null,''Unauthorized action'')','42501',null,'anonymous cannot publish merchants');
select throws_ok('update public.merchant_head set release_sequence=null','42501',null,'merchant head cannot be overwritten by the public');
select throws_ok('insert into public.merchant_releases(release) values(pg_temp.release())','42501',null,'anonymous cannot insert a merchant release');
reset role;
set local role service_role;
select throws_ok('select public.publish_merchant_release(pg_temp.release(),null,null,''Automated publication'')','42501',null,'service role cannot publish merchants');
select throws_ok('insert into public.merchant_releases(release) values(pg_temp.release())','42501',null,'bypass-RLS role has no merchant table write grant');
reset role;

-- A signed-in non-reviewer is refused.
select set_config('request.jwt.claims','{"sub":"93000000-0000-4000-8000-000000000002","session_id":"94000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok('select public.publish_merchant_release(pg_temp.release(),null,null,''Reviewed fixture release.'')','42501','Reviewer authorization required','non-reviewer cannot publish merchants');
reset role;

-- The reviewer publishes; the head, idempotency and the expected-head checks.
select set_config('request.jwt.claims','{"sub":"93000000-0000-4000-8000-000000000001","session_id":"94000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select throws_ok('select public.publish_merchant_release(pg_temp.release(),null,null,''short'')','22023',null,'a review note is required');
select throws_ok($q$select public.publish_merchant_release(jsonb_set(pg_temp.release(),'{merchants}','[]'),null,null,'Reviewed fixture release.')$q$,'22023',null,'an invalid release is refused by the function');
select throws_ok($q$select public.publish_merchant_release(jsonb_set(pg_temp.release(),'{verifiedAt}','"2999-01-01T00:00:00Z"'),null,null,'Reviewed fixture release.')$q$,'22023',null,'a release verified in the future is refused');
select throws_ok($q$select public.publish_merchant_release(pg_temp.release(),7,null,'Reviewed fixture release.')$q$,'40001',null,'a wrong expected head cannot publish');
select set_config('test.release',pg_temp.publish(pg_temp.release())::text,true);
select is((select count(*) from public.merchant_releases),1::bigint,'the first publication creates one release');
select is((select release_sequence from public.merchant_head),(current_setting('test.release')::jsonb->>'sequence')::bigint,'the head points to the new release');
select is(current_setting('test.release')::jsonb->>'version','2026-10-11.test.1','the generated version is the release version');
select matches(current_setting('test.release')::jsonb->>'release_hash','^[a-f0-9]{64}$','the release hash is a SHA-256 hex');
select is(pg_temp.publish(pg_temp.release())->>'sequence',current_setting('test.release')::jsonb->>'sequence','republishing the same version and content returns the same release');
select is((select count(*) from public.merchant_releases),1::bigint,'the retry created no second release');
select throws_ok($q$select pg_temp.publish(jsonb_set(pg_temp.release(),'{merchants,0,disabled}','true'))$q$,'40001',null,'the same version with different content is refused');
select throws_ok($q$select public.publish_merchant_release(pg_temp.release('2026-10-11.test.2'),null,null,'Reviewed fixture release.')$q$,'40001',null,'a stale expected head (none) cannot publish over a release');
select throws_ok($q$select public.publish_merchant_release(pg_temp.release('2026-10-11.test.2'),
  (select release_sequence from public.merchant_head),repeat('0',64),'Reviewed fixture release.')$q$,'40001',null,'a wrong expected hash cannot publish');
select lives_ok($q$select pg_temp.publish(pg_temp.release('2026-10-11.test.2'))$q$,'a second release publishes on the current head');
select is((select count(*) from public.merchant_releases),2::bigint,'both releases are kept');
select is((select version from public.merchant_releases r join public.merchant_head h on h.release_sequence=r.sequence),'2026-10-11.test.2','the head moved to the second release');
select throws_ok('update public.merchant_releases set release=pg_temp.release()','42501',null,'a published merchant release cannot change through client credentials');
select throws_ok('delete from public.merchant_releases','42501',null,'merchant release history cannot be deleted by the reviewer');
reset role;
select is((select count(*) from catalog_private.merchant_publications where reviewed_by='93000000-0000-4000-8000-000000000001'),2::bigint,'the private audit names the approving reviewer for both releases');
set local role anon;
select is((select count(*) from public.merchant_releases),2::bigint,'the public reads both published merchant releases');
select throws_ok('select * from catalog_private.merchant_publications','42501',null,'the public cannot read reviewer identity or notes');
reset role;

-- Revocation applies to merchant publication too.
delete from auth.sessions where id='94000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($q$select pg_temp.publish(pg_temp.release('2026-10-11.test.3'))$q$,'42501',null,'a deleted session cannot publish merchants');
reset role;

select * from finish();
rollback;
