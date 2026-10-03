# Catalog review

React 19, TypeScript, Vite, Supabase Auth, and the shared Zod review/catalog contracts. This maintainer interface compares a candidate with the current published catalog, displays immutable source text, accepts corrections and source captures, and requires explicit human approval of the exact revision. It is implemented and verified locally. Extraction review and audited application are also implemented. The complete local flow uses intercepted synthetic model responses; live model quality and hosted deployment remain unverified.

## Run

From the repository root with Node 24 and the local Supabase stack:

```sh
npm ci
npm run db:start:api
npm run build --workspace=@ai-checkout/api
npm run build --workspace=@ai-checkout/review
node --env-file=apps/api/.env apps/api/dist/index.js
```

Configure `apps/api/.env` from its example with the local Supabase URL, the CLI's modern `sb_publishable_` key, and `REVIEW_DIST_DIR=apps/review/dist`. Open `http://127.0.0.1:3000/review/`. The compiled Node server serves both the app and protected API on the same origin. No provider secret, service-role key, database-owner credential, or Vite environment secret belongs in the browser.

An existing Supabase email/password account must have an operator-provisioned row in `catalog_private.reviewers`. Normal authenticated users cannot self-enroll or see drafts. Do not provision reviewer membership from user metadata or a public endpoint. The test below creates disposable local accounts automatically without sending email; it does not configure a production reviewer.

## Review behavior

1. Sign in and choose a pending draft. The queue shows up to 30 candidates. A fragment URL identifies the selected draft without carrying credentials. With no pending drafts, **Start a new draft** opens (it is also available under the queue): start from a catalog bundled with the app (the 178-card catalog v3 `CATALOG_V3` first, then `CATALOG_V2`; version, schema, card count and validity are shown; an expired or not-yet-valid catalog is refused) or from pasted catalog JSON validated by the shared schema. After a confirmation dialog the draft is created against the current published head, with no sources attached yet, and opens. The hosted procedure for release 1 is in [the publish runbook](../../docs/release/publish-runbook.md); for `2026-10-02.expansion.1` (328 sources, captured with **Load a capture folder**) it is the [catalog release runbook](../../wiki/ops/catalog-release.md).
2. Compare changed fields and inspect all proposed rules, including unchanged conditions. More than 40 changed fields are grouped into collapsed sections (one per card, plus catalog, merchants, programs, brands, questions and sources) with a search. Source metadata is listed beside the comparison (searchable when long); each captured text is loaded from the API when its section is opened. Captured text is inert text, not rendered HTML.
3. Capture missing issuer terms using their declared source/date. **Capture all missing sources** does it in one step: load the saved capture files (named `<source id>.txt`) or a whole capture folder (for example `evals/curation/real/captures`, `evals/curation/real/merchant-captures` and `evals/curation/expansion/captures`; each load adds to what is already loaded), or paste each source's text when 30 or fewer are missing, then one submit captures every loaded source and attaches them all in a single new draft revision (up to 250,000 characters per source). A loaded file whose SHA-256 differs from the real, merchant or expansion corpus manifest is refused; pasted text that differs is flagged. Capture does not silently redate expired terms. A matching capture establishes provenance, not correctness; the reviewer must inspect eligibility, rates, caps, activation, and exclusions.
4. Correct the catalog and save a new revision: schema 2 and 3 drafts have a structured **Cards and rules** editor (searchable, collapsed cards; per-card and per-rule fields, for schema 3 also programs and point values, brands, questions, card program, rule brand scope, chosen category, shared cap, payment paths and start/end dates; validated live by the shared schema, with a preview against the published catalog) beside the JSON editor; schema 1 drafts use the JSON editor. Invalid schemas, missing evidence, unsaved edits, stale bases, and expired terms block approval. A changed published head requires rebasing and another review.
5. Confirm that all terms were checked, write a review note, and choose **Publish reviewed terms**; a confirmation dialog (focus starts on **Cancel**) restates the revision and only **Publish release** publishes. The API/database bind approval to revision, payload hash, and head. A stale response requires reload; acknowledgements and notes reset after reload. Publication remains an explicit human action.

Sessions are held only in tab memory: no localStorage, sessionStorage, or application cookies. Reloading requires sign-in again. Sign out revokes the current Supabase session and clears the private view; a failed sign-out reports that revocation was not confirmed. The database rechecks membership and live session authority on every protected operation. The UI does not supply publication authority by hiding controls.

Initial candidates are created through the protected API or local unapproved seed. Extraction updates an existing saved pilot-card draft; it does not discover new card products or create arbitrary reward rules. Expired published snapshots remain visible for review comparison only. The public catalog endpoint rejects expired terms.

## Extraction review

1. Save draft/source edits, then explicitly choose **Extract captured terms**. The server must have an enabled provider profile and policy; normal startup is disabled and the authorized spending budget remains $0. Do not enable live calls merely to try the screen.
2. Inspect the saved outcome, each field and exact quotation, all conditions/issues, full original captures, and run provenance/accounting. `evidence_valid` means mechanical checks passed, not that the interpretation is correct. Unknown/conflicting facts, unsupported conditions, invalid evidence, incomplete runs, and changed draft revisions block application.
3. For every condition, identify existing rules that cover it and write an explanation of at least 10 characters. If a condition is not representable, application stays blocked. Correct the source or maintain a valid draft manually; do not omit the condition to make the extraction fit.
4. Review the proposed rate/activation/cap changes, write an overall note of at least 10 characters, and confirm the evidence review. Nearby requirements explain disabled controls. Applying records those decisions and creates one draft revision; it preserves catalog dates, source metadata, other cards, and rule identities. Human coverage decisions are attestations, not automated semantic proofs.
5. Inspect the saved draft and separately approve publication. Applying an extraction resets previous publication consent. A stale application requires reload and a new review; exact retries acknowledge the same application only while its result remains current.

The screen lists the latest 20 saved runs for a draft. Selecting a run adds its ID to the fragment URL; reloading requires sign-in but restores the saved result without another model request. A failed request retains its retry key in tab memory. After reload, inspect the saved-run list before deliberately starting another extraction. Running/uncertain records follow the [operator recovery procedure](../../supabase/CURATION.md); refreshing does not replay them. Recorded application decisions remain inspectable.

## Verification

```sh
npm run test --workspace=@ai-checkout/review
npx playwright install chromium
npm run test:browser --workspace=@ai-checkout/review
```

Build both apps and start the local Auth/Data API stack first. Nineteen unit/component checks cover evidence, differences, publication blockers, explicit approval, hostile text, private-error handling, and cancelled sessions. Each of the two browser tests starts an owned compiled Node process on an ephemeral loopback port and serves the built review app. It creates clearly synthetic local reviewer/ordinary accounts, captures evidence, rejects a stale approval, resets consent after reload, publishes through the UI, verifies no browser credential persistence, and confirms sign-out immediately removes review authority. The extraction flow additionally verifies saved-run recovery, required condition decisions/notes, stale application rejection, unchanged publication until fresh consent, and separate publication. It uses the real SDK with fixed synthetic responses and blocked external traffic. The large-catalog test creates a synthetic 180-card catalog v3 draft citing 340 sources, captures them all from a folder through the UI (one of 250,000 multibyte characters), checks that the review detail stays under the 8 MiB response cap, publishes it and reads it back from `/v1/catalog`. Desktop and 390px screenshots are produced in ignored `test-results/`. The test cleans up its process/accounts/records and restores the previous public head.

Database CI builds and runs this browser flow alongside SQL, concurrency, contract-parity, and signed HTTP checks. Remote CI has not run these changes yet. No model accuracy, hosted security, or store-readiness claim follows from the local synthetic tests.

The [captioned portfolio recording](../../docs/release/assets/full-stack-demo.md) shows this same built app and compiled API against local Auth/PostgreSQL, with visibly labeled invented terms and intercepted SDK responses. Run `npm run release:portfolio` from the root to rebuild, record and verify it; this additionally requires ffmpeg/ffprobe and the existing disposable local stack. Its separate browser test is gated by `PORTFOLIO_DEMO=1` and skipped in the ordinary suite. Cleanup verifies the disposable users/records are removed and the prior catalog head and curation policy are restored.

The current built review script is about 552 kB before compression (158 kB gzip), including React, strict validation, and Supabase Auth. Vite's default chunk-size warning remains visible. This is a maintainer app; load-time optimization is a follow-up measurement, not a release-blocking failure by itself.

## Accessibility and CSP check

`npm run build --workspace=@ai-checkout/review && npm run test:browser --workspace=@ai-checkout/review -- e2e/a11y.spec.ts` serves the production build with the API's exact security headers, mocks sign-in and the review API (no database needed), and runs axe (WCAG 2.0/2.1 A and AA) on sign-in, the queue with a draft diff, the structured editor, the publish confirmation and a 180-card catalog v3 draft at 1280 and 390 px. It fails on any CSP violation.
