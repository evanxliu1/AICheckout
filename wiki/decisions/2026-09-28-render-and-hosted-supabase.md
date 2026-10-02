---
type: Decision
title: Host the API, review app and site on Render with hosted Supabase
description: One Render web service (render.yaml) serves the Fastify API, review app and public site, backed by the owner's existing hosted Supabase project.
status: accepted
tags: [decision, hosting]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived)
---

# Host the API, review app and site on Render with hosted Supabase (2026-09-28)

## Context
The catalog API and review app needed a public home; the owner already had a Supabase project.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| **Render free web service + hosted Supabase** | Chosen | Blueprint in repo, auto-deploys `main`; free tier sleeps (~50 s cold start) |

## Decision
- `render.yaml` blueprint; Render auto-deploys `main`.
- Supabase holds Auth and PostgreSQL; public sign-ups disabled; reviewers are provisioned in `catalog_private.reviewers`.
- The owner (or the coordinating session) pushes migrations; agents never sign in to hosted services.

## Consequences
- Cold starts are visible on first request. See [hosting](../ops/hosting.md).

## Status
Accepted 2026-09-28 by Evan Liu. Recorded retroactively on 2026-10-02 from the archived plan; the body summarizes it, the archive holds the original wording.
