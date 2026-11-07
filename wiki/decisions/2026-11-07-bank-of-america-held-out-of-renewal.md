---
type: Decision
title: The 19 Bank of America cards are held out of renewal 2026-11-07.renewal.2 because the issuer blocks the capture
description: Every Bank of America page answered the pipeline's headless Chromium capture with HTTP 403 (bot wall) on 2026-11-06 and 2026-11-07, in three freshness re-checks and two batch captures; the request hint returns static HTML without the earn rates; so the seeded batch bank-of-america-refresh-2026-11 ships as a layer with an empty corpus and all 19 cards dropped with that reason, and a later batch restores them when the host answers. Amended 2026-11-07: the pages were captured in the desktop browser pane through `pipeline capture-import` (same normalization and gates) and the batch is through verify; adjudicate waits on the pinned model's limit.
status: accepted
tags: [decision, catalog, pipeline, phase-15, renewal]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-11-07T04:40:00Z
sources:
  - resource: ../../evals/curation/freshness/2026-11-06.json
    title: Freshness record 2026-11-06 (35 Bank of America sources flagged)
  - resource: ../../evals/curation/batches/bank-of-america-refresh-2026-11/capture-report.md
    title: Capture report of the seeded Bank of America batch (35 of 35 pages HTTP 403)
  - resource: ../../evals/curation/catalog-batches.json
    title: Build config (the batch's dropped entries)
  - resource: ../ops/catalog-release.md
    title: Catalog release runbook, step 3 of renewing
---

# The 19 Bank of America cards are held out of renewal `2026-11-07.renewal.2` (2026-11-07)

## Context
The hosted catalog `2026-10-05.renewal.1` expired on 2026-11-04T00:00Z. The renewal's freshness check on 2026-11-06 found all 35 Bank of America sources `flagged`: `bankofamerica.com` answered headless Chromium with an access-denied page (`bot-wall`, `http-error`, `short`) for every page, where the 2026-10-05 check had rendered 34 of them. Two `--only` re-checks the same day (one host at a time) and two captures of the seeded batch `bank-of-america-refresh-2026-11` (18:30 UTC and 03:20 UTC the next day) got HTTP 403 on all 35 pages. A scratch probe with the capture script's documented `request` hint (a plain fetch of the static HTML, used for Synchrony, State Farm and Fidelity pages) returned the product page with 886 of its 1,568 words and none of its earn rates ("1.5%" 0 of 2 mentions), and the pricing pages as a 58-character shell, so that path is no evidence base. A cited source older than 30 days before `verifiedAt` makes the build refuse ([catalog v3 contract](2026-10-02-catalog-v3-contract-details.md)), and every Bank of America source is dated 2026-10-02 or 2026-10-05.

## Options considered
| Option | Why not / why |
| --- | --- |
| Wait for the host to answer again before renewing | Every install has shown expired terms since 2026-11-04; the block has held for ten hours and may be an address-level block of this machine |
| Capture through the `request` hint | The static HTML carries no earn rates; labels from it would be wrong or empty |
| Read the pages in the desktop browser and write captures by hand | Captures are the capture script's renderings, hashed into the manifests; a hand-made capture bypasses the stage and its gates. **Superseded by the amendment below**: `pipeline capture-import` runs the same normalization and gates |
| Keep the cards with their October labels | The schema forbids a source older than the 30-day window; a dated-forward source would be a false record |
| **Hold the 19 cards out of this renewal with the reason, and restore them with a later batch** | Chosen: the runbook's step 3 for unreachable sources; 159 cards ship now; owned Bank of America cards stay visible as unavailable in the extension until a release restores them |

## Decision
1. The seeded batch `bank-of-america-refresh-2026-11` (all 19 cards named with `--cards`, capture `failed-gate` on every card) is registered in `evals/curation/catalog-batches.json` as the newest layer for those cards with every card in `dropped` and the reason above. Its `corpus.json`, `catalog-overlay.json` and `product-notes.verified.json` are empty envelopes written by the renewal session (apply and overlay never ran, since nothing was captured); `cards.json`, `sources.json` and `capture-hints.json` are the seed; `manifest.json` and `capture-report.md` record the 35 HTTP 403 answers of 2026-11-07 (about 250 characters each). Nothing cites those entries.
2. The pipeline has no command for this: `run build` refuses a batch with no active card, `drop-source` refuses to leave a card without a source, and `heldOut` in `state.json` has no setter. The config entry and the three envelopes are the hand-written equivalent of what such a command would write; adding the command is a follow-up ([pipeline commands, known gaps](../system/card-pipeline-commands.md#known-gaps)).
3. Restoring the cards: when `pipeline freshness --only <the 35 sources>` or a capture of a new seeded batch (`init bank-of-america-refresh-<YYYY-MM> --refresh-from-freshness <date> --cards <19 ids>`) renders the pages, that batch runs the usual loop and its layer replaces this one's dispositions. The October labels in `bank-of-america-refresh-2026-10` and `expansion.v1` stay as the last agent-verified labels.

## Consequences
- The renewal ships 159 cards (178 less 19); the golden ladders that used Customized Cash Rewards at Best Buy and Newegg are retired with it, and the card-count checks move to 159.
- Shoppers who own a Bank of America card see it as unavailable until a release restores it; comparisons continue with their other cards.
- The build report lists the 19 dropped cards with the reason; `pipeline status` keeps showing the batch at `capture-flagged`.

## Status
Accepted 2026-11-07 by the renewal driver (claude-code/claude-fable-5-1) under the runbook's step 3; Evan can instead wait for the host and re-run the batch before publishing.

## Amendment (2026-11-07): captured in the desktop browser pane

Evan asked on 2026-11-07 to restore the 19 cards from captures made in the Claude desktop app's built-in browser pane, which rendered `bankofamerica.com` normally (no challenge) where headless Chromium got HTTP 403. The objection above to a hand-made capture no longer holds, because the import is not hand-made: `pipeline capture-import --method browser-pane` (on `boa-browser-capture`) takes the page's `document.body.innerText` after the capture script's own steps (scroll, open `<details>`, expand visible collapsed buttons; Apply, Log in, prequalify and submit controls and anything in a form are skipped, a safety filter the script does not have), applies the capture stage's normalization and flags from the shared `scripts/lib/capture-text.mjs`, and writes the capture, a manifest row with `method: browser-pane`, `capturedBy` and `capturedAt`, and a run-report row, so the capture gate, `capture-report.md` and the build report treat and name these sources as browser-pane captures ([command](../system/card-pipeline-commands.md#cli-stages)).

- **Captured 2026-11-07:** all 35 sources, one page at a time with a few seconds between pages, one pane tab per run (the coordinator's own and four sequential capture subagents', each closed after); every page HTTP 200, no challenge, 7,684 to 34,589 characters, 0 flagged. The text reached disk through the transcripts (JavaScript tool results in chunks of 30,000 characters, joined and checked against the SHA-256 the page computed). Captures stay gitignored and were copied into the main checkout's batch folder.
- **Loop:** extract (gpt-5.6-luna xhigh through Codex: 17 `needs_review`, 2 `evidence_valid`), draft and verify (card-verifier, Opus 5.5: 17 fixed, 2 confirmed, 0 drop-card) are accepted. **Adjudicate is blocked**: the pinned adjudicator model `claude-fable-5-1` hit its weekly limit (resets 2026-11-11T22:00Z) and its run ended before writing; the packet was released. Running the adjudicator on Opus 5.5 instead is the alternative the [pipeline models decision](2026-10-04-pipeline-agent-models.md) rejected, so it is Evan's call: wait for 2026-11-11, or allow an Opus 5.5 adjudicator run for this batch. Until adjudicate, apply and overlay are accepted, the build config keeps the 19 cards in `dropped`.
- **Terms seen to have changed since October** (for the adjudicator and overlay author, from the captures): Customized Cash Rewards cards earn 6% in the choice category in the first year (3% plus a 3% first-year bonus, within the shared $2,500 quarterly cap), then 3%; product pages and terms name the BofA Rewards program (a rewards bonus for members); the Atmos Rewards product pages advertise larger welcome offers than the cited terms pages (campaign IDs in `sources.json`).

## Amendment (2026-11-07): the 19 cards ship in the renewal

After the browser-pane capture (above), `boa-browser-capture` was merged into `catalog-renewal-2026-11`. The batch was adjudicated on Opus 5.5 because of the Fable limit ([decision](2026-11-07-renewal-adjudicate-on-opus.md)), then applied and overlaid (19 cards, none held out). The 19 `dropped` entries for this layer were removed from `evals/curation/catalog-batches.json`, so `2026-11-07.renewal.2` ships every Bank of America card and the Customized Cash Rewards golden ladders stay. The held-out disposition above no longer applies to this renewal.
