# Catalog renewal 2026-10: freshness check and refresh batches

Phase 9 milestone 4, run on 2026-10-05 with the `tools/catalog-pipeline` CLI. The run renews hosted release 2 (`2026-10-02.expansion.1`, which expires 2026-11-01T00:00Z) as `2026-10-05.renewal.1`, verified 2026-10-05 and expiring 2026-11-04T00:00Z. Every number below comes from committed files:

- `evals/curation/freshness/2026-10-05.json`;
- each batch's `pipeline/eval.json` and `pipeline/state.json`;
- `evals/curation/expansion/catalog-build-report.md`.

**All label figures are agreement between agents, not human-checked accuracy.** The refreshed labels and the frozen labels they are compared with are both agent-verified.

## 1. Freshness check

`pipeline freshness` re-rendered every cited source with the capture script and its hints, compared the SHA-256 with the manifest, and kept no page text. Renderer: Playwright 1.63.0, Chromium 153.

| Layer | Unchanged | Changed | Flagged |
| --- | --- | --- | --- |
| `expansion.v1` (captured 2026-10-02) | 176 | 124 | 1 (bot wall) |
| `real.v2.2` (2026-09-29) | 5 | 9 | 0 |
| merchant MCC pages | 2 | 0 | 0 |
| `wells-fargo-2026-10` (2026-10-04) | 9 | 2 | 0 |
| **All 328** | **192** | **135** | **1** |

Hash-only means any byte change counts. A one-day probe on 2026-10-04 already showed some changes that are clearly volatile: a one- or two-word date or ID change, and one page that alternated between two versions on consecutive days. So the 41% change rate is an upper bound on real term changes. The re-verification below measures the real ones.

## 2. Refresh batches

107 cards had at least one changed source. They went into 10 seeded batches, one per issuer, named `<issuer>-refresh-2026-10`. Research was skipped because the cards and pages are known, so the run started at capture. Unchanged pages of a changed card were re-captured too, so each batch holds all its cards' sources.

| Measure | Value |
| --- | --- |
| Cards / sources captured | 107 / 215 (0 failed) |
| Drafted / undrafted | 91 / 16. "Undrafted" means no extracted value resolved to an anchor, so the verifier wrote every label from the captures, as in Phase 7 |
| Draft rules → verified rules | 448 → 561 (20 removed, 133 added) |
| Verifier correction rate | 5.4% of draft rule-field values (186/3,424) |
| Adjudication | 812 findings: 799 accepted, 7 modified, 6 rejected; no card dropped |
| Label-lint acknowledgements | 25, all by adjudicators after reading the number in the capture (truncated anchors, reversed phrasing, a quarter written as "OCT-DEC 2026") |
| Conventions added | 1 (Barclays: program Terms & Conditions acceptance is part of holding the loyalty account; activation stays `none`) |
| Extraction (gpt-5.6-luna `xhigh`) | 319.7 model-minutes, 1,093,021 input / 171,761 output tokens |
| Agent stages (verify, adjudicate, overlay) | 2,022,335 tokens in total, as reported by Claude Code |

## 3. Agreement with the previous labels

101 refreshed cards also exist in `expansion.v1`. Their re-derived labels were compared with the frozen ones:

| Measure | Agreement |
| --- | --- |
| Rules | 534 matched; 1 only in `expansion.v1`, 2 only in the batches |
| Rule fields (rate, paid on payment, cap, activation, U.S.-only, limited time) | 98.8% (3,166/3,204) |
| Cards identical in every compared field | 35/101 |

Per issuer, rule-field agreement is 96.8–100%, except Wells Fargo's two Autograph cards at 83.3%. There the batch applies general convention 7 (activation `none`), which the frozen labels left unstated.

## 4. The renewed catalog

| Measure | Value |
| --- | --- |
| Version and validity | `2026-10-05.renewal.1`, verified 2026-10-05, expires 2026-11-04. Oldest source date 2026-10-02 |
| Cards / rules / size | 178 / 816 / 602,960 bytes JSON |
| Rule-ID continuity against release 2 | 589 kept, 224 changed (new IDs), 3 added, 7 dropped |
| Real cards refreshed | Double Cash, Quicksilver, Savor, Freedom Unlimited, Blue Cash Everyday and Preferred. Active Cash's pages were unchanged |

**Changes a shopper may notice:**
- Blue Cash Everyday and Blue Cash Preferred no longer earn bonus rates when paid through PayPal, Venmo or a digital wallet. Their refreshed terms carry the Amex wallet sentence, handled under convention O10. Golden ladder W13 now shows 1% for Blue Cash Everyday on the PayPal and Venmo paths.
- Savor excludes Walmart and Target from its grocery rate and wallets from its bonus rates.
- Freedom Unlimited excludes wallets on dining and drugstores.
- Atmos Summit's 10% relationship boost is now a note instead of a gated rate. The boosted rate is stated nowhere, so the lint cannot evidence it.
- Freedom Flex's Jan–Mar 2027 quarter is omitted. The capture does not state its end date, and this release expires before that quarter starts.
- Usage that a shopper recorded on any of the 224 changed rule IDs (20 of them release-1 real-card rules) is dropped on update, with the extension's migration notice. This is by design.

## 5. What the run exposed

1. **Second packets reuse the first packet's output path.** For undrafted cards, the second overlay packet had to replace an already accepted fragment. One replacement was refused by the permission system and was done after Evan approved it; the others went through.
2. **An overlay-only convention file still counts as an adjudicate input.** Writing one made adjudication stale, so the coordinator removed it.
3. **Fixed in PR #48:** the Phase 7 quote-limit omission list made the build throw for re-labelled cards.
4. **Handoff names the wrong folder for freshness-dated merchant sources:** it gives the freshness record instead of `real/merchant-captures`.
5. **The draft script produced an impossible end date** (`1365-10-04`) on Bank of America Secured. The verifier caught it.
6. **One overlay agent wrote working files to a shared scratchpad.** It overwrote one file there, and no repository file was affected.

## Reproduce

`npm run pipeline -- status` and `npm run pipeline -- eval --batch <batch>` recompute everything except the trace re-score. That needs the gitignored captures and traces in `/Users/evanliu/Projects/AICheckout-p8-wf`. No model is called by `eval`.
