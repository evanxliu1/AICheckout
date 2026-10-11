---
type: Decision
title: Build the merchant database bundled-first in two tiers, with a passed-in engine profile, a trimmed record, no adjudicator, no review-app page and a blind audit instead of a held-out split
description: The Fable 5.1 design review of the Phase 14 plan on 2026-10-10 kept the approach (hosted reviewed list, on-device suffix match, evidence-gated category) and simplified how it is built and measured, within Evan's binding decisions of the same day.
status: accepted
tags: [decision, phase-14, merchants, pipeline, evaluation]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-10T23:30:00Z
sources:
  - resource: ../product/phase-14-merchant-database.md
    title: Phase 14 plan (section 12, design review)
  - resource: 2026-10-10-merchant-database-evidence.md
    title: Evan's binding Phase 14 decisions
  - resource: ../../packages/rewards-core/src/engine-v3.ts
    title: compareV3 and merchantProfilesV3
  - resource: ../../evals/merchants/pipeline-heldout-domains.json
    title: Frozen merchant-pipeline held-out list (2026-10-06)
---

# Build the merchant database bundled-first in two tiers, with a passed-in engine profile, a trimmed record, no adjudicator, no review-app page and a blind audit instead of a held-out split (2026-10-10)

## Context
Evan asked on 2026-10-10 for a Fable 5.1 review of the Phase 14 plan: "is this the right approach, what other approaches are possible, and have it compare and implement the best version". His decisions of that day are binding ([evidence](2026-10-10-merchant-database-evidence.md), [audit calls](2026-10-10-audit-calls.md)): about 500 stores, general rate on weak evidence, a bonus category only on issuer or corroborated evidence, public sources only, a hosted list matched on the device, a separate merchant release on "publish merchants <version>", weekly refresh, brand rules regardless of category, luna drafts and Claude verification, no store configs, MIT for now, telemetry in Phase 15. The review compared alternatives for data delivery, engine integration, record shape, matching, record building and evaluation against the code as it is.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Data delivery | Separate hosted release; records folded into the catalog release (schema v4, 100-merchant limit, 30-day expiry, captures on every publish); bundled only | Separate hosted release (binding), built **bundled-first**: the extension works on the snapshot after 14.2, hosting is the last build milestone |
| Engine integration | Optional `{ merchant }` argument on `compareRewards`/`compareV3`; records spliced into `catalog.merchants`; a merged lookup that reads the release inside the engine | Optional argument replacing the lookup when its id equals `purchase.merchantId`; the engine never imports the release contract |
| Record shape | The first plan's record (`onlineRetail`, `usMerchant`, shipped quotes, 90-day expiry); the trimmed record; `plausibleCategories[]` | Trimmed: `id, name, hosts, kind, physicalGoods, category, evidence{basis, sourceIds}, brandIds, disabled`; the release has `verifiedAt` and no `expiresAt`; `onlineRetail` and `usMerchant` are filled `true` at conversion |
| Matching | Label-boundary suffix on authored hosts; PSL in the extension; exact hosts | Suffix on authored hosts, hosts unique across records; PSL and a platform-domain list only as an offline gate |
| Building the records | Full card-pipeline variant for all 500 with an adjudicator; two tiers; brand domains hand-authored only | Two tiers: deterministic records for the long tail (name from the homepage's own metadata, everything else the default); research → capture → luna draft → Claude verify → deterministic apply for the ~200 brand, bonus-group and processor candidates; a disputed field holds the record out; issuer evidence mined from the existing issuer captures |
| Evaluation | 70/30 held-out split with gold on ~150 stores; review only; blind audit | Blind audit of every non-default record plus the 60 domains of the frozen `merchant-pipeline-heldout.1` list, exact Clopper–Pearson bounds, fixes after reporting; the draft prompt tuned only on a 10-store dry run |
| Review surface | A merchant page in the review app with draft, source and publication tables; a committed review table plus the publish dry run | The committed `evals/merchants/db/review.md` (deviations only) and the dry run; the hosted side is two public tables and one publish function under `require_reviewer` |

## Decision
As chosen. The Phase 14 plan was rewritten to this version; its milestones are 14.1 contract, matcher and engine; 14.2 extension on the bundled release; 14.3 candidates and pipeline; 14.4 seed run; 14.5 audit and report; 14.6 hosted release and weekly refresh; 14.7 publish.

## Consequences
- Model cost falls from an estimated 15–30 million Claude tokens to about 4–8 million, because about 300 of the 500 stores never see a model.
- A Release A build is possible after 14.2 and 14.4 on the bundled release; 14.6 adds the refresh and the remote off switch before submission.
- Fewer runtime states: no merchant expiry ladder; the newest valid release in hand is used, the catalog's own expiry still stops an abandoned install.
- The audit measures the costly error (a wrong bonus category, brand or processor) on every record that can make it, not on a sample dominated by `default` records; the frozen 60-domain list is finally used for what Phase 12 froze it for.
- No adjudicator means a disputed field is never settled by a model; it goes to Evan. If many records are held out, Phase 16 adds the stage back.
- Evan reviews a table in a PR rather than a review-app page; if he wants the page later, the tables added in 14.6 are enough to serve it.
- Two of Evan's binding decisions are questioned in the plan's section 12 (the 500 count, and corroboration by public lookups) but kept.

## Status
Accepted 2026-10-10 by the Phase 14 architect (Fable 5.1), within Evan's binding decisions; awaiting Evan's approval of the revised plan.
