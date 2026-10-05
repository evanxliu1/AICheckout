---
type: System
title: Merchant coverage design (Phase 10, draft)
description: Proposed design for recommending a card at any U.S. online checkout — a hosted, reviewed merchant database matched on the device, engine changes for passed-in and generic profiles with category ranges, a deterministic generic cart reader (shadow DOM aware, never on payment processors) with store configs as data, a pre-registered real-page eval with three site splits, category evidence rules, URL-gated injection under an optional all-sites grant. Draft v6 after three review rounds; nothing here is built.
status: draft
tags: [system, design, phase-10, merchants]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T10:00:00Z
sources:
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

**Draft v6, not built, not approved.** The design behind the [Phase 10 plan](../product/phase-10-merchant-expansion.md); telemetry, operations and value metrics are in the [telemetry design](telemetry-design.md). Reviewed 2026-10-05 by two Fable 5.1 reviewers (v4), then by Fable 5.1 and Opus 5.5 in parallel (v5), all agent-verified; their findings are folded in. *(probe)* marks judgments the feasibility probe confirms. Scope: English UI, U.S. merchants, USD only; non-U.S. storefronts get the generic answer or nothing.

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
| **Merchant database** | Rows: `hosts` (authored registrable domains, matched by suffix), name, `hostKind` (`merchant` / `processor` / `marketplace`), online retail of physical goods, `plausibleCategories` with evidence class and source, `brandIds`, optional MCC with source, optional store config, optional verified `orderConfirmation`, `disabled` | `GET /v1/merchants`, versioned, reviewed; downloaded **whole**, cached with its release hash; matched on the device | Merchant release |
| **Engine and catalog (changed)** | The engine takes a merchant profile passed in (named or generic) instead of looking it up in the catalog, and returns a range when `plausibleCategories` has more than one; the catalog's `merchants` keeps the 3 legacy profiles until a merchant release supersedes them; a database `brandId` absent from the catalog in effect is ignored (tested, covers release skew) | Package + hosted catalog | Extension and catalog releases |
| **Generic cart reader** | Deterministic code returning `found` / `ask` / `none` | Extension package | Extension release |
| **Store configs** | Today's adapter JSON: selectors, anchored regexes with length limits and a safe-regex lint (Zod, SQL, publish), bounded counts; **no field may add control flow**; configs never widen where code runs, only which selectors run on an already-detected page | Database rows (bundled seed until milestone 5) | Merchant release |

**Remote-config fallback.** The 2026-09-29 decision bundled adapters because remote adapter specs looked like a remote-code risk. Selectors and anchored regexes are configuration read by packaged code, which Chrome's MV3 requirements allow; if Web Store review disagrees, store configs ship bundled and only profiles, categories, `processor` and `disabled` stay hosted. The schema works in either place.

**Matching.** Authored `hosts` (`bestbuy.com`) match by label-boundary suffix (`secure.newegg.com` matches `newegg.com`; `amazon.ca` never matches `amazon.com`); the Public Suffix List is used only offline. `processor` hosts (Shop Pay, PayPal, Bolt, Klarna, Affirm, legacy `checkout.shopify.com` *(probe)*): the reader never runs and the badge never shows; the popup may ask "Checking out from <previous merchant>?" using that tab's previous top-level URL kept in session memory only; the processor page is never read.

**Size, refresh and degradation.** Hard cap 2 MiB JSON (Zod and SQL). Refreshed weekly in the background with `alarms` and `ETag`/`If-None-Match`, plus on "Check for updated terms"; the worker tolerates Render's cold start; an expired (90 days) or unfetchable database degrades to the generic profile and never blocks a comparison. The catalog gets the same background refresh, so a store install never expires on a shopper who never clicks.

**Review workload.** Rows default to `general-merchandise`, evidence class 4, generic reader. The release diff shows only deviations with their evidence; Evan approves the batch. The coordinator publishes on Evan's chat "publish merchants <version>", as for catalogs.

## Checkout flow

1. **Detect on the URL, in the worker.** On a popup click (activeTab) or, with the optional grant, on `tabs.onUpdated`: a named profile's pinned paths or cart/checkout tokens (`/cart`, `/checkout`, `/basket`, `/bag`, `checkouts/`). Page code is injected with `executeScript` only on candidate URLs; no content script runs on all sites. Mini-cart drawers on product pages stay click-to-use.
2. **Profile:** named, or generic "Another U.S. online store" (`general-merchandise`).
3. **Amount:** store config if present and not `disabled`, else the generic reader; `found` → prefilled; `ask` → "We found $84.99 — is that right?"; `none` → typed.
4. **Rank:** the engine uses the amount only (`kind` is for display and savings); weak category evidence → a range.
5. **Savings:** order recognition and the savings question only at named profiles with a verified `orderConfirmation`; generic stores never ask.

Chrome's per-extension site-access setting is read at start and on `permissions.onAdded/onRemoved`.

## Generic cart reader

1. **Summary region:** headings and landmarks ("Order summary", "Cart totals", "Summary"), ARIA labels, platform markers as data; open shadow roots traversed with bounded depth and node count; a closed root or an iframe summary → `none`.
2. **Total rows:** label patterns paired with exactly one amount on the row.
3. **Distractors:** line items, recommendation carousels, "you saved", "N payments of $x", free-shipping progress, strikethrough prices, rewards points, saved-for-later, amounts outside the region. Negative or "applied" rows (gift card, store credit, discount) are never the amount but make "total after credit" the preferred kind.
4. **Currency:** a bare `$` is USD only if no non-USD marker (`CA$`, `C$`, `A$`, `CAD`, `MXN`) is in the region and the page `lang` is not `en-CA` or `en-AU`.
5. **Stability:** two identical reads 500 ms apart and no `aria-busy` or loading indicator.
6. **Decide:** one candidate of the most preferred kind (total after credit > estimated total > subtotal) → `found`; several → `ask`; none → `none`; never `found` on a tie.
7. **Budget:** p95 under 50 ms on captured pages *(probe)*.

## Real-page evaluation (pre-registered in milestone 2)

| Element | Design |
| --- | --- |
| Sites | 150–200 top retail domains stratified by platform (including "none detected", shadow-DOM storefronts, third-party checkouts) and rank band; split **by site** into development, held-out A and held-out B, each platform in every split |
| Capture | A persistent, non-Evan Chrome profile driven by Playwright, logged out; one known in-stock item; may open a checkout page but never signs in and never fills or submits any field; never bypasses bot walls or solves CAPTCHAs; rate-limited; robots and terms posture recorded; exclusion list reported |
| Format | Snapshots with inlined styles (Playwright snapshot or MHTML); the reader's live result recorded at capture as a replay check |
| Ground truth | The summary rows as displayed: two independent labeler subagents label every amount with its kind; disagreements go to an adjudicator subagent (never a labeler); agreement rate reported. Product price × quantity is a consistency flag only. Correct = returned amount equals the labelled amount of the returned kind, and the kind is the most preferred one present |
| States | 1 item; quantity 2; 2 items; mini-cart vs cart page; strikethrough sale; promo banner; carousel with prices; tax/shipping estimate; installment widget; free-shipping progress; gift card or credit applied; empty; loading; shadow DOM; third-party checkout |
| Variants | Class renames, injected promo rows, fake "Subtotal" outside the summary, injected instruction text (targets the labeler and capture agents, which read untrusted HTML; the reader has no model) |
| Statistics | Rule-of-three / Wilson 95% bounds at the state and site-cluster level, both reported; with about 50–65 sites per split, 0 failures gives a site-level upper bound of about 5% |
| Peek policy | Held-out A runs **at most twice in Phase 10 in total**; failures analysed by class only, fixed on development; a second failure retires A, and B then runs under the same rule |
| Copyright | Snapshots gitignored; committed: URL, date, hash, recipe, labels, redacted structure fixtures; replays are new dated snapshots, labels never overwritten |

## Category evidence

The bonus depends on the merchant category code the processor assigns; it is not public and varies by network and channel. Evidence classes: (1) issuer statements in captured card terms; (2) a network lookup (Mastercard merchant API: paid keys, a later decision and directive); (3) crowdsourced lookups, which may only corroborate, never copied; (4) business-type inference, `low`. A domain whose plausible category is a catalog bonus category (grocery, dining/delivery, drugstore, wholesale club, travel, department store, home improvement, electronics) needs class 1 or 2 evidence, otherwise its recommendation is a range; others default to `general-merchandise`.

## Permissions

- Required: `storage`, `activeTab`, `scripting`, `alarms` (from Release A, for background refresh; no install warning).
- Optional: `https://*/*` in `optional_host_permissions`, requested on a click ("Show the badge automatically at checkouts"); no install warning; adding it later disables nothing.
- Badge frame on arbitrary sites: `web_accessible_resources` on all sites lets any page detect the extension; prefer `use_dynamic_url: true` with nonce routing, or disclose it *(probe: also strict-CSP checkouts)*.
- Merchant names length- and charset-limited in Zod; `dangerouslySetInnerHTML` forbidden by lint.

## Related

* [Phase 10 plan](../product/phase-10-merchant-expansion.md)
* [Telemetry design](telemetry-design.md)
* [Extension](extension.md)
* [Cart badge](cart-badge.md)
* [Merchants](../domain/merchants.md)
