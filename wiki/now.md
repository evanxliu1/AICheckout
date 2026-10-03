---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T03:45:00Z
---

# Now

As of 2026-10-03T03:45Z.

## Current state

- **`origin/main`** (`f383964`): Phase 7 Stage 2 PRs #18–#31 merged (plan, M11, M3, M9, M1, M2, M8, M4, M6, M5, M10 part 1, Tailwind 4, M7, M10 part 2). The extension bundles the 178-card `CATALOG_V3` `2026-10-02.expansion.1` with card search, card options, point values and v3 wording. Milestone details and PRs: [Stage 2 plan](product/phase-7-stage-2.md); earlier phases: [roadmap](product/roadmap.md).
- **Hosted:** site, results page, review app and `/v1/catalog` live at https://ai-checkout-api.onrender.com ([hosting](ops/hosting.md)). All 10 migrations are on hosted Supabase ([database migrations](ops/database-migrations.md)). `/v1/catalog` serves release sequence 1, the 7-card catalog `2026-09-29.real.1`, published 2026-10-02T02:29Z, expiring 2026-10-29T00:00Z (checked 2026-10-03T01:07Z). Render serves `main` and its review app offers `CATALOG_V3`. Hosted Auth signs HS256 (empty JWKS); Render needs no new env var.
- **Curation model:** gpt-5.6-luna `xhigh` since 2026-10-02 ([decision](decisions/2026-10-02-gpt-5-6-luna-for-curation.md)); [`docs/evals/results.md`](../docs/evals/results.md) has its rows (dev 99.5%, held-out 98.3%, marked added after). Expansion eval: [`docs/evals/expansion.md`](../docs/evals/expansion.md) (gpt-5.5 low cross-model 76.2% end to end).

## Active work

- **Ocean theme** on branch `ui-ocean-theme` (worktree `../AICheckout-ocean`; first cut from `37e643b`, merged with `main` at `f383964` on 2026-10-03; not pushed): popup, badge, review app and site in the Ocean palette with self-hosted Bricolage Grotesque and Figtree ([decision](decisions/2026-10-02-ocean-theme.md), [UI library](system/ui-library.md)). The merge kept `main`'s behaviour and copy (M7 card search, card options, questions, point values, v3 rows with basis labels, "Up to $x", store cards not accepted, ranking note, Venmo, rewards wording) and extended the look to them: winner block on v3 rows (smaller size for ranges, "Up to" and units; no "$X less" for unvalued programs), navy combobox marker, Bricolage subsection titles, wallet list names, Ocean values in the Tailwind 4 `@theme inline`, a wrapping name/amount row, badge panel `h3` margins. New checks: v3 winner and widest-amount popup states, bundled long card names, badge panel at $99,999.99, overflow inside the popup. Independent review: see [log](log.md). Evan merges; then regenerate the media listed below.
- **Stage 2 M10 part 2** merged with PR #31: Citi Double Cash maps to the `cash-back` program under general rule 1, through a `corpusLabel` override in `reward-programs.json` that repeats its frozen `real.v2.2` label (points at 1¢). `CATALOG_V3` is rebuilt (only that card's `programId` and stated value change; version kept, since the catalog is unpublished). `checkRealCards` now compares the value of one rate unit. No other card states a percentage back on a points program. Engine cents are unchanged for the seven real cards and the golden ladders, and every card at the three merchants matches before and after, except a ThankYou override no longer applying to Double Cash. The extension's `cashLikePoints` heuristic is removed. The badge's recorded-order line says "cash back" only when both cards pay cash back, otherwise "rewards" with the value points were counted at ("Counts Capital One miles at 1¢ each (estimate)."). The savings history reads "All-time: $x extra in rewards". A card whose program has no value is not counted (it was $0). [Decision](decisions/2026-10-03-double-cash-cash-back.md). Docs: roadmap (Stage 2 complete except the publish), [Stage 2 plan](product/phase-7-stage-2.md) statuses, [catalog expansion](system/catalog-expansion.md), [cards](domain/cards.md), [cart badge](system/cart-badge.md), [extension](system/extension.md), site and Web Store copy "extra rewards". Pre-merge review by an independent subagent ([log](log.md)).
- **Deferred to after the Ocean theme:** site screenshots (`TODO(after the Ocean theme)` in `apps/site/src/pages.tsx` and [public site](system/public-site.md)) and the Web Store media in `docs/release/assets` (`RELEASE_ASSETS=1`; they show the old checkbox editor and catalog v2 amounts). They are regenerated once, in the final look. The Web Store text (`docs/release/store-listing.md`, `support.md`) still describes the seven-card cash-back build apart from the "extra rewards" lines; it is rewritten for the 178-card catalog in Phase 5.
- **Deadline.** The expansion captures are dated 2026-10-02, so a catalog citing them expires by 2026-11-01T00:00Z; hosted release 1 expires 2026-10-29. Publish target 2026-10-28.
- Stage 1 facts (corpus counts, known gaps, judgment calls) are on [catalog expansion](system/catalog-expansion.md). Captures and luna traces are only in the `../AICheckout-expansion` worktree (gitignored).

## Open questions and next steps

1. **Evan publishes** `2026-10-02.expansion.1` per the [catalog release runbook](ops/catalog-release.md) before 2026-10-28 (hard limit 2026-11-01T00:00Z): start a draft from `CATALOG_V3` in the hosted review app, load `real/captures`, `real/merchant-captures` and `expansion/captures`, review, publish. Then the coordinator checks `/v1/catalog` and a `build:hosted` refresh. M10 part 2 merges first and Render redeploys `main`, so the published catalog has Double Cash as cash back; the version string is unchanged, so discard any draft started from `CATALOG_V3` before that redeploy.
2. **Ocean frontend theme**: branch `ui-ocean-theme` in `../AICheckout-ocean` is merged with `main` (`f383964`) and ready for Evan. After it lands, regenerate once: `npm run release:media` (`docs/release/assets/` store screenshots 1–6, promo 440×280, shopper demo video and its captures and manifests; the site's `/media/1-wallet.png`–`4-subtotal.png` come from these) and `npm run release:portfolio` (full-stack review demo stills and video, which show the review app header), then clear `TODO(after the Ocean theme)` in `apps/site/src/pages.tsx` and [public site](system/public-site.md).
3. **Phase 8 card-expansion pipeline**, pending Evan's approval of the proposed [design](system/card-expansion-pipeline.md) ([decision, proposed](decisions/2026-10-02-agent-driven-card-pipeline.md)) and his answers to its [open questions](system/card-expansion-pipeline.md#open-design-questions-for-evan). Later phases, in Evan's order (2026-10-02): 9 merchant-expansion pipeline → 5 Web Store release and 4 terms-change detection; 6 site coverage harness ([roadmap](product/roadmap.md)).
- Open for Evan from M3: Aer Lingus and Iberia Avios stay unvalued unless he wants parity with British Airways; a second publisher would value U.S. Bank Altitude, SKYPASS, Lufthansa, Cathay, Frontier.
- Optional (Evan): switch hosted Supabase to asymmetric JWT signing keys so the API verifies tokens locally instead of asking Auth.
- Check a live catalog refresh in a `build:hosted` extension against the published release (last step of Phase 3 M6).
- Enable GitHub private vulnerability reporting on the repository, which [`SECURITY.md`](../SECURITY.md) tells reporters to use (Evan, repository settings).
- Verify the `orderConfirmation` URL patterns on a real order per retailer before the Web Store release (Evan).
- The luna rows are one repeat each; a second repeat would firm up the comparison with gpt-5.5 (live run, Evan's call).
- Stage 2 open questions resolved by the coordinator on 2026-10-02 (hash-only freshness checks, one conservative valuation publisher, shopper override wins, gpt-5.5 low cross-model eval, package README fixes): [plan](product/phase-7-stage-2.md#decisions-on-the-plans-open-questions).
- Human spot-check of the agent-verified labels: deferred by Evan on 2026-10-02.
- Optional cleanup: remove the `m4fix` worktree (in a session scratchpad) and branch.
- `core.hooksPath` is already `.githooks` in the shared `.git/config` of Evan's clone, so it applies to every worktree. Branches without `.githooks/` (not yet merged with the wiki) run no pre-commit hook; once they merge `main` the linter runs on every commit. Other clones run `git config core.hooksPath .githooks`; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`.
- Catalog builder maps gold `usMerchantsOnly: null` to `false`, losing "not stated"; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)).
- Housekeeping from the archived plan: delete the stale local `extension/CLAUDE.md` (gitignored, describes removed code); revoke the keys from the retired `simulation/` prototype if not done.
