---
type: Domain Concept
title: Glossary
description: Terms used across AI Checkout, each with a one-line meaning and the page that owns it.
status: stable
tags: [domain, glossary]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-07T00:20:00Z
sources:
  - resource: ../../packages/rewards-core/src/types.ts
    title: Catalog and engine types
  - resource: ../../apps/api/src/curation/v2/schema.ts
    title: Extraction contract issuer-extraction.2
  - resource: ../../apps/api/src/curation/v2/corpus.ts
    title: v2 corpus schema (splits, variants)
  - resource: ../../apps/api/src/curation/README.md
    title: Issuer extraction kernel README (v1 known/unknown/conflicting)
  - resource: ../archive/design.md
    title: Design (archived), releases and drafts
  - resource: ../../docs/research/cashback-card-terms-2026.md
    title: Research report, seven cashback cards
---

# Glossary

Terms a newcomer would not know, in alphabetical order. Each term is defined on the page in the last column.

| Term | Meaning | Owner page |
| --- | --- | --- |
| Activation | Whether a rule must be enrolled: `none`, `enroll-once`, `recurring`, or `unstated` (issuer silent, treated as `none`) | [Reward rules](reward-rules.md) |
| After-cap rate | `rateAfterCapBps`: what spend beyond a spend cap earns (Amex: 100 bps) | [Reward rules](reward-rules.md) |
| Agent-verified | Labels checked by reviewer agents, not by a human. Applies to every real-corpus label and therefore to the catalog | [Evaluation](../system/evaluation.md) |
| Anchor | A short verbatim span from a capture that a gold label cites. It must resolve in the source | [Evaluation](../system/evaluation.md) |
| Base rule | The card's one unconditional `all-purchases` rule; it sets the minimum any purchase earns. In catalog v3 open-loop cards need exactly one and closed-loop store cards none; other `all-purchases` rules may carry conditions | [Reward rules](reward-rules.md) |
| Basis points (bps) | Hundredths of a percent. 150 bps = 1.5%. All rates are integer bps | [Reward rules](reward-rules.md) |
| BCE / BCP | American Express Blue Cash Everyday / Blue Cash Preferred | [Cards](cards.md) |
| BNPL | Buy now, pay later (Affirm, Zip, ...). A payment path. Excluded from Amex online retail | [Reward rules](reward-rules.md) |
| Cap kinds | `none`, `spend` (amount, period, after-cap rate), `unstated` (issuer silent; on a bonus rule the engine shows a range when that changes the estimate) | [Reward rules](reward-rules.md) |
| Catalog | The versioned set of merchants, sources and card rules the engine computes with. Schema 1 (pilot), 2 (release 1) or 3 (178 cards, since release 2). Has `verifiedAt`/`expiresAt` | [Cards](cards.md) |
| Catalog release | An immutable published catalog in PostgreSQL. Only a release reaches the extension | [Archived design](../archive/design.md) |
| Channel rule | A rule decided by how the purchase is made (online, internet-flagged), not by MCC. Amex online retail | [Reward rules](reward-rules.md) |
| Claim precision | Share of non-null predicted values that are correct and cite a resolving quote | [Evaluation](../system/evaluation.md) |
| Coverage (reader eval) | Shown-correct amounts ÷ pages with an expected amount, reported per stream and state; target 80% on `cart-1`, never a pass condition (since 2026-10-06) | [Merchant coverage design](../system/merchant-coverage-design.md#real-page-evaluation-pre-registered-in-phase-12) |
| Dev / held-out split (curation eval) | Real-corpus partition by issuer. Prompts are tuned on dev only. Held-out needs `--allow-heldout` | [Evaluation](../system/evaluation.md) |
| Draft | A private, editable catalog revision. Extraction proposals are applied to it, and it becomes a release only when published on Evan's explicit approval ([catalog release](../ops/catalog-release.md)) | [Archived design](../archive/design.md) |
| Evidence / quote | Verbatim text the model cites for a value. The server resolves it to a span. If it does not resolve, the value is unsupported | [Evaluation](../system/evaluation.md) |
| `evidence_valid` | Kernel status: mechanical citation checks passed. It does not mean the extraction is correct or approved | [Evaluation](../system/evaluation.md) |
| Expected category | A merchant profile's predicted category (`electronics`, `general-merchandise`, ...). It gates MCC-group rules | [Merchants](merchants.md) |
| Extraction | An LLM run that turns captured issuer pages into structured rules with quotes (`issuer-extraction.1`/`.2`) | [Evaluation](../system/evaluation.md) |
| False-clean | A run the kernel marked `evidence_valid` although it had labeled issues or errors | [Evaluation](../system/evaluation.md) |
| Frame (retail frame) | The frozen list of eligible retail domains a reader-eval sample is drawn from (`retail-frame.3`: Chrome UX Report 2026-08 lists of the U.S. and 24 countries ∩ agent-classified retail) | [Merchant coverage design](../system/merchant-coverage-design.md#real-page-evaluation-pre-registered-in-phase-12) |
| Generic store | The engine-supplied `generic-us-online` profile, "Another U.S. online store" (Phase 11): any web page that is not one of the three supported stores; only `all-purchases` and `online-retail` rules apply, closed-loop cards are not accepted, brand rules are not applied (brand websites come in Phase 14) | [Merchants](merchants.md#another-us-online-store-phase-11) |
| Guaranteed minimum | `minRewardCents`, the reward the card earns even if every uncertainty resolves badly. The ranking key | [Reward rules](reward-rules.md) |
| Issue kinds | Extraction v2 issue codes: `missing`, `ambiguous`, `conflicting`, `untrusted-instruction` (text in the source that tries to instruct the model), `out-of-scope` | [Evaluation](../system/evaluation.md) |
| Known / unknown / conflicting | v1 extraction claim states. Unknown and conflicting values stay null. In v2, an unstated field is null and a disagreement is an issue | [Evaluation](../system/evaluation.md) |
| Legacy adapter | One of the three bundled site adapters (Amazon, Best Buy, Newegg). No new adapters or store configs since 2026-10-06; they retire once the generic reader matches them, and are scored apart in the reader eval | [Extension](../system/extension.md#site-adapters) |
| MCC | Merchant category code, a 4-digit network code set by the merchant or processor. Issuers group MCCs into categories. Never observed at checkout | [Merchants](merchants.md) |
| MCC-group rule | A bonus category defined by MCC groups (supermarkets, gas, dining, ...) | [Reward rules](reward-rules.md) |
| Online retail | Amex category: paid online on a site or app of a U.S. merchant selling physical goods, and flagged as an internet transaction | [Reward rules](reward-rules.md) |
| Operator (reader eval) | Two meanings: (1) the company running a set of storefronts, locked to one split so its stores never straddle splits; (2) the agent or tool that drives a capture session (`pane-operator` subagent, earlier the robot) | [Merchant coverage design](../system/merchant-coverage-design.md#real-page-evaluation-pre-registered-in-phase-12) |
| Paid-on-payment | `paidOnPaymentBps`: part of a rate earned only when the balance is paid (Citi Double Cash 1 of 2%) | [Reward rules](reward-rules.md) |
| Pane capture | Reader-eval capture since `.8` (2026-10-06): `pane-operator` subagents drive the Claude desktop app's built-in browser pane, one store per tab, add to cart and export each cart state; no typing, no checkout, CAPTCHAs never touched | [Phase 12 plan](../product/phase-12-reader-eval.md) |
| `pane-dom` | The format of a pane export written by the approved `pane-export.js` (`pane-dom.2`: elements, attributes, text, open shadow roots, computed styles and boxes, visibility facts), rebuilt offline into a static page by `rebuild.mjs` | [Merchant coverage design](../system/merchant-coverage-design.md#real-page-evaluation-pre-registered-in-phase-12) |
| Payment path | `card`, `paypal`, `digital-wallet`, `bnpl` (catalog v3 adds `venmo`). A non-card path makes bonuses uncertain | [Reward rules](reward-rules.md) |
| Portal rule | A bonus earned only when booking through the issuer's travel or entertainment site. Never applies at retail | [Reward rules](reward-rules.md) |
| Ranking may change | Flag set when another card's maximum beats the leader's guaranteed minimum | [Reward rules](reward-rules.md) |
| Rate vs paid-on-payment | `rateBps` is the total rate. `paidOnPaymentBps` is the part of it that waits for payment. Neither is an increment over the base | [Reward rules](reward-rules.md) |
| Reward currency | `cash-back` or `points`. Points carry `pointValueHundredthsOfCent` (Citi ThankYou: 100 = 1¢). Catalog v3 maps each card to a rewards program whose value has a basis (cash, published estimate, issuer-stated or none) | [Cards](cards.md), [reward-program valuation](../system/reward-program-valuation.md) |
| Selection | What page text the model sees: `full` or `keyword-window.1` | [Evaluation](../system/evaluation.md) |
| Shown / shown-wrong / withheld | Reader outcomes since 2026-10-06: the reader shows an amount only when certain (shown-correct or shown-wrong, a wrong currency counting as wrong), otherwise withholds and the recommendation shows rates only. There is no `ask` outcome. Bar: one-sided 95% upper bound of wrong shown amounts ≤ 1% | [Merchant coverage design](../system/merchant-coverage-design.md#real-page-evaluation-pre-registered-in-phase-12) |
| Site splits (reader eval) | Development, held-out A and held-out B, split by site (not page) and weighted 1 : 2 : 2 since `.8`; the reader is tuned on development only; held-out A runs at most twice | [Merchant coverage design](../system/merchant-coverage-design.md#real-page-evaluation-pre-registered-in-phase-12) |
| Uncertainty code | Why an estimate is a range (`cap-unstated`, `payment-path-uncertain`, ...) | [Reward rules](reward-rules.md) |
| Unstated | Catalog value for "the issuer's pages say nothing" (cap, activation). Mapped from a null gold label | [Reward rules](reward-rules.md) |
| Variant kinds | Mechanical edits of real captures that test the extractor: `injection`, `conflicting-rate`, `stale-promo`, `remove-cap` | [Evaluation](../system/evaluation.md) |
