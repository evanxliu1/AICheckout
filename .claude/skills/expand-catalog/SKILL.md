---
name: expand-catalog
description: Use when Evan asks to add, refresh or check cards in the AI Checkout card catalog, in any words ("expand Wells Fargo as a new batch", "add these Chase cards", "refresh the Citi cards", "add issuer X with these cards"). Drives the tools/catalog-pipeline CLI (`npm run pipeline -- next --json` in a loop) through research, capture, extraction, drafting, subagent verification and adjudication, apply, overlay, build and eval, and stops at a ready branch and `pipeline handoff`; Evan publishes.
---

# Expand the card catalog

Design: `wiki/system/card-expansion-pipeline.md`. CLI: `tools/catalog-pipeline/README.md`. Every command below is `npm run pipeline -- <command>`.

## Before anything

1. Read `AGENTS.md`, `wiki/now.md` and the design page. Follow the session protocol (wiki last).
2. Work in the checkout that holds (or will hold) the batch's captures; they are gitignored and never leave it. Run `pipeline status`; if a batch for this request exists, resume it.
3. Restate the request as a batch: id `<issuer-slug>-<YYYY-MM>`, issuer, card names, refresh or new. **Scope questions go to Evan before `init`**: an issuer outside the top 10 (Chase, American Express, Citi, Capital One, Bank of America, Wells Fargo, Discover, U.S. Bank, Barclays, Synchrony), business cards, or an unclear card list. Put his answer in `--summary` (at most 300 characters, his words, no issuer text).
4. Branch from the latest `origin/main`, then `pipeline init <batch> --issuer "<Name>" --cards "<a, b>" --domains <issuer domains> [--refresh] --summary "<request>"`. Use `--refresh` when any card is already in a released corpus.

## Hard rules

- **Never publish** a catalog release, never sign in to any hosted service, never push `main`, never merge. The run ends at a pushed branch, a PR the session opens and the `pipeline handoff` checklist. The coordinator merges under Evan's standing authorization only after CI and an independent reviewer subagent pass; Evan publishes in the review app.
- **Ask Evan only** for a `scope-question` and for `publish`. Everything else is the session's.
- **Captures are frozen.** Never edit or overwrite a capture; a changed page is a new dated capture in a new batch. Never edit released corpora (`real.v2.2`, `expansion.v1`), released prompts or validator versions; never tune prompts on held-out data.
- **Models only through local subscription CLIs.** Extraction runs inside `pipeline run extract` (Codex); judgment steps are Claude Code subagents. No API keys, no local models, nothing on Render or CI.
- **Quotes at most 25 words**, verbatim from one capture, no overlapping or abutting runs. Never paste capture text into chat, commits, PRs or the wiki.
- **Safety on issuer sites**: no secrets, accounts, applications, terms or form submissions.
- Absolute dates (`YYYY-MM-DD`). Provenance is `agent-verified`, never `human-verified`.

## The loop

Repeat `pipeline next --batch <batch> --json` and act on `kind`:

| kind | Do |
| --- | --- |
| `cli` | Run the printed `command` (`pipeline run <stage>` or `pipeline rebase-anchors`). Exit 3 from `run extract` is a Codex usage limit: the cards are `paused`; re-run later or with `--wait-minutes N`. Exit 1: read the errors, fix the cause, run again. |
| `agent` | Run the printed `pipeline claim` command, then start the named subagent (Agent stages, below). |
| `queue` | `gate-failed` on an agent stage: send that agent the gate errors and accept again (below). `gate-failed` on a CLI stage (two failed runs): fix the cause. `capture-flagged` (every flagged card in one step): read `capture-report.md`; add a capture hint and re-run capture, or `pipeline resolve capture-flagged --source <id> --reason expected-short-page\|false-positive-flag\|keep-existing-capture`. A source the batch cannot use (bot wall, error page, out of scope, duplicate): `pipeline drop-source --batch <batch> --source <id> --reason bot-wall\|error-page\|out-of-scope\|duplicate`, then run capture again; never remove a source by hand. `inputs-missing`: wrong checkout; stop. `scope-question`: ask Evan. `convention-needed`: see Conventions. |
| `wait` | A usage-limit pause (`until`) or an open packet: report and wait, or stop; nothing is lost. |
| `handoff` | See Finish. |

## Agent stages

| Stage | Subagent | Pinned model (`--model`) |
| --- | --- | --- |
| research | `card-researcher` | `claude-opus-5-5` |
| verify | `card-verifier` | `claude-opus-5-5` |
| adjudicate | `card-adjudicator` | `claude-fable-5-1` |
| overlay | `card-overlay-author` | `claude-opus-5-5` |

1. `pipeline claim <stage> --batch <batch> --issuer <slug>` prints the packet path. **One agent per open packet**; never start a second agent on a packet.
2. Start the subagent (Agent tool, `subagent_type` as above) in this checkout, **never with `isolation: worktree`**. The prompt gives only the absolute packet path, the batch and the issuer slug, and says: write only the packet's `output`, never under a scratchpad, and run the dry-run accept before reporting.
3. From the completion notice take the agent ID, `duration_ms` and `total_tokens`. Note per packet: packet file, `packetId`, agent ID.
4. The chat report is only a pointer; `accept` reads the file: `pipeline accept <stage> --batch <batch> --issuer <slug> --agent-run <agent ID> --model <pinned model> --duration-ms <ms> --tokens <n>`.
5. On a failed gate, send the **same** agent (SendMessage to its ID) the gate errors as printed (paths and field names only, never capture text), then accept again with the same `--agent-run`. After two failed rounds, `pipeline claim <stage> --batch <batch> --issuer <slug> --release` and claim afresh for a new agent; the released packet's output file stays in place (an adjudicator edits it; a new verifier or researcher may overwrite it).
6. The **verifier and adjudicator are always different runs** (accept refuses otherwise). Claim adjudicate only after verify is accepted. `accept adjudicate` lints the corpus case apply will write; a `label lint:` error goes back to the adjudicator, which fixes the number or acks it. Never add or edit an ack yourself.
7. `questions` in the accepted research file are scope questions: ask Evan before capture. If his answer changes the card list, tell him the batch must be re-initialised (the CLI cannot amend `batch.json`).

## Conventions

Batch conventions live in `evals/curation/batches/<batch>/verification/conventions/` (`general.md`, `<issuer-slug>.md`); where a file is absent, agents read the frozen one in `evals/curation/expansion/verification/conventions/`. When an adjudicator or overlay author reports `convention-needed`, release its packet, write the dated convention in the batch's folder (consistent with the frozen `general.md`; ask Evan only if it is a scope matter), commit it and claim again: conventions are adjudicate inputs, so the affected cards re-adjudicate. Never hand-edit labels.

## Commits

After every accepted stage, and every CLI stage that writes committed files: first `node scripts/check-expansion-quotes.mjs --dir evals/curation/batches/<batch>`, then commit `pipeline/state.json`, `pipeline/batch.json` and the stage's committed outputs (never `captures/`, `extractions/`, `parts/` or `pipeline/packets/`), message `Batch <batch>: <stage> <issuer> accepted`. Push the branch (`git push -u origin <branch>`), never `main`.

## Build and versions

A catalog version Evan has published (`publishedVersions` in `evals/curation/catalog-batches.json`) is never rebuilt with other contents. Unless Evan asked to ship the batch, `next`'s `run build` becomes `pipeline run build --batch <batch> --proposed --version <YYYY-MM-DD>.<issuer-slug>.1`: it writes `pipeline/proposed/` and changes nothing that ships. To ship, plain `run build` with `--version <new version>` when the config's version is published. Never edit the build config, the ledger or `catalog-v3.ts` by hand.

## Finish

On `handoff`: run `pipeline handoff --batch <batch>` and work through its PR checklist (`npm run lint`, `format:check`, `typecheck`, `npm test`, `python3 scripts/lint_wiki.py`, the quote check with every capture folder; `wiki/now.md`, `wiki/log.md` and the pages it names). Start an independent reviewer subagent on the branch, fix its findings, then open the PR. Report to Evan: batch, branch, PR, cards added, dropped and held out with reasons, the eval summary, the handoff's publish steps with release version and expiry, and any "publish blocked" line. Stop there.
