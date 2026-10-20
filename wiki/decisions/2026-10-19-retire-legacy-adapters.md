---
type: Decision
title: Retire the three legacy adapters (Amazon, Best Buy, Newegg) in Release A; measure the change for the record, not as a gate; drop order detection and savings
description: Evan's 2026-10-19 directive replaces the A4 gate (adapters retire only when the generic reader matches them on fresh captures) with an unconditional retirement in Phase 15.1; the before-and-after readings are still measured and committed as a record. The URL-only order detection and the savings history, which existed only for those three stores, are dropped rather than rebuilt generically.
status: accepted
tags: [decision, phase-15, extension, reader, adapters, savings]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-20T02:30:00Z
sources:
  - resource: 2026-10-10-audit-calls.md
    title: Decision, audit calls (A4 as a gate)
  - resource: 2026-10-06-reader-shows-only-certain-amounts.md
    title: Decision, generic reader only; adapters stay until matched
  - resource: ../product/phase-15-release-a.md
    title: Phase 15 plan (milestones 15.1 and 15.1m)
  - resource: ../system/cart-badge.md
    title: Cart badge (order detection and savings)
  - resource: ../../extension/src/checkout/adapters/amazon-us.json
    title: Amazon adapter (orderConfirmation.verified false)
---

# Retire the three legacy adapters in Release A; measure for the record; drop order detection and savings (2026-10-19)

## Context
Since 2026-10-06 the rule has been "generic reader only, no store configs; the three legacy adapters stay until the generic reader matches them on their stores, then retire" ([decision](2026-10-06-reader-shows-only-certain-amounts.md)). The 2026-10-10 audit call A4 made that a gate for Release A: fresh pane captures of the three stores, and the adapters retire only when `readCart` shows the same amount on every page where the adapter shows one, with no wrong amount ([decision](2026-10-10-audit-calls.md)). The frozen reader set excluded the three stores as "legacy merchants" (protocol `.3`), so no measurement exists yet.

On 2026-10-19 Evan directed: "Retire the three legacy adapters (Amazon, Best Buy, Newegg) no matter what. The generic reader and detector cover them. The A4 check becomes a measurement recorded for the record (what changes for those stores), not a gate." He also asked for a plain statement of what happens to the order-confirmation and savings features that only the adapters had.

What the adapters still own in the code at `main` `96ba5265`: the readers on their cart URLs (`manual-reader.ts:readAnyCart`, `badge/content.ts:mode`), the store names of the three ids, the `disabledMerchants` setting, the popup's default store `best-buy-us` and its three-store select, the URL-only order detection (`merchantForOrderConfirmation`, `order:page`, `orderPrompt`), the one-tap "Did you pay with your recommended card?" question and the savings history (`savings[]`, `checkout:record-savings`, `checkout:delete-savings`, `SavingsHistory.tsx`, JSON export). All three `orderConfirmation` URL patterns are unverified guesses (`verified: false`) and were waiting for Evan to check them on real orders.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| Keep A4 as a gate: capture, compare, retire only if matched | The 2026-10-10 rule | Overruled by Evan on 2026-10-19; a reviewer would also ask why three stores get a privileged code path when the listing says "any store" |
| Retire unconditionally and skip the measurement | Simplest | Loses the only record of what the release changes for the three most-used U.S. stores; the measurement is cheap (nine pane captures plus the committed observed fixtures) |
| **Retire unconditionally, measure for the record (chosen)** | Evan's directive, with honesty kept | The before-and-after table goes to `docs/evals/legacy-adapter-retirement.md`; nothing in it blocks the release |
| Order detection and savings: rebuild generically (thank-you page detection at any store) | Would keep the feature | Never captured (Phase 12 forbade entering checkout), so it cannot be measured; a wrong detection asks an unnecessary question on a stranger's page; the patterns were unverified even for the three stores; Phase 15 has a deadline |
| Order detection and savings: keep for the three stores only | Keeps a demo feature | Keeps `merchantForOrderConfirmation` and the three hosts as a special case in the content script, the very thing being retired; the savings prompt would then exist at 3 of about 640 named stores |
| **Order detection and savings: drop (chosen)** | Plain and consistent with "no store configs" | The popup loses the All-time savings card and export; a generic version is a Phase 17 candidate if telemetry (`recommendation_shown` volume, `badge_expanded`) shows demand |
| `savings[]` in state schema 3: bump to schema 4 and strip it | Clean schema | A migration, vault re-encryption and test changes for a field no published install has ever written |
| **`savings[]`: keep as a tolerated, never-written field (chosen)** | Smallest change | `Delete all local data` still clears it; the field is dropped at the next schema bump for another reason; the privacy policy need not describe an always-empty array |

## Decision
1. Phase 15.1 removes `extension/src/checkout/adapters/`, `page-reader.ts`, the adapter rules in `merchants.ts` (`merchantForCheckout`, `merchantForOrderConfirmation`, `isLegacyMerchant`, `MERCHANT_IDS`, `MERCHANTS`), the legacy branches of `readAnyCart` and `badge/content.ts:mode`, the adapter validation step in `vite.config.ts`, the adapter fixtures and tests, the legacy e2e flows, `evals/reader/legacy-entry.ts` and the harness's legacy mode, and `extension/scripts/observe-amazon-cart.mjs`. `probeSchema` and `cartSnapshotSchema` accept `generic-reader-v1` only. The three stores are named by the merchant release records (`amazon-us`, `best-buy-us`, `newegg-us`, ids unchanged).
2. Stored `disabledMerchants` values map once to their hosts in `disabledSites` on read; the setting field goes.
3. Order detection, the order question, the savings history, its export and the `record-savings` and `delete-savings` requests are removed. `savings` stays in state schema 3 as a tolerated field nothing writes or shows.
4. The measurement (15.1m): before deletion, both readers run on the committed observed fixtures (`extension/tests/fixtures/*-observed-*.html`) and on fresh pane captures of the three stores' `cart-1`, `cart-qty2` and `empty-cart` states taken under `generic-reader-protocol.12` rules (the protocol in force since 2026-10-07; corrected on 2026-10-20 from `.11`, which this page first named); the text-free table (page, adapter reading, generic reading, reason codes) is committed as `docs/evals/legacy-adapter-retirement.md`. It is a record, not a gate.
5. The protocol's "Legacy adapters" scoring clause is closed by that record; no amendment is signed (the clause existed to decide retirement, which Evan decided).

## Consequences
- The content scripts shrink (the adapter interpreter leaves both bundles); `release-package.mjs` invariants are unchanged.
- On amazon.com's cart the generic reader may withhold where the adapter read the subtotal (the measurement will say); the badge then shows the rates view, never a wrong amount.
- Best Buy checkout steps (`/checkout/...`) rely on the detector's `checkout` signal, measured only on synthetic fixtures in 13c.
- The popup's Merchant select offers the tab's store by name and "Another U.S. online store"; the default store is the generic one.
- `docs/release/`, `docs/verification/merchants.md`, `extension/README.md`, the README and the site stop describing the three stores (Phase 15.5).
- The 2026-10-06 and 2026-10-10 rows that made retirement conditional are superseded on this point; "no store configs" stands.
- Stored data from before 15.1 stays readable (added by the 15.1 review, 2026-10-20): saved purchases and `savings[]` entries at the three ids parse as before, a saved cart snapshot an adapter wrote (`*-summary-v1`) reads as no saved cart instead of making the whole state unreadable, and `badge:*`/content messages of the old shapes are refused. Measured result of 15.1m: [part 2](../../docs/evals/legacy-adapter-retirement.md#part-2-fresh-captures-151m).

## Status
Accepted 2026-10-19 (Evan's directive in chat; the savings drop and the tolerated field are the planner's recommendations, listed as decision 2 in the [plan](../product/phase-15-release-a.md#8-decisions-needed-from-evan)).
