---
type: Decision
title: The coordinator publishes catalogs from the CLI on Evan's chat instruction
description: Evan logs a CLI session in himself; the coordinating session uploads captures, creates the draft and publishes a release through the existing review API only after Evan types "publish <version>" in chat. Chosen over a scoped database publish token.
status: accepted
tags: [decision, catalog, release, review, phase-9]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T04:40:00Z
sources:
  - resource: ../ops/catalog-release.md
    title: Catalog release runbook
  - resource: ../../apps/api/src/review-routes.ts
    title: Review API routes
  - resource: ../../supabase/migrations/20260926032621_reviewed_catalog.sql
    title: require_reviewer and publish_catalog
---

# The coordinator publishes catalogs from the CLI on Evan's chat instruction (2026-10-05)

## Context
Release 2 was published through the [assisted browser flow](../ops/catalog-release.md#assisted-flow-coordinator-drives-the-browser): Evan signed in, picked up to 14 capture folders in a file picker and ticked the attestation. The renewal `2026-10-05.renewal.1` needs 14 folders across three checkouts. Evan wants the coding agent to do the whole publish, including the capture upload, with his part reduced to saying so in chat.

Every review RPC authorizes through `catalog_private.require_reviewer()`: `auth.uid()` must be a reviewer with a live, unbanned, non-anonymous Supabase session. The API passes the caller's JWT through and never substitutes an administrative credential.

## Options considered
| Option | For | Against |
| --- | --- | --- |
| **CLI session login** (chosen): Evan runs `pipeline login` in his own terminal and types his password into a hidden prompt; the CLI keeps the Supabase session's refresh token outside the repository (mode 600) and calls the existing review API | No migration, no change to the database's authorization, the same rate limits and validation as the review app; revoked by `pipeline logout` or by ending the session in Supabase | The session carries Evan's full reviewer rights, not only publishing |
| Scoped publish token: a hashed token table, minted in the review app, accepted by `require_reviewer` and the API next to a JWT | Narrow scope and its own expiry | Rewrites the security-critical authorization path in SQL, Zod and the API, adds review-app UI and a hosted migration; about two to three times the work |
| Keep the assisted browser flow | Already works | Evan still picks every capture folder and ticks the box; it does not meet the request |

## Decision
- **Session.** Evan creates the session himself (`npm run pipeline -- login`). The agent never types, prints or reads the password or the stored session; it only runs CLI commands that use it.
- **Who.** Only the coordinating session publishes, never a subagent.
- **Attestation.** Evan's chat message `publish <version>` for that one release is the attestation. The CLI refuses to publish without `--confirm <version>` equal to the draft's version. Approval does not carry over to another version or a later revision.
- **Review note.** States that the catalog is agent-verified, not human-verified, what the coordinator checked, and "published by the coding agent on Evan's chat instruction of `<UTC time>`".
- **Unchanged.** The draft must equal the catalog on `main` byte for byte (canonical JSON SHA-256), every source must match a bundled manifest hash, and the deadlines and expiry checks of the database apply.

## Consequences
- Supersedes the 2026-10-03 directive that the attestation is always Evan's tick in the review app, and the 2026-10-01 directive that Evan publishes himself; the browser flow stays available.
- The code comment "Publication is a distinct explicit human action, never an LLM tool" in `apps/api/src/review-routes.ts` is reworded: publication stays a separate explicit step on a human instruction, never a side effect of capture, draft save or extraction, and never chosen by a model.
- A stolen session file gives reviewer rights until it is revoked; `pipeline logout` revokes the session server-side.
- `2026-10-05.renewal.1` waits for this path to be built, merged and deployed (deadline 2026-11-01T00:00Z).

## Status
accepted (Evan, chat 2026-10-05)
