---
type: Product
title: Goal
description: Why AI Checkout exists, who uses it, what success means, and what it deliberately does not do.
status: stable
tags: [product, goal]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T05:26:46Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived)
  - resource: ../archive/design.md
    title: Design (archived)
  - resource: ../../README.md
    title: README
---

# Goal

AI Checkout answers one question at an online checkout: which card the shopper already owns earns the most here, and under what conditions. A Chrome extension computes the answer deterministically; an LLM curation pipeline keeps the card catalog current from issuer terms, with a human approving every change.

It is Evan Liu's portfolio project for LLM-engineering roles. The headline is a **measured evaluation of an LLM extraction harness on real credit-card terms** (several models, prompts and context strategies on a labeled corpus); the product is the proof that the harness output is usable.

## Users

| User | Uses | Needs |
| --- | --- | --- |
| Shopper | Extension on Amazon US, Best Buy US, Newegg US carts | Correct best-card answer, no account, nothing leaves the device |
| Reviewer (Evan) | Hosted review app; chat approval of each release (since 2026-10-05) | Source-cited drafts, diffs against the published catalog, explicit publish on his approval |
| Recruiter / reader | Public site, results page, repo | Honest, reproducible numbers |

Few real users are expected; quality and honesty of claims matter more than reach.

## What success means

1. Measured extraction results on real issuer terms, with held-out data, published in [`docs/evals/results.md`](../../docs/evals/results.md). Done 2026-09-29/30 (see [evaluation](../system/evaluation.md)).
2. The extension runs on the reviewed catalog served by the hosted API (7 cards in release 1; 178 cards since release 2, 2026-10-03).
3. The extension ships on the Chrome Web Store.
4. Catalog stays current: terms-change detection triggers re-extraction and review.

Status per item: [roadmap](roadmap.md) and [now](../now.md).

## Non-goals

- Bank linking, card numbers, payments or placing orders.
- An LLM call at checkout, or any model write path to the catalog.
- Autonomous publication; broad scraping; non-U.S. cards or currencies.
- Accounts for shoppers (cloud sync is a possible future phase, not planned work).

## Related

* [User directives](user-directives.md)
* [Roadmap](roadmap.md)
* [Architecture](../system/architecture.md)
