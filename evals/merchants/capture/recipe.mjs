// Recipe and record schemas for the Phase 12 capture tool (docs/evals/generic-reader-protocol.md#capture-posture).
// A recipe is committed data: one site's URLs, cart and checkout paths, click allowlist and steps. No code.
import { z } from 'zod';

export const RECIPE_SCHEMA = 'capture-recipe.1';
export const SITE_RECORD_SCHEMA = 'capture-site-record.1';

/** Action states of the protocol, in capture order. */
export const ACTION_STATES = ['empty-cart', 'minicart-1', 'cart-1', 'checkout-1', 'cart-qty2', 'cart-2items'];
/** Snapshot names: action states, the terms page, and operator views (`view-01`…) that are never page-states. */
export const SnapshotName = z.union([z.enum([...ACTION_STATES, 'terms']), z.string().regex(/^view-\d{2}$/)]);

/** Exclusion codes at capture, verbatim from the protocol. */
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
  'non-us-storefront',
  'not-a-store',
  'robots-disallow-all',
  'robots-disallow-path',
  'defunct',
  'tool-error',
  'would-need-forbidden-action',
];
/** Judgement exclusions: the operator decides them, and they need screenshot evidence. */
export const JUDGEMENT_CODES = [
  'needs-input',
  'no-eligible-item',
  'add-to-cart-refused',
  'would-need-forbidden-action',
  'non-us-storefront',
  'not-a-store',
  'defunct',
];
export const EVIDENCE_REQUIRED = [
  'needs-input',
  'no-eligible-item',
  'add-to-cart-refused',
  'would-need-forbidden-action',
];

/** What an allowlisted click may be for (protocol: add-to-cart, size and colour buttons, popup close, cookie decline,
 * non-form continue-as-guest, and the increment control for cart-qty2). */
export const PURPOSES = [
  'add-to-cart',
  'option',
  'quantity-increment',
  'close-popup',
  'decline-cookies',
  'continue-as-guest',
];

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
      exclusion: z.enum(JUDGEMENT_CODES).optional(),
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
    checkoutPaths: z.array(Path).max(3),
    termsUrl: Url.optional(),
    allowlist: z.array(AllowEntry).max(20),
    steps: z.array(StepSchema).max(80),
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
    });
  });

const Sha = z.string().regex(/^[0-9a-f]{64}$/);
const RobotsGroup = z
  .object({
    agents: z.array(z.string()),
    rules: z.array(z.object({ type: z.enum(['allow', 'disallow']), path: z.string() }).strict()),
  })
  .strict();

/** The text-free per-site record a session writes; 12.3 merges these into the committed sites.json. */
export const SiteRecord = z
  .object({
    schema: z.literal(SITE_RECORD_SCHEMA),
    domain: Domain,
    recipeSha256: Sha,
    tool: z.object({ version: z.string(), browser: z.string(), userAgentToken: z.string() }).strict(),
    session: z
      .object({
        id: z.string().regex(/^\d{8}T\d{6}Z$/),
        number: z.number().int().min(1).max(2),
        startedAt: z.string(),
        endedAt: z.string(),
        topLevelNavigations: z.number().int().min(0),
      })
      .strict(),
    robots: z
      .object({
        url: Url,
        httpStatus: z.number().int().nullable(),
        sha256: Sha.nullable(),
        posture: z.enum(['rules', 'no-robots-4xx', 'unreachable', 'blocked']),
        groups: z.array(RobotsGroup),
        checkedPaths: z.array(z.object({ path: z.string(), allowed: z.boolean() }).strict()),
        decision: z.enum(['allowed', 'robots-disallow-all', 'robots-disallow-path', 'not-decided']),
      })
      .strict(),
    terms: z
      .object({
        url: Url.nullable(),
        copySha256: Sha.nullable(),
        prohibitsAutomated: z.enum(['yes', 'no', 'unknown']),
      })
      .strict(),
    states: z.array(
      z
        .object({ state: SnapshotName, url: Url, manifestSha256: Sha, domSha256: Sha, viewportSha256: Sha })
        .strict(),
    ),
    notReached: z.array(z.object({ state: z.enum(ACTION_STATES), reason: z.string() }).strict()),
    thirdPartyCheckoutHost: z.string().nullable(),
    platform: z.object({ group: z.string(), marker: z.string().nullable() }).strict().nullable(),
    events: z.array(z.object({ kind: z.string(), detail: z.string().max(200) }).strict()),
    stop: z
      .object({ code: z.enum(EXCLUSION_CODES), detail: z.string().max(200), evidenceSha256: Sha.nullable() })
      .strict()
      .nullable(),
    outcome: z
      .object({
        status: z.enum(['captured', 'excluded', 'incomplete']),
        code: z.enum(EXCLUSION_CODES).nullable(),
        evidenceSha256: Sha.nullable(),
      })
      .strict(),
  })
  .strict();

export function parseRecipe(json) {
  return Recipe.parse(json);
}
