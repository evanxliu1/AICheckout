---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-23T18:15:00Z
---

# Now

As of 2026-10-23 (wiki audit on `wiki-audit-2026-10-23`; `main` at `2c55174e`).

## Current state

- **`main` is `2c55174e`** (PR #105, 15.6b motion-graphic demo). Phases 7–14 are done; **Phase 15 (Release A) is in progress** ([plan](product/phase-15-release-a.md), [roadmap](product/roadmap.md) for the merged milestones and PRs).
- **Extension at `main`:** the badge at any https store, the merchant release matched on the device with the weekly refresh, the generic reader only, manifest version `2.1.0`, the install-time refresh, "Checking for updated terms…" and the uninstall URL, telemetry behind one onboarding consent with Stop sharing, Delete my data, Suggest this store and Report a problem ([extension](system/extension.md); public dictionary [`docs/telemetry/events.md`](../docs/telemetry/events.md)).
- **Release docs and site** describe the extension as it is; `npm run release:docs:check:release` is clean (support email, publisher and non-trader confirmed by Evan 2026-10-22).
- **Telemetry backend** is live on hosted Supabase; retention is 90 days with the daily `telemetry-prune` pg_cron job, confirmed active by Evan 2026-10-22 ([database](system/database.md)). Still to confirm on Render: the `X-Forwarded-For` hop count (`TELEMETRY_PROXY_HOPS=1`). `EXTENSION_IDS` stays unset on Render until 15.7.
- **Hosted catalog:** release 3, `2026-10-05.renewal.1` (178 cards), **expires 2026-11-04T00:00Z** ([release history](ops/catalog-release-history.md#release-3-published-2026-10-05)). **Hosted merchant release 1:** `2026-10-11.mcc.3` (640 records, 89 bonus categories). All 14 migrations are on hosted ([database migrations](ops/database-migrations.md)).
- **Release media:** five real screenshots bound to ZIP `f5a27208…e501` and a 55-second motion-graphic demo not bound to the ZIP ([release media](ops/release-media.md)). `verify-release-assets.mjs` fails its first check on `main` because the hosted ZIP changed since 15.5b; 15.7's `release:media` re-binds.
- **Captures:** the main checkout holds every gitignored issuer capture ([capture folders](ops/catalog-release.md#capture-folders)) and the pane exports; `AICheckout-p8-wf` and `AICheckout-expansion` stay as backups until Evan agrees to remove them. Curation model: gpt-5.6-luna `xhigh`.
- **Reader rules:** [retire the legacy adapters](decisions/2026-10-19-retire-legacy-adapters.md) and [the quality target](decisions/2026-10-08-pause-capture-quality-target.md); numbers in [reader-v1](../docs/evals/reader-v1.md), [cart-detection-v1](../docs/evals/cart-detection-v1.md), [merchant-db-v1](../docs/evals/merchant-db-v1.md).

## Active work

- **Phase 15:** 15.1–15.6, 15.1b, 15.5b and 15.6b merged. **Next:** 15.R catalog renewal (from 2026-10-26), then 15.7 submission: rerun `npm run release:media` on the submitted ZIP, replace the demo's "Coming soon to the Chrome Web Store" end card with the listing URL and rerun `release:motion`; Evan uploads the demo master to YouTube, pays, submits and publishes.
- **Wiki audit 2026-10-23** on `wiki-audit-2026-10-23` (not committed): [review](reviews/2026-10-23-wiki-audit.md).

## Open questions and next steps

1. **Evan before submission:** read the privacy policy ([`docs/release/privacy-policy.md`](../docs/release/privacy-policy.md), the site's `/privacy/`); check the first `telemetry-prune` run in `cron.job_run_details`. Open for the coordinator from 15.6: a capped category covered only by the merchant release (Blue Cash Preferred and Everyday at supermarkets) has no spend input, and whether Amex counts a supermarket's website order as both "U.S. supermarkets" and "U.S. online retail" (the engine allows both).
2. **15.3, for the coordinator (not blocking Release A):** `recommendation_shown.amount_kind` has no `typed`, so a popup comparison of a typed amount is not reported (a Zod change, a new migration replacing `telemetry.event_schema()` and parity cases in one change). While a 410 pause runs, automatic events still queue (≤ 200) and go out after the week.
3. **Catalog renewal before 2026-11-04T00:00Z** (15.R, [renewing](ops/catalog-release.md#renewing-a-catalog-before-it-expires)): `pipeline freshness` by 2026-10-26, refresh batches, build, merge, deploy, Evan types `publish <version>` about 2026-10-28; the Release A ZIP bundles it. Re-read the NerdWallet estimates for a catalog verified after 2026-11-01.
4. Phase 15 risk to watch: Chrome's 2026 "strictly necessary" single-purpose rule against collecting owned cards and amounts; the build-time telemetry switch is the fallback ([decision](decisions/2026-10-19-release-a-telemetry-design.md)); `store-listing.md` says what changes in the privacy tab if it is used.
5. Evan's call (asked 2026-10-07): allow known cart-only pages under `/checkout` (VTEX `/checkout/#/cart`, AbeBooks `/checkout/basket`) in any future capture; 11 stores were excluded as `would-need-forbidden-action`.
6. Phase 9 follow-ups: `check-expansion-quotes.mjs` resolves a source ID to the last folder that has it; `pipeline handoff` should name the merchant MCC freshness record.
7. Evan's calls: Aer Lingus and Iberia Avios valuation; a second luna repeat against gpt-5.5; the deferred human spot-check of agent-verified labels; revoking the legacy HS256 JWT secret.
8. Catalog builder maps gold `usMerchantsOnly: null` to `false`; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)). D9: merchant data, eval labels and snapshots stay MIT for now (provisional, 2026-10-10).
9. **Evan's call:** formal approval of the revised Phase 14 plan ([decision](decisions/2026-10-10-phase-14-design.md) still says awaiting; the work shipped 2026-10-12).
10. Housekeeping: the shared local Supabase stack was recreated on 2026-10-20 (see [database migrations](ops/database-migrations.md#gotchas)); after any `npm install`, check `grep -c '"node_modules/@rollup/rollup-' package-lock.json` is 25 (npm 11.5.2 strips other-platform optional packages); other clones run `git config core.hooksPath .githooks`; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`; delete the stale local `extension/CLAUDE.md`; remove merged worktrees (`.claude/worktrees/agent-*`) and merged local branches when Evan agrees.
