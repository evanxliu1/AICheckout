---
type: Decision
title: Catalog overlay conventions for Stage 2 M4
description: How the 173 expansion cards' product structure is written for catalog v3 without editing the corpus — rule patches by index with a guard, five dispositions, brand-scoped rules always category `other`, conservative payment-path exclusions for hedged wording, gates and choices, store credit only when a capture says so, no new reward categories — and why.
status: accepted
tags: [decision, catalog, overlay, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:59:00Z
sources:
  - resource: ../../evals/curation/expansion/catalog-overlay.json
    title: Catalog overlay
  - resource: ../../evals/curation/expansion/merchants.json
    title: Brands and merchant profiles for catalog v3
  - resource: ../../scripts/lib/catalog-overlay.mjs
    title: Overlay format, coverage check and draft catalog build
  - resource: ../../evals/curation/expansion/verification/conventions/general.md
    title: General conventions, overlay rules O1–O19
---

# Catalog overlay conventions for Stage 2 M4 (2026-10-02)

## Context
The [catalog v3 decision](2026-10-02-catalog-v3-schema.md) keeps the agent-verified corpus as the eval truth and puts product structure in a separate, verified overlay. Milestone M4 of the [Stage 2 plan](../product/phase-7-stage-2.md) had to write that overlay for 173 cards: 284 `other` rules, 195 issues and 197 product hints, plus the M1 hand-offs ([contract details](2026-10-02-catalog-v3-contract-details.md)). Eight authoring subagents worked per issuer in parallel, so conventions had to be fixed up front and tightened as questions came back.

## Options considered
| Question | Chosen | Alternative and why not |
| --- | --- | --- |
| How the overlay refers to corpus rules | Patch by index with a `was: {category, rateBps}` guard; patches set only v3 fields; rates and wording never change; missing rates are added rules with anchors | Copying whole rules into the overlay duplicates the labels and lets them drift from the corpus |
| What every item gets | One of `modelled` (with `how`), `field-unstated`, `rule-held-out`, `card-held-out`, `noted`, enforced by `checkOverlay` | Implicit defaults hide items nobody looked at |
| Brand-scoped rules | Category `other` plus `brandIds`, never a shared category with brands; kept even for merchants the extension does not support yet (Phase 9) | Combining category and brand needs an extra engine rule; holding them out loses 149 verified rules |
| `other` rules with no v3 category | Held out with "not at retail:" (services, travel) or "no v3 category:" (clothing, sporting goods, pet supplies); travel rules that name transit take `transit` | New categories that the three supported merchants never code as only grow the SQL and TS lists |
| Hedged checkout-method wording ("may not earn", "may not qualify") | The named paths go into `excludedPaymentPaths` (conservative: the engine counts the base rate for that path) | Ignoring hedged wording overstates the bonus when the shopper pays through PayPal, Venmo or a wallet |
| Store credit | A separate cash-back program with redemption brands only when a capture says where the rewards are spent (18 programs; JCPenney and At Home stay plain cash back) | Inferring store-only use from a conversion ratio |
| Conditions about the purchase, not the cardholder (financing instead of rewards, minimum purchase, store-brand items, time of day, fare bundles) | Not gates: `noted`, or `rule-held-out` when keeping the rule would overstate the earn | A gate is a question about the cardholder; a purchase-level gate would be answered once and be wrong for the next cart |
| Lowest tier of a ladder every cardholder holds | Ungated, so an unanswered gate still shows the floor | Gating every tier shows only the base when the shopper skips the question |
| Base rule with a store-program enrollment | `activation: none` when a capture says cardholders are enrolled automatically or by applying, else `unstated` | Keeping `enroll-once` makes the base conditional, which the contract forbids |
| Reward categories | No change: all four provisional M1 categories are used (`electronics`, `department-stores`, `home-improvement`, `wholesale-clubs`), none added, so no migration | Adding `clothing`, `pet-supplies`, `online-grocery`, `utilities`, `digital-goods` was proposed by authors; none applies at Amazon, Best Buy or Newegg |

## Decision
As in the "Chosen" column, written as rules O1–O19 in [`general.md`](../../evals/curation/expansion/verification/conventions/general.md), with per-issuer "Overlay (Stage 2 M4)" sections in the same folder. Every fragment passed the checker, was read by an independent verifier subagent against the captures, and the coordinator adjudicated each finding (agent-verified).

## Consequences
- Two cards are held out (Marriott Bonvoy Bold, U.S. Bank Shield: no base rate). The draft catalog the check builds has 178 cards and about 601 KB, 57% of the 1 MiB limit.
- Amex Platinum's $500,000 flight cap is above `MAX_AMOUNT_CENTS` ($100,000) and is carried as `unstated` (`field-unstated`); raising the cap limit is a contract change for a later milestone.
- Brand scope cannot tell products apart inside one merchant (T-Mobile bill payments earn 2%, not 5%; Delta gift cards; Amazon Music under Cash+ streaming). These are noted on the items.
- M2's engine must treat a rule with `brandIds` as matching on brand alone (category `other`), and `excludedBrandIds` on a category rule as removing those brands.

## Status
Accepted 2026-10-02 by the M4 coordinator; Evan can revise any row. Amended 2026-10-02 by the [pre-merge review](2026-10-02-catalog-overlay-review.md): account-age rates are gated (O20) and store-credit units are cents (O21).
