# Ops

Runbooks: procedures someone will repeat. Numbered steps, exact commands, expected output.

* [Local setup](local-setup.md) — install, build, lint, test, run the database suite and load the extension on a development machine.
* [Hosting](hosting.md) — what runs on Render and hosted Supabase, deploys, and environment variable names.
* [Catalog release](catalog-release.md) — publish a bundled catalog as the next hosted release: the coordinator's `pipeline publish` on Evan's chat instruction, with every capture in the main checkout, or the review app as the fallback; then verify `/v1/catalog` and the extension's refresh; renewing before expiry.
* [Catalog release history](catalog-release-history.md) — dated records: release 3 (`2026-10-05.renewal.1`, agent publish, 2026-10-05), release 2 (`2026-10-02.expansion.1`, review app, 2026-10-03), and how the renewal was prepared.
* [Database migrations](database-migrations.md) — create and test a migration locally, keep the seed in sync, hand the hosted push to Evan.
* [Live model runs](live-model-runs.md) — local live evals through the Codex and Claude Code CLI subscriptions, matrix runner and resume.
* [Release media](release-media.md) — npm scripts that regenerate store and portfolio media, and their prerequisites.
* [Reader capture workflow](reader-capture-workflow.md) — Phase 12.3: how the coordinator runs pane capture as Claude workflows (pilot, full capture, split/label/review/freeze) under `generic-reader-protocol.10`; stop-and-ask points; merge only after CI passes.
