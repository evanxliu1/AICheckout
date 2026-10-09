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

## Phase 13b: the reader in the extension (planned 2026-10-09)

Evan, 2026-10-09: "plan phase 13b, then have a fable 5.1 subagent implement". Branch `phase13b-extension`; implementer Fable 5.1; an independent review before the PR.

**Scope: the popup's "Read cart" at any store.** Today the popup reads the cart only at the three legacy stores (Best Buy US, Newegg US, Amazon US) and asks for a typed amount everywhere else (Phase 11).
- On "Read cart" at any other page, the popup injects the manual reader (`src/checkout/content.js`, `activeTab` + `scripting`, as today) and that reader runs `readCart` from `@ai-checkout/cart-reader` in the isolated world. The legacy adapters keep their three stores and run first there.
- **Shown and USD:** the amount fills the purchase like a legacy read (merchant = the store the popup already resolved, usually the generic store profile; kind `afterCredit`→`total`, `estimatedTotal`→`estimated-total`, `subtotal`→`subtotal`; reader version `generic-reader-v1`). The read is validated again before the comparison is saved, as legacy reads are.
- **Shown in another currency:** "This comparison supports USD only" (the existing message); nothing is filled.
- **Withheld:** a plain message to enter the amount; the shopper types it (Phase 11 behaviour). No guess, no partial amount.
- **Privacy unchanged:** the content script returns only the reading (kind, amount, currency, or a reason code), never page text; it reads nothing on its own, only on the shopper's click.

**Out of scope:** the automatic badge stays on the three legacy stores (it would need host access to every site, a Release A decision); the legacy adapters stay; no store configs; Web Store and privacy texts (`docs/release/`) are flagged for Phase 15, not edited.

**Tests:** unit tests for the mapping, currency and withhold paths and the contracts; Playwright end-to-end tests on local fixture stores (a generic cart page read correctly, a withheld page, a non-USD page, a legacy store unchanged); every existing test green.


## What matters most

- **Generic, not store-specific.** No domain lists, hostnames, per-site selectors or class names: the bundle tripwire refuses split domains, and the review checks for anything that encodes one store.
- **Tuned on development.** The developer works from development pages and failures; held-out A is read only for the score. Strict isolation is not enforced (Evan): the report says so, and held-out A is a check of generalization across stores the developer did not tune on, not a sealed test.

## Progress

- **2026-10-09: 13b built** on `phase13b-extension` by Fable 5.1 (independent review before the PR pending). `extension/src/checkout/manual-reader.ts` runs the legacy adapter on its cart URLs and `readCart` elsewhere; the popup offers "Read cart amount" at every store; contracts accept `generic-reader-v1`; the manual reader bundle grew from 8,908 to 34,458 bytes. Unit tests for the split, mapping and contracts; `e2e/generic-read.spec.ts` (generic read, withheld, euro, legacy cart URL). Details: [Extension](../system/extension.md#manual-cart-read-popup), [decision](../decisions/2026-10-09-generic-read-on-legacy-site-pages.md).
- **2026-10-09: 13.2–13.5 done** on `phase13-reader`. Fable 5.1 built the reader in six rounds (final `94b7b9a`), reviewed by an independent subagent after rounds 3–6 (agent-verified). Development: 384 correct / 0 wrong / 338 withheld, `cart-1` coverage 86%, p95 10 ms. Held-out A run 1 (unbiased): 237 correct / 18 wrong (precision 92.9%, ≤ 10.3%), `cart-1` coverage 76.9%. Run 2 after held-out-informed general fixes: 244 / 7 (97.2%, ≤ 5.2%; right amount and currency on 249 of 251), `cart-1` 78.6%, p95 11.6 ms. Both held-out runs are used. Report: [reader-v1](../../docs/evals/reader-v1.md). Next: PR, then 13b (extension).

- **2026-10-08:** plan written; Phase 12 merged (PR #76, `298d6f6`); simplified by Evan the same day.
