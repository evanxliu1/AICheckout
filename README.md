# AI Checkout

A Chrome extension project moving from an LLM-powered prototype toward a dependable credit-card rewards assistant. The intended product recommends the best eligible card a user already owns at supported checkouts.

The portfolio targets full-stack and LLM application engineering: a tested TypeScript rewards engine, a PostgreSQL catalog, and an evaluated LLM workflow for turning issuer terms into draft rules that require review before publication.

**Current status: working local pilot; not ready for public submission.** The popup saves owned cards and compares estimated rewards with a deterministic engine, offline and without an API key. The pilot covers Quicksilver and Blue Cash Everyday for confirmed eligible Best Buy US and Newegg US purchases, using user-triggered summary readers or manual merchant/amount entry. A protected React review app now demonstrates captured terms → bounded extraction → human condition review → audited draft application → separate publication through Node and PostgreSQL. This flow is verified locally with synthetic intercepted model replies. Live model evaluation, final retailer/normal-Chrome checks, hosted deployment, and store preparation remain unfinished.

## Start here

- [Extension setup and verification](extension/README.md)
- [Catalog database setup, security, and verification](supabase/README.md)
- [Node catalog API](apps/api/README.md)
- [Protected catalog review app](apps/review/README.md)
- [Release and portfolio plan](RELEASE_PLAN.md)
- [Active build goal and checkpoint](BUILD_STATUS.md)
- [Release drafts, privacy findings, deployment and demo procedures](docs/release/README.md)
- [Shopper/store media](docs/release/assets/README.md) and [full-stack recording with transcript](docs/release/assets/full-stack-demo.md)
- [Earlier production readiness audit](audit/PRODUCTION_READINESS.md)

## Repository

- `extension/`: React, TypeScript, Tailwind, Manifest V3, Vite/CRXJS, Zod; local wallet and service-worker orchestration. Legacy Supabase/OpenAI prototype modules are retained but are not used by the current popup or included in its production bundle.
- `packages/rewards-core/`: browser-independent TypeScript calculations, strict Zod catalog contracts, sourced pilot catalog, integer money, uncertainty and cap handling.
- `packages/catalog-client/`: bounded JSON transport and the extension's fixed HTTPS catalog request.
- `packages/catalog-review/`: shared strict source, draft, review, publication, and browser-safe curation contracts; never shipped to the checkout reader.
- `apps/api/`: Node 24/TypeScript/Fastify public catalog API, protected source/draft/review/publication routes, and same-origin serving of the compiled review app.
- `apps/api/src/curation/`: bounded extraction kernel, authenticated invocation/inspection, private ledger, and an official OpenAI Responses SDK adapter with versioned context/schema, evidence checks, persistent traces, atomic reservations, and duplicate-execution protection. Verified with real local sessions/database and intercepted provider transport; live model verification remains pending.
- `evals/curation/`: [local scorer and replay tools](evals/curation/README.md), 60 explicitly synthetic cases, and a diagnostic baseline. Human-reviewed representative labels and live model-quality results remain pending.
- `apps/review/`: React/TypeScript review interface with Supabase Auth, saved extraction recovery, field/condition evidence, audited application, comparison against the exact published snapshot, optimistic correction, and separate publication approval. Sessions stay in tab memory; two real local browser flows cover manual/extraction review, stale decisions, and sign-out revocation.
- `supabase/`: reproducible PostgreSQL migrations, local unapproved catalog seed, reviewer authorization, immutable source captures, versioned drafts, and atomic publication. Real local Auth/Data API, role/security, schema-parity, and concurrency tests pass; hosted migration remains pending.
- `extension/tests/`: Vitest regression and component tests.
- `extension/e2e/`: Playwright checks of the packaged extension's offline wallet, comparisons, stale state, deletion, popup closure, navigation/access revocation, and observed natural worker shutdown/recovery.
- `.github/workflows/extension.yml`: clean installation, lint, types, tests, dependency audit, build, browser verification, and an inspected ZIP with file hashes. A separate browser check installs that ZIP and verifies a native two-card comparison and deletion before upload; [local evidence and limits](docs/verification/release-package.md).
- `.github/workflows/database.yml`: local Supabase rebuild, signed-session HTTP publication, compiled review-app browser flow, role-policy/schema-parity/concurrent-publication tests, database lint, and security advisors.
- `simulation/`: older Express simulation, retained as an internal prototype. It is not the production backend and should not be exposed publicly in its current form.

## Merchant coverage

Best Buy US has live empty/populated/quantity-change DOM evidence and separate packaged Chrome action tests. Newegg US now also passes the combined native-toolbar → live anonymous cart → two-card comparison flow at two quantities. Its observed total was TBD, so the extension explicitly compares the subtotal before tax/shipping. Both require confirmation and allow manual correction; changing the selected merchant clears stale inputs/results. Issuer reward eligibility remains a user-confirmed assumption, not verified merchant coding. See [the exact verification scope and remaining cases](docs/verification/merchants.md). Legacy item extractors for other merchants remain disconnected. No broad extraction success-rate or real-user savings claim is made.

## Development

Use Node 24. Install all npm workspaces from the repository root; there is one root lockfile. No environment file, account, API key, or network service is needed for the local comparison flow. The bundled card snapshot expires October 25, 2026; that is a maintenance deadline, not an issuer guarantee.

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Load `extension/dist` from Chrome's Extensions page in Developer mode. See the extension README for browser tests, optional catalog updates, and packaging. The production catalog endpoint is not deployed or configured yet; the default build uses the bundled pilot.

## License

MIT. See [LICENSE](LICENSE).
