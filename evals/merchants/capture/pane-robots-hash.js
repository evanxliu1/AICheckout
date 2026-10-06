// Pane robots.txt hash (generic-reader-protocol.8, checklist step 1). Run verbatim with the pane's JavaScript tool on
// the store's robots.txt page; the transcript audit recognises it by its exact text. It re-reads the same URL (a
// same-origin GET, nothing else) and returns the SHA-256 and size of the exact bytes. The operator reads the rules
// with get_page_text and records the posture; robots.txt never excludes a store under .8.
(async () => {
  const res = await fetch(location.href, { credentials: 'omit', cache: 'no-store' });
  const buf = await res.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { url: `${location.origin}${location.pathname}`, status: res.status, bytes: buf.byteLength, sha256 };
})();
