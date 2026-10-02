---
type: Guide
title: Archive policy
description: What goes to wiki/archive, how it gets there, and the immutability rule for sources.
status: stable
tags: [guide, wiki, archive]
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-02T02:13:55Z
---

# Archive policy

`wiki/archive/` is the immutable raw-source layer of the LLM wiki. Nothing in the repository's documentation is ever deleted; it is archived here and superseded by a live page.

## What belongs here

- Pre-wiki documents (plans, briefs, audits, proposals, setup logs) moved verbatim when the wiki was adopted.
- Wiki pages that a newer page fully replaces.
- Superseded decision records are **not** moved; they stay in `decisions/` with `status: superseded by …` so the chain is visible in one place.
- Data artifacts and local state are never in the wiki; if they are gitignored, pages reference them by path and say so.

## How to archive

1. `git mv` the file into `wiki/archive/`, keeping its name; add a date suffix only if the name would collide (`README-2026-01-31.md`).
2. Prepend a frontmatter block (this is the only edit ever made to the file): `type: Source Document` (or the page's original type), `status: deprecated`, `archived: <UTC date>`, `superseded_by: <link(s)>`, plus a one-line blockquote pointing to this policy. The body below the header is never edited again, not even to fix a typo or a broken link.
3. Make sure the superseding page lists the archived file in `sources` and carries every fact from it that is still true.
4. Add the file to `archive/index.md` with what it was and what replaced it. Append a `Deprecate` entry to `log.md`.
5. Fix inbound links in live pages and code (error messages, rendered reports) to point at the archived path or the new page.

## Linting

`scripts/lint_wiki.py` still requires frontmatter with `type` and `superseded_by` on archived pages and lists them in `archive/index.md`, but it does not report broken links inside archived bodies: those links describe where things were on the document's date.

## Reading the archive

Archived documents describe the world as it was on their date. Quote them for history and evidence; do not treat them as current instructions. If an archived fact is still true and missing from a live page, that is an ingest task for the live page, not a reason to edit the archive.
