---
type: Product
title: Phase 13 plan (generic cart reader v1)
description: Build readCart — a deterministic, model-free, store-agnostic reader that shows a cart total and its currency only when certain — with a Fable 5.1 reader developer on development pages, review it, measure it on frozen held-out A, report honestly, then wire it into the extension (13b).
status: stable
tags: [product, plan, phase-13, merchants, reader]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-08T21:00:00Z
sources:
  - resource: phase-12-reader-eval.md
    title: Phase 12 plan (the frozen evaluation set)
  - resource: ../../docs/evals/reader-captures-2026-10.md
    title: Reader evaluation set, 2026-10
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol
  - resource: ../system/merchant-coverage-design.md
    title: Merchant coverage design (generic cart reader)
---

# Phase 13 plan: generic cart reader v1

Started 2026-10-08 after the Phase 12 freeze. Evan, in chat that day: "have a fable 5.1 develop the readCart part of the extension, iterate, and evaluate". The reader is judged on the frozen set ([report](../../docs/evals/reader-captures-2026-10.md)) by the harness in [`evals/reader/`](../../evals/reader/README.md); the protocol's rules bind ([protocol](../../docs/evals/generic-reader-protocol.md), status notes of 2026-10-08: the ≥ 99% bar is a quality target, not a gate).

## What the reader must do

`readCart(document, { url })` in `packages/cart-reader` returns either `{ shown: true, kind, amountMinor, currency }` or `{ shown: false, reason }`.

- **Deterministic and local.** It reads only the document it is given (open shadow roots included). No model, network, storage, clock or randomness, and no per-store rules: no domain lists or per-site selectors (the bundle tripwire allows at most 3 frame domains and no split domain).
- **Shows only when certain.** It shows one amount of the most preferred kind (`afterCredit` > `estimatedTotal` > `subtotal`) in the cart summary, with its currency, and otherwise withholds. A wrong shown amount is the costly error; a withhold costs only coverage.
- **What it has to handle** (from the development pages): visible-only text (display, visibility, opacity, clipping, off-canvas drawers), summary region versus line items, recommendations, carousels, installment offers, free-shipping bars and struck was-prices; multilingual total labels; locale number formats (decimal comma, dot/space/apostrophe grouping, non-Latin digits, zero-decimal currencies); currency by the protocol's evidence order (code, structured data, unambiguous symbol, then the page URL's storefront, for example the TLD); ambiguity (two different preferred amounts) means withhold; text addressed to an AI is just page text.
- **Budget.** p95 read time ≤ 50 ms; every read stable (the harness reads three times plus a pair 500 ms apart).

## Steps

Simplified by Evan on 2026-10-08: "no need for isolation audit or held out A run by another agent, leaking is not a bad thing, we just dont want store specific, generalizing, keep it efficient and simple" ([decision](../decisions/2026-10-08-phase-13-simplified.md)).

| Step | Who | What | Done when |
| --- | --- | --- | --- |
| 13.1 Setup | Coordinator | Branch `phase13-reader`; the developer brief (`packages/cart-reader/README.md`) | Brief committed |
| 13.2 Develop and iterate | **Reader developer: Fable 5.1 (`claude-fable-5-1`)**, one session per round, at most 8 rounds | Write and refine the reader on development pages: `run.mjs --split development`, `score.mjs --failures`, unit tests in the package; commit each round with its development metrics | Development shown-wrong 0 (real pages and variants), coverage on `cart-1` at or above 80% or no longer improving over two rounds, p95 ≤ 50 ms |
| 13.3 Review | Independent subagent | Code review: generic (no store-specific rules), deterministic, withholds when unsure, tests; fixes by the developer | Review approves |
| 13.4 Held-out A | Coordinator | `run.mjs --split heldout-a --confirm-heldout-run 1`, commit the `runs.json` row, `score.mjs --record` and `--class-only`; a second run only after a generic fix on development | Scored |
| 13.5 Report | Coordinator | `docs/evals/reader-v1.md`: precision with exact bounds at page, store and operator level, coverage, by stream, state, currency and variant; wiki; PR | PR merged after CI |

**Phase 13b** (separate PR): the extension uses the reader on checkout pages of non-legacy stores. It shows the reader's amount when the reader is certain, otherwise card rates only. The Amazon, Best Buy and Newegg adapters stay. End-to-end tests run on fixture pages.

## What matters most

- **Generic, not store-specific.** No domain lists, hostnames, per-site selectors or class names: the bundle tripwire refuses split domains, and the review checks for anything that encodes one store.
- **Tuned on development.** The developer works from development pages and failures; held-out A is read only for the score. Strict isolation is not enforced (Evan): the report says so, and held-out A is a check of generalization across stores the developer did not tune on, not a sealed test.

## Progress

- **2026-10-08:** plan written; Phase 12 merged (PR #76, `298d6f6`); simplified by Evan the same day.
