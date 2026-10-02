import { PILOT_CATALOG, type Catalog } from '@ai-checkout/rewards-core';
import type { ReviewSummary, SourceSummary } from '@ai-checkout/catalog-review';

export const now = Date.parse('2026-09-26T10:00:00Z');
/** Text of every synthetic capture; the review summary lists only its length. */
export const SOURCE_BODY = 'Synthetic test evidence. <img src=x onerror=alert(1)>';
export const sourceId = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Captured metadata for each of the catalog's sources, as the review summary lists them. */
export function capturedSources(catalog: Catalog): SourceSummary[] {
  return catalog.sources.map((source, index) => ({
    id: sourceId(index + 1),
    source_key: source.id,
    title: source.title,
    url: source.url,
    checked_on: source.checkedOn,
    body_chars: SOURCE_BODY.length,
    content_hash: 'a'.repeat(64),
    created_by: null,
    created_at: '2026-09-25T00:00:00Z',
  }));
}

export function reviewFixture(catalog: Catalog = structuredClone(PILOT_CATALOG)): ReviewSummary {
  const sources = capturedSources(catalog);
  return {
    reviewerId: '10000000-0000-4000-8000-000000000001',
    head: null,
    published: null,
    sources,
    draft: {
      id: '30000000-0000-4000-8000-000000000001',
      catalog,
      catalog_hash: 'b'.repeat(64),
      source_document_ids: sources.map((source) => source.id),
      base_sequence: null,
      revision: 1,
      status: 'draft',
      created_by: null,
      created_at: '2026-09-25T00:00:00Z',
      updated_at: '2026-09-25T00:00:00Z',
    },
  };
}

/** The full capture for a summary entry, as `GET /drafts/:id/sources/:sourceId` returns it. */
export function sourceDocument(summary: SourceSummary, body = SOURCE_BODY) {
  const document: Omit<SourceSummary, 'body_chars'> & { body_chars?: number } = { ...summary };
  delete document.body_chars;
  return { ...document, body };
}
