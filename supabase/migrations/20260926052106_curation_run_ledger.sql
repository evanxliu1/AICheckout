-- A narrow server credential can manage extraction runs, but cannot publish catalogs.
-- No login/password is created here. Provision a separate login as a member at deployment.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='aicheckout_curation_executor') then
    create role aicheckout_curation_executor nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end $$;
-- PostgreSQL 16+ role creation does not imply SET ROLE membership for its creator.
grant aicheckout_curation_executor to postgres;
grant usage on schema catalog_private to aicheckout_curation_executor;

create table catalog_private.curation_policy (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  lifetime_budget_microusd bigint not null default 0 check(lifetime_budget_microusd between 0 and 1000000000),
  daily_budget_microusd bigint not null default 0 check(daily_budget_microusd between 0 and 1000000000),
  daily_run_limit integer not null default 20 check(daily_run_limit between 1 and 1000),
  max_concurrent integer not null default 1 check(max_concurrent between 1 and 8)
);
insert into catalog_private.curation_policy(singleton) values(true);

create table catalog_private.curation_profiles (
  id text primary key check(id ~ '^[a-z0-9._-]{1,80}$'),
  enabled boolean not null default false,
  provider text not null check(provider ~ '^[a-z0-9._-]{1,80}$'),
  model text not null check(model ~ '^[a-zA-Z0-9/._:-]{1,120}$'),
  mode text not null check(mode in ('fixture','metered')),
  input_price bigint not null check(input_price between 0 and 1000000000),
  output_price bigint not null check(output_price between 0 and 1000000000),
  max_input_tokens integer not null default 48000 check(max_input_tokens between 512 and 64000),
  max_output_tokens integer not null default 4096 check(max_output_tokens between 128 and 8192),
  max_attempts integer not null default 2 check(max_attempts between 1 and 2),
  attempt_timeout_ms integer not null default 10000 check(attempt_timeout_ms between 1 and 30000),
  total_timeout_ms integer not null default 15000 check(total_timeout_ms between 1 and 60000),
  check((mode='fixture' and input_price=0 and output_price=0) or (mode='metered' and input_price>0 and output_price>0))
);

create table catalog_private.curation_runs (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users(id),
  session_id uuid not null, -- Preserve attribution after Auth deletes/revokes the session.
  request_key uuid not null,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  profile_id text not null references catalog_private.curation_profiles(id),
  profile jsonb not null,
  card_id text not null check(card_id in ('capital-one-quicksilver','amex-blue-cash-everyday')),
  context jsonb not null check(jsonb_typeof(context)='object' and octet_length(context::text)<=196608),
  context_hash text not null check(context_hash ~ '^[a-f0-9]{64}$'),
  execution_token_hash text not null check(execution_token_hash ~ '^[a-f0-9]{64}$'),
  budget_day date not null,
  reserved_microusd bigint not null check(reserved_microusd between 0 and 1000000000),
  state text not null default 'running' check(state in ('running','finished','interrupted')),
  started_at timestamptz not null default clock_timestamp(),
  deadline_at timestamptz not null,
  finished_at timestamptz,
  trace jsonb check(trace is null or (jsonb_typeof(trace)='object' and octet_length(trace::text)<=1048576)),
  trace_hash text,
  interruption_note text,
  unique(requested_by,request_key),
  check((state='running' and finished_at is null and trace is null and trace_hash is null and interruption_note is null)
    or (state='finished' and finished_at is not null and trace is not null and trace_hash ~ '^[a-f0-9]{64}$' and interruption_note is null)
    or (state='interrupted' and finished_at is not null and trace is null and trace_hash is null and length(interruption_note) between 10 and 2000))
);
create index curation_runs_budget_day_idx on catalog_private.curation_runs(budget_day);
create index curation_runs_active_idx on catalog_private.curation_runs(started_at) where state='running';
create index curation_runs_profile_idx on catalog_private.curation_runs(profile_id);
create table catalog_private.curation_run_sources (
  run_id uuid not null references catalog_private.curation_runs(id) on delete cascade,
  source_id uuid not null references catalog_private.source_documents(id),
  primary key(run_id,source_id)
);
create index curation_run_sources_source_idx on catalog_private.curation_run_sources(source_id);

alter table catalog_private.curation_policy enable row level security;
alter table catalog_private.curation_profiles enable row level security;
alter table catalog_private.curation_runs enable row level security;
alter table catalog_private.curation_run_sources enable row level security;
revoke all on catalog_private.curation_policy,catalog_private.curation_profiles,catalog_private.curation_runs,catalog_private.curation_run_sources
  from public,anon,authenticated,service_role,aicheckout_curation_executor;

-- The executor supplies identity only after the Node API verifies the human JWT through
-- the existing Data API. It cannot grant membership; live rows are checked again here.
create function catalog_private.require_curation_human(p_actor uuid,p_session uuid)
returns void language plpgsql security definer set search_path='' as $$
declare ends timestamptz; banned timestamptz; anonymous_user boolean;
begin
  perform 1 from catalog_private.reviewers where user_id=p_actor for share;
  if not found then raise exception 'Reviewer authorization required' using errcode='42501'; end if;
  select s.not_after,u.banned_until,u.is_anonymous into ends,banned,anonymous_user
    from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=p_session and s.user_id=p_actor for share of s,u;
  if not found or coalesce(anonymous_user,false) or ends<=clock_timestamp() or banned>clock_timestamp() then
    raise exception 'Reviewer authorization required' using errcode='42501';
  end if;
end $$;

create function catalog_private.claim_curation_run(p_actor uuid,p_session uuid,p_key uuid,p_profile text,
  p_card text,p_sources uuid[],p_context jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  policy catalog_private.curation_policy%rowtype; profile catalog_private.curation_profiles%rowtype;
  run catalog_private.curation_runs%rowtype; source_ids uuid[]; request_hash text;
  reserved bigint; lifetime_total bigint; daily_total bigint; daily_count bigint; active_count bigint;
  day date; token text; context_hash text; envelope jsonb; expected_documents jsonb; supplied_documents jsonb;
begin
  -- One policy-row lock serializes admission across every API instance and profile.
  select * into strict policy from catalog_private.curation_policy where singleton for update;
  perform catalog_private.require_curation_human(p_actor,p_session);
  if p_key is null or p_card is null or p_card not in ('capital-one-quicksilver','amex-blue-cash-everyday')
    or p_sources is null or cardinality(p_sources) not between 1 and 3
    or cardinality(p_sources) <> (select count(distinct id) from unnest(p_sources) id)
    or p_context is null or jsonb_typeof(p_context)<>'object' or octet_length(p_context::text)>196608
    or not(p_context ?& array['system','user','jsonSchema','versions','hash','inputTokenEstimate'])
    or coalesce(p_context->>'hash','') !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid curation input' using errcode='22023';
  end if;
  select array_agg(id order by id) into source_ids from unnest(p_sources) id;
  if exists(select 1 from unnest(source_ids) requested(id) where not exists(select 1 from catalog_private.source_documents s where s.id=requested.id)) then
    raise exception 'Unknown source document' using errcode='22023';
  end if;
  begin
    envelope := (p_context->>'user')::jsonb;
  exception when others then raise exception 'Invalid source context' using errcode='22023'; end;
  if envelope->'target'->>'cardId' is distinct from p_card or jsonb_typeof(envelope->'documents') is distinct from 'array' then
    raise exception 'Invalid source context' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('documentId',s.id,'sourceKey',s.source_key,'url',s.url,'checkedOn',s.checked_on,
    'contentHash',s.content_hash,'body',s.body) order by s.id) into expected_documents
    from catalog_private.source_documents s where s.id=any(source_ids);
  select jsonb_agg(doc order by doc->>'documentId') into supplied_documents from jsonb_array_elements(envelope->'documents') doc;
  if supplied_documents is distinct from expected_documents then
    raise exception 'Context does not match immutable sources' using errcode='22023'; end if;
  context_hash := encode(extensions.digest(p_context::text,'sha256'),'hex');
  request_hash := encode(extensions.digest(jsonb_build_object('profile',p_profile,'card',p_card,'sources',source_ids,'context',context_hash)::text,'sha256'),'hex');
  select * into run from catalog_private.curation_runs where requested_by=p_actor and request_key=p_key;
  if found then
    if run.request_hash<>request_hash then raise exception 'Idempotency key reused with different input' using errcode='40001'; end if;
    return jsonb_build_object('claimed',false,'run',to_jsonb(run)-'execution_token_hash');
  end if;
  select * into profile from catalog_private.curation_profiles where id=p_profile for share;
  if not found or not profile.enabled or not policy.enabled then raise exception 'Curation is disabled' using errcode='55000'; end if;
  reserved := profile.max_attempts * ceil((profile.max_input_tokens::numeric*profile.input_price + profile.max_output_tokens::numeric*profile.output_price)/1000000)::bigint;
  day := (clock_timestamp() at time zone 'UTC')::date;
  select coalesce(sum(reserved_microusd),0),coalesce(sum(reserved_microusd) filter(where budget_day=day),0),
    count(*) filter(where budget_day=day),count(*) filter(where state='running')
    into lifetime_total,daily_total,daily_count,active_count from catalog_private.curation_runs;
  if reserved+lifetime_total>policy.lifetime_budget_microusd or reserved+daily_total>policy.daily_budget_microusd
    or (profile.mode='metered' and (policy.lifetime_budget_microusd=0 or policy.daily_budget_microusd=0)) then
    raise exception 'Curation budget exhausted' using errcode='54000';
  end if;
  if daily_count>=policy.daily_run_limit or active_count>=policy.max_concurrent then
    raise exception 'Curation capacity exhausted' using errcode='53300';
  end if;
  -- Recheck after all lock waits. A revoked/expired human cannot gain a fresh claim.
  perform catalog_private.require_curation_human(p_actor,p_session);
  token := encode(extensions.gen_random_bytes(32),'hex');
  insert into catalog_private.curation_runs(requested_by,session_id,request_key,request_hash,profile_id,profile,
    card_id,context,context_hash,execution_token_hash,budget_day,reserved_microusd,deadline_at)
    values(p_actor,p_session,p_key,request_hash,p_profile,to_jsonb(profile),p_card,p_context,context_hash,
      encode(extensions.digest(token,'sha256'),'hex'),day,reserved,clock_timestamp()+interval '2 minutes') returning * into run;
  insert into catalog_private.curation_run_sources(run_id,source_id) select run.id,id from unnest(source_ids) id;
  return jsonb_build_object('claimed',true,'executionToken',token,'run',to_jsonb(run)-'execution_token_hash');
end $$;

create function catalog_private.check_curation_execution(p_id uuid,p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run catalog_private.curation_runs%rowtype; enabled boolean;
begin
  select p.enabled into strict enabled from catalog_private.curation_policy p where singleton for share;
  select * into run from catalog_private.curation_runs where id=p_id for share;
  if not found or run.execution_token_hash is distinct from encode(extensions.digest(p_token,'sha256'),'hex') then
    raise exception 'Invalid execution claim' using errcode='42501'; end if;
  perform catalog_private.require_curation_human(run.requested_by,run.session_id);
  if not enabled or not exists(select 1 from catalog_private.curation_profiles where id=run.profile_id and curation_profiles.enabled)
    or run.state<>'running' or run.deadline_at<=clock_timestamp() then
    raise exception 'Execution is no longer active' using errcode='55000'; end if;
  return to_jsonb(run)-'execution_token_hash';
end $$;

create function catalog_private.finish_curation_run(p_id uuid,p_token text,p_trace jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run catalog_private.curation_runs%rowtype; digest text;
begin
  select * into run from catalog_private.curation_runs where id=p_id for update;
  if not found or run.execution_token_hash is distinct from encode(extensions.digest(p_token,'sha256'),'hex') then
    raise exception 'Invalid execution claim' using errcode='42501'; end if;
  if p_trace is null or jsonb_typeof(p_trace)<>'object' or octet_length(p_trace::text)>1048576
    or p_trace->>'runId' is distinct from p_id::text
    or p_trace->'context'->>'hash' is distinct from run.context->>'hash'
    or coalesce(p_trace->>'status','') not in ('invalid_input','input_limit','budget_blocked','cancelled','timeout','provider_error','invalid_output','output_limit','refused','needs_review','evidence_valid') then
    raise exception 'Invalid execution trace' using errcode='22023'; end if;
  digest := encode(extensions.digest(p_trace::text,'sha256'),'hex');
  if run.state='finished' and run.trace_hash=digest then return to_jsonb(run)-'execution_token_hash'; end if;
  if run.state<>'running' then raise exception 'Execution is immutable after completion' using errcode='40001'; end if;
  -- Finalization remains possible after sign-out/deadline, to record what already ran.
  -- No reservation is refunded from self-reported/provider-reported usage.
  update catalog_private.curation_runs set state='finished',trace=p_trace,trace_hash=digest,finished_at=clock_timestamp()
    where id=p_id returning * into run;
  return to_jsonb(run)-'execution_token_hash';
end $$;

-- Operator-only recovery: first confirm the owning process is stopped. Never replay it.
create function catalog_private.interrupt_curation_run(p_id uuid,p_note text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_note is null or length(trim(p_note)) not between 10 and 2000 then raise exception 'Recovery note required' using errcode='22023'; end if;
  update catalog_private.curation_runs set state='interrupted',finished_at=clock_timestamp(),interruption_note=trim(p_note)
    where id=p_id and state='running' and deadline_at<=clock_timestamp();
  if not found then raise exception 'Run is not overdue and running' using errcode='55000'; end if;
end $$;

create function catalog_private.get_curation_run(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run catalog_private.curation_runs%rowtype;
begin
  perform catalog_private.require_reviewer();
  select * into run from catalog_private.curation_runs where id=p_id;
  if not found then raise exception 'Run not found' using errcode='P0002'; end if;
  return to_jsonb(run)-'execution_token_hash';
end $$;
create function public.get_curation_run(p_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select catalog_private.get_curation_run(p_id); $$;

revoke all on function catalog_private.require_curation_human(uuid,uuid),
  catalog_private.claim_curation_run(uuid,uuid,uuid,text,text,uuid[],jsonb),
  catalog_private.check_curation_execution(uuid,text),catalog_private.finish_curation_run(uuid,text,jsonb),
  catalog_private.interrupt_curation_run(uuid,text),catalog_private.get_curation_run(uuid),public.get_curation_run(uuid)
  from public,anon,authenticated,service_role,aicheckout_curation_executor;
grant execute on function catalog_private.claim_curation_run(uuid,uuid,uuid,text,text,uuid[],jsonb),
  catalog_private.check_curation_execution(uuid,text),catalog_private.finish_curation_run(uuid,text,jsonb)
  to aicheckout_curation_executor;
grant execute on function catalog_private.get_curation_run(uuid),public.get_curation_run(uuid) to authenticated;
