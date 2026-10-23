---
type: Runbook
title: Catalog release
description: Publish a bundled catalog as the next hosted release, by the coordinator from the CLI on Evan's chat instruction (pipeline login, publish --confirm, captures from the main checkout) or in the review app as the fallback, then verify /v1/catalog and the extension's refresh; renewing before expiry. Dated release records are on the release history page.
status: stable
tags: [ops, catalog, release, review]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-23T18:12:00Z
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
    title: Catalog release history (dated records)
  - resource: ../../docs/release/publish-runbook.md
    title: Release 1 publish runbook (7 cards)
---

# Catalog release

How a catalog built in the repository becomes the hosted release that `GET /v1/catalog` serves. Publishing needs Evan's approval of that one release: his chat message `publish <version>`, after which the coordinating session publishes from the CLI with a session Evan logged in himself ([agent publish](#agent-publish-cli), [decision](../decisions/2026-10-05-agent-publish-cli-session.md)); no agent signs in or publishes without it ([user directives](../product/user-directives.md)). The fallback is the hosted review app, where Evan publishes and the coordinator may drive the rest of the app in the browser after Evan has signed in ([assisted flow](#assisted-flow-coordinator-drives-the-browser)). The coordinator checks the deploy before and the result after. Which release is served, and when it expires, is on the [release history](catalog-release-history.md) page; release 1's screens are in [`docs/release/publish-runbook.md`](../../docs/release/publish-runbook.md).

## Agent publish (CLI)

The coordinating session (never a subagent) uploads the captures and publishes through the hosted review API with `npm run pipeline -- publish`, on a Supabase session Evan created himself. The agent never sees the password or a token: `login` refuses unless it runs in a terminal, the session file lives outside the repository with mode 600, and no command prints a token. The review API, its validation, rate limits and the database's checks are the same as for the review app.

1. **Evan, once, in his own terminal** (for example the desktop app's terminal panel, or any shell in a checkout with `npm ci` done): `npm run pipeline -- login`. It asks for the reviewer account's email and, without echo, its password, checks reviewer access and saves the session to `~/.config/ai-checkout/review-session.json` (or `$XDG_CONFIG_HOME/ai-checkout/`). Supabase rotates the refresh token on every use and the CLI saves the new one; the session lasts until it is revoked or unused past Supabase's refresh-token lifetime. `npm run pipeline -- logout` revokes it and deletes the file.
2. **Coordinator, ready check:** `npm run pipeline -- whoami --check` (email, API, saved time; refreshes and confirms reviewer access).
3. **Coordinator, dry run** in the main checkout at `origin/main` (clean, the merged and deployed `main` whose review app bundles the manifests): `npm run pipeline -- publish --version <version>`. Without `--captures` it reads the capture folder next to every bundled manifest that lists a cited source, which is every folder (see [capture folders](#capture-folders)); `--captures <folder> …` (repeatable, any order) replaces that default, for example to publish from another checkout. It sends no POST or PUT to the API. It prints `CATALOG_V3`'s canonical JSON SHA-256, git state, per folder the `.txt` files and how many it used, `N of N sources match`, the review note, the session, the review head and any pending draft of the version, and what `/v1/catalog` serves. It exits 1 listing every missing or differing capture, a version that is not `CATALOG_V3`'s or an expired catalog; git problems are reported as "would refuse with --confirm". `--offline` skips every network call (git fetch included) to check only the captures.
4. **Evan types `publish <version>` in chat.** That message, for that one version, is the attestation. It does not carry over to another version.
5. **Coordinator, publish:** the same command plus `--confirm <version> --instruction-at <UTC time of Evan's message, e.g. 2026-10-20T15:04:00Z>`. It refuses before sending anything when `--confirm` differs from `--version`, the instruction time is in the future (5 minutes of skew allowed) or older than 7 days, HEAD is not `origin/main` after `git fetch`, `packages/rewards-core`, `evals/curation` or `apps/review/src/manifest.ts` have local changes, or any check of the dry run fails. Then it resumes the newest pending draft of the version (or creates one on the current head), refuses if that draft's catalog is not canonically `CATALOG_V3` (someone edited it) or its base is not the head (it never rebases), uploads only the captures not already attached with the local hash (429s are waited out with `Retry-After`; identical captures are deduplicated, so a re-run is safe), saves the draft with exactly one matching capture per source, re-reads and verifies it, publishes with the review note and checks `/v1/catalog`. The note says the catalog is agent-verified, not human-verified, what was checked and "Published by the coding agent on Evan's chat instruction of `<time>`".
6. **After publishing:** the steps under [coordinator, after publishing](#coordinator-after-publishing), including `publishedVersions` in the next PR.

If a run stops part way (network, Render restart, rate limit), run the same `--confirm` command again: it resumes the draft and skips captures already attached. An error prints the HTTP status and the API's code only. "session expired or revoked" (exit 2) means Evan runs `login` again.

## Merchant release (Phase 14.6)

The merchant database ([plan](../product/phase-14-merchant-database.md)) is its own hosted release (`GET /v1/merchants`), published whole from the bundled `MERCHANTS_V1` with `npm run pipeline -- merchants publish`; there are no drafts, captures or a review-app page ([decision](../decisions/2026-10-11-hosted-merchant-release-details.md), [database](../system/database.md#merchant-publication-phase-146)). Evan's attestation is the chat message `publish merchants <version>`, for that one version.

1. **Coordinator, dry run** in the main checkout at `origin/main`: `npm run pipeline -- merchants publish --version <version>`. It prints `MERCHANTS_V1`'s canonical JSON SHA-256, record and source counts, git state, the review note, the session and what `/v1/merchants` serves (and whether the version is already published or the served release is verified later). It exits 1 for a version that is not `MERCHANTS_V1`'s or a release verified in the future; git problems are "would refuse with --confirm". `--offline` skips every network call.
2. **Evan types `publish merchants <version>` in chat.**
3. **Coordinator, publish:** the same command plus `--confirm <version> --instruction-at <UTC time of Evan's message>`. It refuses before sending anything when `--confirm` differs from `--version`, the instruction time is in the future (5 minutes of skew) or older than 7 days, HEAD is not `origin/main` after `git fetch`, or `packages/rewards-core`, `evals/merchants/db/records`, `release-config.json`, `release.json`, the builder scripts or `tools/catalog-pipeline` have local changes. Then it reads `/v1/merchants` for the head (sequence and `release_hash`; an error, 503 included, refuses, since the head is unknown), returns 0 without sending when the same version with identical content is already served, refuses the same version with other content, posts the release with that expected head and the agent-verified note to `POST /v1/review/merchants/publish`, checks the stored release equals `MERCHANTS_V1` and that `/v1/merchants` serves it. A 409 means the head moved or the version exists with other content; run the dry run again. An error prints the HTTP status and the API's code only.
4. **After publishing:** record the release in [release history](catalog-release-history.md), update [now](../now.md); the bundled snapshot is already the published one (the extension keeps the newer `verifiedAt` in effect). A loaded `build:hosted` extension picks it up on "Check for updated terms" or the weekly alarm.

## Capture folders

Captures are gitignored copyrighted text and exist only on Evan's machine. **The main checkout (`~/Projects/AICheckout`) holds every capture**, so `publish`, `handoff`, `freshness`, the quote check and the pipeline subagents run from the main checkout.

| Folder (under `evals/curation/`) | Contents |
| --- | --- |
| `batches/<batch>/captures` | 11 folders: `wells-fargo-2026-10` and the ten `*-refresh-2026-10` batches |
| `expansion/captures` | 321 files (frozen `expansion.v1`); also `expansion/extractions` (180 traces) |
| `real/captures`, `real/merchant-captures` | 15 real-card pages and 2 merchant MCC pages |
| `runs/` | eval run outputs copied from `AICheckout-expansion` |

`npm run pipeline -- publish --version <version> --offline` with no `--captures` flag checks that the main checkout has every cited capture. The worktrees `AICheckout-p8-wf` and `AICheckout-expansion` hold backup copies until Evan agrees to remove them.

## Steps

### Coordinator, before Evan starts

1. `curl -s https://ai-checkout-api.onrender.com/health` returns `{"status":"ok"}` (the free instance may take about a minute to wake).
2. `curl -s https://ai-checkout-api.onrender.com/v1/catalog | head -c 200` returns the head release (see the [release history](catalog-release-history.md)), not a 503.
3. Render's latest deploy is the current `main` commit (Render dashboard, or the review bundle at `/review/` contains the version to publish).
4. `npx supabase migration list --linked` shows every migration in the Remote column ([database migrations](database-migrations.md); needs the linked project; Evan or the authorized coordinator).

### Evan, in the hosted review app

The fallback when the [agent publish](#agent-publish-cli) cannot be used. Take the version, card and source counts, expiry and capture folders from `npm run pipeline -- handoff` (all folders are in the main checkout, see [capture folders](#capture-folders)). Evan can do every step himself, or use the [assisted flow](#assisted-flow-coordinator-drives-the-browser). Capture folders are gitignored copyrighted text; never commit or upload them anywhere else. The session lives in the tab's memory: reloading signs you out (saved revisions and captures are kept).

1. **Sign in** at https://ai-checkout-api.onrender.com/review/ with the reviewer account.
2. **Start a new draft.** Choose **Start a new draft**, select **Bundled catalog `<version>`**. Check the summary: schema, card and source counts, verified and expiry dates, status **Valid now**. Choose **Create draft**, then **Create the draft** in the dialog. The draft opens with every source missing. Nothing is published.
   - If **Create draft** errors, do not create another at once: reload, sign in, and open the pending `<version>` draft if it exists.
3. **Load the captures.** Open **Capture all missing sources** and use **Load a capture folder** once per folder `handoff` lists (for example `~/Projects/AICheckout/evals/curation/real/captures`, `real/merchant-captures`, `expansion/captures` and each `batches/<batch>/captures`); each load adds to the texts already loaded and reports how many files it loaded and ignored.
   - Each note says how many files match a corpus manifest. If any file is **refused** because its SHA-256 differs from the manifest, stop: it is the wrong file or the page was re-captured. Captures are never re-taken to fit ([user directives](../product/user-directives.md)).
4. **Capture.** The button reads **Capture N of N missing sources and attach**. Choose it and keep the tab open. Past 200 requests a minute the status line shows "waiting N s for the capture rate limit…"; that is expected. Wait for "Captured N sources and attached them to a new draft revision."
   - If it stops part way (network, sign-in expired, Render restart), nothing is attached yet. Reload, sign in, open the draft, load the folders again and capture again: identical captures are deduplicated by the database, so a retry is safe.
5. **Review.** **What changes** compares the draft with the head release. Use the card search and the grouped diff. Spot-check against the captured text, at least:
   - the cards of the [golden ladders](../../extension/tests/catalog-v3-golden.test.ts) at Amazon, Best Buy and Newegg (Prime Visa, Amazon Store Card, My Best Buy Visa, Newegg store card, Cash+, Customized Cash);
   - program values: published estimates name their publisher and retrieval date; issuer-stated values cite a capture; programs valued `none` show no value;
   - rotating rules (Freedom Flex, Discover) carry their quarter's dates.
   Labels and overlay are agent-verified, not human-verified; say what you checked in the note. Fix errors under **Correct draft data**; every save is a new revision that needs fresh approval.
6. **Approve and publish** before the catalog's `expiresAt`: tick **I checked the full source terms and all proposed rules and conditions.**, write a **Review note** (at least 10 characters, what you checked), choose **Publish reviewed terms**, check version, revision, card and source counts and the expiry in the dialog, then **Publish release**. Note the release number N.

### Assisted flow: coordinator drives the browser

The coordinating session (never a subagent) works the hosted review app in the browser pane on Evan's request:

1. **Evan** opens the review app and signs in; the agent never types the password.
2. **Coordinator** starts the draft (step 2) and opens **Capture all missing sources**.
3. **Evan** selects the capture folders in the file picker (step 3); the coordinator runs the capture (step 4) and checks every source reads "Matching evidence captured".
4. **Coordinator** reviews (step 5) and verifies the draft against the catalog on `main` (canonical JSON SHA-256 of the draft equals `CATALOG_V3`'s), then writes the **Review note**, saying the catalog is agent-verified, not human-verified, and what was checked.
5. **Evan** ticks **I checked the full source terms and all proposed rules and conditions.** himself and publishes (step 6). In this browser flow the attestation is always Evan's tick; in the [agent publish](#agent-publish-cli) it is his chat message.

### Coordinator, after publishing

1. `curl -s https://ai-checkout-api.onrender.com/v1/catalog | head -c 300` shows `"sequence":N` and `"version":"<version>"`; the full body is about 0.6 MB.
2. Build a hosted extension: `npm run build:hosted --workspace=ai-checkout-extension`, load `extension/dist`, choose **Check for updated terms** in the popup, and confirm it finishes without an error and that `checkoutCatalogV1` in `chrome.storage.local` (service worker DevTools: `await chrome.storage.local.get('checkoutCatalogV1')`) holds release sequence N and the published version. The cached release has the bundled catalog's `verifiedAt`, so the cached release is the one in effect (ties go to the cache) and the wallet keeps its inputs.
3. Update [now](../now.md), the [roadmap](../product/roadmap.md), [release history](catalog-release-history.md) (a dated release section) and [log](../log.md).
4. In the next PR, add the published version to `publishedVersions` in `evals/curation/catalog-batches.json` (v2's `2026-09-29.real.1` is not built from this config). From then on `npm run catalog:v3` refuses, before writing anything, to build that version with other rule IDs or terms than its entry in `evals/curation/rule-id-ledger.json`, and never rewrites that entry; a changed catalog needs a new `version` ([decision](../decisions/2026-10-04-published-versions-and-proposed-builds.md)).

## Publishing a pipeline batch

For a catalog built from a Phase 8 pipeline batch, start with `npm run pipeline -- handoff --batch <batch>` in the main checkout, which holds the batch's captures. It prints the PR checklist, the build report summary (version, verifiedAt, expiresAt, rule-ID changes), migrations, the capture folders (one per layer the catalog uses, as absolute paths with file counts; for the [agent publish](#agent-publish-cli) as `--captures` flags of the `pipeline publish` command) and the publish steps, CLI first and the browser steps as the fallback, and exits 1 while the batch is not ready. The review app matches captures against the manifests `apps/review/src/manifest.ts` bundles at build time: the fixed corpora and every `evals/curation/batches/*/manifest.json`, requiring the capture dated the source's `checkedOn` when one exists, otherwise the newest-dated capture. So the Render deploy of `main` is what makes a new batch's manifest known: the batch must be merged and deployed before Evan publishes (check that Render serves the merge commit in step 1). `handoff` reports review-app readiness against the checkout's manifests and lists any cited source it would not match ([pipeline commands](../system/card-pipeline-commands.md), [decision](../decisions/2026-10-04-review-app-batch-manifests.md)).

A batch that is not to ship yet is built with `npm run pipeline -- run build --batch <batch> --proposed --version <new version>`: the catalog, build report and ledger diff go to the batch's `pipeline/proposed/`, and the build config, ledger, `CATALOG_V3` and the committed build report stay as they are; `handoff` then reports the proposed version and that nothing ships. To ship a batch, plain `run build` registers it and writes the shipping catalog, and needs `--version <new version>` while the config's version is published.

## Renewing a catalog before it expires

[Plan](../product/phase-9-freshness.md), [pipeline](../system/card-pipeline-internals.md#freshness); a worked example, including the quote-check folder order, is the [`2026-10-05.renewal.1` record](catalog-release-history.md#renewal-2026-10-05renewal1-prepared-2026-10-05).

1. **Re-check.** In the main checkout, on a branch from the latest `main`: `npm run pipeline -- freshness` (no model; re-run the same day to resume). Commit `evals/curation/freshness/<date>.json`. Its summary gives counts per layer and result and the cards with a changed page per issuer.
2. **Refresh changed cards.** Per issuer: `npm run pipeline -- init <issuer-slug>-refresh-<YYYY-MM> --issuer "<Name>" --refresh-from-freshness <date>`, then the `expand-catalog` loop (capture, extract, verify, adjudicate, apply, overlay). Real cards may be among them.
3. **Decide the rest.** Flagged and unreachable sources get no new date: add a capture hint and re-check with `--only`, drop the source in its batch, or hold the card out, each with a reason. Changed merchant MCC pages: re-capture by hand into `evals/curation/real/merchant-captures` with a new dated manifest entry, or drop.
4. **Build** under a new version (`run build --version <new>`): `verifiedAt` is the newest effective date; the builder refuses any cited source older than 30 days before it, naming the sources. Rule IDs of changed terms take new IDs (ledger).
5. **Merge and deploy**, so the review app knows the new batch manifests and freshness records, then `pipeline handoff` and the publish steps above. An unchanged source is matched against the hash the record verified for its date; Evan loads the capture folders `handoff` lists.

## If something is blocked

| What you see | What to do |
| --- | --- |
| `/health` times out | Render is waking the free instance; wait a minute and reload, then sign in again |
| No option for the version under **Start a new draft** | The deployed review app predates the catalog's merge, or the catalog expired. Coordinator checks the Render deploy of `main` |
| "Your session ended. Sign in again to continue." | The session ended or the token was refused before the upload (the API checks it before reading the body). Reload, sign in, repeat steps 3–4 |
| "This input is too large…", "Some draft fields are invalid…" or "The draft, dates, or captured evidence are not ready to publish…" during capture | Check the hosted migrations include `20261002222425_catalog_v3` (captures up to 250,000 characters, drafts up to 600 sources) and that the file is the manifest's capture. Retrying is safe |
| A capture stops with an unavailable error | Render or Supabase (including Auth, which the API asks to check the token) is down or restarting; wait and retry, nothing is attached until all captures succeed |
| The capture keeps waiting on the rate limit for more than five minutes | Another tab or person is capturing too (the limit is shared per process); stop the other one, then retry |
| Publish fails with a stale revision or head error | Someone saved or published in between: **Reload latest draft**, rebase if asked, review and approve again |
| `/v1/catalog` still shows the previous release after publishing | Reload the review app and check the draft shows **Published**; if so and the endpoint is unchanged after a minute, tell the coordinator; do not publish again |
| It is the catalog's `expiresAt` or later (the served release's is on the [release history](catalog-release-history.md)) | The catalog has expired and cannot be published. A new catalog needs a freshness run and refresh batches ([renewal](#renewing-a-catalog-before-it-expires)) and a rebuild |

## Related

* [Catalog release history](catalog-release-history.md)
* [Hosting](hosting.md)
* [Review app](../system/review-app.md)
* [Card-expansion pipeline](../system/card-expansion-pipeline.md)
* [Database migrations](database-migrations.md)
* [Phase 7 Stage 2 plan](../product/phase-7-stage-2.md)
