# @ai-checkout/catalog-pipeline

Maintainer tooling for the card-expansion pipeline (Phase 8). A deterministic CLI that keeps one text-free `state.json` per batch, hashes every stage's inputs, derives the open work, and wraps the Phase 7 scripts with `--dir <batch dir>`. It never starts a model itself except through `scripts/extract-cards.mjs` (Codex, local only), and it has no publish, push or sign-in command. Product code (`extension`, `packages/*`, `apps/*`) must never import this package.

```sh
npm run pipeline -- init wells-fargo-2026-10 --issuer "Wells Fargo" --cards "Autograph, Active Cash" \
  --domains wellsfargo.com --refresh --summary "Refresh the Wells Fargo cards"
npm run pipeline -- status [--batch B] [--json]
npm run pipeline -- next [--batch B] --json
npm run pipeline -- run capture|extract|draft|apply|build|eval [--batch B] [--only ids] [--concurrency N] [--wait-minutes N]
npm run pipeline -- rebase-anchors [--batch B]
npm run pipeline -- claim research|verify|adjudicate|overlay --issuer <slug> [--batch B] [--release]
npm run pipeline -- accept research|verify|adjudicate|overlay --issuer <slug> --agent-run <id> [--model <id>] \
  [--duration-ms N] [--tokens N] [--batch B] [--dry-run]
npm run pipeline -- resolve capture-flagged --source <id> --reason expected-short-page|false-positive-flag|keep-existing-capture
npm run pipeline -- lint-labels [--batch B | --dir evals/curation/expansion] [--json]
npm run pipeline -- eval [--batch B] [--cross-model-run DIR]   # writes pipeline/eval.json; prints the cross-model command
npm run pipeline -- handoff [--batch B]                        # prints the PR checklist and Evan's publish steps; writes nothing
```

`claim` writes a work packet (`pipeline/packets/`, gitignored: absolute paths of this machine) naming the cards, the inputs and the one output file the agent writes; `accept` runs the stage's gates on that file and records the packet, agent run, model and, from the subagent's completion notice, `durationMs` and `tokens` in `state.json`. Gate errors name paths and fields, never issuer text.

Runs on Node 24 type stripping (`node src/cli.ts`); tests are `npm test --workspace=@ai-checkout/catalog-pipeline` and use synthetic fixtures only.

Design, commands, statuses and what each milestone adds: [wiki/system/card-expansion-pipeline.md](../../wiki/system/card-expansion-pipeline.md).
