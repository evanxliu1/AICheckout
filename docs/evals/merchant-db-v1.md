# Merchant database v1: blind audit, 2026-10-11

Phase 14.5 of the [merchant database plan](../../wiki/product/phase-14-merchant-database.md) (section 7). The release under audit is `2026-10-11.seed.17`, the bundled `MERCHANTS_V1` built by Phase 14.4 on 2026-10-11 and merged as PR #86 (`c5802843`). The extension matches every tab's host against this release on the device and passes the matched record's profile (kind, goods flag, category, brands) to the rewards engine; a wrong bonus category is the costly error, because it recommends a card for a bonus the store will not pay.

- **Built** by the 14.4 pipeline: gpt-5.6-luna drafts, a Claude `merchant-verifier` check of every field and quote, a deterministic apply rule that grants a bonus category only on `issuer`, `corroborated` or `definition` evidence ([pipeline](../../wiki/system/merchant-pipeline.md)).
- **Audited** 2026-10-11 by a blind `merchant-auditor` ([agent file](../../.claude/agents/merchant-auditor.md)) that saw only the captured pages and issuer excerpts of each store and the written rules, never a draft, verification, record or `review.md`; disagreements were adjudicated by a third agent ([method](../../wiki/decisions/2026-10-11-merchant-audit-method.md)). All labels are agent labels (`agent-verified`); no human labelled a store.
- **The numbers below are the pre-fix numbers** of `2026-10-11.seed.17`, committed before any record changed. The 16 fixes the adjudication calls for are listed in [Fixes](#fixes) and were applied in the next commit as release `2026-10-11.audit.1`, as the plan requires; an independent review then reverted one of them and fixed two tier-A naming faults as `2026-10-11.audit.2`.

## What the release contains

| | `2026-10-11.seed.17` |
| --- | ---: |
| Records | 641 (merchant 607, marketplace 19, processor 15); 648 hosts; no record disabled |
| Evidence basis | `default` 595, `definition` 41, `issuer` 5, `corroborated` 0 |
| Bonus categories (46) | supermarkets 13, dining 12, streaming 7 (5 `definition`, 2 `issuer`), drugstores 5 (4 + 1), home-improvement 4, department-stores 2 (`issuer`), entertainment 2, transit 1 |
| Records with brands | 120, naming 119 of the catalog's 140 brands |
| Records with `physicalGoods: false` | 140 (125 services and 15 processors) |
| Cited sources | 68 (58 store pages, 10 issuer pages); captures gitignored, hashes committed |
| Size | release JSON 249,019 bytes; `merchants-v1.ts` 209,561 bytes (limit 2 MiB) |

**How it was built.** 692 frozen candidates: tier A (380 long-tail domains) got deterministic default records from a homepage render, named from `og:site_name` (132), `<title>` (106) or `application-name` (3), else the domain label (139, of them 99 bot-walled renders and 16 unfetchable pages). Tier B (312 domains in 13 batches of up to 25, plus the 10-store development batch) went through research, capture, draft, verify and apply. Not in the release: 42 held-out field disputes in `review.md` (stores whose name, hosts, kind or goods flag the verifier could not confirm, mostly bot-walled sites; the count is of table rows, a store may have several), 9 excluded domains (5 defunct, parked or typo domains, 4 airlines with no U.S. site), 3 draft hold-outs after three failed verbatim gates (amazon.com and pay.amazon.com keep their 14.1 records; nordstromrack.com has none). `review.md` also lists for Evan 65 downgraded records (a disputed quote and no basis left), 98 candidates the rule refused, 13 cross-issuer conflicts and 76 bot-walled stores.

**The 60 frozen held-out domains** ([list](../../evals/merchants/pipeline-heldout-domains.json), frozen 2026-10-06) became: 48 tier-A default records with no brands; 6 tier-B default records with a brand (target, barnesandnoble, gap, jcpenney, birchlane, cabelas); 3 tier-B default records with no brand (apple, dell, sherwin-williams); 1 bonus record (homedepot, home-improvement on `definition`); 2 with no record (nordstromrack.com, draft held out; build.com, held out: redirects to fergusonhome.com and nothing confirmable). The held-out batch was built last with the rules frozen at `seed.13`; the coordinator's third decision set then changed four apply rules and one held-out record changed, **gap-us** (from held out to a default record with brand `gap`), which is reported separately below as post-freeze ([seed run rules](../../wiki/decisions/2026-10-11-seed-run-rules.md)).

## Audit method

**Population: 230 stores**, the union of every record whose basis is not `default` (46), every record with brands (120), the 15 processors and the 60 held-out domains; 228 have a record, 2 do not. Mapping record → store domain comes from the batches' apply reports, then the candidate list (`population.json`).

**Packets.** `build-packets.mjs` wrote 10 packets of 23 stores (gitignored, capture text). Each store's sheet holds only: its own captured store pages in full (tier B: the batch's store-page captures, at most three, 8,000 characters each; tier A: the homepage render), excerpts of any merchant-code lookup page around the store's name, and excerpts of the issuer pages around the store's name (the batch's name windows; for tier-A stores, mined from the catalog's issuer captures the way the pipeline does). Each packet also carries `issuer-definitions.md` (the definition sentences of the 12 fixed issuer definition pages, ±250 characters) and the catalog's brand and category lists. Nothing derived from a draft, verification, record or review entered a sheet; the domain is the only identifier.

**Labeller.** The `merchant-auditor` agent file states the four bases and their conditions (issuer inclusion lists count, hedged and conditional wording does not; the excluded kinds of store; a business type as a noun phrase; a delivery marketplace only for dining), the kind, goods and category meanings, and a blindness rule naming the files it may never open. It labels kind, `physicalGoods`, brands, category with basis and the quotes it relies on, or `cant-tell`. Ten general-purpose Opus subagents (`claude-opus-5-5`; the agent type was not registered in the session, each read the file first) ran one packet each; a gate (`check-labels.mjs`) checked every file: the packet's domains in order, brand and category ids, every quote found verbatim in the named sheet section and at most 25 words, a bonus with a non-default basis and quotes, and `filesRead` naming no forbidden file and no other packet. All 230 stores were labelled; 488 quotes.

**Comparison** (`score.mjs`, deterministic): wrong bonus category = a record with a bonus category whose auditor label is another category or `general-merchandise` (an auditor `cant-tell` on a bonus record would be counted separately; none occurred); missed bonus = a default record the auditor gives a bonus; wrong brand = brand sets differ (auditor adds, drops or differs); wrong kind and wrong goods flag likewise. A `cant-tell` is never a disagreement; it is counted per field. Bounds are exact one-sided 95% Clopper–Pearson upper bounds (`evals/reader/stats.mjs`).

**Adjudication.** Every disagreement (19) went to a third, separate Opus subagent with the auditor's rules, both sides' quotes (the record's committed evidence quotes, the auditor's quotes and notes) and the blind sheet, never the records, evidence files or pipeline reasoning. Its verdict per item is `record`, `auditor` or `neither`; a record error stands after adjudication unless the verdict is `record`, a missed bonus stands only when it is `auditor`. Verdicts: 3 `record`, 16 `auditor`, 0 `neither`.

## Results

Denominators are the plan's: bonus records for the wrong-bonus rate, default records for missed bonuses, brand records for brands, every store for kind and goods. "Before" is the raw comparison, "after" the counts standing after adjudication.

### All 228 audited records

| Measure | Before adjudication | After adjudication | 95% upper bound (after) |
| --- | ---: | ---: | ---: |
| **Wrong bonus category** | 4 / 46 (8.7%) | **4 / 46 (8.7%)** | **18.8%** |
| Missed bonus category | 11 / 182 | 9 / 182 (4.9%) | 8.5% |
| Wrong brand set | 2 / 120 (both: auditor adds brands) | 2 / 120 (1.7%) | 5.2% |
| Wrong kind | 2 / 228 | 1 / 228 (0.4%) | 2.1% |
| Wrong goods flag | 0 / 228 | 0 / 228 | 1.3% |
| Auditor `cant-tell` | kind 39, goods 50, brands 31, category 11 | | |

**What the four wrong bonus records are.** Three of them, aldi.us, kroger.com and wholefoodsmarket.com, are real supermarkets: the rule granted a category their captured pages could not prove under the written conditions (no business-type noun phrase on the captured pages), so the error is one of non-compliance with the evidence rule, and the fix costs those stores' shoppers a grocery bonus they would in fact have earned. The fourth, marketbasket.com, is The Market Basket of New Jersey, a gourmet market selling gift baskets and catering, so its supermarket category is plausibly wrong in the world, not only under the rule.

Against the plan's targets (reporting targets, not gates): wrong bonus category **4, target 0**; wrong brand **2, target 0**; wrong kind **1, target 0**; wrong goods flag 0; missed bonuses 9 (reported, costs value not trust).

By category: the auditor agreed with all 12 dining, 5 drugstore, 7 streaming, 4 home-improvement, 2 department-store, 2 entertainment and 1 transit record; it disagreed with 4 of the 13 supermarket records (all four refused, none moved to another category). Of the 182 default records the auditor agreed with 160, would grant a bonus to 11 and could not tell for 11.

### The 15 processors and the 120 brand records

All 15 processors: kind `processor` confirmed, no goods, no brands, no category; no `cant-tell`. Brand records: 2 wrong brand sets (below), 0 wrong kinds after adjudication (amazon.com went to the record), 9 missed bonuses; 15 brand `cant-tell` values, all stores whose pages are bot walls and whose issuer excerpts do not tie the domain to the brand.

### The 60 frozen held-out domains

58 have a record (57 frozen + gap-us post-freeze); nordstromrack.com and build.com have none. Frozen 57, after adjudication: wrong bonus **0 / 1** (homedepot-us confirmed, bound 95% on one record); missed bonus **1 / 56** (jcpenney-us, department stores on Amex's list); wrong brand **0 / 57**; wrong kind **1 / 57** (whatnot-us is a live-shopping marketplace, the record says merchant); wrong goods 0. `cant-tell`: kind 18, goods 24, brands 16, category 6 (the long tail's homepages are often bot walls). Before adjudication the frozen set had the same counts plus the sherwin-williams missed bonus, which the adjudicator gave to the record. The two stores without a record: the auditor labelled nordstromrack.com `merchant`, goods, no brand, `general-merchandise` (U.S. Bank names it only in a hedged list) and build.com `cant-tell` on every field (its only capture is an access-denied page).

**Post-freeze, gap-us** (changed after the held-out batch was first applied): the record carries brand `gap`; the auditor and the adjudicator read gap.com's "buy online from one brand or all four" line as a shared checkout for Gap, Old Navy, Banana Republic and Athleta, so the brand set is wrong by one adds-three disagreement. Category, kind and goods agree.

### Every disagreement and its adjudication

| Store | Field | Record | Auditor | Verdict | Adjudicator's reason (shortened) |
| --- | --- | --- | --- | --- | --- |
| aldi.us | category | supermarkets (`definition`) | general-merchandise | auditor | Amex names ALDI only in an "Examples of merchants" list with "not a complete list"; its pages show delivery and pickup wording, never a grocery-store or supermarket noun phrase |
| kroger.com | category | supermarkets (`definition`) | general-merchandise | auditor | Help pages describe pickup and delivery of groceries but never a business type as a noun phrase; U.S. Bank's mention is "may qualify" and hedged lists |
| marketbasket.com | category | supermarkets (`definition`) | general-merchandise | auditor | Calls itself a "specialty market" of gourmet food, which Amex excludes from supermarkets; sells gift baskets and catering |
| wholefoodsmarket.com | category | supermarkets (`definition`) | general-merchandise | auditor | Its pages mention shopping for groceries and grocery delivery, never a grocery-store or supermarket noun phrase; U.S. Bank's list is hedged |
| audible.com | category | general-merchandise | streaming (`issuer`) | auditor | Amex's Select U.S. Streaming Subscriptions list limits earning to its providers and names Audible |
| bloomingdales.com | category | general-merchandise | department-stores (`issuer`) | auditor | Amex earns "ONLY" at the listed department stores; the list names Bloomingdale's |
| dillards.com | category | general-merchandise | department-stores (`issuer`) | auditor | The same Amex list names Dillard's |
| macys.com | category | general-merchandise | department-stores (`issuer`) | auditor | The same Amex list names Macy's |
| jcpenney.com (held out) | category | general-merchandise | department-stores (`issuer`) | auditor | The same Amex list names J.C. Penney (JCP); no store page is needed for an issuer basis |
| disneyplus.com | category | general-merchandise | streaming (`issuer`) | auditor | Citi Strata "Includes the following streaming providers: … Disney+"; Amex's list too |
| plus.espn.com | category | general-merchandise | streaming (`issuer`) | auditor | U.S. Bank Altitude: 2 points on qualifying streaming subscriptions, "Qualifying … are: … ESPN+" |
| siriusxm.com | category | general-merchandise | streaming (`issuer`) | auditor | Citi Strata and Amex streaming lists name SiriusXM |
| costco.com | category | general-merchandise | wholesale-clubs (`definition`) | auditor | Its page: "a membership warehouse club"; Chase's paragraph on bulk sellers that may require membership covers the type. The adjudicator's closest call: the paragraph's heading is cut off in the capture |
| lyft.com | category | general-merchandise | transit (`definition`) | **record** | Lyft's pages never say rideshare or taxi; "Get a ride" shows no business type under the rule |
| sherwin-williams.com (held out) | category | general-merchandise | home-improvement (`definition`) | **record** | A paint maker's pages; "Paint Stores Group" is a revenue-segment label; Bank of America's mention is a hedged examples list |
| gap.com (post-freeze) | brands | gap | gap, old-navy, banana-republic, athleta | auditor | The page says customers buy from one brand or all four in one order: a shared checkout for the four catalog brands |
| oldnavy.gap.com | brands | old-navy | old-navy, gap, banana-republic, athleta | auditor | The same line on the Old Navy host |
| amazon.com | kind | merchant | marketplace | **record** | The pages show Amazon hosts sellers, not that it is mostly third-party sellers |
| whatnot.com (held out) | kind | merchant | marketplace | auditor | "The Live Shopping Marketplace", inviting visitors to become sellers |

Full reasons: [`adjudication.json`](../../evals/merchants/db/audit/adjudication.json); labels: [`labels/`](../../evals/merchants/db/audit/labels/); comparison: [`comparison.json`](../../evals/merchants/db/audit/comparison.json).

**What the disagreements say about the pipeline.** The four wrong supermarket records are all `definition` records whose store-page business-type test passed on department or service wording ("Grocery Pickup & Delivery", "shop for groceries online", "specialty market") that the written rule, read by the auditor and the adjudicator, does not accept as a business-type noun phrase, or on a page the issuer's own definition excludes (specialty food stores). The rule's lexical test (`BUSINESS_TYPE_WORDS`, three words or more) over-grants there. The nine missed bonuses go the other way: eight rest on issuer inclusion lists (Amex's "select major department stores" and "Select U.S. Streaming Subscriptions", Citi Strata's and U.S. Bank Altitude's streaming lists) that the rule accepts in principle but the verifier disputed as "a restriction to Amex's listed stores rather than a definition" or the drafter never quoted; the ninth is Costco's wholesale-club definition, which the rule refused because Chase's paragraph names no wholesale-club word. The two brand disagreements are one reading of Gap Inc.'s shared checkout line. The convention questions the ten auditors raised (whether a store with no usable page is `cant-tell` or `default` on the category, which they split 11 to the rest; whether kind and brand may rest on a co-brand issuer page when the store page is a bot wall, which most did; whether a product page without shipping wording shows physical goods) are in their packet reports and are for Evan.

## URL match

`extension/tests/merchant-url-set.test.ts` on the bundled release (`url-test-set.json` built by `build-url-set.mjs`; the expectation is the longest authored host that is a label-boundary suffix of the URL's host and shares its registrable domain):

| Set | URLs | Matched a store | Wrong store matches |
| --- | ---: | ---: | ---: |
| Every release host × 6 subdomain forms (bare, `www.`, `secure.`, `checkout.`, `www.secure.`, `a.b.c.`) × 6 checkout-like paths | 23,328 | 23,328 to the authoring record (or the longer authored subdomain record) | **0** |
| The frozen reader set's U.S. cart-state URLs (pane records, `us` stream; product, cart and empty-cart pages) | 367 | 365 (2 stores are not in the release; 364 in `audit.2`, after google.com's removal) | **0** |
| Look-alike traps: `amazon.ca`, `amazon.co.uk`, `target.com.au`, `walmartmoney.com`, `wal-mart.com`, `kroger.com.mx`, `notnewegg.com`, `newegg.com.evil.example`, deep subdomains of look-alikes, punycode and Unicode look-alikes (`xn--trget-gra.com`, Cyrillic `аmazon.com`), redirect-only or dropped domains (`jcp.com`, `cedarpoint.com`, `vudu.com`, `build.com`, `showtime.com`, `worldmarktheclub.com`, `costcobusinessdelivery.com`, `oldnavy.com`, `clubwyndham.com`, `nordstromrack.com`, `hy-veepharmacy.com`), unknown stores | 33 | 0 | **0** |

Match time stays under a millisecond per URL (`merchant-match.test.ts`). One finding for the candidate list rather than the matcher: the tier-A record `google-us` authored `google.com` (from the frame's top-stores bucket, a bot-walled render named from the label), so every Google page matched a default "Google" store; the profile is the generic one, so no reward changed, but the badge would have named the store on a Google cart page. Removed in `audit.2` ([Fixes](#fixes)).

## Cost

| Stage | Claude tokens | Model time | Notes |
| --- | ---: | ---: | --- |
| Seed research (14 batches incl. development) | 972,422 | 93 min | `merchant-researcher`, `claude-opus-5-5`, from the batch `state.json` files |
| Seed verify | 1,614,835 | 64 min | `merchant-verifier`, `claude-opus-5-5` |
| Seed drafts (gpt-5.6-luna `xhigh`) | 4,636,300 in / 88,779 out | 222 min | Codex, subscription; the state files hold each store's last accepted attempt |
| Audit labels, 10 packets | 1,919,001 | 32 min | general-purpose Opus subagents reading the agent file; 155k–220k per packet ([runs.json](../../evals/merchants/db/audit/runs.json)) |
| Adjudication, 19 items | 131,810 | 2.4 min | one Opus subagent |

No paid API calls; everything ran locally on subscription CLIs.

## Limits

- **Single labeller, single adjudicator, all models.** Each store was labelled once by one Opus run and each disagreement decided by one Opus run; no human read a store. The labels and verdicts are `agent-verified`. The auditor and the pipeline's verifier are the same model family, so shared blind spots are possible.
- **Blindness is procedural.** The auditor's packets contain nothing from the release, and the gate refuses a `filesRead` that names a forbidden file, but the subagents ran in the repository with read access; the rule is instruction and audit trail, not a sandbox.
- **Public sources only; no transaction data.** Nothing here shows how a store's charges actually code at a card network. An issuer's list or definition and a store's own page are the best public evidence; a store on no list, with no definition covering it, gets the general rate by design.
- **Bot walls.** 10 audited stores had no store page and 58 had a page under 300 characters (a bot wall or error page); 39 `cant-tell` kinds, 50 goods flags and 31 brand sets follow from that. For those stores the release's kind, goods and brand values rest on the research and issuer captures, which the auditor could confirm only when an issuer page names the domain.
- **Captures were truncated** to 8,000 characters per store page and 10,000 characters of issuer excerpts per store (80 of 230 sheets were cut), so an exclusion or business-type sentence deep in a page may have been invisible to the auditor.
- **One release, one run.** The audit was run once, after the full build, on `2026-10-11.seed.17`; the pipeline was not tuned on the audited stores. The fixes below are the only changes the audit makes.
- The URL test's expectation function uses the same label-boundary logic as the matcher with an independent registrable-domain check; it cannot find a host that should not have been authored (such as `google.com`), only hosts matched to the wrong record.

## Fixes

Under the plan, records the adjudication finds wrong are fixed after the report records the pre-fix numbers. The 16 adjudicated changes were applied by `evals/merchants/db/audit/apply-adjudication.mjs` (deterministic: the record takes the auditor's value; an added bonus cites the sources of the auditor's category and definition quotes from the batch manifests and its evidence file holds those quotes; a refused bonus falls to `general-merchandise`, `default`, no sources) as **release `2026-10-11.audit.1`**, listed in [`fixes.json`](../../evals/merchants/db/audit/fixes.json) and in `review.md` under "Audit fixes" for Evan to read before any publish (the current release is `2026-10-11.audit.2`, below):

- **Downgraded to `general-merchandise`, `default`** (wrong bonus category): aldi-us, kroger-us, marketbasket-us, wholefoodsmarket-us.
- **Bonus category added** (missed bonus): audible-us, disneyplus-us, plus-espn-us, siriusxm-us → streaming (`issuer`); bloomingdales-us, dillards-us, macys-us, jcpenney-us → department-stores (`issuer`). **costco-us was added as wholesale-clubs (`definition`) in `audit.1` and reverted to the default in `audit.2`** after the independent review of `79ace9da`: the cited Chase clause names no wholesale or warehouse club word (its heading is cut off in the capture) and no other captured definition clause names warehouse or wholesale clubs other than as exclusions, an "e.g." list or a quarterly line, so condition (b) is not met on the cited text. The adjudicator had called it the closest call. Costco stays at the general rate until an issuer page defines the category in words.
- **Brands**: gap-us and oldnavy-gap-us carry gap, old-navy, banana-republic and athleta.
- **Kind**: whatnot-us → marketplace.

The three verdicts for the record (amazon-us merchant, lyft-us default, sherwin-williams-us default) changed nothing.

**Review fixes in `2026-10-11.audit.2`** (independent review of `79ace9da`, same day): Costco back to the default (above); the tier-A record `google-us` removed and `google.com` excluded (it is the search site; the Google Store checks out at `store.google.com`, which no capture shows); the tier-A records named from generic page titles renamed from the label (usps-us "Welcome" → "USPS", lego-us "Home" → "LEGO", zillionsgift-us "Home" → "Zillionsgift") and the tier-A builder now skips such titles (`GENERIC_TITLE`) and excluded domains.

After the fixes `2026-10-11.audit.2` has 640 records, basis `default` 590, `definition` 37, `issuer` 13; 50 bonus categories (dining 12, streaming 11, supermarkets 9, department-stores 6, drugstores 5, home-improvement 4, entertainment 2, transit 1); 120 brand records; 62 cited sources. The extension tests that named Kroger and Whole Foods as bundled supermarkets now use Wegmans and Audible. The fixed records were not re-audited: their values are the adjudicated labels, so the audit numbers above describe `seed.17`, not `audit.2`.

## Addendum: the mcc basis (2026-10-11)

After the 14.5 fixes, Evan asked for the best-known chains to be fixed with merchant category codes ("fix the big names, i think we should use MCC codes … that is enough evidence"; [decision](../../wiki/decisions/2026-10-11-mcc-evidence-basis.md)). A fourth evidence basis, `mcc`, was added and applied deterministically to every record of `2026-10-11.audit.2` (`pipeline merchants mcc`), giving release **`2026-10-11.mcc.1`** (640 records). The records whose category changed were re-audited blind with the 14.5 method.

### The evidence

Openly licensed government purchase-card datasets that carry the merchant descriptor and the Visa merchant category description of every transaction, downloaded 2026-10-11 and kept out of the repository (hashes and row counts in [`evals/merchants/db/mcc/manifest.json`](../../evals/merchants/db/mcc/manifest.json)):

| Dataset | Licence | Rows |
| --- | --- | ---: |
| Open Data DC, "Purchase Card Transactions" (2009–2026) | CC0 1.0 | 639,306 |
| State of Oklahoma OMES, "Purchase Card (PCard)" FY2022, FY2023, FY2024 (36 monthly files) | CC BY | 382,724 + 408,063 + 421,889 |
| GSA SmartPay, "Purchase Card Transactions" Q3 2020 | CC0 1.0 | 6,913 |

Excluded on licence grounds: Delaware (a public-domain label only in portal metadata), Indiana (personal, news, nonprofit or academic use only), Oklahoma FY2025–FY2026 (no licence shown). **Attribution:** the Oklahoma datasets are published by the State of Oklahoma Office of Management and Enterprise Services under Creative Commons Attribution; see [`NOTICE.md`](../../evals/merchants/db/mcc/NOTICE.md). **Channel:** these are in-person and card-not-present *government* purchases, not consumer online checkout; a chain's website may code differently (costco.com did).

A store's rows are those whose merchant descriptor matches a committed, reviewable rule ([`descriptors.json`](../../evals/merchants/db/mcc/descriptors.json): the record's name on word boundaries by default, with explicit patterns, excludes for name collisions such as Domino's car washes and Nordstrom cafés, and vetoes). Descriptions are mapped to numeric codes through the Visa Merchant Data Standards Manual (April 2026, marked VISA PUBLIC) and to catalog categories in [`codes.json`](../../evals/merchants/db/mcc/codes.json): 5411 supermarkets, 5300 wholesale clubs, 5912 drugstores, 5812/5813/5814 dining, 5732/5734 electronics, 5311 department stores, 5200/5211/5251 home improvement, 4899 streaming (Visa's own guidance for subscription streaming), 7832/7922/7929/7941/7991/7996/7998 entertainment, 4111/4112/4121/4131/4784/7523 transit, 5541/5542 gas, 5552 EV charging. A category is granted at **10 or more matched rows with one category holding 80% or more** (fuel rows of a separate code set aside first); `issuer` evidence outranks the data; a marketplace gets dining only; the superstore guard (the store's own pages) applies to supermarkets and drugstores; eBay's department-store code was vetoed as the marketplace platform's.

### What changed

| | `2026-10-11.audit.2` | `2026-10-11.mcc.1` |
| --- | ---: | ---: |
| Bonus categories | 50 | **91** |
| by basis | `issuer` 13, `definition` 37 | `issuer` 13, **`mcc` 64**, `definition` 14 |
| dining | 12 | 27 |
| supermarkets | 9 | 16 |
| streaming | 11 | 12 |
| home-improvement | 4 | 8 |
| department-stores | 6 | 8 |
| electronics | 0 | 5 |
| drugstores | 5 | 5 |
| entertainment | 2 | 4 |
| transit | 1 | 4 |
| wholesale-clubs | 0 | 2 |

309 of 625 non-processor records matched at least one row, 194 at least 10; 64 records changed (41 from `default`, 23 `definition` records moved to `mcc` with the same category; the data contradicted no existing category). Of the 25 big names in Evan's list, **18 now carry a category** (Kroger, Whole Foods, Aldi, Safeway, Publix, Starbucks, Chipotle, Domino's, Panera, Pizza Hut, DoorDash, Uber Eats, Grubhub, Netflix, Best Buy, Newegg, Sam's Club, Nordstrom); Walgreens keeps `issuer`. Not granted: **Costco** (125 rows, wholesale clubs 76%: costco.com orders code as general merchandise in 20 rows against 22 wholesale-club rows); **Peacock** (0 rows in these datasets) and **Paramount+** (2 rows); **H-E-B, Food Lion and McDonald's** have no record (held out in 14.4 on disputed hosts) and **Rite Aid** is defunct. Also refused by the rule: Target (63% discount stores against grocery), Walmart (discount stores), eBay (vetoed), Instacart, Uber and Ticketmaster (marketplaces outside dining; Uber codes 100% taxicabs), Apple, Coach, Regal, Six Flags (79%), Topgolf and Discovery+ (under 80%).

Conflicts listed for Evan in `review.md` (MCC evidence section): Netflix's 5 continuity-subscription rows (5968) against 120 pay-television rows; Starbucks's 32 gift-card rows; Spotify's 65 Ad Studio advertising rows; Wendy's 15 software-store rows under one franchise descriptor; DoorDash's and Sam's Club's issuer sentences (credits and co-brand terms).

### Re-audit of the changed records

The 64 changed records were labelled blind by three `merchant-auditor` runs (claude-opus-5-5; 424,957 tokens, [`runs.json`](../../evals/merchants/db/audit/runs.json)) on packets whose sheets added an `mcc-evidence` section (the matched descriptors with their dataset descriptions and row counts, raw data only) and the code map; the agent file gained the `mcc` rule. Labels: [`labels-mcc/`](../../evals/merchants/db/audit/labels-mcc/); comparison: [`comparison-mcc.json`](../../evals/merchants/db/audit/comparison-mcc.json).

| Measure (64 changed records) | Result |
| --- | --- |
| **Wrong bonus category** | **0 of 64** (one-sided 95% Clopper–Pearson upper bound 4.6%); `cant-tell` 0 |
| Category agreement | 64 of 64, every category (dining 26, supermarkets 11, home-improvement 8, electronics 5, transit 4, streaming 3, department-stores 2, entertainment 2, wholesale-clubs 2, drugstores 1) |
| Basis | the auditor reached the same category on `mcc` for 57 and on `issuer` for 7 (CVS: Amex's drugstore list; Spotify, Hulu, Netflix: Citi's streaming list; Kohl's, Nordstrom: Amex's department-store list; Grubhub: Chase's food-delivery list); the release keeps `mcc` for those seven because the pipeline's verifier had disputed or the rule refused those issuer quotes earlier, and the data agrees with every one |
| Wrong brand | 0 of 9 records with brands |
| Wrong kind | 0 |
| Wrong goods | **1**: doordash.com, record `true`, auditor `false` (a delivery marketplace; the auditor notes it also delivers groceries and retail). Adjudication: see below |
| `cant-tell` | kind 5, physicalGoods 6, brandIds 5 (bot-walled store pages: Ace Hardware, Acme Tools, BJ's, Pizza Hut, Subway, Kohl's); category 0 |

The auditors' convention questions, for Evan: whether `mcc` may grant a category when every store page is a bot wall (it did, since the refusals depend only on what the pages say); whether a restaurant selling packaged goods (Starbucks whole-bean coffee) is still `physicalGoods: false`; whether Chase's separate food-delivery list is an `issuer` basis for dining (Grubhub); whether exactly 10 rows passes (Menards; yes, "at least 10"); whether an unrelated-looking descriptor under a matching name (a Wendy's franchise coded as a software store) should be excluded from the count (it was a minority and changed nothing).

**Adjudication of the one disagreement:** pending at the time of writing; recorded in [`adjudication-mcc.json`](../../evals/merchants/db/audit/adjudication-mcc.json) and in the line below once the third agent has decided.

### Limits

- The datasets are government purchasing: in person and card-not-present, mostly card-present at stores and restaurants. A website's own coding can differ (costco.com), and online-only brands with few government purchases get no evidence (Peacock, Paramount+).
- The Oklahoma descriptions are truncated at 40 characters; the DC file is refreshed monthly (its hash dates the fetch); the Oracle `ROWID` column repeats across Oklahoma's monthly files and was not used as a key.
- Descriptor rules match names, so a common name can collect another business's rows; the 10-row and 80% bars, the explicit excludes, the review table and the blind re-audit are the checks.
- The re-audit shares the 14.5 limits: one Opus labeller per store, procedural blindness, truncated captures.
