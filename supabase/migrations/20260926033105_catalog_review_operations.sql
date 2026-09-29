-- The API forwards the human's verified Supabase session to these RPCs. It does not
-- need a service-role key or a database-owner connection. These are not model tools.
create function catalog_private.capture_source(
  p_source_key text, p_title text, p_url text, p_checked_on date, p_body text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := catalog_private.require_reviewer();
  captured catalog_private.source_documents%rowtype;
begin
  if p_checked_on is null or p_checked_on > (now() at time zone 'UTC')::date then
    raise exception 'Source date cannot be in the future' using errcode='22023';
  end if;
  insert into catalog_private.source_documents(source_key,title,url,checked_on,body,created_by)
    values(p_source_key,p_title,p_url,p_checked_on,p_body,actor)
    on conflict(source_key,content_hash,checked_on) do nothing returning * into captured;
  if not found then
    select * into captured from catalog_private.source_documents
    where source_key=p_source_key and content_hash=encode(extensions.digest(p_body,'sha256'),'hex')
      and checked_on=p_checked_on;
    if captured.title is distinct from p_title or captured.url is distinct from p_url then
      raise exception 'Existing source capture has different metadata' using errcode='22023';
    end if;
  end if;
  return to_jsonb(captured);
end;
$$;

create function catalog_private.save_catalog_draft(
  p_id uuid, p_expected_revision integer, p_catalog jsonb, p_source_document_ids uuid[], p_base_sequence bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := catalog_private.require_reviewer();
  draft catalog_private.drafts%rowtype;
begin
  if p_source_document_ids is null or cardinality(p_source_document_ids) > 30
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

create function catalog_private.get_catalog_review(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := catalog_private.require_reviewer();
  draft catalog_private.drafts%rowtype;
  documents jsonb;
  queue jsonb;
begin
  if p_draft_id is null then
    select coalesce(jsonb_agg(to_jsonb(item)), '[]') into queue from (
      select id,revision,status,catalog->>'version' as version,updated_at,base_sequence
      from catalog_private.drafts where status='draft' order by updated_at desc,id limit 30
    ) item;
    return jsonb_build_object('reviewerId',actor,'drafts',queue,'head',(
      select release_sequence from public.catalog_head where singleton
    ));
  end if;
  select * into draft from catalog_private.drafts where id=p_draft_id;
  if not found then raise exception 'Draft not found' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.source_key), '[]') into documents
    from catalog_private.source_documents s where id=any(draft.source_document_ids);
  return jsonb_build_object('reviewerId',actor,'draft',to_jsonb(draft),'sources',documents,'head',(
    select release_sequence from public.catalog_head where singleton
  ));
end;
$$;

create function public.capture_catalog_source(
  p_source_key text, p_title text, p_url text, p_checked_on date, p_body text
) returns jsonb language sql security invoker set search_path = '' as $$
  select catalog_private.capture_source(p_source_key,p_title,p_url,p_checked_on,p_body);
$$;
create function public.save_catalog_draft(
  p_id uuid, p_expected_revision integer, p_catalog jsonb, p_source_document_ids uuid[], p_base_sequence bigint
) returns jsonb language sql security invoker set search_path = '' as $$
  select catalog_private.save_catalog_draft(p_id,p_expected_revision,p_catalog,p_source_document_ids,p_base_sequence);
$$;
create function public.get_catalog_review(p_draft_id uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select catalog_private.get_catalog_review(p_draft_id);
$$;

revoke all on function catalog_private.capture_source(text,text,text,date,text),
  catalog_private.save_catalog_draft(uuid,integer,jsonb,uuid[],bigint),catalog_private.get_catalog_review(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.capture_catalog_source(text,text,text,date,text),
  public.save_catalog_draft(uuid,integer,jsonb,uuid[],bigint),public.get_catalog_review(uuid)
  from public, anon, authenticated, service_role;
grant execute on function catalog_private.capture_source(text,text,text,date,text),
  catalog_private.save_catalog_draft(uuid,integer,jsonb,uuid[],bigint),catalog_private.get_catalog_review(uuid)
  to authenticated;
grant execute on function public.capture_catalog_source(text,text,text,date,text),
  public.save_catalog_draft(uuid,integer,jsonb,uuid[],bigint),public.get_catalog_review(uuid)
  to authenticated;
