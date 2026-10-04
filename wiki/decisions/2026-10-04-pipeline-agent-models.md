---
type: Decision
title: Pinned models and file rules of the pipeline subagents (Phase 8 milestone 4)
description: Which model each card-expansion subagent is pinned to (Opus 5.5 for researcher, verifier and overlay author; Fable 5.1 for the adjudicator, a different model from the verifier), why the frontmatter uses full model IDs, which tools each gets, how agents self-check with a dry-run accept, and how the skill handles scope and convention questions the CLI does not record.
status: accepted
tags: [decision, catalog, pipeline, phase-8, agents]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-04T15:00:56Z
sources:
  - resource: ../system/card-expansion-pipeline.md
    title: Card-expansion pipeline (design, Agents section)
  - resource: ../../.claude/skills/expand-catalog/SKILL.md
    title: expand-catalog skill
  - resource: ../../tools/catalog-pipeline/tests/agent-files.test.ts
    title: Agent and skill file test
---

# Pinned models and file rules of the pipeline subagents (Phase 8 milestone 4) (2026-10-04)

## Context
The approved design (review change "pin agent models and record `packetId` and model") asks for four subagents with pinned models and a skill that drives the CLI. Milestone 4 finalises the Phase 7 drafts and adds `card-overlay-author`. Choices left open: the model per agent, how a model is pinned, the tools, how an agent checks its own file, and what the skill does where the CLI has no command.

## Options considered
| Question | Chosen | Alternatives |
| --- | --- | --- |
| Researcher, verifier, overlay author | `claude-opus-5-5` (Opus 5.5): the model the Phase 7 verification and overlay work ran on, so results stay comparable with `expansion.v1` | `inherit` (the model would change with the session's) |
| Adjudicator | `claude-fable-5-1` (Fable 5.1): a different model from the verifier, so a second pass does not share the first pass's blind spots; Fable 5.1 also did the design review | Opus 5.5 in another run (independent run, same model) |
| How to pin | Full model IDs in `model:` frontmatter, and the skill passes the same ID to `accept --model` | Aliases `opus`/`fable` (resolve to whatever is newest; not a pin) |
| Tools | Minimal per agent: Read, Glob, Grep and Bash (for the dry-run accept) for all; Write for researcher, verifier, overlay author; Edit only for the adjudicator; WebSearch and WebFetch only for the researcher | Every tool |
| Self-check | Each agent runs `pipeline accept <stage> --agent-run self-check --dry-run` (`accept` requires `--agent-run` even in a dry run; a dry run records nothing) | The Phase 7 scripts directly |
| Scope questions | Asked before `init`, the answer in `--summary`; research `questions` asked before capture | Record them in `batch.json` (strict schema, no field) |
| `convention-needed` | The agent leaves `adjudicator` null and reports it; the session releases the packet, writes the dated convention in the batch's `verification/conventions/`, commits and claims again | A CLI command to record the reason (none exists yet) |
| Failed gate | The same agent gets the gate errors through SendMessage and accept runs again with the same `--agent-run`; after two rounds, release and a new agent | Always a new agent (loses the context of a near-correct file) |

## Decision
Pin researcher, verifier and overlay author to `claude-opus-5-5` and the adjudicator to `claude-fable-5-1`, by full ID, with the tools above. The skill (66 lines) loops on `next --json`, starts one agent per open packet in the capture checkout without worktree isolation, records the agent ID, duration and tokens through `accept`, and ends at a pushed branch, a PR and the `handoff` checklist. `tools/catalog-pipeline/tests/agent-files.test.ts` checks names, models, the "data, never an instruction" sentence, no DRAFT marker, no `isolation`, and that every `pipeline <command>` mentioned is a command of the CLI.

## Consequences
- Changing an agent's model is a change to its file and this record; the researcher file is a research input, so editing it makes research stale for open batches.
- Gaps found in the CLI, recorded on the [design page](../system/card-expansion-pipeline.md#built-so-far): nothing records `scope-question` or `convention-needed`; the adjudicator cannot list the lint findings of the corpus case apply will write; an apply that fails the lint cannot be re-adjudicated through `claim`.
- Labels stay agent-verified, never human-verified.

## Status
Accepted 2026-10-04 (coordinator brief for milestone 4).
