---
type: Decision
title: Ship site adapters inside the extension package, never downloaded
description: Cart readers are declarative JSON specs bundled in the extension; only a future kill switch may be fetched remotely.
status: accepted
tags: [decision, extension, policy]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived)
---

# Ship site adapters inside the extension package, never downloaded (2026-09-29)

## Context
Chrome Web Store policy (checked 2026-09-29) forbids interpreters running commands fetched remotely, even as data.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| Remote adapter specs | Fast updates | Policy violation |
| **Bundled declarative specs + one fixed interpreter** | Chosen | New sites need an extension release |

## Decision
- `extension/src/checkout/adapters/*.json`, validated by Zod, read by one generic interpreter. Specs stay declarative: selectors, label map, limits; no conditionals or expressions.
- A remote kill switch (disable an adapter by ID and version) is allowed and planned for Phase 6.

## Consequences
- Adding a merchant means a reviewed extension release. See [extension](../system/extension.md).

## Status
Accepted 2026-09-29. Recorded retroactively on 2026-10-02 from the archived plan; the body summarizes it, the archive holds the original wording.
