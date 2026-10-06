---
type: Decision
title: Clarifications before any .8 capture (generic-reader-protocol.9)
description: After an auditor subagent cross-checked the binding text of generic-reader-protocol.8, the coordinator decided process clarifications before any pane capture. The .8 candidate list is committed; an offline pane platform script is added; one cart rule applies to every store; pane evidence and failed adds are defined; robot-only rules are labelled; pane session limits and labeller inputs are set; the operator agent and transcript audit are tightened.
status: proposed
tags: [decision, phase-12, merchants, eval, capture]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-06T23:45:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol (Amendment 8)
  - resource: 2026-10-06-capture-protocol-8.md
    title: Pane capture and the .8 process
---

# Clarifications before any .8 capture (2026-10-06)

## Context
`generic-reader-protocol.8` was signed at `a1c994d` and merged (main `058b7bf`). No `.8` capture has run. An auditor subagent cross-checked its binding text and found:
- gaps: the `.8` candidate list was not committed, and no tool detects the platform of pane captures;
- contradictions: the cart rule differed between signed-in and logged-out stores, and the evidence rule said both "never exported" and "export";
- robot-only wording that read as if it bound the pane;
- undefined cases: a failed add-to-cart, a second pane session, and what labellers see for pane captures.

These are **the coordinator's** decisions, process only.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| `.8` candidates | Regenerate when needed; commit | **Commit** `reader-candidates-8.json` (425 + 1,000, `6cdc35a9…`); `sites.json` names it |
| Pane platform | Operator records it; offline from exports | **Offline**, `pane-platform.mjs` over the `pane-dom.2` exports of `empty-cart` and the first cart state, with `platform.mjs`'s markers on attributes and text. Header and script-only markers are unavailable; the split runs on its output |
| Cart with pre-existing items | Empty logged-out carts, keep signed-in ones; one rule | **One rule for every store**: remove only the operator's own items and never pre-existing ones, which are recorded as carried-over; the states they distort are `not-reached`; the final count equals the carried-over count |
| Pane evidence | Screenshots (not available); exports | **Exports** for judgement exclusions, `geo-blocked` included. CAPTCHA and bot-check pages are never exported; their visible wording is recorded |
| Failed add (pane) | Exclude at once; try others | **Up to 3 eligible items**, then `add-to-cart-refused` |
| Pane sessions | One; one plus one after failure | **One, plus one** after `tool-error`, an operator crash or a usage limit, in any later run; then `tool-error` is final |
| Form submits in the pane | — | Add-to-cart, remove-item and quantity-increment controls may submit a form; background writes are not controlled in the pane |
| Labeller inputs (pane) | Export only; screenshots of the rebuild plus export | **Screenshots of the rebuilt page (JavaScript off) plus the export** |
| Operator file handling | — | Files saved only with Write; Bash only for `shasum` and reading (no `>`, `tee`, `cp`, `mv`) |
| Audit wording check | Everywhere; not on writes into `capture/data/` | **Skip writes into `capture/data/`**, since exports contain page words such as "Checkout" |

## Decision
`generic-reader-protocol.9` (Amendment 8), with `pane-platform.mjs` and audit and agent updates. No rule of the bar, outcomes, frames, seed, splits or labels changes.

## Consequences
- **Platform:** pane captures may land in `none-detected` more often than robot captures (no headers, no script contents), which shifts the platform strata. The split still sees only the frame and the platform group.
- **Cart states:** stores with pre-existing cart items lose `empty-cart`, and their other states too when those items are in the summary. These are reported as not reached.
- **Re-attempts:** three add-to-cart attempts and one extra session per store bound the retries.

## Status
Proposed 2026-10-06 by the amendment builder (claude-code/claude-opus-5-5) on the coordinator's decisions. It awaits the independent reviewer's signature of `.9`; `.8` binds until then.
