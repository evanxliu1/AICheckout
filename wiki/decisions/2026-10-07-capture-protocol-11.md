---
type: Decision
title: Pane exports collected from the operator transcript (generic-reader-protocol.11)
description: Coordinator, 2026-10-07, on Evan's "figure it out" — after a 16-store pilot with 0 captures, the operator no longer writes exports; a committed, tested collector rebuilds each pane-dom.2 export byte-exact from the operator's transcript (inline or harness-saved chunk results), checks its SHA-256 and stamps step times; one record schema; pilot tool-error stores and hsn.com get their one more session.
status: proposed
tags: [decision, phase-12, capture, merchants, eval]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-07T05:40:00Z
sources:
  - resource: ../../docs/evals/generic-reader-protocol.md
    title: Generic cart reader evaluation protocol (Amendment 10)
  - resource: ../../evals/merchants/capture/collect-pane-exports.mjs
    title: Pane export collector
---

# Pane exports collected from the operator transcript (2026-10-07)

## Context
The first pane pilot under `.10` (16 stores, 2026-10-07 04:58–05:05 UTC) captured nothing. Eight stores ended `tool-error` for one reason: the pane JavaScript tool can't return a `pane-dom.2` chunk (up to 400,000 characters; even a 164,615-byte export failed). The Claude Code harness saves the oversized result to a tool-results file, which the operator's restricted tools can't turn into `dom.json`. Evan said in chat: "figure it out, capture the cart pages", then "you may edit" (the operator definition).

## Options considered
| Option | For | Against | Chosen |
| --- | --- | --- | --- |
| Collector over the transcript | Byte-exact (SHA-256 checked); no change to `pane-export.js` or the format; no export passes through the operator's output; cheap | The coordinator, not the operator, writes the file; tool-results files must stay until collected | **Yes** |
| Smaller chunk size (`pane-dom.3`) | Operator keeps writing | New format version needing Evan's approval of the script; 0.5–1.7 MB per state copied through the operator's output | No |
| Allow the operator `cp`/redirection | Simple | Widens the operator's Bash and the audit's blind spots | No |

## Decision
- Checklist step 7 changes as in [Amendment 10](../../docs/evals/generic-reader-protocol.md#amendment-10-2026-10-07-generic-reader-protocol11); `pane-operator.md` updated (Evan's permission).
- A collector failure counts as the export mismatch (one more session, then `tool-error`).
- One record schema `pane-record.1`; the collector stamps times and a text-free timeline.
- Pilot `tool-error` stores and hsn.com (no evidence export) get their one more session.

## Consequences
The independent reviewer signs `.11` before any `.11` capture. The audit still flags operator Writes outside records and data, and the collector is tested on synthetic transcripts and checked on a real pilot transcript.
