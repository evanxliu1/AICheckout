# Log

Append-only history, newest first, grouped by UTC date. Format and actions: [how to track changes](guides/how-to-track-changes.md).

## 2026-10-02
* **Update** state after PRs #13 and #14 merged (`origin/main` `7322dec`): [cart badge](system/cart-badge.md) (host-removal observer, back/forward-cache resume, covered-click status), [testing](system/testing.md) (378 extension tests; hooksPath behavior across worktrees), [roadmap](product/roadmap.md) (Phase 3 and 3b done, Phase 7 added), [hosting](ops/hosting.md) and [database migrations](ops/database-migrations.md) (all 8 migrations on hosted; catalog `2026-09-29.real.1` published 2026-10-02T02:29Z, checked via `GET /v1/catalog`), [now](now.md) rewritten. (claude-code/claude-opus-5-5)
* **Create** [catalog expansion](system/catalog-expansion.md) — Phase 7 pipeline, results and remaining work, read from the unmerged `phase7-catalog-expansion` worktree at `fc66e07`.
* **Decision** [2026-10-02-gpt-5-6-luna-for-curation](decisions/2026-10-02-gpt-5-6-luna-for-curation.md) — curation moves to gpt-5.6-luna `xhigh` for frontier currency; accuracy ties gpt-5.5, slower, one false-clean.
* **Decision** [2026-10-01-top-ten-issuer-card-expansion](decisions/2026-10-01-top-ten-issuer-card-expansion.md) — card expansion scope; status line of the 2026-09-28 seven-card record points to it.
* **Directive** recorded in [user directives](product/user-directives.md): coordinating session may merge and deploy (2026-09-29), no local models (2026-09-29), automatic badge (2026-10-01), expansion scope (2026-10-01), more concurrency over usage limits (2026-10-01), gpt-5.6-luna (2026-10-02). `AGENTS.md` and `.cursor/rules/agents.mdc` hosted-action rules aligned.
* **Review** two independent reviewer agents checked the wiki against the code; fixed stale branch state, a re-capture contradiction in [cards](domain/cards.md), BCP U.S.-only detail and the unstated-cap wording. `llm-wiki` fast-forwarded to `phase3b-auto-badge` `1fd1e31`; [cart badge](system/cart-badge.md) and [extension](system/extension.md) updated for the frame nonce, order-question expiry, storage restriction and `record-savings` denial.
* **Create** wiki bundle in Open Knowledge Format with guides, working memory and seed pages; see [decision](decisions/2026-10-02-llm-wiki-documentation.md). (claude-code/claude-opus-5-5)
* **Deprecate** `docs/design.md` → [archive/design.md](archive/design.md) (pointer stub left at the old path) and `docs/plans/phase2-goal.md` → [archive/phase2-goal.md](archive/phase2-goal.md).
* **Ingest** archived design doc and plan, developer READMEs, code, `docs/research/` and `docs/evals/` into [product](product/index.md), [system](system/index.md), [domain](domain/index.md) and [ops](ops/index.md) pages.
* **Decision** ten retroactive records from the archived plan, 2026-09-28 to 2026-10-01; see [decisions](decisions/index.md).
* **Directive** the wiki is for development; Web Store extension docs (`docs/release/`, `docs/verification/`, `extension/README.md`) and package READMEs stay in place, unabsorbed; `CLAUDE.md` stays gitignored. See [user directives](product/user-directives.md).
