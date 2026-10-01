-- Captured source text may be up to 120,000 characters (was 60,000). The Citi Double Cash terms
-- PDF used by the 7-card catalog is about 75,000 characters. Mirrors MAX_SOURCE_BODY_CHARS in
-- packages/catalog-review. Replacing the CHECK re-validates existing rows, which all fit.
alter table catalog_private.source_documents
  drop constraint source_documents_body_check,
  add constraint source_documents_body_check check (char_length(body) between 1 and 120000);
