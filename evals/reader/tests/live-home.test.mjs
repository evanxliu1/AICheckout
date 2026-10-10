// live-home.mjs without a browser: robots.txt parsing and matching, challenge detection, the inputs, and the
// text-free summary with its bounds.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isChallenge, loadInputs, parseRobots, robotsAllows, summarizeLive } from '../live-home.mjs';

test('parseRobots keeps only the generic agent groups and robotsAllows matches longest-first', () => {
  const rules = parseRobots(`# comment
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /cart
Disallow: /checkout/
Allow: /checkout/help
Disallow:
`);
  assert.deepEqual(rules, { allow: ['/checkout/help'], disallow: ['/cart', '/checkout/'] });
  assert.equal(robotsAllows(rules, '/'), true);
  assert.equal(robotsAllows(rules, '/cart'), false);
  assert.equal(robotsAllows(rules, '/checkout/payment'), false);
  assert.equal(robotsAllows(rules, '/checkout/help'), true);
  // A full disallow for everyone, agents listed together in one group, and wildcards.
  assert.equal(robotsAllows(parseRobots('User-agent: a\nUser-agent: *\nDisallow: /'), '/'), false);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /*.pdf$'), '/'), true);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow: /*.pdf$'), '/a.pdf'), false);
  assert.equal(robotsAllows(parseRobots(''), '/'), true);
});

test('isChallenge: 4xx/5xx or a challenge title, never page text', () => {
  assert.equal(isChallenge(403, 'Home'), true);
  assert.equal(isChallenge(503, ''), true);
  assert.equal(isChallenge(200, 'Just a moment...'), true);
  assert.equal(isChallenge(200, 'Access Denied'), true);
  assert.equal(isChallenge(200, 'Acme Outdoor Co'), false);
  assert.equal(isChallenge(200, ''), false);
});

test('loadInputs lists every split store once plus the committed non-store sites', () => {
  const sites = loadInputs();
  const stores = sites.filter((s) => s.set === 'store');
  const others = sites.filter((s) => s.set === 'non-store');
  assert.ok(stores.length >= 300, `stores ${stores.length}`);
  assert.ok(others.length >= 50, `non-store ${others.length}`);
  assert.equal(new Set(sites.map((s) => s.domain)).size, sites.length);
  for (const s of sites) assert.match(s.domain, /^[a-z0-9.-]+$/);
});

test('summarizeLive counts statuses, false shows with an exact upper bound, and names shown domains by reason only', () => {
  const row = (domain, set, status, page = 'none', reason = 'no-hint', hinted = false, ms = 0.2) => ({
    domain,
    set,
    url: `https://${domain}/`,
    status,
    page: status === 'loaded' ? page : null,
    reason: status === 'loaded' ? reason : status === 'blocked' ? 'http-403' : null,
    hinted: status === 'loaded' ? hinted : null,
    ms: status === 'loaded' ? ms : null,
  });
  const s = summarizeLive([
    row('a.example', 'store', 'loaded'),
    row('b.example', 'store', 'loaded', 'cart', 'url-summary', true, 9),
    row('c.example', 'store', 'blocked'),
    row('d.example', 'store', 'robots-disallowed'),
    row('e.example', 'non-store', 'loaded'),
    row('f.example', 'non-store', 'error'),
  ]);
  assert.deepEqual(s.all.status, { loaded: 3, blocked: 1, 'robots-disallowed': 1, error: 1 });
  assert.equal(s.all.falseShows.k, 1);
  assert.equal(s.all.falseShows.n, 3);
  assert.equal(s.all.falseShows.clopperPearsonUpper95, 0.865);
  assert.deepEqual(s.store.shownDomains, [{ domain: 'b.example', page: 'cart', reason: 'url-summary' }]);
  assert.equal(s.nonStore.falseShows.k, 0);
  assert.equal(s.nonStore.falseShows.clopperPearsonUpper95, 0.95);
  assert.equal(s.all.hinted, 1);
  assert.equal(s.all.detectMs.hinted.max, 9);
  assert.equal(s.all.detectMs.unhinted.n, 2);
  assert.doesNotMatch(JSON.stringify(s), /Order total|<|\$/);
});
