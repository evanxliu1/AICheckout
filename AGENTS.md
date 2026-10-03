# AGENTS.md — AI Checkout

Operating instructions for coding agents (Claude Code, Codex, Cursor) in this repository. Codex and Cursor read this file directly; Claude Code loads it through a local, gitignored `CLAUDE.md` containing `@AGENTS.md` (create it if your checkout has none).

## What this project is

A Chrome extension that tells a shopper which card they already own earns the most at an online checkout, backed by an LLM curation pipeline that keeps the card catalog current from issuer terms, with a human approving every change. No model runs at checkout. It is Evan Liu's portfolio project for LLM-engineering roles; the headline is the measured extraction evaluation. Details: [goal](wiki/product/goal.md), [architecture](wiki/system/architecture.md).

| Deployment | Code | Runtime | Storage | Status |
| --- | --- | --- | --- | --- |
| Extension | `extension/`, `packages/rewards-core`, `packages/catalog-client`, `packages/ui` | Chrome MV3 | `chrome.storage` on device | Built locally; Web Store release pending |
| API + review app + site | `apps/api`, `apps/review`, `apps/site` | Node 24 on Render (`render.yaml`) | Hosted Supabase (Auth + Postgres) | Live; auto-deploys `main` |
| Curation and evals | `apps/api/src/curation`, `evals/curation`, `scripts/` | Owner's machine only | Gitignored run dirs and captures | Local |

## The wiki is the memory

`wiki/` is the project's long-term development memory: an LLM wiki in Open Knowledge Format (markdown + YAML frontmatter). It holds intent, decisions, domain rules, system understanding, runbooks and history. Code is the source of truth for **behavior**; the wiki is the source of truth for **why** and **what was agreed**. When they disagree, fix the wiki in the same change and say so.

**Session protocol, every task:**

1. **Start.** Read `wiki/now.md` (current state, active work, open questions), then `wiki/index.md`. Read the `wiki/system/` and `wiki/domain/` pages for the area you will touch. Do not re-derive what those pages already state.
2. **Work.** Follow the rules below. Prefer reading a wiki page over grepping the whole tree; prefer the code over the wiki when they conflict, then fix the wiki.
3. **Finish.** Update `wiki/now.md`, append to `wiki/log.md`, update any page whose facts changed, and add a `wiki/decisions/` record for any non-obvious choice you or the user made. Run `python3 scripts/lint_wiki.py`. A change that alters behavior, setup or contracts without a wiki update is unfinished.

Guides: [how to use the wiki](wiki/guides/how-to-use-this-wiki.md) · [how to document](wiki/guides/how-to-document.md) · [how to track changes](wiki/guides/how-to-track-changes.md) · [archive policy](wiki/guides/archive-policy.md).

## Behavioral guidelines

Adapted from [Andrej Karpathy's guidelines](https://github.com/multica-ai/andrej-karpathy-skills) (MIT). They bias toward caution over speed; for trivial tasks, use judgment.

**1. Think before coding.** Don't assume, don't hide confusion, surface tradeoffs. State assumptions explicitly. If several interpretations exist, present them instead of picking silently. If a simpler approach exists, say so and push back when warranted. If something is unclear, stop, name what is confusing, and ask.

**2. Simplicity first.** Minimum code that solves the problem, nothing speculative. No features beyond what was asked. No abstractions for single-use code. No configurability that wasn't requested. No error handling for impossible scenarios. If 200 lines could be 50, rewrite. Ask: "Would a senior engineer call this overcomplicated?"

**3. Surgical changes.** Touch only what you must; clean up only your own mess. Don't "improve" adjacent code, comments or formatting. Don't refactor what isn't broken. Match existing style even if you'd do it differently. Mention unrelated dead code, don't delete it. Remove only the imports/variables your change orphaned. Every changed line should trace to the request.

**4. Goal-driven execution.** Define success criteria, loop until verified. "Add validation" becomes "write tests for invalid inputs, make them pass". "Fix the bug" becomes "write a reproducing test, make it pass". For multi-step work state a short plan of `step → verify` pairs. Report outcomes faithfully: failed tests are reported with output, skipped steps are named.

## Project rules

These are standing user directives; the dated record is in [wiki/product/user-directives.md](wiki/product/user-directives.md).

- **No model at checkout, no model write path.** The engine is deterministic; the LLM only drafts catalog changes that a human reviews, applies and publishes as separate steps.
- **Hosted actions belong to Evan.** Subagents never merge PRs, push `main` or push migrations to hosted Supabase; they stop at a ready branch and hand over exact commands. The coordinating session may merge PRs, push `main` and run `./scripts/db-push.sh` when Evan has authorized it (standing since 2026-09-29). Nobody but Evan signs in to hosted services or publishes a catalog release; he publishes catalogs himself in the review app.
- **Never edit an applied migration.** Add a new one (`npm run supabase -- migration new <name>`); mirror catalog validators in Zod and SQL and keep the parity cases passing.
- **Live models run locally through subscription CLIs only**: Claude models through Claude Code CLI subagents, OpenAI models through Codex. No local models, no paid API calls; curation is never enabled on Render. Curation and extraction runs use `gpt-5.6-luna` at `xhigh` ([decision](wiki/decisions/2026-10-02-gpt-5-6-luna-for-curation.md)).
- **Eval integrity.** Never re-capture issuer pages, edit corpus labels to fit results, or tune prompts on held-out data. New prompt versions are new files; never edit a released one.
- **Copyrighted sources.** Issuer captures stay gitignored; commit only URLs, hashes, labels and quotes of 25 words or fewer.
- **Reviews by subagents.** Verification and review steps go to independent subagents; record provenance honestly (`agent-verified`, not `human-verified`).
- **Safety on retailer and hosted sites.** Never type secrets or passwords, create accounts, place orders or permanently delete data.
- **Web Store docs are not wiki material.** `docs/release/`, `docs/verification/` and `extension/README.md` are the extension's public and release docs; edit them only when the task is about them, and never move them into the wiki.
- **Never commit secrets or personal data.** `.env*` (except `.env.example`), `simulation/`, `research_notes/`, `evals/curation/runs/` and captures are gitignored.
- **Dates are absolute.** Write `YYYY-MM-DD`, never "today" or "last week", in code comments, docs and the wiki. Wiki timestamps are UTC.

## Commands

Node 24 (`.nvmrc`). Full list and prerequisites: [local setup](wiki/ops/local-setup.md).

```sh
npm ci
npm run lint && npm run format:check && npm run typecheck
npm test                          # unit/component tests in every workspace + scripts
npm run build                     # extension/dist, apps; load extension/dist in chrome://extensions
npm run eval:v2 -- --check        # extraction harness self-check, no model
npm run catalog:v2:check          # generated 7-card catalog is up to date
npm run catalog:v3:check          # generated 178-card catalog v3 and its build report are up to date
npm run test:browser --workspace=ai-checkout-extension   # Playwright on the built extension
npm run db:start:api && npm run db:test                   # needs Docker; see wiki/ops/database-migrations.md
python3 scripts/lint_wiki.py      # wiki conformance and links
```

## Conventions

- **TypeScript:** strict, ESM, Zod for every contract; integer cents and basis points, never floats for money. Packages are consumed as TS source. Node scripts in `scripts/` use type stripping, so import `.ts` with explicit extensions and avoid parameter properties.
- **Tests:** vitest next to each workspace's `tests/`; Playwright in `e2e/` with role/label selectors and axe checks; SQL tests under `supabase/`.
- **UI:** `packages/ui` components on Helios tokens only; CSP `style-src 'self'` (no inline styles, no remote fonts).
- **Branches and PRs:** one branch and one PR per milestone, cut from the latest `main`; both GitHub workflows must pass. Render deploys `main` on merge.
- **Documentation:** development facts go into the wiki page that owns the concept, not a new markdown file. Root markdown is limited to `README.md`, `SECURITY.md`, `AGENTS.md` (and the local `CLAUDE.md`). Package READMEs stay as package entry points and the wiki links to them. Superseded development docs go to `wiki/archive/` via the archive policy; nothing is deleted.
