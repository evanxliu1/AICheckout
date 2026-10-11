---
type: Decision
title: "Phase 14.6 implementer choices: publish whole releases with no drafts, expected head as sequence plus hash, idempotent republish by jsonb equality, a 90-second background fetch with one retry, pages reading the cache once before rendering"
description: Choices of 2026-10-11 made within the Phase 14 plan's milestone 14.6 while building the hosted merchant release and the weekly refresh. The database stores whole published releases and a head pointer, validated by a SQL mirror of the Zod schema; publication is one function that takes the release itself with the head the caller saw; the extension refreshes catalog and merchants on one weekly alarm with a long timeout and one retry for Render cold starts; extension pages load the cached release once at startup.
status: accepted
tags: [decision, phase-14, merchants, database, extension, api]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-11T13:30:00Z
sources:
  - resource: ../product/phase-14-merchant-database.md
    title: Phase 14 plan (milestone 14.6 and §4 freshness)
  - resource: ../../supabase/migrations/20261011111247_merchant_releases.sql
    title: Migration merchant_releases
  - resource: ../../extension/src/state/merchants.ts
    title: Extension merchant cache
  - resource: ../../tools/catalog-pipeline/src/merchants/publish.ts
    title: pipeline merchants publish
---

# Phase 14.6 implementer choices (2026-10-11)

## Context
Milestone 14.6 of the [plan](../product/phase-14-merchant-database.md#8-milestones) binds the shape (tables, validator, publish function under `require_reviewer()`, `GET /v1/merchants`, a publish route behind the token pre-check, `pipeline merchants publish` with the catalog publish's guards, the extension's cache with rollback protection, a weekly `alarms` refresh). Several details were left to the implementer.

## Options considered

| Question | Chosen | Alternatives |
| --- | --- | --- |
| What the publish function takes | The whole release (`jsonb`) plus `p_expected_head` (the head's sequence) and `p_expected_hash` (the head's `release_hash`), both null before the first release, and a review note. The CLI reads `GET /v1/merchants` and passes what it saw | A draft table and hash like catalogs (the plan excludes drafts; the release is reviewed in the repository); the payload's own hash (PostgreSQL's JSONB text form cannot be computed by the client without reimplementing its spacing and key order) |
| Idempotency | A version already published with semantically equal content (`jsonb =`) returns the existing row; the same version with other content raises `40001` (the API answers 409) | A unique-violation on `version` (23505, also 409, but a lost response could not be retried) |
| The private audit of who published | `catalog_private.merchant_publications` (reviewer, note, time) | None (the plan says "no drafts or capture tables"; a publications table is neither and matches the catalog's) |
| Freshness in SQL | A release verified in the future is refused; no expiry | An expiry (the plan drops it) |
| Column names | `release jsonb`, generated `version` and `release_hash`; the API's row is `{ sequence, release, version, release_hash, published_at }` (`publishedMerchantReleaseSchema`) | `merchants jsonb` (reads as the array inside the release) |
| Where the extension pages get the release | Each page reads the public cache from `chrome.storage.local` once before its first render (`state/merchants-page.ts` → `setMerchantsInEffect`), so the popup's tab store, names and evidence lines agree with the worker; the worker reads the cache on every request | Carrying the release in every worker response (hundreds of KB per message); leaving pages on the bundled release (a store known only to the hosted release would show as "Unsupported merchant") |
| The weekly alarm | One alarm `refresh-releases`, created in hosted builds only when `chrome.alarms.get` finds none (on install or browser startup), with `delayInMinutes` 2 so a new install refreshes soon and `periodInMinutes` 10,080; a 90-second fetch limit (Render's free instance wakes in about a minute); one retry alarm 5 minutes later when either fetch failed, never a second. **Amended after the independent review (2026-10-11):** the first version re-created the alarm on every startup, which restarted the week, and had no first delay | Re-creating on startup; a shorter timeout with several retries |
| Locked vault at alarm time | The catalog step is `skipped` (the wallet cannot be reconciled; no retry is scheduled for it) and the merchant cache, public data, still refreshes; the catalog is refreshed on the next alarm or on "Check for updated terms" (review amendment: was `failed`) | Caching the catalog without reconciling the wallet (the catalog decision of 2026-10-02 writes both together) |
| "Check for updated terms" | Also refreshes the merchant release, whatever the catalog check's outcome (review amendment), best effort; the notice or error stays about card terms and a merchant failure is silent | A second button or a merchants notice (the shopper has no decision to make about store data) |
| Reading the cache per request | The parsed cache is memoized by the row's `release_hash` and `lastCheckedAt` (review amendment), so the 2 MiB release is validated once per write, and the host index is built once per release object | Validating on every worker request and badge message |
| `/v1/merchants` answering 503 at publish time | Refuse: the head is unknown (a first publication answers 200 with a null release) (review amendment) | Treating 503 as "no release" and publishing on a null head (an opaque 409 at best) |
| `instructionProblems` and `gitState` | Generalised in `publish.ts` (a `bundled` label and a `paths` list) and reused by the merchant command with its own clean paths (`evals/merchants/db/records`, `release-config.json`, `release.json`, the builder scripts, `packages/rewards-core`, `tools/catalog-pipeline`) | A copy of the checks |

## Decision
As in the table.

## Consequences
- `publishedMerchantReleaseSchema` and `merchantsResponseSchema` live beside `merchantReleaseSchema` in `packages/rewards-core`; `publishMerchantsInputSchema` in `packages/catalog-review`; `createMerchantFetcher` in `packages/catalog-client`.
- `createStateService` and `createVaultService` take a sixth argument, `fetchMerchants`; `createBadgeService`'s `release` is the bundled fallback. All three read `checkoutMerchantsV1` on every request.
- The manifest gains `alarms` (no install warning); `release-package.mjs` requires exactly `activeTab`, `alarms`, `scripting`, `storage`.
- 14.7 publishes with `npm run pipeline -- merchants publish --version <v> --confirm <v> --instruction-at <UTC>` after Evan's `publish merchants <v>`.

## Status
Accepted 2026-10-11 (implementer, within the plan; agent-verified by tests).
