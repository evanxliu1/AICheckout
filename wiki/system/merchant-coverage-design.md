---
type: System
title: Merchant coverage design (Phase 10, draft)
description: Proposed design for recommending a card at any U.S. online checkout — a hosted, reviewed merchant database matched on the device, engine changes for passed-in and generic profiles with category ranges, a deterministic generic cart reader (shadow DOM aware, never on payment processors) with store configs as data, a pre-registered real-page eval with three site splits, category evidence rules, URL-gated injection under an optional all-sites grant. Draft v6 after three review rounds; nothing here is built.
status: draft
tags: [system, design, phase-10, merchants]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-06T04:00:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol (pre-registered 2026-10-06)
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
| **Merchant database** | Rows: `hosts` (authored registrable domains, matched by suffix), name, `hostKind` (`merchant` / `processor` / `marketplace`), online retail of physical goods, `plausibleCategories` with evidence class and source, `brandIds`, optional MCC with source, optional store config, optional verified `orderConfirmation`, `disabled`; the release also carries the top-retail **allowlist** that "Suggest this store" checks (sensitive categories removed) | `GET /v1/merchants`, versioned, reviewed; downloaded **whole**, cached with its release hash; matched on the device | Merchant release |
| **Engine and catalog (changed)** | The engine takes a merchant profile passed in (named or generic) instead of looking it up in the catalog, and returns a range when `plausibleCategories` has more than one, or when its one plausible category is a catalog bonus category without class 1 or 2 evidence (range with `general-merchandise`); the catalog's `merchants` keeps the 3 legacy profiles until a merchant release supersedes them; a database `brandId` absent from the catalog in effect is ignored (tested, covers release skew) | Package + hosted catalog | Extension and catalog releases |
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
7. **Budget:** p95 under 50 ms on captured pages *(probe)*. Probe 2026-10-05: the prototype's logic took p95 8.5 ms over a pre-built tree, but a whole-page `getComputedStyle` walk took p95 691 ms, so v1 reads styles lazily inside candidate regions ([report](../../docs/evals/merchant-probe-2026-10.md#q5-does-a-prototype-reader-find-the-total)).

## Real-page evaluation (pre-registered in Phase 12)

Pre-registered on 2026-10-06 in [`docs/evals/generic-reader-protocol.md`](../../docs/evals/generic-reader-protocol.md) (`generic-reader-protocol.1`), which is binding and wins over this summary.

| Element | Design |
| --- | --- |
| Sites | Frozen retail frame (`evals/merchants/retail-frame.json`, rank bands only, no exact ranks; Tranco 647LX ∩ agent-classified U.S. physical-goods retail, 457 eligible domains in the top 100,000); 300 candidates in a seeded order, capture stops at 195 sites (150 minimum); split **by site** into development, held-out A and held-out B (about 50–65 each), stratified by rank band and platform group with a seeded deterministic assignment; every platform group with at least three non-probe sites in every split; the 25 probe sites in development only |
| Capture | A persistent, non-Evan Chrome profile driven by Playwright, logged out, no extension loaded; one known in-stock item ($10–$200); may open a checkout page but never signs in and never fills or submits any field; never bypasses bot walls or solves CAPTCHAs; the tool itself refuses submit and in-form clicks except an add-to-cart allowlist, has no typing or coordinate-click path, and protects any local control server with a token and Origin check (the probe's prototype driver did not, 2026-10-05); no reader code runs during capture; one site at a time, at least 3 s between actions; robots.txt that disallows everything or the cart or checkout paths excludes the site (Evan, 2026-10-06), terms clauses recorded but not excluding; exclusion list reported with codes, judgement exclusions with screenshot evidence. Built in 12.2 as `evals/merchants/capture/` ([README](../../evals/merchants/capture/README.md), 2026-10-06) |
| Format | Snapshots that keep open shadow roots and the styles the reader reads (DOM tree, MHTML, screenshot, headers, hashes); no reader result is recorded at capture |
| Ground truth | The summary rows as displayed: two independent labeler subagents label every amount with its kind and never see each other's labels or any reader output; disagreements go to an adjudicator subagent who never labelled that split; agreement reported (below 90% stops before the freeze). Labels of all three splits frozen and SHA-256-hashed before any reader run on any split; pass bar, outcome definitions and label schema fixed permanently; later fixes are dated errata reported beside the frozen-label score. Product price × quantity is a consistency flag only. Correct = returned amount equals the labelled amount of the returned kind, and the kind is the most preferred one present; a summary only in an iframe or closed shadow root has correct answer `none` |
| States | Action (produced): empty cart, mini-cart, cart page with 1 item (the state for Y), first checkout page, quantity 2, 2 items. Observed (tagged, reported as subgroups): strikethrough sale, promo banner, carousel with prices, tax/shipping estimate, installment widget, free-shipping progress, credit applied, loading, shadow DOM, iframe or third-party checkout |
| Variants | Offline, from real snapshots of the same split, labels derived by rule and frozen with the split: class renames, injected promo rows, fake "Subtotal" outside the summary, injected instruction text (targets the labeler and capture agents, which read untrusted HTML; the reader has no model), credit applied; reported apart from real pages |
| Statistics | Found-correct, false found, ask, none-missed, none-correct; rule-of-three and Wilson 95% bounds at the page-state and site-cluster level, both reported; with about 60 sites per split, 0 failures gives a site-level upper bound of 5.0% (rule of three) or 6.0% (Wilson). Pass bar on real pages of the active held-out split: 0 false found, found-correct ≥ Y = 80% on one-item cart pages, p95 reading time ≤ 50 ms; met by a specific reader commit |
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
