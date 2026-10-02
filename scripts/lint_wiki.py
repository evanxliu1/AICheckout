"""Lint the wiki/ knowledge bundle (Open Knowledge Format conventions).

Errors (exit 1): missing or empty frontmatter `type`, broken relative links
(outside archive/, whose immutable bodies may cite paths that no longer exist),
pages missing from their directory index, deprecated pages without
`superseded_by`, malformed or out-of-order log headings, merge conflict markers.
Warnings: orphan pages (no inbound links), `stale_after` in the past,
unfinished `TODO(llm-wiki)` scaffold markers.
Dependency-free on purpose; frontmatter is read with a tolerant line scanner.

Usage: python3 scripts/lint_wiki.py [path/to/wiki]   (default: <repo>/wiki)
"""
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

RESERVED = {'index.md', 'log.md'}
LINK = re.compile(r'(?<!\!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)')
TODO = 'TODO(llm-wiki)'


def frontmatter(text):
    if not text.startswith('---\n'):
        return None
    end = text.find('\n---', 4)
    if end < 0:
        return None
    fields = {}
    for line in text[4:end].splitlines():
        match = re.match(r'^([A-Za-z_][\w-]*):\s*(.*)$', line)
        if match:
            fields[match[1]] = match[2].strip().strip('"\'')
    return fields


def main(argv):
    wiki = Path(argv[1]).resolve() if len(argv) > 1 else Path(__file__).resolve().parents[1] / 'wiki'
    if not wiki.is_dir():
        print(f'error: no wiki directory at {wiki}', file=sys.stderr)
        return 1
    errors, warnings = [], []
    pages = sorted(wiki.rglob('*.md'))
    inbound = {p: 0 for p in pages}
    for page in pages:
        text = page.read_text(encoding='utf-8')
        rel = page.relative_to(wiki)
        if re.search(r'^(<<<<<<< |=======$|>>>>>>> )', text, flags=re.M):
            errors.append(f'{rel}: contains merge conflict markers')
        fm = frontmatter(text)
        if page.name not in RESERVED:
            if fm is None:
                errors.append(f'{rel}: missing YAML frontmatter')
            else:
                if not fm.get('type'):
                    errors.append(f'{rel}: frontmatter has no non-empty `type`')
                if fm.get('status') == 'deprecated' and not fm.get('superseded_by'):
                    errors.append(f'{rel}: deprecated without `superseded_by`')
                stale = fm.get('stale_after')
                if stale:
                    try:
                        when = datetime.fromisoformat(stale.replace('Z', '+00:00'))
                        if when.tzinfo is None:
                            when = when.replace(tzinfo=timezone.utc)
                        if when <= datetime.now(timezone.utc):
                            warnings.append(f'{rel}: stale_after {stale} has passed; re-verify')
                    except ValueError:
                        errors.append(f'{rel}: unparseable stale_after {stale!r}')
        elif page.name == 'log.md':
            dates = re.findall(r'^## (\d{4}-\d{2}-\d{2})\s*$', text, flags=re.M)
            bad = [h for h in re.findall(r'^## (.*)$', text, flags=re.M) if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', h.strip())]
            if bad:
                errors.append(f'{rel}: log headings must be `## YYYY-MM-DD`, found {bad[:3]}')
            if dates != sorted(dates, reverse=True):
                errors.append(f'{rel}: log dates must be newest first')
        body = text[text.find('\n---', 4) + 4:] if fm is not None else text
        # Examples inside fenced blocks, inline code and HTML comments are not real links.
        body = re.sub(r'```.*?```', '', body, flags=re.S)
        body = re.sub(r'<!--.*?-->', '', body, flags=re.S)
        body = re.sub(r'`[^`\n]*`', '', body)
        if TODO in re.sub(r'```.*?```|`[^`\n]*`', '', text, flags=re.S) and rel.parts[0] != 'archive':
            warnings.append(f'{rel}: unfinished {TODO} marker')
        for target in LINK.findall(body):
            if re.match(r'^[a-z]+:', target) or target.startswith('#'):
                continue
            path = target.split('#', 1)[0]
            if not path:
                continue
            resolved = (page.parent / path).resolve()
            if resolved.exists():
                if resolved in inbound:
                    inbound[resolved] += 1
            elif rel.parts[0] != 'archive':
                # Archived bodies are immutable and describe the past; their
                # stale links are expected and not reported.
                errors.append(f'{rel}: broken link -> {target}')
    for page in pages:
        if page.name in RESERVED or page.parent == wiki:
            continue
        index = page.parent / 'index.md'
        if not index.exists():
            errors.append(f'{page.relative_to(wiki)}: directory has no index.md')
        elif page.name not in index.read_text(encoding='utf-8'):
            errors.append(f'{page.relative_to(wiki)}: not listed in {index.relative_to(wiki)}')
    for page, count in inbound.items():
        if count == 0 and page.name not in RESERVED and page.parent != wiki:
            warnings.append(f'{page.relative_to(wiki)}: orphan (no inbound links)')
    for line in warnings:
        print('warning:', line)
    for line in errors:
        print('error:', line, file=sys.stderr)
    print(f'Wiki lint: {len(pages)} pages, {len(errors)} errors, {len(warnings)} warnings.')
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
