-- Reviewers need the current snapshot even after it expires. Checkout's public API
-- still refuses expired terms. Read the head and snapshot together, then bind any
-- eventual approval to that exact head through the existing publication RPC.
create or replace function catalog_private.get_catalog_review(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := catalog_private.require_reviewer();
  draft catalog_private.drafts%rowtype;
  documents jsonb;
  queue jsonb;
  current_head bigint;
  published jsonb;
begin
  select h.release_sequence, case when r.sequence is null then null else to_jsonb(r) end
    into current_head,published from public.catalog_head h
    left join public.catalog_releases r on r.sequence=h.release_sequence where h.singleton;
  if p_draft_id is null then
    select coalesce(jsonb_agg(to_jsonb(item)), '[]') into queue from (
      select id,revision,status,catalog->>'version' as version,updated_at,base_sequence
      from catalog_private.drafts where status='draft' order by updated_at desc,id limit 30
    ) item;
    return jsonb_build_object('reviewerId',actor,'drafts',queue,'head',current_head);
  end if;
  select * into draft from catalog_private.drafts where id=p_draft_id;
  if not found then raise exception 'Draft not found' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.source_key), '[]') into documents
    from catalog_private.source_documents s where id=any(draft.source_document_ids);
  return jsonb_build_object('reviewerId',actor,'draft',to_jsonb(draft),'sources',documents,
    'head',current_head,'published',published);
end;
$$;
