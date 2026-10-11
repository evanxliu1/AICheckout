// Phase 14.5, the URL match test set (plan section 7, "wrong store match"): the frozen reader set's U.S. cart-state URLs (evals/merchants/capture/records, pane records of
// the `us` stream), and look-alike traps. The expected record is decided here by registrable domain (a label-boundary
// suffix of the URL's host that shares its registrable domain, the longest wins) and frozen in url-test-set.json;
// extension/tests/merchant-url-set.test.ts asserts the matcher agrees on every URL and that no URL matches a store of
// another registrable domain.
//
//   node evals/merchants/db/audit/build-url-set.mjs
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const OUT = join(ROOT, 'evals/merchants/db/audit/url-test-set.json');
/** Two-label public suffixes among the traps; everything else is one label (the extension test mirrors this). */
const TWO_LABEL_SUFFIXES = new Set(['co.uk', 'com.au', 'com.mx', 'co.jp', 'com.br', 'co.nz']);

/** The registrable domain of a host: the last two labels, or three under a two-label public suffix. */
export function registrable(host) {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  const suffix = labels.slice(-2).join('.');
  return TWO_LABEL_SUFFIXES.has(suffix) && labels.length > 2 ? labels.slice(-3).join('.') : suffix;
}

/** The expected record for a URL: among records with a host that is a label-boundary suffix of the URL's host and
 * shares its registrable domain, the longest host wins; null when none. */
export function expectedFor(records, url) {
  const host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  const reg = registrable(host);
  let best = null;
  for (const record of records)
    for (const authored of record.hosts) {
      const h = authored.toLowerCase();
      if ((host === h || host.endsWith(`.${h}`)) && registrable(h) === reg && (!best || h.length > best.host.length))
        best = { id: record.id, host: h };
    }
  return best?.id ?? null;
}

const TRAPS = [
  // Country and look-alike domains of released stores.
  'https://www.amazon.ca/gp/cart/view.html',
  'https://www.amazon.co.uk/',
  'https://www.target.com.au/cart',
  'https://walmartmoney.com/',
  'https://www.wal-mart.com/',
  'https://kroger.com.mx/',
  'https://notnewegg.com/cart',
  'https://www.newegg.com.evil.example/',
  'https://newegg.co/',
  'https://amazon.com.evil.example/',
  'https://a.b.c.d.amazon.com.evil.example/',
  'https://paypal.com.evil.example/checkoutnow',
  'https://shop.app.example/checkout',
  'https://www.paypal-com.example/',
  // Punycode and Unicode look-alikes.
  'https://xn--trget-gra.com/',
  'https://tärget.com/',
  'https://аmazon.com/',
  'https://xn--mazon-3ve.com/',
  'https://wаlmart.com/',
  // Redirect-only or dropped domains: never authored, so never a match.
  'https://www.jcp.com/',
  'https://www.cedarpoint.com/',
  'https://www.vudu.com/',
  'https://www.build.com/',
  'https://www.showtime.com/',
  'https://www.worldmarktheclub.com/',
  'https://www.costcobusinessdelivery.com/',
  'https://oldnavy.com/',
  'https://www.clubwyndham.com/',
  'https://www.nordstromrack.com/',
  'https://www.hy-veepharmacy.com/',
  // Stores the release does not have.
  'https://www.example-unknown-store.com/cart',
  'https://www.stripe.com/',
  'https://www.example.org/',
];

export async function main() {
  const release = JSON.parse(await readFile(join(ROOT, 'evals/merchants/db/release.json'), 'utf8'));
  const records = release.merchants;
  // Release hosts with subdomains and paths are generated in the extension test from the bundled release itself
  // (23k URLs would bloat this file); this file holds the reader set's URLs and the traps.
  const entries = [];
  const dir = join(ROOT, 'evals/merchants/capture/records');
  const seen = new Set();
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.json')).sort()) {
    const record = JSON.parse(await readFile(join(dir, name), 'utf8'));
    if (record.stream !== 'us') continue;
    if (!Array.isArray(record.states)) continue;
    for (const state of record.states) {
      if (!state.url || seen.has(state.url)) continue;
      seen.add(state.url);
      entries.push({
        group: 'reader-set-us',
        url: state.url,
        domain: record.domain,
        state: state.state,
        expected: expectedFor(records, state.url),
      });
    }
  }
  for (const url of TRAPS) {
    const expected = expectedFor(records, url);
    if (expected !== null) throw new Error(`trap ${url} resolves to ${expected}; it is not a trap`);
    entries.push({ group: 'traps', url, expected: null });
  }
  const counts = {};
  for (const e of entries) {
    counts[e.group] = counts[e.group] ?? { urls: 0, matched: 0 };
    counts[e.group].urls += 1;
    if (e.expected) counts[e.group].matched += 1;
  }
  await writeFile(
    OUT,
    `${JSON.stringify({ schemaVersion: 1, release: release.version, counts, entries }, null, 1)}\n`,
  );
  console.log(`wrote ${entries.length} URLs: ${JSON.stringify(counts)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
