-- Human review of a finished extraction creates a draft revision, never a release.
create table catalog_private.extraction_applications (
  run_id uuid primary key references catalog_private.curation_runs(id),
  draft_id uuid not null references catalog_private.drafts(id),
  from_revision integer not null check(from_revision > 0),
  to_revision integer not null check(to_revision = from_revision + 1),
  result_hash text not null check(result_hash ~ '^[a-f0-9]{64}$'),
  applied_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz not null default clock_timestamp(),
  review_note text not null check(length(btrim(review_note)) between 10 and 2000),
  condition_reviews jsonb not null check(jsonb_typeof(condition_reviews)='array' and jsonb_array_length(condition_reviews)<=30),
  unique(draft_id,to_revision)
);
create index extraction_applications_actor_idx on catalog_private.extraction_applications(applied_by);
create index curation_runs_draft_idx on catalog_private.curation_runs((context#>>'{origin,draftId}'),started_at desc,id);
alter table catalog_private.extraction_applications enable row level security;
revoke all on catalog_private.extraction_applications from public,anon,authenticated,service_role,aicheckout_curation_executor;

create function catalog_private.list_draft_extractions(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform catalog_private.require_reviewer();
  if not exists(select 1 from catalog_private.drafts where id=p_draft_id) then
    raise exception 'Draft not found' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(item order by item.started_at desc,item.id),'[]') into result from (
    select r.id,r.card_id,r.state,r.started_at,(r.context#>>'{origin,revision}')::integer as revision,
      r.trace->>'status' as outcome,to_jsonb(a) as application
    from catalog_private.curation_runs r left join catalog_private.extraction_applications a on a.run_id=r.id
    where r.context#>>'{origin,draftId}'=p_draft_id::text order by r.started_at desc,r.id limit 20
  ) item;
  return jsonb_build_object('runs',result);
end $$;

create function catalog_private.get_draft_extraction(p_draft_id uuid,p_run_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run catalog_private.curation_runs%rowtype; application jsonb;
begin
  perform catalog_private.require_reviewer();
  select * into run from catalog_private.curation_runs where id=p_run_id and context#>>'{origin,draftId}'=p_draft_id::text;
  if not found then raise exception 'Run not found for draft' using errcode='P0002'; end if;
  select to_jsonb(a) into application from catalog_private.extraction_applications a where run_id=p_run_id;
  return jsonb_build_object('run',to_jsonb(run)-'execution_token_hash','application',application);
end $$;

create function catalog_private.apply_reviewed_extraction(p_draft_id uuid,p_run_id uuid,p_expected_revision integer,
  p_expected_hash text,p_condition_reviews jsonb,p_review_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := catalog_private.require_reviewer(); draft catalog_private.drafts%rowtype;
  run catalog_private.curation_runs%rowtype; application catalog_private.extraction_applications%rowtype;
  output jsonb; card jsonb; rule jsonb; fact jsonb; review jsonb; next_rules jsonb := '[]'::jsonb; next_cards jsonb := '[]'::jsonb;
  next_catalog jsonb; conditions integer; result jsonb;
begin
  -- Consistent lock order; live authority is rechecked after any wait.
  select * into draft from catalog_private.drafts where id=p_draft_id for update;
  if not found then raise exception 'Draft not found' using errcode='P0002'; end if;
  select * into run from catalog_private.curation_runs where id=p_run_id for update;
  perform catalog_private.require_reviewer();
  if coalesce((auth.jwt()->>'exp')::numeric,0)<=extract(epoch from clock_timestamp()) then
    raise exception 'Reviewer session expired while waiting' using errcode='42501'; end if;
  if run.id is null or run.context#>>'{origin,draftId}' is distinct from p_draft_id::text then
    raise exception 'Run not found for draft' using errcode='P0002'; end if;
  select * into application from catalog_private.extraction_applications where run_id=p_run_id;
  if found then
    -- An exact retry can acknowledge the same application while its result is still current.
    if application.from_revision=p_expected_revision and run.context#>>'{origin,catalogHash}'=p_expected_hash
      and application.condition_reviews=p_condition_reviews and application.review_note=btrim(p_review_note)
      and draft.revision=application.to_revision and draft.catalog_hash=application.result_hash then
      return jsonb_build_object('draft',to_jsonb(draft),'application',to_jsonb(application));
    end if;
    raise exception 'Application or draft changed' using errcode='40001';
  end if;
  if draft.status<>'draft' or draft.revision is distinct from p_expected_revision or draft.catalog_hash is distinct from p_expected_hash
    or run.context#>>'{origin,revision}' is distinct from draft.revision::text
    or run.context#>>'{origin,catalogHash}' is distinct from draft.catalog_hash then
    raise exception 'Extraction belongs to a different draft revision' using errcode='40001'; end if;
  output := run.trace->'extraction';
  if run.state<>'finished' or run.trace->>'status' is distinct from 'evidence_valid' or run.trace->'findings' is distinct from '[]'::jsonb
    or jsonb_typeof(output) is distinct from 'object' or output->>'cardId' is distinct from run.card_id
    or output->'issues' is distinct from '[]'::jsonb or jsonb_typeof(output->'rules') is distinct from 'array'
    or jsonb_typeof(output->'conditions') is distinct from 'array' then
    raise exception 'Extraction requires correction' using errcode='22023'; end if;
  if p_review_note is null or length(btrim(p_review_note)) not between 10 and 2000
    or jsonb_typeof(p_condition_reviews) is distinct from 'array' then
    raise exception 'Explicit human review required' using errcode='22023'; end if;
  conditions := jsonb_array_length(output->'conditions');
  if conditions>30 or jsonb_array_length(p_condition_reviews)<>conditions then
    raise exception 'Every condition requires review' using errcode='22023'; end if;
  for idx in 0..conditions-1 loop
    review := p_condition_reviews->idx;
    if jsonb_typeof(review) is distinct from 'object' or (select count(*) from jsonb_object_keys(review))<>4
      or not(review ?& array['index','coverage','ruleIds','note']) then
      raise exception 'Invalid condition review' using errcode='22023'; end if;
    if review->'index' is distinct from to_jsonb(idx) or review->>'coverage' is distinct from 'existing-rules'
      or jsonb_typeof(review->'note') is distinct from 'string' or length(btrim(review->>'note')) not between 10 and 1200
      or jsonb_typeof(review->'ruleIds') is distinct from 'array' then
      raise exception 'Invalid condition review' using errcode='22023'; end if;
    if jsonb_array_length(review->'ruleIds') not between 1 and 2
      or (select count(distinct value) from jsonb_array_elements(review->'ruleIds'))<>jsonb_array_length(review->'ruleIds')
      or exists(select 1 from jsonb_array_elements(review->'ruleIds') ref where jsonb_typeof(ref)<>'string'
        or not exists(select 1 from jsonb_array_elements(output->'rules') f where f->'ruleId'=ref)) then
      raise exception 'Condition rule reference is invalid' using errcode='22023'; end if;
  end loop;
  -- Immutable captured sources must still be attached; publication checks full metadata separately.
  if exists(select 1 from jsonb_array_elements((run.context->>'user')::jsonb->'documents') doc
    where not exists(select 1 from catalog_private.source_documents s where s.id::text=doc->>'documentId'
      and s.id=any(draft.source_document_ids) and s.content_hash=doc->>'contentHash')) then
    raise exception 'Captured sources changed' using errcode='40001'; end if;
  select value into card from jsonb_array_elements(draft.catalog->'cards') where value->>'id'=run.card_id;
  if card is null or jsonb_array_length(output->'rules')<>jsonb_array_length(card->'rules')
    or (select count(distinct value->>'ruleId') from jsonb_array_elements(output->'rules'))<>jsonb_array_length(card->'rules') then
    raise exception 'Extraction rule set changed' using errcode='22023'; end if;
  for rule in select value from jsonb_array_elements(card->'rules') loop
    select value into fact from jsonb_array_elements(output->'rules') where value->>'ruleId'=rule->>'id';
    if fact is null or fact#>>'{rateBps,state}' is distinct from 'known' or fact#>>'{activation,state}' is distinct from 'known'
      or fact#>>'{category,state}' is distinct from 'known' or fact#>>'{cap,state}' is distinct from 'known'
      or fact#>>'{category,value}' is distinct from rule->>'category' then
      raise exception 'Unresolved extraction fact' using errcode='22023'; end if;
    if fact#>>'{cap,kind}'='none' and fact#>'{cap,amountCents}'='null'::jsonb and fact#>'{cap,period}'='null'::jsonb then
      rule := rule-'annualCapCents';
    elsif fact#>>'{cap,kind}'='annual-spend' and fact#>>'{cap,period}'='calendar-year' then
      rule := jsonb_set(rule,'{annualCapCents}',fact#>'{cap,amountCents}');
    else raise exception 'Unsupported cap' using errcode='22023'; end if;
    rule := rule || jsonb_build_object('rateBps',fact#>'{rateBps,value}','requiresActivation',fact#>'{activation,value}');
    next_rules := next_rules || jsonb_build_array(rule);
  end loop;
  for card in select value from jsonb_array_elements(draft.catalog->'cards') loop
    if card->>'id'=run.card_id then card := jsonb_set(card,'{rules}',next_rules); end if;
    next_cards := next_cards || jsonb_build_array(card);
  end loop;
  next_catalog := jsonb_set(draft.catalog,'{cards}',next_cards);
  result := catalog_private.save_catalog_draft(draft.id,draft.revision,next_catalog,draft.source_document_ids,draft.base_sequence);
  insert into catalog_private.extraction_applications(run_id,draft_id,from_revision,to_revision,result_hash,applied_by,review_note,condition_reviews)
    values(run.id,draft.id,draft.revision,(result->>'revision')::integer,result->>'catalog_hash',actor,btrim(p_review_note),p_condition_reviews)
    returning * into application;
  return jsonb_build_object('draft',result,'application',to_jsonb(application));
end $$;

create function public.list_draft_extractions(p_draft_id uuid) returns jsonb language sql security invoker set search_path='' as $$
  select catalog_private.list_draft_extractions(p_draft_id); $$;
create function public.get_draft_extraction(p_draft_id uuid,p_run_id uuid) returns jsonb language sql security invoker set search_path='' as $$
  select catalog_private.get_draft_extraction(p_draft_id,p_run_id); $$;
create function public.apply_reviewed_extraction(p_draft_id uuid,p_run_id uuid,p_expected_revision integer,p_expected_hash text,p_condition_reviews jsonb,p_review_note text)
returns jsonb language sql security invoker set search_path='' as $$
  select catalog_private.apply_reviewed_extraction(p_draft_id,p_run_id,p_expected_revision,p_expected_hash,p_condition_reviews,p_review_note); $$;
revoke all on function catalog_private.list_draft_extractions(uuid),catalog_private.get_draft_extraction(uuid,uuid),
  catalog_private.apply_reviewed_extraction(uuid,uuid,integer,text,jsonb,text),public.list_draft_extractions(uuid),
  public.get_draft_extraction(uuid,uuid),public.apply_reviewed_extraction(uuid,uuid,integer,text,jsonb,text)
  from public,anon,authenticated,service_role,aicheckout_curation_executor;
grant execute on function catalog_private.list_draft_extractions(uuid),catalog_private.get_draft_extraction(uuid,uuid),
  catalog_private.apply_reviewed_extraction(uuid,uuid,integer,text,jsonb,text),public.list_draft_extractions(uuid),
  public.get_draft_extraction(uuid,uuid),public.apply_reviewed_extraction(uuid,uuid,integer,text,jsonb,text) to authenticated;
