begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,is_anonymous) values('81000000-0000-4000-8000-000000000001',false);
insert into auth.sessions(id,user_id) values('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001');
insert into catalog_private.reviewers(user_id) values('81000000-0000-4000-8000-000000000001');

-- A small synthetic schema-2 catalog dated today (the real one expires, this must not).
create function pg_temp.v2(ver text default 'test-v2.1') returns jsonb language sql as $$
  select jsonb_build_object(
    'schemaVersion',2,'version',ver,
    'verifiedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD')||'T00:00:00Z',
    'expiresAt',to_char((now() at time zone 'UTC') + interval '30 days','YYYY-MM-DD')||'T00:00:00Z',
    'merchants','[{"id":"best-buy-us","name":"Best Buy","onlineRetail":true,"physicalGoods":true,"usMerchant":true,
      "expectedCategory":"electronics","mcc":{"code":"5732","confidence":"low","sourceIds":["test-mcc"]},"notes":"Test."}]'::jsonb,
    'sources',jsonb_build_array(
      jsonb_build_object('id','test-terms','title','Synthetic v2 terms','url','https://issuer.example/v2',
        'checkedOn',to_char(now() at time zone 'UTC','YYYY-MM-DD')),
      jsonb_build_object('id','test-mcc','title','Synthetic MCC lookup','url','https://mcc.example/best-buy',
        'checkedOn',to_char(now() at time zone 'UTC','YYYY-MM-DD'))),
    'cards','[
      {"id":"test-double","name":"Test Double","shortName":"Double","issuer":"Test Bank","rewardCurrency":"points",
       "pointValueHundredthsOfCent":100,"exclusions":["Balance transfers"],"rules":[
        {"id":"double-base","category":"all-purchases","issuerWording":"every purchase","rateBps":200,"paidOnPaymentBps":100,
         "cap":{"kind":"none"},"activation":"none","usMerchantsOnly":false,"excludedPaymentPaths":[],"limitedTime":null,
         "sourceIds":["test-terms"]},
        {"id":"double-travel","category":"travel-portal","issuerWording":"travel portal","rateBps":500,"paidOnPaymentBps":100,
         "cap":{"kind":"none"},"activation":"none","usMerchantsOnly":false,"excludedPaymentPaths":[],"limitedTime":null,
         "sourceIds":["test-terms"]}]},
      {"id":"test-everyday","name":"Test Everyday","shortName":"Everyday","issuer":"American Express","rewardCurrency":"cash-back",
       "pointValueHundredthsOfCent":null,"exclusions":[],"rules":[
        {"id":"everyday-base","category":"all-purchases","issuerWording":"other purchases","rateBps":100,"paidOnPaymentBps":0,
         "cap":{"kind":"unstated"},"activation":"unstated","usMerchantsOnly":false,"excludedPaymentPaths":[],"limitedTime":null,
         "sourceIds":["test-terms"]},
        {"id":"everyday-online","category":"online-retail","issuerWording":"U.S. online retail purchases","rateBps":300,
         "paidOnPaymentBps":0,"cap":{"kind":"spend","amountCents":600000,"period":"year-unspecified","rateAfterCapBps":100},
         "activation":"unstated","usMerchantsOnly":true,"excludedPaymentPaths":["bnpl"],"limitedTime":{"endsOn":null},
         "sourceIds":["test-terms"]}]}
    ]'::jsonb);
$$;
create function pg_temp.valid(payload jsonb) returns boolean language sql as $$
  select catalog_private.valid_catalog(payload);
$$;

-- Validator: schema 2 accepted, schema 1 still accepted, everything else rejected.
select ok(pg_temp.valid(pg_temp.v2()),'synthetic v2 catalog passes the union validator');
select ok(catalog_private.valid_catalog_v2(pg_temp.v2()),'synthetic v2 catalog passes the v2 validator');
select ok(not catalog_private.valid_catalog_v1(pg_temp.v2()),'the v1 validator rejects a v2 catalog');
select ok(coalesce((select pg_temp.valid(catalog) from catalog_private.drafts
  where id='00000000-0000-4000-8000-000000000001'),false),'seeded real 7-card catalog passes');
select ok(pg_temp.valid(jsonb_build_object(
    'schemaVersion',1,'version','v1.1','verifiedAt','2026-09-25T00:00:00Z','expiresAt','2026-10-25T00:00:00Z',
    'merchantIds','["best-buy-us"]'::jsonb,
    'sources','[{"id":"s","title":"t","url":"https://issuer.example/","checkedOn":"2026-09-25"}]'::jsonb,
    'cards','[{"id":"c","name":"C","shortName":"C","rules":[{"id":"r","category":"all-eligible","rateBps":150,
      "requiresActivation":false,"sourceIds":["s"]}]}]'::jsonb)),'a v1 catalog still passes the union validator');
select ok(not pg_temp.valid(pg_temp.v2()||'{"schemaVersion":3}'),'unknown schema version fails');
select ok(not pg_temp.valid(pg_temp.v2()||'{"merchantIds":["best-buy-us"]}'),'v1 fields on v2 fail');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v2(),'{cards,0,rules,0,cap}','{"kind":"spend","amountCents":1,"period":"month","rateAfterCapBps":0}')),
  'capped base fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v2(),'{cards,0,rules,0,activation}','"recurring"')),'activated base fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v2(),'{cards,1,rules,1,rateBps}','50')),'bonus below base fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v2(),'{cards,0,rules,0,paidOnPaymentBps}','201')),'paid-on-payment above rate fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v2(),'{cards,1,rules,1,cap,rateAfterCapBps}','301')),'after-cap above rate fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v2(),'{cards,1,rules,1,cap,rateAfterCapBps}','50')),
  'after-cap below the base rate fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v2(),'{cards,1,rules,1,excludedPaymentPaths}','["card"]')),
  'card cannot be an excluded payment path');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v2(),'{cards,1,rules,1,cap}','{"kind":"unstated","amountCents":1}')),
  'extra cap fields fail');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v2(),'{cards,1,rules,1,limitedTime}','{"endsOn":"2026-02-30"}')),
  'calendar-invalid promotion end fails');
select ok(pg_temp.valid(jsonb_set(pg_temp.v2(),'{cards,1,rules,1,limitedTime}','{"endsOn":"2020-01-31"}')),
  'expired promotion is stored (the engine never applies it)');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v2(),'{cards,0,rules,0,sourceIds}','["absent"]')),'absent rule source fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v2(),'{merchants,0,mcc,sourceIds}','[]')),'stated MCC without source fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v2(),'{merchants,0,mcc}','{"code":null,"confidence":"high","sourceIds":[]}')),
  'unknown MCC with high confidence fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v2(),'{cards,0,pointValueHundredthsOfCent}','null')),'points without value fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v2(),'{cards,1,rules,1,excludedPaymentPaths}','["bnpl","bnpl"]')),
  'duplicate excluded payment path fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v2(),'{cards,1,rules,1,id}','"double-base"')),'duplicate global rule id fails');

-- Table constraints use the union validator.
select throws_ok($q$insert into catalog_private.drafts(catalog) values(jsonb_set(pg_temp.v2(),'{cards,0,rules,0,rateBps}','-1'))$q$,
  '23514',null,'draft constraint rejects an invalid v2 catalog');
select throws_ok($q$insert into public.catalog_releases(catalog) values(pg_temp.v2()||'{"schemaVersion":3}')$q$,
  '23514',null,'release constraint rejects an unknown schema');

-- A reviewer publishes a v2 draft through the normal transaction; source matching works for v2.
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","session_id":"82000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select set_config('test.terms',public.capture_catalog_source('test-terms','Synthetic v2 terms','https://issuer.example/v2',
  (now() at time zone 'UTC')::date,'Synthetic v2 terms for tests only.')->>'id',true);
select set_config('test.mcc',public.capture_catalog_source('test-mcc','Synthetic MCC lookup','https://mcc.example/best-buy',
  (now() at time zone 'UTC')::date,'Synthetic MCC lookup for tests only.')->>'id',true);
-- Long issuer terms (the Citi terms PDF is about 75,000 characters) fit; the limit is 250,000 since
-- 20261002222425_catalog_v3 (catalog_v3.test.sql checks the new boundary).
select lives_ok($q$select public.capture_catalog_source('test-long','Long terms','https://issuer.example/long',
  (now() at time zone 'UTC')::date,repeat('x',100000))$q$,'a 100,000-character capture fits');
select throws_ok($q$select public.capture_catalog_source('test-long2','Long terms 2','https://issuer.example/long2',
  (now() at time zone 'UTC')::date,repeat('x',250001))$q$,'23514',null,'captures over 250,000 characters fail');
select set_config('test.draft',public.save_catalog_draft(null,null,pg_temp.v2(),
  array[current_setting('test.terms')::uuid],(select release_sequence from public.catalog_head))::text,true);
select throws_ok($q$select public.publish_catalog((current_setting('test.draft')::jsonb->>'id')::uuid,1,
  current_setting('test.draft')::jsonb->>'catalog_hash',(select release_sequence from public.catalog_head),
  'Reviewed synthetic v2 terms.')$q$,'22023','Source evidence is incomplete','v2 merchant sources need captured evidence too');
select set_config('test.draft',public.save_catalog_draft((current_setting('test.draft')::jsonb->>'id')::uuid,1,pg_temp.v2(),
  array[current_setting('test.terms')::uuid,current_setting('test.mcc')::uuid],
  (select release_sequence from public.catalog_head))::text,true);
select set_config('test.release',public.publish_catalog((current_setting('test.draft')::jsonb->>'id')::uuid,2,
  current_setting('test.draft')::jsonb->>'catalog_hash',(select release_sequence from public.catalog_head),
  'Reviewed synthetic v2 terms.')::text,true);
select is(current_setting('test.release')::jsonb#>>'{catalog,schemaVersion}','2','published release is schema 2');
select is((select release_sequence from public.catalog_head),(current_setting('test.release')::jsonb->>'sequence')::bigint,
  'head points to the v2 release');
reset role;
set local role anon;
select is((select r.catalog->>'version' from public.catalog_head h join public.catalog_releases r on r.sequence=h.release_sequence),
  'test-v2.1','anonymous readers see the published v2 catalog');
reset role;

select * from finish();
rollback;
