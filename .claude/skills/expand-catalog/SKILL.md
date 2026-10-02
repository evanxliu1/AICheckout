---
name: expand-catalog
description: DRAFT (2026-10-02, not yet usable; the pipeline CLI is built in Phase 8). Use when Evan asks to add cards or issuers to the AI Checkout card catalog ("expand to issuer X, these cards", "refresh the Chase cards", "check the catalog sources are still current"). Drives the tools/catalog-pipeline CLI through research, capture, extraction, drafting, subagent verification and adjudication, overlay, build and eval, and stops at a ready branch; Evan publishes.
---

# Expand the card catalog (DRAFT)

> **Draft, 2026-10-02 (Phase 7 Stage 2 M11).** The `pipeline` CLI this skill drives does not exist yet; it is built in Phase 8. Until then, do not follow this playbook: use the Stage 1 scripts as described in `wiki/system/catalog-expansion.md`. Design: `wiki/system/card-expansion-pipeline.md`. Decision (proposed): `wiki/decisions/2026-10-02-agent-driven-card-pipeline.md`.

## Before anything

1. Read `AGENTS.md`, `wiki/now.md` and `wiki/system/card-expansion-pipeline.md`. Follow the session protocol (update the wiki last).
2. Work in the checkout that has the captures (they are gitignored). Run `pipeline status`; if a batch for this request exists, resume it instead of starting another.
3. Restate the request as a batch: issuer(s), card names, refresh or new. If the card list or scope is unclear (business cards, closed products, store cards), ask Evan once, then record his answer in `batch.json`.

## Hard rules

- **Never publish** a catalog release, never sign in to any hosted service (review app, Supabase, Render, GitHub web), never push `main` or merge. The run ends at a committed branch and `pipeline handoff`; Evan publishes in the review app.
- **Never re-capture over a frozen capture.** A capture file is never overwritten or edited. A changed page becomes a new dated capture in a new batch (`pipeline freshness`). Never edit released corpora (`real.v2.2`, `expansion.v1`), released prompt versions or validator versions, and never tune prompts on held-out data.
- **Models only through local subscription CLIs.** Extraction runs through the CLI (Codex, gpt-5.6-luna `xhigh`); judgment steps run as Claude Code subagents. No paid API keys, no local models, nothing on Render or CI.
- **Reviews by subagents.** Every verification and adjudication goes to a separate, independent subagent; a verifier never adjudicates its own findings. Record provenance as `agent-verified`, never `human-verified`.
- **Quotes of at most 25 words**, verbatim from one capture, and quotes of one item must not overlap or abut into a longer run. Run the quote check before every commit of expansion files. Never paste capture text into chat, commits, PRs or the wiki.
- **Safety on issuer and retailer sites.** Never type secrets, create accounts, apply for cards, accept terms or submit forms.
- Use absolute dates (`YYYY-MM-DD`).

## The loop

```
pipeline init --batch <issuer-slug>-<YYYY-MM> --issuer "<Issuer>" --cards "<names>"
repeat:
  pipeline next --json
```

Act on the `kind` it returns:

| kind | Do |
| --- | --- |
| `cli` | Run the printed command (capture, extract, validate, draft, apply, build, eval). On exit 3 (usage limit), report the pause and either wait (`--wait-minutes`) or stop. |
| `agent` | Start the named subagent with the printed work packet: `card-researcher` (research), `card-verifier` (verify, one per issuer), `card-adjudicator` (adjudicate, one per issuer, never the same run as the verifier), the overlay author (overlay, per M4). Then run `pipeline accept <stage> --issuer <slug>`. If the gate fails, send the subagent the gate errors (file and field names only) and accept again. |
| `queue` | Resolve the review-queue items owned by the session (capture hints, re-runs, conventions). Ask Evan only for items owned by `evan` (scope questions). |
| `wait` | A pause is in effect; report the time and stop or wait. |
| `handoff` | Run `pipeline handoff`, commit, and report its checklist to Evan. Stop. |

Commit after every accepted stage (state records and committed outputs only; never captures or traces), with messages that name the batch and stage.

## Conventions

New labelling judgment calls go into `evals/curation/batches/<batch>/verification/conventions/` (general rules stay consistent with `evals/curation/expansion/verification/conventions/general.md`). A convention change makes adjudication stale for the affected cards; re-adjudicate, do not hand-edit labels.

## Finish

`pipeline status` shows every card `done`, `dropped` or held out with a reason; `npm run lint`, `format:check`, `typecheck`, `npm test` and `python3 scripts/lint_wiki.py` pass; `wiki/now.md` and `wiki/log.md` are updated. Report to Evan: batch, branch, cards added/dropped/held out, metrics summary, the handoff checklist (publish steps and the release expiry date).
