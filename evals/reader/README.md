# Generic cart reader harness (Phase 13)

Runs and scores the generic cart reader (`packages/cart-reader`, `readCart(document, { url })`) on the frozen real page-states of one split, as [`generic-reader-protocol.11`](../../docs/evals/generic-reader-protocol.md) requires (Scoring, Pass bar, Peek policy and stop rule, Reading time). The protocol is binding and wins over this page. The reader in `packages/cart-reader` is a placeholder that always withholds (`not-implemented`); the reader developer writes the rules later, on development pages only.

```sh
node evals/reader/run.mjs --split development
node evals/reader/score.mjs --run <runId> [--failures] [--record]       # --failures: development only
# held-out A: an evaluation subagent, never the reader developer
node evals/reader/run.mjs --split heldout-a --confirm-heldout-run <n>   # n = 1 or 2; each run counts once it starts
node evals/reader/score.mjs --run <runId> --record                      # aggregate metrics only
node evals/reader/score.mjs --run <runId> --class-only                  # the class-only analyst
npm run test:reader:browser                                             # browser tests (synthetic pages)
```

| File | What it does |
| --- | --- |
| `run.mjs` | Refuses unless `evals/merchants/freeze.json` exists and `freeze.mjs`'s check passes (pane snapshots re-hashed). Enforces the held-out run limit (`heldout-a` at most 2 runs in total) and `--confirm-heldout-run <n>`; a held-out run also needs `packages/cart-reader` committed. Bundles the reader with esbuild (`bundle.mjs`). Appends a text-free row to `runs.json` (run ID, UTC time, reader commit, split, frozen label SHA-256, freeze SHA-256, bundle SHA-256, Chromium version) before reader code runs on any page. Loads each real page-state once in Playwright Chromium with every request aborted: pane captures are rebuilt from `dom.json` (checked against the frozen dom and rebuilt SHA-256) and loaded with JavaScript disabled; robot captures go through `replay.mjs` (MHTML, manifest checked). Then it injects the reader and reads: one untimed warm-up read, three timed reads, and a stability pair 500 ms apart (each read timed in the page, the wait not timed). The scored output is the stability pair's when both reads agree, otherwise withheld `unstable`; a read that throws or breaks the Zod contract is withheld `crash`. Writes `runs/<runId>/outputs.jsonl` and `run.json` (machine, Chromium, bundle inputs). Variants are not loaded yet: their page format comes with the variant generator |
| `score.mjs` | Refuses a run that isn't in `runs.json`, a failing freeze check, or a run made on other frozen labels. Outcomes `shown-correct` / `shown-wrong` / `withheld` as the protocol defines them. Precision with the exact one-sided 95% Clopper–Pearson upper bound of the wrong rate, Wilson 95% intervals and rule-of-three bounds for zero counts, at page-state, site-cluster and operator-cluster level (the operator comes from the frozen `retail-frame-3.json`, for scoring only). Coverage leaves out `cart-other`; a site or operator counts as covered when every one of its eligible page-states is shown-correct. Breakdowns by stream, state, region group, USD or not, currency (5 sites or more) and observed tag. p95 read time is the nearest rank over every timed read. Criterion 1 (upper bound ≤ 1% and p95 ≤ 50 ms on the whole split, every page-state scored) is evidence only on a held-out split. Variants are reported apart, by transform. Errata (`evals/merchants/errata/<split>.json`, `{ errata: [{ id, new }] }`) are scored beside the frozen-label result, never instead of it |
| `stats.mjs` | Clopper–Pearson, Wilson, rule of three, nearest-rank percentile |
| `bundle.mjs` | esbuild IIFE bundle of `packages/cart-reader/src`; refuses any input outside it (a frame, label or candidate list, any dependency) and any `data-pane-*` reference |
| `lib.mjs` | Frozen inputs, `runs.json` (`reader-runs.1`, Zod-checked, text-free) and the run limit |

**Class-only output** (`--class-only`) gives counts per class and stream only: no domain, amount or page text. Some classes can be derived from the label and the output alone: `unreadable-shown`, `tie-shown`, `currency`, `kind-wrong`, `coverage-miss`, `stability`, `crash`, `over-budget` (any timed read over 50 ms) and `missing`. Classes that need the page are not: a wrong amount of the right kind and currency, or an amount shown where no total is displayed, is counted as `needs-analyst`. The analyst then sorts those into `region-wrong`, `distractor-accepted` (with the distractor), `amount-parse` (with the format) or `other`, from the gitignored per-page outputs.

`runs/` is gitignored. `runs.json` is committed and holds only the text-free rows. Tests: `tests/*.test.mjs` (in `npm run test:scripts`) and `tests/browser/*.test.mjs` (`npm run test:reader:browser`). Both use synthetic pages and labels only.
