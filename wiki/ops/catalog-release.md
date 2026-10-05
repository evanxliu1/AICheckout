---
type: Runbook
title: Catalog release
description: Publish a bundled catalog as the next hosted release, by the coordinator from the CLI on Evan's chat instruction (pipeline login, publish --confirm, captures from the main checkout) or in the review app as the fallback, then verify /v1/catalog and the extension's refresh; renewing before expiry. Dated release records are on the release history page.
status: stable
tags: [ops, catalog, release, review]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T05:47:59Z
stale_after: 2026-11-04T00:00:00Z
sources:
  - resource: ../../tools/catalog-pipeline/src/publish.ts
    title: pipeline publish
  - resource: ../../tools/catalog-pipeline/src/session.ts
    title: pipeline login, logout, whoami
  - resource: ../../apps/review/src/StartDraft.tsx
    title: Start a new draft
  - resource: ../../apps/review/src/DraftPanel.tsx
    title: Capture all missing sources, publish dialog
  - resource: ../../apps/review/src/ReviewWorkspace.tsx
    title: Bulk capture with rate-limit waits
  - resource: ../../packages/catalog-review/src/index.ts
    title: Capture, draft and rate limits
  - resource: ../../packages/rewards-core/src/catalog-v3.ts
    title: CATALOG_V3 (2026-10-05.renewal.1)
  - resource: ../../evals/curation/expansion/catalog-build-report.md
    title: Catalog v3 build report
  - resource: catalog-release-history.md
    title: Catalog release history (dated records, split out 2026-10-05)
  - resource: ../../docs/release/publish-runbook.md
    title: Release 1 publish runbook (7 cards)
---

# Catalog release

How a catalog built in the repository becomes the hosted release that `GET /v1/catalog` serves. Publishing needs Evan's approval of that one release. Since 2026-10-05 that approval is his chat message `publish <version>`, after which the coordinating session publishes from the CLI with a session Evan logged in himself ([agent publish](#agent-publish-cli), Phase 9 milestone 5, merged with PR #53; [decision](../decisions/2026-10-05-agent-publish-cli-session.md)); no agent signs in or publishes without it ([user directives](../product/user-directives.md)). The fallback is the hosted review app, where Evan publishes and, since 2026-10-03, the coordinator may drive the rest of the app in the browser after Evan has signed in ([assisted flow](#assisted-flow-coordinator-drives-the-browser)). The coordinator checks the deploy before and the result after. The CLI path published `2026-10-05.renewal.1` as [release 3](catalog-release-history.md#release-3-published-2026-10-05) on 2026-10-05; the browser runbook published `2026-10-02.expansion.1` as [release 2](catalog-release-history.md#release-2-published-2026-10-03) on 2026-10-03; release 1 (`2026-09-29.real.1`, 7 cards) was published with [`docs/release/publish-runbook.md`](../../docs/release/publish-runbook.md), whose step-by-step screens this runbook follows.

## Agent publish (CLI)

Phase 9 milestone 5 ([decision](../decisions/2026-10-05-agent-publish-cli-session.md)), merged with PR #53 on 2026-10-05 and first used for [release 3](catalog-release-history.md#release-3-published-2026-10-05). The coordinating session (never a subagent) uploads the captures and publishes through the hosted review API with `npm run pipeline -- publish`, on a Supabase session Evan created himself. The agent never sees the password or a token: `login` refuses unless it runs in a terminal, the session file lives outside the repository with mode 600, and no command prints a token. The review API, its validation, rate limits and the database's checks are the same as for the review app.

1. **Evan, once, in his own terminal** (for example the desktop app's terminal panel, or any shell in a checkout with `npm ci` done): `npm run pipeline -- login`. It asks for the reviewer account's email and, without echo, its password, checks reviewer access and saves the session to `~/.config/ai-checkout/review-session.json` (or `$XDG_CONFIG_HOME/ai-checkout/`). Supabase rotates the refresh token on every use and the CLI saves the new one; the session lasts until it is revoked or unused past Supabase's refresh-token lifetime. `npm run pipeline -- logout` revokes it and deletes the file.
2. **Coordinator, ready check:** `npm run pipeline -- whoami --check` (email, API, saved time; refreshes and confirms reviewer access).
3. **Coordinator, dry run** in the main checkout at `origin/main` (clean, the merged and deployed `main` whose review app bundles the manifests): `npm run pipeline -- publish --version <version>`. Without `--captures` it reads the capture folder next to every bundled manifest that lists a cited source, which since 2026-10-05 is every folder (see [capture folders](#capture-folders)); `--captures <folder> …` (repeatable, any order) replaces that default, for example to publish from another checkout. It sends no POST or PUT to the API. It prints `CATALOG_V3`'s canonical JSON SHA-256, git state, per folder the `.txt` files and how many it used, `N of N sources match`, the review note, the session, the review head and any pending draft of the version, and what `/v1/catalog` serves. It exits 1 listing every missing or differing capture, a version that is not `CATALOG_V3`'s or an expired catalog; git problems are reported as "would refuse with --confirm". `--offline` skips every network call (git fetch included) to check only the captures.
4. **Evan types `publish <version>` in chat.** That message, for that one version, is the attestation. It does not carry over to another version.
5. **Coordinator, publish:** the same command plus `--confirm <version> --instruction-at <UTC time of Evan's message, e.g. 2026-10-20T15:04:00Z>`. It refuses before sending anything when `--confirm` differs from `--version`, the instruction time is in the future (5 minutes of skew allowed) or older than 7 days, HEAD is not `origin/main` after `git fetch`, `packages/rewards-core`, `evals/curation` or `apps/review/src/manifest.ts` have local changes, or any check of the dry run fails. Then it resumes the newest pending draft of the version (or creates one on the current head), refuses if that draft's catalog is not canonically `CATALOG_V3` (someone edited it) or its base is not the head (it never rebases), uploads only the captures not already attached with the local hash (429s are waited out with `Retry-After`; identical captures are deduplicated, so a re-run is safe), saves the draft with exactly one matching capture per source, re-reads and verifies it, publishes with the review note and checks `/v1/catalog`. The note says the catalog is agent-verified, not human-verified, what was checked and "Published by the coding agent on Evan's chat instruction of `<time>`".
6. **After publishing:** the steps under [coordinator, after publishing](#coordinator-after-publishing), including `publishedVersions` in the next PR.

If a run stops part way (network, Render restart, rate limit), run the same `--confirm` command again: it resumes the draft and skips captures already attached. An error prints the HTTP status and the API's code only. "session expired or revoked" (exit 2) means Evan runs `login` again.

## Capture folders

Captures are gitignored copyrighted text and exist only on Evan's machine. **Since 2026-10-05 the main checkout (`~/Projects/AICheckout`) holds all of them**: the coordinator copied them there from the worktrees, so `publish`, `handoff`, `freshness`, the quote check and the pipeline subagents run from the main checkout.

| Folder (under `evals/curation/`) | Contents |
| --- | --- |
| `batches/<batch>/captures` | 11 folders: `wells-fargo-2026-10` and the ten `*-refresh-2026-10` batches |
| `expansion/captures` | 321 files (frozen `expansion.v1`); also `expansion/extractions` (180 traces) |
| `real/captures`, `real/merchant-captures` | 15 real-card pages and 2 merchant MCC pages (always in the main checkout) |
| `runs/` | eval run outputs copied from `AICheckout-expansion` |

Checked by the coordinator on 2026-10-05: `npm run pipeline -- publish --version 2026-10-05.renewal.1 --offline` in the main checkout with no `--captures` flag matches **328 of 328** sources. The worktrees that held them, `AICheckout-p8-wf` (batch captures) and `AICheckout-expansion` (expansion captures, extractions, eval runs), are kept as backups until Evan agrees to remove them. Release 3 was published with explicit `--captures` flags pointing into those worktrees ([renewal record](catalog-release-history.md#renewal-2026-10-05renewal1-prepared-2026-10-05)).

## Steps

### Coordinator, before Evan starts

1. `curl -s https://ai-checkout-api.onrender.com/health` returns `{"status":"ok"}` (the free instance may take about a minute to wake).
2. `curl -s https://ai-checkout-api.onrender.com/v1/catalog | head -c 200` returns the current head release (sequence 3, `2026-10-05.renewal.1` since 2026-10-05; for release 2 it was sequence 1), not a 503.
3. Render's latest deploy is the current `main` commit (Render dashboard, or the review bundle at `/review/` contains the version to publish).
4. `npx supabase migration list --linked` shows all 10 migrations in the Remote column (needs the linked project; Evan or the authorized coordinator).

### Evan, in the hosted review app

The fallback when the [agent publish](#agent-publish-cli) cannot be used. The steps were written for release 2 (`2026-10-02.expansion.1`, three capture folders); for another version use its version, counts and expiry, and the capture folders `pipeline handoff` lists (all in the main checkout since 2026-10-05, see [capture folders](#capture-folders)). Evan can do every step himself, or use the [assisted flow](#assisted-flow-coordinator-drives-the-browser). Capture folders are gitignored copyrighted text; never commit or upload them anywhere else. The session lives in the tab's memory: reloading signs you out (saved revisions and captures are kept).

1. **Sign in** at https://ai-checkout-api.onrender.com/review/ with the reviewer account.
2. **Start a new draft.** Choose **Start a new draft**, select **Bundled catalog 2026-10-02.expansion.1 (schema 3, 178 cards)**. Check the summary: schema 3, 178 cards (328 sources to capture), verified Oct 2, 2026, expires Nov 1, 2026, status **Valid now**. Choose **Create draft**, then **Create the draft** in the dialog. The draft opens with every source missing. Nothing is published.
   - If **Create draft** errors, do not create another at once: reload, sign in, and open the pending `2026-10-02.expansion.1` draft if it exists.
3. **Load the captures.** Open **Capture all missing sources** and use **Load a capture folder** three times; each load adds to the texts already loaded:
   1. `~/Projects/AICheckout/evals/curation/real/captures` → "Loaded 15 files".
   2. `~/Projects/AICheckout/evals/curation/real/merchant-captures` → "Loaded 2 files".
   3. `~/Projects/AICheckout/evals/curation/expansion/captures` → "Loaded 312 files; ignored 9 that match no missing source" (for release 2 this folder was in the `AICheckout-expansion` worktree).
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
5. **Evan** ticks **I checked the full source terms and all proposed rules and conditions.** himself and publishes (step 6). In this browser flow the attestation is always Evan's tick; in the [agent publish](#agent-publish-cli) it is his chat message.

### Coordinator, after publishing

1. `curl -s https://ai-checkout-api.onrender.com/v1/catalog | head -c 300` shows `"sequence":N` and `"version":"<version>"`; the full body is about 0.6 MB.
2. Build a hosted extension: `npm run build:hosted --workspace=ai-checkout-extension`, load `extension/dist`, choose **Check for updated terms** in the popup, and confirm it finishes without an error and that `checkoutCatalogV1` in `chrome.storage.local` (service worker DevTools: `await chrome.storage.local.get('checkoutCatalogV1')`) holds release sequence N and the published version (for release 2 this closed the open Phase 3 M6 check). The cached release has the bundled catalog's `verifiedAt`, so the cached release is the one in effect (ties go to the cache) and the wallet keeps its inputs.
3. Update [now](../now.md), [hosting](hosting.md#facts) (published catalog row), the [roadmap](../product/roadmap.md), [release history](catalog-release-history.md) (a dated release section) and [log](../log.md).
4. In the next PR, add the published version to `publishedVersions` in `evals/curation/catalog-batches.json` (it lists `2026-10-02.expansion.1` since 2026-10-04 and `2026-10-05.renewal.1` since 2026-10-05; v2's `2026-09-29.real.1` is not built from this config). From then on `npm run catalog:v3` refuses, before writing anything, to build that version with other rule IDs or terms than its entry in `evals/curation/rule-id-ledger.json`, and never rewrites that entry; a changed catalog needs a new `version` ([decision](../decisions/2026-10-04-published-versions-and-proposed-builds.md)).

For release 2 (2026-10-03), step 2 was done without a loaded `build:hosted` extension: the served body was passed through the extension's own `prepareCatalogUpdate` with release 1 cached, which accepted it and put it in effect ([release 2](catalog-release-history.md#release-2-published-2026-10-03)).

## Publishing a pipeline batch

For a catalog built from a Phase 8 pipeline batch, start with `npm run pipeline -- handoff --batch <batch>` in the main checkout, which holds the batch's captures. It prints the PR checklist, the build report summary (version, verifiedAt, expiresAt, rule-ID changes), migrations, the capture folders (one per layer the catalog uses, as absolute paths with file counts; for the [agent publish](#agent-publish-cli) as `--captures` flags of the `pipeline publish` command) and the publish steps, CLI first and the browser steps as the fallback, and exits 1 while the batch is not ready. The review app matches captures against the manifests `apps/review/src/manifest.ts` bundles at build time: the fixed corpora and every `evals/curation/batches/*/manifest.json` (since Phase 9 milestone 1), requiring the capture dated the source's `checkedOn` when one exists, otherwise the newest-dated capture. So the Render deploy of `main` is what makes a new batch's manifest known: the batch must be merged and deployed before Evan publishes (check that Render serves the merge commit in step 1). `handoff` reports review-app readiness against the checkout's manifests and lists any cited source it would not match ([pipeline commands](../system/card-pipeline-commands.md), [decision](../decisions/2026-10-04-review-app-batch-manifests.md)).

A batch that is not to ship yet is built with `npm run pipeline -- run build --batch <batch> --proposed --version <new version>`: the catalog, build report and ledger diff go to the batch's `pipeline/proposed/`, and the build config, ledger, `CATALOG_V3` and the committed build report stay as they are; `handoff` then reports the proposed version and that nothing ships. To ship a batch, plain `run build` registers it and writes the shipping catalog, and needs `--version <new version>` while the config's version is published.

## Renewing a catalog before it expires

Outline since Phase 9 milestone 3 ([plan](../product/phase-9-freshness.md), [pipeline](../system/card-pipeline-internals.md#freshness)); the first full run was milestone 4, which produced `2026-10-05.renewal.1` ([record](catalog-release-history.md#renewal-2026-10-05renewal1-prepared-2026-10-05), including the quote-check folder order).

1. **Re-check.** In the main checkout (it holds every capture since 2026-10-05), on a branch from the latest `main`: `npm run pipeline -- freshness` (no model; re-run the same day to resume). Commit `evals/curation/freshness/<date>.json`. Its summary gives counts per layer and result and the cards with a changed page per issuer.
2. **Refresh changed cards.** Per issuer: `npm run pipeline -- init <issuer-slug>-refresh-<YYYY-MM> --issuer "<Name>" --refresh-from-freshness <date>`, then the `expand-catalog` loop (capture, extract, verify, adjudicate, apply, overlay). Real cards may be among them.
3. **Decide the rest.** Flagged and unreachable sources get no new date: add a capture hint and re-check with `--only`, drop the source in its batch, or hold the card out, each with a reason. Changed merchant MCC pages: re-capture by hand into `evals/curation/real/merchant-captures` with a new dated manifest entry, or drop.
4. **Build** under a new version (`run build --version <new>`): `verifiedAt` is the newest effective date; the builder refuses any cited source older than 30 days before it, naming the sources. Rule IDs of changed terms take new IDs (ledger).
5. **Merge and deploy**, so the review app knows the new batch manifests and freshness records, then `pipeline handoff` and the publish steps above. An unchanged source is matched against the hash the record verified for its date; Evan loads the capture folders `handoff` lists.

## If something is blocked

| What you see | What to do |
| --- | --- |
| `/health` times out | Render is waking the free instance; wait a minute and reload, then sign in again |
| No option for the version under **Start a new draft** | The deployed review app predates M5/M8, or the catalog expired. Coordinator checks the Render deploy of `main` |
| "Your session ended. Sign in again to continue." | The session ended or the token was refused before the upload (the API checks it before reading the body). Reload, sign in, repeat steps 3–4 |
| "This input is too large…", "Some draft fields are invalid…" or "The draft, dates, or captured evidence are not ready to publish…" during capture | Check the hosted migrations include `20261002222425_catalog_v3` (captures up to 250,000 characters, drafts up to 600 sources) and that the file is the manifest's capture. Retrying is safe |
| A capture stops with an unavailable error | Render or Supabase (including Auth, which the API asks to check the token) is down or restarting; wait and retry, nothing is attached until all captures succeed |
| The capture keeps waiting on the rate limit for more than five minutes | Another tab or person is capturing too (the limit is shared per process); stop the other one, then retry |
| Publish fails with a stale revision or head error | Someone saved or published in between: **Reload latest draft**, rebase if asked, review and approve again |
| `/v1/catalog` still shows the previous release after publishing | Reload the review app and check the draft shows **Published**; if so and the endpoint is unchanged after a minute, tell the coordinator; do not publish again |
| It is the catalog's `expiresAt` or later (2026-11-04T00:00Z for `2026-10-05.renewal.1`) | The catalog has expired and cannot be published. A new catalog needs a freshness run and refresh batches ([renewal](#renewing-a-catalog-before-it-expires)) and a rebuild |

## Related

* [Catalog release history](catalog-release-history.md)
* [Hosting](hosting.md)
* [Review app](../system/review-app.md)
* [Catalog expansion](../system/catalog-expansion.md)
* [Database migrations](database-migrations.md)
* [Phase 7 Stage 2 plan](../product/phase-7-stage-2.md)
