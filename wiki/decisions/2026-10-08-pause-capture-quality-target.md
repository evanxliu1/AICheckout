---
type: Decision
title: Capture paused at about 300 stores; the ≥ 99% bar becomes a quality target; no further protocol amendments
description: Evan, 2026-10-08 — stop the Phase 12.3 pane capture once about 300 stores are captured and start the generic cart reader; "≥ 99%" meant "really good", not a statistical pass gate; no amendment or reviewer signature for this change. The protocol stays as the working method for split, labels, freeze and held-out discipline.
status: accepted
tags: [decision, phase-12, phase-13, merchants, eval]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-08T06:30:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol (status note of 2026-10-08)
  - resource: 2026-10-06-reader-shows-only-certain-amounts.md
    title: The reader shows only certain amounts (Evan, 2026-10-06)
---

# Capture paused at about 300 stores; the ≥ 99% bar becomes a quality target (2026-10-08)

## Context
The full pane capture under `generic-reader-protocol.12` reached about 300 captured stores (about 280 with a real `cart-1`) out of a stop rule of 840 real `cart-1`. At the observed yield (about 50% of visited stores) the candidate list would have ended near 675, short of 840, and the coordinator asked whether to extend it. The coordinator also showed that about 300 stores cannot *prove* the ≥ 99% bar: held-out A would hold about 113 stores and about 310 cart pages with an expected amount, so even a perfect reader would need about 97% coverage to reach the 299 shown amounts the bound needs.

Evan in chat, 2026-10-08: "honestly lets pause at 300 captured stores (if we are pass that already, we can stop) and then start work on the general cart reader, it does not need to be 99% bar, that was just me trying to say it should be really good, i do not want an amendment or reviewer signature, update the necessary docs".

## Decision
- **Capture stops** at the stores captured on 2026-10-08 (the running batch was stopped; sessions it cut short are recorded as `capturePaused`, not as outcomes). No extension of the candidate list.
- **The bar is a target, not a gate.** The reader still shows an amount only when it is certain and otherwise withholds (rates only), and it should be as accurate as possible on shown amounts (aim ≥ 99%) with coverage reported (target 80% on `cart-1`). Results are reported with their exact bounds and the number of stores, honestly; nothing "passes" or "fails" criterion 1.
- **No amendment, no reviewer signature.** The protocol text is not amended; a dated status note at its top records this decision. Everything else in it remains the working method: the 60 / 40 development / held-out A split, two labellers and an adjudicator, the freeze before any reader run, no reader-developer access to held-out pages, held-out runs kept to a minimum (at most two), class-only failure analysis, generic reader only.
- **Superseded rules:** the 840 stop rule, the "fewer than 300 labelled held-out A `cart-1`" stop-and-report rule and its re-split remedy, the fresh-held-out-set procedure tied to two failed runs, and criterion 1 as a pass condition.

## Consequences
- The held-out result will be a precision estimate with a wide bound (with about 110–120 held-out stores, about 0 wrong in about 250 shown gives an upper bound near 1.2% at page level and about 2.6% at store level). Reports say so.
- Phase 13 (reader v1) starts after the labels and the split are frozen. More stores can be captured later if a tighter claim is wanted, under the same capture rules.
</content>
</invoke>
