// robots.txt posture for the capture tool (Evan's decision, 2026-10-06; docs/evals/generic-reader-protocol.md).
// Parsed as RFC 9309 (groups, longest match, Allow wins a tie, `*` and `$`). The protocol rule is stricter than
// RFC 9309 group selection: the rules for `User-agent: *` AND for the tool's own token both apply, and the site is
// excluded if either has `Disallow: /` (robots-disallow-all) or disallows a cart or checkout path the recipe names
// (robots-disallow-path).

/** The product token this tool answers to in robots.txt. The browser itself sends its normal Chrome user agent. */
export const ROBOTS_TOKEN = 'AICheckoutCapture';

/** Parse robots.txt into groups: [{ agents: [lowercase], rules: [{ type, path }] }]. */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let sawRule = false;
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!current || sawRule) {
        current = { agents: [], rules: [] };
        groups.push(current);
        sawRule = false;
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'allow' || field === 'disallow') {
      if (!current) continue; // rules before any user-agent line belong to no group
      sawRule = true;
      if (value === '') continue; // an empty Disallow allows everything; an empty Allow says nothing
      current.rules.push({ type: field, path: value });
    }
  }
  return groups;
}

/** Merge every group naming `agent` (lowercase; `*` for the star group) into one, or null if none names it. */
export function groupFor(groups, agent) {
  const hit = groups.filter((g) => g.agents.includes(agent));
  if (hit.length === 0) return null;
  return { agents: [agent], rules: hit.flatMap((g) => g.rules) };
}

const normalizePct = (s) => s.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase());

function patternMatches(pattern, path) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = normalizePct(body)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${re}${anchored ? '$' : ''}`).test(normalizePct(path));
}

/** RFC 9309: the longest matching rule decides; Allow wins a tie; no match means allowed. */
export function isAllowed(group, path) {
  if (!group) return true;
  let best = null;
  for (const rule of group.rules) {
    if (!patternMatches(rule.path, path)) continue;
    const len = rule.path.length;
    if (!best || len > best.len || (len === best.len && rule.type === 'allow'))
      best = { len, type: rule.type };
  }
  return !best || best.type === 'allow';
}

const disallowsAll = (group) =>
  Boolean(group?.rules.some((r) => r.type === 'disallow' && ['/', '/*', '/*$'].includes(r.path)));

/**
 * Decide the site's robots posture before any page load.
 * fetched: { httpStatus: number|null, body: string|null } (httpStatus null = network error).
 * paths: the cart and checkout paths the recipe names.
 * Returns { posture, groups, checkedPaths, decision, stopCode }.
 */
export function robotsPosture(fetched, paths, token = ROBOTS_TOKEN) {
  const base = { groups: [], checkedPaths: [] };
  const status = fetched.httpStatus;
  if (status === null || status >= 500)
    return { ...base, posture: 'unreachable', decision: 'not-decided', stopCode: 'tool-error' };
  if (status === 401 || status === 403)
    return { ...base, posture: 'blocked', decision: 'not-decided', stopCode: 'blocked-http-403' };
  if (status === 429)
    return { ...base, posture: 'blocked', decision: 'not-decided', stopCode: 'blocked-http-429' };
  if (status >= 400) {
    return {
      ...base,
      posture: 'no-robots-4xx',
      checkedPaths: paths.map((path) => ({ path, allowed: true })),
      decision: 'allowed',
      stopCode: null,
    };
  }
  const parsed = parseRobots(fetched.body ?? '');
  const groups = [groupFor(parsed, '*'), groupFor(parsed, token.toLowerCase())].filter(Boolean);
  const checkedPaths = paths.map((path) => ({ path, allowed: groups.every((g) => isAllowed(g, path)) }));
  let decision = 'allowed';
  if (groups.some(disallowsAll)) decision = 'robots-disallow-all';
  else if (checkedPaths.some((p) => !p.allowed)) decision = 'robots-disallow-path';
  return {
    posture: 'rules',
    groups,
    checkedPaths,
    decision,
    stopCode: decision === 'allowed' ? null : decision,
  };
}
