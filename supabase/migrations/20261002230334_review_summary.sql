-- Stage 2 M8: review a large catalog without loading every captured text.
-- get_catalog_review returns each attached capture with its full body; a catalog v3 draft cites up to
-- 600 sources of up to 250,000 characters each, far over the API's 8 MiB review response cap.
-- get_catalog_review_summary returns the same draft, head and published snapshot with source metadata
-- only (body length instead of the body); get_catalog_review_source returns one attached capture with
-- its body, on demand. get_catalog_review stays unchanged for the extraction routes, which need the
-- bodies of at most three sources.

create function catalog_private.get_catalog_review_summary(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := catalog_private.require_reviewer();
  draft catalog_private.drafts%rowtype;
  documents jsonb;
  current_head bigint;
  published jsonb;
begin
  if p_draft_id is null then raise exception 'Draft not found' using errcode='P0002'; end if;
  -- Head and snapshot in one statement, as in get_catalog_review.
  select h.release_sequence, case when r.sequence is null then null else to_jsonb(r) end
    into current_head,published from public.catalog_head h
    left join public.catalog_releases r on r.sequence=h.release_sequence where h.singleton;
  select * into draft from catalog_private.drafts where id=p_draft_id;
  if not found then raise exception 'Draft not found' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',s.id,'source_key',s.source_key,'title',s.title,'url',s.url,'checked_on',s.checked_on,
      'body_chars',char_length(s.body),'content_hash',s.content_hash,'created_by',s.created_by,
      'created_at',s.created_at) order by s.source_key), '[]') into documents
    from catalog_private.source_documents s where id=any(draft.source_document_ids);
  return jsonb_build_object('reviewerId',actor,'draft',to_jsonb(draft),'sources',documents,
    'head',current_head,'published',published);
end;
$$;

-- Only a capture attached to the named draft is returned, so a reviewer reads evidence in the
-- context of a draft, as with get_catalog_review.
create function catalog_private.get_catalog_review_source(p_draft_id uuid, p_source_document_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  document jsonb;
begin
  perform catalog_private.require_reviewer();
  select to_jsonb(s) into document
    from catalog_private.drafts d
    join catalog_private.source_documents s on s.id=p_source_document_id
    where d.id=p_draft_id and p_source_document_id=any(d.source_document_ids);
  if document is null then raise exception 'Source not found' using errcode='P0002'; end if;
  return document;
end;
$$;

create function public.get_catalog_review_summary(p_draft_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select catalog_private.get_catalog_review_summary(p_draft_id);
$$;
create function public.get_catalog_review_source(p_draft_id uuid, p_source_document_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select catalog_private.get_catalog_review_source(p_draft_id, p_source_document_id);
$$;

revoke all on function catalog_private.get_catalog_review_summary(uuid),
  catalog_private.get_catalog_review_source(uuid,uuid),
  public.get_catalog_review_summary(uuid), public.get_catalog_review_source(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function catalog_private.get_catalog_review_summary(uuid),
  catalog_private.get_catalog_review_source(uuid,uuid),
  public.get_catalog_review_summary(uuid), public.get_catalog_review_source(uuid,uuid)
  to authenticated;
