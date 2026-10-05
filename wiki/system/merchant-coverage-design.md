---
type: System
title: Merchant coverage design (Phase 10, draft)
description: Proposed design for recommending a card at any U.S. online checkout — a hosted, reviewed merchant database matched on the device, a deterministic generic cart reader (shadow DOM aware, never on payment processors) with store configs as data, a pre-registered real-page eval with three site splits, category evidence with ranges, and URL-gated injection under an optional all-sites grant. Draft v5 after two Fable 5.1 reviews; nothing here is built.
status: draft
tags: [system, design, phase-10, merchants]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T09:00:00Z
sources:
  - resource: ../product/phase-10-merchant-expansion.md
    title: Phase 10 plan
  - resource: telemetry-design.md
    title: Telemetry and value metrics design
  - resource: ../../extension/src/checkout/page-reader.ts
    title: Current interpreter (querySelectorAll, getComputedStyle; no shadow traversal)
  - resource: https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements
    title: Chrome MV3 requirements (remote data allowed, no remote logic)
  - resource: https://developer.chrome.com/docs/extensions/reference/api/permissions
    title: Chrome permissions API (optional host permissions, user gesture)
  - resource: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
    title: activeTab
---

# Merchant coverage design (Phase 10, draft)

**Draft v5, not built, not approved.** The design behind the [Phase 10 plan](../product/phase-10-merchant-expansion.md); telemetry is in [telemetry design](telemetry-design.md). v4 was reviewed by two independent Fable 5.1 reviewers on 2026-10-05 (technical and product lenses, agent-verified); their findings are folded in and marked "(review)" where they changed the design. Items marked *(probe)* are judgments the feasibility probe must confirm.

## How mainstream products do it (researched 2026-10-05)

| Product | Coverage model | Data |
| --- | --- | --- |
| PayPal Honey | Server list of supported domains, per-shop metadata fetched on visit; all-sites permission | Shop page views and URLs, purchase value, device and account IDs |
| Capital One Shopping | "100,000+" stores, server-driven | Browsing and search history, purchases; shared with ad partners |
| Rakuten | Server-driven, all sites | Web history across sites, cart adds |
| Kudos (card recommender, closest) | Recognizes known checkouts, matches cards to merchant category; ~30–40k Chrome users, 4.8★ | Issuer sites visited, card type and last 4; real category coding from opt-in Plaid transactions |
| CardPointers, MaxRewards | Category suggestions on "1,000s of sites"; card-linked offers through bank logins | Bank-linked (MaxRewards via Plaid) |

We copy the architecture (hosted merchant data, configs as data, generic detection) and not the data appetite. Card-linked offer auto-add, bank linking, card autofill and mobile apps are **non-goals** for Phase 10 (bank logins are against the project's rules); the differentiation line is "no bank login, no issuer scraping, nothing leaves the device without your consent".

## Architecture

| Component | What | Where | Changes ship by |
| --- | --- | --- | --- |
| **Merchant database** | Rows: `hosts` (authored, e.g. `bestbuy.com`, `*.bestbuy.com`), name, `hostKind` (`merchant` / `processor` / `marketplace`), online retail of physical goods, `expectedCategory` + evidence class + source, `brandIds`, optional MCC with source, optional store config, `disabled` | Hosted (`GET /v1/merchants`), versioned, reviewed; downloaded **whole**, cached with its release hash; matched on the device | Merchant release on Evan's approval |
| **Generic cart reader** | Deterministic code returning `found` / `ask` / `none` | Extension package | Extension release |
| **Store configs** | Today's adapter JSON (selectors, anchored regexes, bounded counts); **no field may add control flow**; configs never widen where code runs, only which selectors run on an already-detected page (review) | Rows in the merchant database | Merchant release |
| **Engine and card catalog** | Unchanged | Package + hosted catalog | Catalog release |

**Matching (review).** Suffix match on authored `hosts` at label boundaries (`secure.newegg.com` matches `newegg.com`; `amazon.ca` never matches `amazon.com`); the Public Suffix List is used only offline in the pipeline. `processor` hosts (Shop Pay, PayPal, Bolt, Klarna, Affirm, legacy `checkout.shopify.com`) *(probe)*: the reader never runs and the badge never shows; the popup may offer "Checking out from <the tab's previous merchant>?" from that tab's prior top-level navigation only.

**Size and degradation (review).** Hard cap 2 MiB JSON, mirrored in SQL; `chrome.storage.local` also holds the ≤ 1 MiB catalog *(probe: quota)*. An expired or unfetchable merchant database degrades to the generic profile and never blocks a comparison (unlike catalog expiry). Merchant releases expire after 90 days.

**Review workload (review).** Rows default to `general-merchandise`, evidence class 4, generic reader. The release diff shows only deviations (non-default category, MCC, store config, `disabled`, `processor`, brand links) with their evidence; Evan approves the batch.

## Checkout flow

1. **Detect on the URL, in the worker (review).** On a popup click (activeTab), or with the optional all-sites grant on `tabs.onUpdated`, the worker checks the URL: a named profile's pinned paths, or cart/checkout tokens (`/cart`, `/checkout`, `/basket`, `/bag`, `checkouts/`). Page code is injected with `executeScript` **only** on candidate URLs. No content script is registered on all sites. Mini-cart drawers on product pages stay click-to-use.
2. **Profile:** named profile, or the generic profile "Another U.S. online store" (`general-merchandise`).
3. **Amount:** store config if present and not `disabled`, else the generic reader. `found` → prefilled; `ask` → "We found $84.99 — is that right?" with alternatives; `none` → typed.
4. **Rank:** the engine uses the amount only (`kind` is for display and savings). Where the category decides the answer and evidence is weak, it shows a range ("5% if it codes as grocery, otherwise 1%").

Chrome's per-extension site-access setting (on click / specific sites / all sites) is read at start and on `permissions.onAdded/onRemoved`.

## Generic cart reader

1. **Summary region:** headings and landmarks ("Order summary", "Cart totals", "Summary"), ARIA labels, platform markers as data; traverses **open shadow roots** with bounded depth and node count; a closed root or an iframe summary → `none` (review).
2. **Total rows:** label patterns paired with exactly one amount on the row.
3. **Distractors rejected:** line items, recommendation carousels, "you saved", "N payments of $x", free-shipping progress, strikethrough prices, rewards points, saved-for-later, amounts outside the region. Negative or "applied" rows (gift card, store credit, discount) are never the amount but make "total after credit" the preferred kind (review).
4. **Currency (review):** a bare `$` counts as USD only if no non-USD marker (`CA$`, `C$`, `A$`, `CAD`, `MXN`) appears in the region and the page `lang` is not `en-CA` or `en-AU`.
5. **Stability (review):** two identical reads 500 ms apart and no `aria-busy` or loading indicator before `found`.
6. **Decide:** one candidate of the most preferred kind (total after credit > estimated total > subtotal) → `found`; several → `ask`; none → `none`; never `found` on a tie.
7. **Budget:** p95 under 50 ms on captured pages *(probe)*.

## Real-page evaluation (pre-registered before any tuning)

| Element | Design |
| --- | --- |
| Sites | 150–200 top retail domains, stratified by platform (including "no detected platform", shadow-DOM storefronts and third-party checkouts) and rank band; split **by site** into development, held-out A and held-out B, each platform in every split (review) |
| Capture | A persistent, non-Evan Chrome profile driven by Playwright, logged out; one known in-stock item; never sign-in, checkout, address or payment fields; never bypass bot walls or solve CAPTCHAs; rate-limited; the exclusion list is reported (review) |
| Format | Snapshots with inlined styles (Playwright snapshot or MHTML) so visibility replays; the reader's live result recorded at capture as a replay check (review) |
| Ground truth (review) | The **summary rows as displayed**: two independent labeler subagents label every amount with its kind (subtotal, estimated total, total, discount, gift card, tax, shipping) and must agree; product price × quantity is only a consistency flag. Correct = the returned amount equals the labelled amount of the returned kind, and the kind is the most preferred one present |
| States | 1 item; quantity 2; 2 items; mini-cart vs cart page; strikethrough sale; promo banner; carousel with prices; tax/shipping estimate; installment widget; free-shipping progress; gift card or credit applied; empty; loading; shadow DOM; third-party checkout |
| Variants | Class renames, injected promo rows, fake "Subtotal" outside the summary, injected instruction text (targets the labeler and capture agents, which read untrusted HTML; the reader has no model) |
| Statistics (review) | Rule-of-three / Wilson 95% bounds at the state level **and** the site-cluster level, both reported |
| Peek policy (review) | Held-out A runs at most twice per reader version; failures analysed by class only, fixes made on development; a second failure retires A and promotes B |
| Copyright | Snapshots gitignored; committed: URL, date, hash, recipe, labels, redacted structure fixtures. Monthly replays are new dated snapshots; old labels are never overwritten |

## Category evidence

The bonus depends on the merchant category code the processor assigns; not public, varies by network and channel. Evidence classes: (1) issuer statements in captured card terms; (2) a network lookup (Mastercard merchant API: keys and terms, later decision); (3) crowdsourced lookups as a cross-check only, never copied; (4) business-type inference, `low`. Every profiled domain whose plausible category is a catalog bonus category (grocery, dining/delivery, drugstore, wholesale club, travel, department store, home improvement, electronics) needs class 1–3 evidence or shows a range; the rest default to `general-merchandise`. An account-free, no-bank-link product cannot learn real coding as Kudos does; a later consented "did this card earn the bonus?" prompt is an option only if it passes the Chrome single-purpose test.

## Permissions

- Required: `storage`, `activeTab`, `scripting`, `alarms` (review: telemetry batching and database refresh; the worker stops after 30 s idle).
- Optional: `https://*/*` in `optional_host_permissions`, requested on a click in onboarding or settings ("Show the badge automatically at checkouts"); no install warning; adding it later disables nothing.
- The badge frame needs `web_accessible_resources` matches on all sites; a strict-CSP checkout is part of the probe *(probe)*.
- Merchant names are length- and charset-limited in Zod; `dangerouslySetInnerHTML` forbidden by lint.

## Related

* [Phase 10 plan](../product/phase-10-merchant-expansion.md)
* [Telemetry design](telemetry-design.md)
* [Extension](extension.md)
* [Cart badge](cart-badge.md)
* [Merchants](../domain/merchants.md)
