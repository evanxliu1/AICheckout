---
type: Decision
title: The cart reader shows an amount only when certain; no confirmation prompt; at least 99% correct
description: Evan, 2026-10-06 — generic reader only (no per-store settings); no "is that right?" prompt; the reader shows a cart total only when certain, otherwise the recommendation shows rates without a dollar figure; the bar is at least 99% correctness on shown amounts (aim 100%), proven on about 300 or more held-out cart pages, with coverage reported separately; capture moves to agent-driven browser-pane sessions, no manual capture by Evan.
status: accepted
tags: [decision, phase-12, phase-13, reader, extension]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-06T22:46:16Z
sources:
  - resource: ../product/phase-12-reader-eval.md
    title: Phase 12 plan
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol
---

# The cart reader shows an amount only when certain (2026-10-06)

## Context
The design had the reader return `found`, `ask` ("We found $84.99 — is that right?") or `none` (typed). Capture by the Playwright robot reached about 18% of sites after two batches (5 captured of 28 visited; 1 of 13 outside the U.S.), so the planned 150–220-site set was out of reach. The coordinator proposed a smaller hand-captured set and keeping the confirmation prompt; Evan rejected both.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Uncertain amount | Ask the shopper to confirm; show nothing | Show nothing: the recommendation is shown with rates, without a dollar figure (which card wins rarely depends on the exact amount; caps and minimums are the exceptions) |
| Bar | 0 false found on ~60 sites; ≥ 99% correct on shown amounts on ≥ 300 held-out pages | ≥ 99% correct on shown amounts (aim 100%), 95% upper bound of the wrong-amount rate ≤ 1% (0 wrong in about 300 held-out pages), coverage (share of pages with a shown amount) reported separately |
| Where 99% is hard | Generic reader only; generic reader plus per-store configs as data for top stores | **Generic reader only** (Evan: per-store settings are a never-ending loop across effectively infinite stores); when unsure it withholds the amount; no model at checkout. The three legacy adapters (Amazon, Best Buy, Newegg) stay until the generic reader matches them on those stores, then retire |
| Capture | Robot; Evan by hand; agents in the browser pane | Agents driving the built-in browser pane, one store at a time, page export by an in-page script approved by Evan; CAPTCHA and bot-walled stores skipped and reported (no manual steps by Evan) |

## Decision
As chosen. A 3-store pane trial (apple.com, homedepot.com, notino.nl) measures yield and token cost before the protocol is amended to the new capture method and bar.

## Consequences
- `ask` disappears from the product: the reader's outcomes become shown (`found`) or withheld; the protocol's scoring and the design's checkout flow change in the next amendment.
- Success criterion 1 changes to the 99% bar; criterion 5 (field correction rate) becomes the field rate of reported wrong amounts.
- Token cost of capture is accepted by Evan (estimated in the trial).
- Store configs are dropped from the plan: no hosted store configs in the merchant database (Phase 14) and no agent-authored store configs in the merchant pipeline (Phase 16); coverage depends on the generic reader alone.

## Status
Accepted 2026-10-06 by Evan in chat ("it should just be correct … at least 99% … agent driven please"); recorded by the coordinator (claude-code/claude-opus-5-5).
