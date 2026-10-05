# Ops

Runbooks: procedures someone will repeat. Numbered steps, exact commands, expected output.

* [Local setup](local-setup.md) — install, build, lint, test, run the database suite and load the extension on a development machine.
* [Hosting](hosting.md) — what runs on Render and hosted Supabase, deploys, and environment variable names.
* [Catalog release](catalog-release.md) — publish a bundled catalog as the next hosted release: the coordinator's `pipeline publish` on Evan's chat instruction (release 3, `2026-10-05.renewal.1`, 2026-10-05) or the review app as the fallback (release 2, 2026-10-03); then verify `/v1/catalog` and the extension's refresh.
* [Database migrations](database-migrations.md) — create and test a migration locally, keep the seed in sync, hand the hosted push to Evan.
* [Live model runs](live-model-runs.md) — local live evals through the Codex and Claude Code CLI subscriptions, matrix runner and resume.
* [Release media](release-media.md) — npm scripts that regenerate store and portfolio media, and their prerequisites.
