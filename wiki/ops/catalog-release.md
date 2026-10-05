---
type: Runbook
title: Catalog release
description: Publish a bundled catalog as the next hosted release from the review app (release 2, 2026-10-02.expansion.1, 178 cards and 328 sources, published 2026-10-03), optionally with the coordinator driving the browser after Evan signs in, then verify /v1/catalog and the extension's refresh.
status: stable
tags: [ops, catalog, release, review]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T03:04:00Z
stale_after: 2026-11-01T00:00:00Z
sources:
  - resource: ../../apps/review/src/StartDraft.tsx
    title: Start a new draft
  - resource: ../../apps/review/src/DraftPanel.tsx
    title: Capture all missing sources, publish dialog
  - resource: ../../apps/review/src/ReviewWorkspace.tsx
    title: Bulk capture with rate-limit waits
  - resource: ../../packages/catalog-review/src/index.ts
    title: Capture, draft and rate limits
  - resource: ../../packages/rewards-core/src/catalog-v3.ts
    title: CATALOG_V3 (2026-10-02.expansion.1)
  - resource: ../../evals/curation/expansion/catalog-build-report.md
    title: Catalog v3 build report
  - resource: ../../docs/release/publish-runbook.md
    title: Release 1 publish runbook (7 cards)
---

# Catalog release

How a catalog built in the repository becomes the hosted release that `GET /v1/catalog` serves. Publishing is Evan's action in the hosted review app: he signs in, ticks the attestation and publishes; no script or agent signs in, ticks the attestation or publishes on its own ([user directives](../product/user-directives.md)). Since 2026-10-03 the coordinator may drive the rest of the review app in the browser after Evan has signed in ([assisted flow](#assisted-flow-coordinator-drives-the-browser)). The coordinator checks the deploy before and the result after. The first run of this runbook published `2026-10-02.expansion.1` as release 2 on 2026-10-03; release 1 (`2026-09-29.real.1`, 7 cards) was published with [`docs/release/publish-runbook.md`](../../docs/release/publish-runbook.md), whose step-by-step screens this runbook follows.

## Release 2 (published 2026-10-03)

| Item | Value |
| --- | --- |
| Release | sequence 2, `2026-10-02.expansion.1`, schema 3, 178 cards, 328 sources, expires 2026-11-01T00:00:00Z |
| Published | by Evan in the hosted review app at 2026-10-03T06:15:00Z, through the [assisted flow](#assisted-flow-coordinator-drives-the-browser): Evan signed in, selected the three capture folders and ticked the attestation; the coordinator prepared the draft in the browser, wrote the review note and verified |
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

## Steps

### Coordinator, before Evan starts

1. `curl -s https://ai-checkout-api.onrender.com/health` returns `{"status":"ok"}` (the free instance may take about a minute to wake).
2. `curl -s https://ai-checkout-api.onrender.com/v1/catalog | head -c 200` returns release `"sequence":1`, `"version":"2026-09-29.real.1"`, not a 503.
3. Render's latest deploy is the current `main` commit (Render dashboard, or the review bundle at `/review/` contains `2026-10-02.expansion.1`).
4. `npx supabase migration list --linked` shows all 10 migrations in the Remote column (needs the linked project; Evan or the authorized coordinator).

### Evan, in the hosted review app

Evan can do every step himself, or use the [assisted flow](#assisted-flow-coordinator-drives-the-browser). All three folders are gitignored copyrighted text; never commit or upload them anywhere else. The session lives in the tab's memory: reloading signs you out (saved revisions and captures are kept).

1. **Sign in** at https://ai-checkout-api.onrender.com/review/ with the reviewer account.
2. **Start a new draft.** Choose **Start a new draft**, select **Bundled catalog 2026-10-02.expansion.1 (schema 3, 178 cards)**. Check the summary: schema 3, 178 cards (328 sources to capture), verified Oct 2, 2026, expires Nov 1, 2026, status **Valid now**. Choose **Create draft**, then **Create the draft** in the dialog. The draft opens with every source missing. Nothing is published.
   - If **Create draft** errors, do not create another at once: reload, sign in, and open the pending `2026-10-02.expansion.1` draft if it exists.
3. **Load the captures.** Open **Capture all missing sources** and use **Load a capture folder** three times; each load adds to the texts already loaded:
   1. `~/Projects/AICheckout/evals/curation/real/captures` → "Loaded 15 files".
   2. `~/Projects/AICheckout/evals/curation/real/merchant-captures` → "Loaded 2 files".
   3. `~/Projects/AICheckout-expansion/evals/curation/expansion/captures` → "Loaded 312 files; ignored 9 that match no missing source".
   - Each note says how many files match a corpus manifest. If any file is **refused** because its SHA-256 differs from the manifest, stop: it is the wrong file or the page was re-captured. Captures are never re-taken to fit ([user directives](../product/user-directives.md)).
4. **Capture.** The button reads **Capture 328 of 328 missing sources and attach**. Choose it and keep the tab open. Past 200 requests a minute the status line shows "waiting N s for the capture rate limit…"; that is expected. Wait for "Captured 328 sources and attached them to a new draft revision."
   - If it stops part way (network, sign-in expired, Render restart), nothing is attached yet. Reload, sign in, open the draft, load the three folders again and capture again: identical captures are deduplicated by the database, so a retry is safe.
5. **Review.** **What changes** compares the draft with release 1: the seven real cards keep their IDs, rules and rule IDs (the build checks this), so changes are the 171 new cards, programs, brands and gates. Use the card search and the grouped diff. Spot-check against the captured text, at least:
   - the [golden ladders](../system/catalog-expansion.md#catalog-v3-build-m5) cards at Amazon, Best Buy and Newegg (Prime Visa, Amazon Store Card, My Best Buy Visa, Newegg store card, Cash+, Customized Cash);
   - program values: published estimates name NerdWallet and a 2026-10-02 retrieval date; issuer-stated values cite a capture; programs valued `none` show no value;
   - rotating rules (Freedom Flex, Discover) carry their Q4 2026 dates.
   Labels and overlay are agent-verified, not human-verified; say what you checked in the note. Fix errors under **Correct draft data**; every save is a new revision that needs fresh approval.
6. **Approve and publish** before 2026-10-28: tick **I checked the full source terms and all proposed rules and conditions.**, write a **Review note** (at least 10 characters, what you checked), choose **Publish reviewed terms**, check version, revision, 178 cards, 328 sources and the expiry (Nov 1, 2026, 12:00 AM UTC) in the dialog, then **Publish release**. Note the release number N (2 if release 1 is the head).

### Assisted flow: coordinator drives the browser

Evan's directive of 2026-10-03, first used for release 2. The coordinating session (never a subagent) works the hosted review app in the browser pane on Evan's request:

1. **Evan** opens the review app and signs in; the agent never types the password.
2. **Coordinator** starts the draft (step 2) and opens **Capture all missing sources**.
3. **Evan** selects the three capture folders in the file picker (step 3); the coordinator runs the capture (step 4) and checks every source reads "Matching evidence captured".
4. **Coordinator** reviews (step 5) and verifies the draft against the catalog on `main` (canonical JSON SHA-256 of the draft equals `CATALOG_V3`'s), then writes the **Review note**, saying the catalog is agent-verified, not human-verified, and what was checked.
5. **Evan** ticks **I checked the full source terms and all proposed rules and conditions.** himself and publishes (step 6). The attestation is always Evan's.

### Coordinator, after publishing

1. `curl -s https://ai-checkout-api.onrender.com/v1/catalog | head -c 300` shows `"sequence":N` and `"version":"2026-10-02.expansion.1"`; the full body is about 0.6 MB.
2. Build a hosted extension: `npm run build:hosted --workspace=ai-checkout-extension`, load `extension/dist`, choose **Check for updated terms** in the popup, and confirm it finishes without an error and that `checkoutCatalogV1` in `chrome.storage.local` (service worker DevTools: `await chrome.storage.local.get('checkoutCatalogV1')`) holds release sequence N, version `2026-10-02.expansion.1`. This closes the open Phase 3 M6 check. The cached release has the bundled catalog's `verifiedAt`, so the cached release is the one in effect (ties go to the cache) and the wallet keeps its inputs.
3. Update [now](../now.md), [hosting](hosting.md#facts) (published catalog row), the [roadmap](../product/roadmap.md) (Stage 2 done) and [log](../log.md).
4. In the next PR, add the published version to `publishedVersions` in `evals/curation/catalog-batches.json` (since 2026-10-04 it lists `2026-10-02.expansion.1`; v2's `2026-09-29.real.1` is not built from this config). From then on `npm run catalog:v3` refuses, before writing anything, to build that version with other rule IDs or terms than its entry in `evals/curation/rule-id-ledger.json`, and never rewrites that entry; a changed catalog needs a new `version` ([decision](../decisions/2026-10-04-published-versions-and-proposed-builds.md)).

For release 2 (2026-10-03), step 2 was done without a loaded `build:hosted` extension: the served body was passed through the extension's own `prepareCatalogUpdate` with release 1 cached, which accepted it and put it in effect ([release 2](#release-2-published-2026-10-03)).

## Publishing a pipeline batch

For a catalog built from a Phase 8 pipeline batch, start with `npm run pipeline -- handoff --batch <batch>` in the checkout that holds the batch's captures. It prints the PR checklist, the build report summary (version, verifiedAt, expiresAt, rule-ID changes), migrations, the capture folders to select in step 3 (one per layer the catalog uses, as absolute paths with file counts) and these steps, and exits 1 while the batch is not ready. The review app matches captures against the manifests `apps/review/src/manifest.ts` bundles at build time: the fixed corpora and every `evals/curation/batches/*/manifest.json` (since Phase 9 milestone 1), requiring the capture dated the source's `checkedOn` when one exists, otherwise the newest-dated capture. So the Render deploy of `main` is what makes a new batch's manifest known: the batch must be merged and deployed before Evan publishes (check that Render serves the merge commit in step 1). `handoff` reports review-app readiness against the checkout's manifests and lists any cited source it would not match ([pipeline](../system/card-expansion-pipeline.md#built-so-far), [decision](../decisions/2026-10-04-review-app-batch-manifests.md)).

A batch that is not to ship yet is built with `npm run pipeline -- run build --batch <batch> --proposed --version <new version>`: the catalog, build report and ledger diff go to the batch's `pipeline/proposed/`, and the build config, ledger, `CATALOG_V3` and the committed build report stay as they are; `handoff` then reports the proposed version and that nothing ships. To ship a batch, plain `run build` registers it and writes the shipping catalog, and needs `--version <new version>` while the config's version is published.

## Renewing a catalog before it expires

Outline since Phase 9 milestone 3 ([plan](../product/phase-9-freshness.md), [pipeline](../system/card-expansion-pipeline.md#freshness)); the first full run is milestone 4.

1. **Re-check.** In the checkout that holds the captures, on a branch from the latest `main`: `npm run pipeline -- freshness` (no model; re-run the same day to resume). Commit `evals/curation/freshness/<date>.json`. Its summary gives counts per layer and result and the cards with a changed page per issuer.
2. **Refresh changed cards.** Per issuer: `npm run pipeline -- init <issuer-slug>-refresh-<YYYY-MM> --issuer "<Name>" --refresh-from-freshness <date>`, then the `expand-catalog` loop (capture, extract, verify, adjudicate, apply, overlay). Real cards may be among them.
3. **Decide the rest.** Flagged and unreachable sources get no new date: add a capture hint and re-check with `--only`, drop the source in its batch, or hold the card out, each with a reason. Changed merchant MCC pages: re-capture by hand into `evals/curation/real/merchant-captures` with a new dated manifest entry, or drop.
4. **Build** under a new version (`run build --version <new>`): `verifiedAt` is the newest effective date; the builder refuses any cited source older than 30 days before it, naming the sources. Rule IDs of changed terms take new IDs (ledger).
5. **Merge and deploy**, so the review app knows the new batch manifests and freshness records, then `pipeline handoff` and the publish steps above. An unchanged source is matched against the hash the record verified for its date; Evan loads the capture folders `handoff` lists.

## Renewal `2026-10-05.renewal.1` (prepared 2026-10-05)

Built from the 2026-10-05 freshness check and ten refresh batches ([results](../../docs/evals/freshness-2026-10.md)); verified 2026-10-05, **expires 2026-11-04T00:00Z**; 178 cards, 328 sources. It must be published before release 2 expires (2026-11-01T00:00Z); target from 2026-10-20, latest 2026-10-28. Before Evan starts: the renewal branch is merged and Render has deployed `main` (the review app must know the new batch manifests and the freshness record), and the quote check passes with every capture folder:

```
node scripts/check-expansion-quotes.mjs --captures <each folder below>
```

With every folder loaded, the check also reports seven anchors in the frozen `evals/curation/expansion/` files as not verbatim: a source captured again by a refresh batch keeps its ID, and the checker resolves an ID to one capture. Those files are clean against their own folders (run the check with only the expansion and real folders); fixing the checker to resolve per file is a Phase 9 follow-up.

Capture folders Evan selects (14; three checkouts):

- `~/Projects/AICheckout-p8-wf/evals/curation/batches/<batch>/captures` for `wells-fargo-2026-10` and the ten `*-refresh-2026-10` batches (11 folders);
- `~/Projects/AICheckout-expansion/evals/curation/expansion/captures` (181 unchanged expansion sources);
- `~/Projects/AICheckout/evals/curation/real/captures` (5 unchanged real-card sources);
- `~/Projects/AICheckout/evals/curation/real/merchant-captures` (2 merchant MCC pages; `pipeline handoff` wrongly names the freshness record for these).

After Evan publishes, the coordinator adds `2026-10-05.renewal.1` to `publishedVersions` in `evals/curation/catalog-batches.json` in the next PR. The next renewal is due before 2026-11-04 (the NerdWallet estimates read 2026-10-02 must be re-read for any catalog verified after 2026-11-01).

## If something is blocked

| What you see | What to do |
| --- | --- |
| `/health` times out | Render is waking the free instance; wait a minute and reload, then sign in again |
| No `2026-10-02.expansion.1` option under **Start a new draft** | The deployed review app predates M5/M8, or the catalog expired. Coordinator checks the Render deploy of `main` |
| "Your session ended. Sign in again to continue." | The session ended or the token was refused before the upload (the API checks it before reading the body). Reload, sign in, repeat steps 3–4 |
| "This input is too large…", "Some draft fields are invalid…" or "The draft, dates, or captured evidence are not ready to publish…" during capture | Check the hosted migrations include `20261002222425_catalog_v3` (captures up to 250,000 characters, drafts up to 600 sources) and that the file is the manifest's capture. Retrying is safe |
| A capture stops with an unavailable error | Render or Supabase (including Auth, which the API asks to check the token) is down or restarting; wait and retry, nothing is attached until all captures succeed |
| The capture keeps waiting on the rate limit for more than five minutes | Another tab or person is capturing too (the limit is shared per process); stop the other one, then retry |
| Publish fails with a stale revision or head error | Someone saved or published in between: **Reload latest draft**, rebase if asked, review and approve again |
| `/v1/catalog` still shows release 1 after publishing | Reload the review app and check the draft shows **Published**; if so and the endpoint is unchanged after a minute, tell the coordinator; do not publish again |
| It is 2026-11-01 or later | The catalog has expired and cannot be published. A new catalog needs a freshness run and refresh batches ([renewal](#renewing-a-catalog-before-it-expires)) and a rebuild |

## Related

* [Hosting](hosting.md)
* [Review app](../system/review-app.md)
* [Catalog expansion](../system/catalog-expansion.md)
* [Database migrations](database-migrations.md)
* [Phase 7 Stage 2 plan](../product/phase-7-stage-2.md)
