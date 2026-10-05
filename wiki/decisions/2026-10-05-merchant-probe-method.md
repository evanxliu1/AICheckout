---
type: Decision
title: Phase 10 probe method choices
description: How the 25-site probe was run where the plan left room — sites from a known-retailer candidate list looked up in Tranco 647LX plus a read of the top 1,000, a custom computed-style snapshot beside MHTML, a test extension for the badge-frame and storage checks, labels before the first reader run with corrections recorded, and a proposed Y of 80% on one-item cart pages.
status: accepted
tags: [decision, phase-10, merchants, eval]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T23:30:00Z
sources:
  - resource: ../product/phase-10-feasibility-probe.md
    title: Phase 10 plan (merchant feasibility probe)
  - resource: ../../docs/evals/merchant-probe-2026-10.md
    title: Merchant feasibility probe report
---

# Phase 10 probe method choices (2026-10-05)

## Context
The [probe plan](../product/phase-10-feasibility-probe.md) fixed the questions, the strata and the safety rules, but not how to classify domains, what a snapshot holds, how to answer the badge-frame question or how to keep labels independent of the reader. The builder made these calls during the run.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Classify retail domains | Agent reads the whole Tranco top 100,000; a candidate list of about 300 known U.S. retailers looked up in Tranco plus a full read of the top 1,000 | Candidate list plus the top 1,000, which is cheap and covers every band. The NRF Top 100 serves as the cross-check |
| Platform strata before visiting | Guess from knowledge; fetch each candidate home page once | One `curl` GET per candidate (93), which biased selection toward reachable sites (reported) |
| Snapshot | Playwright trace; `page.content()` only; a custom tree with computed styles and open shadow roots plus MHTML, HTML, screenshot and headers | Custom `dom.json` plus the others: `page.content()` drops shadow roots and styles |
| Q4 badge frame | Read the CSP only; load a test extension that mounts the badge-shaped frame | Test extension, which answers the question empirically (the frame loaded under strict `frame-src`) |
| Q6 storage | Desk check; measure | Measure in the same test extension |
| Label independence | Label after running the reader; label before, freeze, then run | Before. Labeler errors found later are corrected against the screenshot and DOM and recorded in `labels.json` |
| Reader changes | Tune until good; report the first run plus at most a bug fix, flagged | Run 1 as written, run 2 with one visibility fix, both reported; run 2 is not a held-out figure |
| Proposed Y | 70%, 80% or 90% on one-item cart pages | 80%: below the fixed prototype's point estimate and inside both runs' intervals, without pushing `found` on ambiguous pages |

## Decision
As chosen above. Clicks were limited to size, colour, add-to-cart, closing popups and cookie banners, non-form checkout and "Continue as guest" buttons. Shopify and Magento checkouts were opened by URL. Nothing was typed or submitted.

## Consequences
- The 64% cart rate is optimistic for top retailers because of the selection bias. Phase 12's capture will meet bot walls on most top-1k sites.
- Reader v1 needs split-amount parsing, lazy style reads and a rule against `found` on a lower kind when a total-labelled row did not parse.
- The second labeler and the report review are still to run.

## Status
Accepted 2026-10-05 by the Phase 10 builder (claude-code/claude-opus-5-5) within the approved plan; Y is a proposal for Evan.
