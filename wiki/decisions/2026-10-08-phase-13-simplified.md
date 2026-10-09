---
type: Decision
title: Phase 13 simplified — no isolation audit, no separate held-out agent; generic rules are what matters
description: Evan, 2026-10-08 — the reader developer (Fable 5.1) need not be sealed off from held-out A and no independent agent runs held-out A; the requirement is a generic, store-agnostic reader, built efficiently and simply. The coordinator runs held-out A through the harness; the report says isolation was not enforced.
status: accepted
tags: [decision, phase-13, reader, eval]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-08T21:30:00Z
sources:
  - resource: ../product/phase-13-reader.md
    title: Phase 13 plan (generic cart reader v1)
  - resource: 2026-10-08-pause-capture-quality-target.md
    title: Capture paused at about 300 stores; the ≥ 99% bar becomes a quality target
---

# Phase 13 simplified (2026-10-08)

## Context
The coordinator's Phase 13 plan sealed held-out A from the reader developer: an isolation audit of every developer transcript and a separate evaluation agent for the held-out runs. Evan, in chat on 2026-10-08: "no need for isolation audit or held out A run by another agent, leaking is not a bad thing, we just dont want store specific, generalizing, keep it efficient and simple".

## Decision
- No isolation audit and no separate evaluation agent. The coordinator runs held-out A through the harness (`run.mjs --split heldout-a --confirm-heldout-run <n>`; the harness's limit of two runs stays).
- The developer (Fable 5.1) still tunes from development pages and failures, by default; strict isolation is not enforced.
- The hard requirement is a **generic** reader: no domain lists, hostnames, per-site selectors or class names. The harness bundle tripwire and the independent code review check this.

## Consequences
- Held-out A measures how the rules carry over to stores they were not tuned on, not a sealed test; `docs/evals/reader-v1.md` says so beside every held-out number.
- Fewer agents and steps: develop, review, held-out run, report.
