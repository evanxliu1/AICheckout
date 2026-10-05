# Generic cart reader evaluation protocol

Pre-registered on 2026-10-06 in Phase 12.1 ([plan](../../wiki/product/phase-12-reader-eval.md)), before any capture for this evaluation and before any generic reader code exists. It fixes how reader v1 (Phase 13) and later readers are judged on real retail pages, and it freezes the merchant-pipeline held-out domain list for Phase 16. Inputs: the [Phase 10 probe](merchant-probe-2026-10.md), the [merchant coverage plan](../../wiki/product/phase-10-merchant-expansion.md) (success criterion 1, **Y = 80%**, set by Evan on 2026-10-05) and the [design](../../wiki/system/merchant-coverage-design.md#real-page-evaluation-pre-registered-in-phase-12).

**Status:** protocol **`generic-reader-protocol.2`**, amended on 2026-10-06 before any capture, label or reader run, to carry out Evan's decision in chat that day ([Amendment 1](#amendment-1-2026-10-06-generic-reader-protocol2)): the reader is evaluated on storefronts **worldwide** and must return the total's **currency**. Sites the robot can't reach stay a reported gap; capturing them attended is deferred. `generic-reader-protocol.1` was signed by an independent reviewer subagent at commit `e28a901` (agent-verified; its text is at `84bc529`). **`.2` is not signed yet.** It binds once an independent reviewer subagent signs it, and no 12.3 capture may start before that. Amendments after that signature follow [Changes](#changes-to-this-protocol).

"MUST" and "MUST NOT" are binding on every later phase. A result obtained in breach of a MUST is reported as a deviation next to the result and can't count toward criterion 1.

## Terms

| Term | Meaning |
| --- | --- |
| Site | A registrable domain from the [retail frame](#retail-frame). The unit of sampling, splitting and site-level bounds |
| Region group | A site's frame attribute: `us`, `canada-latam`, `europe`, `asia-pacific` or `middle-east-africa`, from the storefront region the frame predicts. Never taken from a page |
| Stream | `us` (region group `us`) or `non-us` (every other group). Each stream has its own candidates, visit order and stop rule |
| Page-state | One snapshot of one site in one [state](#states), for example `gap.com/cart-1`. The unit of labelling and page-level bounds |
| Real page-state | A snapshot captured from the live site (action states, with their observed tags) |
| Variant | A page-state made offline by a [transform](#offline-variants) of a real snapshot. It is never a real page-state |
| Split | `development`, `heldout-a` or `heldout-b`. A site and all its page-states and variants belong to exactly one split |
| Reader run | Any execution of reader code over any snapshot of a split, including partial, timing-only or debugging runs |
| Active held-out split | `heldout-a` until it is retired, then `heldout-b` |

## Retail frame

The reader evaluation draws every sample from **`retail-frame.2`**: `evals/merchants/retail-frame-2.json` (1,669 domains, 989 eligible, **SHA-256 `511959a593d09996ae4ce17626766bf87fbc2dc61e82bd2cc39376d1f5e1b052`**). It carries each domain's rank **band** only, never its exact Tranco rank (see [Attribution and licence](#attribution-and-licence)).

`retail-frame.1` (`evals/merchants/retail-frame.json`, 670 domains, 457 eligible, SHA-256 `e513982616d9592c464f66dd085a0e004fce11ad84ca730af8d0a7fe14356886`) stays frozen and unchanged. It is no longer a reader frame. It remains the population of the [merchant-pipeline held-out list](#merchant-pipeline-held-out-domains).

- **Ranking source.** Tranco list [647LX](https://tranco-list.eu/list/647LX/1000000): the daily list generated 2026-10-04 from CrUX, Farsight, Majestic, Radar and Umbrella over 2026-09-05 to 2026-10-04 (Le Pochat et al., NDSS 2019). It is the probe's list. The local copy (`tranco-647LX.csv`, SHA-256 `0ea60e04fd842e661688de0709231b0f4f7c8190c2706a631ab3e3ffb98138f2`) is gitignored under `evals/merchants/data/`. Exact ranks are kept beside it in the gitignored `frame-ranks.json` (frame 1) and `frame2/frame-2-ranks.json` (frame 2), next to the frame 2 inputs and build script (`frame2/build.py`). `node evals/merchants/tools/seeded-selection.mjs check-frame evals/merchants/data/tranco-647LX.csv [--frame 1|2]` checks every band of a frame against the local copy.
- **Rank bands.** `top-1k` is ranks 1–1,000, `1k-10k` is 1,001–10,000 and `10k-100k` is 10,001–100,000. Domains ranked lower, or not ranked, are outside the frame (`outside-top-100k`).
- **Classification.** An agent (claude-code/claude-opus-5-5) classified online retail of physical goods worldwide on 2026-10-06 without visiting any website. The inputs were every `retail-frame.1` domain with its classification, the agent's lists of known retailers in 58 countries besides the U.S., and a read of the country-code domains in Tranco ranks 1–10,000. Eligible means an online storefront that sells physical goods and has its own checkout, in any country and currency. Marketplaces stay eligible, as the design scopes `marketplace` hosts in.
- **Region and currency.** Every eligible domain carries `region` (ISO 3166-1 alpha-2), `currency` (ISO 4217) and `regionGroup`. They describe the storefront a visitor **in the United States** gets at that domain without choosing a country, which is what the capture sees (see [location, country and currency](#capture-posture)). A global brand's `.com` that runs a U.S. store in USD is `US`: IKEA, H&M, Zara and Uniqlo as in frame 1, and newly Lacoste, Burberry, Selfridges, Yoox and others. The frame's values are predictions. The capture records the storefront region and currency it observed, and the report compares them, but streams and splits always use the frame's values.
- **What changed from frame 1.** Every frame 1 domain keeps its band, probe status and classification, except that the U.S.-only code `non-us-online-retailer` is lifted. ASOS, Farfetch, SSENSE and seven others serve U.S. visitors a USD storefront and are now eligible as `US`; `lookfantastic.com` becomes `multi-market-domain`. All of frame 1's eligible domains are eligible in frame 2 as `US` / `USD`.
- **Exclusion codes.** Frame 1's codes keep their meaning: `legacy-named-merchant`, `not-a-store` (now also price-comparison and classifieds sites), `mostly-digital-goods`, `cross-border-marketplace` (Temu, Shein, Wish, AliExpress), `prescription-or-pharmacy` (also drugstore chains with pharmacy counters), `no-own-checkout`, `business-supplier`, `registry-service`, `defunct-2025`, `duplicate-of-another-domain` and `outside-top-100k`. New in frame 2:
  - `same-retailer-other-domain` (168 domains): another country domain of a retailer already in the frame. **One storefront per retailer**, so that a retailer's sister storefronts (same company, same code) can't sit in development and in a held-out split at once. A family with a frame 1 domain keeps that domain. Otherwise it keeps its eligible member with the lowest SHA-256 key of purpose `retailer-family`. Same-name retailers run by different companies are separate: Target and Target Australia, Kmart Australia, the Woolworths of Australia and South Africa, Jumbo NL, CH and CL, Coop CH, SE and IT, and Sears and Office Depot Mexico.
  - `multi-market-domain` (46): a global domain whose storefront for a U.S. visitor the agent can't predict, such as a country chooser or a brand whose U.S. store it isn't sure of.
  - `card-unusable-market` (18): storefronts in Russia and Belarus, where U.S.-issued cards are not accepted. The product will never recommend a card there.
  - `adult-retailer` (2).
- **Counts.** Eligible: `us` 18 / 114 / 348 (480) and `non-us` 8 / 107 / 394 (509) across `top-1k` / `1k-10k` / `10k-100k`, 989 in all. By region group: `europe` 267, `asia-pacific` 157, `canada-latam` 66, `middle-east-africa` 19. 55 regions and 42 currencies. Excluded: 680, of which 362 are `outside-top-100k`.
- **Known bias.** The frame is not an exhaustive classification of the Tranco top 100,000. Beyond rank 10,000 it holds retailers an agent could name, so well-known brands are over-represented. Outside the U.S. the agent's knowledge is thinner and uneven by country: Europe and East Asia are well covered, the Middle East and Africa thinly (19 eligible). Tranco's providers also under-rank some large national retailers. Results generalize to "well-known retail brands in the Tranco top 100,000, U.S.-heavy, and Europe- and East-Asia-heavy outside the U.S.", and every report MUST say so.

### Attribution and licence

Ranks come from the Tranco list **647LX** (https://tranco-list.eu/list/647LX/1000000), described in V. Le Pochat, T. Van Goethem, S. Tajalizadehkhoob, M. Korczyński and W. Joosen, "Tranco: A Research-Oriented Top Sites Ranking Hardened Against Manipulation", NDSS 2019. Tranco states no licence of its own (checked by the coordinator on tranco-list.eu, 2026-10-06). Its sources carry their own: Cloudflare Radar **CC BY-NC 4.0**, Chrome UX Report **CC BY-SA 4.0** and Majestic Million **CC BY 3.0**; Farsight and Umbrella are also inputs. Because one source is non-commercial, the repository commits **rank bands only**: neither frame nor the held-out list ever carries exact ranks, and the Tranco copy and the exact ranks stay gitignored. No selection in this protocol depends on an exact rank.

Neither frame may be edited after this protocol is signed. A domain found during capture or adjudication to be misclassified is excluded at that stage with a reason code. Replacement is defined per use, below.

## Seeded selection

Every random choice in this protocol is a deterministic order. A domain's key is the lowercase hex SHA-256 of the UTF-8 string `<SEED>|<purpose>|<domain>`, with **`SEED = ai-checkout/phase-12/2026-10-06`** (unchanged from `.1`). Domains are taken in ascending key order. The purposes are `pipeline-heldout`, `reader-candidates`, `reader-split` and, for building frame 2, `retailer-family`. Every selection depends only on a domain's band, eligibility, region group and probe status in the frame and on its key, never on an exact rank.

The procedure is implemented in `evals/merchants/tools/seeded-selection.mjs` (SHA-256 `d747fa20b4f2ab1a65f9d6bf01ceb5551c065ffdd136011cd793cff1bfbb8488` at `.2`), which has no network access and no randomness. Its tests (`seeded-selection.test.mjs`, run by `npm run test:scripts`) cover frame 2 against frame 1, the item price bands, both candidate streams, the unchanged held-out list, and the split's balance and refusals. The script and its constants MUST NOT change after the protocol is signed. A bug fix is a dated [amendment](#changes-to-this-protocol) that reports both outputs.

## Candidate sampling (applied in 12.3)

1. **Candidates (400, 200 per stream).** Per stream: every eligible `top-1k` and `1k-10k` domain, every Phase 10 probe site, then the first eligible `10k-100k` domains in `reader-candidates` key order until the stream holds 200. `seeded-selection.mjs reader-candidates` prints both lists (output SHA-256 `a9e82579f68f08fbc42ed9e282302f94e5f88d34ad684623486716e3a00b3f67`): `us` 18 / 114 / 68, including all 25 probe sites, which are U.S.; `non-us` 8 / 107 / 85, from 40 regions in 33 currencies (`europe` 87, `asia-pacific` 77, `canada-latam` 29, `middle-east-africa` 7).
2. **Visit order.** Within a stream, bands are visited top-1k first, then 1k–10k, then 10k–100k, and within a band in key order. Capture MUST follow this order and MUST NOT skip a candidate except for a recorded exclusion. The two streams may be interleaved in any way, because each stream's stop rule counts only its own sites.
3. **Stop.** A stream's capture stops when **110 of its sites are captured**, so capture ends with at most **220 sites**, about 73 per split. A site counts as captured when its `cart-1` or `minicart-1` real snapshot exists. If a stream's 200 candidates are exhausted with fewer than **80** captured sites, the builder MUST stop and report to Evan. With his approval, that stream continues with its next eligible `10k-100k` domains in key order (`--extra-us N` or `--extra-non-us N`).
4. **Probe sites.** The 25 Phase 10 sites are captured afresh with the Phase 12 tool. Their labels from the probe are not reused. When captured, they go to `development` only.
5. **Reporting.** For each stream, band and region group, the report gives candidates visited, sites captured, the blocked share and every exclusion with its code. The top bands will be thin (the probe reached 3 of 8 top-1k carts), and the report MUST say how thin. The blocked sites are the [known gap](#bot-walled-sites-a-known-gap).

**Sizing.** With about 73 sites per split, each split holds about 36 U.S. and 37 non-U.S. sites. A simulated capture of the first 110 candidates of each stream gives 36 / 35 / 39 U.S. and 37 / 37 / 36 non-U.S. sites in held-out A / held-out B / development (the 25 U.S. probe sites are in development). Each held-out split should then have about 55–60 one-item cart pages for Y, about half of them outside the U.S.

## Capture posture

The Phase 12.2 capture tool enforces these rules; they are not left to the operator. Each refusal has a unit test.

- **No reader code during capture.** No reader, prototype reader or replay hook runs on a live page or a fresh snapshot during capture, and capture records no reader result. The first reader run on any snapshot comes after the [freeze](#freeze-and-errata) of all three splits.
- **Roles.** The Phase 13 reader developer (agent or session) MUST NOT operate the capture, write or edit recipes, or see snapshots of the held-out splits.
- **Never** sign in, create an account, type into any field, choose from a `<select>`, submit a form, place an order, solve or attempt a CAPTCHA, or press-and-hold a verification. The tool has no typing path and no coordinate-click path.
- **Clicks.** The tool refuses clicks on submit controls and on controls inside a `<form>`, except controls on the per-recipe allowlist. The allowlist may hold add-to-cart, size and colour choices that are buttons, closing a popup, declining cookies, a non-form "continue as guest" and a control that **keeps** the storefront the site served (for example "stay on this site"). Recipes are committed data. The tool never interacts with a cross-origin frame. Its local control server requires a token and checks the `Origin` header.
- **Browser.** A persistent Chrome profile for the capture only, never Evan's and never signed in to anything, stored in a gitignored path. No extension is loaded during capture. The probe's test extension may have triggered Nike's refusal. No stealth or fingerprint-evasion plugin, no proxy, no VPN, no IP rotation.
- **Pace.** One site at a time and never two sites in parallel. At least 3 s between consecutive navigations or clicks on a site. At most 25 top-level navigations per site per session. One capture session per site. A second session, on a later day, is allowed only after a tool failure and never after a block.
- **Blocks.** On a bot wall, HTTP 403 or 429, CAPTCHA or "disable your extensions" message, the tool stops that site at once and records the code. Nothing is retried, solved or bypassed.
- **Location, country and currency.** Capture runs from the operator's own connection in the United States. The storefront, country, language and currency the site serves are accepted as given: no country or currency chooser is changed, no country or locale parameter or path is edited, and a ZIP or postcode chosen by the site is never changed by typing. A site that redirects to a different registrable domain (for example a country domain) is excluded as `redirected-off-domain`. The capture records the observed storefront region and currency per site.
- **Cookies.** Cookie banners are declined where a decline control exists, otherwise closed or left alone.
- **Item.** The first in-stock physical item, in the recipe's listing order, whose displayed price lies within the band for the storefront's currency in `evals/merchants/item-price-bands.json` (`item-price-bands.1`, SHA-256 `f75c978c0fda9e80ee7495f123a7ffa95aaa3034d16cb5cd248bd3dc5a633756`). Each band approximates USD 10–200, from rounded rates in the builder's knowledge; the band only picks the item and never enters a label or a score. The item must not be a gift card, subscription, age-restricted item, personalised item or item needing a typed choice. The second item for `cart-2items` follows the same rule.
- **robots.txt (Evan's decision, 2026-10-06).** The tool fetches it once per site before any other page load and keeps it gitignored. `sites.json` records its SHA-256 and the rules that apply to `User-agent: *` and to the tool's own user agent. **The site is excluded if those rules disallow everything (`robots-disallow-all`) or disallow any cart or checkout path the tool would load (`robots-disallow-path`).** The check runs before the product page is opened, against the cart and checkout paths the recipe names.
- **Terms (Evan's decision, 2026-10-06).** The capture loads the terms page linked from the site's footer once. `sites.json` records its URL and whether it prohibits automated access (`yes` / `no` / `unknown`), and the report gives counts. A terms clause **does not exclude** the site.
- **Exclusion codes at capture.** `blocked-bot-wall`, `blocked-http-403`, `blocked-http-429`, `captcha`, `blocked-extension-check`, `add-to-cart-refused`, `no-eligible-item`, `needs-input`, `sign-in-required`, `redirected-off-domain`, `not-a-store`, `robots-disallow-all`, `robots-disallow-path`, `defunct`, `tool-error` (after two sessions) and `would-need-forbidden-action`. `non-us-storefront` is retired, as a non-U.S. storefront is now in scope. Every candidate visited gets an outcome, and the report lists every exclusion. The judgement exclusions `needs-input`, `no-eligible-item` and `add-to-cart-refused` (and any `would-need-forbidden-action`) MUST carry evidence: the SHA-256 of a screenshot that shows the reason, kept with the gitignored snapshots. The independent 12.3 reviewer checks every one of them against its screenshot.

### Bot-walled sites: a known gap

Sites the tool can't reach because of a bot wall, HTTP 403 or 429, CAPTCHA or extension check are excluded with their code, as in `.1`. They are **listed and reported as a known gap**: counts and domains per stream, band and region group, and their share of the visited candidates. Every reader report repeats the gap beside its results, since these are disproportionately the largest retailers.

**Deferred (Evan, 2026-10-06).** A later step may capture bot-walled sites attended, with Claude driving its built-in browser and Evan solving any CAPTCHA. That needs its own protocol amendment and an Evan-approved in-page serializer. Until then, no site is captured any other way than by the 12.2 tool, and the agent never solves or attempts a CAPTCHA or bot wall.

## Platform detection

The platform group comes from markers in the captured HTML of every state of a site and from its checkout host. A script in the 12.2 tool detects it and records the matched marker. It is the only page-derived input to the split, and no person chooses it. The first group that matches wins:

| Group | Markers |
| --- | --- |
| `shopify` | `cdn.shopify.com`, `Shopify.shop`, or a checkout on `checkout.shopify.com` or a `/checkouts/` path on a Shopify-marked host |
| `sfcc` | `/on/demandware.store/`, `demandware.static`, `dwvar_` |
| `adobe-commerce` | `Magento_` module paths, `x-magento-*` headers (not `mage/`, which matched `image/` in the probe) |
| `sap-commerce` | `/_ui/` together with `ACC.` or `hybris` |
| `bigcommerce` | `cdn11.bigcommerce.com`, `bigcommerce.com/s-` |
| `other-detected` | `woocommerce`, `vtex`, Wix or Squarespace commerce markers, Oracle Commerce `atg`, Shopware (`/bundles/storefront/`), PrestaShop (`prestashop`), Cafe24 (`cafe24`), MakeShop (`makeshop`) |
| `none-detected` | none of the above. Next.js and similar frameworks are not platforms |

Shadow-DOM storefronts and third-party checkouts are [observed tags](#states), not platform groups. The probe found no cart summary in a shadow root, so splits are not required to contain one.

## Splits (defined now, applied in 12.3)

`seeded-selection.mjs split <captured.json>` assigns the captured sites. Its input is `{domain, platform}` per site and nothing else:

1. Captured probe sites go to `development`.
2. The strata are band × region group × platform group, processed in the order `top-1k`, `1k-10k`, `10k-100k`; then `us`, `canada-latam`, `europe`, `asia-pacific`, `middle-east-africa`; then `shopify`, `sfcc`, `adobe-commerce`, `sap-commerce`, `bigcommerce`, `other-detected`, `none-detected`. Within a stratum, sites go in ascending `reader-split` key order.
3. Each site goes to the split with the fewest sites in its stratum. Ties go to the split with the fewest sites in its band × region group, then in its region group, then in its band, then overall, then the first of `heldout-a`, `heldout-b`, `development`. Probe sites count in these tallies.

With up to 220 captured sites, each split holds about 70–75, about half of them outside the U.S. The two held-out splits' counts per region group differ by at most one in the simulation. A stratum with at least three non-probe sites puts at least one site in each split. The assignment depends only on the frame and the platform group. It never depends on states reached, totals, currencies or anything else seen in a page. It MUST be computed and committed (`splits.json`) before any labeller starts. It MUST NOT be changed after that, except that a site later excluded (for example as `not-a-store`) is removed and reported, never replaced.

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

**Observed states** aren't produced. Labellers tag them on real page-states, and the report shows them as subgroups with their n and without targets:

- **Page features:** `sale-strikethrough`, `promo-banner`, `price-carousel`, `installment-widget`, `free-shipping-progress`, `tax-or-shipping-estimate`, `credit-applied`, `loading-indicator`, `summary-in-open-shadow`, `summary-in-closed-shadow`, `summary-in-iframe`, `third-party-checkout-host`.
- **Locale and format (new in `.2`):** `decimal-comma` (12,99), `thousands-dot` (1.299,00), `thousands-space` (1 299,00, any space character), `thousands-apostrophe` (1'299.00), `currency-after-amount` (12,99 €), `currency-code-only` (EUR 12.99, no symbol), `zero-decimal-currency` (JPY, KRW and others whose ISO 4217 minor unit is 0), `shared-symbol` (a symbol several currencies use, such as `$`, `kr`, `¥` or `R`), `multiple-currencies-shown`, `non-latin-digits`, `rtl-layout` and `non-english-labels`.

### Offline variants

States that need input (a gift card code, a ZIP for a tax estimate), adversarial cases and locale formats are made offline from real snapshots of the same split. The transforms are deterministic and committed. Each has a version, and the variant manifest is hashed in the [freeze](#freeze-and-errata). The variant's expected label is derived from the base label by the transform's rule. Amounts a transform writes use the base page's currency and format unless the transform changes them.

| Transform | Applied to | Change | Expected label |
| --- | --- | --- | --- |
| `class-rename` | every real `cart-1` and `checkout-1` | Every `class` and `id` value renamed through a seeded bijection; text and structure unchanged | Unchanged |
| `promo-row` | real `cart-1` with a non-null expected | A promotional row with an amount ("10 off orders over 100" style, in the page's currency) inserted inside the summary, next to the expected row | Unchanged |
| `fake-subtotal` | every real `cart-1` | A "Subtotal" row (in the page's language where its own labels give the word, otherwise English) with a different amount, inserted outside the summary in a recommendation block | Unchanged |
| `injected-instruction` | every real `cart-1` | Visible and hidden text addressed to an AI that names a false total. This targets labelling and capture agents, which read untrusted HTML. The reader has no model | Unchanged |
| `credit-applied` | real `cart-1` with a non-null expected | A negative "Gift card applied" row of C = min(5 major units, ⌊expected ÷ 2⌋) minor units and a total-after-credit row of expected − C inserted inside the summary | `afterCredit`, expected − C, same currency |
| `format-swap` (new) | real `cart-1` with a non-null expected and a currency with minor unit 2 | Every amount on the page rewritten to the other decimal convention: a decimal point with comma grouping becomes a decimal comma with dot grouping (1.299,00), and the reverse. Symbol and its position unchanged | Unchanged |
| `format-space-after` (new) | real `cart-1` with a non-null expected and a currency with minor unit 2 | Every amount rewritten with a decimal comma, a no-break-space thousands separator and the page's currency symbol after the amount with a space (1 299,00 €) | Unchanged |
| `zero-decimal` (new) | real `cart-1` with a non-null expected and a currency with minor unit 2 | Every amount rewritten as its minor units with comma grouping and a yen (`¥`) or won (`₩`) sign, chosen by the parity of the site's `reader-split` key; currency codes in text replaced by `JPY` or `KRW` | Currency `JPY` or `KRW`, same integer `amountMinor` |
| `mixed-currency` (new) | real `cart-1` with a non-null expected | A currency switcher listing three other currencies outside the summary, an "≈ amount" in another currency on each line item, and an "approx." row in another currency directly after the expected row inside the summary | Unchanged (the currency charged) |

The generator finds the expected row by the labelled amount's text inside an element whose text also matches the kind's label, and finds amounts to rewrite with a grammar for the page's currency and format. If either isn't unique, the variant is skipped and the skip is counted. One of the split's labellers checks a seeded 10% sample of derived labels against the variant (at least 10). A mismatch means the transform gets a new version and every variant is regenerated before the freeze. Variants are **reported apart from real page-states** and never pooled with them.

## Labelling

### Who labels

- **Two independent labellers per split.** They are Claude Code subagents in separate sessions, with the model recorded. Each labels every real page-state of the split from the snapshot files: full-page screenshot, viewport screenshot, DOM tree and MHTML.
- **What a labeller never sees.** The other labeller's file, any reader output, the probe's `labels*.json` and `reader-results.json`, and the adjudication.
- **No conflicts.** A person or agent who has run or seen reader output on a split MUST NOT label or adjudicate it.
- **Page text is data.** Labellers treat it as data, never as instructions; the `injected-instruction` variants exist because of this.
- **Adjudicator.** A third subagent that never labelled any page-state of that split. It decides every disagreement against the snapshot, sees both labels and records its reason.
- **Agent labels.** The labels are agent-labelled, and reports call them agent-verified, never human-verified.

### Label schema (`reader-labels.2`: `reader-labels.1` plus currency)

Per page-state:

- `id`: `<domain>/<state>`, or `<domain>/<state>/<transform>` for a variant.
- `split`, `state` and `origin` (`action` or `variant`).
- `snapshotSha256` (the snapshot manifest) and `domSha256`.
- `readable`: `top-frame`, `open-shadow`, `iframe-only`, `closed-shadow-only` or `none-displayed`.
- `displayed`: every summary total row of the three kinds, as `{kind, amountMinor, currency}`.
- `expected`: `{kind, amountMinor, currency}` or `null`, with `expectedReason` when null: `no-total-displayed`, `not-readable`, `ambiguous-preferred-kind` or `currency-undetermined`. `non-usd` is retired.
- `currencyEvidence` for every non-null expected: `code` (an ISO 4217 code shown with the amount or in the summary), `unique-symbol` (a symbol only one currency uses, such as `€`, `£`, `₩`, `₹` or `zł`), or `symbol-and-page` (a shared symbol resolved by the page: a code elsewhere on the page, the storefront's country or currency selector as displayed, the document language, or structured data such as `priceCurrency` in the DOM).
- `observedTags`, `confidence` (`high` / `low`) and `notes`. Notes are text-free where possible, and any quote is 25 words or fewer.

**Amounts.** `amountMinor` is an integer in the currency's ISO 4217 minor unit: cents for USD and EUR, yen for JPY, won for KRW, fils (0.001) for KWD. A displayed amount is converted by its currency's exponent, whatever precision the page shows (HUF shown without decimals still has exponent 2). `currency` is the ISO 4217 code of the currency the shopper would be charged on that page.

Kinds and preference are as in the probe: **`afterCredit` > `estimatedTotal` > `subtotal`**. `expected` is the displayed amount of the most preferred kind in the readable region.

- **Unreadable summaries.** A summary only in a cross-origin iframe or a closed shadow root is `not-readable`, and the correct answer is `none`.
- **Ambiguous preferred kind.** Two different amounts of the most preferred kind give `ambiguous-preferred-kind`, and the correct answer is `ask` or `none`.
- **Currency undetermined.** If the labeller can't determine the charged currency from the snapshot by the evidence rules above (for example a bare `$` with nothing on the page to tell USD from CAD or MXN), `expected` is null with `currency-undetermined`, and the correct answer is `ask` or `none`. An "approx." amount in another currency is never the expected row.
- **The probe's three conventions bind.** A sale-discounted total is `estimatedTotal`, not `afterCredit`. A "total excluding tax" row is `estimatedTotal`. A row the labeller isn't sure of is labelled with `confidence: low`, not dropped.
- **Consistency flag.** Product price × quantity is a consistency flag only.

### Agreement

The report gives, per split, the counts and rates of:

- **expected agreement:** same `expected` (kind, amount and currency), or both null with the same reason;
- **currency agreement:** the same currency on every displayed row both labellers recorded;
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

The reader answers `found` (amount, kind and currency), `ask` (one or more candidate amounts, each with a currency) or `none`. Let E be the label's `expected`.

| Outcome | Definition |
| --- | --- |
| **found-correct** | `found`, E is not null, the returned currency equals E's currency, the returned amount equals the labelled amount of the returned kind (compared as `amountMinor`), and that kind is E's kind (the most preferred present) |
| **false found** | `found` and not found-correct. This includes any `found` when E is null for any reason, and the right amount with a **wrong currency** |
| **ask** | `ask`. Sub-count: E's amount and currency are among the candidates |
| **none-missed** | `none` and E is not null |
| **none-correct** | `none` and E is null |

**Bounds.** Every proportion is reported with a Wilson 95% interval (z = 1.96). Every zero count is also reported with the rule-of-three upper bound 3/n. Both are given at two levels:

- **Page-state level:** n = scored real page-states.
- **Site-cluster level:** n = sites. A site counts as failing if any of its scored page-states fails.

With about 73 sites, 0 false found gives a site-level upper bound of 4.1% (rule of three) or 5.0% (Wilson).

**Subgroups.** Every outcome count is also reported, with its bounds, for the `us` and `non-us` streams (frame region), for USD and non-USD labels (`expected.currency`), per region group, per currency with at least 5 sites and per locale tag. Subgroups have no targets. With about 37 sites, a subgroup's site-level zero bound is 8.1% (rule of three), and the report MUST say so.

**Reading time.** The reader runs in Playwright's Chrome over the replay format of 12.2. That format MUST preserve open shadow roots and the styles the reader reads. The Chrome version and machine are recorded. A *read* is one call of the reader's page-reading function on a loaded page, timed as wall time; page load is not timed. The stability check makes two such reads 500 ms apart: each is timed as its own read, and the 500 ms wait between them is not counted. Each real page-state is loaded once, given one untimed warm-up read, then read three times with each read timed. The p95 is taken over every timed read on the split.

## Pass bar (criterion 1)

On the **active held-out split as a whole** (U.S. and non-U.S. sites together), over real page-states, scored against the frozen labels:

1. **0 false found** across all real page-states and states, wrong currencies included. The report gives the page-state and site-cluster upper bounds.
2. **found-correct ≥ 80% (Y)** on the Y denominator below. This is the point estimate, reported with its Wilson interval.
3. **p95 reading time ≤ 50 ms.**

The bar applies to the whole split, not to any subgroup. U.S. and non-U.S. results are always reported separately beside it.

**Y denominator.** The real `cart-1` page-states of the split whose E is not null. In it, `ask`, `none` and false found all count as misses. Excluded from it, and reported with their count and share of the split's sites: sites whose `cart-1` was `not-reached` (including sites with only a mini-cart), and `cart-1` pages whose E is null (`not-readable` iframe or closed-shadow summaries, `ambiguous-preferred-kind`, `no-total-displayed`, `currency-undetermined`). Those excluded pages still count toward the false-found bar. The report gives n.

**How strict this is.** With n ≈ 58, a point estimate of exactly 80% has a Wilson 95% lower bound of about 68%, so passing Y shows the reader is good, not that its true rate is above 80%. Zero false found over about 350 real page-states is strict: a reader whose true false-found rate is 1% per page-state passes with probability of about 3% (0.99^350).

A held-out run fails if any of the three fails. **Criterion 1 is met by a specific reader commit**, recorded in `runs.json`. A reader changed after that commit (other than a change with no effect on the read path, for example a comment) and before Release A MUST pass again on the active held-out split within that split's remaining runs. Variant results are reported beside the bar, per transform, with bounds and every false found listed by class, but they aren't part of it. Results on development are never criterion-1 evidence.

## Peek policy and stop rule

- **Tuning.** Readers are tuned on `development` only. A reader developer MUST NOT open held-out snapshots, screenshots, labels or per-page outputs. They also MUST NOT browse a held-out site's product, cart or checkout pages.
- **Who runs held-out.** An evaluation subagent runs the held-out splits, never the reader's developer. The coordinator sees aggregate held-out results only: the metrics, bounds and the class-only failure counts below, never per-page outputs. Every reader run on any split is logged in `runs.json` before its results are read. The log records the run ID, UTC time, reader commit, split, frozen label hash and aggregate metrics. It is text-free.
- **Run limit.** `heldout-a` runs **at most twice in Phases 10–17 in total**. A run counts from the moment reader code executes over any held-out snapshot, whatever the run's purpose.
- **Class-only analysis.** Failures on a held-out split are analysed **by class only**. An analyst subagent that is not the reader developer reads the per-page outputs, which stay gitignored. It returns counts per class and per stream, with no domain, amount, selector or page text. The classes are: `region-missed`, `region-wrong`, `distractor-accepted` (with the distractor: strikethrough, installment, carousel, line item, savings, shipping progress, outside summary, other-currency approximation), `kind-wrong`, `amount-parse` (with the format: decimal comma, thousands separator, symbol position, zero-decimal, other), `currency` (wrong or missing currency), `unreadable-not-none`, `tie-not-ask`, `stability`, `crash`, `over-budget` and `other`. Fixes are made and tested on development.
- **Retiring A.** A second failed run of `heldout-a` retires it. A retired split may then be used as development data. `heldout-b` becomes active under the same rule: at most two runs, failures by class only.
- **Stop rule.** If `heldout-b` also fails twice, no held-out split is left. Reader work stops, and **Evan re-decides scope before Phase 15**.
- **After a pass.** Once a split passes, further runs on it still count toward its limit.

## Merchant-pipeline held-out domains

`evals/merchants/pipeline-heldout-domains.json` (`merchant-pipeline-heldout.1`) is frozen with **SHA-256 `6bc92515c90009b623c4de3d6f78395b860bc4ee68e305a05be243229b8d79b2`** and is **unchanged by `.2`**. It is still drawn from `retail-frame.1`, and `seeded-selection.mjs pipeline-heldout --check` still reproduces it byte for byte. Like the frames, it carries bands only, not ranks. It holds 60 domains, 6 / 27 / 27 per band. Per band, the eligible frame 1 domains are taken in ascending `pipeline-heldout` key order. The top band takes 6, a third of its 18 eligible domains, so that two thirds stay available for pipeline development. The other 54 are split evenly between the other two bands.

**Why it stays U.S.-only.** The merchant pipeline (Phase 16) drafts merchant profiles and the category evidence that card recommendations rest on, and recommendations stay U.S. and USD for now. Card recommendations for non-USD purchases (currency conversion, foreign transaction fees and non-U.S. category coding) are a later phase. A non-U.S. held-out list now would measure a pipeline output nothing uses yet. When non-USD recommendations start, that phase freezes its own non-U.S. held-out list from `retail-frame.2` before any drafting.

- **Profiles.** The held-out profiles for these domains are drafted and adjudicated at the **start of Phase 16, before any drafting** by the pipeline, under the Phase 16 protocol (which needs D5), and are frozen and hashed there. A profile covers name, hosts, `hostKind`, plausible categories with evidence class and source, `brandIds` and any MCC.
- **No tuning.** No prompt, few-shot example, convention, rule or tool of the merchant pipeline may be written or tuned using these domains, their pages or their profiles. Pipeline development uses other frame domains.
- **Phase 14 seed rows.** Phase 14 may seed merchant-database rows for some of these domains (default category, brand links). The Phase 16 drafting step MUST NOT read those rows, and the Phase 16 protocol says how they are scored.
- **Replacement.** A domain found at adjudication not to be an eligible store is dropped and replaced by the next domain of the same band in `pipeline-heldout` key order. Both are recorded with evidence, and an independent subagent that is neither the adjudicator nor a pipeline developer checks every drop before the profiles are frozen.
- **Overlap with the reader splits is allowed.** The two evaluations measure different outputs from different inputs: the reader turns a page DOM into an amount and currency, and the pipeline turns public evidence into a profile and category. Their selections use independent key purposes, so neither constrains the other. Excluding these domains from reader sampling would remove a third of the 18 eligible U.S. top-1k sites from a band the probe showed is already thin. All 60 are eligible U.S. domains in frame 2, and 37 of them are reader candidates under `.2` (46 under `.1`). 6 are probe sites (apple, barnesandnoble, gap, homedepot, nike, target), which only ever had cart totals labelled. Reader snapshots and labels of these domains MUST NOT be used to develop the merchant pipeline. Both reports give the overlap.

## Committed and gitignored

| Committed (text-free, or quotes of 25 words or fewer) | Gitignored |
| --- | --- |
| This protocol; `retail-frame.json`, `retail-frame-2.json` and `pipeline-heldout-domains.json` (bands, no ranks); `item-price-bands.json`; `tools/seeded-selection.mjs` and its test | The Tranco copy, exact ranks (`frame-ranks.json`, `frame2/frame-2-ranks.json`) and frame inputs (`evals/merchants/data/`, including `frame2/build.py` and the retailer lists) |
| 12.2–12.3: recipes, the candidate lists, `sites.json` (outcomes, observed storefront region and currency, platform and marker, robots and terms posture, exclusion codes, snapshot hashes), `splits.json`, labeller files, adjudication, final labels, `freeze.json`, errata, variant transforms and manifest, `runs.json`, reports | Snapshots (DOM trees, HTML, MHTML, screenshots, headers), robots.txt and terms copies, the capture profile, capture logs, per-page reader outputs on held-out splits |

Replays are new dated snapshots; labels are never overwritten.

## Reporting

`docs/evals/reader-captures-2026-10.md` (12.3) gives:

- the counts per split, state, band, stream, region group and currency;
- the blocked share per stream and band, and the [known gap](#bot-walled-sites-a-known-gap) of blocked sites by band and region;
- exclusions by code;
- platform groups per split;
- the frame's region and currency against the observed storefront;
- the robots and terms tallies;
- label agreement, currency agreement included;
- the freeze hashes.

Every reader report gives:

- the five outcome counts per state, with bounds at both levels;
- the subgroups above (stream, USD or not, region group, currency, locale tags) and the observed-tag subgroups;
- the known gap of blocked sites;
- variants apart;
- timing;
- errata beside the frozen-label scores;
- the held-out run count used;
- the frame bias statement.

## Changes to this protocol

- **Before the signature.** The protocol changes freely until the reviewer signs it.
- **After the signature.** Changes are dated amendments, appended below with a decision record.
- **Fixed for good.** The seed, the frames, the held-out domain list, the pass bar (0 false found, Y = 80%, p95 ≤ 50 ms), the outcome definitions and the label schema never change by builder amendment. Only an Evan decision record can change them. Amendment 1 is one.
- **Scoring amendments.** Any later change to how a split is scored needs an Evan decision record, and every affected result is then reported under both the old and the new rules.

### Amendments

#### Amendment 1 (2026-10-06): generic-reader-protocol.2

Evan's decisions in chat on 2026-10-06, recorded in the [decision](../../wiki/decisions/2026-10-06-global-reader-protocol-2.md). They were made before any capture, label or reader run, so no result exists under `.1` and nothing needs dual reporting. Written by the Phase 12.1 amendment builder (claude-code/claude-opus-5-5); the independent signature is pending.

- **A. Global extractor now, card recommendations later.** The generic reader must return the cart total and its currency on storefronts worldwide. What changed: frame `retail-frame.2` (worldwide, region and currency per domain, one storefront per retailer, new exclusion codes); two candidate streams of 200, with a stop at 110 captured sites per stream; strata band × region group × platform; location, currency and item-price rules at capture (`non-us-storefront` retired, `redirected-off-domain` added); locale observed tags and four locale variants, with `promo-row` and `credit-applied` generalized to any currency; label schema `reader-labels.2` (`amountMinor`, `currency`, `currencyEvidence`, `currency-undetermined`; `non-usd` retired); found-correct requires the currency to match, and a wrong currency is a false found; the pass bar keeps its numbers and applies to the whole held-out split, with U.S. and non-U.S. reported separately. Card recommendations for non-USD purchases are out of scope here. The merchant-pipeline held-out list is unchanged and stays U.S.-only ([why](#merchant-pipeline-held-out-domains)).
- **B. Bot-walled sites stay a known gap.** Sites excluded for a bot wall, 403, 429, CAPTCHA or extension check are listed and reported by band and region. Attended capture of them (Claude driving its built-in browser, Evan solving any CAPTCHA) is deferred to a later step with its own amendment and an Evan-approved in-page serializer.
- **Also.** The seeded-selection CLI now sets `process.exitCode` instead of calling `process.exit()`, which cut piped output at 64 KiB (the 400-candidate list is larger). `.1`'s candidate list (300 U.S. domains, output SHA-256 `e41ceff14d8dce0124f58d688ad2fd0bf884c0075080515ca9b6a7ab0f349092`) and its split procedure are superseded, unused.

## Related

- [Phase 12 plan](../../wiki/product/phase-12-reader-eval.md)
- [Merchant coverage design: real-page evaluation](../../wiki/system/merchant-coverage-design.md#real-page-evaluation-pre-registered-in-phase-12)
- [Phase 10 probe report](merchant-probe-2026-10.md)
- [Decision: reader protocol choices](../../wiki/decisions/2026-10-06-reader-eval-protocol.md)
- [Decision: global reader protocol (.2)](../../wiki/decisions/2026-10-06-global-reader-protocol-2.md)
