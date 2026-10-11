-- Merchant release schema 1, the `mcc` evidence basis (Phase 14.8, wiki/decisions/2026-10-11-mcc-evidence-basis.md):
-- a record may rest on public card-transaction datasets that code the store under the category's merchant
-- category code. `valid_merchant_release_v1` is replaced whole (never edit an applied migration): the source kind
-- enum gains `mcc-dataset`, the basis enum gains `mcc`, and the evidence rule requires an `mcc` record to cite at
-- least one `mcc-dataset` source and to sit on a marketplace only for dining, as `definition` does. Everything
-- else is the 20261011111247 text unchanged. Mirrors merchantReleaseSchema in packages/rewards-core/src/
-- merchant-release.ts; scripts/test-catalog-parity.mjs runs the shared merchantReleaseCases against both.

create or replace function catalog_private.valid_merchant_release_v1(payload jsonb)
returns boolean language plpgsql stable security invoker set search_path = '' set timezone = 'UTC' as $$
declare
  merchant jsonb;
  source_ids text[];
  verified_on date;
  basis text;
  kinds text[];
begin
  if payload is null or octet_length(payload::text) > 2097152 or not extensions.jsonb_matches_schema(
  '{
    "type":"object","additionalProperties":false,
    "required":["schemaVersion","version","verifiedAt","sources","merchants"],
    "properties":{
      "schemaVersion":{"const":1},
      "version":{"type":"string","maxLength":80,"pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.[a-z0-9-]+\\.[0-9]+$"},
      "verifiedAt":{"type":"string","format":"date-time","pattern":"Z$"},
      "sources":{"type":"array","maxItems":10000,"items":{
        "type":"object","additionalProperties":false,"required":["id","url","kind","capturedAt","sha256"],
        "properties":{
          "id":{"$ref":"#/$defs/id"},
          "url":{"type":"string","format":"uri","pattern":"^https://[^\\s]+$","maxLength":2048},
          "kind":{"enum":["issuer-terms","store-page","mcc-lookup","mcc-dataset"]},
          "capturedAt":{"type":"string","format":"date","pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
          "sha256":{"type":"string","pattern":"^[a-f0-9]{64}$"}
        }
      }},
      "merchants":{"type":"array","minItems":1,"maxItems":5000,"items":{
        "type":"object","additionalProperties":false,
        "required":["id","name","hosts","kind","physicalGoods","category","evidence","brandIds","disabled"],
        "properties":{
          "id":{"$ref":"#/$defs/id"},
          "name":{"type":"string","minLength":1,"maxLength":60,"pattern":"^[A-Za-z0-9][A-Za-z0-9 &''.,+-]*$"},
          "hosts":{"type":"array","minItems":1,"maxItems":20,"uniqueItems":true,"items":{
            "type":"string","maxLength":253,
            "pattern":"^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z][a-z0-9-]{0,62}$"}},
          "kind":{"enum":["merchant","marketplace","processor"]},
          "physicalGoods":{"type":"boolean"},
          "category":{"type":"string"},
          "evidence":{"type":"object","additionalProperties":false,"required":["basis","sourceIds"],
            "properties":{
              "basis":{"enum":["issuer","mcc","corroborated","definition","default"]},
              "sourceIds":{"type":"array","maxItems":10,"uniqueItems":true,"items":{"$ref":"#/$defs/id"}}
            }},
          "brandIds":{"type":"array","maxItems":20,"uniqueItems":true,"items":{"$ref":"#/$defs/id"}},
          "disabled":{"type":"boolean"}
        }
      }}
    },
    "$defs":{"id":{"type":"string","minLength":1,"maxLength":80,"pattern":"^[a-z0-9][a-z0-9-]*$"}}
  }'::json, payload) then return false; end if;

  -- Source URLs without credentials; no source captured after the verification date (calendar-invalid
  -- dates raise and return false below).
  verified_on := ((payload->>'verifiedAt')::timestamptz at time zone 'UTC')::date;
  if exists(select 1 from jsonb_array_elements(payload->'sources') s
            where s->>'url' ~ '^https://[^/?#]*@' or (s->>'capturedAt')::date > verified_on)
  then return false; end if;

  -- Unique ids: sources, merchants, and hosts across every record.
  select coalesce(array_agg(s->>'id'), '{}') into source_ids from jsonb_array_elements(payload->'sources') s;
  if cardinality(source_ids) <> (select count(distinct x) from unnest(source_ids) x)
     or (select count(*) <> count(distinct m->>'id') from jsonb_array_elements(payload->'merchants') m)
     or (select count(*) <> count(distinct h) from jsonb_array_elements(payload->'merchants') m,
                jsonb_array_elements_text(m->'hosts') h)
  then return false; end if;

  for merchant in select value from jsonb_array_elements(payload->'merchants') loop
    basis := merchant#>>'{evidence,basis}';
    if merchant->>'category' <> all(catalog_private.catalog_v3_merchant_categories())
       or exists(select 1 from jsonb_array_elements_text(merchant#>'{evidence,sourceIds}') id where id <> all(source_ids))
    then return false; end if;
    select coalesce(array_agg(distinct s->>'kind'), '{}') into kinds from jsonb_array_elements(payload->'sources') s
      where s->>'id' in (select jsonb_array_elements_text(merchant#>'{evidence,sourceIds}'));
    -- The evidence rule: `default` cites nothing and is general merchandise; `issuer` cites issuer terms;
    -- `mcc` a public card-transaction dataset, on a marketplace only for dining; `corroborated` a store page
    -- and a merchant-code lookup; `definition` a store page and issuer terms, on a marketplace only for dining.
    if (basis = 'default' and (jsonb_array_length(merchant#>'{evidence,sourceIds}') > 0
                               or merchant->>'category' <> 'general-merchandise'))
       or (basis = 'issuer' and not kinds @> array['issuer-terms'])
       or (basis = 'mcc' and (not kinds @> array['mcc-dataset']
                              or (merchant->>'kind' = 'marketplace' and merchant->>'category' <> 'dining')))
       or (basis = 'corroborated' and not kinds @> array['store-page','mcc-lookup'])
       or (basis = 'definition' and (not kinds @> array['store-page','issuer-terms']
                                     or (merchant->>'kind' = 'marketplace' and merchant->>'category' <> 'dining')))
    then return false; end if;
    -- A processor sells no physical goods, has default evidence and no brands.
    if merchant->>'kind' = 'processor' and ((merchant->>'physicalGoods')::boolean or basis <> 'default'
                                            or jsonb_array_length(merchant->'brandIds') > 0)
    then return false; end if;
  end loop;

  -- Every source is cited by some record.
  if exists(select 1 from unnest(source_ids) id where not exists(
       select 1 from jsonb_array_elements(payload->'merchants') m
       where id in (select jsonb_array_elements_text(m#>'{evidence,sourceIds}'))))
  then return false; end if;
  return true;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then return false;
end;
$$;

revoke all on function catalog_private.valid_merchant_release_v1(jsonb) from public, anon, authenticated, service_role;
comment on function catalog_private.valid_merchant_release_v1(jsonb) is
  'Merchant release schema 1 with the mcc basis (2026-10-11). Mirrors merchantReleaseSchema in packages/rewards-core; parity is tested by scripts/test-catalog-parity.mjs.';
