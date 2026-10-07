---
type: Decision
title: Development 60%, held-out A 40%; a fresh held-out set replaces held-out B (generic-reader-protocol.10)
description: Evan, 2026-10-07 — two reader-eval splits weighted 3 : 2 (development : held-out A); held-out B merges into development from the start; A is the one measurement for the ≥ 99% claim; if A fails twice it becomes development data and a fresh held-out set is captured from the remaining candidates; after the final score all pages may become development data for reader v2.
status: proposed
tags: [decision, phase-12, phase-13, merchants, eval]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-07T01:15:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol (Amendment 9)
  - resource: 2026-10-06-capture-protocol-8.md
    title: Pane capture and the .8 process (1 : 2 : 2 splits)
---

# Development 60%, held-out A 40% (2026-10-07)

## Context
`generic-reader-protocol.8` split the captured sites 1 : 2 : 2 into development, held-out A and held-out B, so that each held-out split could carry about 300 `cart-1` pages and B could back up A. No `.8` or `.9` capture has run. On 2026-10-07 Evan decided in chat: **"Dev 60% / held-out A 40%"**.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Splits | 1 : 2 : 2 with B as the backup; 3 : 2 with a fresh set on failure | **3 : 2, two splits** (Evan). B merges into development from the start, about three times the development data of `.8` |
| What replaces B | Keep B; fresh capture after A retires | **A fresh held-out set.** It is captured from the remaining candidates in the frozen visit order, under the same rules and strata, sized for ≥ 300 `cart-1` pages with an expected amount (320 sites with a real `cart-1`), skipping operators already in development. It is double-labelled, adjudicated, frozen before any run, and runs at most twice |
| Stop threshold | Keep 830 captured / 760 `cart-1`; re-derive | **840 captured sites with a real `cart-1`** (336 U.S. + 504 non-U.S.; 800 in the first draft, raised by the coordinator at review). A at 40% gives about 333–336 `cart-1`, about 316–319 with an expected amount at an assumed 5% null labels. If A ends below 300 before the freeze, more sites are captured and the deterministic split is re-run before any freeze or reader run |
| After the final score | Keep held-out pages hidden; release them | **Release them:** all pages may become development data for reader v2. A later claim about unseen stores needs a new held-out set |

**Coordinator's reasoning, recorded with Evan's decision.** The reader is hand-written rules tuned by an agent. Any page it sees can always be fitted, so a claim about unseen stores needs pages the developer never saw. A therefore stays untouched as the one measurement, and a retired A is replaced by fresh pages rather than reused.

**Review at `598dc4b`** ("sign with fixes", agent-verified):
- **Applied:**
  - **M1:** the reader developer never browses candidate stores outside development, unvisited candidates included.
  - **M2:** when the U.S. stream is exhausted, a fresh set is reported per stream with the U.S. gap stated, and Evan's go is required before any fresh capture.
  - **L1:** the stop is raised to 840, with the re-split remedy.
  - **L2:** the fresh set's operator skips are reported by stream.

## Decision
`generic-reader-protocol.10` (Amendment 9). `seeded-selection.mjs --weights-protocol-10` assigns development 3 : held-out A 2, with B at weight 0. Default output and earlier options are unchanged (tested). Simulated: 852 / 573 of all 1,425 candidates; 498 / 332 of the first 830.

## Consequences
- **More development data:** the reader developer has about 500 development stores instead of about 170.
- **No ready backup:** a second failure on A costs a new capture round (about 320 stores with a `cart-1`, from the remaining non-U.S. candidates mainly, since the U.S. stream is nearly used up). That could thin the U.S. share of the fresh set.
- **Operator skips:** the fresh set skips operators already in development, which may exclude some large multi-storefront operators.

## Status
Proposed 2026-10-07 by the amendment builder (claude-code/claude-opus-5-5) on Evan's decision in chat. It awaits the independent reviewer's signature of `.10`; `.9` binds until then.
