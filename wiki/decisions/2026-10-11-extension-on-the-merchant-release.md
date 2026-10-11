---
type: Decision
title: Phase 14.2 choices: one matcher for content scripts, worker and popup; legacy adapter names kept; processors refused before injection; the per-site switch by host for every non-legacy store; A5 copy
description: Implementer choices in milestone 14.2 of Phase 14 that the plan left open, on wiring the bundled merchant release into the extension: where matching runs, which name a legacy store shows, how a payment processor's page is refused, how the off switch keys matched stores, what a stale saved store id does, and the never-ask wording of the read messages.
status: accepted
tags: [decision, phase-14, extension, badge, merchants]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-11T02:30:00Z
sources:
  - resource: ../product/phase-14-merchant-database.md
    title: Phase 14 plan (sections 4 and 8, milestone 14.2)
  - resource: 2026-10-11-merchant-release-seed-and-contract-details.md
    title: 14.1 details (the transitional releaseProfileFor rule)
  - resource: 2026-10-10-audit-calls.md
    title: Audit call A5
  - resource: 2026-10-09-never-ask-for-an-amount.md
    title: Never ask for a typed amount
  - resource: ../../extension/src/checkout/merchants.ts
    title: storeForTab, merchantForTab, storeProfile, merchantOption, storeEvidence
---

# Phase 14.2 choices (2026-10-11)

## Context
Milestone 14.2 of the [Phase 14 plan](../product/phase-14-merchant-database.md#8-milestones) puts the extension on the bundled merchant release: matching replaces `merchantForTab`'s last-two-labels rule, the record's profile is passed at every comparison, stores are named, processors hidden, `disabled` records fall back to the generic profile, and the leftover "enter the amount manually" copy is reworded (A5). The plan fixes the behaviour but leaves a few points to the implementer.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Where matching runs | Only in the worker (the content script sends a reading with a placeholder id; the worker resolves the store); in the content scripts, the worker and the popup alike | The latter, one `storeForTab` in `extension/src/checkout/merchants.ts` on the Zod-free `@ai-checkout/rewards-core/merchant-match` and `/merchants-v1` subpath exports. The reading keeps naming the tab's store and the worker re-derives it from the sender URL, so the existing refusal of a reading that names another store stands; the content script can also skip reading a processor page ("no reader" in the plan). Cost: the release ships in both content scripts (18 records today, about 5 KB minified; about 500 records in 14.4 will add tens of KB on every https page, to re-measure then) |
| Name of a legacy store | The release record's (`Amazon`); the adapter's (`Amazon US`), as today | The adapter's for the three legacy ids, the record's for every other matched store. One source of names for new stores, no churn in 31 test and e2e assertions, and the adapter is still the installed reader; revisit when the adapters retire (A4) |
| A payment processor's page | `merchantForTab` returns the processor id and every caller checks the kind; `storeForTab` reports `kind: 'processor'` and `merchantForTab` returns null (as for a non-web page) | The latter: the badge content script sets `mode: 'none'`, the worker replies `{show: false}` and stores no tab entry, `readActiveCheckout` throws the new `READ_COPY['payment-page']` before injecting anything, and the popup shows a status line on open and keeps the saved store (nothing is read). No new `unavailable` reason in `probeSchema`: the reader never runs there |
| The per-site switch at a matched store | Its record id in `disabledMerchants` (as for legacy stores); its host in `disabledSites` | Its host, as the plan states ("still by host"): `disabledMerchants` stays the legacy enum, `visible()` and `badge:disable-site` key every non-legacy store (matched or generic) by host and under the "other stores" toggle. A matched store's subdomains are therefore switched off one host at a time, like generic stores |
| Merchant ids in the contracts | Keep the enums and add the release ids; any id of 1–100 characters (the `id` shape of `purchaseSchema`) | The latter in `probeSchema`, `cartSnapshotSchema` and `tabEntrySchema`, since release ids are open-ended; the version refinement still ties an adapter version to its own store. `checkout-contracts.test.ts` keeps its cases (a legacy version at another id is still refused) |
| A saved purchase at a processor, a disabled record or an id the release lacks | A generic profile under that id; nothing (the engine answers `unsupported-merchant`, the popup warns "terms do not cover") | Nothing: `storeProfile` is undefined there and the existing warning path stands; a tab never resolves to such an id, so this is only a stale saved store |
| The evidence line | Per source (issuer name from the catalog's source); per basis | Per basis, in `storeEvidence`: "Codes as a supermarket (its own store pages and a public merchant-code lookup agree)." for `corroborated`, "(named in card terms)." for `issuer`; nothing for `default`, `general-merchandise`, the generic store and legacy stores on the catalog's profile. Release sources carry no issuer name, and the plan's example only needs the basis |
| Online retail default in the popup at a release store | "I'm not sure" (as at legacy stores); "Eligible" (as at the generic store) | "Eligible": the record's profile says online retail, and `physicalGoods: false` blocks the rule in the engine anyway, so the badge and the popup agree |
| A5 wording | Keep "enter the amount manually" variants; the never-ask wording | The never-ask wording everywhere (`read-copy.ts`, `state/service.ts`, `browser.ts`, `Popup.tsx`): "…so the cart amount wasn't read. Your cards are compared by rate." for the rates reasons, "Add an item, then read it again." for an empty cart, "Read it again." for timeouts and failures, "Cart reading is unavailable in this build." for a worker without a reader, and the subtotal note "The final charge is not known yet, so this compares the subtotal before tax and shipping." The ambiguous-amount message keeps the word "ambiguous", which `browser.ts` reuses for a malformed probe result and three tests match. The optional amount field, "Use manual entry instead" and the Compare validation ("Enter a purchase amount from $0.01…") stay: they are controls, not prompts |

## Decision
As chosen; built on branch `phase14-2-extension` (not pushed), all gates green at the hand-off commit.

## Consequences
- Until 14.4 no store is newly named: the seed has only the three legacy stores (adapter names) and 15 processors. The named-store e2e case therefore uses `smile.amazon.com/cart` (a seed host on a page the adapter does not cover).
- Content scripts carry the release; 14.4's ~500 records must be re-measured against the bundle sizes recorded on [Cart badge](../system/cart-badge.md).
- The transitional `releaseProfileFor` rule from 14.1 is now live in the badge and popup (Best Buy and Newegg keep `electronics`); Evan's confirmation is still pending.
- A5 is done in 14.2, not 14.3 as the [audit decision](2026-10-10-audit-calls.md) wrote; the plan's milestone table already placed it here.

## Status
Accepted 2026-10-11 (UTC; the 2026-10-10 session) by the 14.2 implementer (Fable 5.1); agent-verified by tests. Open to Evan's change.
