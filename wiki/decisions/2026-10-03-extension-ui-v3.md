---
type: Decision
title: Ask catalog v3 questions only where they can change an estimate, and send pages a catalog slice
description: Stage 2 M7 extension UI choices — card search with an in-flow combobox, questions asked only when a rule that can apply at a catalog merchant depends on them, a chosen enroll-once category counting as its enrollment, defaults prefilled on add, point values entered in cents, plain-language result wording with value-basis labels, Venmo only with v3 terms, and pages receiving the owned cards' terms plus a card index instead of the whole catalog.
status: accepted
tags: [decision, extension, ui, phase-7]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-03T02:30:00Z
sources:
  - resource: ../../extension/src/components/WalletEditor.tsx
    title: Wallet editor (search, card options, about you, bonus limits, point values)
  - resource: ../../extension/src/components/wallet-options.ts
    title: Which questions are asked; point value parsing; slice merging
  - resource: ../../extension/src/components/estimates.ts
    title: Result wording
  - resource: ../../packages/ui/src/Combobox.tsx
    title: Combobox
  - resource: ../../packages/rewards-core/src/engine-v3.ts
    title: enrolledByChoice
  - resource: ../../extension/src/state/catalog-slice.ts
    title: catalogSlice and cardIndex
---

# Ask catalog v3 questions only where they can change an estimate, and send pages a catalog slice (2026-10-03)

## Context
[Stage 2 M7](../product/phase-7-stage-2.md) builds the extension UI for catalog v3: 178 cards to search, per-card chosen categories, 24 wallet-level gates (ten of them account-age questions), activation, published and issuer-stated point values with a per-program override, and the v3 result codes, which shipped with placeholder copy ([engine semantics](2026-10-02-engine-v3-semantics.md), [extension state](2026-10-02-extension-state-v3.md)). The M2–M6 hand-offs left open how to word results, whether an answered enroll-once choice also needs an activation answer, and (coordinator, 2026-10-03, after M5 bundled `CATALOG_V3`) how to stop sending each page about 600 KB of catalog JSON per response.

## Options considered
| Question | Chosen | Alternative and why not |
| --- | --- | --- |
| Card picker | `Combobox` in `packages/ui`: a text field filtering an in-flow listbox grouped by issuer (`role="group"`), `aria-activedescendant`, a polite match count; every typed word must appear in the name, issuer or short name | 178 checkboxes in issuer fieldsets (the M1–M6 editor): about 4,000 px of scrolling in a 600 px popup. A floating listbox: clipped by the popup's scrolling container |
| Which choice and gate questions appear | Only those a rule of an owned card depends on **and** that rule can apply at a catalog merchant (the `usageInputs` test); gates once per wallet, naming the cards they affect | Every gate an owned card names: Gap, Bass Pro or Macy's tiers would be asked although no supported merchant is theirs, and the answer could change nothing |
| An `enroll-once` rule tied to a `chosen` category (Bank of America choice category, U.S. Bank Smartly Self-Select) | Choosing the category is the enrollment: the engine reports no `activation-unknown` for it (`enrolledByChoice`), and `usageInputs` asks no activation question; an unanswered choice already reports `choice-unknown` | Two questions for one fact. Writing an `active` usage row from the UI: usage rows are valid only on the day they are recorded, so the question would return tomorrow |
| Card defaults (`defaultOptionIds`) | Prefilled when the card is added in the editor, labelled "Filled in with the card's default"; the shopper can change them or pick "Not sure"; the engine still treats an unsaved choice as unknown | Using defaults silently in the engine (rejected in M2) |
| "Not sure" | A radio for single choices and gates; no box checked for multi-pick choices; nothing is saved, so the engine shows a range | A third stored value: the wallet contract has none |
| Point value field | Cents per point or mile (0.01–100, two decimals), stored as hundredths of a cent (1–10,000); blank uses the default; "Reset to default" clears it | Hundredths of a cent in the UI: an unfamiliar unit |
| Value labels | "Estimate" (published, with publisher and date read), "Issuer-stated" (program or card), "Your value"; unvalued programs say "No published value" and ask for one; store rewards are shown in dollars "paid as" the program | One "estimate" label for all: would present issuer facts and opinions alike |
| Points rates | "4 points per $1" (catalog points rates are the card's multiple × 100); pre-merge review: a card named as a cash card ("Cash" as a word) whose points the issuer values at exactly 1¢ and that redeem beyond one store family (only Citi Double Cash, ThankYou points per M3) reads "2%", with "Paid as N points (Citi ThankYou Points) at 1¢ each" and the "Issuer-stated" label; a shopper's own value or a published estimate keeps "points per $1" | "4%" for all points: wrong for points. "2 points per $1" for Double Cash: a card advertised as 2% cash back read as a points card next to Citi's own "2%" wording. A catalog flag for "marketed as cash back": a catalog change, left to the coordinator |
| Nothing guaranteed (closed-loop card whose rules all have conditions) | "Up to $5.00" and "Nothing is guaranteed: this card earns here only if the conditions below are met" | "$0.00–$5.00" |
| Venmo | In the popup and badge selectors only when the catalog in effect is v3; an older catalog compares a card payment | Always: a v2 catalog rejects the path |
| What pages receive | `catalog`: the catalog in effect cut to the owned cards (plus the cards a `checkout:catalog-cards` request names) with every merchant and what those cards refer to; `cardIndex`: id, name, short name and issuer of every card. The response schema checks the slice only for shape (it may hold no cards) | The whole catalog in every response (about 600 KB parsed by Zod per page message). A compact catalog type: every component would change its input |

## Decision
As in the "Chosen" column. The wallet editor loads an added card's terms through `checkout:catalog-cards` before showing its questions and refuses to save until they arrive.

## Consequences
- With two owned cards a page response is under 80 KB (tested; the bundled catalog is about 800 KB as JSON); the popup and onboarding chunks contain no catalog (checked in the build output).
- v1 and v2 results are unchanged: `enrolledByChoice` applies only to v3 rules with a `chosen` choice.
- Questions for gates and choices of brands without a catalog merchant appear once a merchant of that brand is added.
- Release media in `docs/release/assets` show the old checkbox editor and v2 amounts and need regenerating (Evan, `RELEASE_ASSETS=1`).

- Pre-merge review (agent-verified, 2026-10-03): saving keeps choices, gate answers and point values the form does not ask (an expired or older catalog lacks them, or no catalog merchant uses them); spend fields are worded by the limit's period ("this quarter", "this billing cycle", "this card-member year", "this year", "in 2026"); the point-value default shown is the card's stated value when the program's cards share one; a card whose terms fail to load is taken back out, and a "Load card terms" action recovers a card left without terms; focus moves to the owned-cards heading when the 20th card disables the search field; the ranking note says "its guaranteed estimate is the highest" and mentions another card only when one's best case beats it; the badge pill marks a published estimate "est."; Venmo is compared as a card payment under a v1 or v2 catalog in one place (`enginePurchase`).

## Status
Accepted 2026-10-03 by the M7 implementing agent within the Stage 2 plan; the catalog slice by the coordinator (2026-10-03). Evan or the coordinator can revise any row. The "Points rates" row's Double Cash exception (`cashLikePoints`) is superseded by [Citi Double Cash is cash back](2026-10-03-double-cash-cash-back.md) (2026-10-03).
