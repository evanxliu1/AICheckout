# @ai-checkout/catalog-pipeline

Maintainer tooling for the card-expansion pipeline (Phase 8). A deterministic CLI that keeps one text-free `state.json` per batch, hashes every stage's inputs, derives the open work, and wraps the Phase 7 scripts with `--dir <batch dir>`. It never starts a model itself except through `scripts/extract-cards.mjs` (Codex, local only), and it has no publish, push or sign-in command. Product code (`extension`, `packages/*`, `apps/*`) must never import this package.

```sh
npm run pipeline -- init wells-fargo-2026-10 --issuer "Wells Fargo" --cards "Autograph, Active Cash" \
  --domains wellsfargo.com --refresh --summary "Refresh the Wells Fargo cards"
npm run pipeline -- status [--batch B] [--json]
npm run pipeline -- next [--batch B] --json
npm run pipeline -- run capture|extract|draft|apply|build|eval [--batch B] [--only ids] [--concurrency N] [--wait-minutes N]
npm run pipeline -- rebase-anchors [--batch B]
npm run pipeline -- eval [--batch B] [--cross-model-run DIR]   # writes pipeline/eval.json; prints the cross-model command
npm run pipeline -- handoff [--batch B]                        # prints the PR checklist and Evan's publish steps; writes nothing
```

Runs on Node 24 type stripping (`node src/cli.ts`); tests are `npm test --workspace=@ai-checkout/catalog-pipeline` and use synthetic fixtures only.

Design, commands, statuses and what each milestone adds: [wiki/system/card-expansion-pipeline.md](../../wiki/system/card-expansion-pipeline.md).
