-- Catalog schema 2: reviewed values the rewards engine computes with (merchant profiles, every earning
-- rule kind, caps with an after-cap rate, paid-on-payment portions). Mirrors catalogV2Schema in
-- packages/rewards-core/src/schema.ts; scripts/test-catalog-parity.mjs runs the same cases against both.
-- Schema 1 stays valid for existing releases and drafts.
create function catalog_private.valid_catalog_v2(payload jsonb)
returns boolean language plpgsql stable security invoker set search_path = '' set timezone = 'UTC' as $$
declare
  card jsonb;
  rule jsonb;
  merchant jsonb;
  base jsonb;
  source_ids text[];
  verified_on date;
begin
  if payload is null or octet_length(payload::text) > 262144 or not extensions.jsonb_matches_schema(
  '{
    "type":"object","additionalProperties":false,
    "required":["schemaVersion","version","verifiedAt","expiresAt","merchants","sources","cards"],
    "properties":{
      "schemaVersion":{"const":2},
      "version":{"type":"string","minLength":1,"maxLength":80,"pattern":"^[a-zA-Z0-9][a-zA-Z0-9._-]*$"},
      "verifiedAt":{"type":"string","format":"date-time","pattern":"Z$"},
      "expiresAt":{"type":"string","format":"date-time","pattern":"Z$"},
      "merchants":{"type":"array","minItems":1,"maxItems":20,"items":{
        "type":"object","additionalProperties":false,
        "required":["id","name","onlineRetail","physicalGoods","usMerchant","expectedCategory","mcc","notes"],
        "properties":{
          "id":{"$ref":"#/$defs/id"},"name":{"type":"string","minLength":1,"maxLength":120},
          "onlineRetail":{"type":"boolean"},"physicalGoods":{"type":"boolean"},"usMerchant":{"type":"boolean"},
          "expectedCategory":{"enum":["electronics","general-merchandise","supermarkets","gas","ev-charging",
            "dining","drugstores","entertainment","streaming","transit"]},
          "mcc":{"type":"object","additionalProperties":false,"required":["code","confidence","sourceIds"],
            "properties":{
              "code":{"type":["string","null"],"pattern":"^[0-9]{4}$"},
              "confidence":{"enum":["low","medium","high"]},
              "sourceIds":{"$ref":"#/$defs/sourceIds"}
            }},
          "notes":{"type":"string","maxLength":1000}
        }
      }},
      "sources":{"type":"array","minItems":1,"maxItems":30,"items":{
        "type":"object","additionalProperties":false,"required":["id","title","url","checkedOn"],
        "properties":{
          "id":{"$ref":"#/$defs/id"},"title":{"type":"string","minLength":1,"maxLength":200},
          "url":{"type":"string","format":"uri","pattern":"^https://[^\\s]+$","maxLength":2048},
          "checkedOn":{"$ref":"#/$defs/date"}
        }
      }},
      "cards":{"type":"array","minItems":1,"maxItems":30,"items":{
        "type":"object","additionalProperties":false,
        "required":["id","name","shortName","issuer","rewardCurrency","pointValueHundredthsOfCent","rules","exclusions"],
        "properties":{
          "id":{"$ref":"#/$defs/id"},"name":{"type":"string","minLength":1,"maxLength":120},
          "shortName":{"type":"string","minLength":1,"maxLength":60},
          "issuer":{"type":"string","minLength":1,"maxLength":80},
          "rewardCurrency":{"enum":["cash-back","points"]},
          "pointValueHundredthsOfCent":{"type":["integer","null"],"minimum":1,"maximum":10000},
          "exclusions":{"type":"array","maxItems":20,"items":{"type":"string","minLength":1,"maxLength":600}},
          "rules":{"type":"array","minItems":1,"maxItems":20,"items":{
            "type":"object","additionalProperties":false,
            "required":["id","category","issuerWording","rateBps","paidOnPaymentBps","cap","activation",
              "usMerchantsOnly","excludedPaymentPaths","limitedTime","sourceIds"],
            "properties":{
              "id":{"$ref":"#/$defs/id"},
              "category":{"enum":["all-purchases","online-retail","supermarkets","gas","ev-charging","dining",
                "drugstores","entertainment","streaming","transit","travel-portal","entertainment-portal","other"]},
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
              "excludedPaymentPaths":{"type":"array","maxItems":3,"uniqueItems":true,
                "items":{"enum":["paypal","digital-wallet","bnpl"]}},
              "limitedTime":{"oneOf":[{"type":"null"},{"type":"object","additionalProperties":false,"required":["endsOn"],
                "properties":{"endsOn":{"oneOf":[{"type":"null"},{"$ref":"#/$defs/date"}]}}}]},
              "sourceIds":{"allOf":[{"$ref":"#/$defs/sourceIds"},{"minItems":1}]}
            }
          }}
        }
      }}
    },
    "$defs":{
      "id":{"type":"string","minLength":1,"maxLength":80,"pattern":"^[a-z0-9][a-z0-9-]*$"},
      "bps":{"type":"integer","minimum":0,"maximum":10000},
      "date":{"type":"string","format":"date","pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
      "sourceIds":{"type":"array","maxItems":10,"uniqueItems":true,"items":{"$ref":"#/$defs/id"}}
    }
  }'::json, payload) then return false; end if;

  -- Validity window and source dates (shared with schema 1).
  verified_on := ((payload->>'verifiedAt')::timestamptz at time zone 'UTC')::date;
  if exists(select 1 from jsonb_array_elements(payload->'sources') s where s->>'url' ~ '^https://[^/?#]*@')
     or (payload->>'expiresAt')::timestamptz <= (payload->>'verifiedAt')::timestamptz
     or (payload->>'expiresAt')::timestamptz > (payload->>'verifiedAt')::timestamptz + interval '30 days'
     or exists (select 1 from jsonb_array_elements(payload->'sources') s
                where (s->>'checkedOn')::date > verified_on or (s->>'checkedOn')::date < verified_on - 30)
  then return false; end if;
  -- Calendar-invalid limited-time dates raise here and return false below.
  perform (r#>>'{limitedTime,endsOn}')::date from jsonb_array_elements(payload->'cards') c,
    jsonb_array_elements(c->'rules') r where jsonb_typeof(r#>'{limitedTime,endsOn}') = 'string';

  select array_agg(s->>'id') into source_ids from jsonb_array_elements(payload->'sources') s;
  if cardinality(source_ids) <> (select count(distinct x) from unnest(source_ids) x)
     or (select count(*) <> count(distinct m->>'id') from jsonb_array_elements(payload->'merchants') m)
     or (select count(*) <> count(distinct c->>'id') from jsonb_array_elements(payload->'cards') c)
     or (select count(*) <> count(distinct r->>'id') from jsonb_array_elements(payload->'cards') c,
                jsonb_array_elements(c->'rules') r)
  then return false; end if;

  for merchant in select value from jsonb_array_elements(payload->'merchants') loop
    if exists(select 1 from jsonb_array_elements_text(merchant#>'{mcc,sourceIds}') id where id <> all(source_ids))
       or (jsonb_typeof(merchant#>'{mcc,code}') = 'string' and jsonb_array_length(merchant#>'{mcc,sourceIds}') = 0)
       or (jsonb_typeof(merchant#>'{mcc,code}') = 'null' and merchant#>>'{mcc,confidence}' <> 'low')
    then return false; end if;
  end loop;

  for card in select value from jsonb_array_elements(payload->'cards') loop
    if (card->>'rewardCurrency' = 'points') <> (jsonb_typeof(card->'pointValueHundredthsOfCent') = 'number')
       or (select count(*) from jsonb_array_elements(card->'rules') r where r->>'category' = 'all-purchases') <> 1
    then return false; end if;
    select value into base from jsonb_array_elements(card->'rules') where value->>'category' = 'all-purchases';
    if base#>>'{cap,kind}' = 'spend' or base->>'activation' in ('enroll-once', 'recurring')
       or jsonb_typeof(base->'limitedTime') <> 'null' or jsonb_array_length(base->'excludedPaymentPaths') > 0
    then return false; end if;
    for rule in select value from jsonb_array_elements(card->'rules') loop
      if (rule->>'rateBps')::integer < (base->>'rateBps')::integer
         or (rule->>'paidOnPaymentBps')::integer > (rule->>'rateBps')::integer
         or (rule#>>'{cap,kind}' = 'spend' and ((rule#>>'{cap,rateAfterCapBps}')::integer > (rule->>'rateBps')::integer
             or (rule#>>'{cap,rateAfterCapBps}')::integer < (base->>'rateBps')::integer))
         or exists(select 1 from jsonb_array_elements_text(rule->'sourceIds') id where id <> all(source_ids))
      then return false; end if;
    end loop;
  end loop;
  return true;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then return false;
end;
$$;

-- The single entry point for stored catalogs: schema 1 or schema 2, keyed by schemaVersion.
create function catalog_private.valid_catalog(payload jsonb)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case payload->'schemaVersion'
    when '1'::jsonb then catalog_private.valid_catalog_v1(payload)
    when '2'::jsonb then catalog_private.valid_catalog_v2(payload)
    else false end;
$$;

revoke all on function catalog_private.valid_catalog_v2(jsonb), catalog_private.valid_catalog(jsonb)
  from public, anon, authenticated, service_role;

-- Replacing the CHECKs re-validates every existing row; v1 rows remain valid.
alter table public.catalog_releases drop constraint catalog_releases_catalog_check,
  add constraint catalog_releases_catalog_check check (catalog_private.valid_catalog(catalog));
alter table catalog_private.drafts drop constraint drafts_catalog_check,
  add constraint drafts_catalog_check check (catalog_private.valid_catalog(catalog));

comment on function catalog_private.valid_catalog(jsonb) is
  'Catalog schema 1 or 2. Mirrors catalogSchema in packages/rewards-core; parity is tested by scripts/test-catalog-parity.mjs.';
