# Decisions

Dated records of choices, one per file, in the format **Context**, **Options considered**, **Decision**, **Consequences**, **Status** (template in [how to document](../guides/how-to-document.md#templates)). A record is never edited after acceptance except its status line; a change of mind is a new record that supersedes the old one. Standing instructions are summarised in [user directives](../product/user-directives.md).

## 2026-10-02
* [Cut expansion quotes to 25-word evidence windows; per-issuer findings files with a second-pass adjudication](./2026-10-02-expansion-quote-limit-and-verification-format.md) — Expansion drafts are committed with capture quotes cut to 25-word windows that keep the value; verifiers write Zod-checked findings per issuer; only adjudicated cards become agent-verified.
* [Publish the gpt-5.6-luna run per split, marked added after, and make it the Codex default](./2026-10-02-luna-results-per-split.md) — The all-cases luna run becomes dev and held-out rows marked added after; matrix files unchanged; eval:v2 and extract-cards default to the curation configuration.
* [Use gpt-5.6-luna at xhigh effort for curation](./2026-10-02-gpt-5-6-luna-for-curation.md) — Move curation from gpt-5.5 low to gpt-5.6-luna xhigh for frontier currency; accuracy ties, runs are much slower, one false-clean case.
* [Adopt an LLM wiki plus AGENTS.md](./2026-10-02-llm-wiki-documentation.md) — wiki/ in Open Knowledge Format as the agent-facing documentation and memory system.

## 2026-10-01
* [Expand the catalog to the top-10 U.S. issuers' consumer cards](./2026-10-01-top-ten-issuer-card-expansion.md) — Personal rewards, co-branded, student and secured cards of ten issuers (180 cards); no business cards.
* [Treat activation `unstated` as `none`](./2026-10-01-activation-unstated-as-none.md) — Unstated activation no longer adds an `activation-unknown` uncertainty; only `enroll-once`/`recurring` rules ask the shopper to confirm.
* [Show the best card automatically on supported carts; make the vault optional](./2026-10-01-automatic-cart-badge.md) — Zero-click badge on supported carts, local-first storage with an optional passphrase vault, URL-only order detection for savings.

## 2026-09-30
* [Make catalog v2 a separate product schema built from gold labels](./2026-09-30-catalog-v2-from-gold-labels.md) — Catalog v2 holds reviewed values the engine computes with, generated deterministically from the verified corpus labels, never from model output; v1 stays readable.

## 2026-09-29
* [Verify corpus labels with independent reviewer agents instead of a human pass](./2026-09-29-agent-verified-labels.md) — Seven reviewer subagents checked every base-case field against captures; the corpus is marked agent-verified, not human-verified.
* [Ship site adapters inside the extension package, never downloaded](./2026-09-29-bundled-site-adapters.md) — Cart readers are declarative JSON specs bundled in the extension; only a future kill switch may be fetched remotely.

## 2026-09-28
* [Keep the LLM out of checkout; use it only to curate the catalog](./2026-09-28-deterministic-engine-llm-in-curation.md) — A deterministic engine ranks cards at checkout; the LLM drafts catalog changes from issuer terms for human review.
* [Run live models only through subscription CLIs, locally](./2026-09-28-subscription-cli-providers-local-only.md) — Live evaluation uses the Codex CLI (ChatGPT plan) and Claude Code CLI (claude.ai plan) on the owner's machine, never paid API calls and never on Render.
* [Host the API, review app and site on Render with hosted Supabase](./2026-09-28-render-and-hosted-supabase.md) — One Render web service (render.yaml) serves the Fastify API, review app and public site, backed by the owner's existing hosted Supabase project.
* [Model seven cash-back cards; engine covers only what an online checkout can hit](./2026-09-28-seven-cards-and-checkout-scope.md) — Seven named U.S. cash-back cards; full category taxonomy on the extraction side, a narrower rule set in the product engine.
* [Build all three frontends on Helios tokens with our own React components](./2026-09-28-helios-design-system.md) — Use HashiCorp Helios design tokens and Flight icons (MPL-2.0) via a React component package, since Helios components are Ember-only.
