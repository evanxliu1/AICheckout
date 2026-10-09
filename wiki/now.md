---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-08T20:00:00Z
---

# Now

As of 2026-10-08T20:00Z.

## Current state

- **`origin/main` is `db5f938`** (PR #75, Phase 12.3 capture run, Workflow 3 tools and the Phase 13 harness). Phases 7–11 are done; Phase 12 is frozen on branch `phase12-eval-set` (PR pending); Phase 13 is next ([roadmap](product/roadmap.md)).
- **Hosted catalog:** release 3, `2026-10-05.renewal.1` (178 cards), published 2026-10-05T05:20:50Z; **expires 2026-11-04T00:00Z** ([release history](ops/catalog-release-history.md#release-3-published-2026-10-05)). Render last checked serving `e9fe387`; all 10 migrations on hosted ([hosting](ops/hosting.md)).
- **Captures:** the main checkout holds every gitignored issuer capture ([capture folders](ops/catalog-release.md#capture-folders)) and the pane exports (`evals/merchants/capture/data/pane/`); `AICheckout-p8-wf` and `AICheckout-expansion` stay as backups until Evan agrees to remove them. Curation model: gpt-5.6-luna `xhigh`.
- **Reader rules:** the reader shows an amount only when certain, otherwise withholds (rates only); generic reader only, no store configs. **Since 2026-10-08 (Evan) the ≥ 99% bar is a quality target, not a pass gate** ([decision](decisions/2026-10-08-pause-capture-quality-target.md)); results are reported with exact bounds, store counts and coverage (target 80% on `cart-1`).
- **Phase 12 eval set: frozen 2026-10-08** ([report](../docs/evals/reader-captures-2026-10.md)): 337 stores (332 pane + 5 robot), development 200 / held-out A 137; 1,217 page-states labelled once each (one labeller per store, Evan's [decision](decisions/2026-10-08-single-labeller.md)), 819 with an expected amount (held-out A 331, of them 117 `cart-1`); 1,819 variants `.2`; `freeze.json` at `2de2fec` after the independent capture review (72 page-states and 2 stores dropped, 6 deviations reported); check passes. Capture was paused at 532 visited (95 blocked by bot walls or CAPTCHAs, a reported gap).
- **Tools (agent-verified reviews):** export collector, renders and tiles, labeller digest, label schema and assembler, single-labeller finals, variants and the 10% check, freeze; the Phase 13 harness (`evals/reader/`) with a placeholder reader in `packages/cart-reader`.

## Active work

- **Close Phase 12:** PR `phase12-eval-set` → `main` (capture review applied; merge after CI), merge after CI passes.
- **Phase 13.2 in progress** on `phase13-reader` (not merged): generic reader rounds 1–4 (2026-10-08); round 4 applied an independent code review (tax/shipping labels are totals only with a preposition and never when they start with the tax or shipping word; a total outside any cart summary withholds; the storefront currency rule yields when the page's text says prices are in another currency; two-digit superscript cents only; Arabic separators; Indian grouping with decimals). Quick loop on development: real 381 correct / 0 wrong / 341 withheld, `cart-1` coverage 85.4%, variants 867 / 0 wrong, p95 13.5 ms. Not implemented from the review: skipping `data-pane-*` attribute names in code (the harness's bundle tripwire rejects the literal; the harness strips those attributes before every read).
- **Phase 13 next:** reader v1 by a separate reader-developer agent on development pages only (`evals/reader/run.mjs` on development, unlimited); independent code review; held-out A run 1 by an evaluation agent (at most two runs); `docs/evals/reader-v1.md`; then extension integration (13b).

## Open questions and next steps

1. **Next catalog renewal before 2026-11-04T00:00Z** ([renewing](ops/catalog-release.md#renewing-a-catalog-before-it-expires)); plan it for about 2026-10-28 (Evan types `publish <version>`). Re-read the NerdWallet estimates (valid for catalogs verified up to 2026-11-01).
2. Evan's call (asked 2026-10-07): allow known cart-only pages under `/checkout` (VTEX `/checkout/#/cart`, AbeBooks `/checkout/basket`) in any future capture; 11 stores were excluded as `would-need-forbidden-action`.
3. Phase 9 follow-ups: `check-expansion-quotes.mjs` resolves a source ID to the last folder that has it; `pipeline handoff` should name the merchant MCC freshness record.
4. Before the Web Store release (Phase 15): verify `orderConfirmation` URLs on real orders (Evan); enable GitHub private vulnerability reporting; optionally confirm a loaded `build:hosted` extension picks up release 3.
5. Evan's calls: Aer Lingus and Iberia Avios valuation; a second luna repeat against gpt-5.5; the deferred human spot-check of agent-verified labels; revoking the legacy HS256 JWT secret.
6. Catalog builder maps gold `usMerchantsOnly: null` to `false`; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)).
7. Housekeeping: other clones run `git config core.hooksPath .githooks`; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`; delete the stale local `extension/CLAUDE.md`; remove merged worktrees (`.claude/worktrees/agent-*`) when Evan agrees.
