# Expansion verification: verifier brief and findings format

This folder holds one findings file per issuer, `<issuer-slug>.json`, written by an independent verifier agent and then adjudicated by a second agent. `scripts/apply-expansion-verification.mjs` validates the files, applies the accepted fixes to the drafts and writes the agent-verified corpus. The issuer slug is the name of the issuer's packet in `../verify/` (`american-express`, `bank-of-america`, `barclays`, `capital-one`, `chase`, `citi`, `discover`, `synchrony`, `u-s-bank`, `wells-fargo`).

## Rules for every verifier

1. **Captures only.** Check every value against the text of the captures the packet lists (`../captures/<source-id>.txt`, local and gitignored). Do not use memory, the research drafts in `docs/research/`, issuer websites, search or any other source. If the captures do not settle a value, record that (as a fix to `null`, or an `ambiguous` or `missing` issue), not a value from elsewhere.
2. **Check values against the capture text, not against the anchors.** The draft anchors were cut to 25 words by a script and may not show the whole rule. Read the passage around each anchor and the rest of the captures.
3. **Quotes of at most 25 words, verbatim.** Every quote you write (an anchor, an issuer wording, a hint anchor) is a contiguous span of one capture, copied exactly (whitespace and curly or straight quotation marks may differ; nothing else may), at most 25 words, and names its capture by `sourceId`. Quote the shortest span that states the value. Notes and reasons are your own words and quote nothing longer than 25 words either. The apply script rejects any quote that does not resolve in the named capture or runs over 25 words, and `scripts/check-expansion-quotes.mjs` rejects any committed text that repeats more than 25 words of a capture, including quotes that are harmless alone but overlap or abut into a longer run when read together (the anchors of one item, consecutive lines of a markdown file). When you add an anchor next to existing ones, pick a span that is not adjacent to them in the capture.
4. **Do not edit the drafts.** Write findings only to your issuer's file in this folder. The apply step changes the labels.
5. **Do not re-capture pages or run models.** If a capture is missing, wrong or truncated, say so in the card's findings (a `drop-card` verdict or an issue), and leave it.
6. **Record provenance honestly**: your agent, model, the date and every file you read go in `verifier`; the result is `agent-verified`, never `human-verified`.

## What to check for each card

The packet (`../verify/<issuer-slug>.md`) lists each card's captures, its draft rules, its product hints and its draft notes. The labels are in `../corpus.draft.json` (case id = card id) and the hints in `../product-notes.json`.

1. **Card identity.** The captures describe this exact product, not a sibling card (another tier of the same family, a different co-brand), a business version, a secured or student variant, or a comparison table. If the page says the product is closed to new applicants, or the captures are for another product, give the verdict `drop-card` with the reason.
2. **Reward currency and point value.** Cash back versus points; miles count as points. `pointValueHundredthsOfCent` (1 cent = 100) only if a capture states a cash redemption value; otherwise `null`.
3. **Each rule.** Category mapping (one of the shared categories in `apps/api/src/curation/v2/schema.ts`); `issuerWording` verbatim from a capture and at most 25 words; `rateBps` is the total rate, not an increment over the base; `paidOnPaymentBps`; cap (`kind`, `amountCents`, `period`, `rateAfterCapBps`); `activation` (null unless a sentence says none, enroll once or recurring); `usMerchantsOnly` (null unless stated); `limitedTime` (promotions, first-year rates, end dates). Every anchor must state what its field says.
4. **Missing rules.** Earning rules the draft lacks: base rate, merchant or partner rules, portal rules, first-year bonus categories, quarterly categories. Welcome bonuses, APRs, fees and non-earning benefits are out of scope.
5. **Exclusions and issues.** Exclusions are transactions that never earn. Issues flag real ambiguity or conflict (for example the product page and the terms disagree).
6. **Product notes.** Each hint (merchant-specific rules with merchant names and membership requirements, chosen-category options and caps, rotating quarters with dates and activation, store-only use, relationship tiers, checkout-method rules) is true per the captures. `keyword-search` anchors were chosen by a script and must actually support the hint; `unanchored` hints need a capture quote or should be dropped.
7. **Draft notes.** They name values the drafting dropped (no resolving quote, or no 25-word window carrying the value) and anchors that state another rate or amount than the draft. Re-check each one.

## Known systemic problems to look for

- **Points mapped to basis points at an assumed value.** The extraction turns "4X points" into a rate in basis points as if a point were worth 1 cent. The corpus convention (as in `real.v2.2`) is: for points and miles, `rateBps` is the per-dollar multiple × 100 (4X = 400), whatever a point is worth. Correct any rate that was converted at another assumed value (for example 4X recorded as 600 or 200). Record `pointValueHundredthsOfCent` only when a capture states a cash value; never infer it. How the engine values points is still an open decision.
- **Cap amounts off by a factor of 10.** Check every cap amount digit by digit against the capture. Known case: `amex-gold` dining has a $5,000 cap in the draft where the capture says $50,000, and supermarkets $2,500 where it says $25,000 (both flagged in the draft notes).
- **Sibling and business-card captures.** Some captures describe a related card (another tier, a business version, a card family page). Rates from a sibling card are wrong for this card.
- **Closed to new applicants.** Some products in the list may no longer be offered. Say so with `drop-card` and the reason in your own words.
- **Non-verbatim issuer wordings.** 18 issuer wordings are not verbatim in the captures (flagged in the draft notes). Replace each with the capture's wording.
- **Over-wide categories.** Warehouse clubs versus supermarkets, online grocery versus supermarkets, partner purchases mapped to `other`, one sentence split into several rules with the wrong categories.

## Findings format

One JSON file per issuer. The schema is `verificationFileSchema` in `scripts/lib/expansion-verification.mjs` (Zod); the apply script validates against it.

```json
{
  "schemaVersion": 1,
  "issuer": "American Express",
  "verifier": {
    "agent": "claude-code-subagent",
    "model": "<model id>",
    "date": "2026-10-03",
    "filesRead": ["evals/curation/expansion/verify/american-express.md", "evals/curation/expansion/captures/amex-gold-product.txt"]
  },
  "adjudicator": null,
  "cards": [
    {
      "cardId": "amex-gold",
      "verdict": "fixed",
      "reason": null,
      "fixes": [
        {
          "op": "set",
          "path": "reference.rules.1.cap.amountCents",
          "current": 500000,
          "corrected": 5000000,
          "anchor": { "sourceId": "amex-gold-product", "quote": "on up to $50,000 in purchases per calendar year" },
          "note": "The cap is $50,000 a year, not $5,000."
        }
      ],
      "addedRules": [],
      "addedExclusions": [],
      "addedIssues": [],
      "productNoteChanges": []
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `issuer` | Exactly as in `../cards.json`. Every card in the file belongs to this issuer; a card appears in one file only |
| `verifier` | `agent`, `model`, `date` (`YYYY-MM-DD`), `filesRead` (every file you opened, at least one) |
| `adjudicator` | `null` from the verifier. The second-pass agent fills it in (same fields) once it has decided every finding |
| `cards[].verdict` | `confirmed`: the draft labels are right as they are (no fixes or additions). `fixed`: at least one fix or addition. `drop-card`: the card leaves the catalog; `reason` required |
| `fixes[]` | `op` `set` (default) or `remove`. `path` addresses the draft case, e.g. `reference.rules.1.rateBps`, `reference.rules.0.cap` (a whole object), `reference.rewardCurrency.value`, `reference.exclusions.2` (with `remove`). Indices are the draft's, before any fix. `current` must equal the draft value at the path (stale findings are rejected). `corrected` is the new value (for a `set`). `anchor` (`sourceId`, `quote`) is required for a `set` and states the corrected value; it is added to the anchors of the rule, exclusion, issue or currency it supports. For a path ending in `.anchors.N` or `.issuerWording`, `corrected` itself must be a verbatim quote of at most 25 words. `note` explains the fix in your words |
| `addedRules[]` | `rule` (all fields of a reference rule except `anchors`), `anchors` (1–4 anchor objects), `note` |
| `addedExclusions[]` | `text` (at most 25 words), `anchors` (1–4), `note` |
| `addedIssues[]` | `code` (`missing`, `ambiguous`, `conflicting`, `untrusted-instruction`, `out-of-scope`), `anchors` (0–4; only `missing` may have none), `note` |
| `productNoteChanges[]` | `action`: `confirm` (hint true; give an `anchor`), `fix` (`hint` replaces the hint; `anchor` required), `drop`, `add` (`hint` and `anchor`). `hintIndex` names the hint in `../product-notes.json` for confirm, fix and drop. A `hint` has at least `type` and `summary` (at most 25 words) |

### Second pass: adjudication

A second, independent agent reads the findings file and the same captures, then decides every finding and sets `adjudicator`:

- each fix, addition and product-note change gets `"adjudication": { "decision": "accepted" | "rejected" | "modified", "reason": "..." }`. A `modified` fix also gives `corrected` (and optionally its own `anchor`); a `modified` addition gives `replacement` (the whole addition without `note`);
- a `drop-card` verdict gets `"verdictAdjudication": { "decision": "accepted" | "rejected", "reason": "..." }`. A rejected drop sends the card back for re-verification.

The apply step uses only `accepted` and `modified` findings. A card enters `../corpus.json` only when its file has an `adjudicator`, every finding on it is decided, and it is not dropped. A card with no entry in any file is never marked verified.

## Running the apply step

```sh
node scripts/apply-expansion-verification.mjs --check   # validate and report statuses; writes nothing
node scripts/apply-expansion-verification.mjs           # writes ../corpus.json, ../product-notes.verified.json, ../verification-report.md
node scripts/check-expansion-quotes.mjs                 # no committed file quotes more than 25 words of a capture
```

Any validation error (unknown card, wrong issuer, quote not in the named capture or over 25 words, stale `current`, a path that does not exist, labels that fail the corpus schema or check) stops the script before it writes anything. `corpus.json` is a corpus v2 file, version `expansion.v1` (`--version` to change), `annotationStatus: "agent-verified"`.
