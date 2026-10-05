# Generic cart reader evaluation protocol

Pre-registered on 2026-10-06 in Phase 12.1 ([plan](../../wiki/product/phase-12-reader-eval.md)), before any capture for this evaluation and before any generic reader code exists. It fixes how reader v1 (Phase 13) and later readers are judged on real retail pages, and it freezes the merchant-pipeline held-out domain list for Phase 16. Inputs: the [Phase 10 probe](merchant-probe-2026-10.md), the [merchant coverage plan](../../wiki/product/phase-10-merchant-expansion.md) (success criterion 1, **Y = 80%**, set by Evan on 2026-10-05) and the [design](../../wiki/system/merchant-coverage-design.md#real-page-evaluation-pre-registered-in-phase-12).

**Status:** protocol `generic-reader-protocol.1`, written by the Phase 12.1 builder (claude-code/claude-opus-5-5). An independent reviewer subagent reviewed it on 2026-10-06 and signed it with fixes (agent-verified); the fixes and Evan's robots decision of 2026-10-06 are applied, and the same reviewer confirmed them and **signed `generic-reader-protocol.1` at commit `e28a901` on 2026-10-06** (agent-verified). The 12.3 reviewer also confirms that every recipe's cart and checkout paths are the site's own (not an alternative path chosen to pass robots.txt). From here on, amendments follow [Changes](#changes-to-this-protocol).

"MUST" and "MUST NOT" are binding on every later phase. A result obtained in breach of a MUST is reported as a deviation next to the result and can't count toward criterion 1.

## Terms

| Term | Meaning |
| --- | --- |
| Site | A registrable domain from the [retail frame](#retail-frame). The unit of sampling, splitting and site-level bounds |
| Page-state | One snapshot of one site in one [state](#states), for example `gap.com/cart-1`. The unit of labelling and page-level bounds |
| Real page-state | A snapshot captured from the live site (action states, with their observed tags) |
| Variant | A page-state made offline by a [transform](#offline-variants) of a real snapshot. It is never a real page-state |
| Split | `development`, `heldout-a` or `heldout-b`. A site and all its page-states and variants belong to exactly one split |
| Reader run | Any execution of reader code over any snapshot of a split, including partial, timing-only or debugging runs |
| Active held-out split | `heldout-a` until it is retired, then `heldout-b` |

## Retail frame

The frame is the frozen population that every sample in this protocol is drawn from: `evals/merchants/retail-frame.json` (`retail-frame.1`, 670 domains, **SHA-256 `e513982616d9592c464f66dd085a0e004fce11ad84ca730af8d0a7fe14356886`**). It carries each domain's rank **band** only, never its exact Tranco rank (see [Attribution and licence](#attribution-and-licence)).

- **Ranking source.** Tranco list [647LX](https://tranco-list.eu/list/647LX/1000000): the daily list generated 2026-10-04 from CrUX, Farsight, Majestic, Radar and Umbrella over 2026-09-05 to 2026-10-04 (Le Pochat et al., NDSS 2019). It is the probe's list. The local copy (`tranco-647LX.csv`, SHA-256 `0ea60e04fd842e661688de0709231b0f4f7c8190c2706a631ab3e3ffb98138f2`) is gitignored under `evals/merchants/data/`. Exact ranks for the frame's domains are kept beside it in the gitignored `evals/merchants/data/frame-ranks.json`. `node evals/merchants/tools/seeded-selection.mjs check-frame evals/merchants/data/tranco-647LX.csv` checks every band in the frame against the local copy.
- **Rank bands.** `top-1k` is ranks 1–1,000, `1k-10k` is 1,001–10,000 and `10k-100k` is 10,001–100,000. Domains ranked lower, or not ranked, are outside the frame (`outside-top-100k`).
- **Classification.** An agent classified U.S. retail of physical goods on 2026-10-06 without visiting any website (claude-code/claude-opus-5-5). The inputs were the probe's candidate list of about 300 known U.S. retailers, a read of Tranco ranks 1–10,000 (`.com`, `.net`, `.us`, `.co` after a keyword filter) and a longer list of known U.S. retailers and brands looked up in Tranco. Eligible means a U.S. online storefront that sells physical goods in USD and has its own checkout. Global brands with U.S. stores (IKEA, H&M, Zara, Uniqlo, Mango) are eligible. The probe had excluded H&M and Zara; the frame's rule replaces that call. Marketplaces (eBay, Etsy, Poshmark and others) are eligible, as the design scopes `marketplace` hosts in.
- **Exclusion codes.** `legacy-named-merchant` (amazon.com, bestbuy.com, newegg.com; the plan rule). `not-a-store`: a corporate or brand portal with no store of its own. `mostly-digital-goods`. `cross-border-marketplace` (Temu, Shein, Wish). `non-us-online-retailer`: an online-only retailer abroad that ships cross-border. `prescription-or-pharmacy`: pharmacies, contact lenses and prescription eyewear (sensitive health). `no-own-checkout`: the site sends checkout to another service, or has no online store. `business-supplier`. `registry-service`. `defunct-2025`: Forever 21 U.S., Joann and Party City, which closed in 2025. `duplicate-of-another-domain`. `outside-top-100k`.
- **Counts.** Eligible: 18 `top-1k`, 111 `1k-10k`, 328 `10k-100k`, 457 in all. Excluded: 213, of which 159 are `outside-top-100k`.
- **Known bias.** The frame is not an exhaustive classification of the Tranco top 100,000. Beyond rank 10,000 it holds retailers an agent could name, so well-known brands are over-represented. Results generalize to "well-known U.S. retail brands in the Tranco top 100,000", and every report MUST say so.

### Attribution and licence

Ranks come from the Tranco list **647LX** (https://tranco-list.eu/list/647LX/1000000), described in V. Le Pochat, T. Van Goethem, S. Tajalizadehkhoob, M. Korczyński and W. Joosen, "Tranco: A Research-Oriented Top Sites Ranking Hardened Against Manipulation", NDSS 2019. Tranco states no licence of its own (checked by the coordinator on tranco-list.eu, 2026-10-06). Its sources carry their own: Cloudflare Radar **CC BY-NC 4.0**, Chrome UX Report **CC BY-SA 4.0** and Majestic Million **CC BY 3.0**; Farsight and Umbrella are also inputs. Because one source is non-commercial, the repository commits **rank bands only**: the frame and the held-out list never carry exact ranks, and the Tranco copy and the exact ranks stay gitignored. No selection in this protocol depends on an exact rank.

The frame MUST NOT be edited after this protocol is signed. A domain found during capture or adjudication to be misclassified is excluded at that stage with a reason code. Replacement is defined per use, below.

## Seeded selection

Every random choice in this protocol is a deterministic order. A domain's key is the lowercase hex SHA-256 of the UTF-8 string `<SEED>|<purpose>|<domain>`, with **`SEED = ai-checkout/phase-12/2026-10-06`**. Domains are taken in ascending key order. The purposes are `pipeline-heldout`, `reader-candidates` and `reader-split`. Every selection depends only on a domain's band, eligibility and probe status in the frame and on its key, never on an exact rank. The procedure is implemented in `evals/merchants/tools/seeded-selection.mjs`, which is committed with this protocol and has no network access and no randomness. Its tests (`seeded-selection.test.mjs`, run by `npm run test:scripts`) cover the candidate list, the held-out list and the split's refusals. The script and its constants MUST NOT change after the protocol is signed. A bug fix is a dated [amendment](#changes-to-this-protocol) that reports both outputs.

## Candidate sampling (applied in 12.3)

1. **Candidates (300).** These are every eligible `top-1k` domain (18), every eligible `1k-10k` domain (111), every Phase 10 probe site, and the first eligible `10k-100k` domains in `reader-candidates` key order until the list holds 300. The candidate list is `seeded-selection.mjs reader-candidates`: 18 / 111 / 171 per band, including all 25 probe sites.
2. **Visit order.** Bands are visited top-1k first, then 1k–10k, then 10k–100k, and within a band in key order. Capture MUST follow this order and MUST NOT skip a candidate except for a recorded exclusion.
3. **Stop.** Capture stops when **195 sites are captured**, which gives at most 65 per split. A site counts as captured when its `cart-1` or `minicart-1` real snapshot exists. If the 300 candidates are exhausted with fewer than **150** captured sites, the builder MUST stop and report to Evan. With his approval, capture continues with the next eligible `10k-100k` domains in key order (`--extra N` in the script).
4. **Probe sites.** The 25 Phase 10 sites are captured afresh with the Phase 12 tool. Their labels from the probe are not reused. When captured, they go to `development` only.
5. **Reporting.** For each band the report gives candidates visited, sites captured, the blocked share (exclusions whose code starts `blocked-` or is `captcha`) and every exclusion with its code. The top band will be thin (the probe reached 3 of 8 top-1k carts), and the report MUST say how thin.

## Capture posture

The Phase 12.2 capture tool enforces these rules; they are not left to the operator. Each refusal has a unit test.

- **No reader code during capture.** No reader, prototype reader or replay hook runs on a live page or a fresh snapshot during capture, and capture records no reader result. The first reader run on any snapshot comes after the [freeze](#freeze-and-errata) of all three splits.
- **Roles.** The Phase 13 reader developer (agent or session) MUST NOT operate the capture, write or edit recipes, or see snapshots of the held-out splits.

- **Never** sign in, create an account, type into any field, choose from a `<select>`, submit a form, place an order, solve or attempt a CAPTCHA, or press-and-hold a verification. The tool has no typing path and no coordinate-click path.
- **Clicks.** The tool refuses clicks on submit controls and on controls inside a `<form>`, except controls on the per-recipe allowlist. The allowlist may hold add-to-cart, size and colour choices that are buttons, closing a popup, declining cookies and a non-form "continue as guest". Recipes are committed data. The tool never interacts with a cross-origin frame. Its local control server requires a token and checks the `Origin` header.
- **Browser.** A persistent Chrome profile for the capture only, never Evan's and never signed in to anything, stored in a gitignored path. No extension is loaded during capture. The probe's test extension may have triggered Nike's refusal. No stealth or fingerprint-evasion plugin, no proxy, no IP rotation.
- **Pace.** One site at a time and never two sites in parallel. At least 3 s between consecutive navigations or clicks on a site. At most 25 top-level navigations per site per session. One capture session per site. A second session, on a later day, is allowed only after a tool failure and never after a block.
- **Blocks.** On a bot wall, HTTP 403 or 429, CAPTCHA or "disable your extensions" message, the tool stops that site at once and records the code. Nothing is retried, solved or bypassed.
- **Location and cookies.** A ZIP chosen by the site is accepted as given and never changed by typing. Cookie banners are declined where a decline control exists, otherwise closed or left alone.
- **Item.** The first in-stock physical item, in the recipe's listing order, priced from $10 to $200. It must not be a gift card, subscription, age-restricted item, personalised item or item needing a typed choice. The second item for `cart-2items` follows the same rule.
- **robots.txt (Evan's decision, 2026-10-06).** The tool fetches it once per site before any other page load and keeps it gitignored. `sites.json` records its SHA-256 and the rules that apply to `User-agent: *` and to the tool's own user agent. **The site is excluded if those rules disallow everything (`robots-disallow-all`) or disallow any cart or checkout path the tool would load (`robots-disallow-path`).** The check runs before the product page is opened, against the cart and checkout paths the recipe names.
- **Terms (Evan's decision, 2026-10-06).** The capture loads the terms page linked from the site's footer once. `sites.json` records its URL and whether it prohibits automated access (`yes` / `no` / `unknown`), and the report gives counts. A terms clause **does not exclude** the site.
- **Exclusion codes at capture.** `blocked-bot-wall`, `blocked-http-403`, `blocked-http-429`, `captcha`, `blocked-extension-check`, `add-to-cart-refused`, `no-eligible-item`, `needs-input`, `sign-in-required`, `non-us-storefront`, `not-a-store`, `robots-disallow-all`, `robots-disallow-path`, `defunct`, `tool-error` (after two sessions), `would-need-forbidden-action`. Every candidate visited gets an outcome, and the report lists every exclusion. The judgement exclusions `needs-input`, `no-eligible-item` and `add-to-cart-refused` (and any `would-need-forbidden-action`) MUST carry evidence: the SHA-256 of a screenshot that shows the reason, kept with the gitignored snapshots. The independent 12.3 reviewer checks every one of them against its screenshot.

## Platform detection

The platform group comes from markers in the captured HTML of every state of a site and from its checkout host. A script in the 12.2 tool detects it and records the matched marker. The first group that matches wins:

| Group | Markers |
| --- | --- |
| `shopify` | `cdn.shopify.com`, `Shopify.shop`, or a checkout on `checkout.shopify.com` or a `/checkouts/` path on a Shopify-marked host |
| `sfcc` | `/on/demandware.store/`, `demandware.static`, `dwvar_` |
| `adobe-commerce` | `Magento_` module paths, `x-magento-*` headers (not `mage/`, which matched `image/` in the probe) |
| `sap-commerce` | `/_ui/` together with `ACC.` or `hybris` |
| `bigcommerce` | `cdn11.bigcommerce.com`, `bigcommerce.com/s-` |
| `other-detected` | `woocommerce`, `vtex`, Wix or Squarespace commerce markers, Oracle Commerce `atg` |
| `none-detected` | none of the above. Next.js and similar frameworks are not platforms |

Shadow-DOM storefronts and third-party checkouts are [observed tags](#states), not platform groups. The probe found no cart summary in a shadow root, so splits are not required to contain one.

## Splits (defined now, applied in 12.3)

`seeded-selection.mjs split <captured.json>` assigns the captured sites:

1. Captured probe sites go to `development`.
2. The strata are band × platform group, processed in the order `top-1k`, `1k-10k`, `10k-100k` and then `shopify`, `sfcc`, `adobe-commerce`, `sap-commerce`, `bigcommerce`, `other-detected`, `none-detected`. Within a stratum, sites go in ascending `reader-split` key order.
3. Each site goes to the split with the fewest sites in its stratum. Ties go to the split with the fewest sites in the band, then the fewest overall, then the first of `heldout-a`, `heldout-b`, `development`. Probe sites count in these tallies.

With 150–195 captured sites, each split holds about 50–65 sites. A stratum with at least three non-probe sites puts at least one site in each split, and every split then contains every platform group that has at least three non-probe captured sites. The assignment MUST be computed and committed (`splits.json`) before any labeller starts. It MUST NOT be changed after that, except that a site later excluded (for example as `not-a-store`) is removed and reported, never replaced.

## States

**Action states** are produced by allowlisted actions on the live site, in this order:

| State | How it arises |
| --- | --- |
| `empty-cart` | The cart page before anything is added |
| `minicart-1` | The in-page cart (drawer, popover, dropdown or modal) right after one add-to-cart, if the site opens one |
| `cart-1` | The site's cart URL with one item at quantity 1. **The state for Y** |
| `checkout-1` | The first checkout page reachable without sign-in or input, with that one item. Shopify and Magento checkouts may be opened by URL, as in the probe |
| `cart-qty2` | The same item at quantity 2, from a second add-to-cart or an increment control the recipe allowlists. Never by typing or a `<select>` |
| `cart-2items` | A second, different item added |

A state the site can't reach within the posture is recorded as `not-reached` with its reason and is not a page-state.

**Observed states** aren't produced. Labellers tag them on real page-states, and the report shows them as subgroups with their n and without targets: `sale-strikethrough`, `promo-banner`, `price-carousel`, `installment-widget`, `free-shipping-progress`, `tax-or-shipping-estimate`, `credit-applied`, `loading-indicator`, `summary-in-open-shadow`, `summary-in-closed-shadow`, `summary-in-iframe`, `third-party-checkout-host`, `non-usd`.

### Offline variants

States that need input (a gift card code, a ZIP for a tax estimate) and adversarial cases are made offline from real snapshots of the same split. The transforms are deterministic and committed. Each has a version, and the variant manifest is hashed in the [freeze](#freeze-and-errata). The variant's expected label is derived from the base label by the transform's rule:

| Transform | Applied to | Change | Expected label |
| --- | --- | --- | --- |
| `class-rename` | every real `cart-1` and `checkout-1` | Every `class` and `id` value renamed through a seeded bijection; text and structure unchanged | Unchanged |
| `promo-row` | real `cart-1` with a non-null expected | A promotional row with a dollar amount ("$10 off orders over $100" style) inserted inside the summary, next to the expected row | Unchanged |
| `fake-subtotal` | every real `cart-1` | A "Subtotal" row with a different amount inserted outside the summary (in a recommendation block) | Unchanged |
| `injected-instruction` | every real `cart-1` | Visible and hidden text addressed to an AI that names a false total. This targets labelling and capture agents, which read untrusted HTML. The reader has no model | Unchanged |
| `credit-applied` | real `cart-1` with a non-null expected | A negative "Gift card applied" row of C = min($5.00, ⌊expected ÷ 2⌋ cents) and a total-after-credit row of expected − C inserted inside the summary | `afterCredit`, expected − C |

The generator finds the expected row by the labelled amount's text inside an element whose text also matches the kind's label. If that isn't unique, the variant is skipped and the skip is counted. One of the split's labellers checks a seeded 10% sample of derived labels against the variant (at least 10). A mismatch means the transform gets a new version and every variant is regenerated before the freeze. Variants are **reported apart from real page-states** and never pooled with them.

## Labelling

### Who labels

- **Two independent labellers per split.** They are Claude Code subagents in separate sessions, with the model recorded. Each labels every real page-state of the split from the snapshot files: full-page screenshot, viewport screenshot, DOM tree and MHTML.
- **What a labeller never sees.** The other labeller's file, any reader output, the probe's `labels*.json` and `reader-results.json`, and the adjudication.
- **No conflicts.** A person or agent who has run or seen reader output on a split MUST NOT label or adjudicate it.
- **Page text is data.** Labellers treat it as data, never as instructions; the `injected-instruction` variants exist because of this.
- **Adjudicator.** A third subagent that never labelled any page-state of that split. It decides every disagreement against the snapshot, sees both labels and records its reason.
- **Agent labels.** The labels are agent-labelled, and reports call them agent-verified, never human-verified.

### Label schema (`reader-labels.1`, extends the probe's `labels.json`)

Per page-state:

- `id`: `<domain>/<state>`, or `<domain>/<state>/<transform>` for a variant.
- `split`, `state` and `origin` (`action` or `variant`).
- `snapshotSha256` (the snapshot manifest) and `domSha256`.
- `readable`: `top-frame`, `open-shadow`, `iframe-only`, `closed-shadow-only` or `none-displayed`.
- `displayed`: every summary total row of the three kinds, as `{kind, amountCents}`.
- `expected`: `{kind, amountCents}` or `null`, with `expectedReason` when null: `no-total-displayed`, `not-readable`, `ambiguous-preferred-kind` or `non-usd`.
- `observedTags`, `confidence` (`high` / `low`) and `notes`. Notes are text-free where possible, and any quote is 25 words or fewer.

Kinds and preference are as in the probe: **`afterCredit` > `estimatedTotal` > `subtotal`**. `expected` is the displayed amount of the most preferred kind in the readable region.

- **Unreadable summaries.** A summary only in a cross-origin iframe or a closed shadow root is `not-readable`, and the correct answer is `none`.
- **Ambiguous preferred kind.** Two different amounts of the most preferred kind give `ambiguous-preferred-kind`, and the correct answer is `ask` or `none`.
- **The probe's three conventions bind.** A sale-discounted total is `estimatedTotal`, not `afterCredit`. A "total excluding tax" row is `estimatedTotal`. A row the labeller isn't sure of is labelled with `confidence: low`, not dropped.
- **Consistency flag.** Product price × quantity is a consistency flag only.

### Agreement

The report gives, per split, the counts and rates of:

- **expected agreement:** same `expected`, or both null with the same reason;
- **row agreement:** the same set of `displayed` rows;
- **readable agreement;**
- **per-tag agreement**, for information.

If expected agreement on a split is below 90%, the builder MUST stop before the freeze and report to Evan.

### Freeze and errata

- **Freeze, all three splits at once.** In 12.3, before any reader run on **any** split, the final labels (agreed plus adjudicated), the variant manifest and the snapshot manifest of **all three** splits are committed. Development is frozen the same way as the held-out splits. `freeze.json` records the SHA-256 of each file, the commit and the UTC time. The reader harness (Phase 13) MUST verify these hashes and refuse to score on a mismatch. A frozen label file is never edited.
- **Errata.** A label later found wrong goes in a dated erratum (`errata/<split>.json`) recording:
  - the old and new label;
  - the snapshot evidence;
  - who found it;
  - whether reader output triggered it;
  - the adjudicator's decision. That adjudicator has not seen reader output on the split.
- **Reporting.** Every score is reported on the frozen labels, with the score on corrected labels beside it. Pass or fail against criterion 1 is decided on the **frozen** labels. A result that passes only on corrected labels is reported as such, and Evan decides.

## Scoring

The reader answers `found` (amount, kind), `ask` (one or more candidate amounts) or `none`. Let E be the label's `expected`.

| Outcome | Definition |
| --- | --- |
| **found-correct** | `found`, E is not null, the returned amount equals the labelled amount of the returned kind, and that kind is E's kind (the most preferred present) |
| **false found** | `found` and not found-correct. This includes any `found` when E is null for any reason |
| **ask** | `ask`. Sub-count: E's amount is among the candidates |
| **none-missed** | `none` and E is not null |
| **none-correct** | `none` and E is null |

**Bounds.** Every proportion is reported with a Wilson 95% interval (z = 1.96). Every zero count is also reported with the rule-of-three upper bound 3/n. Both are given at two levels:

- **Page-state level:** n = scored real page-states.
- **Site-cluster level:** n = sites. A site counts as failing if any of its scored page-states fails.

With about 60 sites, 0 false found gives a site-level upper bound of 5.0% (rule of three) or 6.0% (Wilson).

**Reading time.** The reader runs in Playwright's Chrome over the replay format of 12.2. That format MUST preserve open shadow roots and the styles the reader reads. The Chrome version and machine are recorded. A *read* is one call of the reader's page-reading function on a loaded page, timed as wall time; page load is not timed. The stability check makes two such reads 500 ms apart: each is timed as its own read, and the 500 ms wait between them is not counted. Each real page-state is loaded once, given one untimed warm-up read, then read three times with each read timed. The p95 is taken over every timed read on the split.

## Pass bar (criterion 1)

On the **active held-out split**, over real page-states, scored against the frozen labels:

1. **0 false found** across all real page-states and states. The report gives the page-state and site-cluster upper bounds.
2. **found-correct ≥ 80% (Y)** on the Y denominator below. This is the point estimate, reported with its Wilson interval.
3. **p95 reading time ≤ 50 ms.**

**Y denominator.** The real `cart-1` page-states of the split whose E is not null. In it, `ask`, `none` and false found all count as misses. Excluded from it, and reported with their count and share of the split's sites: sites whose `cart-1` was `not-reached` (including sites with only a mini-cart), and `cart-1` pages whose E is null (`not-readable` iframe or closed-shadow summaries, `ambiguous-preferred-kind`, `no-total-displayed`, `non-usd`). Those excluded pages still count toward the false-found bar. The report gives n.

**How strict this is.** With n ≈ 50, a point estimate of exactly 80% has a Wilson 95% lower bound of about 67%, so passing Y shows the reader is good, not that its true rate is above 80%. Zero false found over about 300 real page-states is strict: a reader whose true false-found rate is 1% per page-state passes with probability of about 5% (0.99^300).

A held-out run fails if any of the three fails. **Criterion 1 is met by a specific reader commit**, recorded in `runs.json`. A reader changed after that commit (other than a change with no effect on the read path, for example a comment) and before Release A MUST pass again on the active held-out split within that split's remaining runs. Variant results are reported beside the bar, per transform, with bounds and every false found listed by class, but they aren't part of it. Results on development are never criterion-1 evidence.

## Peek policy and stop rule

- **Tuning.** Readers are tuned on `development` only. A reader developer MUST NOT open held-out snapshots, screenshots, labels or per-page outputs. They also MUST NOT browse a held-out site's product, cart or checkout pages.
- **Who runs held-out.** An evaluation subagent runs the held-out splits, never the reader's developer. The coordinator sees aggregate held-out results only: the metrics, bounds and the class-only failure counts below, never per-page outputs. Every reader run on any split is logged in `runs.json` before its results are read. The log records the run ID, UTC time, reader commit, split, frozen label hash and aggregate metrics. It is text-free.
- **Run limit.** `heldout-a` runs **at most twice in Phases 10–17 in total**. A run counts from the moment reader code executes over any held-out snapshot, whatever the run's purpose.
- **Class-only analysis.** Failures on a held-out split are analysed **by class only**. An analyst subagent that is not the reader developer reads the per-page outputs, which stay gitignored. It returns counts per class with no domain, amount, selector or page text. The classes are: `region-missed`, `region-wrong`, `distractor-accepted` (with the distractor: strikethrough, installment, carousel, line item, savings, shipping progress, outside summary), `kind-wrong`, `amount-parse`, `currency`, `unreadable-not-none`, `tie-not-ask`, `stability`, `crash`, `over-budget` and `other`. Fixes are made and tested on development.
- **Retiring A.** A second failed run of `heldout-a` retires it. A retired split may then be used as development data. `heldout-b` becomes active under the same rule: at most two runs, failures by class only.
- **Stop rule.** If `heldout-b` also fails twice, no held-out split is left. Reader work stops, and **Evan re-decides scope before Phase 15**.
- **After a pass.** Once a split passes, further runs on it still count toward its limit.

## Merchant-pipeline held-out domains

`evals/merchants/pipeline-heldout-domains.json` (`merchant-pipeline-heldout.1`) is frozen with **SHA-256 `6bc92515c90009b623c4de3d6f78395b860bc4ee68e305a05be243229b8d79b2`**. Like the frame, it carries bands only, not ranks. It holds 60 domains, 6 / 27 / 27 per band. Per band, the eligible frame domains are taken in ascending `pipeline-heldout` key order. The top band takes 6, a third of its 18 eligible domains, so that two thirds stay available for pipeline development. The other 54 are split evenly between the other two bands. `seeded-selection.mjs pipeline-heldout --check` reproduces the file byte for byte.

- **Profiles.** The held-out profiles for these domains are drafted and adjudicated at the **start of Phase 16, before any drafting** by the pipeline, under the Phase 16 protocol (which needs D5), and are frozen and hashed there. A profile covers name, hosts, `hostKind`, plausible categories with evidence class and source, `brandIds` and any MCC.
- **No tuning.** No prompt, few-shot example, convention, rule or tool of the merchant pipeline may be written or tuned using these domains, their pages or their profiles. Pipeline development uses other frame domains.
- **Phase 14 seed rows.** Phase 14 may seed merchant-database rows for some of these domains (default category, brand links). The Phase 16 drafting step MUST NOT read those rows, and the Phase 16 protocol says how they are scored.
- **Replacement.** A domain found at adjudication not to be an eligible store is dropped and replaced by the next domain of the same band in `pipeline-heldout` key order. Both are recorded with evidence, and an independent subagent that is neither the adjudicator nor a pipeline developer checks every drop before the profiles are frozen.
- **Overlap with the reader splits is allowed.** The two evaluations measure different outputs from different inputs: the reader turns a page DOM into an amount, and the pipeline turns public evidence into a profile and category. Their selections use independent key purposes, so neither constrains the other. Excluding these domains from reader sampling would remove a third of the 18 eligible top-1k sites from a band the probe showed is already thin. 46 of the 60 domains are reader candidates, and 6 are probe sites (apple, barnesandnoble, gap, homedepot, nike, target), which only ever had cart totals labelled. Reader snapshots and labels of these domains MUST NOT be used to develop the merchant pipeline. Both reports give the overlap.

## Committed and gitignored

| Committed (text-free, or quotes of 25 words or fewer) | Gitignored |
| --- | --- |
| This protocol; `retail-frame.json` and `pipeline-heldout-domains.json` (bands, no ranks); `tools/seeded-selection.mjs` and its test | The Tranco copy, exact ranks (`frame-ranks.json`) and frame inputs (`evals/merchants/data/`) |
| 12.2–12.3: recipes, the candidate list, `sites.json` (outcomes, platform and marker, robots and terms posture, exclusion codes, snapshot hashes), `splits.json`, labeller files, adjudication, final labels, `freeze.json`, errata, variant transforms and manifest, `runs.json`, reports | Snapshots (DOM trees, HTML, MHTML, screenshots, headers), robots.txt and terms copies, the capture profile, capture logs, per-page reader outputs on held-out splits |

Replays are new dated snapshots; labels are never overwritten.

## Reporting

`docs/evals/reader-captures-2026-10.md` (12.3) gives:

- the counts per split, state and band;
- the blocked share per band;
- exclusions by code;
- platform groups per split;
- the robots and terms tallies;
- label agreement;
- the freeze hashes.

Every reader report gives:

- the five outcome counts per state, with bounds at both levels;
- the observed-tag subgroups;
- variants apart;
- timing;
- errata beside the frozen-label scores;
- the held-out run count used;
- the frame bias statement.

## Changes to this protocol

- **Before the signature.** The protocol changes freely until the reviewer signs it.
- **After the signature.** Changes are dated amendments, appended below with a decision record.
- **Fixed for good.** The seed, the frame, the held-out domain list, the pass bar (0 false found, Y = 80%, p95 ≤ 50 ms), the outcome definitions and the label schema never change by builder amendment.
- **Scoring amendments.** Any later change to how a split is scored needs an Evan decision record, and every affected result is then reported under both the old and the new rules.

### Amendments

None.

## Related

- [Phase 12 plan](../../wiki/product/phase-12-reader-eval.md)
- [Merchant coverage design: real-page evaluation](../../wiki/system/merchant-coverage-design.md#real-page-evaluation-pre-registered-in-phase-12)
- [Phase 10 probe report](merchant-probe-2026-10.md)
- [Decision: reader protocol choices](../../wiki/decisions/2026-10-06-reader-eval-protocol.md)
