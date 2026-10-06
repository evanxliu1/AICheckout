// Recipe and record schemas for the Phase 12 capture tool (docs/evals/generic-reader-protocol.md#capture-posture).
// A recipe is committed data: one site's URLs, cart and checkout paths, click allowlist and steps. No code.
import { z } from 'zod';

export const RECIPE_SCHEMA = 'capture-recipe.3';
export const SITE_RECORD_SCHEMA = 'capture-site-record.3';
export const RECON_RECORD_SCHEMA = 'capture-recon-record.2';

/** Action states the robot captures, in capture order. `checkout-1` is not one since protocol .5: the operator's
 * environment refuses entering a checkout, so it is a reported gap deferred to the attended step. */
export const ACTION_STATES = ['empty-cart', 'minicart-1', 'cart-1', 'cart-qty2', 'cart-2items'];
/** Snapshot names: action states, the terms page, and operator views (`view-01`…) that are never page-states. */
export const SnapshotName = z.union([z.enum([...ACTION_STATES, 'terms']), z.string().regex(/^view-\d{2}$/)]);

/** Exclusion codes at capture, verbatim from the protocol (generic-reader-protocol.4). An `end` step may record any
 * of them; the tool records the stop codes itself. */
export const EXCLUSION_CODES = [
  'blocked-bot-wall',
  'blocked-http-403',
  'blocked-http-429',
  'captcha',
  'blocked-extension-check',
  'add-to-cart-refused',
  'no-eligible-item',
  'needs-input',
  'sign-in-required',
  'redirected-off-domain',
  'geo-blocked',
  'not-a-store',
  'robots-disallow-all',
  'defunct',
  'tool-error',
  'would-need-forbidden-action',
];
/** Judgement exclusions that MUST carry screenshot evidence (the tool takes one on every `end` exclusion). */
export const EVIDENCE_REQUIRED = [
  'needs-input',
  'no-eligible-item',
  'add-to-cart-refused',
  'geo-blocked',
  'would-need-forbidden-action',
];

/** What an allowlisted click may be for (protocol: add-to-cart, size and colour buttons, popup close, cookie decline,
 * and the increment control for cart-qty2). `continue-as-guest` was retired in protocol .5: no session enters a
 * checkout. */
export const PURPOSES = [
  'add-to-cart',
  'option',
  'quantity-increment',
  'close-popup',
  'decline-cookies',
];
/** The only purposes a reconnaissance session may click: it looks, it never adds, chooses or continues. */
export const RECON_PURPOSES = ['close-popup', 'decline-cookies'];

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
export const isLoopback = (host) => LOOPBACK.has(host);

/** True when `host` is `domain` or a subdomain of it. `domain` is the frame's registrable domain. */
export function sameSite(host, domain) {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h === domain || h.endsWith(`.${domain}`);
}

const Domain = z
  .string()
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]{1,59})$|^127\.0\.0\.1$/,
    'lowercase registrable domain (any country; IDN as punycode)',
  );

export const Target = z.union([
  z
    .object({
      role: z.enum(['button', 'link', 'radio', 'tab', 'menuitem', 'option', 'heading', 'dialog']),
      name: z.string().min(1).max(120),
      exact: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      selector: z
        .string()
        .min(1)
        .max(300)
        .refine((v) => !/internal:|>>/.test(v), 'selectors may not chain engines or enter frames'),
    })
    .strict(),
]);

const Url = z.string().url().max(2000);
const Path = z
  .string()
  .regex(/^\/[^\s#]*$/, 'absolute path')
  .max(300);
const SessionId = z.string().regex(/^\d{8}T\d{6}Z$/);

/** What a reconnaissance session found, given with its `end` step; the tool writes the draft recipe from it. */
export const Findings = z
  .object({
    listingUrl: Url,
    productUrls: z.array(Url).min(1).max(2),
    cartPath: Path,
    checkoutPaths: z.array(Path).max(3),
    termsUrl: Url.optional(),
    // Protocol .5: items whose add-to-cart control was enabled (so in stock) while the page's structured data said
    // out of stock or backorder. Recorded in the reconnaissance record; never in the recipe.
    stockMismatch: z.array(Url).max(2).optional(),
  })
  .strict()
  .refine((f) => (f.stockMismatch ?? []).every((u) => f.productUrls.includes(u)), {
    message: 'stockMismatch names only the found items',
    path: ['stockMismatch'],
  });

export const StepSchema = z.union([
  z.object({ do: z.literal('goto'), url: Url }).strict(),
  z.object({ do: z.literal('click'), target: Target, purpose: z.enum(PURPOSES).optional() }).strict(),
  z.object({ do: z.literal('wait'), ms: z.number().int().min(0).max(30_000) }).strict(),
  z
    .object({
      do: z.literal('wait'),
      for: Target,
      timeoutMs: z.number().int().min(100).max(30_000).optional(),
    })
    .strict(),
  z.object({ do: z.literal('snapshot'), state: SnapshotName }).strict(),
  z
    .object({
      do: z.literal('end'),
      exclusion: z.enum(EXCLUSION_CODES).optional(),
      findings: Findings.optional(),
      notReached: z
        .array(
          z.object({ state: z.enum(ACTION_STATES), reason: z.string().regex(/^[a-z0-9-]{1,60}$/) }).strict(),
        )
        .max(6)
        .optional(),
    })
    .strict(),
]);

export const AllowEntry = z.object({ purpose: z.enum(PURPOSES), target: Target }).strict();

export const sameTarget = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const canon = (t) =>
  'selector' in t ? { selector: t.selector } : { role: t.role, name: t.name, exact: Boolean(t.exact) };

export const Recipe = z
  .object({
    schema: z.literal(RECIPE_SCHEMA),
    domain: Domain,
    origin: Url,
    listingUrl: Url,
    productUrls: z.array(Url).min(1).max(2),
    cartPath: Path,
    // Kept only for robots.txt posture reporting: never a visit target. The driver refuses a goto to any of them and
    // stops on landing at one (protocol .5: no session enters a checkout).
    checkoutPaths: z.array(Path).max(3),
    termsUrl: Url.optional(),
    allowlist: z.array(AllowEntry).max(20),
    steps: z.array(StepSchema).max(80),
    // The reconnaissance session the recipe was written from (required for every real site; capture.mjs checks it).
    recon: z.object({ sessionId: SessionId }).strict().optional(),
    // The host the reconnaissance loaded the cart path on (another host of the site is allowed for the cart).
    cartHost: z
      .string()
      .regex(/^[a-z0-9.-]{1,253}(:\d{1,5})?$/)
      .optional(),
    notes: z.string().max(300).optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const urls = [
      ['origin', r.origin],
      ['listingUrl', r.listingUrl],
      ...r.productUrls.map((u, i) => [`productUrls.${i}`, u]),
      ...(r.termsUrl ? [['termsUrl', r.termsUrl]] : []),
      ...r.steps.flatMap((s, i) => (s.do === 'goto' ? [[`steps.${i}.url`, s.url]] : [])),
    ];
    for (const [where, u] of urls) {
      const url = new URL(u);
      if (!sameSite(url.hostname, r.domain))
        ctx.addIssue({ code: 'custom', message: `${where} is off-site`, path: [where] });
      const local = isLoopback(url.hostname);
      if (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
        ctx.addIssue({ code: 'custom', message: `${where} must be https`, path: [where] });
      if (url.username || url.password)
        ctx.addIssue({ code: 'custom', message: `${where} has credentials`, path: [where] });
    }
    if (new URL(r.origin).pathname !== '/' || new URL(r.origin).search)
      ctx.addIssue({ code: 'custom', message: 'origin must be scheme://host only', path: ['origin'] });
    r.allowlist.forEach((a, i) => {
      if (r.allowlist.findIndex((b) => b.purpose === a.purpose && sameTarget(b.target, a.target)) !== i)
        ctx.addIssue({ code: 'custom', message: 'duplicate allowlist entry', path: ['allowlist', i] });
    });
    r.steps.forEach((s, i) => {
      if (
        s.do === 'click' &&
        s.purpose &&
        !r.allowlist.some((a) => a.purpose === s.purpose && sameTarget(a.target, s.target))
      )
        ctx.addIssue({ code: 'custom', message: 'click purpose not on the allowlist', path: ['steps', i] });
      if (s.do === 'end' && i !== r.steps.length - 1)
        ctx.addIssue({ code: 'custom', message: 'end must be the last step', path: ['steps', i] });
      if (s.do === 'end' && s.findings)
        ctx.addIssue({ code: 'custom', message: 'findings belong to a reconnaissance session', path: ['steps', i] });
    });
    if (r.cartHost && !sameSite(r.cartHost.replace(/:\d+$/, ''), r.domain))
      ctx.addIssue({ code: 'custom', message: 'cartHost is off-site', path: ['cartHost'] });
  });

const Sha = z.string().regex(/^[0-9a-f]{64}$/);
/** A URL as committed in a site record: no query string or fragment (see committableUrl in capture.mjs). */
const CommittedUrl = Url.refine(
  (u) => !new URL(u).search && !new URL(u).hash,
  'no query or fragment in committed URLs',
);
const RobotsGroup = z
  .object({
    agents: z.array(z.string()),
    rules: z.array(z.object({ type: z.enum(['allow', 'disallow']), path: z.string() }).strict()),
  })
  .strict();
const RobotsDecision = z.enum(['allowed', 'robots-disallow-all', 'not-decided']);
const RobotsPosture = z.enum(['rules', 'no-robots-4xx', 'unreachable', 'blocked']);
/** robots.txt of a host other than the entry host that the session loaded (a cart or storefront subdomain). */
const RobotsHost = z
  .object({
    host: z.string().regex(/^[a-z0-9.:-]{1,260}$/),
    url: Url,
    httpStatus: z.number().int().nullable(),
    sha256: Sha.nullable(),
    posture: RobotsPosture,
    groups: z.array(RobotsGroup),
    decision: RobotsDecision,
  })
  .strict();
const Stop = z
  .object({
    code: z.enum(EXCLUSION_CODES),
    detail: z.string().regex(/^[a-z0-9:-]{1,80}$/, 'a reason code, never free text'),
    evidenceSha256: Sha.nullable(),
  })
  .strict();
const Event = z
  .object({
    kind: z.string().regex(/^[a-z-]{1,40}$/),
    detail: z.string().regex(/^[A-Za-z0-9 .:_[\]-]{0,200}$/),
  })
  .strict();
const Session = z
  .object({
    id: SessionId,
    number: z.number().int().min(1).max(2),
    startedAt: z.string(),
    endedAt: z.string(),
    topLevelNavigations: z.number().int().min(0),
    // Every main-frame navigation request, redirects and script navigations included (reported only).
    navigationRequests: z.number().int().min(0),
  })
  .strict();

/** The text-free per-site record a session writes; 12.3 merges these into the committed sites.json. */
export const SiteRecord = z
  .object({
    schema: z.literal(SITE_RECORD_SCHEMA),
    domain: Domain,
    recipeSha256: Sha,
    tool: z.object({ version: z.string(), browser: z.string(), userAgentToken: z.string() }).strict(),
    recon: z.object({ sessionId: SessionId }).strict().nullable(),
    session: Session,
    robots: z
      .object({
        url: Url,
        httpStatus: z.number().int().nullable(),
        sha256: Sha.nullable(),
        posture: RobotsPosture,
        groups: z.array(RobotsGroup),
        // Each recipe path with the host whose rules were applied (the cart host for cartPath).
        checkedPaths: z.array(z.object({ path: z.string(), host: z.string(), allowed: z.boolean() }).strict()),
        decision: RobotsDecision,
      })
      .strict(),
    robotsHosts: z.array(RobotsHost),
    terms: z
      .object({
        url: CommittedUrl.nullable(),
        copySha256: Sha.nullable(),
        prohibitsAutomated: z.enum(['yes', 'no', 'unknown']),
      })
      .strict(),
    states: z.array(
      z
        .object({
          state: SnapshotName,
          url: CommittedUrl,
          manifestSha256: Sha,
          domSha256: Sha,
          viewportSha256: Sha,
          // Whether robots.txt of the page's host allows its path (recorded and reported, never excluding).
          robotsAllowed: z.boolean().nullable(),
        })
        .strict(),
    ),
    notReached: z.array(z.object({ state: z.enum(ACTION_STATES), reason: z.string() }).strict()),
    platform: z.object({ group: z.string(), marker: z.string().nullable() }).strict().nullable(),
    events: z.array(Event),
    stop: Stop.nullable(),
    outcome: z
      .object({
        status: z.enum(['captured', 'excluded', 'incomplete']),
        code: z.enum(EXCLUSION_CODES).nullable(),
        evidenceSha256: Sha.nullable(),
      })
      .strict(),
  })
  .strict();

/**
 * The text-free record of a reconnaissance session: look only (goto, plain click, wait, non-counting `view-NN`
 * snapshots), never labelled, never used for platform detection. `done` means the operator recorded findings and the
 * tool wrote the draft recipe; `excluded` means a stop or an `end` exclusion, and no capture session follows.
 */
export const ReconRecord = z
  .object({
    schema: z.literal(RECON_RECORD_SCHEMA),
    domain: Domain,
    entryUrl: Url,
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    priceBand: z.tuple([z.number(), z.number()]).nullable(),
    tool: z.object({ version: z.string(), browser: z.string(), userAgentToken: z.string() }).strict(),
    session: Session,
    robots: z
      .object({
        url: Url,
        httpStatus: z.number().int().nullable(),
        sha256: Sha.nullable(),
        posture: RobotsPosture,
        groups: z.array(RobotsGroup),
        decision: RobotsDecision,
      })
      .strict(),
    robotsHosts: z.array(RobotsHost),
    views: z.number().int().min(0),
    // Each goto to the entry origin: the server redirect chain and where it landed (masked URLs).
    homeLandings: z
      .array(
        z
          .object({ requested: CommittedUrl, chain: z.array(CommittedUrl), landed: CommittedUrl, sameSite: z.boolean() })
          .strict(),
      )
      .max(25),
    // Every page the session landed on, in order, as committable URLs (no query, token-like segments masked).
    navigation: z.array(CommittedUrl).max(200),
    // Found items whose structured data disagreed with an enabled add-to-cart control (masked URLs).
    stockMismatch: z.array(CommittedUrl).max(2),
    events: z.array(Event),
    stop: Stop.nullable(),
    outcome: z
      .object({
        status: z.enum(['done', 'excluded', 'incomplete']),
        code: z.enum(EXCLUSION_CODES).nullable(),
        evidenceSha256: Sha.nullable(),
        draftRecipeSha256: Sha.nullable(),
      })
      .strict(),
  })
  .strict();

/**
 * Input of a reconnaissance session: the frame's registrable domain and entry host (as `entryUrl`), the storefront
 * currency the frame predicts and its item price band, an allowlist of popup and cookie controls only, and optional
 * steps (the operator otherwise drives it over the control server).
 */
export const ReconSpec = z
  .object({
    domain: Domain,
    entryUrl: Url,
    // The frame's storefront hosts: listing and product URLs must be on one of them.
    hosts: z.array(z.string().min(1)).min(1),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    priceBand: z.tuple([z.number(), z.number()]).nullable(),
    allowlist: z
      .array(z.object({ purpose: z.enum(RECON_PURPOSES), target: Target }).strict())
      .max(10)
      .default([]),
    steps: z.array(StepSchema).max(80).default([]),
  })
  .strict()
  .superRefine((r, ctx) => {
    const u = new URL(r.entryUrl);
    if (!sameSite(u.hostname, r.domain))
      ctx.addIssue({ code: 'custom', message: 'entryUrl is off-site', path: ['entryUrl'] });
    if (u.pathname !== '/' || u.search)
      ctx.addIssue({ code: 'custom', message: 'entryUrl must be scheme://host/ only', path: ['entryUrl'] });
    if (u.protocol !== 'https:' && !(isLoopback(u.hostname) && u.protocol === 'http:'))
      ctx.addIssue({ code: 'custom', message: 'entryUrl must be https', path: ['entryUrl'] });
    if (!r.hosts.includes(u.hostname))
      ctx.addIssue({ code: 'custom', message: 'entryUrl must be on one of the hosts', path: ['entryUrl'] });
  });

export function parseRecipe(json) {
  return Recipe.parse(json);
}
