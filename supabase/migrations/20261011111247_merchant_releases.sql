-- Hosted merchant releases (Phase 14.6, wiki/product/phase-14-merchant-database.md §4 and milestone 14.6):
-- immutable published merchant releases (schema `merchant-release.1`) and a head pointer, readable by anyone,
-- published by a reviewer through `publish_merchant_release`. No drafts, captures or review tables: the records
-- are built and reviewed in the repository and published whole from the CLI.
-- `valid_merchant_release_v1` mirrors merchantReleaseSchema in packages/rewards-core/src/merchant-release.ts;
-- scripts/test-catalog-parity.mjs runs the shared merchantReleaseCases against both.

create function catalog_private.valid_merchant_release_v1(payload jsonb)
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
          "kind":{"enum":["issuer-terms","store-page","mcc-lookup"]},
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
              "basis":{"enum":["issuer","corroborated","definition","default"]},
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
    -- `corroborated` a store page and a merchant-code lookup; `definition` a store page and issuer terms,
    -- on a marketplace only for dining.
    if (basis = 'default' and (jsonb_array_length(merchant#>'{evidence,sourceIds}') > 0
                               or merchant->>'category' <> 'general-merchandise'))
       or (basis = 'issuer' and not kinds @> array['issuer-terms'])
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

-- The entry point the table CHECK calls by name, keyed by schemaVersion, so a later schema can be added
-- with `create or replace` (as valid_catalog is for catalogs).
create function catalog_private.valid_merchant_release(payload jsonb)
returns boolean language sql stable security invoker set search_path = '' as $$
  select case payload->'schemaVersion'
    when '1'::jsonb then catalog_private.valid_merchant_release_v1(payload)
    else false end;
$$;
comment on function catalog_private.valid_merchant_release(jsonb) is
  'Merchant release schema 1. Mirrors merchantReleaseSchema in packages/rewards-core; parity is tested by scripts/test-catalog-parity.mjs.';

create table public.merchant_releases (
  sequence bigint generated always as identity primary key,
  release jsonb not null check (catalog_private.valid_merchant_release(release)),
  version text generated always as (release->>'version') stored unique,
  release_hash text generated always as (encode(extensions.digest(release::text, 'sha256'), 'hex')) stored,
  published_at timestamptz not null default now()
);
create table public.merchant_head (
  singleton boolean primary key default true check (singleton),
  release_sequence bigint references public.merchant_releases(sequence)
);
insert into public.merchant_head(singleton, release_sequence) values(true, null);

-- Who approved each release and what they checked; private, like catalog publications.
create table catalog_private.merchant_publications (
  release_sequence bigint primary key references public.merchant_releases(sequence),
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text not null check (char_length(btrim(review_note)) between 10 and 2000),
  published_at timestamptz not null default now()
);
create index merchant_publications_reviewed_by_idx on catalog_private.merchant_publications(reviewed_by);

alter table public.merchant_releases enable row level security;
alter table public.merchant_head enable row level security;
alter table catalog_private.merchant_publications enable row level security;
revoke all on public.merchant_releases, public.merchant_head, catalog_private.merchant_publications
  from public, anon, authenticated, service_role;
revoke all on sequence public.merchant_releases_sequence_seq from public, anon, authenticated, service_role;
grant select on public.merchant_releases, public.merchant_head to anon, authenticated;
create policy published_merchants_read on public.merchant_releases for select to anon, authenticated using (true);
create policy merchant_head_read on public.merchant_head for select to anon, authenticated using (true);

-- Publishes a whole release: the reviewer's explicit action, never a model's. `p_expected_head` and
-- `p_expected_hash` are the head's sequence and release_hash as the caller last saw them (null, null before
-- the first release), so a publication lands only on the state the reviewer checked. Publishing the same
-- version with identical content again returns the existing release (a lost response can be retried);
-- the same version with different content is refused.
create function catalog_private.publish_merchant_release(
  p_release jsonb, p_expected_head bigint, p_expected_hash text, p_review_note text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := catalog_private.require_reviewer();
  head_sequence bigint;
  head_hash text;
  existing public.merchant_releases%rowtype;
  released public.merchant_releases%rowtype;
  moment timestamptz;
begin
  if p_review_note is null or char_length(btrim(p_review_note)) not between 10 and 2000 then
    raise exception 'A review note is required' using errcode='22023';
  end if;
  if p_release is null or not catalog_private.valid_merchant_release(p_release) then
    raise exception 'Merchant release is invalid' using errcode='22023';
  end if;
  select release_sequence into head_sequence from public.merchant_head where singleton for update;
  select r.release_hash into head_hash from public.merchant_releases r where r.sequence = head_sequence;
  -- A retry of a lost response: the same version with the same content.
  select * into existing from public.merchant_releases where version = p_release->>'version';
  if found then
    if existing.release = p_release then return to_jsonb(existing); end if;
    raise exception 'Version already published with different content' using errcode='40001';
  end if;
  if head_sequence is distinct from p_expected_head or head_hash is distinct from p_expected_hash then
    raise exception 'Merchant releases changed; check the head and publish again' using errcode='40001';
  end if;
  -- Row locks can wait: authority and freshness are checked after that wait, not at request start.
  perform catalog_private.require_reviewer();
  moment := clock_timestamp();
  if (p_release->>'verifiedAt')::timestamptz > moment then
    raise exception 'Merchant release is verified in the future' using errcode='22023';
  end if;
  insert into public.merchant_releases(release, published_at) values(p_release, moment) returning * into released;
  insert into catalog_private.merchant_publications(release_sequence, reviewed_by, review_note, published_at)
    values(released.sequence, actor, btrim(p_review_note), moment);
  update public.merchant_head set release_sequence = released.sequence where singleton;
  return to_jsonb(released);
end;
$$;

create function public.publish_merchant_release(
  p_release jsonb, p_expected_head bigint, p_expected_hash text, p_review_note text
) returns jsonb language sql security invoker set search_path = '' as $$
  select catalog_private.publish_merchant_release(p_release, p_expected_head, p_expected_hash, p_review_note);
$$;

revoke all on function catalog_private.valid_merchant_release_v1(jsonb), catalog_private.valid_merchant_release(jsonb),
  catalog_private.publish_merchant_release(jsonb,bigint,text,text), public.publish_merchant_release(jsonb,bigint,text,text)
  from public, anon, authenticated, service_role;
grant execute on function catalog_private.publish_merchant_release(jsonb,bigint,text,text) to authenticated;
grant execute on function public.publish_merchant_release(jsonb,bigint,text,text) to authenticated;
comment on function public.publish_merchant_release(jsonb,bigint,text,text) is
  'Explicit reviewer action only (the pipeline CLI on Evan''s chat instruction). Never available as an LLM tool. Requires a fresh Supabase session and database reviewer membership.';
