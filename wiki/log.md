# Log

Append-only history, newest first, grouped by UTC date. Format and actions: [how to track changes](guides/how-to-track-changes.md).

## 2026-10-02
* **Review** two independent reviewer agents checked the wiki against the code; fixed stale branch state, a re-capture contradiction in [cards](domain/cards.md), BCP U.S.-only detail and the unstated-cap wording. `llm-wiki` fast-forwarded to `phase3b-auto-badge` `1fd1e31`; [cart badge](system/cart-badge.md) and [extension](system/extension.md) updated for the frame nonce, order-question expiry, storage restriction and `record-savings` denial.
* **Create** wiki bundle in Open Knowledge Format with guides, working memory and seed pages; see [decision](decisions/2026-10-02-llm-wiki-documentation.md). (claude-code/claude-opus-5-5)
* **Deprecate** `docs/design.md` → [archive/design.md](archive/design.md) (pointer stub left at the old path) and `docs/plans/phase2-goal.md` → [archive/phase2-goal.md](archive/phase2-goal.md).
* **Ingest** archived design doc and plan, developer READMEs, code, `docs/research/` and `docs/evals/` into [product](product/index.md), [system](system/index.md), [domain](domain/index.md) and [ops](ops/index.md) pages.
* **Decision** ten retroactive records from the archived plan, 2026-09-28 to 2026-10-01; see [decisions](decisions/index.md).
* **Directive** the wiki is for development; Web Store extension docs (`docs/release/`, `docs/verification/`, `extension/README.md`) and package READMEs stay in place, unabsorbed; `CLAUDE.md` stays gitignored. See [user directives](product/user-directives.md).
