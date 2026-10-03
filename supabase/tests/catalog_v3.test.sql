begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,is_anonymous) values('83000000-0000-4000-8000-000000000001',false);
insert into auth.sessions(id,user_id) values('84000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001');
insert into catalog_private.reviewers(user_id) values('83000000-0000-4000-8000-000000000001');

-- A small synthetic schema-3 catalog dated today: programs, a brand, a gate, an open-loop card with
-- a brand-scoped gated rule and a chosen category, and a closed-loop card with no base rule.
create function pg_temp.v3(ver text default 'test-v3.1') returns jsonb language sql as $$
  select jsonb_build_object(
    'schemaVersion',3,'version',ver,
    'verifiedAt',to_char(now() at time zone 'UTC','YYYY-MM-DD')||'T00:00:00Z',
    'expiresAt',to_char((now() at time zone 'UTC') + interval '30 days','YYYY-MM-DD')||'T00:00:00Z',
    'programs',jsonb_build_array(
      '{"id":"cash-back","name":"Cash back","currency":"cash-back","unitName":"cents",
        "valuation":{"basis":"cash","valueHundredthsOfCent":100},"redemptionBrandIds":[]}'::jsonb,
      jsonb_build_object('id','test-points','name','Test Points','currency','points','unitName','points',
        'valuation',jsonb_build_object('basis','published-estimate','valueHundredthsOfCent',120,
          'publisher','Example Valuations','url','https://valuations.example/points',
          'retrievedOn',to_char(now() at time zone 'UTC','YYYY-MM-DD')),'redemptionBrandIds','[]'::jsonb)),
    'brands','[{"id":"amazon","name":"Amazon"}]'::jsonb,
    'gates','[{"id":"amazon-prime","question":"Do you have an eligible Amazon Prime membership?",
      "options":[{"id":"member","label":"Prime member"},{"id":"not-member","label":"No Prime membership"}]}]'::jsonb,
    'merchants','[{"id":"amazon-us","name":"Amazon","onlineRetail":true,"physicalGoods":true,"usMerchant":true,
      "expectedCategory":"general-merchandise","mcc":{"code":null,"confidence":"low","sourceIds":[]},"notes":"Test.",
      "brandIds":["amazon"]}]'::jsonb,
    'sources',jsonb_build_array(
      jsonb_build_object('id','test-terms','title','Synthetic v3 terms','url','https://issuer.example/v3',
        'checkedOn',to_char(now() at time zone 'UTC','YYYY-MM-DD'))),
    'cards','[
      {"id":"test-visa","name":"Test Visa","shortName":"Visa","issuer":"Test Bank","programId":"test-points",
       "statedValueHundredthsOfCent":null,"acceptance":{"kind":"open-loop"},
       "choices":[{"id":"pick","kind":"chosen","label":"One 3% category","picks":1,
         "options":[{"id":"electronics","label":"Electronics stores"},{"id":"dining","label":"Dining"}],
         "defaultOptionIds":["dining"]}],
       "exclusions":["Balance transfers"],"rules":[
        {"id":"visa-base","category":"all-purchases","issuerWording":"every purchase","rateBps":100,"paidOnPaymentBps":0,
         "cap":{"kind":"none"},"activation":"none","usMerchantsOnly":false,"excludedPaymentPaths":[],"limitedTime":null,
         "sourceIds":["test-terms"],"brandIds":[],"excludedBrandIds":[],"sharedCapId":null,"choice":null,"requires":[],"requiredPaymentPaths":[]},
        {"id":"visa-amazon","category":"other","issuerWording":"Amazon with Prime","rateBps":500,"paidOnPaymentBps":0,
         "cap":{"kind":"none"},"activation":"none","usMerchantsOnly":false,"excludedPaymentPaths":["venmo"],
         "limitedTime":{"startsOn":"2026-01-01","endsOn":null},"sourceIds":["test-terms"],"brandIds":["amazon"],
         "excludedBrandIds":[],"sharedCapId":null,"choice":null,"requires":[{"gateId":"amazon-prime","optionIds":["member"]}],"requiredPaymentPaths":[]},
        {"id":"visa-electronics","category":"electronics","issuerWording":"chosen electronics","rateBps":300,
         "paidOnPaymentBps":0,"cap":{"kind":"spend","amountCents":250000,"period":"quarter","rateAfterCapBps":100},
         "activation":"enroll-once","usMerchantsOnly":false,"excludedPaymentPaths":[],"limitedTime":null,
         "sourceIds":["test-terms"],"brandIds":[],"excludedBrandIds":[],"sharedCapId":null,"choice":{"choiceId":"pick","optionId":"electronics"},"requires":[],
         "requiredPaymentPaths":[]}]},
      {"id":"test-store","name":"Test Store Card","shortName":"Store","issuer":"Test Bank","programId":"cash-back",
       "statedValueHundredthsOfCent":null,"acceptance":{"kind":"closed-loop","brandIds":["amazon"]},"choices":[],
       "exclusions":[],"rules":[
        {"id":"store-amazon","category":"other","issuerWording":"Amazon purchases","rateBps":300,"paidOnPaymentBps":0,
         "cap":{"kind":"none"},"activation":"none","usMerchantsOnly":false,"excludedPaymentPaths":[],"limitedTime":null,
         "sourceIds":["test-terms"],"brandIds":["amazon"],"excludedBrandIds":[],"sharedCapId":null,"choice":null,"requires":[],"requiredPaymentPaths":["card"]}]}
    ]'::jsonb);
$$;
create function pg_temp.valid(payload jsonb) returns boolean language sql as $$
  select catalog_private.valid_catalog(payload);
$$;

-- Validator: schema 3 accepted by its own and the union validator; schemas 1 and 2 unaffected.
select ok(pg_temp.valid(pg_temp.v3()),'synthetic v3 catalog passes the union validator');
select ok(catalog_private.valid_catalog_v3(pg_temp.v3()),'synthetic v3 catalog passes the v3 validator');
select ok(not catalog_private.valid_catalog_v2(pg_temp.v3()),'the v2 validator rejects a v3 catalog');
select ok(not catalog_private.valid_catalog_v3(pg_temp.v3()||'{"schemaVersion":2}'),'the v3 validator rejects schema 2');
select ok(coalesce((select pg_temp.valid(catalog) from catalog_private.drafts
  where id='00000000-0000-4000-8000-000000000001'),false),'seeded 178-card catalog v3 passes');
select ok(not pg_temp.valid(pg_temp.v3()||'{"schemaVersion":4}'),'unknown schema version fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v3(),'{cards,0,rules,0,brandIds}','["amazon"]')),
  'an open-loop card without an unconditional base fails');
select ok(pg_temp.valid(jsonb_set(pg_temp.v3(),'{cards,1,rules}',
  (pg_temp.v3()#>'{cards,1,rules}')||jsonb_set(pg_temp.v3()#>'{cards,0,rules,0}','{id}','"store-base"'))),
  'a closed-loop card may have one base');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v3(),'{cards,0,rules,1,requires,0,gateId}','"absent"')),'absent gate fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v3(),'{cards,0,rules,1,brandIds}','["absent"]')),'absent rule brand fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v3(),'{cards,0,rules,2,excludedBrandIds}','["absent"]')),
  'absent excluded brand fails');
select ok(pg_temp.valid(jsonb_set(pg_temp.v3(),'{cards,0,rules,2,sharedCapId}','"visa-quarterly"')),
  'a spend-capped rule may name a shared cap');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v3(),'{cards,0,rules,1,sharedCapId}','"visa-quarterly"')),
  'a shared cap on a rule without a spend cap fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v3(),'{cards,0,rules,2,choice,optionId}','"absent"')),'absent choice option fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v3(),'{cards,0,programId}','"absent"')),'absent program fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v3(),'{cards,1,statedValueHundredthsOfCent}','100')),
  'issuer-stated value on a cash-back program fails');
select ok(pg_temp.valid(jsonb_set(pg_temp.v3(),'{cards,0,statedValueHundredthsOfCent}','125')),
  'issuer-stated value on a points program passes');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v3(),'{cards,0,rules,1,limitedTime}','{"startsOn":"2026-02-30","endsOn":null}')),
  'calendar-invalid start date fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v3(),'{cards,0,rules,1,limitedTime}','{"startsOn":"2026-03-01","endsOn":"2026-02-01"}')),
  'a rule ending before it starts fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v3(),'{cards,0,rules,1,requiredPaymentPaths}','["venmo"]')),
  'a payment path both required and excluded fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v3(),'{cards,0,rules,2,category}','"restaurants"')),'unknown category fails');
select ok(not pg_temp.valid(jsonb_set(pg_temp.v3(),'{programs,1,valuation,retrievedOn}',
  to_jsonb(to_char((now() at time zone 'UTC') - interval '31 days','YYYY-MM-DD')))),'stale published estimate fails');
select is(catalog_private.catalog_v3_reward_categories() @> array['electronics','department-stores'],true,
  'v3 reward categories include the provisional retail categories');

-- Table constraints use the union validator.
select throws_ok($q$insert into catalog_private.drafts(catalog) values(jsonb_set(pg_temp.v3(),'{cards,0,rules,0,rateBps}','-1'))$q$,
  '23514',null,'draft constraint rejects an invalid v3 catalog');
select lives_ok($q$insert into catalog_private.drafts(catalog) values(pg_temp.v3('test-v3.direct'))$q$,
  'draft constraint accepts a valid v3 catalog');

-- Limits raised with schema 3: draft source references and captured source text.
select throws_ok($q$insert into catalog_private.drafts(catalog,source_document_ids)
  values(pg_temp.v3('test-v3.many'),array(select gen_random_uuid() from generate_series(1,601)))$q$,
  '23514',null,'a draft cannot reference more than 600 captures');
select lives_ok($q$insert into catalog_private.drafts(catalog,source_document_ids)
  values(pg_temp.v3('test-v3.most'),array(select gen_random_uuid() from generate_series(1,600)))$q$,
  'a draft can reference 600 captures');

select set_config('request.jwt.claims','{"sub":"83000000-0000-4000-8000-000000000001","session_id":"84000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($q$select public.capture_catalog_source('test-longest','Longest terms','https://issuer.example/longest',
  (now() at time zone 'UTC')::date,repeat('x',250000))$q$,'a 250,000-character capture fits');
select set_config('test.terms',public.capture_catalog_source('test-terms','Synthetic v3 terms','https://issuer.example/v3',
  (now() at time zone 'UTC')::date,'Synthetic v3 terms for tests only.')->>'id',true);
-- 31 captures (the old limit was 30) save through the reviewer RPC.
select set_config('test.extra',(select jsonb_agg(public.capture_catalog_source('test-extra-'||i,'Extra '||i,
  'https://issuer.example/extra/'||i,(now() at time zone 'UTC')::date,'Extra capture '||i)->>'id')
  from generate_series(1,30) i)::text,true);
select lives_ok($q$select public.save_catalog_draft(null,null,pg_temp.v3('test-v3.wide'),
  array[current_setting('test.terms')::uuid]||array(select jsonb_array_elements_text(current_setting('test.extra')::jsonb)::uuid),
  (select release_sequence from public.catalog_head))$q$,'a draft saves with 31 source references');

-- A reviewer publishes a v3 draft through the normal transaction.
select set_config('test.draft',public.save_catalog_draft(null,null,pg_temp.v3(),
  array[current_setting('test.terms')::uuid],(select release_sequence from public.catalog_head))::text,true);
select set_config('test.release',public.publish_catalog((current_setting('test.draft')::jsonb->>'id')::uuid,1,
  current_setting('test.draft')::jsonb->>'catalog_hash',(select release_sequence from public.catalog_head),
  'Reviewed synthetic v3 terms.')::text,true);
select is(current_setting('test.release')::jsonb#>>'{catalog,schemaVersion}','3','published release is schema 3');
select is((select release_sequence from public.catalog_head),(current_setting('test.release')::jsonb->>'sequence')::bigint,
  'head points to the v3 release');
reset role;
set local role anon;
select is((select r.catalog->>'version' from public.catalog_head h join public.catalog_releases r on r.sequence=h.release_sequence),
  'test-v3.1','anonymous readers see the published v3 catalog');
reset role;

select * from finish();
rollback;
