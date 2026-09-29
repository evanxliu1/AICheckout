create schema catalog_private;
revoke all on schema catalog_private from public, anon, authenticated, service_role;
-- Needed only for the explicitly granted functions below, never for table access.
grant usage on schema catalog_private to authenticated;
alter default privileges in schema catalog_private revoke execute on functions from public;
create extension if not exists pg_jsonschema with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Version 1 deliberately permits only the rules supported by the packaged rewards engine.
-- API/consumer boundaries must also validate their incoming catalog data before use.
create function catalog_private.valid_catalog_v1(payload jsonb)
returns boolean language plpgsql stable security invoker set search_path = '' set timezone = 'UTC' as $$
declare
  card jsonb;
  rule jsonb;
  base_bps integer;
  source_count integer;
begin
  if payload is null or octet_length(payload::text) > 262144 or not extensions.jsonb_matches_schema(
  '{
    "type":"object","additionalProperties":false,
    "required":["schemaVersion","version","verifiedAt","expiresAt","merchantIds","sources","cards"],
    "properties":{
      "schemaVersion":{"const":1},
      "version":{"type":"string","minLength":1,"maxLength":80,"pattern":"^[a-zA-Z0-9][a-zA-Z0-9._-]*$"},
      "verifiedAt":{"type":"string","format":"date-time","pattern":"Z$"},
      "expiresAt":{"type":"string","format":"date-time","pattern":"Z$"},
      "merchantIds":{"type":"array","minItems":1,"maxItems":10,"uniqueItems":true,"items":{"$ref":"#/$defs/id"}},
      "sources":{"type":"array","minItems":1,"maxItems":30,"items":{
        "type":"object","additionalProperties":false,"required":["id","title","url","checkedOn"],
        "properties":{
          "id":{"$ref":"#/$defs/id"},"title":{"type":"string","minLength":1,"maxLength":200},
          "url":{"type":"string","format":"uri","pattern":"^https://[^\\s]+$","maxLength":2048},
          "checkedOn":{"type":"string","format":"date","pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"}
        }
      }},
      "cards":{"type":"array","minItems":1,"maxItems":30,"items":{
        "type":"object","additionalProperties":false,"required":["id","name","shortName","rules"],
        "properties":{
          "id":{"$ref":"#/$defs/id"},"name":{"type":"string","minLength":1,"maxLength":120},
          "shortName":{"type":"string","minLength":1,"maxLength":60},
          "rules":{"type":"array","minItems":1,"maxItems":2,"items":{
            "type":"object","additionalProperties":false,"required":["id","category","rateBps","requiresActivation","sourceIds"],
            "properties":{
              "id":{"$ref":"#/$defs/id"},"category":{"enum":["all-eligible","us-online-retail"]},
              "rateBps":{"type":"integer","minimum":0,"maximum":10000},
              "annualCapCents":{"type":"integer","minimum":1,"maximum":10000000},
              "requiresActivation":{"type":"boolean"},
              "sourceIds":{"type":"array","minItems":1,"maxItems":10,"uniqueItems":true,"items":{"$ref":"#/$defs/id"}}
            }
          }}
        }
      }}
    },
    "$defs":{"id":{"type":"string","minLength":1,"maxLength":80,"pattern":"^[a-z0-9][a-z0-9-]*$"}}
  }'::json, payload) then return false; end if;

  if exists(select 1 from jsonb_array_elements(payload->'sources') s where s->>'url' ~ '^https://[^/?#]*@')
     or (payload->>'expiresAt')::timestamptz <= (payload->>'verifiedAt')::timestamptz
     or (payload->>'expiresAt')::timestamptz > (payload->>'verifiedAt')::timestamptz + interval '30 days'
     or exists (select 1 from jsonb_array_elements(payload->'sources') s
                where (s->>'checkedOn')::date > ((payload->>'verifiedAt')::timestamptz at time zone 'UTC')::date
                   or (s->>'checkedOn')::date < ((payload->>'verifiedAt')::timestamptz at time zone 'UTC')::date - 30)
  then return false; end if;
  if (select count(*) <> count(distinct s->>'id') from jsonb_array_elements(payload->'sources') s)
     or (select count(*) <> count(distinct c->>'id') from jsonb_array_elements(payload->'cards') c)
     or (select count(*) <> count(distinct r->>'id') from jsonb_array_elements(payload->'cards') c,
                jsonb_array_elements(c->'rules') r)
  then return false; end if;
  for card in select value from jsonb_array_elements(payload->'cards') loop
    if (select count(*) from jsonb_array_elements(card->'rules') r where r->>'category'='all-eligible') <> 1
       or (select count(*) from jsonb_array_elements(card->'rules') r where r->>'category'='us-online-retail') > 1
    then return false; end if;
    select (r->>'rateBps')::integer into base_bps from jsonb_array_elements(card->'rules') r
    where r->>'category'='all-eligible';
    for rule in select value from jsonb_array_elements(card->'rules') loop
      if (rule->>'rateBps')::integer < base_bps
         or (rule->>'category'='all-eligible' and (rule ? 'annualCapCents' or (rule->>'requiresActivation')::boolean))
      then return false; end if;
      select count(*) into source_count from jsonb_array_elements(payload->'sources') s
      where s->>'id' in (select jsonb_array_elements_text(rule->'sourceIds'));
      if source_count <> jsonb_array_length(rule->'sourceIds') then return false; end if;
    end loop;
  end loop;
  return true;
exception when invalid_datetime_format or datetime_field_overflow then return false;
end;
$$;

create table catalog_private.reviewers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);
create table catalog_private.source_documents (
  id uuid primary key default gen_random_uuid(),
  source_key text not null check (source_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  title text not null check (char_length(title) between 1 and 200),
  url text not null check (char_length(url) <= 2048 and url ~ '^https://[^[:space:]]+$'),
  checked_on date not null,
  body text not null check (char_length(body) between 1 and 60000),
  content_hash text generated always as (encode(extensions.digest(body, 'sha256'), 'hex')) stored,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(source_key, content_hash, checked_on)
);
create index source_documents_created_by_idx on catalog_private.source_documents(created_by);

create table public.catalog_releases (
  sequence bigint generated always as identity primary key,
  catalog jsonb not null check (catalog_private.valid_catalog_v1(catalog)),
  version text generated always as (catalog->>'version') stored unique,
  catalog_hash text generated always as (encode(extensions.digest(catalog::text, 'sha256'), 'hex')) stored,
  published_at timestamptz not null default now()
);
create table public.catalog_head (
  singleton boolean primary key default true check (singleton),
  release_sequence bigint references public.catalog_releases(sequence)
);
insert into public.catalog_head(singleton, release_sequence) values(true, null);

create table catalog_private.drafts (
  id uuid primary key default gen_random_uuid(),
  catalog jsonb not null check (catalog_private.valid_catalog_v1(catalog)),
  catalog_hash text generated always as (encode(extensions.digest(catalog::text, 'sha256'), 'hex')) stored,
  source_document_ids uuid[] not null default '{}' check (cardinality(source_document_ids) <= 30),
  base_sequence bigint references public.catalog_releases(sequence),
  revision integer not null default 1 check (revision > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'rejected')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index drafts_base_sequence_idx on catalog_private.drafts(base_sequence);
create index drafts_created_by_idx on catalog_private.drafts(created_by);
create index drafts_review_queue_idx on catalog_private.drafts(updated_at desc, id) where status='draft';

create table catalog_private.publications (
  release_sequence bigint primary key references public.catalog_releases(sequence),
  draft_id uuid not null unique references catalog_private.drafts(id),
  draft_revision integer not null,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text not null check (char_length(btrim(review_note)) between 10 and 2000),
  published_at timestamptz not null default now()
);
create index publications_reviewed_by_idx on catalog_private.publications(reviewed_by);

alter table catalog_private.reviewers enable row level security;
alter table catalog_private.source_documents enable row level security;
alter table catalog_private.drafts enable row level security;
alter table catalog_private.publications enable row level security;
alter table public.catalog_releases enable row level security;
alter table public.catalog_head enable row level security;
-- Private tables intentionally have no client policies/grants. Narrow transactional
-- operations below are the only client path; a service-role key cannot publish.
revoke all on all tables in schema catalog_private from public, anon, authenticated, service_role;
revoke all on public.catalog_releases, public.catalog_head from public, anon, authenticated, service_role;
revoke all on sequence public.catalog_releases_sequence_seq from public, anon, authenticated, service_role;
grant select on public.catalog_releases, public.catalog_head to anon, authenticated;
create policy published_catalog_read on public.catalog_releases for select to anon, authenticated using (true);
create policy published_head_read on public.catalog_head for select to anon, authenticated using (true);

-- Membership lives in the database, never in user-editable metadata or stale JWT role
-- claims. A revoked/deleted session cannot continue using its unexpired access token.
-- Locks serialize publication with membership/session removal in the same database.
create function catalog_private.require_reviewer()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  session_ends timestamptz;
  banned_until timestamptz;
  anonymous_user boolean;
begin
  if actor is null then raise exception 'Reviewer authorization required' using errcode='42501'; end if;
  perform 1 from catalog_private.reviewers where user_id=actor for share;
  if not found then raise exception 'Reviewer authorization required' using errcode='42501'; end if;
  select s.not_after,u.banned_until,u.is_anonymous into session_ends,banned_until,anonymous_user
  from auth.sessions s join auth.users u on u.id=s.user_id
  where s.user_id=actor and s.id::text=auth.jwt()->>'session_id'
  for share of s, u;
  if not found or coalesce(anonymous_user,false) or session_ends <= clock_timestamp()
     or banned_until > clock_timestamp() then
    raise exception 'Reviewer authorization required' using errcode='42501';
  end if;
  return actor;
end;
$$;

create function catalog_private.publish_catalog(
  p_draft_id uuid, p_expected_revision integer, p_expected_hash text,
  p_expected_head bigint, p_review_note text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := catalog_private.require_reviewer();
  head_sequence bigint;
  draft catalog_private.drafts%rowtype;
  released public.catalog_releases%rowtype;
  moment timestamptz;
begin
  if p_review_note is null or char_length(btrim(p_review_note)) not between 10 and 2000 then
    raise exception 'A review note is required' using errcode='22023';
  end if;
  -- Lock the head before the draft so concurrent publications use one ordering.
  select release_sequence into head_sequence from public.catalog_head where singleton for update;
  select * into draft from catalog_private.drafts where id=p_draft_id for update;
  if not found then raise exception 'Draft not found' using errcode='P0002'; end if;
  if draft.revision is distinct from p_expected_revision or draft.catalog_hash is distinct from p_expected_hash then
    raise exception 'Draft changed; review it again' using errcode='40001';
  end if;
  -- A lost response can be retried without creating another release or changing the head.
  if draft.status='published' then
    select r.* into released from public.catalog_releases r join catalog_private.publications p
      on p.release_sequence=r.sequence where p.draft_id=draft.id;
    return to_jsonb(released);
  end if;
  if draft.status <> 'draft' then raise exception 'Draft is not publishable' using errcode='22023'; end if;
  if head_sequence is distinct from p_expected_head or draft.base_sequence is distinct from head_sequence then
    raise exception 'Catalog changed; rebase and review the draft' using errcode='40001';
  end if;
  -- Row locks can wait: freshness must be checked after that wait, not at request start.
  perform catalog_private.require_reviewer();
  moment := clock_timestamp();
  if (draft.catalog->>'verifiedAt')::timestamptz > moment or (draft.catalog->>'expiresAt')::timestamptz <= moment then
    raise exception 'Catalog is not currently valid' using errcode='22023';
  end if;
  -- Every public source must resolve to an immutable captured document with identical
  -- metadata. This proves provenance, not correctness of interpretation; review is required.
  if cardinality(draft.source_document_ids) <> jsonb_array_length(draft.catalog->'sources')
     or (select count(distinct id) from unnest(draft.source_document_ids) id) <> cardinality(draft.source_document_ids)
     or exists (
       select 1 from jsonb_array_elements(draft.catalog->'sources') src where not exists (
         select 1 from catalog_private.source_documents doc where doc.id=any(draft.source_document_ids)
           and doc.source_key=src->>'id' and doc.url=src->>'url' and doc.title=src->>'title'
           and doc.checked_on=(src->>'checkedOn')::date
       )
     ) then raise exception 'Source evidence is incomplete' using errcode='22023'; end if;

  insert into public.catalog_releases(catalog,published_at) values(draft.catalog,moment) returning * into released;
  insert into catalog_private.publications(release_sequence,draft_id,draft_revision,reviewed_by,review_note,published_at)
    values(released.sequence,draft.id,draft.revision,actor,btrim(p_review_note),moment);
  update catalog_private.drafts set status='published',updated_at=moment where id=draft.id;
  update public.catalog_head set release_sequence=released.sequence where singleton;
  return to_jsonb(released);
end;
$$;

-- The exposed wrapper is an invoker; all elevated code stays in the unexposed schema.
create function public.publish_catalog(
  p_draft_id uuid, p_expected_revision integer, p_expected_hash text,
  p_expected_head bigint, p_review_note text
) returns jsonb language sql security invoker set search_path = '' as $$
  select catalog_private.publish_catalog(p_draft_id,p_expected_revision,p_expected_hash,p_expected_head,p_review_note);
$$;

-- Remove PostgreSQL/Supabase default function grants, then opt in only to publication.
revoke all on all functions in schema catalog_private from public, anon, authenticated, service_role;
revoke all on function public.publish_catalog(uuid,integer,text,bigint,text) from public, anon, authenticated, service_role;
grant execute on function catalog_private.publish_catalog(uuid,integer,text,bigint,text) to authenticated;
grant execute on function public.publish_catalog(uuid,integer,text,bigint,text) to authenticated;

comment on schema catalog_private is 'Unexposed catalog maintenance data; no wallet or shopping data.';
comment on function public.publish_catalog(uuid,integer,text,bigint,text) is
  'Explicit reviewer action only. Never available as an LLM tool. Requires a fresh Supabase session and database reviewer membership.';
