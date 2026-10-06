---
type: Decision
title: Pane capture and the process of generic-reader-protocol.8
description: The coordinator's process decisions that carry out Evan's 2026-10-06 decisions (show only certain amounts, ≥ 99% precision, generic reader only, agent-driven pane capture). Covers the pane operator's checklist and record, parallel tabs, simpler item selection, the pane-dom.1 export and offline rebuild, 425 + 1,000 candidates with a 830-site stop and 1 : 2 : 2 split weights, the new outcomes and Clopper–Pearson bound, and the batch 2 calls.
status: accepted
tags: [decision, phase-12, merchants, eval, capture]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-06T23:20:37Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol (Amendment 7)
  - resource: 2026-10-06-reader-shows-only-certain-amounts.md
    title: Evan's decision (accepted)
  - resource: ../../evals/merchants/capture/records/pane-trial.md
    title: Pane trial note
  - resource: ../../evals/merchants/capture/README.md
    title: Capture tool README
---

# Pane capture and the .8 process (2026-10-06)

## Context
Evan decided on 2026-10-06 ([decision](2026-10-06-reader-shows-only-certain-amounts.md), accepted):
- the reader shows an amount only when certain, and otherwise withholds it;
- the bar is ≥ 99% correct on shown amounts, proven on about 300 held-out pages, with coverage reported separately;
- the reader is generic only, with no per-store settings;
- capture is agent-driven in the Claude desktop app's browser pane, and Evan does nothing by hand.

Two pieces of evidence came in the same day:
- **Robot yield:** after two batches the robot had reached about 18% of sites.
- **Pane trial:** a three-store pane trial reached all three carts (apple.com, and two the robot couldn't reach). Each store took about 2–4 minutes and 15–25k tokens.
- **Parallel tabs:** a four-subagent test (22:59 UTC) showed that parallel background tabs stay isolated.

The process decisions below are **the coordinator's** (the coordinating session, claude-code/claude-opus-5-5) and reversible.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Main capture method | Robot; pane; both | **Pane.** The robot is kept, not deleted, and retired as the main path; its captures stay valid as `robot`. Its unfixed click-coordinate defect doesn't matter while it is retired |
| Pane safety | Trust the operator; a checklist plus reviewable logs | **Checklist plus a committed record per store.** The record holds the navigation path, actions with UTC times, export hashes, robots posture and evidence. The posture is the robot's |
| robots.txt (Evan, chat 2026-10-06) | Keep the disallow-everything exclusion; record only | **Record only.** robots.txt never excludes a store; the posture is recorded and stores visited despite a disallow are counted. This replaces the 2026-10-05 and earlier 2026-10-06 rules everywhere. savana.com is re-visited. Fixed and unchanged: agents never solve, bypass or interact with CAPTCHAs or bot checks (Evan asked; the coordinator declined), such stores are skipped and reported, and agents identify honestly |
| Parallelism | One store at a time; parallel tabs | **Parallel.** Each operator uses its own background tab, with one tab per store and stores claimed from the frozen order. Concurrency starts at 8 and may rise to 16 if blocks and errors don't rise. Carried-over carts in the shared profile are emptied (remove clicks recorded) or their state recorded. The report says all sessions share one IP and profile |
| Item selection | Keep the `.4` reconnaissance rules; any in-band in-stock item by ordinary navigation | **Any in-band item.** Judgement is acceptable because the operator is not the reader developer, no reader exists yet, and the reader is judged on totals the operator doesn't choose. The path is recorded. There is no separate reconnaissance session |
| Export | Trial format (attribute subset, pruned); a faithful format | **`pane-dom.1`:** all elements and attributes, text, open shadow roots, display everywhere, 14 computed styles and boxes on text-holding and form elements, iframe stubs. Exported by the Evan-approved `pane-export.js` and rebuilt offline by `rebuild.mjs` into static HTML for labellers and replay. A fixture round-trip test checks that visible text and amounts are equal |
| Sample size | 400 + 400; all U.S. plus 1,000 non-U.S. | **U.S. 425 (all eligible) and non-U.S. 1,000**, stopping at 330 + 500 captured. 400 U.S. + 400 non-U.S. would give about 500 captured sites at a pane yield near 60%, about 200 per held-out split, too few for 300 `cart-1` pages |
| Split | Equal thirds; weighted | **1 : 2 : 2.** Development needs fewer pages than a held-out test. A weight option is added to `seeded-selection.mjs`; equal weights reproduce the old splits exactly |
| Too few pages | — | **Stop and report to Evan** below 760 captured `cart-1` (before the split) and below 300 labelled `cart-1` in held-out A (before the freeze) |
| Bound | Rule of three; Wilson; exact Clopper–Pearson | **Exact one-sided 95% Clopper–Pearson.** 0 wrong needs 299 shown, 1 wrong needs 473 |
| Coverage | Pass condition; reported | **Reported only** per stream and state, with a target of 80% on `cart-1` |
| Batch 2 calls | — | The coordinator's calls are as listed in the protocol. The builder applied Amendment 4's principle to bricklink.com and samsung.com (re-visit by pane, as a second draw), flagged for confirmation |


**Review fixes (independent review at `9d79158`, "sign with fixes", agent-verified):**
- **Format:** `pane-dom.2` supersedes `.1`, within Evan's approval of the in-page script. It adds checkVisibility, box > 1 px and non-default clipping, opacity and transform styles; the rebuild keeps hidden text hidden and drops meta refresh. Replay runs with JavaScript disabled, and readers never read `data-pane-*`.
- **Auditability:**
  - transcript IDs go in the record;
  - `audit-pane-transcript.mjs` flags forbidden calls;
  - the `pane-operator` subagent has no form-input, file-upload or Claude in Chrome tools;
  - the JavaScript tool has exactly three allowed texts (export, chunk fetch, `pane-robots-hash.js`).
- **Pane sign-ins:** the pane keeps sign-ins across app use. Evan (chat, 2026-10-06): "do not worry if we are signed in, the agents can continue, i do not mind". Signed-in stores are captured normally under guards: no sign-out, no account pages, no settings; only the operator's own items are removed afterwards; pre-existing items are recorded as carried-over and `empty-cart` is `not-reached`; the store is flagged `signedIn` and reported apart; personal data is never committed. This replaces a short-lived `signed-in-pane` exclusion.
- **Item rule:** an item with a minimum quantity above 1 is ineligible and another is picked, so webstaurantstore.com is re-visited.
- **Low findings:**
  - within-site correlation is stated, and the site-cluster bound is always reported;
  - the chunk path and main-world tampering are disclosed, with one re-export and then `tool-error`;
  - a truncated export without its summary is `not-readable`;
  - the telemetry design's stale `ask` is fixed;
  - the bricklink.com and samsung.com re-visits are confirmed.

## Decision
`generic-reader-protocol.8` (Amendment 7). Tool additions: `pane-export.js` (`pane-dom.1`), `rebuild.mjs`, and `seeded-selection.mjs --weights-protocol-8` (new SHA-256). Existing robot tooling is unchanged.

## Consequences
- **Selection judgement:** item selection is no longer mechanical, so a reviewer can't re-derive the item. The recorded path and the separation of roles carry the weight.
- **Comparability:** pane and robot pages differ in format. They are reported by capture method, and reading time is measured on the rebuilt pane pages.
- **Lost data:** pane exports have no headers, so the `x-magento-*` platform marker is unavailable, and no MHTML is kept.
- **Cost:** about 1,200 store visits at 15–25k tokens each, which Evan accepted.
- **Shared session:** parallel sessions share one IP and profile, which could raise blocks; concurrency is reported with the blocked rate.

## Status
Proposed 2026-10-06 by the amendment builder (claude-code/claude-opus-5-5) on the coordinator's decisions, which carry out Evan's accepted decision. **Accepted 2026-10-06:** the independent reviewer signed `generic-reader-protocol.8` at `a1c994d` (agent-verified). Its four non-blocking notes were applied before any real capture as a dated erratum: a final cart-count check; the audit also flagging account paths, writes outside the capture folders and Bash network access; and the export header's provenance.
