---
version: 1
slug: "apps-review-src-app-tsx"
primary_target: "apps/review/src/App.tsx"
related_targets: ["apps/review/src/styles.css","apps/review/src/ReviewWorkspace.tsx","apps/review/src/DraftPanel.tsx","apps/review/src/StructuredEditor.tsx","apps/review/src/ExtractionPanel.tsx"]
---

# Catalog review surface

Scope: apps/review, Operate mode. Maintainer at a desktop reviewing a small catalog in ordinary indoor light; same light blue/slate/system-font identity as the extension. Narrow layouts must remain usable.

Task: sign in, select an unapproved draft, see the complete changes against the published snapshot, inspect immutable source text, correct/capture evidence, then explicitly publish an exact revision. Unknown, expired, changed, missing-evidence, signed-out, revoked, loading, empty, and network-failure states are essential.

Chosen structure: diff-centered review with adjacent source evidence and an approval section below; draft queue provides navigation. Grounded candidate 4 of seven; seed 881f92d6. Other grounded candidates were queue/split review, draft dossier, guided steps, catalog table, source-first stack, and release checklist. Challenger metaphors added task friction and conflicted with the existing visual identity; retain the grounded composition.

Routine design choices are delegated by the active autonomous build goal. No new brand or raster imagery is needed. No paid image generation or approval wait is introduced under the user's zero-spend constraint. Validate the working coded interface with desktop/mobile screenshots and a fresh finish reviewer.

Signature: a changed reward rate and its unchanged conditions stay next to the exact captured evidence, while approval remains bound to the reviewed revision/head. Do not imply matching text establishes issuer correctness automatically.

Media inventory: all content uses semantic HTML/CSS; no hero, illustrations, external fonts, decorative media, or invented metrics. Buttons/inputs and source disclosures use familiar browser semantics. Data in tests is explicitly synthetic.

Extraction extension: saved-run recovery and exact field citations expand inline above the existing manual comparison. A reviewer must account for every condition with an existing rule and explanation, explicitly apply to the originating revision, and give fresh publication approval afterward. Unknown/conflicting/unsupported facts stay visible and block application. Run, draft, request and reviewer records remain private; saved-run fragment links contain IDs only. The active build goal authorizes this workflow extension within the incumbent identity.

Unresolved: real model quality and independent annotation review remain unverified; hosted reviewer/publisher identity and deployment remain external gates. Browser demonstrations use explicitly synthetic, intercepted provider replies.

Helios adoption (Phase 3 M4, 2026-10-01): the surface now uses @ai-checkout/ui components on Helios tokens (shared with the extension popup). Additions: a structured per-rule editor for catalog schema 2 drafts beside the JSON editor (live Zod validation, preview against the published catalog), a one-step capture of every missing source (load `<source id>.txt` files or paste, attach in one revision), and a warning confirmation dialog before publication with focus on Cancel. Diff and evidence stack below 1500 px so the diff table keeps its width. Verified by axe at 1280 and 390 px with a mocked backend and the production CSP.
