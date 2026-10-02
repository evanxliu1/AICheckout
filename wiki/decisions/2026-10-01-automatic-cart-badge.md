---
type: Decision
title: Show the best card automatically on supported carts; make the vault optional
description: Zero-click badge on supported carts, local-first storage with an optional passphrase vault, URL-only order detection for savings.
status: accepted
tags: [decision, extension, product, privacy]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T03:00:00Z
sources:
  - resource: ../archive/phase2-goal.md
    title: Phase 2–6 plan (archived)
---

# Show the best card automatically on supported carts; make the vault optional (2026-10-01)

## Context
The owner asked for Honey / Capital One Shopping style behavior: the answer appears on the cart without a click.

## Options considered
| Option | Fit | Why not / why |
| --- | --- | --- |
| Click-to-read popup only | Minimal permissions | Shoppers must remember to click |
| **Automatic badge on the three supported hosts** | Chosen | Host permissions for exactly those hosts |

## Decision
- A badge (iframe extension page in a closed shadow root) shows the best owned card and cash back; clicking expands ranked cards, payment path, editable amount.
- The content script never receives card data; it forwards `{merchantId, amountCents, kind, extractorVersion}` to the service worker.
- Host permissions and content scripts are derived from adapter `matchPatterns`.
- Vault is optional and off by default; state lives in `chrome.storage.local`.
- Savings: order completion recognized by URL pattern only (unverified until checked on real orders); the badge asks once which card was used.

## Consequences
- `orderConfirmation` URL patterns must be verified on real orders before the store release. See [cart badge](../system/cart-badge.md) and [extension](../system/extension.md).

## Status
Accepted 2026-10-01 by Evan Liu. Recorded retroactively on 2026-10-02 from the archived plan; the body summarizes it, the archive holds the original wording.
