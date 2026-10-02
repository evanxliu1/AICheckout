---
type: Decision
title: Build all three frontends on Helios tokens with our own React components
description: Use HashiCorp Helios design tokens and Flight icons (MPL-2.0) via a React component package, since Helios components are Ember-only.
status: accepted
tags: [decision, frontend, design]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived)
---

# Build all three frontends on Helios tokens with our own React components (2026-09-28)

## Context
The extension popup, review app and public site needed one consistent, accessible design system.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| **Helios tokens + `packages/ui` React components** | Chosen | Framework-neutral tokens; we rebuild components to Helios specs |
| Helios Ember components | Native | Not React |

## Decision
- `packages/ui` implements Helios-spec components on `@hashicorp/design-system-tokens`; light theme only; icons inlined per icon.
- No HashiCorp logos or branding; credit Helios and Flight in the README.

## Consequences
- CSP stays `style-src 'self'`: no inline styles or remote fonts. See [UI library](../system/ui-library.md).

## Status
Accepted 2026-09-28 by Evan Liu. Recorded retroactively on 2026-10-02 from the archived plan; the body summarizes it, the archive holds the original wording. The Helios look (token values, system font) is superseded by [2026-10-02-ocean-theme](2026-10-02-ocean-theme.md); the component approach stands.
