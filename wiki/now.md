---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T01:00:00Z
---

# Now

As of 2026-10-03T01:00Z.

## Current state

- **`origin/main`** at `be5de25` (PR #16, Phase 7 capture, extraction and drafts, merged; PR #15, this wiki, before it). Merged: PRs #4–#6 (Phase 2a–2c), #7–#12 (Phase 3 M1–M6 prep), #13 (3b automatic cart badge) and #14 (3b follow-ups: a removed badge host comes back at once, covered-click hint in a persistent status region, reader resumes after a back/forward-cache restore, README) ([roadmap](product/roadmap.md), [cart badge](system/cart-badge.md)).
- **Hosted:** site, results page, review app and `/v1/catalog` live at https://ai-checkout-api.onrender.com ([hosting](ops/hosting.md)). All 8 migrations are on hosted Supabase; the coordinating session pushed `20260930225732_catalog_v2` and `20261001010350_source_body_limit` with `./scripts/db-push.sh` ([database migrations](ops/database-migrations.md)). `/v1/catalog` serves release sequence 1, the 7-card catalog `2026-09-29.real.1`, published 2026-10-02T02:29Z, expiring 2026-10-29T00:00Z (checked 2026-10-02T05:58Z).
- **Curation model:** gpt-5.6-luna `xhigh` since 2026-10-02 ([decision](decisions/2026-10-02-gpt-5-6-luna-for-curation.md)). It is the `eval:v2 --provider codex` and `extract-cards.mjs` default on `main` since PR #16, and [`docs/evals/results.md`](../docs/evals/results.md) has its rows: dev 99.5%, held-out 98.3%, both marked added after ([reporting decision](decisions/2026-10-02-luna-results-per-split.md)).

## Active work

- **Phase 7 card expansion** on `phase7-verify` (worktree `../AICheckout-expansion`, from `main` `be5de25`; committed, not pushed): verification is done. Ten per-issuer findings files, verified by nine verifier subagents (a second opinion on Chase) and decided by eight adjudicators, plus general and per-issuer conventions ([decision](decisions/2026-10-02-expansion-verification-conventions.md)), produced `corpus.json` `expansion.v1`: 173 agent-verified cards (180 − 7 dropped), 863 rules, 396 exclusions, 195 issues; `check-expansion-quotes.mjs` passes. A pre-merge review (agent-verified) spot-checked 31 cards and found no label the captures contradict; it fixed one activation convention on four Customized Cash cards. A copyright adjacency fix followed: no two anchors of one item may overlap or abut into more than 25 consecutive capture words (checked by `check-expansion-quotes.mjs`, general rule 22); drafts regenerated, findings anchors shortened, labels unchanged apart from anchors except the Marriott Bonvoy Boundless 6X cap (`none` → null, rule 21). Known gaps: gated rates and redemption values (rules 17/18, Stage 2), Freedom Flex and Discover Q4 rules expire 2026-12-31, Upromise 1.529% has no integer rate, Marriott Bonvoy Bold has no base rate, Key Rewards are four near-duplicate cards, five judgment calls left as labelled (One Key portal, Chrome EV, Prime Visa Amazon, JCPenney maximum, inflight rebates) ([catalog expansion](system/catalog-expansion.md)). Next: decide points valuation (fixes the `rate_not_in_evidence` validator gap); Stage-2 engine work and a new migration raising catalog limits; eval; Evan publishes. Evan pushes the branch and opens the PR.

## Open questions and next steps

- Check a live catalog refresh in a `build:hosted` extension against the published release (last step of Phase 3 M6).
- Enable GitHub private vulnerability reporting on the repository, which [`SECURITY.md`](../SECURITY.md) tells reporters to use (Evan, repository settings).
- Verify the `orderConfirmation` URL patterns on a real order per retailer before the Web Store release (Evan).
- The luna rows are one repeat each; a second repeat would firm up the comparison with gpt-5.5 (live run, Evan's call).
- Points valuation for the expansion: cents per point per currency, stated or assumed, and how the engine ranks points cards.
- The hosted and bundled catalog expires 2026-10-29, but issuer pages may not be re-captured before a label verification pass. Decide how to refresh it (Phase 7 may replace it).
- Optional human verification pass over the agent-verified corpus labels.
- Optional cleanup: remove the `m4fix` worktree (in a session scratchpad) and branch.
- Stale package READMEs (left intact by directive; fix or confirm): `supabase/README.md` (six migrations, not applied to hosted, pilot seed; there are eight, all applied, seed is `CATALOG_V2`), `apps/api/README.md` ("no hosted API", 202 tests; now 250 and Render is live), `apps/api/src/curation/README.md` (no live model call made), `packages/rewards-core/README.md` (v1 pilot catalog).
- `core.hooksPath` is already `.githooks` in the shared `.git/config` of Evan's clone, so it applies to every worktree. Branches without `.githooks/` (not yet merged with the wiki) run no pre-commit hook; once they merge `main` the linter runs on every commit. Other clones run `git config core.hooksPath .githooks`; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`.
- Catalog builder maps gold `usMerchantsOnly: null` to `false`, losing "not stated"; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)).
- Housekeeping from the archived plan: delete the stale local `extension/CLAUDE.md` (gitignored, describes removed code); revoke the keys from the retired `simulation/` prototype if not done.
- Later phases: 4 terms-change detection, 5 Web Store release, 6 site coverage harness ([roadmap](product/roadmap.md)).
