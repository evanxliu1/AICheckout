---
type: Decision
title: Coordinator decisions in the 2026-10 catalog renewal
description: Phase 9 renewal run — the Barclays program Terms & Conditions convention (activation none stands), the Atmos Summit relationship boost recorded as a note instead of a gated derived rate, Freedom Flex Jan–Mar 2027 omitted, and real-card wallet exclusions accepted from the refreshed terms.
status: accepted
tags: [decision, catalog, renewal, phase-9]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-05T03:04:00Z
sources:
  - resource: ../../docs/evals/freshness-2026-10.md
    title: Renewal results
  - resource: ../product/phase-9-freshness.md
    title: Phase 9 plan
---

# Coordinator decisions in the 2026-10 catalog renewal (2026-10-05)

## Context
The renewal re-verified 107 cards whose pages changed. Agents raised four questions that the conventions did not settle or that the gates could not pass. Under the skill, convention gaps are the coordinator's unless they are scope matters.

## Options considered
| Question | Options | Chosen |
| --- | --- | --- |
| Barclays JetBlue and Carnival terms now say the cardmember "must accept the Program Terms & Conditions" to earn | `enroll-once` (general 7, rewards-specific step) or `none` (part of holding the loyalty account the issuer opens automatically) | `none`, recorded as a dated batch convention; the anchored auto-enrollment issue keeps the uncertainty |
| Atmos Summit's 10% relationship boost (O9) needs gated copies at a derived rate (×1.1) | Teach the lint derived rates; let the author ack its own rate; record the boost as a note | Note only: no catalog rate that no capture states. A small regression against release 2 for shoppers who answered the BofA account gate |
| Freedom Flex Jan–Mar 2027 quarter: the capture gives "JAN-MAR 2027", not an end date, and the overlay author may not ack its own end date | Add a convention; omit the quarter | Omit: the renewal expires 2026-11-04, before the quarter starts; the next renewals add it |
| Refreshed Amex Blue Cash and Capital One Savor terms carry wallet and Walmart/Target wording release 1 did not model | Keep release-1 behaviour; apply O4/O10 as on every other card | Apply the conventions; the build report lists every real-card difference from release 1 for Evan's publish review |

## Decision
As in the table. All four are reversible in a later batch.

## Consequences
- Golden ladder W13: Blue Cash Everyday earns 1% on the PayPal and Venmo paths.
- 224 rule IDs change (20 release-1 real-card rules), so usage rows on them are dropped on update, by design.
- Gaps for later: second packets reuse the first packet's output path; overlay-only conventions count as adjudicate inputs; handoff names the freshness record for merchant sources.

## Status
Accepted 2026-10-05 by the coordinator (claude-code/claude-opus-5-5); publishing remains Evan's.
