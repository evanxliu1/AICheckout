---
type: Working Memory
title: Now
description: Current state, active work, open questions and next steps. Rewritten at the end of every session.
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T04:56:00Z
---

# Now

As of 2026-10-05T04:45Z.

## Current state

- **Phases 7 and 8 are done; Phase 9's renewal is built and deployed.** `origin/main` (`e9fe387`) has the Phase 8 card-expansion pipeline (PRs #36–#42, [results](../docs/evals/pipeline-v1.md)) and Phase 9 milestones 1–4 (PRs #43–#50). The renewed catalog `2026-10-05.renewal.1` (178 cards, 328 sources, verified 2026-10-05, **expires 2026-11-04T00:00Z**) is `CATALOG_V3` on `main`; results in [`docs/evals/freshness-2026-10.md`](../docs/evals/freshness-2026-10.md). Phases: [roadmap](product/roadmap.md), [Phase 9 plan](product/phase-9-freshness.md).
- **Hosted:** Render serves `e9fe387` (checked 2026-10-05T04:40Z: `/health` ok, the review bundle contains `2026-10-05.renewal.1` and the refresh batch manifests). `/v1/catalog` still serves **release 2** (`2026-10-02.expansion.1`, published 2026-10-03T06:15Z), which **expires 2026-11-01T00:00Z**; after that it answers 503 ([catalog release](ops/catalog-release.md)). All 10 migrations on hosted Supabase; Auth signs with asymmetric keys ([hosting](ops/hosting.md)).
- **Curation model:** gpt-5.6-luna `xhigh` ([decision](decisions/2026-10-02-gpt-5-6-luna-for-curation.md)).
- **Worktrees:** `AICheckout` (main), `AICheckout-p8-wf` (branch `catalog-renewal-2026-10`, merged; holds every Phase 8 and 9 batch capture: **keep it**, the publish needs them), `AICheckout-expansion` (`phase7-verify`; the expansion captures and eval runs), `AICheckout-p9-m3b` (merged), `AICheckout-docs` (`docs-readme-demo`), `AICheckout-test`. The unmerged local branch `codex/production-readiness-checkpoint` is untouched.

## Active work

- **Agent publish path** (Phase 9 milestone 5; [decision](decisions/2026-10-05-agent-publish-cli-session.md)): `pipeline login` / `logout` / `whoami [--check]` and `pipeline publish` (dry run; `--confirm <version> --instruction-at <time>` after Evan's chat message); runbook [agent publish](ops/catalog-release.md#agent-publish-cli). Independent review done (agent-verified, symlink and session hardening fixed). The offline dry run of `2026-10-05.renewal.1` with the 14 capture folders matched 328 of 328 sources. Next: PR, merge, Render deploy, then Evan runs `npm run pipeline -- login` once. The renewal waits for it.
- **Public docs:** README rewrite with SVG diagrams and the demo video merged (PR #51, squash, 2026-10-05; [decision](decisions/2026-10-05-readme-demo-video-and-diagrams.md)).

## Open questions and next steps

1. **Evan: `pipeline login`** once the publish path is merged, then **`publish 2026-10-05.renewal.1`** in chat, from 2026-10-20 and no later than 2026-10-28 (hard limit 2026-11-01T00:00Z, when release 2 expires). The browser flow stays as a fallback ([catalog release](ops/catalog-release.md)).
2. After publishing: add `2026-10-05.renewal.1` to `publishedVersions` in `evals/curation/catalog-batches.json` in the next PR; check `/v1/catalog`.
3. **Next renewal before 2026-11-04**: re-read the NerdWallet estimates (read 2026-10-02; valid for catalogs verified up to 2026-11-01). Freedom Flex and Discover Q4 rules end 2026-12-31; a catalog valid past then needs Q1 2027 data (Discover not captured; the Freedom Flex Jan–Mar 2027 quarter was omitted from the renewal).
4. Phase 9 follow-up: `check-expansion-quotes.mjs` resolves a source ID to the last folder that has it instead of per file, and `pipeline handoff` names the freshness record for the merchant MCC folder ([catalog release](ops/catalog-release.md#renewal-2026-10-05renewal1-prepared-2026-10-05)).
5. Optional (Evan): revoke the legacy HS256 JWT secret in Supabase once sessions issued before the switch have expired.

- Later phases, in Evan's order (2026-10-03): 10 merchant-expansion pipeline → Web Store release; 4 terms-change detection is revisited after 9; 6 site coverage harness ([roadmap](product/roadmap.md)).
- Open for Evan from Phase 7 M3: Aer Lingus and Iberia Avios stay unvalued unless he wants parity with British Airways; a second publisher would value U.S. Bank Altitude, SKYPASS, Lufthansa, Cathay, Frontier.
- Enable GitHub private vulnerability reporting on the repository, which [`SECURITY.md`](../SECURITY.md) tells reporters to use (Evan, repository settings).
- Verify the `orderConfirmation` URL patterns on a real order per retailer before the Web Store release (Evan).
- The luna rows are one repeat each; a second repeat would firm up the comparison with gpt-5.5 (live run, Evan's call).
- Human spot-check of the agent-verified labels: deferred by Evan on 2026-10-02.
- `core.hooksPath` is `.githooks` in the shared `.git/config` of Evan's clone; other clones run `git config core.hooksPath .githooks`; Claude Code checkouts need a local `CLAUDE.md` with `@AGENTS.md`.
- Catalog builder maps gold `usMerchantsOnly: null` to `false`, losing "not stated"; the catalog omits the Chase Lyft promo and targeted Quicksilver offers ([cards](domain/cards.md)).
- Housekeeping: delete the stale local `extension/CLAUDE.md` (gitignored, describes removed code); revoke the keys from the retired `simulation/` prototype if not done; remove the merged `AICheckout-p9-m3b` worktree when Evan agrees.
