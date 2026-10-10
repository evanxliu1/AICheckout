---
type: Decision
title: Data collection: one consent at onboarding, a persistent random ID, exact amounts and wallets, domains only on a tap, telemetry in Release A
description: Evan's answers to the data-collection questions on 2026-10-10. One onboarding question ("help improve the product and user experience") covers every metric; a persistent random install ID (no rotation); exact cart amounts without a domain; owned cards as catalog IDs; recommendations, reader results and errors; store domains only when the shopper taps "Suggest this store" or "Report a problem"; no post-purchase category question; no page snapshots; no accounts yet; raw events 90 days; Stop sharing and Delete my data; a minimal telemetry set ships in Release A.
status: accepted
tags: [decision, telemetry, privacy, phase-15, phase-17]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-10T13:00:00Z
sources:
  - resource: ../system/telemetry-design.md
    title: Telemetry design
  - resource: https://developer.chrome.com/docs/webstore/program-policies/limited-use
    title: Chrome Limited Use
  - resource: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
    title: Chrome User Data FAQ
---

# Data collection: one consent at onboarding, a persistent random ID, exact amounts and wallets, domains only on a tap, telemetry in Release A (2026-10-10)

## Context
Evan, 2026-10-10: "collecting data is important, especially for the telemetry later on". He corrected the coordinator: his 2026-10-05 direction is to collect usage data to run the product and later support affiliate card offers, never sell user data, and stay account-free until after the MVP; the telemetry draft's "no automatic browsing data" limit came from reviewers reading Chrome's Limited Use policy, not from him (D11, open). The coordinator put 21 questions, recommended answers within Chrome Web Store policy and U.S. privacy law ("obviously nothing illegal or that can get me in trouble"), and Evan answered.

## Options considered
| Question | Coordinator's recommendation | Evan's answer |
| --- | --- | --- |
| Purpose | Product quality, store-list growth, business metrics; affiliate later; aggregates only to a buyer or partner | Agreed |
| Sale; affiliate use | Never sell; affiliate use needs its own consent later | Agreed |
| Consent | One onboarding screen "Help improve AI Checkout", Share / Not now equally prominent; the extension works fully either way; changeable in Settings | One question at onboarding to opt in or out ("help improve product and user experience"); never asked again per metric |
| Store domains (#7) | Never automatic; sent only on a shopper's tap ("Store not recognised? Suggest it" on the badge, "Suggest this store" and "Report a problem" in the popup) | Agreed |
| Post-purchase category question (#8) | Optional one-tap question for consenting users | **No** ("user bloat") |
| Cart amounts (#9) | Ranges only | **Exact amounts, anonymous** (no domain or merchant on the event) |
| Owned cards (#10) | Catalog card IDs with consent | Collected under the one onboarding consent, without a separate question (never card numbers, last 4 or balances) |
| Recommendations, reader results, errors (#11–#13) | Yes, no page content, no domain, URLs scrubbed | Agreed |
| Page snapshots (#14) | Never | Agreed |
| Install ID (#15) | Rotated every 30 days | **Persistent random ID**, no rotation; reset by Stop sharing or Delete my data |
| Accounts (#16) | None until after the MVP | None yet; accounts later, once set up |
| Retention, storage, rights (#17–#19) | Raw 90 days, aggregates kept; existing Supabase, private schema, write-only for clients, readable by Evan only; Stop sharing and Delete my data | Agreed |
| Timing (#20) | A minimal set in Release A; the rest later | Agreed |
| Phase 14 (#21) | Taps on "Suggest this store" choose the next stores | Agreed (category confirmations dropped with #8) |

## Decision
As Evan answered. In policy terms:
- Collection starts only after the onboarding opt-in, which names what is sent: usage, recommendations, owned card IDs, exact cart amounts, reader results, errors, a random install ID.
- No automatic event carries a domain, merchant or URL.
- A domain travels only on the shopper's tap.

## Consequences
- **Wording.** A persistent ID with exact amounts is pseudonymous, not anonymous. The consent screen, privacy policy, store listing privacy tab and event dictionary must say "a random identifier, no name, email or browsing history", not "anonymous", and must list exact purchase amounts and owned card products.
- **Telemetry design updated.** No rotation; exact `amountCents` with no domain; `wallet_cards`; one consent; Release A scope. D1 and D11 in the Phases 10–17 plan are approved as answered here.
- **Release A grows.** It now carries the consent screen, ingest, event dictionary and settings controls (Phase 15). Phase 17 keeps the dashboard, affiliate readiness and the rest.
- **Phase 14.** It gets "Store not recognised? Suggest it" as a growth input, and no shopper category confirmations.
- **Not legal advice.** The final privacy policy and listing are checked against Chrome's User Data policy text before submission (Phase 15).

## Status
Accepted 2026-10-10 (Evan).
