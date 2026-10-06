---
type: System
title: Merchant coverage design (Phase 10, draft)
description: Proposed design for recommending a card at any U.S. online checkout — a hosted, reviewed merchant database matched on the device, engine changes for passed-in and generic profiles with category ranges, a deterministic generic cart reader that shows the total and currency only when certain and otherwise withholds, worldwide (shadow DOM aware, never on payment processors; no store configs since 2026-10-06), a pre-registered real-page eval with three site splits, category evidence rules, URL-gated injection under an optional all-sites grant. Draft v6 after three review rounds; nothing here is built.
status: draft
tags: [system, design, phase-10, merchants]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-06T23:30:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol (pre-registered 2026-10-05)
  - resource: ../product/phase-10-merchant-expansion.md
    title: Phase 10 plan
  - resource: telemetry-design.md
    title: Telemetry, operations and value metrics design
  - resource: ../../extension/src/checkout/page-reader.ts
    title: Current interpreter (querySelectorAll, getComputedStyle; no shadow traversal)
  - resource: ../../packages/rewards-core/src/schema.ts
    title: Catalog v3 merchant profiles (merchantProfileV3Schema, 100-merchant limit)
  - resource: ../decisions/2026-09-29-bundled-site-adapters.md
    title: Decision to bundle adapters (superseded on approval)
  - resource: https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements
    title: Chrome MV3 requirements (remote data allowed, no remote logic)
  - resource: https://developer.chrome.com/docs/extensions/reference/api/permissions
    title: Chrome permissions API (optional host permissions, user gesture)
---

# Merchant coverage design (Phase 10, draft)

**Draft v6, not built, not approved.** The design behind the [Phase 10 plan](../product/phase-10-merchant-expansion.md); telemetry, operations and value metrics are in the [telemetry design](telemetry-design.md). Reviewed 2026-10-05 by two Fable 5.1 reviewers (v4), then by Fable 5.1 and Opus 5.5 in parallel (v5), all agent-verified; their findings are folded in. *(probe)* marks judgments the feasibility probe confirms. Scope: English UI; recommendations for U.S. merchants in USD. The generic cart reader is global: it returns the total and its currency on storefronts worldwide (Evan, 2026-10-05, [decision](../decisions/2026-10-05-global-reader-protocol-2.md)); a non-USD cart gets no card recommendation until the later non-USD recommendation phase.

## How mainstream products do it (researched 2026-10-05)

| Product | Coverage model | Data |
| --- | --- | --- |
| PayPal Honey | Server list of supported domains, per-shop metadata fetched on visit; all-sites permission | Shop page views and URLs, purchase value, device and account IDs |
| Capital One Shopping | "100,000+" stores, server-driven | Browsing and search history, purchases; shared with ad partners |
| Rakuten | Server-driven, all sites | Web history across sites, cart adds |
| Kudos (card recommender, closest) | Recognizes known checkouts, matches cards to merchant category; about 30–40k users and 4.8★ on its Chrome listing (read 2026-10-05) | Issuer sites visited, card type and last 4; real category coding from opt-in Plaid transactions |
| CardPointers, MaxRewards | Category suggestions on "1,000s of sites"; card-linked offers through bank logins | Bank-linked (MaxRewards via Plaid) |

Copied: hosted merchant data, configs as data, generic detection. Not copied: browsing collection, per-domain server lookups, bank linking, card-linked offers, card autofill, mobile apps (non-goals for Phase 10; bank logins are against the project's rules).

## Architecture

| Component | What | Where | Ships by |
| --- | --- | --- | --- |
| **Merchant database** | Rows: `hosts` (authored registrable domains, matched by suffix), name, `hostKind` (`merchant` / `processor` / `marketplace`), online retail of physical goods, `plausibleCategories` with evidence class and source, `brandIds`, optional MCC with source, optional verified `orderConfirmation`, `disabled` (no store configs since 2026-10-06); the release also carries the top-retail **allowlist** that "Suggest this store" checks (sensitive categories removed) | `GET /v1/merchants`, versioned, reviewed; downloaded **whole**, cached with its release hash; matched on the device | Merchant release |
| **Engine and catalog (changed)** | The engine takes a merchant profile passed in (named or generic) instead of looking it up in the catalog, and returns a range when `plausibleCategories` has more than one, or when its one plausible category is a catalog bonus category without class 1 or 2 evidence (range with `general-merchandise`); the catalog's `merchants` keeps the 3 legacy profiles until a merchant release supersedes them; a database `brandId` absent from the catalog in effect is ignored (tested, covers release skew) | Package + hosted catalog | Extension and catalog releases |
| **Generic cart reader** | Deterministic code that **shows** one amount (with kind and currency) only when certain, otherwise **withholds** (no `ask`, Evan 2026-10-06) | Extension package | Extension release |

**No store configs (Evan, 2026-10-06).** Per-store settings are dropped everywhere: no store configs in the merchant database and none authored by the merchant pipeline; coverage depends on the generic reader alone ([decision](../decisions/2026-10-06-reader-shows-only-certain-amounts.md)). The three legacy adapters (Amazon, Best Buy, Newegg) stay bundled until the generic reader matches them on those stores, then retire. Hosted merchant data is profiles, categories, `processor` and `disabled` only.

**Matching.** Authored `hosts` (`bestbuy.com`) match by label-boundary suffix (`secure.newegg.com` matches `newegg.com`; `amazon.ca` never matches `amazon.com`); the Public Suffix List is used only offline. `processor` hosts (Shop Pay, PayPal, Bolt, Klarna, Affirm, legacy `checkout.shopify.com` *(probe)*): the reader never runs and the badge never shows; the popup may ask "Checking out from <previous merchant>?" using that tab's previous top-level URL kept in session memory only; the processor page is never read.

**Size, refresh and degradation.** Hard cap 2 MiB JSON (Zod and SQL). Refreshed weekly in the background with `alarms` and `ETag`/`If-None-Match`, plus on "Check for updated terms"; the worker tolerates Render's cold start; an expired (90 days) or unfetchable database degrades to the generic profile and never blocks a comparison. The catalog gets the same background refresh, so a store install never expires on a shopper who never clicks.

**Review workload.** Rows default to `general-merchandise`, evidence class 4, generic reader. The release diff shows only deviations with their evidence; Evan approves the batch. The coordinator publishes on Evan's chat "publish merchants <version>", as for catalogs.

## Checkout flow

1. **Detect on the URL, in the worker.** On a popup click (activeTab) or, with the optional grant, on `tabs.onUpdated`: a named profile's pinned paths or cart/checkout tokens (`/cart`, `/checkout`, `/basket`, `/bag`, `checkouts/`). Page code is injected with `executeScript` only on candidate URLs; no content script runs on all sites. Mini-cart drawers on product pages stay click-to-use.
2. **Profile:** named, or generic "Another U.S. online store" (`general-merchandise`).
3. **Amount:** the generic reader (store configs dropped 2026-10-06; the three legacy adapters stay until the generic reader matches them); a shown amount is used; otherwise no amount is shown and the recommendation shows rates only (no confirmation prompt; [decision](../decisions/2026-10-06-reader-shows-only-certain-amounts.md), 2026-10-06; supersedes the `ask` prompt).
4. **Rank:** the engine uses the amount only (`kind` is for display and savings); weak category evidence → a range.
5. **Savings:** order recognition and the savings question only at named profiles with a verified `orderConfirmation`; generic stores never ask.

Chrome's per-extension site-access setting is read at start and on `permissions.onAdded/onRemoved`.

## Generic cart reader

1. **Summary region:** headings and landmarks ("Order summary", "Cart totals", "Summary"), ARIA labels, platform markers as data; open shadow roots traversed with bounded depth and node count; a closed root or an iframe summary → withhold.
2. **Total rows:** label patterns paired with exactly one amount on the row.
3. **Distractors:** line items, recommendation carousels, "you saved", "N payments of $x", free-shipping progress, strikethrough prices, rewards points, saved-for-later, amounts outside the region. Negative or "applied" rows (gift card, store credit, discount) are never the amount but make "total after credit" the preferred kind.
4. **Currency (any currency, Evan 2026-10-05):** every shown amount carries an ISO 4217 currency and the amount in its minor units (yen and won have none). Formats: decimal comma or point, thousands dot, comma, space or apostrophe, symbol before or after, code-only amounts. The ground truth follows the protocol's [currency evidence](../../docs/evals/generic-reader-protocol.md#currency-evidence) precedence: a code in the summary (including `CA$`, `A$`, `MX$`, `R$`), then structured data (`priceCurrency`, currency meta tags, cart data attributes), then an unambiguous symbol (`€`, `£`, `₹`, `₩`, …), then for an ambiguous symbol (`$`, `¥`, `kr`) the store's known storefront currency unless a conflicting marker shows; the page `lang` never decides. "Approx." amounts in another currency are distractors. If the currency stays undetermined the reader withholds. A wrong currency is a shown-wrong amount. The popup recommends only for USD.
5. **Stability:** two identical reads 500 ms apart and no `aria-busy` or loading indicator.
6. **Decide:** exactly one candidate of the most preferred kind (total after credit > estimated total > subtotal), stable and in a certain currency → show it; anything else (several, none, unstable, unreadable, undetermined currency) → withhold; never show on a tie.
7. **Budget:** p95 under 50 ms on captured pages *(probe)*. Probe 2026-10-05: the prototype's logic took p95 8.5 ms over a pre-built tree, but a whole-page `getComputedStyle` walk took p95 691 ms, so v1 reads styles lazily inside candidate regions ([report](../../docs/evals/merchant-probe-2026-10.md#q5-does-a-prototype-reader-find-the-total)).

## Real-page evaluation (pre-registered in Phase 12)

Pre-registered on 2026-10-05 in [`docs/evals/generic-reader-protocol.md`](../../docs/evals/generic-reader-protocol.md), amended since; this summary follows `generic-reader-protocol.8` (2026-10-06, signature pending; `.7` binds until then). The protocol is binding and wins over this summary.

| Element | Design |
| --- | --- |
| Sites | Frozen retail frame of the **most-visited retailers** (`evals/merchants/retail-frame-3.json`, `retail-frame.3`, since `generic-reader-protocol.3`, pending signature): Chrome UX Report 2026-08 country top lists (U.S. to rank 5,000, 24 other large markets to rank 1,000) ∩ agent-classified physical-goods retail, CrUX buckets per list (CC BY 4.0, attributed), one storefront per retailer family per country; also in the 2026-02 or 2026-05 list required (persistence); 1,861 eligible: U.S. 99 top-1k and 326 1k-5k, non-U.S. 1,436 top-1k; region, currency and region group per domain, predicted for a U.S. visitor. Candidates most popular bucket first, the non-U.S. stream round-robining countries: since `.8` U.S. 425 (all eligible) and non-U.S. 1,000, capture stopping at 330 + 500 captured sites, with report rules when fewer than about 300 held-out `cart-1` pages are reachable. Split **by site** into development, held-out A and held-out B, weighted 1 : 2 : 2 since `.8` (about 330 held-out sites each), stratified by band × region group × platform group with a seeded deterministic assignment that sees only the frame and the platform group, an operator (the company running the stores) always in one split; captured probe sites in development only. `retail-frame.2` (Tranco, worldwide) is superseded; `retail-frame.1` (U.S., 457 eligible) stays frozen for the merchant-pipeline held-out list |
| Capture | **Since `.8` (Evan, 2026-10-06): agent-driven in the Claude desktop app's browser pane**, Claude Code subagents, different stores in parallel (8, up to 16) in their own tabs, logged out, one IP and one profile; same safety posture by an operator checklist (no typing, no sign-in, add-to-cart the only submit, never a checkout, cookies declined, stop on CAPTCHA or bot wall with no solving, page text untrusted) ; robots.txt recorded but never excluding (Evan, 2026-10-06, for `.8`; stores visited despite a disallow are counted); agents never solve or interact with CAPTCHAs or bot checks and identify honestly; any in-stock in-band item by ordinary navigation; pages exported with the Evan-approved in-page script as `pane-dom.1` and rebuilt offline into static pages for labellers and replay; Evan does nothing by hand. **Until `.7` (kept, retired as the main path):** a persistent, non-Evan Chrome profile driven by Playwright from a U.S. connection (no proxy or VPN), logged out, no extension loaded; the storefront's country and currency accepted as served, never changed; a look-only reconnaissance session per site first, which finds the listing, the first in-stock item within a per-currency band of about USD 10–200 and the real cart path by fixed rules and writes the recipe (`.4`, 2026-10-06); never enters a checkout (since `.5`, 2026-10-06: `checkout-1` is a reported gap deferred to the attended step), never signs in and never fills or submits any field; never bypasses bot walls or solves CAPTCHAs; the tool itself refuses submit and in-form clicks except an add-to-cart allowlist, has no typing or coordinate-click path, and protects any local control server with a token and Origin check (the probe's prototype driver did not, 2026-10-05); no reader code runs during capture; one site at a time, at least 3 s between actions; robots.txt excludes the site only when it disallows everything, on any host of the site loaded (Evan, 2026-10-06; replaced the 2026-10-05 rule that also excluded on cart or checkout paths), cart and checkout disallows and terms clauses recorded but not excluding; exclusion list reported with codes, judgement exclusions with screenshot evidence. Bot-walled sites are a reported gap by band and region, `geo-blocked` sites reported apart; attended capture of them (Claude in its built-in browser, Evan solving any CAPTCHA) is deferred to its own amendment (Evan, 2026-10-05). Built in 12.2 as `evals/merchants/capture/` ([README](../../evals/merchants/capture/README.md), 2026-10-05) |
| Format | Snapshots that keep open shadow roots and the styles the reader reads: robot captures as DOM tree, MHTML, screenshot, headers and hashes; pane captures as `pane-dom.1` (all elements and attributes, text, open shadow roots, computed styles and boxes on text elements) with a static rebuild; no reader result is recorded at capture |
| Ground truth | The summary rows as displayed: two independent labeler subagents label every amount with its kind and **currency** (ISO 4217, amount in minor units from a committed table, currency decided by a fixed precedence: code in the summary, structured data, unambiguous symbol, else the frame's storefront currency; `lang` never decides) and never see each other's labels or any reader output; disagreements go to an adjudicator subagent who never labelled that split; agreement reported (below 90% stops before the freeze). Labels of all three splits frozen and SHA-256-hashed before any reader run on any split; pass bar, outcome definitions and label schema change only by an Evan decision (as on 2026-10-05, before any capture); later fixes are dated errata reported beside the frozen-label score. Product price × quantity is a consistency flag only. Correct = returned currency equals the labelled currency, returned amount equals the labelled amount of the returned kind, and the kind is the most preferred one present; a wrong currency is shown-wrong; a summary only in an iframe or closed shadow root, an ambiguous preferred kind and an undetermined currency have correct answer withhold |
| States | Action (produced): empty cart, mini-cart, cart page with 1 item (the state for Y), first checkout page, quantity 2, 2 items. Observed (tagged, reported as subgroups): strikethrough sale, promo banner, carousel with prices, tax/shipping estimate, installment widget, free-shipping progress, credit applied, loading, shadow DOM, iframe or third-party checkout; locale and format: decimal comma, thousands dot, space or apostrophe, currency after the amount, code-only amounts, zero-decimal currencies, shared symbols, several currencies shown, non-Latin digits, right-to-left layout, non-English labels |
| Variants | Offline, from real snapshots of the same split, labels derived by rule and frozen with the split: class renames, injected promo rows, fake "Subtotal" outside the summary, injected instruction text (targets the labeler and capture agents, which read untrusted HTML; the reader has no model), credit applied; locale: decimal convention swapped, decimal comma with space grouping and symbol after, rewritten as zero-decimal JPY or KRW, other-currency approximations and a currency switcher; reported apart from real pages |
| Statistics | Since `.8`: shown-correct, shown-wrong (wrong currency included) and withheld. **Pass bar (Evan, 2026-10-06):** on real pages of the active held-out split as a whole, the exact one-sided 95% upper bound of the wrong-amount rate among shown amounts is ≤ 1% (at least 299 shown page-states with none wrong), and p95 reading time ≤ 50 ms; met by a specific reader commit. Coverage (shown-correct ÷ pages with an expected amount) reported per stream and state with Wilson bounds, target 80% on `cart-1`, never a pass condition. Legacy adapters scored apart. U.S. and non-U.S., USD and non-USD, region groups and currencies reported separately, without targets |
| Peek policy | Held-out A runs **at most twice in Phases 10–17 in total**; failures analysed by class only, by an analyst who is not the reader developer, fixed on development; a second failure retires A, and B then runs under the same rule; B failing twice triggers the stop rule (Evan re-decides before Phase 15) |
| Copyright | Snapshots gitignored; committed: URL, date, hash, recipe, labels, redacted structure fixtures; replays are new dated snapshots, labels never overwritten |

## Category evidence

The bonus depends on the merchant category code the processor assigns; it is not public and varies by network and channel. Evidence classes: (1) issuer statements in captured card terms; (2) a network lookup (Mastercard merchant API: paid keys, a later decision and directive); (3) crowdsourced lookups, which may only corroborate, never copied; (4) business-type inference, `low`. A domain whose plausible category is a catalog bonus category (grocery, dining/delivery, drugstore, wholesale club, travel, department store, home improvement, electronics) needs class 1 or 2 evidence, otherwise its recommendation is a range; others default to `general-merchandise`.

## Permissions

- Required: `storage`, `activeTab`, `scripting`, `alarms` (from Release A, for background refresh; no install warning), plus the 3 legacy hosts and the catalog origin until Release B (D13).
- Optional: `https://*/*` in `optional_host_permissions`, requested on a click ("Show the badge automatically at checkouts"); no install warning; adding it later disables nothing.
- Badge frame on arbitrary sites: `web_accessible_resources` on all sites lets any page detect the extension; re-evaluate `use_dynamic_url` (today `false` by design: the worker identifies the badge frame by its static URL, and a per-frame nonce stops page copies), changing sender identification with it, or disclose the exposure *(probe: also strict-CSP checkouts)*. Probe 2026-10-05: a badge-shaped `chrome-extension://` frame loaded on all 44 captured pages, including 4 sites whose CSP restricts `frame-src` ([report](../../docs/evals/merchant-probe-2026-10.md#q4-can-the-badge-frame-show)).
- Merchant names length- and charset-limited in Zod; `dangerouslySetInnerHTML` forbidden by lint.

## Related

* [Phase 10 plan](../product/phase-10-merchant-expansion.md)
* [Telemetry design](telemetry-design.md)
* [Extension](extension.md)
* [Cart badge](cart-badge.md)
* [Merchants](../domain/merchants.md)
