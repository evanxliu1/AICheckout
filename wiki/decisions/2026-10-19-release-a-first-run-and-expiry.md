---
type: Decision
title: Release A first run, refresh the releases at install, say "checking" instead of "expired" while the first fetch runs, version 2.1.0, a static uninstall page without parameters
description: Because every bundled catalog expires 30 days after its verification date and a Web Store build is installed for months, a new install must fetch the hosted releases at once; the planner chose an install-time refresh and a "Checking for updated terms…" state over shipping with a longer catalog window (which the schema forbids) or accepting "terms expired" on first run. Also the first store version number and the uninstall URL shape.
status: accepted
tags: [decision, phase-15, extension, catalog, first-run]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-20T07:00:00Z
sources:
  - resource: ../product/phase-15-release-a.md
    title: Phase 15 plan (15.4)
  - resource: ../system/extension.md
    title: Extension (catalog refresh, merchant release refresh, weekly alarm)
  - resource: ../../extension/src/background/index.ts
    title: scheduleRefresh (REFRESH_FIRST_MINUTES = 2)
  - resource: ../../extension/src/state/catalog.ts
    title: currentCatalog (newest valid wins; both expired → newest)
  - resource: 2026-10-03-expired-catalogs-keep-answers.md
    title: Decision, when both catalogs have expired
---

# Release A first run: refresh at install, "checking" copy, version 2.1.0, static uninstall page (2026-10-19)

## Context
A catalog release is valid for at most 30 days after its `verifiedAt` (schema rule; renewed about monthly). The extension bundles the catalog of its build and fetches the hosted one weekly, first two minutes after install (`REFRESH_FIRST_MINUTES`, Phase 14.6). A Web Store build stays installable for months, so most new installs will carry an expired bundled catalog, and the engine answers `catalog-expired` until the first fetch lands; with Render's free instance cold that can be a minute or two of "Card terms expired" on a stranger's first impression. There is no uninstall URL today, and the manifest version is still the local pilot's `2.0.0`.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Expired bundle at install | Lengthen the catalog window (forbidden by the 30-day schema rule and the freshness policy); ship a store update after every renewal (a review cycle a month); refresh at install and say so | **Refresh at install** (`refreshReleases` from `onInstalled` or a one-shot alarm under 10 s; the weekly alarm unchanged) and a **"Checking for updated terms…"** state in popup and badge while the first refresh is pending and the catalog in effect has expired; after a failed first refresh the existing expired copy with "Check for updated terms" |
| Which catalog the submitted ZIP bundles | Whatever `main` has; the renewed catalog | **The renewed catalog** (15.R before 15.7), so the window is as long as it can be for the first weeks of installs |
| Uninstall URL | None; the site's page with the install ID so it can offer Delete my data; a static page | **Static `/uninstalled/` with no parameters**: an ID in a URL would reach hosting access logs; the page says what was deleted on the device, that server rows expire in 90 days, and that Delete my data must be used before uninstalling; uninstall counts come from access logs only |
| Version | Keep `2.0.0`; `2.1.0`; `3.0.0` | **`2.1.0`** (behaviour changed: any store, telemetry, no savings; not a rewrite); each later store upload increments; data releases need no upload. Listed as decision 5 for Evan |
| No cards after onboarding is closed | Hide the badge until cards exist; keep the "Pick your cards" pill | **Keep the pill** (it is the way back to onboarding; dismiss and "Not on this site" work as today), checked on a generic store in 15.4 |

## Decision
Phase 15.4 implements the chosen column. The "checking" state exists only while a refresh started at install (or by the shopper) is pending and the catalog in effect has expired; it never hides an expiry that a finished refresh could not cure.

## Consequences
- One more alarm name or an extra call on `onInstalled` (the implementer's choice, documented on the extension page); `release-package.mjs` invariants unchanged (`setUninstallURL` needs no permission).
- `extension/package.json`, `manifest.json`, `e2e/release-assets.spec.ts` and `scripts/package.test.mjs` move to `2.1.0`; the store media are regenerated against the `2.1.0` ZIP (15.6).
- The support page explains the first-run check and the offline case (a valid cached catalog works offline; an expired one needs one successful check).
- The site gains `/uninstalled/` (15.5).

## Implementation notes (2026-10-20, Phase 15.4)
- `refreshReleases` is called directly from `onInstalled` (`reason: 'install'`); no second alarm. A failed install refresh schedules no retry of its own: the weekly alarm's first run (2 minutes) is the retry.
- The fetch had to leave the request queue: both the state service's and the vault service's queues used to be held for the whole fetch, so an install-time fetch would have blocked onboarding's first request for up to 90 s on a cold instance. Only the commit joins the queues now ([extension](../system/extension.md#first-run-and-expiry-phase-154)).
- `checkingTerms` is true for any `refreshReleases` call in flight (the weekly one too) while the catalog in effect has expired, not only one started at install: the condition is "a refresh that could cure this expiry is pending". The flag is worker memory; a worker stopped mid-fetch shows the expiry.
- The worker broadcasts `terms:checked` when a refresh settles; the popup reloads on that, not on `badge:changed` (sent after every page request, which would loop).
- The uninstall URL is the API origin's `/uninstalled/` (the same Render service serves the site), set on worker start in hosted builds only.
- The no-cards pill opens onboarding and expands nothing, so it has no per-tab "Dismiss" (the table above assumed it did). Left unchanged; the review decides whether to add a panel.

## Amended after the independent review (2026-10-20)
- `checkingTerms` counts only a refresh's **catalog step** in flight, not the whole call: a locked vault's merchant-only refresh cannot cure an expiry, and an unlock during it used to show "Checking…" for terms nobody was fetching. The weekly refresh still counts (it can cure the expiry).
- The no-cards pill gets a per-tab dismiss beside it (a round navy icon button, "Dismiss for this tab (AI Checkout)", the existing `badge:dismiss`), as the table assumed: the pill shows at every https cart for a shopper with no cards. No panel was added.
- Accepted as is: the broadcast after every settled refresh (no loop: nothing a page sends triggers a refresh broadcast), and the few-milliseconds window in which a popup subscribes to `terms:checked` after the refresh settled (it then shows "Checking…" until reopened or until its next request).

## Status
Accepted 2026-10-19 (planner; version number listed as decision 5 in the [plan](../product/phase-15-release-a.md#8-decisions-needed-from-evan)).
