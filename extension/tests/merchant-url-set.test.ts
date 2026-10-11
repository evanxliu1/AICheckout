import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MERCHANTS_V1, buildMerchantIndex, matchMerchant } from '../src/domain';

/* Phase 14.5, the URL match test set (plan section 7, "wrong store match"): every bundled host with
 * subdomains and checkout-like paths, the frozen reader set's U.S. cart-state URLs and look-alike traps
 * (evals/merchants/db/audit/url-test-set.json, built by build-url-set.mjs from the release the test asserts
 * is the bundled one). A wrong store match is a URL matched to a record whose host is not a label-boundary
 * suffix of the URL's host sharing its registrable domain. */

interface UrlSet {
  release: string;
  entries: { group: string; url: string; expected: string | null }[];
}
// vitest runs with the extension directory as cwd (manual-reader.test.ts reads its fixtures the same way).
const set = JSON.parse(readFileSync('../evals/merchants/db/audit/url-test-set.json', 'utf8')) as UrlSet;
const index = buildMerchantIndex(MERCHANTS_V1.merchants);
const idAt = (url: string) => matchMerchant(index, url)?.record.id ?? null;

const TWO_LABEL_SUFFIXES = new Set(['co.uk', 'com.au', 'com.mx', 'co.jp', 'com.br', 'co.nz']);
const registrable = (host: string): string => {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  const suffix = labels.slice(-2).join('.');
  return TWO_LABEL_SUFFIXES.has(suffix) && labels.length > 2 ? labels.slice(-3).join('.') : suffix;
};
/** The reference expectation: the longest authored host that is a label-boundary suffix of the URL's host and
 * shares its registrable domain. */
const expectedFor = (url: string): string | null => {
  const host = new URL(url).hostname.toLowerCase();
  let best: { id: string; host: string } | null = null;
  for (const record of MERCHANTS_V1.merchants)
    for (const authored of record.hosts) {
      const h = authored.toLowerCase();
      if (
        (host === h || host.endsWith(`.${h}`)) &&
        registrable(h) === registrable(host) &&
        (!best || h.length > best.host.length)
      )
        best = { id: record.id, host: h };
    }
  return best?.id ?? null;
};

describe('the URL match test set', () => {
  it('was built from the bundled release', () => {
    expect(set.release).toBe(MERCHANTS_V1.version);
  });

  it('matches every bundled host, with subdomains and checkout-like paths, to its own record', () => {
    const paths = ['/', '/cart', '/checkout', '/checkout/cart', '/bag', '/shop/cart?x=1#y'];
    const subdomains = ['', 'www.', 'secure.', 'checkout.', 'www.secure.', 'a.b.c.'];
    const wrong: string[] = [];
    let urls = 0;
    for (const record of MERCHANTS_V1.merchants)
      for (const host of record.hosts)
        for (const sub of subdomains)
          for (const path of paths) {
            const url = `https://${sub}${host}${path}`;
            urls += 1;
            const match = matchMerchant(index, url);
            const expected = expectedFor(url);
            if (match?.record.id !== expected)
              wrong.push(`${url} → ${match?.record.id ?? null}, expected ${expected}`);
            else if (match && registrable(match.host) !== registrable(new URL(url).hostname))
              wrong.push(`${url} → ${match.record.id} on ${match.host}, another registrable domain`);
          }
    expect(urls).toBeGreaterThan(20000);
    expect(wrong).toEqual([]);
  });

  it("matches the frozen reader set's U.S. cart URLs only to the store they belong to", () => {
    const entries = set.entries.filter((e) => e.group === 'reader-set-us');
    expect(entries.length).toBeGreaterThan(300);
    const wrong = entries
      .filter((e) => idAt(e.url) !== e.expected || (e.expected && idAt(e.url) !== expectedFor(e.url)))
      .map((e) => `${e.url} → ${idAt(e.url)}, expected ${e.expected}`);
    expect(wrong).toEqual([]);
    expect(entries.filter((e) => e.expected).length).toBeGreaterThan(300);
  });

  it('matches none of the look-alike traps', () => {
    const traps = set.entries.filter((e) => e.group === 'traps');
    expect(traps.length).toBeGreaterThan(30);
    for (const trap of traps) {
      expect(trap.expected).toBeNull();
      expect(idAt(trap.url), trap.url).toBeNull();
    }
  });
});
