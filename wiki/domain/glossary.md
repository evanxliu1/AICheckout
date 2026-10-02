---
type: Domain Concept
title: Glossary
description: Terms used across AI Checkout, each with a one-line meaning and the page that owns it.
status: stable
tags: [domain, glossary]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
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
| Base rule | The single `all-purchases` rule of a card. It sets the minimum any purchase earns | [Reward rules](reward-rules.md) |
| Basis points (bps) | Hundredths of a percent. 150 bps = 1.5%. All rates are integer bps | [Reward rules](reward-rules.md) |
| BCE / BCP | American Express Blue Cash Everyday / Blue Cash Preferred | [Cards](cards.md) |
| BNPL | Buy now, pay later (Affirm, Zip, ...). A payment path. Excluded from Amex online retail | [Reward rules](reward-rules.md) |
| Cap kinds | `none`, `spend` (amount, period, after-cap rate), `unstated` (issuer silent; on a bonus rule the engine shows a range when that changes the estimate) | [Reward rules](reward-rules.md) |
| Catalog | The versioned set of merchants, sources and card rules the engine computes with. Schema 1 (pilot) or 2. Has `verifiedAt`/`expiresAt` | [Cards](cards.md) |
| Catalog release | An immutable published catalog in PostgreSQL. Only a release reaches the extension | [Archived design](../archive/design.md) |
| Channel rule | A rule decided by how the purchase is made (online, internet-flagged), not by MCC. Amex online retail | [Reward rules](reward-rules.md) |
| Claim precision | Share of non-null predicted values that are correct and cite a resolving quote | [Evaluation](../system/evaluation.md) |
| Dev / held-out split | Real-corpus partition by issuer. Prompts are tuned on dev only. Held-out needs `--allow-heldout` | [Evaluation](../system/evaluation.md) |
| Draft | A private, editable catalog revision. Extraction proposals are applied to it, and a human publishes it as a release | [Archived design](../archive/design.md) |
| Evidence / quote | Verbatim text the model cites for a value. The server resolves it to a span. If it does not resolve, the value is unsupported | [Evaluation](../system/evaluation.md) |
| `evidence_valid` | Kernel status: mechanical citation checks passed. It does not mean the extraction is correct or approved | [Evaluation](../system/evaluation.md) |
| Expected category | A merchant profile's predicted category (`electronics`, `general-merchandise`, ...). It gates MCC-group rules | [Merchants](merchants.md) |
| Extraction | An LLM run that turns captured issuer pages into structured rules with quotes (`issuer-extraction.1`/`.2`) | [Evaluation](../system/evaluation.md) |
| False-clean | A run the kernel marked `evidence_valid` although it had labeled issues or errors | [Evaluation](../system/evaluation.md) |
| Guaranteed minimum | `minRewardCents`, the reward the card earns even if every uncertainty resolves badly. The ranking key | [Reward rules](reward-rules.md) |
| Issue kinds | Extraction v2 issue codes: `missing`, `ambiguous`, `conflicting`, `untrusted-instruction` (text in the source that tries to instruct the model), `out-of-scope` | [Evaluation](../system/evaluation.md) |
| Known / unknown / conflicting | v1 extraction claim states. Unknown and conflicting values stay null. In v2, an unstated field is null and a disagreement is an issue | [Evaluation](../system/evaluation.md) |
| MCC | Merchant category code, a 4-digit network code set by the merchant or processor. Issuers group MCCs into categories. Never observed at checkout | [Merchants](merchants.md) |
| MCC-group rule | A bonus category defined by MCC groups (supermarkets, gas, dining, ...) | [Reward rules](reward-rules.md) |
| Online retail | Amex category: paid online on a site or app of a U.S. merchant selling physical goods, and flagged as an internet transaction | [Reward rules](reward-rules.md) |
| Paid-on-payment | `paidOnPaymentBps`: part of a rate earned only when the balance is paid (Citi Double Cash 1 of 2%) | [Reward rules](reward-rules.md) |
| Payment path | `card`, `paypal`, `digital-wallet`, `bnpl`. A non-card path makes bonuses uncertain | [Reward rules](reward-rules.md) |
| Portal rule | A bonus earned only when booking through the issuer's travel or entertainment site. Never applies at retail | [Reward rules](reward-rules.md) |
| Rate vs paid-on-payment | `rateBps` is the total rate. `paidOnPaymentBps` is the part of it that waits for payment. Neither is an increment over the base | [Reward rules](reward-rules.md) |
| Ranking may change | Flag set when another card's maximum beats the leader's guaranteed minimum | [Reward rules](reward-rules.md) |
| Reward currency | `cash-back` or `points`. Points carry `pointValueHundredthsOfCent` (Citi ThankYou: 100 = 1¢) | [Cards](cards.md) |
| Selection | What page text the model sees: `full` or `keyword-window.1` | [Evaluation](../system/evaluation.md) |
| Uncertainty code | Why an estimate is a range (`cap-unstated`, `payment-path-uncertain`, ...) | [Reward rules](reward-rules.md) |
| Unstated | Catalog value for "the issuer's pages say nothing" (cap, activation). Mapped from a null gold label | [Reward rules](reward-rules.md) |
| Variant kinds | Mechanical edits of real captures that test the extractor: `injection`, `conflicting-rate`, `stale-promo`, `remove-cap` | [Evaluation](../system/evaluation.md) |
