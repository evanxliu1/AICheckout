---
type: System
title: Telemetry, operations and value metrics design (Phase 10, draft)
description: Proposed consented telemetry with no automatic browsing data (no domains or merchants in events; shopper-initiated "Suggest this store" and "Report a problem" instead), rotating install IDs with day-since-install buckets, an anonymous rate-limited ingest RPC, 90-day retention, operations and diligence controls, value metrics and a data room for a buyer or partner, and affiliate rules. Draft v6; nothing here is built.
status: draft
tags: [system, design, phase-10, telemetry, privacy]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-06T23:30:00Z
sources:
  - resource: https://developer.chrome.com/docs/webstore/program-policies/limited-use
    title: Chrome Limited Use (browsing activity only for a user-facing feature; no sale, no ads)
  - resource: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
    title: Chrome User Data FAQ (prominent disclosure and affirmative consent)
  - resource: https://developer.chrome.com/blog/cws-policy-updates-2026
    title: Chrome Web Store 2026 policy update (strictly necessary to the single purpose, enforced 2026-08-01)
  - resource: https://developer.chrome.com/docs/webstore/program-policies/affiliate-ads
    title: Chrome affiliate ads policy
  - resource: https://oag.ca.gov/privacy/ccpa
    title: CCPA overview (thresholds)
  - resource: ../../docs/release/privacy-policy.md
    title: Current privacy policy draft (to be rewritten)
---

# Telemetry, operations and value metrics design (Phase 10, draft)

**Draft v6, not built, not approved.** Companion to the [merchant coverage design](merchant-coverage-design.md) and the [Phase 10 plan](../product/phase-10-merchant-expansion.md). Evan's direction (2026-10-05): collect usage data to run the product and, later, to support affiliate card offers; never sell user data; account-free until after the MVP. The **disclosed** use is measuring product quality and reliability; nothing is collected for affiliate offers until a later consent.

## Policy frame (Chrome policy text read 2026-10-05)

- **Browsing activity:** Limited Use prohibits collecting web browsing activity "except to the extent required for a user-facing feature described prominently" on the listing and in the UI; consent does not lift this. Checkout domains and merchant identities are browsing activity. So **no automatic event carries a domain or merchant**; the domain is sent only when the shopper presses a feature button that needs it (below).
- **Single purpose:** since 2026-08-01 data must be strictly necessary to the disclosed single purpose, "recommend which of your cards earns the most at U.S. online checkouts", including measuring its performance and reliability.
- **Consent:** prominent disclosure and an affirmative action before collection (User Data FAQ).
- **Forbidden regardless:** sale, ads, data brokers, creditworthiness. Aggregated, anonymized internal analytics are allowed.
- **CCPA:** applies above about $26.6M revenue (2025 adjustment), 100k consumers or 50% revenue from data sales; this project meets none at MVP. The policy is still written to CCPA notice standards and treats the install ID as personal information.

## Consent

- **Off until the shopper agrees** on a dedicated screen (onboarding and settings) naming what is sent (usage and error events, reader results, a random ID) and why; "Not now" equally prominent; the extension works fully either way.
- Nothing is sent before consent; the install event is queued and sent after consent, or dropped. Withdrawing sends nothing, clears the queue and the ID.
- Store listing (privacy tab categories), consent screen, privacy policy and event dictionary must agree before any release that sends events (merge gate).
- `consent_version` recorded; a change of practice asks again.

## Events

Every event: `install_id` (random, rotated every 30 days, resettable), `install_month`, `days_since_install` bucket (0, 1–6, 7–13, 14–29, 30–59, 60+), `consent_version`, `schema_version`, extension, catalog, merchant-database and reader versions, client timestamp; the server adds its own.

| Group | Events (no domain, no merchant, no amount) |
| --- | --- |
| Lifecycle | install (after consent), onboarding complete, consent given |
| Usage | popup opened, badge shown, badge clicked, recommendation shown (named or generic profile; exact or range) |
| Reader quality | Shown or withheld (no `ask` since 2026-10-06); reader kind (generic or legacy adapter; no store configs since 2026-10-06); shopper reported a wrong amount or typed one (relative-difference bucket) |
| Catalog health | versions in use, refresh success or failure, expiry errors |
| Errors | error code, extension version |

**Shopper-initiated, per click** (user-facing features, described on the listing and in the UI): **"Suggest this store"** in the popup at a generic store sends its registrable domain (from the merchant release's top-retail allowlist, sensitive categories removed; otherwise refused); **"Report a problem"** sends the domain, the reader result and the shopper's note. These feed the merchant growth list and store-config fixes; monthly replays of our own captures cover drift.

**Deferred** to the affiliate phase: the "opportunity" event (best owned vs best catalog rate). Reserved names, not emitted: `offer_impression`, `offer_click` with `offer_id`, `placement`, client `click_id`. Dictionary published as `docs/telemetry/events.md` (public, like `docs/evals/`, not wiki material).

## Ingest and storage

- `POST /v1/events`, anonymous, through a `security definer` insert-only RPC granted to `anon` that validates and caps rows (no new server secret).
- Strict Zod schema, per-event and per-batch caps, `Origin: chrome-extension://<id>` and content-type checks (not authentication); token bucket keyed by the client IP that the events route reads itself from Render's `X-Forwarded-For` at a fixed hop count, plus a global cap; Fastify's server-wide `trustProxy` stays `false`, so the review routes' limits are unchanged; a test shows a forged header does not move the key; IP used transiently, never stored; per-install daily caps; unknown versions dropped.
- Batched with `alarms`; capped offline queue.
- Raw table: RLS on, no client role can read it; daily aggregates read by the reviewer dashboard through an authenticated RPC; raw rows deleted at 90 days by `pg_cron` *(to confirm on the hosted plan)*; no export to third parties; the access list is recorded.
- Policy wording: the application stores no IP addresses; hosting providers' access logs may, under their retention.

## Operations and diligence

| Area | Control |
| --- | --- |
| Accessibility | axe checks at 360 and 480 px on the consent screen, merchant search, "is that right?" prompt and grant prompt |
| Deletion without accounts | "Delete all local data" clears the queue and ID; raw rows expire in 90 days; a request quoting the install ID shown in settings is honoured within 30 days for rows under that ID; rows under earlier, rotated IDs cannot be found and expire at 90 days (the policy says so) |
| Incident | Remote stop: the ingest answers 410 and clients stop sending; merchant releases roll back by republishing the previous one; `disabled` turns off a merchant profile; support channel and breach-notice owner in `docs/release/support.md` and `deployment-runbook.md` |
| Security review | Independent threat-model review of the ingest path and the hosted merchant release before Release B |
| Growth-list integrity | Advisory only, reviewed by Evan; nothing auto-promoted into a release; dashboards count distinct installs, not events |
| Uptime and cost | Render free tier sleeps and is a known limit; clients tolerate cold starts; no SLA; upgrade trigger in decision D14; API availability is a tracked metric |
| Retailer terms | Capture posture (robots, terms, rate limit) recorded in the eval protocol |

## Value metrics (what a buyer or partner asks for)

| Metric | Definition |
| --- | --- |
| North Star | Weekly active installs with at least one recommendation shown |
| Funnel | install → onboarding complete → at least one card → first recommendation → active in week 2 |
| Retention | D7 and D30 from `days_since_install` buckets by `install_month` (D30 = distinct IDs in the 30–59 bucket; no linking of IDs across rotations) |
| Coverage | share of recommendations at named profiles; "Suggest this store" counts by domain |
| Quality | reader false-found and found-correct on held-out real pages; field `ask` and correction rates |
| Uninstalls | rate and reasons (disclosed `setUninstallURL` survey) |
| Reputation | Web Store rating and review count; support volume |
| Availability | API uptime as observed by clients' refresh results |

**Data room** (kept current): licenses and attribution of every data source (Tranco, CrUX), decision records, privacy memo and event dictionary, `SECURITY.md`, dependency audit, release history with approval notes, eval reports. **IP posture:** the repository is MIT and public; acquirable value is the curated catalog and merchant data, the pipeline know-how, eval sets, users and the compliance record (licensing is D9). Licensing the curated catalog as an API to fintechs is a later option.

## Affiliate readiness (offers are a later phase)

Hard rules now: the extension never touches retailer affiliate parameters, cookies or links; the only future affiliate surface is a labelled, user-initiated link in the extension's own UI, disclosed on the listing, in the UI and before install; the engine never sees commission rates; the shopper's own best card stays first.

## Related

* [Merchant coverage design](merchant-coverage-design.md)
* [Phase 10 plan](../product/phase-10-merchant-expansion.md)
* [Extension](extension.md)
