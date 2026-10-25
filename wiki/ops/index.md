# Ops

Runbooks: procedures someone will repeat. Numbered steps, exact commands, expected output.

* [Local setup](local-setup.md) — install, build, lint, test, run the database suite and load the extension on a development machine.
* [Hosting](hosting.md) — what runs on Render and hosted Supabase, deploys, and environment variable names.
* [Catalog release](catalog-release.md) — publish a bundled catalog as the next hosted release: the coordinator's `pipeline publish` on Evan's chat instruction, with every capture in the main checkout, or the review app as the fallback; then verify `/v1/catalog` and the extension's refresh; renewing before expiry.
* [Catalog release history](catalog-release-history.md) — dated records of each hosted catalog and merchant release, the served head and its expiry, and how renewals were prepared.
* [Database migrations](database-migrations.md) — create and test a migration locally, keep the seed in sync, push to hosted (Evan, or the coordinating session when authorized).
* [Live model runs](live-model-runs.md) — local live evals through the Codex and Claude Code CLI subscriptions, matrix runner and resume.
* [Release media](release-media.md) — npm scripts that regenerate store and portfolio media, and their prerequisites.
