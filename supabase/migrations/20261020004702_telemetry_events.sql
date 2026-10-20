-- Release A telemetry (Phase 15.2, wiki/product/phase-15-release-a.md §4 row 15.2 and §5; decision
-- wiki/decisions/2026-10-19-release-a-telemetry-design.md). A private schema `telemetry`, not exposed to the
-- Data API, holding the raw consented events (90 days) and per-install daily counters. The only write path is
-- `public.ingest_events`, a security-definer RPC granted to `anon` that re-validates every event against the
-- shared envelope (`telemetry.valid_event_v1` mirrors telemetryEventSchema in packages/catalog-review/src/
-- telemetry.ts; scripts/test-catalog-parity.mjs runs the shared telemetryEventCases through both), caps the
-- batch (50 events, 128 KiB as JSONB text, 64 KiB on the wire) and the install's UTC day (500), stores each
-- event id once, and prunes up to 1000 rows older than 90 days on every call (no scheduler). `public.
-- delete_install` removes an install's rows on the shopper's request. Reviewers read two aggregates through
-- `require_reviewer()`: store suggestions and a daily summary. No table grant to any client role.

create schema telemetry;
revoke all on schema telemetry from public, anon, authenticated, service_role;
-- Reviewers reach the two read functions through the public wrappers below; no table or sequence grant follows.
grant usage on schema telemetry to authenticated;
alter default privileges in schema telemetry revoke execute on functions from public;
comment on schema telemetry is 'Consented extension telemetry (Phase 15): raw events for 90 days and per-install day counters; no wallet, card numbers, domains on automatic events, or page text.';

-- The JSON schema of one event: thirteen branches sharing the envelope. Built here so the envelope is written
-- once; `install_id` is nullable on the two tap events only, which are also the only events with a domain.
create function telemetry.event_schema()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  envelope constant jsonb := '{
    "event_id":{"$ref":"#/$defs/uuid"},
    "client_at":{"type":"string","pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$"},
    "install_month":{"type":"string","pattern":"^[0-9]{4}-(0[1-9]|1[0-2])$"},
    "days_since_install":{"enum":["0","1-6","7-13","14-29","30-59","60+"]},
    "consent_version":{"const":1},
    "schema_version":{"const":1},
    "extension_version":{"type":"string","maxLength":20,"pattern":"^[0-9]+\\.[0-9]+\\.[0-9]+$"},
    "catalog_version":{"$ref":"#/$defs/release_version"},
    "merchants_version":{"$ref":"#/$defs/release_version"},
    "reader_version":{"type":"string","pattern":"^[a-z0-9-]{1,40}$"}
  }'::jsonb;
  defs constant jsonb := '{
    "uuid":{"type":"string","pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},
    "uuid_or_null":{"type":["string","null"],"pattern":"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"},
    "release_version":{"type":"string","maxLength":80,"pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.[a-z0-9-]+\\.[0-9]+$"},
    "release_version_or_null":{"type":["string","null"],"maxLength":80,"pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.[a-z0-9-]+\\.[0-9]+$"},
    "catalog_id":{"type":"string","minLength":1,"maxLength":80,"pattern":"^[a-z0-9][a-z0-9-]*$"},
    "code":{"type":"string","pattern":"^[a-z][a-z0-9-]{0,39}$"},
    "code_or_null":{"type":["string","null"],"pattern":"^[a-z][a-z0-9-]{0,39}$"},
    "domain":{"type":"string","maxLength":253,"pattern":"^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z][a-z0-9-]{0,62}$"},
    "count":{"type":"integer","minimum":0,"maximum":20},
    "view":{"enum":["amount","rates"]},
    "view_or_null":{"enum":["amount","rates",null]},
    "page":{"enum":["cart","checkout","popup-read"]},
    "store_kind":{"enum":["named","generic"]}
  }'::jsonb;
  branches jsonb := '[]'::jsonb;
  def record;
  properties jsonb;
begin
  for def in select * from (values
    ('consent_granted', '{}'::jsonb, false),
    ('onboarding_completed', '{"cards_count":{"$ref":"#/$defs/count"}}', false),
    ('wallet_changed', '{"card_ids":{"type":"array","maxItems":20,"uniqueItems":true,"items":{"$ref":"#/$defs/catalog_id"}}}', false),
    ('recommendation_shown', '{
      "surface":{"enum":["badge","popup"]},
      "view":{"$ref":"#/$defs/view"},
      "withheld_reason":{"$ref":"#/$defs/code_or_null"},
      "page":{"$ref":"#/$defs/page"},
      "store_kind":{"$ref":"#/$defs/store_kind"},
      "evidence_basis":{"enum":["issuer","mcc","corroborated","definition","default","none"]},
      "category":{"type":"string"},
      "amount_cents":{"type":["integer","null"],"minimum":0,"maximum":99999999},
      "amount_kind":{"enum":["total","estimated-total","subtotal",null]},
      "top_card_id":{"$ref":"#/$defs/catalog_id"},
      "cards_count":{"type":"integer","minimum":1,"maximum":20},
      "ranking_may_change":{"type":"boolean"}}', false),
    ('badge_expanded', '{"view":{"$ref":"#/$defs/view"}}', false),
    ('badge_dismissed', '{"view":{"$ref":"#/$defs/view"}}', false),
    ('site_disabled', '{"store_kind":{"$ref":"#/$defs/store_kind"}}', false),
    ('amount_typed', '{"relative_difference_bucket":{"enum":["<1%","1-5%","5-20%",">20%","no-read"]}}', false),
    ('popup_opened', '{
      "read_outcome":{"enum":["found","withheld","not-a-cart","empty","non-usd","payment-page","non-web"]},
      "store_kind":{"$ref":"#/$defs/store_kind"}}', false),
    ('release_refresh', '{
      "kind":{"enum":["catalog","merchants"]},
      "outcome":{"enum":["ok","skipped","failed"]},
      "from_version":{"$ref":"#/$defs/release_version_or_null"},
      "to_version":{"$ref":"#/$defs/release_version_or_null"},
      "trigger":{"enum":["install","weekly","manual"]}}', false),
    ('error', '{"code":{"$ref":"#/$defs/code"},"surface":{"$ref":"#/$defs/code"}}', false),
    ('store_suggested', '{"domain":{"$ref":"#/$defs/domain"},"page":{"$ref":"#/$defs/page"}}', true),
    ('problem_reported', '{
      "domain":{"$ref":"#/$defs/domain"},
      "reason":{"enum":["wrong-amount","no-badge","wrong-store","wrong-card","other"]},
      "view":{"$ref":"#/$defs/view_or_null"},
      "withheld_reason":{"$ref":"#/$defs/code_or_null"}}', true)
  ) as d(type, fields, tap) loop
    properties := envelope || def.fields || jsonb_build_object(
      'type', jsonb_build_object('const', def.type),
      'install_id', case when def.tap then '{"$ref":"#/$defs/uuid_or_null"}'::jsonb else '{"$ref":"#/$defs/uuid"}'::jsonb end);
    branches := branches || jsonb_build_object(
      'type', 'object', 'additionalProperties', false,
      'required', (select jsonb_agg(key) from jsonb_object_keys(properties) key),
      'properties', properties);
  end loop;
  return jsonb_build_object('oneOf', branches, '$defs', defs);
end;
$$;

-- One event. The schema above, then the checks a JSON schema cannot state: a real timestamp, a category from
-- the merchant category list (a SQL function so a later migration can extend it), and the amount rule of
-- `recommendation_shown` (the amount view carries an amount and no reason; the rates view the reverse).
create function telemetry.valid_event_v1(payload jsonb)
returns boolean language plpgsql stable security invoker set search_path = '' set timezone = 'UTC' as $$
begin
  if payload is null or octet_length(payload::text) > 8192
     or not extensions.jsonb_matches_schema(telemetry.event_schema()::json, payload) then
    return false;
  end if;
  perform (payload->>'client_at')::timestamptz;
  if payload->>'type' = 'recommendation_shown' then
    if payload->>'category' <> all(catalog_private.catalog_v3_merchant_categories()) then return false; end if;
    if payload->>'view' = 'amount' then
      if payload->'amount_cents' = 'null'::jsonb or payload->'amount_kind' = 'null'::jsonb
         or payload->'withheld_reason' <> 'null'::jsonb then return false; end if;
    elsif payload->'amount_cents' <> 'null'::jsonb or payload->'amount_kind' <> 'null'::jsonb
          or payload->'withheld_reason' = 'null'::jsonb then
      return false;
    end if;
  end if;
  return true;
exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then return false;
end;
$$;
comment on function telemetry.valid_event_v1(jsonb) is
  'Telemetry event schema 1. Mirrors telemetryEventSchema in packages/catalog-review; parity is tested by scripts/test-catalog-parity.mjs.';

create table telemetry.events (
  event_id uuid primary key,
  install_id uuid,
  type text not null,
  client_at timestamptz not null,
  received_at timestamptz not null default now(),
  event jsonb not null check (telemetry.valid_event_v1(event)),
  check (event_id = (event->>'event_id')::uuid and type = event->>'type'
         and install_id is not distinct from (event->>'install_id')::uuid)
);
create index events_received_at_idx on telemetry.events(received_at);
create index events_install_id_idx on telemetry.events(install_id);
create index events_type_received_at_idx on telemetry.events(type, received_at);
create table telemetry.install_days (
  install_id uuid not null,
  day date not null,
  count integer not null check (count between 1 and 500),
  primary key (install_id, day)
);
alter table telemetry.events enable row level security;
alter table telemetry.install_days enable row level security;
revoke all on telemetry.events, telemetry.install_days from public, anon, authenticated, service_role;

-- Pruning: a bounded number of raw rows older than 90 days, and the day counters of the same age.
create function telemetry.prune(p_limit integer)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  removed integer;
begin
  delete from telemetry.events where event_id in (
    select event_id from telemetry.events where received_at < now() - interval '90 days'
    order by received_at limit p_limit);
  get diagnostics removed = row_count;
  delete from telemetry.install_days where day < (now() at time zone 'UTC')::date - 90;
  return removed;
end;
$$;

-- The write path. Called by the API as `anon` (the publishable key) after its own Zod check and rate limits;
-- a batch that fails here is refused whole (22023), since a disagreement with the API is a bug, not a shopper.
-- Returns {"accepted": n, "dropped": n}: dropped counts repeated event ids and events over the install's cap.
create function public.ingest_events(p_batch jsonb)
returns jsonb language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  item jsonb;
  install uuid;
  today date := (now() at time zone 'UTC')::date;
  used integer;
  accepted integer := 0;
  dropped integer := 0;
begin
  if p_batch is null or jsonb_typeof(p_batch) <> 'array' or jsonb_array_length(p_batch) not between 1 and 50
     or octet_length(p_batch::text) > 131072 then
    raise exception 'Event batch is invalid' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_batch) e where not telemetry.valid_event_v1(e)) then
    raise exception 'Event batch is invalid' using errcode='22023';
  end if;
  for item in select value from jsonb_array_elements(p_batch) loop
    install := (item->>'install_id')::uuid;
    if install is not null then
      select count into used from telemetry.install_days where install_id = install and day = today for update;
      if used >= 500 then dropped := dropped + 1; continue; end if;
    end if;
    insert into telemetry.events(event_id, install_id, type, client_at, event)
      values((item->>'event_id')::uuid, install, item->>'type', (item->>'client_at')::timestamptz, item)
      on conflict (event_id) do nothing;
    if not found then dropped := dropped + 1; continue; end if;
    accepted := accepted + 1;
    if install is not null then
      insert into telemetry.install_days(install_id, day, count) values(install, today, 1)
        on conflict (install_id, day) do update set count = telemetry.install_days.count + 1;
    end if;
  end loop;
  perform telemetry.prune(1000);
  return jsonb_build_object('accepted', accepted, 'dropped', dropped);
end;
$$;

-- Delete my data: the install id is a random secret only that install holds. Returns {"deleted": n}.
create function public.delete_install(p_install_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  removed integer;
begin
  if p_install_id is null then raise exception 'An install id is required' using errcode='22023'; end if;
  delete from telemetry.events where install_id = p_install_id;
  get diagnostics removed = row_count;
  delete from telemetry.install_days where install_id = p_install_id;
  return jsonb_build_object('deleted', removed);
end;
$$;

-- Reviewer reads. The store suggestions aggregate (domain, count, distinct installs, last seen) is derived at
-- read time for the merchant pipeline's growth list; the summary counts events and installs by type and day.
create function telemetry.store_suggestions()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform catalog_private.require_reviewer();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'domain', s.domain, 'count', s.count, 'installs', s.installs, 'last_seen', s.last_seen)
      order by s.count desc, s.domain)
    from (select e.event->>'domain' as domain, count(*) as count, count(distinct e.install_id) as installs,
                 max(e.received_at) as last_seen
          from telemetry.events e where e.type = 'store_suggested'
          group by 1 order by 2 desc, 1 limit 500) s), '[]'::jsonb);
end;
$$;
create function telemetry.summary(p_days integer)
returns jsonb language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  since timestamptz;
begin
  perform catalog_private.require_reviewer();
  if p_days is null or p_days not between 1 and 90 then
    raise exception 'Days must be between 1 and 90' using errcode='22023';
  end if;
  since := now() - make_interval(days => p_days);
  return jsonb_build_object(
    'days', p_days,
    'events', (select count(*) from telemetry.events where received_at >= since),
    'installs', (select count(distinct install_id) from telemetry.events where received_at >= since),
    'by_type', coalesce((select jsonb_agg(jsonb_build_object('type', t.type, 'count', t.n) order by t.n desc, t.type)
      from (select type, count(*) as n from telemetry.events where received_at >= since group by type) t), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'events', d.n, 'installs', d.i) order by d.day)
      from (select (received_at at time zone 'UTC')::date as day, count(*) as n, count(distinct install_id) as i
            from telemetry.events where received_at >= since group by 1) d), '[]'::jsonb));
end;
$$;
create function public.telemetry_store_suggestions()
returns jsonb language sql security invoker set search_path = '' as $$
  select telemetry.store_suggestions();
$$;
create function public.telemetry_summary(p_days integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select telemetry.summary(p_days);
$$;

revoke all on function telemetry.event_schema(), telemetry.valid_event_v1(jsonb), telemetry.prune(integer),
  public.ingest_events(jsonb), public.delete_install(uuid),
  telemetry.store_suggestions(), telemetry.summary(integer),
  public.telemetry_store_suggestions(), public.telemetry_summary(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.ingest_events(jsonb), public.delete_install(uuid) to anon;
grant execute on function telemetry.store_suggestions(), telemetry.summary(integer),
  public.telemetry_store_suggestions(), public.telemetry_summary(integer) to authenticated;
comment on function public.ingest_events(jsonb) is
  'The only telemetry write path: consented events from the extension through the API. Validates, caps (50 per batch, 500 per install per UTC day), stores each event id once and prunes rows older than 90 days.';
comment on function public.delete_install(uuid) is
  'Delete my data: removes every row of one install id on the shopper''s request.';
comment on function public.telemetry_store_suggestions() is
  'Reviewer read: store suggestions (domain, count, distinct installs, last seen), most suggested first.';
comment on function public.telemetry_summary(integer) is
  'Reviewer read: event and install counts by type and UTC day over the last 1 to 90 days.';
