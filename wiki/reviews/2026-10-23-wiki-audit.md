---
type: Review
title: Wiki audit 2026-10-23
description: Semantic audit of the LLM wiki for reversed decisions still stated as current, unretired records, stale directives, inline history and duplicated facts; fixes applied with Evan's answers.
status: stable
verified_commit: 2c55174e
tags: [review, wiki, audit]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-23T19:00:00Z
---

# Wiki audit 2026-10-23

## Verdict

No decision was found reversed and silently still in force in the code. The wiki, though, stated about 60 replaced rules as current, mostly from four chains: the legacy adapters (retired unconditionally 2026-10-19), the reader-eval rules Evan relaxed on 2026-10-08, catalog publishing (CLI on `publish <version>` since 2026-10-05) and telemetry retention (daily pg_cron since 2026-10-20). All are fixed on `wiki-audit-2026-10-23`; the live wiki went from 58 pages / 994 KB to 55 pages / 866 KB.

## Scope and method

Whole wiki plus `AGENTS.md`, `README.md`, `docs/evals/` and code comments citing the wiki, at `main` `2c55174e`. `scripts/lint_wiki.py` (clean at start) and the audit skill's `find_stale.py` gave the shortlist; four independent read-only subagents built the decision timeline per area (reader eval and capture; extension and telemetry; catalog, pipeline and ops; wiki structure) against the code and git; the coordinator spot-checked their claims (migration count, duplicated progress entry, code comments, record status lines). Three subagents then applied the fixes on disjoint files; the coordinator did the decision records, directives, `now.md`, indexes and link repointing. Agent-verified, not human-verified.

## Findings

**High (fixed)**
- Legacy adapters "stay until the generic reader matches them": `system/merchant-coverage-design.md:53`, `product/phase-10-merchant-expansion.md:59,77`, directive row 2026-10-06, four decision index summaries. Replaced by [retire the legacy adapters](../decisions/2026-10-19-retire-legacy-adapters.md).
- Telemetry retention "inside `ingest_events`, not `pg_cron`": `system/telemetry-design.md:69`, `product/phase-15-release-a.md:179`, decisions index. Replaced by [the 15.5b privacy fixes](../decisions/2026-10-20-privacy-fixes-delete-order-and-scheduled-prune.md).
- Reader-eval rules replaced on 2026-10-08 (330 + 500 / 840 stop, two labellers, 90% agreement, "fails twice", reader-developer isolation) stated as current in the Phase 10/12/13 pages, the capture runbook, the glossary and the protocol's body.
- `system/rewards-engine.md:64` and `domain/merchants.md` described seed release `2026-10-10.seed.1` (18 records); the code ships `2026-10-11.mcc.3` (640).
- `now.md` called PRs #102 and #104 unmerged and counted 13 migrations (14).

**Medium (fixed)**
- Four publishing directive rows (2026-09-29, 10-01, 10-02, 10-03) unmarked though the 2026-10-05 row replaced them.
- [Phase 13b manual read](../decisions/2026-10-09-generic-read-on-legacy-site-pages.md) fully superseded but `accepted`; ten partly superseded records without a Status note.
- Duplicated "15.5 reviewed and fixed" progress entry in the Phase 15 plan; migration counts, hosted-release expiry, publish flow and retention restated on several pages.
- Stray `</content>`/`</invoke>` lines in the 2026-10-08 pause record.

**Low (fixed)**
- Inline "since 2026-…" history across system and ops pages; milestone narrative in `card-pipeline-commands.md` and run narrative in `merchant-pipeline.md` (52 → 29 KB).
- Two code comments (`extension/tests/catalog-newest.test.ts:2`, `packages/rewards-core/src/merchant-match.ts:56`).

**Checked and fine**
- Robots, CAPTCHA, signed-in and lingering-item rules; curation model; agent model pins; Helios → Ocean; catalog v2 still generated and CI-checked; no code contradicts an accepted decision.

## Approach assessment

The project's convention (records immutable except their Status, partial supersession in Status prose, no `supersedes` frontmatter) kept history intact but let summaries and live pages drift. Evan's retention answer keeps the convention: fully reversed records stay in `decisions/` as `superseded`; redundant pages go to the archive.

## Docs versus code

- `supabase/README.md` still says ten migrations (there are 14); not edited (package README).
- The local, gitignored `extension/CLAUDE.md` describes a 2026-01 prototype and is loaded as agent context.

## Recommended next steps

1. Evan: formal approval of the revised Phase 14 plan (still open).
2. Fix `supabase/README.md`'s migration count; delete or replace `extension/CLAUDE.md`.
3. Next audit: start from this page's commit with `find_stale.py --since`.

## Related

- [User directives](../product/user-directives.md) (retention row 2026-10-23)
- [Archive](../archive/index.md)
- [Log](../log.md)
