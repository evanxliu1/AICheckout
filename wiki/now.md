---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-06T04:00:00Z
---

# Now

As of 2026-10-06T04:00:00Z.

## Current state

- **Phases 7, 8 and 9 are done.** `origin/main` (`c0cb81e`, PR #54) has everything: the Phase 8 card-expansion pipeline ([results](../docs/evals/pipeline-v1.md)), Phase 9 milestones 1–5 ([plan](product/phase-9-freshness.md), [results](../docs/evals/freshness-2026-10.md)) and the release 3 wiki audit. Phases: [roadmap](product/roadmap.md).
- **Hosted catalog:** `/v1/catalog` serves **release 3**, `2026-10-05.renewal.1` (178 cards, 328 sources), published 2026-10-05T05:20:50Z by the coordinator's `pipeline publish --confirm` on Evan's chat instruction; it **expires 2026-11-04T00:00Z** ([release history](ops/catalog-release-history.md#release-3-published-2026-10-05)).
- **Hosted code:** Render last checked serving `e9fe387` (2026-10-05T04:40Z); later deploys not checked. All 10 migrations on hosted Supabase ([hosting](ops/hosting.md)).
- **Captures:** since 2026-10-05 the main checkout holds every gitignored capture (11 batch folders, `expansion/captures` 321, extractions, eval runs); `publish` from it with no `--captures` flag matches 328/328 ([capture folders](ops/catalog-release.md#capture-folders)). `AICheckout-p8-wf` and `AICheckout-expansion` stay as backups until Evan agrees to remove them.
- **Curation model:** gpt-5.6-luna `xhigh` ([decision](decisions/2026-10-02-gpt-5-6-luna-for-curation.md)).

## Active work

- **Merchant coverage, Phases 10–17** ([plan](product/phase-10-merchant-expansion.md), [decision](decisions/2026-10-05-merchant-coverage-phases.md)): v6.1 split on 2026-10-05 into eight phases, each with its own exit check and decisions. D4 and D6 approved. **Phase 10** (25-site feasibility probe, no product code) and **Phase 11** (any store with a typed amount, engine ranges) start in parallel. Phase 11 reduced on 2026-10-05: no store search, no category ranges (D5 moves to Phase 14).
- **Phase 11 done:** merged as PR #57 (`f041fef`, 2026-10-05; independent review agent-verified, fixes applied): engine-supplied `generic-us-online` profile, popup picks the store from the active tab, typed amount at any other store ([plan progress](product/phase-11-any-store.md#progress), [decision](decisions/2026-10-05-generic-store-profile.md)). The OnePay CashRewards first-90-days rule's Walmart exclusion cannot fire at a generic store (pinned by a guard test, documented); Evan deferred brand websites to Phase 14, before Release A, on 2026-10-05. Independent review fixes applied.
- Release media regenerated for `2026-10-05.renewal.1` (`npm run release:media`, all checks passed, 2026-10-05; [release media](ops/release-media.md)).

## Open questions and next steps

1. **Phase 10 probe results** merged as PR #58 (2026-10-05): verdict **go**, 16 of 25 sites showed a logged-out cart, but only 3 of 8 top-1k sites (bot walls), which limits Phase 12 capture, not the product. The badge frame loaded under every CSP seen. 2 MiB fits `chrome.storage.local` (measured). The prototype reader found 25 of 38 totals, then 31 of 38 after one bug fix with 1 false found (30 of 38 with 2 false found against the original labels) (IKEA superscript cents). Proposed Y is 80% on one-item cart pages ([report](../docs/evals/merchant-probe-2026-10.md), [decision](decisions/2026-10-05-merchant-probe-method.md)). The independent report review ran (agent-verified, approve with fixes; fixes applied). Second labeling done: labeler 2 agrees on 44 of 44 snapshots, no adjudication needed (agent-verified). Merged; Evan accepted go and Y = 80% on 2026-10-05.
2. **Evan accepted go and Y = 80% (2026-10-05). Phase 12** started 2026-10-06 ([plan](product/phase-12-reader-eval.md)): **12.1 built** on `phase12-protocol` (2026-10-06): [reader protocol](../docs/evals/generic-reader-protocol.md) pre-registered, retail frame (457 eligible domains on Tranco 647LX) and merchant-pipeline held-out list (60 domains) frozen with seeded selection ([decision](decisions/2026-10-06-reader-eval-protocol.md), proposed). Independent review 2026-10-06: sign with fixes (agent-verified), fixes applied; Evan decided the robots posture (robots.txt disallowing cart or checkout paths, or everything, excludes a site; terms clauses recorded only). Frame and held-out list carry rank bands only (Tranco source licences include CC BY-NC). Next: PR and merge. Then 12.2 capture tool, 12.3 captures. Later decisions are asked per phase ([table](product/phase-10-merchant-expansion.md#decisions-for-evan-one-word-each-asked-when-their-phase-starts)).
3. **Next renewal, published before 2026-11-04T00:00Z** ([renewing](ops/catalog-release.md#renewing-a-catalog-before-it-expires)): re-read the NerdWallet estimates (read 2026-10-02; valid for catalogs verified up to 2026-11-01). Freedom Flex and Discover Q4 rules end 2026-12-31; a catalog valid past then needs Q1 2027 data.
4. Phase 9 follow-ups: `check-expansion-quotes.mjs` resolves a source ID to the last folder that has it instead of per file; `pipeline handoff` names the freshness record for the merchant MCC folder ([renewal record](ops/catalog-release-history.md#renewal-2026-10-05renewal1-prepared-2026-10-05)).
5. Phase order (Evan, 2026-10-05): 10 ∥ 11 → 12 → 13 → 14 → 15 Release A (replaces Phase 5) → 17; 16 beside 15; Phase 6 folded in; 4 terms-change detection revisited after 9.
6. Before the Web Store release: verify the `orderConfirmation` URL patterns on a real order per retailer (Evan); enable GitHub private vulnerability reporting ([`SECURITY.md`](../SECURITY.md)); optionally confirm **Check for updated terms** in a loaded `build:hosted` extension picks up release 3.
7. Evan's calls: Aer Lingus and Iberia Avios valuation parity; a second luna repeat against gpt-5.5; the human spot-check of agent-verified labels (deferred 2026-10-02); revoking the legacy HS256 JWT secret.
8. Catalog builder maps gold `usMerchantsOnly: null` to `false`; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)).
9. Housekeeping: other clones run `git config core.hooksPath .githooks`; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`; delete the stale local `extension/CLAUDE.md`; revoke the retired `simulation/` keys if not done; remove the merged `AICheckout-p9-m3b`, `AICheckout-p9-m5` and `AICheckout-wiki-audit` worktrees when Evan agrees.
