# @ai-checkout/catalog-pipeline

Maintainer tooling for the card-expansion pipeline (Phase 8). A deterministic CLI that keeps one text-free `state.json` per batch, hashes every stage's inputs, derives the open work, and wraps the Phase 7 scripts with `--dir <batch dir>`. It never starts a model itself except through `scripts/extract-cards.mjs` (Codex, local only), and it has no publish, push or sign-in command. Product code (`extension`, `packages/*`, `apps/*`) must never import this package.

```sh
npm run pipeline -- init wells-fargo-2026-10 --issuer "Wells Fargo" --cards "Autograph, Active Cash" \
  --domains wellsfargo.com --refresh --summary "Refresh the Wells Fargo cards"
npm run pipeline -- freshness [--date YYYY-MM-DD] [--only sourceIds] [--concurrency N]   # hash-only re-check of every cited source
npm run pipeline -- init amex-refresh-2026-10 --issuer "American Express" --refresh-from-freshness 2026-10-10 [--cards ids]
npm run pipeline -- status [--batch B] [--json]   # without --batch also the newest freshness record's counts
npm run pipeline -- next [--batch B] --json
npm run pipeline -- run capture|extract|draft|apply|build|eval [--batch B] [--only ids] [--concurrency N] [--wait-minutes N]
npm run pipeline -- run build --batch B --proposed --version 2026-10-05.wells-fargo.1   # builds into pipeline/proposed/; ships nothing
npm run pipeline -- run build --batch B [--version <new version>]   # registers the batch, writes CATALOG_V3; --version needed while the config's version is published
npm run pipeline -- rebase-anchors [--batch B]
npm run pipeline -- claim research|verify|adjudicate|overlay --issuer <slug> [--batch B] [--release]
npm run pipeline -- accept research|verify|adjudicate|overlay --issuer <slug> --agent-run <id> [--model <id>] \
  [--duration-ms N] [--tokens N] [--batch B] [--dry-run]
npm run pipeline -- resolve capture-flagged --source <id> --reason expected-short-page|false-positive-flag|keep-existing-capture
npm run pipeline -- drop-source --source <id> --reason bot-wall|error-page|out-of-scope|duplicate [--batch B]
npm run pipeline -- lint-labels [--batch B | --dir evals/curation/expansion] [--json]
npm run pipeline -- eval [--batch B] [--cross-model-run DIR]   # writes pipeline/eval.json; prints the cross-model command
npm run pipeline -- handoff [--batch B]                        # prints the PR checklist and Evan's publish steps; writes nothing
```

`claim` writes a work packet (`pipeline/packets/`, gitignored: absolute paths of this machine) naming the cards, the inputs and the one output file the agent writes; `accept` runs the stage's gates on that file and records the packet, agent run, model and, from the subagent's completion notice, `durationMs` and `tokens` in `state.json`. Gate errors name paths and fields, never issuer text.

`run build --proposed` writes the would-be build config (`catalog-batches.json`, the batch as newest layer, the given version), `catalog-v3.json`, `catalog-build-report.md` and `ledger-diff.json` (IDs and counts) to the batch's `pipeline/proposed/` through `scripts/build-catalog-v3.mjs --config … --out-dir …`; the build config, the rule-ID ledger, `CATALOG_V3` and the committed build report are not touched, no `publish` item is queued and `handoff` reports the proposed version. A version in the config's `publishedVersions` is never rebuilt with other rule IDs or terms (the builder refuses before writing).

`drop-source` removes a source from `sources.json`, `manifest.json` and the cards' `sourceIds` (refusing when a card would be left without one), moves its capture to `captures-dropped/` (gitignored), records `{ reason, droppedAt }` under `droppedSources` in `state.json` and refuses frozen layers (a base layer, or a batch in the build config of a published version). The affected cards' capture turns stale and re-runs. `next` returns every card of a stage that shares a queue code in one step.

`lint-labels` reports the label-evidence lint as findings raised, acknowledged and open. A finding the lint cannot read is acknowledged only by an agent: the adjudicator in its findings file (`labelLintAcks: [{ cardId, ruleIndex, check, reason }]`) or the overlay author in its fragment, with `reason` one of `anchor-truncated`, `reversed-phrasing`, `split-anchors`, `points-wording-cash-label`, `date-outside-anchor`, `relationship-bonus`. Each ack must name a raised finding; the CLI has no override of its own. `accept adjudicate` (also `--dry-run`) lints the corpus cases apply will write and fails on every finding no ack covers, so the adjudicator sees them before it reports; the apply lint stays a backstop.

`freshness` (Phase 9, no model, refused under `CI`/`RENDER`) re-renders every source the build config's catalog cites (card sources of every layer, the real cards' pages, the merchant MCC pages) through `scripts/capture-issuer-pages.mjs` with the layer's capture hints, one process per host (2.5 s between its pages, up to `--concurrency` hosts at once, default 4), into a temporary directory under `os.tmpdir()` that is deleted in all cases. It writes the text-free record `evals/curation/freshness/<date>.json` (per source: layer, manifest SHA-256, rendered SHA-256 or null, `unchanged | changed | unreachable | flagged`, flag codes; the renderer's script hash and Playwright and Chromium versions; counts per result) after each host, so a re-run the same day resumes (sources missing, unreachable or re-hashed since); `--only` re-checks exactly the named ones. The builder dates a source by the newest record that found it `unchanged`. `init --refresh-from-freshness <date>` creates a refresh batch of the issuer's cards with a changed source in that record (or exactly `--cards`), seeded from each card's current layer: `cards.json`, all its `sources.json` entries, the layer's capture hints, an empty `exclusions.json`; research is recorded done with provenance `seeded` and goes stale if a seed file or the record changes.

Runs on Node 24 type stripping (`node src/cli.ts`); tests are `npm test --workspace=@ai-checkout/catalog-pipeline` and use synthetic fixtures only.

Design, commands, statuses and what each milestone adds: [wiki/system/card-expansion-pipeline.md](../../wiki/system/card-expansion-pipeline.md).
