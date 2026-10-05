---
type: Decision
title: Freshness records, seeded refresh batches and real cards in batches (Phase 9 milestone 3)
description: Phase 9 M3 choices — one committed text-free freshness record per day that only dates a capture when the page is unchanged, a catalog-wide command rather than the per-card stage slot, per-host capture processes in parallel, refresh batches seeded from each card's current layer with research recorded as seeded, and pipeline batches that may replace a real card while keeping its release-1 names and rule-ID scheme.
status: accepted
tags: [decision, catalog, pipeline, freshness, phase-9]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T00:05:04Z
sources:
  - resource: ../product/phase-9-freshness.md
    title: Phase 9 plan (how freshness works, milestone 3)
  - resource: ../system/card-expansion-pipeline.md
    title: Card-expansion pipeline (Built so far, Freshness)
  - resource: 2026-10-04-review-app-batch-manifests.md
    title: The review app matches a capture by the source's date
---

# Freshness records, seeded refresh batches and real cards in batches (2026-10-05)

## Context
Release 2 expires 2026-11-01T00:00Z and every cited source must be within 30 days before `verifiedAt`. Milestone 3 of the [Phase 9 plan](../product/phase-9-freshness.md) builds the hash-only re-check, lets the builder and the review app date a source from it, seeds refresh batches from the pages that changed and lets a batch refresh the seven real cards. A first session left the builder, review-app and module parts as a checkpoint; this one finished the command, the seeding and the tests, and changed one rule (below).

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Which results date a capture | `unchanged` and `changed` (any rendered hash); `unchanged` only | **`unchanged` only**, in the builder (`freshDates`), the review app and `handoff`. With `changed` counted, a render whose hash equals an older layer's capture of the same source (a refreshed page that changed back, or the old layer's text) gave that older capture a newer date than the batch's own, so the builder took the old capture; a test reproduced it. A changed page is dated by its new capture in a refresh batch |
| Where freshness lives | The per-card `freshness` stage slot of `state.json`; a catalog-wide record | **A catalog-wide command and one record per day** in `evals/curation/freshness/`: sources are shared between cards and layers, and the builder and review app need the dates without any batch. The per-card slot stays unused |
| How pages are fetched | One capture run; one process per host | **One `capture-issuer-pages.mjs` process per host** (its own 2.5 s delay), up to `--concurrency` hosts at once (default 4), each in its own temporary directory, removed in a `finally` |
| Resuming | Overwrite the day's record; resume it | **Resume**: the record is written after each host; a re-run checks sources missing from it, unreachable there or whose manifest hash moved; `--only` re-checks exactly those named. Only that day's file is ever written |
| What `flagged` means | Any flag; a problem flag on another hash | **Another hash with `http-error`, `short`, `bot-wall` or `fetch-failed`**: possibly not the page at all. An unchanged page stays `unchanged` even when short |
| What a seeded batch copies | The changed sources only; all of a card's sources | **All of each card's sources** from the layer the card currently comes from (the newest whose corpus has it), its `cards.json` entry and that layer's capture hints; a real card's `cards.json` entry is built from its Phase 7 research entry, as `build-expansion-cards.mjs` builds one |
| Which cards | Changed cards only; any named card | **Changed cards by default; `--cards` names cards explicitly** (unchanged ones allowed and reported); another issuer's card, a missing record or no changed card without `--cards` is refused |
| Research of a seeded batch | Run the researcher anyway; record it done | **Recorded `done` with `provenance: "seeded"`**, input hash over the request, the four seed files and the freshness record; when it goes stale, `next` returns a `gate-failed` queue step (seed a new batch), never a researcher |
| How a replaced real card is checked | Keep `checkRealCards` for all; skip for the replaced card | **Skip only for the replaced card** (`checkRealCards(…, { replaced })`); it keeps `REAL_CARDS` names and the `<prefix>-<category>` scheme (`-2` for a repeated category), and rule-ID continuity against the ledger applies |

## Decision
As in the table. The record is strict Zod with codes, hashes, dates and versions only; the renderer is the capture script's SHA-256 plus the Playwright and Chromium versions it reports (`--renderer`).

## Consequences
- With no freshness record the catalog builds byte for byte as before; the first committed record moves `verifiedAt` and needs a new catalog version (milestone 4).
- A shared source (for example `chase-rewards-category-faq`, cited by the real Freedom Unlimited and expansion Chase cards) re-captured in a refresh batch takes that capture's date and hash for every card citing it, as before this milestone.
- The overlay author must carry the Amex buy-now-pay-later exclusion for a refreshed Amex real card; `applyOverlayCard` adds it only to a card without an overlay entry.
- Changed merchant MCC pages still need a manual re-capture; there is no merchant stage before Phase 10.

## Status
Accepted 2026-10-05 by the implementing session (claude-code/claude-opus-5-5) under the Phase 9 milestone 3 brief.
