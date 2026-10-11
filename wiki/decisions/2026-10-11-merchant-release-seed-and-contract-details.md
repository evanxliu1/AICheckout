---
type: Decision
title: Merchant release 14.1 details: the seed keeps Best Buy and Newegg on the default category, fifteen processor hosts hand-picked, strict version format, evidence rule and processor flag enforced in Zod, recordToProfile Zod-free
description: Implementer choices in milestone 14.1 of Phase 14 that the plan left open. The seed release applies the evidence rule honestly, so the two electronics stores lose their catalog category until 14.4 researches them; the contract enforces the evidence rule and the processor goods flag; the version format is the plan's exact shape; recordToProfile lives beside the matcher so content scripts can import it.
status: accepted
tags: [decision, phase-14, merchants, contract]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-11T00:30:00Z
sources:
  - resource: ../product/phase-14-merchant-database.md
    title: Phase 14 plan (sections 3, 4, 8)
  - resource: 2026-10-10-merchant-database-evidence.md
    title: Evan's evidence rule
  - resource: ../../packages/rewards-core/src/merchant-release.ts
    title: merchantReleaseSchema
  - resource: ../../evals/merchants/db/records/
    title: Seed records
---

# Merchant release 14.1 details (2026-10-11)

## Context
Milestone 14.1 of the [Phase 14 plan](../product/phase-14-merchant-database.md) builds the `merchant-release.1` contract, the matcher, the engine option and a seed release of "the three legacy stores with their brands and the 15 processors". The plan fixes the record shape and the evidence rule but leaves a few points to the implementer.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Category of `best-buy-us` and `newegg-us` in the seed | Keep the catalog's `electronics` (its only evidence is an undated CheckMCC community lookup, no store page: not `corroborated`); `general-merchandise` with `default` basis | `general-merchandise`, `default`. The evidence rule is Evan's binding decision and the seed has no store-page captures. **Consequence for 14.2:** once the extension passes the release profile, U.S. Bank Cash+ and Edward Jones electronics bonuses stop applying at bestbuy.com and newegg.com until 14.4's tier-B run captures store pages and a lookup for them (the test `overrides a catalog profile … at their own ids` shows the difference). 14.2 may keep preferring the catalog profile for the three legacy ids until then; that is its call |
| Which 15 processors | The plan names PayPal, Shop Pay, Klarna, Affirm, Afterpay, Bolt, Venmo, Amazon Pay "and similar" | Those eight plus Sezzle, Zip, Stripe Checkout (`checkout.stripe.com` only, not `stripe.com`), Link, Google Pay (`pay.google.com`), Cash App Pay (`cash.app`), Splitit. Shop Pay is `shop.app` and `pay.shopify.com`; Amazon Pay is `pay.amazon.com`, which the longest-host rule prefers over `amazon.com`. Hand-authored from general knowledge, not captures; 14.3's processor verification and the 14.5 URL audit check them |
| Kind of the legacy stores | `marketplace` for Amazon and Newegg (both host third-party sellers); `merchant` | `merchant` for all three: the site checks out as itself; the marketplace caveat stays in the catalog profile notes. `kind` changes nothing in the engine; only `processor` does |
| Version format | Reuse the catalog's permissive `versionSchema`; the plan's exact `YYYY-MM-DD.<label>.<n>` | The exact shape (`/^\d{4}-\d{2}-\d{2}\.[a-z0-9-]+\.\d+$/`), as the plan states it; the SQL mirror in 14.6 copies it |
| Evidence rule in the contract | Only in the apply stage (14.3); also in Zod | Also in Zod: `default` cites nothing and is `general-merchandise`; `issuer` cites an `issuer-terms` source; `corroborated` cites a `store-page` and an `mcc-lookup`. A release that breaks the rule is refused by every consumer, not only by the builder |
| Processor goods flag | Free; `physicalGoods: false` required for `kind: processor` | Required, as section 3 of the plan states |
| `verifiedAt` and sources | Equal to the newest `capturedAt`; no source captured after it | No source after `verifiedAt` (a release with no sources has no "newest"); the builder takes `verifiedAt` from `release-config.json` |
| Where `recordToProfile` lives | `merchant-release.ts` (with the Zod schema); `merchant-match.ts` (Zod-free) | `merchant-match.ts`, so the content scripts can import matcher and conversion together, like `generic-merchant.ts` |
| Limits beyond the plan | None; sources 10,000, hosts 20 and brands 20 per record, 10 evidence sources per record, name 60 | The latter: every array in the contract has a bound, as in catalog v3 |

## Decision
As chosen. The seed release is `2026-10-10.seed.1`: 18 records, all `default`, no sources; `MERCHANTS_V1` is generated from `evals/merchants/db/records/*.json` and `release-config.json` by `npm run merchants` and checked by `npm run merchants:check` in CI.

## Consequences
- The seed changes no ranking until 14.2 wires the profile in; when it does, Best Buy and Newegg electronics bonuses pause until 14.4 gives them evidence. Listed in [now](../now.md) for 14.2 and 14.4.
- The 15 processor hosts are unverified until 14.3; a wrong one hides the badge on that host and nothing more.
- `merchantReleaseCases` (54) carry the evidence rule and the processor flag, so the 14.6 SQL validator must mirror both.

## Status
Accepted 2026-10-11 (UTC; the 2026-10-10 session) by the 14.1 implementer (Fable 5.1), agent-verified by tests; Evan may change any seed record.
