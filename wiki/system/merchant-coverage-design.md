---
type: System
title: Merchant coverage design (Phase 10, draft)
description: Proposed design for working at any U.S. online checkout — a hosted, reviewed merchant database matched on the device, a deterministic generic cart reader with per-store configs as data, a real-page reader eval, category evidence with ranges, optional all-sites permission, consented telemetry and affiliate-ready metrics. Draft for Evan's approval; nothing here is built.
status: draft
tags: [system, design, phase-10, merchants, telemetry, privacy]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T08:00:00Z
sources:
  - resource: ../product/phase-10-merchant-expansion.md
    title: Phase 10 plan
  - resource: ../../extension/src/checkout/page-reader.ts
    title: Current generic interpreter driven by site adapters
  - resource: ../../docs/release/privacy-policy.md
    title: Current privacy policy draft (no analytics)
  - resource: https://developer.chrome.com/docs/webstore/program-policies/limited-use
    title: Chrome Web Store Limited Use policy (read 2026-10-05)
  - resource: https://developer.chrome.com/docs/webstore/program-policies/affiliate-ads
    title: Chrome Web Store affiliate ads policy (read 2026-10-05)
  - resource: https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements
    title: Chrome MV3 requirements, remote configuration allowed as data
---

# Merchant coverage design (Phase 10, draft)

**Draft, not built, not approved.** The design behind the [Phase 10 plan](../product/phase-10-merchant-expansion.md). It replaces the "one bundled adapter per site" model with the pattern mainstream shopping extensions use (a hosted merchant database and per-store configs as data), keeps the project's rules (no model at checkout, a human approves every release), and adds consented telemetry.

## How mainstream extensions do it (researched 2026-10-05)

| Product | Coverage model | Data collected |
| --- | --- | --- |
| PayPal Honey | Server list of supported domains; per-shop metadata fetched when a supported domain is visited; all-sites permission | Shop page views and URLs, purchase value and completion, device and account IDs |
| Capital One Shopping | "100,000+" supported stores, server-driven; reads pages visited | Browsing and search history, purchases, location; shared with advertising partners |
| Rakuten | Server-driven; all-sites | Web history across sites, products and cart adds |
| Kudos (card recommender, closest to this product) | Recognizes known checkout pages, matches cards to the merchant's category; claims 2M merchants | Issuer sites visited, card type and last 4; optional bank transactions via Plaid; no cart content |

Chrome allows a downloaded JSON configuration interpreted by packaged code, but not downloaded logic. Limited Use forbids selling extension user data, personalized ads and credit decisions; aggregated, anonymized internal analytics are allowed. Affiliate links need prominent disclosure, a user benefit tied to the core function, and a user action before each link. Sources in the frontmatter and in the decision record Phase 10 milestone 0 writes.

## Architecture

| Component | What | Where | Changes ship by |
| --- | --- | --- | --- |
| **Merchant database** | Rows keyed by registrable domain: name, U.S. online retail of physical goods, `expectedCategory` with confidence and evidence class, `brandIds`, optional MCC with source, optional store reader config, `disabled` flag | Hosted, versioned, reviewed like the catalog; downloaded **whole** and cached; matched on the device | Merchant release (Evan approves) |
| **Generic cart reader** | Deterministic code that finds the order-summary amount on any page and returns `found` (amount, kind, confidence) / `ask` (candidates) / `none` | Extension package | Extension release |
| **Store reader configs** | Declarative selectors for stores where the generic reader is not good enough (today's adapter JSON, schema-checked, no logic) | Rows in the merchant database | Merchant release |
| **Ranking engine and card catalog** | Unchanged | Extension + hosted catalog | Catalog release |
| **Telemetry** | Consented events, random install ID | Extension → `POST /v1/events` → Supabase | API deploy |

**Privacy-preserving lookup.** Unlike Honey, the extension never asks the server about the domain it is on: it downloads the full merchant database and looks the domain up locally. The server learns only that a client fetched the database (and, with consent, the telemetry events below).

**Size.** About 300–600 bytes per row; 10,000 rows ≈ 3–6 MB uncompressed, well under 1 MB gzipped. Served as its own versioned resource (`GET /v1/merchants`), not inside the 1 MiB card catalog.

## Checkout flow

1. On the popup click (activeTab) or, with the optional all-sites grant, on page load: take the tab's registrable domain and look it up. Match → its profile; no match → the generic profile "Another U.S. online store" (`general-merchandise`).
2. Decide whether this is a cart or checkout page: URL heuristics plus an order-summary region (generic reader step 1); store configs can pin paths.
3. Read the amount: store config if present and not disabled, else the generic reader. `found` with high confidence → prefill; `ask` → "We found $84.99 — is that right?" with the alternatives; `none` → the shopper types it.
4. Rank with the engine. Uncertain category → a range ("5% if it codes as grocery, else 1%"), as the engine already does.

## Generic cart reader

Deterministic and bundled; tuned offline on the development split only.

1. **Locate the summary region:** landmarks and headings ("Order summary", "Cart totals", "Summary"), ARIA labels, platform markers (Shopify, Salesforce Commerce Cloud, BigCommerce, Magento/Adobe, WooCommerce detected from page metadata) mapped to known summary containers as data.
2. **Find total rows:** label patterns (subtotal, estimated total, order total, total) paired with exactly one currency amount on the same row or label/value pair.
3. **Reject distractors:** line-item prices, recommendation carousels, "you saved", installment offers ("4 payments of"), free-shipping thresholds, strikethrough prices, gift-card balances, saved-for-later, rewards-point values, non-USD amounts, amounts outside the summary region.
4. **Decide:** one unambiguous candidate of a preferred kind → `found`; several plausible → `ask`; none → `none`. Never `found` on a tie. Loading indicators or `aria-busy` → wait.

The safety number is the **false-found rate** (a wrong amount presented as `found`), target 0 on the held-out set; `ask` is always acceptable.

## Reader evaluation on real pages

| Element | Design |
| --- | --- |
| Sites | Top merchants from the merchant list, stratified by rank band and platform; target 150–200 sites; split **by site** into development (tuning) and held-out (frozen, never used to tune) |
| Capture | A fresh, logged-out Playwright profile (never Evan's browser); an agent adds a chosen in-stock item, records a replayable recipe; never sign-in, checkout, address or payment fields |
| Ground truth | Known before reading: the chosen item's price × quantity from the product page, confirmed by a second agent from the snapshot; tax and shipping recorded separately |
| States per site | 1 item; quantity 2; 2 different items; mini-cart drawer vs cart page; sale item with strikethrough; promo banner; recommendation carousel with prices; estimated tax/shipping row; installment offer; free-shipping progress; empty cart; loading after a quantity change |
| Synthetic variants | Class renames, injected promo rows, injected fake "Subtotal" text outside the summary, prompt-injection text |
| Storage | Full page snapshots gitignored (retailer content); committed: URL, date, hash, recipe, labels, redacted structure fixtures |
| Metrics | False-found rate (primary), found-correct rate, ask rate, none rate; by state, platform and rank band; N and 95% confidence intervals |
| Drift | Monthly recipe replays of the top sites; a failing store gets a store config or `disabled` in the next merchant release |

## Category evidence

A card bonus depends on the merchant category code the merchant's processor assigns; it is not public and can differ by network and channel. Evidence classes, strongest first: (1) issuer statements in the card terms already captured; (2) a card network lookup (Mastercard's merchant lookup API; terms to check, Evan's call); (3) crowdsourced lookups as a cross-check only, never copied; (4) inference from the business type, `low`. A profile stores `expectedCategory`, the evidence class and its source; the engine shows ranges where the category decides the answer. MCC codes only with a citable source.

## Permissions

- Required: `storage`, `activeTab`, `scripting`, the API origin.
- Optional: all sites (`<all_urls>` in `optional_host_permissions`), offered in onboarding and settings as "Show the badge automatically on any checkout", requested on a click; with it, the badge script runs where the merchant database or the generic reader finds a cart. Without it, everything works on click.
- No required host list to grow: new stores never disable the extension on update.

## Telemetry and metrics

| Group | Events | Purpose tag |
| --- | --- | --- |
| Lifecycle | install, onboarding complete, consent version, uninstall survey (optional) | operations |
| Usage | popup opened, badge shown, badge clicked, recommendation shown | operations |
| Coverage | checkout detected: domain, profile `known` / `generic`, store config or generic reader | quality |
| Reader quality | `found` / `ask` / `none`, shopper corrected the amount (relative difference bucket), reader and config versions | quality |
| Catalog health | catalog and merchant database versions, refresh success, expiry errors | operations |
| Errors | error code, extension version | operations |
| Opportunity | best owned card rate vs best catalog rate at this checkout, as buckets, plus the store category; never the card list | offers (future) |

Rules: one consent screen in onboarding covering all groups (Evan, 2026-10-05: collect all), settings toggle to stop; a random install ID the user can reset; no full URLs (registrable domain only, checkout pages only), no page content, no cart contents, amounts only as buckets, no card list, no names or emails; IP dropped at the API; raw events kept 90 days, then aggregates; never sold, never used for ads (Chrome Limited Use). Events are batched, sent at most every few minutes, dropped when offline beyond a cap.

## Affiliate readiness (offers are a later phase)

Telemetry and the opportunity metric size the business. When offers come: labelled, user-initiated links only, disclosed on the store page, in the UI and before install; the engine never sees commission rates; the best card for the shopper stays first even when it pays nothing.

## Related

* [Phase 10 plan](../product/phase-10-merchant-expansion.md)
* [Extension](extension.md)
* [Cart badge](cart-badge.md)
* [Merchants](../domain/merchants.md)
