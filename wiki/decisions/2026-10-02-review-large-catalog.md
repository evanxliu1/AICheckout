---
type: Decision
title: Reviewing and publishing a large catalog (Stage 2 M8)
description: Choices made so the review app and API handle a 180-card catalog v3 draft citing about 340 sources — a body-free review summary plus a per-source read, request limits derived from the content limits, a per-route capture rate limit, refusing capture files that differ from the corpus manifests, grouped diffs and searchable editors, and finding bundled catalogs by export name.
status: accepted
tags: [decision, review, api, database, catalog, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T23:59:00Z
sources:
  - resource: ../../supabase/migrations/20261002230334_review_summary.sql
    title: get_catalog_review_summary and get_catalog_review_source
  - resource: ../../packages/catalog-review/src/index.ts
    title: reviewSummarySchema and request limits
  - resource: ../../apps/api/src/review-routes.ts
    title: Review routes
  - resource: ../../apps/review/src/DraftPanel.tsx
    title: Bulk capture and source evidence
  - resource: ../../apps/review/src/bundled.ts
    title: Bundled catalogs
---

# Reviewing and publishing a large catalog (Stage 2 M8) (2026-10-02)

## Context
The [Stage 2 plan](../product/phase-7-stage-2.md) M8 makes the review app and API ready for the 180-card catalog v3 that Evan publishes in M10. The [M1 contract details](2026-10-02-catalog-v3-contract-details.md) left these limits behind: `get_catalog_review` returns every attached capture with its text (the expansion captures alone are 6.4 million characters, so 340 of them exceed the 8 MiB review response cap); the API draft body limit was 270,336 bytes and `/sources` 524,288 bytes (a 250,000-character capture with multibyte text can be 750 KB); `/v1/catalog` read the head row with a 264 KiB cap; and the app showed only a v3 card's program.

## Options considered
| Question | Chosen | Alternative and why not |
| --- | --- | --- |
| Review detail size | New RPC `get_catalog_review_summary` (source metadata plus `body_chars`, no text) for `GET /v1/review/drafts/:id`; `get_catalog_review_source(draft, source)` returns one capture attached to that draft, for `GET /v1/review/drafts/:id/sources/:sourceId`. `get_catalog_review` is unchanged and still used by the extraction routes (at most three documents, schema 1 drafts) | Paging bodies inside one response still loads megabytes for a reviewer who reads a few; changing `get_catalog_review` in place would break the extraction routes and an applied migration's contract |
| Capture request limit | `MAX_CAPTURE_REQUEST_BYTES` = 250,000 × 6 + 16 KiB (1,516,384): `JSON.stringify` writes any UTF-16 unit in at most 6 bytes | A UTF-8 bound (3 bytes per unit) fails for text with control characters, which JSON escapes as `\u00XX` |
| Draft request limit | `MAX_DRAFT_REQUEST_BYTES` = `CATALOG_V3_LIMITS.bytes` + 64 KiB (1,114,112): the catalog is limited in `JSON.stringify` bytes, which is how the app sends it, plus 600 source IDs | A fixed round number would drift from the contract limit |
| Capturing 340 sources | `/sources` has its own rate limit of 200 requests a minute (`MAX_CAPTURES_PER_MINUTE`); the app waits for `Retry-After` and retries on 429, so 340 sources take about two minutes; every other review route keeps 60. Revised in pre-merge review from 600/min: each request may carry 1.5 MB and the limit applies before the database verifies the token (keyed per socket IP, which behind Render's proxy is shared), so 600/min let any caller push ~15 MB/s through the API to PostgREST | A batch capture endpoint needs a new RPC and a multi-megabyte body; 60/min would take six minutes per catalog; a per-user key would come from an unverified token and could be rotated to evade the limit |
| Capture file integrity | Bulk loads (files or a folder via `webkitdirectory`) compute SHA-256 in the browser and **refuse** a file whose hash differs from the real, merchant or expansion manifest; files with no manifest entry load and are counted; pasted text that differs is only flagged, as before | Warning only would let one mislabelled file among 340 slip through unnoticed |
| `/v1/catalog` read cap | `MAX_CATALOG_READ_BYTES` = 2 × `CATALOG_V3_LIMITS.bytes` for the Data API row (JSONB text adds a space after every `:` and `,`); `publishedReleaseSchema` still enforces the 1 MiB catalog limit | Raising `MAX_CATALOG_BYTES` (the v1/v2 limit and the extension's response cap) belongs to M6 |
| Large diffs | Over 40 changed fields: one collapsed section per card plus catalog, merchants, programs, brands, questions and sources, with a search; a section's table renders when opened. Rule summaries, the full JSON and captured texts also render on open | One table of ~22,000 rows (a new 180-card catalog) is unusable and slow |
| Editing v3 | The structured editor edits scalar v3 fields (program name, unit, value, publisher, URL, read date; brand names; question and answer labels; card program and stated value; rule brand scope and exclusions as ID lists, shared cap ID, chosen category, required payment paths, start and end dates). Choices, the answers a rule requires, acceptance and new IDs are shown and edited in JSON | Structural editors for choices and gates are a large UI for edits M4/M5 make in the overlay, not in review |
| Bundled catalogs | `bundledCatalogs()` looks up the exports `CATALOG_V3` then `CATALOG_V2` of `@ai-checkout/rewards-core` and keeps those that parse; `StartDraft` lists them newest first and selects the newest valid one | A static `import { CATALOG_V3 }` fails to build until M5 adds the export |

## Decision
As in the "Chosen" column, in migration `20261002230334_review_summary` and the API, `@ai-checkout/catalog-review` and review app changes on branch `s2-m8-review-large-catalog`.

## Consequences
- Measured on the local stack (2026-10-02): a synthetic 180-card, 340-source v3 draft (793 KB) captured from a folder, reviewed and published through the UI; the review detail was 943,062 bytes, `/v1/catalog` served 793,160 bytes.
- The extraction routes still read every capture of a draft through `get_catalog_review`; for a v3 draft they are not offered (extraction is schema 1 only), but the call would exceed the response cap if they were.
- M5 only needs to export `CATALOG_V3`; the review app offers it without a change. M6 raises the extension's catalog response cap.
- The coordinator pushes `20261002230334_review_summary` to hosted after merge; until then a hosted review app built from this branch would fail to load drafts.

## Status
Accepted 2026-10-02 by the M8 implementing agent within the [Stage 2 plan](../product/phase-7-stage-2.md); the coordinator or Evan can revise any row.
