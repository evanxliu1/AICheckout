// URL rules safe for the content scripts (no Zod, no catalog, no merchant release). The merchant
// release is matched in the worker and the extension pages only: store-match.ts. The three bundled
// store adapters that lived here were retired in Phase 15.1 (2026-10-20).

/** The reader version of a generic (`readCart`) reading, the only reader since Phase 15.1. */
export const GENERIC_READER_VERSION = 'generic-reader-v1';

/** Whether a reader may run on this URL: an http(s) page (a non-web page is `unsupported-page`). */
export function isWebUrl(rawUrl: string | undefined): boolean {
  try {
    const { protocol } = new URL(rawUrl ?? '');
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
