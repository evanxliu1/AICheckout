import { PILOT_CATALOG } from '@ai-checkout/rewards-core';
import type { ReviewDetail } from '@ai-checkout/catalog-review';

export const now = Date.parse('2026-09-26T10:00:00Z');
export function reviewFixture(): ReviewDetail {
  const catalog = structuredClone(PILOT_CATALOG);
  const sources = catalog.sources.map((source, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    source_key: source.id,
    title: source.title,
    url: source.url,
    checked_on: source.checkedOn,
    body: 'Synthetic test evidence. <img src=x onerror=alert(1)>',
    content_hash: 'a'.repeat(64),
    created_by: null,
    created_at: '2026-09-25T00:00:00Z',
  }));
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
