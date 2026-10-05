---
type: Decision
title: Generic reader evaluation protocol choices (Phase 12.1)
description: Where the Phase 12 plan left room in the pre-registered reader protocol: a frozen agent-classified retail frame on Tranco 647LX, SHA-256 keyed seeded orders, all top-1k and 1k–10k candidates, a capture stop at 195 sites, balanced stratified splits, a pass bar on real pages only with variants reported apart, pass or fail on frozen labels, robots `Disallow: /` as the only posture exclusion, and merchant-pipeline held-out domains (6 / 27 / 27) allowed to overlap the reader splits.
status: proposed
tags: [decision, phase-12, merchants, eval]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-06T02:00:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol
  - resource: ../product/phase-12-reader-eval.md
    title: Phase 12 plan
---

# Generic reader evaluation protocol choices (2026-10-06)

## Context
The [Phase 12 plan](../product/phase-12-reader-eval.md) sets what the [protocol](../../docs/evals/generic-reader-protocol.md) must cover: about 300 candidates, three site splits, states by how they arise, two labelers and an adjudicator, frozen labels, bounds, Y = 80%, the peek policy, the capture posture and a frozen merchant-pipeline held-out list. It doesn't say how to classify retail domains, how to randomise, when capture stops, how variants relate to the pass bar, or whether the two held-out sets may overlap. The 12.1 builder made these calls. They become binding when the reviewer signs the protocol.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Population | Draw from Tranco at capture time in 12.3; freeze a classified frame now | Freeze the frame now (`retail-frame.1`, 670 domains, 457 eligible). Every later draw is then fixed before any page is seen. Classification is by an agent from knowledge, without website visits: the probe list, a read of Tranco ranks 1–10,000 and a known-retailer list. The bias toward well-known brands beyond rank 10,000 is stated |
| Randomness | A PRNG with a seed; SHA-256 of seed, purpose and domain | SHA-256 keys. Any tool reproduces them and the script has no dependencies. One seed, three purposes |
| Candidates | Equal per band; proportional; all of the scarce bands | All eligible top-1k (18) and 1k–10k (111), plus the 25 probe sites, filled to 300 from 10k–100k. The top band is small and half blocked, so sampling it would thin it further |
| Capture stop | Visit all 300; stop at a site count | Stop at 195 captured (65 per split), and report to Evan below 150 |
| Split assignment | Round-robin; fewest-in-stratum with ties | Fewest in stratum, then band, then overall, ties to held-out A, B, development. Probe sites are forced to development and counted |
| Global brands, marketplaces | Probe exclusions as they were; one rule | One rule: a U.S. storefront in USD with its own checkout. H&M and Zara become eligible, marketplaces are in, online-only cross-border retailers are out |
| Variants and the bar | Variants inside the zero-false-found bar; reported apart | Reported apart, with false founds listed by class. The bar is on real pages, as criterion 1 reads, and the variants are synthetic and adversarial |
| Errata and the verdict | Score on corrected labels; on frozen labels | Frozen labels decide. A pass that needs errata is reported as such and goes to Evan. In the probe, both corrections went the reader's way |
| robots.txt and terms | Exclude on any cart or checkout disallow, or on an anti-automation clause; record only | Exclude only `Disallow: /` for all agents. Record cart and checkout disallows and terms clauses, and report counts. Most retailers disallow `/cart` to keep it out of search indexes, and D4 approved a shopper-paced, logged-out visit. Evan may tighten this by amendment before 12.3 |
| Extension during capture | Load the extension as a shopper would; none | None. Nike's refusal named extensions |
| Held-out B after A retires | Stop after B's first failure; B gets two runs | Two runs, "under the same rule". The stop rule triggers when B fails twice |
| Pipeline held-out size per band | 20 / 20 / 20; 6 / 27 / 27 | 6 / 27 / 27. Only 18 top-1k domains are eligible, so the list takes a third of them and leaves two thirds for pipeline development |
| Overlap between pipeline held-out and reader splits | Disjoint; independent | Independent draws, with overlap allowed (46 of 60 are reader candidates). The two evaluations measure different outputs from different inputs. Disjoint sets would cost a third of the reader's scarce top-1k sites. Reader data of these domains is barred from pipeline development |

## Decision
As chosen above, in `generic-reader-protocol.1`. The seed is `ai-checkout/phase-12/2026-10-06`. The frame SHA-256 is `11b2d786…7985`, and the pipeline held-out list SHA-256 is `8c89dc44…8a75`. The script is `evals/merchants/tools/seeded-selection.mjs`.

## Consequences
- 12.2 must implement: the capture posture (no extension, pace limits, robots and terms recording), the platform markers, a snapshot that keeps open shadow roots and styles, and a harness that verifies the freeze hashes.
- 12.3 runs `reader-candidates` and `split` and commits their outputs. It can't change the frame, the seed or the order.
- A misclassified frame domain is excluded at capture, never replaced. A reader split can therefore end below 65 sites.
- Phase 16 starts by adjudicating the 60 held-out profiles, and its drafting can't read Phase 14 seed rows for them.

## Status
Proposed 2026-10-06 by the Phase 12.1 builder (claude-code/claude-opus-5-5) within the approved plan. It becomes accepted when the independent reviewer signs the protocol. Evan may amend the robots and terms posture before 12.3.
