---
type: Decision
title: "Phase 14.4 seed run rules: draft hold-out after three failed gates, bot-walled stores as default records with brands, foreign airlines in scope, Gap family records, defunct domains excluded, merged checkouts, the held-out batch last, verifier conventions"
description: Coordinator decisions of 2026-10-11 for the full tier-B seed, taken within Evan's rules after the first seed batches raised them. A store whose drafts fail the verbatim gate three times is held out (an already-authored record stays); a bot-walled catalog-brand store becomes a default record with its brands when host and brand are confirmed from captures; foreign airlines with U.S. booking sites and co-brand cards are in scope; Gap brand sites get one record each; defunct, parked or typo domains are excluded as `defunct`; a merged checkout host goes to the business that checks out there; the twelve held-out tier-B stores are built last with no rule change; list-membership quotes and non-checkout hosts follow the existing rules.
status: accepted
tags: [decision, phase-14, merchants, pipeline, seed]
generated:
  by: claude-code/claude-fable-5-1
  at: 2026-10-11T06:30:00Z
sources:
  - resource: ../product/phase-14-merchant-database.md
    title: Phase 14 plan (sections 5, 6, 8)
  - resource: ../system/merchant-pipeline.md
    title: Merchant pipeline (full seed)
  - resource: 2026-10-11-definition-evidence-basis.md
    title: Decision, the definition basis and its amendments
---

# Phase 14.4 seed run rules (2026-10-11)

## Context
The first three tier-B seed batches (75 stores) raised cases the plan did not settle: two stores whose luna drafts failed the verbatim quote gate on every attempt (amazon.com, athleta.gap.com), stores whose own pages are bot-walled (BJ's, B&H, British Airways, Boxed), defunct or parked domains (Bartell Drugs, Bon-Ton), a typo domain (floranddecor.com), foreign airlines selling to U.S. buyers, Gap's brand sites sharing one checkout, Cedar Point selling on sixflags.com, and how the twelve held-out tier-B stores are built.

## Options considered
| Question | Options | Chosen (coordinator, within Evan's rules) |
| --- | --- | --- |
| A draft that keeps failing the gate | Retry forever; drop the store from the batch; hold it out after N attempts | **Held out after 3 failed verbatim-gate attempts** (`MAX_DRAFT_ATTEMPTS`), listed in `review.md`; an already-authored record of the same id (amazon-us from 14.1) stays in the release unchanged because apply writes nothing for a held-out store |
| Bot-walled store | Hold out for lacking a store page; default record from research and issuer captures | **Default record with its catalog brands** when the verifier confirms host and brand from the captures (name and hosts may come from research and issuer captures, as for Delta); flagged "bot-walled" in `review.md`; held out only when hosts or brand cannot be confirmed at all |
| Foreign airlines | Out of scope (not U.S. stores); in scope when they book U.S. travellers and the catalog has their co-brand card | **In scope** (British Airways, Aer Lingus, Iberia, …) |
| Gap family | One Gap record; one record per brand site | **One record per brand site** with its own brand; a shared checkout host serving all of them goes to one `gap-inc`-style record carrying the four Gap family brand ids, only if a capture shows that host; otherwise unmatched |
| Defunct, parked, typo domains | Hold out; disable; exclude | **Excluded** with reason `defunct` in the batch report (the verifier's reasons name it: closed, parked, typo, liquidated), no record; the candidate list stays frozen |
| Merged checkouts (Cedar Point on sixflags.com) | Host on the original brand's record; host on the business that checks out there | **The business that checks out there** (Six Flags); brands only where the catalog brand clearly covers it; otherwise default |
| The 12 held-out tier-B stores | Build with the others; build last | **Built last in their own batch with `--allow-heldout`, with no rule or prompt change after seeing them**; they serve the 14.5 blind audit |
| Verifier conventions | List-membership quotes as earning; any host | List-membership quotes count only as the inclusion-list rule allows; a host counts only where the store sells or checks out (bart.gov only if fares are bought there) |

## Second set (coordinator, same day, after the first progress stop)
| Question | Chosen |
| --- | --- |
| A researcher overwrote another batch's research file through a shared scratchpad script (b11) | b11's research packet is re-run cleanly (fresh claim, each researcher told to use its own scratch directory); `accept research` refuses a file whose packet id or domain set differs from the claimed packet (the gate already did; tested) |
| A verifier disputes a null candidate (Lyft: the captures support transit) | **Never a hold-out**: a null candidate gives a `default` record with its catalog brands (Lyft has 6 co-brand cards); only a disputed non-null candidate holds out |
| Only `physicalGoods` disputed (AMC, Alamo Drafthouse, ChargePoint, …) | When the verifier's reason states the value (an explicit true/false, or tickets, admission, streaming, subscription, charging, game credit) the record takes it and ships; a reason that cannot settle it (bot checks, empty captures, unreachable) still holds out |
| Redirect-only domains (max.com → hbomax.com) | Not hosts: the matcher sees the final tab URL; the verifier disputes `hosts` with "X redirects to Y" and apply drops X, keeping the record under the packet domain's id |
| Hedged issuer lists ("popular merchants in this category", "examples of", "does not control how merchants are categorized", "may include") | Not issuer evidence (`HEDGED_WORDING`) |
| Airlines with no U.S. booking site (Air Dolomiti, Eurowings, HK Express, Luxair) | **Excluded as out of scope** (USD/U.S. only), no record: `evals/merchants/db/exclusions.json`, listed under Excluded in `review.md` |
| Issuer fast-food lists | Count as `dining` evidence only where the catalog maps that issuer's fast-food option to `dining`: U.S. Bank Cash+ (`cash-plus-fast-food`, category `dining`) is the only such option, so "fast food" is a dining word for issuer quotes |

## Decision
As chosen; implemented in `draft.ts` (`held-out` draft status after `MAX_DRAFT_ATTEMPTS`), `packets.ts` (verify skips held-out stores), `apply.ts` (held-out entries with field `draft`, `reason: 'defunct'` from `DEFUNCT_WORDING`, `botWalled` list) and `review.ts` (Bot-walled and Excluded sections); the verifier brief carries the bot-walled and host conventions.

## Consequences
- amazon-us keeps its 14.1 record while its seed draft is held out; the audit sees it as an authored record.
- The seed's held-out list is split into defunct exclusions (no action) and disputes for Evan.
- Foreign airlines add brand records (co-brand rules) on the default category.

## Status
Accepted 2026-10-11 (coordinator, within Evan's rules of 2026-10-10 and 2026-10-11).
