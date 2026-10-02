---
type: System Component
title: Review app
description: apps/review — the maintainer SPA at /review/ for starting and editing catalog drafts, capturing sources, reviewing extractions and explicitly publishing a release.
status: stable
tags: [system, review, react, maintainer]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
sources:
  - resource: ../../apps/review/src/client.ts
    title: API and Auth client
  - resource: ../../apps/review/src/StartDraft.tsx
    title: Start a new draft
  - resource: ../../apps/review/src/DraftPanel.tsx
    title: Draft panel
  - resource: ../../apps/review/src/StructuredEditor.tsx
    title: Structured v2 editor
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

Verified 2026-10-02 by reading the code and running `npm test --workspace=@ai-checkout/review` (6 files, 41 tests, passing). Browser specs not run.

## Facts

| Item | Value | Where |
| --- | --- | --- |
| Entry | [`src/main.tsx`](../../apps/review/src/main.tsx) (error boundary) → [`App.tsx`](../../apps/review/src/App.tsx) | |
| Session | `persistSession: false`, `autoRefreshToken: true`, `detectSessionInUrl: false`: tab memory only, no localStorage/cookies; reload requires sign-in | [`client.ts`](../../apps/review/src/client.ts) |
| Queue | Up to 30 pending drafts; selected draft and run IDs in the URL fragment | `ReviewWorkspace.tsx` |
| Response cap | `MAX_REVIEW_RESPONSE_BYTES` 8 MiB via `readBoundedJson` | `@ai-checkout/catalog-review` |
| Source body | ≤ 120,000 chars per capture (`MAX_SOURCE_BODY_CHARS`) | `@ai-checkout/catalog-review` |
| CSP | `script-src 'self'; style-src 'self'`, `connect-src 'self' <supabase>`; Zod JIT disabled first thing ([`zod-config.ts`](../../apps/review/src/zod-config.ts)) because the CSP forbids eval | [API](api.md#security-headers) |
| Build size note | README records ~552 kB script before compression; Vite's chunk warning is expected | README |

## How it works

| Module | Responsibility |
| --- | --- |
| [`App.tsx`](../../apps/review/src/App.tsx) | Sign-in, sign-out (revokes the session), loads config |
| [`ReviewWorkspace.tsx`](../../apps/review/src/ReviewWorkspace.tsx) | Queue, draft selection, head comparison, layout |
| [`StartDraft.tsx`](../../apps/review/src/StartDraft.tsx) | "Start a new draft" from bundled `CATALOG_V2` (refused if expired or not yet valid) or pasted JSON validated by `catalogSchema`; created against the current head after a confirmation dialog |
| [`DraftPanel.tsx`](../../apps/review/src/DraftPanel.tsx) | Source capture ("Capture all missing sources" from `<source id>.txt` files or paste, one new revision), JSON editor, publish dialog (focus starts on Cancel) |
| [`StructuredEditor.tsx`](../../apps/review/src/StructuredEditor.tsx) | Per-card/per-rule editor for schema 2 drafts, live Zod validation, preview against the published catalog |
| [`comparison.ts`](../../apps/review/src/comparison.ts), [`ChangesTable.tsx`](../../apps/review/src/ChangesTable.tsx) | Field-level diff of draft vs published (v1 and v2 rules) |
| [`ExtractionPanel.tsx`](../../apps/review/src/ExtractionPanel.tsx) | Start a v1 extraction, list the latest 20 runs, show facts with exact quotes, conditions, findings, provenance; require a coverage decision and note per condition before applying |
| [`manifest.ts`](../../apps/review/src/manifest.ts) | Compares a loaded capture's SHA-256 with `evals/curation/real/manifest.json` and `merchant-manifest.json` to catch mislabelled files |
| [`client.ts`](../../apps/review/src/client.ts) | Typed fetches with Zod response parsing; maps API error codes to messages |

Blockers enforced in the UI and again by the API/database: invalid schema, missing evidence, unsaved edits, stale base, expired terms, changed head. Applying an extraction resets publication consent; publication always needs a fresh review of the resulting revision.

## Gotchas

- Reviewer membership is provisioned by the operator in `catalog_private.reviewers`; normal users see nothing and cannot self-enroll ([Database](database.md#authority)).
- The v1 extraction panel is hidden for schema 2 drafts; v2 extraction into drafts does not exist yet ([Curation harness](curation-harness.md#gotchas)).
- Captured text is rendered as inert text, never HTML.
- Hidden controls are UX only; authority is always rechecked by the database.

## Tests

| Layer | Tests |
| --- | --- |
| Unit/component | `apps/review/tests/client.test.ts`, `comparison.test.ts`, `extraction.test.tsx`, `panel.test.tsx`, `start-draft.test.tsx`, `workspace.test.tsx` |
| Browser, real local stack | `e2e/review.spec.mjs` (access control, evidence, stale approval, publication, memory-only session, sign-out), `e2e/extraction.spec.mjs` (saved-run recovery, condition decisions, stale application, separate publication) — run in the "Database checks" CI job |
| Browser, mocked API | `e2e/a11y.spec.ts` (axe at 1280 and 390 px, CSP violations, publish dialog focus, start-draft flow) — run in "Application checks" |
| Demo | `e2e/portfolio-demo.spec.mjs`, gated by `PORTFOLIO_DEMO=1` |

## Related

* [API](api.md)
* [Database](database.md)
* [Curation harness](curation-harness.md)
* [UI library](ui-library.md)
* Design notes (design-tool file): [`apps/review/DESIGN.md`](../../apps/review/DESIGN.md)
