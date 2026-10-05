---
type: Runbook
title: Catalog release history
description: Dated records of the hosted catalog releases published with the catalog release runbook — release 3 (2026-10-05.renewal.1, agent publish, 2026-10-05), release 2 (2026-10-02.expansion.1, review app, 2026-10-03), the facts of 2026-10-02.expansion.1 and how the 2026-10-05.renewal.1 renewal was prepared.
status: stable
tags: [ops, catalog, release, history]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T05:47:59Z
sources:
  - resource: catalog-release.md
    title: Catalog release runbook (these records were split out of it on 2026-10-05)
  - resource: ../../packages/rewards-core/src/catalog-v3.ts
    title: CATALOG_V3 (2026-10-05.renewal.1)
  - resource: ../../evals/curation/expansion/catalog-build-report.md
    title: Catalog v3 build report
  - resource: ../../docs/evals/freshness-2026-10.md
    title: Freshness 2026-10 results
---

# Catalog release history

One dated section per hosted catalog release, newest first, written by the coordinator after publishing (step 3 of [coordinator, after publishing](catalog-release.md#coordinator-after-publishing)). The procedure is the [catalog release](catalog-release.md) runbook. Release 1 (`2026-09-29.real.1`, 7 cards, sequence 1, published 2026-10-02T02:29Z) followed [`docs/release/publish-runbook.md`](../../docs/release/publish-runbook.md).

## Release 3 (published 2026-10-05)

| Item | Value |
| --- | --- |
| Release | sequence 3, `2026-10-05.renewal.1`, schema 3, 178 cards, 328 sources, verified 2026-10-05T00:00Z, expires **2026-11-04T00:00:00Z** |
| Published | 2026-10-05T05:20:50Z (`published_at`), the first [agent publish](catalog-release.md#agent-publish-cli): Evan typed "logged in, publish 2026-10-05.renewal.1" in chat (instruction time 2026-10-05T05:18:43Z); the coordinating session ran `pipeline publish --confirm` from the main checkout at `645b1c8` with the 14 capture folders listed under [renewal](#renewal-2026-10-05renewal1-prepared-2026-10-05) |
| Draft | `2e67343a-2d11-4a9e-8ea6-eb89ccef0d1f`, created on head 2; 328 captures uploaded (one 20 s rate-limit wait); published at revision 2 |
| Review note | states the catalog is agent-verified, not human-verified, the canonical hash, that all 328 captures match, and "published by the coding agent on Evan's chat instruction of 2026-10-05T05:18:43Z" |
| Served release | checked by the coordinator after publishing: `/v1/catalog` serves sequence 3, `2026-10-05.renewal.1`; canonical JSON SHA-256 of the served catalog equals `CATALOG_V3` on `main`, `8e4c63946c7a7393684ce103fb9826fa5afdb3434a8421d93b682548451a4f6e`. Release 2 is no longer served |
| Extension refresh | the extension's own `prepareCatalogUpdate` accepts the served release 3 over a cached release 2 (the `2026-10-02.expansion.1` catalog from `577c025`) and puts `2026-10-05.renewal.1` in effect; checked by the coordinator 2026-10-05 with a throwaway vitest run, not a loaded `build:hosted` extension |
| Next deadline | the next renewal must be published before **2026-11-04T00:00Z**; it must re-read the NerdWallet estimates (read 2026-10-02). Freedom Flex and Discover Q4 rules end 2026-12-31 |

## Release 2 (published 2026-10-03)

| Item | Value |
| --- | --- |
| Release | sequence 2, `2026-10-02.expansion.1`, schema 3, 178 cards, 328 sources, expires 2026-11-01T00:00:00Z |
| Published | by Evan in the hosted review app at 2026-10-03T06:15:00Z, through the [assisted flow](catalog-release.md#assisted-flow-coordinator-drives-the-browser): Evan signed in, selected the three capture folders and ticked the attestation; the coordinator prepared the draft in the browser, wrote the review note and verified |
| Review note | states the catalog is agent-verified, not human-verified |
| Draft and served release | canonically identical to `CATALOG_V3` on `main` `577c025` (canonical JSON SHA-256 `147b48c1a18fa2296d06461b0ae0e647d8c0a8e66f9639ab1cfc10613533eb26`); every one of the 328 sources showed "Matching evidence captured"; the served release is schema-valid |
| Extension refresh | the extension's own `prepareCatalogUpdate` accepts the served release over a cached release 1 and puts it in effect. This closes the Phase 3 M6 live-refresh check, verified through the extension's update logic, not by loading a `build:hosted` extension and choosing **Check for updated terms** |
| Next deadline | the release expires **2026-11-01T00:00Z**; a fresh catalog (pipeline freshness stage or a manual refresh with new dated captures) must be published before then. Freedom Flex and Discover Q4 rules end 2026-12-31 |

## Facts (2026-10-02.expansion.1)

| Item | Value |
| --- | --- |
| Catalog | `CATALOG_V3`, schema 3, version `2026-10-02.expansion.1`: 178 cards, 820 rules, 328 sources, 70 programs, 140 brands, 24 gates, 3 merchants; 602,441 bytes JSON ([build report](../../evals/curation/expansion/catalog-build-report.md)) |
| Valid | verified 2026-10-02T00:00Z, **expires 2026-11-01T00:00Z**. The database refuses to publish it after expiry and the review app refuses to start a draft from it |
| Target | publish by **2026-10-28**; hosted release 1 expires 2026-10-29T00:00Z, after which `/v1/catalog` answers 503 until a valid release is published |
| Sources to capture | 328: 15 from `evals/curation/real/captures`, 2 from `evals/curation/real/merchant-captures`, 312 from `evals/curation/expansion/captures` (that folder holds 321 files; 9 are not cited and are ignored). `chase-rewards-category-faq` is in both the real and the expansion folder with the same hash |
| Requests | 328 `POST /v1/review/sources` (largest body about 206 KB; limit 1,516,384 bytes) and one draft save (about 0.62 MB; limit 1,114,112 bytes). `/sources` allows 200 a minute; the app waits on 429 and retries, so the capture takes about two minutes |
| Prerequisites on hosted | all 10 migrations (Stage 2: `20261002222425_catalog_v3`, `20261002230334_review_summary`); Render serving `main` with M5 and M8 (the review app offers `CATALOG_V3`). Checked 2026-10-03T01:07Z: `/health` 200, `/v1/catalog` 200 (release 1), the hosted review bundle contains `2026-10-02.expansion.1` and "Load a capture folder" |
| Local check 2026-10-03 | all 338 files in the three folders match their manifests' SHA-256 (15 + 2 + 321); `valid_catalog_v3` accepts the catalog in about 0.1 s on the local stack |

## Renewal `2026-10-05.renewal.1` (prepared 2026-10-05)

**Published as [release 3](#release-3-published-2026-10-05) on 2026-10-05** through the [agent publish](catalog-release.md#agent-publish-cli). Built from the 2026-10-05 freshness check and ten refresh batches ([results](../../docs/evals/freshness-2026-10.md)); verified 2026-10-05, **expires 2026-11-04T00:00Z**; 178 cards, 328 sources. Merged (PR #50) and deployed: on 2026-10-05T04:40Z the hosted review bundle contained `2026-10-05.renewal.1` and the refresh batch manifests. Evan chose the CLI publish path the coordinator runs on his chat instruction (Phase 9 milestone 5, PR #53, [decision](../decisions/2026-10-05-agent-publish-cli-session.md)); the [browser steps](catalog-release.md#evan-in-the-hosted-review-app) remained the fallback. Before publishing, the quote check passes with every capture folder:

```
node scripts/check-expansion-quotes.mjs --captures <each folder below>
```

Pass the batch folders first, as listed below; the check is then clean. If the expansion folder comes after a batch folder, the check reports seven anchors in the frozen `evals/curation/expansion/` files as not verbatim: a source captured again by a refresh batch keeps its ID, and the checker resolves an ID to the last folder that has it. Those files are clean against their own folders (run the check with only the expansion and real folders); fixing the checker to resolve per file is a Phase 9 follow-up.

Capture folders (14; three checkouts):

- `~/Projects/AICheckout-p8-wf/evals/curation/batches/<batch>/captures` for `wells-fargo-2026-10` and the ten `*-refresh-2026-10` batches (11 folders);
- `~/Projects/AICheckout-expansion/evals/curation/expansion/captures` (181 unchanged expansion sources);
- `~/Projects/AICheckout/evals/curation/real/captures` (5 unchanged real-card sources);
- `~/Projects/AICheckout/evals/curation/real/merchant-captures` (2 merchant MCC pages; `pipeline handoff` wrongly names the freshness record for these).

After this publish, on 2026-10-05, the coordinator copied every folder into the main checkout; the worktree paths below are how release 3 was published, and the default since then is in [capture folders](catalog-release.md#capture-folders).

For the [agent publish](catalog-release.md#agent-publish-cli), the same folders as flags (`$HOME/Projects/AICheckout` is Evan's main clone; run from a clean checkout of `origin/main`):

```
npm run pipeline -- publish --version 2026-10-05.renewal.1 \
  --captures $HOME/Projects/AICheckout-p8-wf/evals/curation/batches/american-express-refresh-2026-10/captures \
  --captures $HOME/Projects/AICheckout-p8-wf/evals/curation/batches/bank-of-america-refresh-2026-10/captures \
  --captures $HOME/Projects/AICheckout-p8-wf/evals/curation/batches/barclays-refresh-2026-10/captures \
  --captures $HOME/Projects/AICheckout-p8-wf/evals/curation/batches/capital-one-refresh-2026-10/captures \
  --captures $HOME/Projects/AICheckout-p8-wf/evals/curation/batches/chase-refresh-2026-10/captures \
  --captures $HOME/Projects/AICheckout-p8-wf/evals/curation/batches/citi-refresh-2026-10/captures \
  --captures $HOME/Projects/AICheckout-p8-wf/evals/curation/batches/discover-refresh-2026-10/captures \
  --captures $HOME/Projects/AICheckout-p8-wf/evals/curation/batches/synchrony-refresh-2026-10/captures \
  --captures $HOME/Projects/AICheckout-p8-wf/evals/curation/batches/u-s-bank-refresh-2026-10/captures \
  --captures $HOME/Projects/AICheckout-p8-wf/evals/curation/batches/wells-fargo-2026-10/captures \
  --captures $HOME/Projects/AICheckout-p8-wf/evals/curation/batches/wells-fargo-refresh-2026-10/captures \
  --captures $HOME/Projects/AICheckout-expansion/evals/curation/expansion/captures \
  --captures $HOME/Projects/AICheckout/evals/curation/real/captures \
  --captures $HOME/Projects/AICheckout/evals/curation/real/merchant-captures
```

Offline dry run on branch `phase9-m5-agent-publish` (2026-10-05, `--offline`): **328 of 328 sources match** a bundled manifest hash for their date. A source found in several folders with the same hash is counted for the first folder that has it, so the per-folder "used" counts (expansion 104, real 1, `wells-fargo-refresh-2026-10` 0) are lower than the per-layer counts above; the uploaded text is identical either way.

`2026-10-05.renewal.1` was added to `publishedVersions` in `evals/curation/catalog-batches.json` in the PR that recorded release 3 (branch `wiki-audit-2026-10-05`). The next renewal is due before 2026-11-04 (the NerdWallet estimates read 2026-10-02 must be re-read for any catalog verified after 2026-11-01).

## Related

* [Catalog release](catalog-release.md)
* [Hosting](hosting.md)
* [Roadmap](../product/roadmap.md)
* [Phase 9 plan](../product/phase-9-freshness.md)
