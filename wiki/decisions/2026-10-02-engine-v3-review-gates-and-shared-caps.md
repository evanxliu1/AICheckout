---
type: Decision
title: Answer gates per wallet, guarantee the worst gate answer, and hold shared caps on the smallest rule ID
description: Pre-merge review changes to the v3 engine semantics — gate answers move from each card to the wallet, an unanswered gate's guaranteed minimum is the worst case over its answers instead of the base, and a shared cap's spend row is the group's rule with the smallest ID instead of the first in catalog order.
status: accepted
tags: [decision, engine, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:59:00Z
sources:
  - resource: ../../packages/rewards-core/src/engine-v3.ts
    title: compareV3, guaranteed, capHolder
  - resource: ../../packages/rewards-core/src/types.ts
    title: Wallet.gates
  - resource: ../../extension/tests/rewards-v3.test.ts
    title: v3 engine tests, including the review edge cases
---

# Answer gates per wallet, guarantee the worst gate answer, and hold shared caps on the smallest rule ID (2026-10-02)

## Context
The pre-merge review of Stage 2 M2 (branch `s2-m2-engine-v3`, agent-verified) found three rows of the [engine semantics decision](2026-10-02-engine-v3-semantics.md) that misstate or weaken results. Gates describe the cardholder (a Prime membership, a bank relationship), yet the wallet answered them per card, so one wallet could say "Prime member" for Prime Visa and "not a member" for the Amazon Store Card. With a gate unanswered, every gated rule was a range from the base, so Prime Visa at Amazon (5% with Prime, 3% without) guaranteed only its 1% base although every answer earns at least 3%. A shared cap's spend was read from the group's first rule in catalog order, which moves when a release reorders rules. No stored wallet uses gates or shared caps yet (the extension refuses v3 until M6).

## Options considered
| Question | Chosen | Alternative and why not |
| --- | --- | --- |
| Where gate answers live | `Wallet.gates` `[{gateId, optionId}]`, one answer per gate for every card (coordinator decision) | Per card (`WalletCard.gates`): allows contradictory answers and makes the UI ask the same question per card |
| Guaranteed minimum with unanswered gates | The worst case, over the possible answers, of the best minimum each answer allows (answers grouped by which requirements they meet; at most 64 combinations per card, else the old base-to-rule ranges) | Base to rule per gated rule: understates cards whose every answer earns a bonus and can name a worse card (BCE over Prime Visa at Amazon) |
| Shared cap spend row | The group's rule with the smallest ID (code-unit order) | First rule in catalog order: moves when rules are reordered. A row keyed by `sharedCapId`: changes the `RuleUsage` contract for one case |

## Decision
As in the "Chosen" column. The maximum is unchanged; `condition-unknown` is still reported while an unanswered gate can move the shown amount. A gated rule's other uncertainties (an unanswered choice, activation, cap usage) still give a range from the base under each answer. The engine also rejects a `cash` valuation other than 100, rejects malformed v3 wallet inputs with its own errors (`Invalid wallet choices.`, `Invalid wallet gates.`, `Invalid value override.`), and no longer loads Zod (`isUnconditionalRuleV3` is in `rules-v3.ts`).

## Consequences
- The amazon-us ladder with Prime unknown now names Prime Visa (3–5%) over BCE (1–3%).
- `usageInputs` lists the combined spend on the smallest-ID rule (Cash+: `cash-plus-department-stores`; Freedom Flex: `flex-q4-department`). M6/M7 store and ask for it there.
- M6 prunes wallet `gates`, card `choices`, usage rows and `valueOverrides` that a new catalog no longer has, since the engine throws on them.
- Worst-case timing (2026-10-02, Node 24, Apple silicon): 180 cards with 30 rules each and every card at the 64-combination limit runs in about 13 ms; 180 fixture-sized cards in under 1 ms.
- Open for the coordinator: an unvalued card is listed after every valued card even when the valued card earns nothing and the unvalued one earns units (the existing test "puts a valued card that earns nothing before an unvalued card"). The badge then names a card earning $0 with `rankingMayChange` set. Ranking a valued card whose maximum is 0 below an unvalued card that guarantees units would need no assumed value.

## Status
Accepted 2026-10-02 (gates per wallet by the coordinator; the rest by the M2 pre-merge reviewer). In the [engine semantics decision](2026-10-02-engine-v3-semantics.md) it supersedes the per-card `gates` of the "Wallet inputs" row, the base-to-rule range for unanswered gates and the "Shared cap" row.
