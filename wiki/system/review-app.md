---
type: System Component
title: Review app
description: apps/review — the maintainer SPA at /review/ for starting and editing catalog drafts, capturing sources, reviewing extractions and explicitly publishing a release.
status: stable
tags: [system, review, react, maintainer]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-04T22:05:00Z
sources:
  - resource: ../../apps/review/src/client.ts
    title: API and Auth client
  - resource: ../../apps/review/src/StartDraft.tsx
    title: Start a new draft
  - resource: ../../apps/review/src/DraftPanel.tsx
    title: Draft panel
  - resource: ../../apps/review/src/StructuredEditor.tsx
    title: Structured v2/v3 editor
  - resource: ../../apps/review/src/ChangesTable.tsx
    title: Grouped change list
  - resource: ../../apps/review/src/bundled.ts
    title: Bundled catalogs
  - resource: ../../apps/review/src/ExtractionPanel.tsx
    title: Extraction review
  - resource: ../../apps/review/src/manifest.ts
    title: Capture hash check
  - resource: ../../apps/review/README.md
    title: Review app README
  - resource: ../../apps/review/vite.config.ts
    title: Vite config
---

# Review app

`apps/review` (`@ai-checkout/review`) is a React 19 + Vite SPA built with `base: '/review/'` and served by the API on the same origin ([API](api.md)). A provisioned reviewer signs in with Supabase Auth, compares a candidate catalog against the published head, attaches immutable source captures, edits the draft, optionally runs and applies a v1 extraction, and publishes with an explicit, separately confirmed action. The browser holds only the Supabase origin and a publishable key (from `/review/config.json`); every protected call goes through `/v1/review/*` with the user's bearer token. The step-by-step reviewer flow is in [`apps/review/README.md`](../../apps/review/README.md).

Verified 2026-10-02 on branch `s2-m8-review-large-catalog` (Stage 2 M8): `npm test --workspace=@ai-checkout/review` (7 files, 50 tests) and `npm run test:browser --workspace=@ai-checkout/review` on the local stack (7 passed, the portfolio demo skipped), including a synthetic 180-card catalog v3 draft citing 340 sources captured from a folder and published through the UI. Choices: [large catalog decision](../decisions/2026-10-02-review-large-catalog.md). M8 merged with PR #24 and its migration is on hosted; the hosted app serves `main` with `CATALOG_V3` offered first (bundle checked 2026-10-03T01:07Z). Publishing `2026-10-02.expansion.1` from it: [catalog release runbook](../ops/catalog-release.md).

## Facts

| Item | Value | Where |
| --- | --- | --- |
| Entry | [`src/main.tsx`](../../apps/review/src/main.tsx) (error boundary) → [`App.tsx`](../../apps/review/src/App.tsx) | |
| Session | `persistSession: false`, `autoRefreshToken: true`, `detectSessionInUrl: false`: tab memory only, no localStorage/cookies; reload requires sign-in | [`client.ts`](../../apps/review/src/client.ts) |
| Queue | Up to 30 pending drafts; selected draft and run IDs in the URL fragment | `ReviewWorkspace.tsx` |
| Response cap | `MAX_REVIEW_RESPONSE_BYTES` 8 MiB via `readBoundedJson`; the draft review is a summary without capture text (`reviewSummarySchema`; 943,062 bytes for 180 cards and 340 sources), each text is read on demand | `@ai-checkout/catalog-review` |
| Source body | ≤ 250,000 chars per capture (`MAX_SOURCE_BODY_CHARS`); a draft cites ≤ 600 (`MAX_DRAFT_SOURCES`) | `@ai-checkout/catalog-review` |
| Large-catalog thresholds | > 40 changed fields: grouped by card and section with a search; > 12 sources: source search; > 30 missing sources: files or folder only, no paste field each | `ChangesTable.tsx`, `DraftPanel.tsx` |
| CSP | `script-src 'self'; style-src 'self'`, `connect-src 'self' <supabase>`; Zod JIT disabled first thing ([`zod-config.ts`](../../apps/review/src/zod-config.ts)) because the CSP forbids eval | [API](api.md#security-headers) |
| Look | Ocean theme from `@ai-checkout/ui` (since the `ui-ocean-theme` merge, 2026-10-03): navy header with the sky cart icon and white Bricolage name, Bricolage headings, the current queue draft white with a 3 px navy bar; fonts bundled same-origin, so the CSP is unchanged ([decision](../decisions/2026-10-02-ocean-theme.md), [UI library](ui-library.md)) | [`styles.css`](../../apps/review/src/styles.css), `DESIGN.md` |
| Build size note | README records ~552 kB script before compression; Vite's chunk warning is expected | README |

## How it works

| Module | Responsibility |
| --- | --- |
| [`App.tsx`](../../apps/review/src/App.tsx) | Sign-in, sign-out (revokes the session), loads config |
| [`ReviewWorkspace.tsx`](../../apps/review/src/ReviewWorkspace.tsx) | Queue, draft selection, head comparison, layout |
| [`StartDraft.tsx`](../../apps/review/src/StartDraft.tsx), [`bundled.ts`](../../apps/review/src/bundled.ts) | "Start a new draft" from a bundled catalog (`CATALOG_V3`, exported since Stage 2 M5, then `CATALOG_V2`; the newest valid one is selected; refused if expired or not yet valid) or pasted JSON validated by `catalogSchema`; created against the current head after a confirmation dialog |
| [`DraftPanel.tsx`](../../apps/review/src/DraftPanel.tsx) | Source capture ("Capture all missing sources" from `<source id>.txt` files, a whole folder, or paste; one new revision; files whose SHA-256 matches none of the source's manifest hashes are refused), source list with search and captured text loaded on open, JSON editor, publish dialog (focus starts on Cancel) |
| [`StructuredEditor.tsx`](../../apps/review/src/StructuredEditor.tsx) | Editor for schema 2 and 3 drafts: card search, collapsed cards, per-card/per-rule fields; for v3 also programs and point values, brands, questions, card program, rule brand scope, chosen category, shared cap, payment paths, start/end dates; live Zod validation, preview against the published catalog on open |
| [`comparison.ts`](../../apps/review/src/comparison.ts), [`ChangesTable.tsx`](../../apps/review/src/ChangesTable.tsx) | Field-level diff of draft vs published (v1, v2 and v3: programs with valuation basis, publisher and date, brands, questions, acceptance, choices, rule scope); large diffs grouped by card and section with a search |
| [`LazyDisclosure.tsx`](../../apps/review/src/LazyDisclosure.tsx) | Disclosure that renders its content once opened (change sections, rule summaries, full JSON, captured text, v3 sections) |
| [`ExtractionPanel.tsx`](../../apps/review/src/ExtractionPanel.tsx) | Start a v1 extraction, list the latest 20 runs, show facts with exact quotes, conditions, findings, provenance; require a coverage decision and note per condition before applying |
| [`manifest.ts`](../../apps/review/src/manifest.ts) | Compares a loaded capture's SHA-256 with `evals/curation/real/manifest.json`, `merchant-manifest.json`, `evals/curation/expansion/manifest.json` and every pipeline batch's `evals/curation/batches/<batch>/manifest.json` (Vite `import.meta.glob`, eager, at build time) to catch mislabelled or changed files. A source ID keeps every hash those manifests record (one per dated capture): a file matches when its hash is any of them, differs when the ID is known and none matches. A new batch is known to the hosted app only after its merge to `main` and the Render deploy ([decision](../decisions/2026-10-04-review-app-batch-manifests.md)) |
| [`client.ts`](../../apps/review/src/client.ts) | Typed fetches with Zod response parsing (`detail` is the body-free summary, `source` reads one capture); maps API error codes to messages |

Blockers enforced in the UI and again by the API/database: invalid schema, missing evidence, unsaved edits, stale base, expired terms, changed head. Applying an extraction resets publication consent; publication always needs a fresh review of the resulting revision.

## Gotchas

- Reviewer membership is provisioned by the operator in `catalog_private.reviewers`; normal users see nothing and cannot self-enroll ([Database](database.md#authority)).
- The v1 extraction panel is hidden for schema 2 and 3 drafts; v2 extraction into drafts does not exist yet ([Curation harness](curation-harness.md#gotchas)).
- Capturing 340 sources is 340 `POST /v1/review/sources` requests then one draft save; `/sources` allows 200 a minute, and on a 429 the app waits for `Retry-After` (up to 10 times per capture) and retries the same capture, so 340 sources take about two minutes. Captures are idempotent, so a capture run that fails part way can be repeated; nothing is attached until all succeed. The API checks the bearer token before reading a capture or draft body (since Stage 2 M10), so an expired session fails fast with `sign_in_required` instead of after the upload ([API](api.md#facts)).
- A capture folder must hold `<source id>.txt` files exactly as captured (the hash is of the UTF-8 text); other files are skipped and counted.
- The structured editor edits choices, the answers a rule requires, acceptance and new IDs only through the JSON editor.
- Captured text is rendered as inert text, never HTML.
- Hidden controls are UX only; authority is always rechecked by the database.

## Tests

| Layer | Tests |
| --- | --- |
| Unit/component | `apps/review/tests/client.test.ts`, `comparison.test.ts`, `extraction.test.tsx`, `panel.test.tsx`, `start-draft.test.tsx`, `workspace.test.tsx`, `large-catalog.test.tsx` (bundled v3 offer, grouped diff, 340-source folder load with a refused hash, v3 editing); the synthetic catalog is `packages/rewards-core/large-catalog-fixture.ts` |
| Browser, real local stack | `e2e/review.spec.mjs` (access control, evidence, stale approval, publication, memory-only session, sign-out; a 180-card v3 draft with 340 sources captured from a folder, review detail under 8 MiB, published and read back from `/v1/catalog`), `e2e/extraction.spec.mjs` (saved-run recovery, condition decisions, stale application, separate publication) — run in the "Database checks" CI job |
| Browser, mocked API | `e2e/a11y.spec.ts` (axe at 1280 and 390 px, CSP violations, publish dialog focus, start-draft flow, a 180-card v3 draft with grouped changes, source search, bulk capture and the editor with errors) — run in "Application checks" |
| Demo | `e2e/portfolio-demo.spec.mjs`, gated by `PORTFOLIO_DEMO=1` |

## Related

* [API](api.md)
* [Database](database.md)
* [Curation harness](curation-harness.md)
* [UI library](ui-library.md)
* Design notes (design-tool file): [`apps/review/DESIGN.md`](../../apps/review/DESIGN.md)
