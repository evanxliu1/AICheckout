---
type: Decision
title: Global cart reader evaluation and deferred attended capture (generic-reader-protocol.2)
description: Evan's 2026-10-06 decisions — the generic cart reader must return the total and its currency on storefronts worldwide, judged on a worldwide retail frame with U.S. and non-U.S. reported separately, while card recommendations for non-USD purchases wait for a later phase; bot-walled sites stay a reported gap and attended capture with Evan solving CAPTCHAs is deferred. Amends the signed reader protocol before any capture.
status: proposed
tags: [decision, phase-12, merchants, eval]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-06T08:00:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol (.2)
  - resource: 2026-10-06-reader-eval-protocol.md
    title: Reader protocol choices (.1)
---

# Global cart reader evaluation and deferred attended capture (2026-10-06)

## Context
`generic-reader-protocol.1` was signed on 2026-10-06 (agent-verified). It judged the reader on U.S. storefronts in USD only: `non-usd` labels had a null expected and non-U.S. storefronts were excluded. Before any capture, Evan decided in chat on 2026-10-06 that the extractor should work worldwide now, while card recommendations stay U.S. Evan first also allowed attended capture of bot-walled sites, then dropped it the same day. The protocol fixes the frame, outcome definitions and label schema "for good" against builder amendments, so these changes need his decision on record. No capture, label or reader run exists yet, so nothing needs reporting under both versions.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Scope of the reader | U.S. and USD only; total and currency worldwide | **Worldwide, total and currency (Evan).** Card recommendations for non-USD purchases (currency conversion, foreign transaction fees) are a later phase |
| Frame | Extend `retail-frame.1` in place; a new version | `retail-frame.2`, a new file. `retail-frame.1` stays frozen for the merchant-pipeline held-out list. Frame 2 keeps every frame 1 domain and classification (the `non-us-online-retailer` rule lifted), adds 999 domains from the agent's retailer lists in 58 other countries and a read of country-code domains in Tranco's top 10,000, with region, currency and region group per domain. No website visited |
| Region of a global `.com` | Retailer's home country; the storefront a U.S. visitor gets | The storefront a U.S. visitor gets, since the capture runs from the U.S. and never changes the country. Domains where the agent can't predict it are `multi-market-domain` |
| Sister storefronts (zalando.de and zalando.fr) | Keep all; one per retailer | One per retailer (`same-retailer-other-domain`, 168 domains). Otherwise one retailer's code could sit in development and held-out at once. A frame 1 member keeps its family, else the lowest `retailer-family` key |
| Russia and Belarus | Include; exclude | Exclude (`card-unusable-market`): U.S.-issued cards are not accepted there |
| Sizing | One pool of 300; U.S. and non-U.S. streams | Two streams of 200 candidates. Each stops at 110 captured, 220 in all, about 73 per split, about half non-U.S. Below 80 captured in a stream, report to Evan |
| Strata | Band × platform; band × region group × platform | Band × region group × platform, with tie-breaks on band × region group, then region group. The simulation gives held-out splits within one site of each other in every region group |
| Currency in the label | Keep `amountCents` and add a currency; minor units | `reader-labels.2`: `{kind, amountMinor, currency}` in ISO 4217 minor units, `currencyEvidence`, `currency-undetermined` replaces `non-usd` |
| Correctness | Amount only; amount and currency | Amount, kind and currency. A right amount with a wrong currency is a false found (Evan) |
| Pass bar | Per region; whole split | Whole held-out split, same numbers (0 false found, Y = 80%, p95 ≤ 50 ms), with U.S. and non-U.S. reported separately (Evan) |
| Locale coverage | Rely on real pages; add variants | Both: locale observed tags, and four new variants (`format-swap`, `format-space-after`, `zero-decimal`, `mixed-currency`) |
| Capture item price | $10–$200 only; per-currency bands | `item-price-bands.json`, approximate USD 10–200 bands from rounded rates in the builder's knowledge. It only picks the item |
| Merchant-pipeline held-out list | Make it global; keep it | Keep it unchanged and U.S.-only. Phase 16 measures profiles and category evidence for recommendations, which stay U.S. The non-USD phase draws its own list from frame 2 |
| Bot-walled sites | Attended capture in the built-in browser pane with Evan solving CAPTCHAs; a reported gap | **A reported gap (Evan, revised the same day).** Blocked sites are listed by band and region. A later step may capture them attended, with Claude driving its built-in browser and Evan solving any CAPTCHA, under its own amendment and an Evan-approved in-page serializer |

## Decision
Amend the reader protocol to `generic-reader-protocol.2` as chosen above ([Amendment 1](../../docs/evals/generic-reader-protocol.md#amendment-1-2026-10-06-generic-reader-protocol2)). Frame `retail-frame.2` SHA-256 `511959a5…b052` (989 eligible: 480 U.S., 509 non-U.S., 42 currencies); item price bands `f75c978c…3756`; seed unchanged; the held-out list `6bc92515…79b2` unchanged.

## Consequences
- 12.2 adds the location rule (never change country or currency, `redirected-off-domain`), per-currency item bands, the observed storefront region and currency in `sites.json`, and extra platform markers (Shopware, PrestaShop, Cafe24, MakeShop).
- 12.3 labels currency with evidence, reports U.S. and non-U.S. separately, and reports blocked sites as a known gap.
- Phase 13's reader returns a currency with every `found` and `ask`. The design's step 4 currency rule becomes a currency decision for any currency.
- The extension keeps recommending for U.S. stores in USD until the non-USD recommendation phase.
- The agent still never solves or attempts a CAPTCHA or bot wall. Nothing about attended capture is authorized now.
- `.2` needs an independent reviewer's signature before 12.3 starts.

## Status
Proposed 2026-10-06 by the amendment builder (claude-code/claude-opus-5-5) on Evan's chat decisions. Becomes accepted when an independent reviewer subagent signs `generic-reader-protocol.2`.
