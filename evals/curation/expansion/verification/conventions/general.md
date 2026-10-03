# General adjudication conventions (expansion.v1)

Set by the coordinator on 2026-10-02 after the first verifier pass, to resolve judgment calls that verifiers made differently. They apply to every issuer; issuer-specific decisions live in the issuer's own file in this folder and must not contradict these. Adjudicators apply these to every card; where a verifier's finding conflicts with them, mark it `modified` (with the conforming value) or `rejected`, and add any missing conforming fix.

1. **Rate units.** `rateBps` is the card's own per-dollar multiple × 100 for points and miles cards (4X → 400), and the percentage × 100 for cards whose terms state a percentage back (5% → 500, currency `cash-back`), even if the issuer tracks it internally as points. Never convert with a point value.
2. **Card earn only.** When marketing states a total that includes earn paid by an airline, hotel or loyalty program (member earn, status bonuses, "up to" totals), record only the part the card pays.
3. **Point value.** Set `pointValueHundredthsOfCent` only when a capture states a fixed value for redeeming points as cash, statement credit or deposit, or as the issuer's own store reward certificates/dollars for a store card. Travel-only, transfer, gift-card, onboard-credit and "worth up to" values → null (mention in a product note).
4. **Single-merchant rules.** A rule that pays only at one merchant or brand (the co-brand partner, Amazon, Whole Foods, Lyft, Peloton, Walgreens, PayPal checkout, a store) → category `other`, with the merchant named in `issuerWording` and in a product note. Use a shared category only when the rule pays across the whole category. A booking site run by the card program (Chase Travel, Capital One Travel, AmexTravel, partner booking portals like aadvantagecars.com) → `travel-portal`.
5. **Rotating quarterly categories.** Keep only the quarter current on the capture date (2026-10-02): activation `recurring`, `limitedTime.endsOn` = quarter end, the quarterly cap. Remove past and future quarters' rules; describe them in the rotating-quarterly product note.
6. **Chosen categories** (Customized Cash, Cash+, Shopper Cash, Strata Self-Select, Edward Jones top-three, Custom Cash). One rule per option at its rate; activation `enroll-once` if the cardholder must pick once, `recurring` if they must pick each period, `none` for the default option or an automatic top-spend category; one `ambiguous` issue saying only the selected/top category earns; the mechanic in a product note.
7. **Activation.** `none` when a capture says rewards are earned or enrolled automatically; `enroll-once` only for a one-time enrollment specific to the rewards (joining a store loyalty program before or after applying counts); `recurring` for per-period activation; otherwise null. General card activation or holding a loyalty account is not enrollment.
8. **Store credit currencies** denominated in dollars (Wayfair Reward Dollars, Bean Bucks, Verizon Dollars, OneKeyCash) → `cash-back` with an `ambiguous` issue saying the rewards are usable only with that merchant.
9. **Out of schema.** Cents-per-gallon fuel rewards and cards whose captures state no earn rate → `drop-card` with the reason. Spend thresholds that raise a rate (not caps) → cap null plus an `out-of-scope` issue.
10. **Limited time.** First-year / first-N-days / promotional rates → `limitedTime` with `endsOn` only when a date is stated; standing rates → null. Boilerplate about promotion timing is not a limited time.
11. **Issues.** Remove issues with neither a detail nor an anchor that states the problem, and issues made moot by added rules. A customer review or marketing copy is not an `untrusted-instruction`.
12. **Sibling products.** Rules taken from comparison tables or panels advertising another card are removed.

## Clarifications after adjudication (2026-10-02)

13. **Precedence.** Rule 1 wins over rule 3: a card labelled `cash-back` never has a point value (the catalog schema forbids it), even when its rewards arrive as store certificates.
14. **Store-only points** (rewards in points spendable only with the merchant or its brands, on store cards or co-branded cards alike): currency `points`, point value set when a capture states a fixed dollar value for that merchant (e.g. 100 points = $1 toward store purchases), plus the `ambiguous` store-only issue of rule 8. Gift cards remain null under rule 3.
15. **Portals.** Program-run ticketing and entertainment sites (Capital One Entertainment) are `entertainment-portal`; rule 4's `travel-portal` covers travel booking only.
16. **Anchorless issues.** The issue schema has no free-text detail, so every issue without an anchor that states the problem is removed.
17. **Gated rates.** A rate that needs a paid membership or a spend tier the cardholder may not have (Prime, Sam's Plus, store loyalty tiers) is a known gap until the engine supports conditions (Phase 7 Stage 2). Labels keep the stated rate with an `out-of-scope` or `ambiguous` issue naming the condition; Stage 2 revisits them.
18. **Redemption values that are not point values** (travel-only, gift card, onboard credit) go in the closest existing product-note type until a redemption note type exists (Stage 2).
19. **Partial-category options** (a chosen option narrower than a shared category, e.g. Cash+ fast food within `dining`): map to the shared category and add an `ambiguous` issue that the option covers only part of it.
20. **Airline and hotel points.** Co-brand points or miles spendable only with the airline or hotel (Delta Pay with Miles, Sun Country's 100 points = $1 in Sun Country purchases) are travel-only values under rule 3: point value null, with the redemption in a product note. Rule 14 covers retail store points only.
21. **No-cap evidence.** `cap: {kind: "none"}` only when a capture states that the rate, or the card's earning as a whole, is uncapped or unlimited (a sentence, not a section heading). When the captures are silent, `cap: null`.
22. **Adjacent anchors.** Anchors of one item, read together, must not form a run of more than 25 consecutive capture words: two windows of one sentence that overlap, or consecutive sentences that abut. Keep the anchor that states the value and shorten or drop the other; `scripts/check-expansion-quotes.mjs` checks every array of quotes this way.

## Catalog overlay conventions (Stage 2 M4, 2026-10-02)

Set by the M4 coordinator for `../../catalog-overlay.json` and `../../merchants.json` (format: `scripts/lib/catalog-overlay.mjs`). The overlay never edits a corpus label: it patches a copy of a rule by index, adds rules, or holds rules and cards out, and gives every corpus `other` rule, every issue and every product hint one disposition. Issuer files add an "Overlay" section for issuer-specific decisions.

O1. **What a patch may change.** Only the catalog v3 fields `category`, `cap`, `activation`, `limitedTime`, `brandIds`, `excludedBrandIds`, `sharedCapId`, `choice`, `requires`, `requiredPaymentPaths` and `excludedPaymentPaths`. Rates, issuer wording, paid-on-payment and U.S.-only stay as labelled. A rate the corpus lacks is an added rule with its own anchors.

O2. **Dispositions.** `modelled`: the catalog represents it (`how` names the mechanism: brand scope, brand exclusion, category, choice, automatic choice, gate, rotating, limited time, checkout method, closed loop, store-credit program, program redemption, shared cap, base rule). `field-unstated`: the captures leave a value open and the catalog carries the conservative reading (an `unstated` field, or the base rate after a cap). `rule-held-out`: the rule is left out of the catalog, with the reason in the note. `card-held-out`: the card is left out; every item of the card gets it. `noted`: no catalog change, because the item does not change what a purchase earns (redemption values, caps on rewards earned, statements already in the labels, issuer facts with no rate).

O3. **`other` rules.** A rule that pays at one merchant, brand or brand family keeps category `other` and gets `brandIds` (brand scope), whatever the merchant sells, so later merchant profiles can use it. A rule that pays across a whole category gets that v3 category (`electronics`, `department-stores`, `home-improvement`, `wholesale-clubs` or a shared one). A service or travel category with no v3 category (airfare, hotels, utilities, insurance, fitness, medical, telecom) is `rule-held-out` with a note starting "not at retail:". A retail store category with no v3 category (clothing, sporting goods, pet supplies) is `rule-held-out` with a note starting "no v3 category:". Peer-to-peer payments are `rule-held-out`. A rule paid only through PayPal or Venmo is a checkout-method rule (O10). Brand-scoped rules always use category `other`; a shared category is never combined with `brandIds`.

O4. **Brand exclusions.** "Excluding Walmart and Target" and similar on a category rule → `excludedBrandIds`.

O5. **Brands.** One brand per merchant name a rule, acceptance or redemption names; the ID is the kebab-case common name without legal suffixes or trademark signs (`whole-foods-market`, `barnes-and-noble`, `delta`, `sams-club`). The name is the plain merchant name. Brands are for matching only and imply no affiliation with AI Checkout; UI copy must not present them as partners.

O6. **Base rule.** An open-loop card needs exactly one unconditional `all-purchases` rule. When the corpus base carries only a one-time enrollment in the store's own rewards program, the patch sets `activation` to `none` if a capture says cardholders are enrolled automatically or by opening the account, otherwise `unstated`; `how` is `base-rule`. A card whose captures state no base rate is `card-held-out` (Marriott Bonvoy Bold, U.S. Bank Shield). A rule whose rate is not a whole number of basis points is `rule-held-out`.

O7. **Closed loop.** A store card the captures describe as usable only at the store and its sites (no card network) gets `acceptance: closed-loop` with the store's brands and an anchor. It needs no base rule.

O8. **Chosen and automatic categories.** One card `choice` per mechanic: `chosen` with `picks` and the `defaultOptionIds` a capture states, or `automatic` (top-spend categories) with no defaults. Options list every category the issuer offers, including ones whose rules are held out (their label stays, they earn nothing at retail). Each option's rule gets `choice`. Options narrower than their v3 category keep the corpus category (general 19).

O9. **Gates.** A membership, tier, relationship or spend-status condition is a catalog gate with every answer as an option (including "none"), reused across cards when the question is the same. A tier ladder is one gate with one rule per tier. A spend threshold that raises a rate becomes a gate about the cardholder's current status, since the engine tracks no store spend. A stated percentage boost (Atmos +10% with an eligible Bank of America account) becomes gated duplicates of the boosted rules at the boosted rate, rounded down to whole basis points. A bonus whose rate the captures do not state is `noted`.

O10. **Checkout methods.** A rule paid only through PayPal or Venmo → `requiredPaymentPaths` (the rule may then be `all-purchases`). "Third-party payment accounts" means `paypal` and `venmo`; "mobile or digital wallets" means `digital-wallet`; buy now, pay later only when named. A statement that such payments earn only the base rate, or may not earn the bonus ("may earn 1%", "may not receive a higher percentage"), → those paths in `excludedPaymentPaths` on each bonus rule it covers: the catalog takes the conservative reading, and the engine then counts the base rate for that path.

O11. **Rotating quarters.** The current quarter's rules get `limitedTime.startsOn` (2026-10-01) next to the corpus `endsOn`. A later quarter is added only when a capture names its categories (Freedom Flex Jan-Mar 2027: `startsOn` 2027-01-01, `endsOn` 2027-03-31, activation `recurring`, the same cap). Quarters no capture names (Discover Q1 2027) are `noted`.

O12. **Caps.** A spend cap with no after-cap rate gets the base rate after the cap, disposition `field-unstated`. Combined caps ("$1,500 in combined purchases") → one `sharedCapId` on every rule that shares it. A cap on rewards earned rather than spend (Sam's Club's yearly Sam's Cash limit) is `noted`.

O13. **Store credit.** Cash back spendable only with one merchant (Verizon Dollars, OneKeyCash, Walgreens Cash, REI, T-Mobile, Key Rewards, My Best Buy certificates and the like) moves from `cash-back` to its own cash-back program with `redemptionBrandIds` and an anchor; the card's `programId` names it. Store-only points programs keep their reward-programs.json program and get `redemptionBrandIds` in `programDetails`.

O14. **Account-age promotions** (first-year rates, first 30 days) → `limitedTime` with null dates (the "no gate" part is replaced by O20).

O15. **Anchors and notes.** Every patch that sets fields, added rule, choice, gate, closed-loop acceptance and store-credit program has at least one anchor: a verbatim span of at most 25 words from one of the card's own captures (gates and programs: any capture), not overlapping or abutting the item's other anchors into a run over 25 words. Notes are in the author's words, at most 60 words.

### Overlay adjudication clarifications (2026-10-02)

O16. **Travel with transit.** A held-out travel rule or option that names transit, taxis or ride share takes category `transit`, so the part v3 can match is kept; the note says only that part is represented (Chase United Quest/Club and IHG Premier Select, U.S. Bank Altitude Connect, Bank of America Customized Cash Travel).

O17. **Lowest tier.** When every cardholder holds at least the lowest tier of a ladder (Bass Pro and Cabela's CLUB Classic), the lowest tier's rule stays ungated and the gate guards only the higher tiers, so an unanswered gate still shows the floor.

O18. **Unsupported store credit.** A cash-back card moves to a store-credit program only when a capture says the rewards are spendable with that merchant; a conversion ratio alone is not enough (JCPenney and At Home stay on `cash-back`).

O19. **Purchase-level conditions** (promotional financing chosen instead of rewards, a minimum purchase amount, items of the store's own brand, time of day) are not cardholder gates. A rate that depends on one is `noted` when the rule otherwise holds, or `rule-held-out` when keeping it would overstate the earn (Peloton over $150, Walgreens-brand 10%, Citi Nights 6X).

### Pre-merge review (2026-10-02)

O20. **Account-age rates are gated.** The engine reads only a rule's `limitedTime` dates, so a first-year, first-90-days or first-30-days rate with null dates would apply to every cardholder. Such a rule keeps its dateless `limitedTime` (O14) and also requires a per-card gate ("Did you open your ... account less than a year ago?", options for inside and after the period), anchored on the capture that states the period. Unanswered, it shows a range whose floor is the standing rate. The check rejects a dateless limited-time rule without a gate. This replaces O14's "no gate".

O21. **Store-credit units are cents.** The engine counts a cash-back program's units in cents, so a store-credit program's `unitName` is "cents" (its `name` keeps the merchant's term, such as Verizon Dollars), except where one named unit is worth one cent (TJX Rewards Points). `programDetails` repeats each store-credit program's unit name and redemption brands.
