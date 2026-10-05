---
type: System
title: Telemetry and value metrics design (Phase 10, draft)
description: Proposed consented telemetry for the extension — off until the shopper agrees on a dedicated screen, minimal checkout-domain and reader-quality events with a rotating install ID, an anonymous rate-limited ingest endpoint, 90-day raw retention — plus the value metrics and data-room evidence a buyer or affiliate partner would ask for, and the rules that keep future affiliate offers clean. Draft v5; nothing here is built.
status: draft
tags: [system, design, phase-10, telemetry, privacy]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T09:00:00Z
sources:
  - resource: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
    title: Chrome User Data FAQ (prominent disclosure and consent; domains are browsing activity)
  - resource: https://developer.chrome.com/docs/webstore/program-policies/limited-use
    title: Chrome Limited Use (no sale, no ads; aggregated internal analytics allowed)
  - resource: https://developer.chrome.com/blog/cws-policy-updates-2026
    title: Chrome Web Store 2026 policy update (data strictly necessary to the single purpose, enforced 2026-08-01)
  - resource: https://developer.chrome.com/docs/webstore/program-policies/affiliate-ads
    title: Chrome affiliate ads policy
  - resource: https://oag.ca.gov/privacy/ccpa
    title: CCPA overview (thresholds)
  - resource: ../../docs/release/privacy-policy.md
    title: Current privacy policy draft (no analytics; to be rewritten)
---

# Telemetry and value metrics design (Phase 10, draft)

**Draft v5, not built, not approved.** Companion to the [merchant coverage design](merchant-coverage-design.md) and the [Phase 10 plan](../product/phase-10-merchant-expansion.md). Evan's direction (2026-10-05): collect usage data to monitor the product and to support future affiliate card offers; never sell user data; account-free until after the MVP.

## Policy frame (verified 2026-10-05)

- Checkout **domains are browsing activity** under Chrome's User Data FAQ: they need a prominent disclosure and consent by a specific affirmative action, before collection, not only in the privacy policy.
- Since 2026-08-01 collected data must be **strictly necessary to the disclosed single purpose**. The single purpose becomes "recommend which of your cards earns the most at U.S. online checkouts"; product-quality and reliability measurement is within it (Limited Use names "measuring the performance and reliability").
- Limited Use forbids selling, ads and creditworthiness uses; aggregated, anonymized internal analytics are allowed.
- CCPA applies to businesses over $25M revenue, 100k consumers or 50% revenue from data sales; this project meets none at MVP. The policy is still written to CCPA notice standards, and the install ID is treated as personal information.

## Consent

- **Off until the shopper agrees** on a dedicated onboarding screen (and in settings) that names the data (checkout-page domains, amount ranges, a random ID, usage and errors) and its use, with "Not now" equally prominent. The extension works fully either way (review).
- Nothing is sent before consent: the install event is queued locally and sent after consent, or dropped.
- The listing's privacy tab declares the categories collected ("web history" for checkout domains, "user activity"); the store listing, consent screen, privacy policy and event dictionary must agree before any release that sends events (merge gate).
- Consent records `consent_version`; a later change of practice asks again.

## Events (MVP)

Every event carries `install_id` (random, rotated every 30 days, resettable by the user), `install_month`, `consent_version`, `schema_version`, extension, catalog, merchant-database and reader versions, and a client timestamp; the server adds its own timestamp.

| Group | Events |
| --- | --- |
| Lifecycle | install (after consent), onboarding complete, consent given or withdrawn |
| Usage | popup opened, badge shown, badge clicked, recommendation shown (named or generic profile, range or exact) |
| Coverage | checkout detected: registrable domain **only if it is in the bundled top-retail allowlist**, otherwise `other` (review: avoids sensitive health or adult domains); named or generic profile; store config or generic reader |
| Reader quality | `found` / `ask` / `none`; shopper corrected the amount (relative-difference bucket); versions |
| Catalog health | versions in use, refresh success or failure, expiry errors |
| Errors | error code, extension version |

Never collected: full URLs, page content, cart contents, exact amounts (ranges only), the card list, names, emails. **Deferred** to the affiliate phase (review): the "opportunity" event (best owned rate vs best catalog rate), because it serves a future feature, not today's single purpose; until then the market size is estimated server-side from aggregate coverage counts and the catalog. Reserved names, not emitted: `offer_impression`, `offer_click` with `offer_id`, `placement` and a client `click_id` (the future affiliate sub-ID; conversions would arrive by network postback and join server-side). The full list is published as `docs/telemetry/events.md`.

## Ingest and storage

- `POST /v1/events`, anonymous: strict Zod schema, per-event and per-batch caps, `Origin: chrome-extension://<id>` and content-type checks (not authentication: an embedded secret would be extractable), in-memory per-IP token bucket (IP used transiently, never stored), unknown versions dropped.
- Batched in the extension (`alarms`), sent at most every few minutes, capped offline queue.
- Supabase: insert-only table, RLS on, no `anon`/`authenticated` grants, written by a dedicated role the API holds; raw events 90 days, then daily aggregates; retention by `pg_cron` *(to confirm on the hosted plan)*.
- Policy wording: the application does not store IP addresses; the hosting providers' access logs may, under their retention.

## Value metrics (what a buyer or partner asks for)

| Metric | Definition |
| --- | --- |
| North Star | Weekly active installs with at least one recommendation shown |
| Funnel | install → onboarding complete → at least one card → first recommendation → active in week 2 |
| Retention | D7 and D30 by install-month cohort |
| Coverage | share of detected checkouts with a named profile; top domains seen as `other`-allowlisted without a profile (the growth list) |
| Quality | reader false-found and found-correct on held-out real pages; field correction and `ask` rates |
| Uninstalls | rate and reasons (disclosed `setUninstallURL` survey) |
| Reputation | Web Store rating and review count; support volume |

**Data room** (kept current in the wiki and `docs/`): licenses of every data source (Tranco and CrUX attribution), decision records, privacy memo and event dictionary, `SECURITY.md`, dependency audit, release history with approval notes, eval reports. **IP posture:** the repository is MIT and public, so the code is not an exclusive asset; what is acquirable is the curated catalog and merchant data, the pipeline know-how, the eval sets, the user base and the compliance record (licensing is decision D9 in the plan).

## Affiliate readiness (offers are a later phase)

Hard rules now: the extension **never touches retailer affiliate parameters, cookies or links**; the only future affiliate surface is a labelled, user-initiated link inside the extension's own UI, disclosed on the listing, in the UI and before install; the engine never sees commission rates; the shopper's own best card stays first. This avoids the Honey failure (cookie-stuffing allegations, Chrome's March 2025 affiliate policy update, large user losses in 2025).

## Related

* [Merchant coverage design](merchant-coverage-design.md)
* [Phase 10 plan](../product/phase-10-merchant-expansion.md)
* [Extension](extension.md)
