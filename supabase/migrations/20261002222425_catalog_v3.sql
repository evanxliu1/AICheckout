-- Catalog schema 3 (decision wiki/decisions/2026-10-02-catalog-v3-schema.md): reward programs with
-- point values, brands, gates, merchant brand scope, closed-loop cards, chosen and automatic
-- categories, rule start dates, required payment paths and Venmo, and larger limits (300 cards,
-- 600 sources, 100 merchants, 400 brands, 100 programs, 100 gates, 30 rules per card, 1 MiB).
-- Mirrors catalogV3Schema in packages/rewards-core/src/schema.ts; scripts/test-catalog-parity.mjs
-- runs the same cases against both. Schemas 1 and 2 stay valid for existing releases and drafts.
-- Also raises draft source references to 600 and captured source text to 250,000 characters.

-- Category lists live in their own functions so a later migration can extend them with
-- `create or replace` without restating the validator. Mirrors REWARD_CATEGORIES_V3 and
-- MERCHANT_CATEGORIES_V3 in packages/rewards-core/src/types.ts; the parity script compares them.
create function catalog_private.catalog_v3_reward_categories()
returns text[] language sql immutable security invoker set search_path = '' as $$
  select array['all-purchases','online-retail','supermarkets','gas','ev-charging','dining','drugstores',
    'entertainment','streaming','transit','travel-portal','entertainment-portal','other',
    'electronics','department-stores','home-improvement','wholesale-clubs'];
$$;
create function catalog_private.catalog_v3_merchant_categories()
returns text[] language sql immutable security invoker set search_path = '' as $$
  select array['electronics','general-merchandise','supermarkets','gas','ev-charging','dining','drugstores',
    'entertainment','streaming','transit','department-stores','home-improvement','wholesale-clubs'];
$$;

-- A rule with no condition of any kind (isUnconditionalRuleV3 in schema.ts).
create function catalog_private.catalog_v3_unconditional_rule(rule jsonb)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select rule#>>'{cap,kind}' <> 'spend' and rule->>'activation' not in ('enroll-once', 'recurring')
    and jsonb_typeof(rule->'limitedTime') = 'null' and jsonb_array_length(rule->'excludedPaymentPaths') = 0
    and jsonb_array_length(rule->'brandIds') = 0 and jsonb_typeof(rule->'choice') = 'null'
    and jsonb_array_length(rule->'requires') = 0 and jsonb_array_length(rule->'requiredPaymentPaths') = 0;
$$;

create function catalog_private.valid_catalog_v3(payload jsonb)
returns boolean language plpgsql stable security invoker set search_path = '' set timezone = 'UTC' as $$
declare
  card jsonb;
  rule jsonb;
  choice jsonb;
  requirement jsonb;
  program jsonb;
  merchant jsonb;
  base jsonb;
  base_count integer;
  source_ids text[];
  brand_ids text[];
  program_ids text[];
  verified_on date;
  expires_on date;
begin
  if payload is null or octet_length(payload::text) > 1048576 or not extensions.jsonb_matches_schema(
  '{
    "type":"object","additionalProperties":false,
    "required":["schemaVersion","version","verifiedAt","expiresAt","programs","brands","gates","merchants","sources","cards"],
    "properties":{
      "schemaVersion":{"const":3},
      "version":{"type":"string","minLength":1,"maxLength":80,"pattern":"^[a-zA-Z0-9][a-zA-Z0-9._-]*$"},
      "verifiedAt":{"type":"string","format":"date-time","pattern":"Z$"},
      "expiresAt":{"type":"string","format":"date-time","pattern":"Z$"},
      "programs":{"type":"array","minItems":1,"maxItems":100,"items":{
        "type":"object","additionalProperties":false,
        "required":["id","name","currency","unitName","valuation","redemptionBrandIds"],
        "properties":{
          "id":{"$ref":"#/$defs/id"},"name":{"type":"string","minLength":1,"maxLength":120},
          "currency":{"enum":["cash-back","points"]},
          "unitName":{"type":"string","minLength":1,"maxLength":60},
          "valuation":{"oneOf":[
            {"type":"object","additionalProperties":false,"required":["basis","valueHundredthsOfCent"],
             "properties":{"basis":{"const":"cash"},"valueHundredthsOfCent":{"const":100}}},
            {"type":"object","additionalProperties":false,
             "required":["basis","valueHundredthsOfCent","publisher","url","retrievedOn"],
             "properties":{"basis":{"const":"published-estimate"},"valueHundredthsOfCent":{"$ref":"#/$defs/value"},
               "publisher":{"type":"string","minLength":1,"maxLength":120},"url":{"$ref":"#/$defs/url"},
               "retrievedOn":{"$ref":"#/$defs/date"}}},
            {"type":"object","additionalProperties":false,"required":["basis","valueHundredthsOfCent","sourceIds"],
             "properties":{"basis":{"const":"issuer-stated"},"valueHundredthsOfCent":{"$ref":"#/$defs/value"},
               "sourceIds":{"allOf":[{"$ref":"#/$defs/sourceIds"},{"minItems":1}]}}},
            {"type":"object","additionalProperties":false,"required":["basis"],"properties":{"basis":{"const":"none"}}}
          ]},
          "redemptionBrandIds":{"$ref":"#/$defs/brandIds"}
        }
      }},
      "brands":{"type":"array","maxItems":400,"items":{
        "type":"object","additionalProperties":false,"required":["id","name"],
        "properties":{"id":{"$ref":"#/$defs/id"},"name":{"type":"string","minLength":1,"maxLength":120}}
      }},
      "gates":{"type":"array","maxItems":100,"items":{
        "type":"object","additionalProperties":false,"required":["id","question","options"],
        "properties":{
          "id":{"$ref":"#/$defs/id"},"question":{"type":"string","minLength":1,"maxLength":200},
          "options":{"type":"array","minItems":2,"maxItems":10,"items":{"$ref":"#/$defs/option"}}
        }
      }},
      "merchants":{"type":"array","minItems":1,"maxItems":100,"items":{
        "type":"object","additionalProperties":false,
        "required":["id","name","onlineRetail","physicalGoods","usMerchant","expectedCategory","mcc","notes","brandIds"],
        "properties":{
          "id":{"$ref":"#/$defs/id"},"name":{"type":"string","minLength":1,"maxLength":120},
          "onlineRetail":{"type":"boolean"},"physicalGoods":{"type":"boolean"},"usMerchant":{"type":"boolean"},
          "expectedCategory":{"type":"string"},
          "mcc":{"type":"object","additionalProperties":false,"required":["code","confidence","sourceIds"],
            "properties":{
              "code":{"type":["string","null"],"pattern":"^[0-9]{4}$"},
              "confidence":{"enum":["low","medium","high"]},
              "sourceIds":{"$ref":"#/$defs/sourceIds"}
            }},
          "notes":{"type":"string","maxLength":1000},
          "brandIds":{"$ref":"#/$defs/brandIds"}
        }
      }},
      "sources":{"type":"array","minItems":1,"maxItems":600,"items":{
        "type":"object","additionalProperties":false,"required":["id","title","url","checkedOn"],
        "properties":{
          "id":{"$ref":"#/$defs/id"},"title":{"type":"string","minLength":1,"maxLength":200},
          "url":{"$ref":"#/$defs/url"},"checkedOn":{"$ref":"#/$defs/date"}
        }
      }},
      "cards":{"type":"array","minItems":1,"maxItems":300,"items":{
        "type":"object","additionalProperties":false,
        "required":["id","name","shortName","issuer","programId","statedValueHundredthsOfCent","acceptance","choices",
          "rules","exclusions"],
        "properties":{
          "id":{"$ref":"#/$defs/id"},"name":{"type":"string","minLength":1,"maxLength":120},
          "shortName":{"type":"string","minLength":1,"maxLength":60},
          "issuer":{"type":"string","minLength":1,"maxLength":80},
          "programId":{"$ref":"#/$defs/id"},
          "statedValueHundredthsOfCent":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/value"}]},
          "acceptance":{"oneOf":[
            {"type":"object","additionalProperties":false,"required":["kind"],"properties":{"kind":{"const":"open-loop"}}},
            {"type":"object","additionalProperties":false,"required":["kind","brandIds"],
             "properties":{"kind":{"const":"closed-loop"},"brandIds":{"allOf":[{"$ref":"#/$defs/brandIds"},{"minItems":1}]}}}
          ]},
          "choices":{"type":"array","maxItems":5,"items":{
            "type":"object","additionalProperties":false,"required":["id","kind","label","picks","options","defaultOptionIds"],
            "properties":{
              "id":{"$ref":"#/$defs/id"},"kind":{"enum":["chosen","automatic"]},
              "label":{"type":"string","minLength":1,"maxLength":200},
              "picks":{"type":"integer","minimum":1,"maximum":5},
              "options":{"type":"array","minItems":2,"maxItems":30,"items":{"$ref":"#/$defs/option"}},
              "defaultOptionIds":{"type":"array","maxItems":5,"uniqueItems":true,"items":{"$ref":"#/$defs/id"}}
            }
          }},
          "exclusions":{"type":"array","maxItems":20,"items":{"type":"string","minLength":1,"maxLength":600}},
          "rules":{"type":"array","minItems":1,"maxItems":30,"items":{
            "type":"object","additionalProperties":false,
            "required":["id","category","issuerWording","rateBps","paidOnPaymentBps","cap","activation",
              "usMerchantsOnly","excludedPaymentPaths","limitedTime","sourceIds","brandIds","choice","requires",
              "requiredPaymentPaths"],
            "properties":{
              "id":{"$ref":"#/$defs/id"},
              "category":{"type":"string"},
              "issuerWording":{"type":"string","minLength":1,"maxLength":200},
              "rateBps":{"$ref":"#/$defs/bps"},"paidOnPaymentBps":{"$ref":"#/$defs/bps"},
              "cap":{"oneOf":[
                {"type":"object","additionalProperties":false,"required":["kind"],"properties":{"kind":{"const":"none"}}},
                {"type":"object","additionalProperties":false,"required":["kind"],"properties":{"kind":{"const":"unstated"}}},
                {"type":"object","additionalProperties":false,"required":["kind","amountCents","period","rateAfterCapBps"],
                 "properties":{"kind":{"const":"spend"},
                   "amountCents":{"type":"integer","minimum":1,"maximum":10000000},
                   "period":{"enum":["calendar-year","cardmember-year","billing-cycle","quarter","month","year-unspecified"]},
                   "rateAfterCapBps":{"$ref":"#/$defs/bps"}}}
              ]},
              "activation":{"enum":["none","enroll-once","recurring","unstated"]},
              "usMerchantsOnly":{"type":"boolean"},
              "excludedPaymentPaths":{"type":"array","maxItems":4,"uniqueItems":true,
                "items":{"enum":["paypal","venmo","digital-wallet","bnpl"]}},
              "limitedTime":{"oneOf":[{"type":"null"},{"type":"object","additionalProperties":false,
                "required":["startsOn","endsOn"],
                "properties":{"startsOn":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/date"}]},
                  "endsOn":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/date"}]}}}]},
              "sourceIds":{"allOf":[{"$ref":"#/$defs/sourceIds"},{"minItems":1}]},
              "brandIds":{"$ref":"#/$defs/brandIds"},
              "choice":{"oneOf":[{"type":"null"},{"type":"object","additionalProperties":false,
                "required":["choiceId","optionId"],
                "properties":{"choiceId":{"$ref":"#/$defs/id"},"optionId":{"$ref":"#/$defs/id"}}}]},
              "requires":{"type":"array","maxItems":5,"items":{"type":"object","additionalProperties":false,
                "required":["gateId","optionIds"],
                "properties":{"gateId":{"$ref":"#/$defs/id"},
                  "optionIds":{"type":"array","minItems":1,"maxItems":10,"uniqueItems":true,"items":{"$ref":"#/$defs/id"}}}}},
              "requiredPaymentPaths":{"type":"array","maxItems":5,"uniqueItems":true,
                "items":{"enum":["card","paypal","venmo","digital-wallet","bnpl"]}}
            }
          }}
        }
      }}
    },
    "$defs":{
      "id":{"type":"string","minLength":1,"maxLength":80,"pattern":"^[a-z0-9][a-z0-9-]*$"},
      "bps":{"type":"integer","minimum":0,"maximum":10000},
      "value":{"type":"integer","minimum":1,"maximum":10000},
      "date":{"type":"string","format":"date","pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
      "url":{"type":"string","format":"uri","pattern":"^https://[^\\s]+$","maxLength":2048},
      "option":{"type":"object","additionalProperties":false,"required":["id","label"],
        "properties":{"id":{"$ref":"#/$defs/id"},"label":{"type":"string","minLength":1,"maxLength":120}}},
      "sourceIds":{"type":"array","maxItems":10,"uniqueItems":true,"items":{"$ref":"#/$defs/id"}},
      "brandIds":{"type":"array","maxItems":20,"uniqueItems":true,"items":{"$ref":"#/$defs/id"}}
    }
  }'::json, payload) then return false; end if;

  -- Validity window, source dates and URLs without credentials (shared with schemas 1 and 2).
  verified_on := ((payload->>'verifiedAt')::timestamptz at time zone 'UTC')::date;
  expires_on := ((payload->>'expiresAt')::timestamptz at time zone 'UTC')::date;
  if exists(select 1 from jsonb_array_elements(payload->'sources') s where s->>'url' ~ '^https://[^/?#]*@')
     or exists(select 1 from jsonb_array_elements(payload->'programs') p
               where p#>>'{valuation,url}' ~ '^https://[^/?#]*@')
     or (payload->>'expiresAt')::timestamptz <= (payload->>'verifiedAt')::timestamptz
     or (payload->>'expiresAt')::timestamptz > (payload->>'verifiedAt')::timestamptz + interval '30 days'
     or exists (select 1 from jsonb_array_elements(payload->'sources') s
                where (s->>'checkedOn')::date > verified_on or (s->>'checkedOn')::date < verified_on - 30)
  then return false; end if;
  -- Calendar-invalid rule dates raise here and return false below.
  perform (r#>>'{limitedTime,startsOn}')::date, (r#>>'{limitedTime,endsOn}')::date
    from jsonb_array_elements(payload->'cards') c, jsonb_array_elements(c->'rules') r
    where jsonb_typeof(r->'limitedTime') = 'object';

  -- Unique IDs: sources, programs, brands, gates, merchants, cards, and rules across all cards.
  select array_agg(s->>'id') into source_ids from jsonb_array_elements(payload->'sources') s;
  select coalesce(array_agg(b->>'id'), '{}') into brand_ids from jsonb_array_elements(payload->'brands') b;
  select array_agg(p->>'id') into program_ids from jsonb_array_elements(payload->'programs') p;
  if cardinality(source_ids) <> (select count(distinct x) from unnest(source_ids) x)
     or cardinality(brand_ids) <> (select count(distinct x) from unnest(brand_ids) x)
     or cardinality(program_ids) <> (select count(distinct x) from unnest(program_ids) x)
     or (select count(*) <> count(distinct g->>'id') from jsonb_array_elements(payload->'gates') g)
     or (select count(*) <> count(distinct m->>'id') from jsonb_array_elements(payload->'merchants') m)
     or (select count(*) <> count(distinct c->>'id') from jsonb_array_elements(payload->'cards') c)
     or (select count(*) <> count(distinct r->>'id') from jsonb_array_elements(payload->'cards') c,
                jsonb_array_elements(c->'rules') r)
  then return false; end if;

  -- Gates: option IDs unique within each gate.
  if exists(select 1 from jsonb_array_elements(payload->'gates') g
            where (select count(*) <> count(distinct o->>'id') from jsonb_array_elements(g->'options') o))
  then return false; end if;

  -- Programs: cash back (and only cash back) is valued as cash; references resolve; estimates are
  -- read within 30 days before verification and no later than the expiry date.
  for program in select value from jsonb_array_elements(payload->'programs') loop
    if (program->>'currency' = 'cash-back') <> (program#>>'{valuation,basis}' = 'cash')
       or exists(select 1 from jsonb_array_elements_text(program->'redemptionBrandIds') id where id <> all(brand_ids))
       or (program#>>'{valuation,basis}' = 'issuer-stated' and exists(
             select 1 from jsonb_array_elements_text(program#>'{valuation,sourceIds}') id where id <> all(source_ids)))
       or (program#>>'{valuation,basis}' = 'published-estimate' and (
             (program#>>'{valuation,retrievedOn}')::date < verified_on - 30
             or (program#>>'{valuation,retrievedOn}')::date > expires_on))
    then return false; end if;
  end loop;

  for merchant in select value from jsonb_array_elements(payload->'merchants') loop
    if merchant->>'expectedCategory' <> all(catalog_private.catalog_v3_merchant_categories())
       or exists(select 1 from jsonb_array_elements_text(merchant->'brandIds') id where id <> all(brand_ids))
       or exists(select 1 from jsonb_array_elements_text(merchant#>'{mcc,sourceIds}') id where id <> all(source_ids))
       or (jsonb_typeof(merchant#>'{mcc,code}') = 'string' and jsonb_array_length(merchant#>'{mcc,sourceIds}') = 0)
       or (jsonb_typeof(merchant#>'{mcc,code}') = 'null' and merchant#>>'{mcc,confidence}' <> 'low')
    then return false; end if;
  end loop;

  for card in select value from jsonb_array_elements(payload->'cards') loop
    -- Program, issuer-stated value (points programs only) and closed-loop brands.
    program := null;
    select value into program from jsonb_array_elements(payload->'programs') where value->>'id' = card->>'programId';
    if program is null
       or (jsonb_typeof(card->'statedValueHundredthsOfCent') = 'number' and program->>'currency' <> 'points')
       or exists(select 1 from jsonb_array_elements_text(card#>'{acceptance,brandIds}') id where id <> all(brand_ids))
    then return false; end if;
    -- Choices: unique IDs; unique options; fewer picks than options; defaults are options, no more
    -- than picks, and absent for automatic choices.
    if (select count(*) <> count(distinct c->>'id') from jsonb_array_elements(card->'choices') c) then return false; end if;
    for choice in select value from jsonb_array_elements(card->'choices') loop
      if (select count(*) <> count(distinct o->>'id') from jsonb_array_elements(choice->'options') o)
         or (choice->>'picks')::integer >= jsonb_array_length(choice->'options')
         or jsonb_array_length(choice->'defaultOptionIds') > (choice->>'picks')::integer
         or (choice->>'kind' = 'automatic' and jsonb_array_length(choice->'defaultOptionIds') > 0)
         or exists(select 1 from jsonb_array_elements_text(choice->'defaultOptionIds') id
                   where not exists(select 1 from jsonb_array_elements(choice->'options') o where o->>'id' = id))
      then return false; end if;
    end loop;
    -- Base: exactly one unconditional all-purchases rule on an open-loop card, at most one on a
    -- closed-loop card.
    select count(*) into base_count from jsonb_array_elements(card->'rules') r
      where r->>'category' = 'all-purchases' and catalog_private.catalog_v3_unconditional_rule(r);
    if (card#>>'{acceptance,kind}' = 'open-loop' and base_count <> 1) or base_count > 1 then return false; end if;
    base := null;
    select value into base from jsonb_array_elements(card->'rules')
      where value->>'category' = 'all-purchases' and catalog_private.catalog_v3_unconditional_rule(value);
    for rule in select value from jsonb_array_elements(card->'rules') loop
      if rule->>'category' <> all(catalog_private.catalog_v3_reward_categories())
         or (base is not null and (rule->>'rateBps')::integer < (base->>'rateBps')::integer)
         or (rule->>'paidOnPaymentBps')::integer > (rule->>'rateBps')::integer
         or (rule#>>'{cap,kind}' = 'spend' and ((rule#>>'{cap,rateAfterCapBps}')::integer > (rule->>'rateBps')::integer
             or (base is not null and (rule#>>'{cap,rateAfterCapBps}')::integer < (base->>'rateBps')::integer)))
         or exists(select 1 from jsonb_array_elements_text(rule->'sourceIds') id where id <> all(source_ids))
         or exists(select 1 from jsonb_array_elements_text(rule->'brandIds') id where id <> all(brand_ids))
         or (jsonb_typeof(rule#>'{limitedTime,startsOn}') = 'string' and jsonb_typeof(rule#>'{limitedTime,endsOn}') = 'string'
             and (rule#>>'{limitedTime,startsOn}')::date > (rule#>>'{limitedTime,endsOn}')::date)
         or (jsonb_typeof(rule->'choice') = 'object' and not exists(
               select 1 from jsonb_array_elements(card->'choices') c, jsonb_array_elements(c->'options') o
               where c->>'id' = rule#>>'{choice,choiceId}' and o->>'id' = rule#>>'{choice,optionId}'))
         or (select count(*) <> count(distinct q->>'gateId') from jsonb_array_elements(rule->'requires') q)
         or exists(select 1 from jsonb_array_elements_text(rule->'requiredPaymentPaths') p
                   where p in (select jsonb_array_elements_text(rule->'excludedPaymentPaths')))
      then return false; end if;
      -- Requirements: a known gate and some, not all, of its options.
      for requirement in select value from jsonb_array_elements(rule->'requires') loop
        if not exists(
             select 1 from jsonb_array_elements(payload->'gates') g
             where g->>'id' = requirement->>'gateId'
               and jsonb_array_length(requirement->'optionIds') < jsonb_array_length(g->'options')
               and not exists(select 1 from jsonb_array_elements_text(requirement->'optionIds') id
                              where not exists(select 1 from jsonb_array_elements(g->'options') o where o->>'id' = id)))
        then return false; end if;
      end loop;
    end loop;
  end loop;
  return true;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then return false;
end;
$$;

-- The single entry point for stored catalogs: schema 1, 2 or 3, keyed by schemaVersion. Table
-- CHECKs call it by name, so replacing it covers catalog_releases and drafts.
create or replace function catalog_private.valid_catalog(payload jsonb)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case payload->'schemaVersion'
    when '1'::jsonb then catalog_private.valid_catalog_v1(payload)
    when '2'::jsonb then catalog_private.valid_catalog_v2(payload)
    when '3'::jsonb then catalog_private.valid_catalog_v3(payload)
    else false end;
$$;
comment on function catalog_private.valid_catalog(jsonb) is
  'Catalog schema 1, 2 or 3. Mirrors catalogSchema in packages/rewards-core; parity is tested by scripts/test-catalog-parity.mjs.';

revoke all on function catalog_private.valid_catalog_v3(jsonb), catalog_private.catalog_v3_reward_categories(),
  catalog_private.catalog_v3_merchant_categories(), catalog_private.catalog_v3_unconditional_rule(jsonb)
  from public, anon, authenticated, service_role;

-- A 180-card catalog cites about 340 sources; a draft may reference up to 600 captures.
alter table catalog_private.drafts drop constraint drafts_source_document_ids_check,
  add constraint drafts_source_document_ids_check check (cardinality(source_document_ids) <= 600);

-- Captured source text may be up to 250,000 characters (was 120,000); the largest expansion
-- capture is 204,334. Mirrors MAX_SOURCE_BODY_CHARS in packages/catalog-review. Replacing the
-- CHECK re-validates existing rows, which all fit.
alter table catalog_private.source_documents
  drop constraint source_documents_body_check,
  add constraint source_documents_body_check check (char_length(body) between 1 and 250000);

-- Same function as in 20260926033105_catalog_review_operations, with the source reference limit
-- raised from 30 to 600 to match the drafts constraint. Replacing keeps its grants.
create or replace function catalog_private.save_catalog_draft(
  p_id uuid, p_expected_revision integer, p_catalog jsonb, p_source_document_ids uuid[], p_base_sequence bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := catalog_private.require_reviewer();
  draft catalog_private.drafts%rowtype;
begin
  if p_source_document_ids is null or cardinality(p_source_document_ids) > 600
     or (select count(distinct id) from unnest(p_source_document_ids) id) <> cardinality(p_source_document_ids)
     or exists(select 1 from unnest(p_source_document_ids) requested(id) where not exists (
       select 1 from catalog_private.source_documents s where s.id=requested.id
     )) then raise exception 'Invalid source document references' using errcode='22023'; end if;
  if p_id is null then
    if p_expected_revision is not null then raise exception 'New draft has no previous revision' using errcode='22023'; end if;
    insert into catalog_private.drafts(catalog,source_document_ids,base_sequence,created_by)
      values(p_catalog,p_source_document_ids,p_base_sequence,actor) returning * into draft;
  else
    select * into draft from catalog_private.drafts where id=p_id for update;
    if not found then raise exception 'Draft not found' using errcode='P0002'; end if;
    if draft.revision is distinct from p_expected_revision then
      raise exception 'Draft changed; review it again' using errcode='40001';
    end if;
    if draft.status <> 'draft' then raise exception 'Draft is immutable after review' using errcode='22023'; end if;
    update catalog_private.drafts set catalog=p_catalog,source_document_ids=p_source_document_ids,
      base_sequence=p_base_sequence,revision=revision+1,updated_at=clock_timestamp()
      where id=p_id returning * into draft;
  end if;
  return to_jsonb(draft);
end;
$$;
