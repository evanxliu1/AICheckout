// Stage 2, capture: sources.json from the accepted research (store pages and lookup pages), dated gitignored captures
// through scripts/capture-issuer-pages.mjs, and issuer sources mined deterministically from the existing issuer captures
// of the card catalog (plan section 6: "the existing issuer captures of the 178-card catalog are searched for the
// store's name"). An issuer capture that names the store is copied into the batch's gitignored captures/ under the
// catalog's own source id and hash, and windows around the matches are kept for the drafter.
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { sha256Hex } from '../hash.ts';
import { writeJsonAtomic } from '../state.ts';
import type { Env } from '../run.ts';
import { domainLabel } from './candidates.ts';
import {
  loadBatch,
  manifestFileSchema,
  readJson,
  readJsonOrNull,
  researchFileSchema,
  sourcesFileSchema,
  writeState,
} from './files.ts';
import type { Batch, ManifestEntry } from './files.ts';

/** Where the issuer captures live: the main checkout (wiki/ops/catalog-release.md#capture-folders) or an override. */
export const issuerCapturesRoot = (env: Env): string => env.env.AICHECKOUT_ISSUER_CAPTURES ?? env.root;

const catalogManifestSchema = z.looseObject({
  sources: z.array(
    z.looseObject({
      id: z.string(),
      url: z.string(),
      kind: z.string(),
      issuer: z.string().optional(),
      capturedOn: z.string(),
      sha256: z.string(),
    }),
  ),
});

export interface IssuerCapture {
  id: string;
  url: string;
  issuer: string | null;
  capturedOn: string;
  sha256: string;
  path: string;
}

/** Every issuer capture of the catalog with its manifest entry; where a source id is in several folders, the newest
 * capture date wins (a refresh batch re-captured an expansion page). */
export async function listIssuerCaptures(root: string): Promise<IssuerCapture[]> {
  const folders = ['evals/curation/expansion', 'evals/curation/real'];
  const batches = await readdir(join(root, 'evals/curation/batches')).catch(() => [] as string[]);
  folders.push(...batches.map((b) => `evals/curation/batches/${b}`));
  const byId = new Map<string, IssuerCapture>();
  for (const folder of folders) {
    const manifest = await readJsonOrNull(join(root, folder, 'manifest.json'), catalogManifestSchema);
    if (!manifest) continue;
    for (const source of manifest.sources) {
      const path = join(root, folder, 'captures', `${source.id}.txt`);
      const exists = await readFile(path, 'utf8').then(
        () => true,
        () => false,
      );
      if (!exists) continue;
      const current = byId.get(source.id);
      if (!current || current.capturedOn < source.capturedOn)
        byId.set(source.id, {
          id: source.id,
          url: source.url,
          issuer: source.issuer ?? null,
          capturedOn: source.capturedOn,
          sha256: source.sha256,
          path,
        });
    }
  }
  return [...byId.values()];
}

/** Word-boundary, case-insensitive match of the store's name (and its domain label when 5+ letters). */
export function nameMatcher(name: string, domain: string): RegExp {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const variants = new Set([name.trim()]);
  const label = domainLabel(domain);
  if (label.length >= 5) variants.add(label);
  return new RegExp(`(?<![A-Za-z0-9])(?:${[...variants].map(escape).join('|')})(?![A-Za-z0-9])`, 'i');
}

/** Text windows (±WINDOW characters) around every match, merged when they overlap; at most `max` windows. */
export function windows(text: string, matcher: RegExp, span = 500, max = 6): string[] {
  const global = new RegExp(
    matcher.source,
    matcher.flags.includes('g') ? matcher.flags : `${matcher.flags}g`,
  );
  const ranges: [number, number][] = [];
  for (const match of text.matchAll(global)) {
    const start = Math.max(0, match.index - span);
    const end = Math.min(text.length, match.index + match[0].length + span);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1]) last[1] = end;
    else ranges.push([start, end]);
    if (ranges.length >= max) break;
  }
  return ranges.map(([s, e]) => text.slice(s, e));
}

/** Wording an issuer uses when it says what a category covers. */
const DEFINITION_WORDING = /\b(includ\w*|defin\w*|categor\w*|such as|list|means|consist\w*)\b/i;
/** Words of the catalog's bonus categories as issuers write them (the apply rule's `ISSUER_CATEGORY_WORDS`, kept
 * here so capture does not import apply). */
const CATEGORY_WORDING =
  /\b(grocer(?:y|ies)|supermarkets?|restaurants?|dining|drug ?stores?|pharmac(?:y|ies)|streaming|gas stations?|ev charging|transit|rideshare|department stores?|home improvement|hardware stores?|wholesale clubs?|warehouse clubs?|electronics|entertainment)\b/i;

/** Sentences of an issuer capture that define a category (a category word with definition wording), ±`span`
 * characters, merged when they overlap, at most `max`: the drafter's `definition` quotes come from here (prompt
 * merchant-draft.2), since the name windows alone miss a definition the page states away from the store's name. */
export function definitionWindows(text: string, span = 200, max = 8): string[] {
  const ranges: [number, number][] = [];
  const sentence = /[^.;\n]*[.;\n]?/g;
  for (const match of text.matchAll(sentence)) {
    const s = match[0];
    if (!s.trim() || !CATEGORY_WORDING.test(s) || !DEFINITION_WORDING.test(s)) continue;
    const start = Math.max(0, match.index - span);
    const end = Math.min(text.length, match.index + s.length + span);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1]) last[1] = end;
    else ranges.push([start, end]);
    if (ranges.length >= max) break;
  }
  return ranges.map(([s, e]) => text.slice(s, e));
}

export const MAX_ISSUER_SOURCES = 5;

export async function runCapture(
  env: Env,
  batchId: string,
  { only }: { only?: string[] } = {},
): Promise<number> {
  const batch = await loadBatch(env.root, batchId);
  if (batch.state.stages.research.status !== 'done') {
    env.log('capture: research is not accepted yet.');
    return 1;
  }
  const research = await readJson(join(batch.dir, 'research.json'), researchFileSchema);
  const stores = research.stores.filter((s) => !only || only.includes(s.domain));
  // Store pages and lookups: the capture script's sources.json.
  const sources = stores.flatMap((store) => {
    const slug = store.domain.replace(/[^a-z0-9]+/g, '-');
    return [
      ...store.storePages.map((page, i) => ({
        id: `${slug}-page-${i + 1}`,
        domain: store.domain,
        kind: 'store-page' as const,
        url: page.url,
      })),
      ...store.lookupPages.map((page, i) => ({
        id: `${slug}-lookup-${i + 1}`,
        domain: store.domain,
        kind: 'mcc-lookup' as const,
        url: page.url,
      })),
    ];
  });
  await writeJsonAtomic(
    join(batch.dir, 'sources.json'),
    sourcesFileSchema.parse({ schemaVersion: 1, sources }),
  );
  await mkdir(join(batch.dir, 'captures'), { recursive: true });
  const relDir = relative(env.root, batch.dir);
  const code = await env.exec('node', [
    'scripts/capture-issuer-pages.mjs',
    '--dir',
    relDir,
    '--sources',
    'sources.json',
    '--captures',
    'captures',
    '--manifest',
    'manifest.json',
    '--report',
    'capture-report.json',
    '--delay-ms',
    '1500',
  ]);
  const manifest = await readJsonOrNull(join(batch.dir, 'manifest.json'), manifestFileSchema);
  const entries: ManifestEntry[] = (manifest?.sources ?? []).filter(
    (s) => s.kind !== 'issuer-terms',
  ) as ManifestEntry[];
  // Issuer evidence mined from the catalog's issuer captures.
  const issuerCaptures = await listIssuerCaptures(issuerCapturesRoot(env));
  let mined = 0;
  for (const store of stores) {
    const matcher = nameMatcher(store.name, store.domain);
    const hits: { capture: IssuerCapture; text: string; count: number }[] = [];
    for (const capture of issuerCaptures) {
      const text = await readFile(capture.path, 'utf8');
      const count = (text.match(new RegExp(matcher.source, 'gi')) ?? []).length;
      if (count) hits.push({ capture, text, count });
    }
    hits.sort((a, b) => b.count - a.count || a.capture.id.localeCompare(b.capture.id));
    for (const { capture, text } of hits.slice(0, MAX_ISSUER_SOURCES)) {
      const id = capture.id;
      await copyFile(capture.path, join(batch.dir, 'captures', `${id}.txt`));
      await writeFile(
        join(batch.dir, 'captures', `${id}.windows.${store.domain}.txt`),
        windows(text, matcher).join('\n\n[…]\n\n'),
      );
      const existing = entries.find((e) => e.id === id && e.domain === store.domain);
      if (!existing)
        entries.push({
          id,
          domain: store.domain,
          kind: 'issuer-terms',
          url: capture.url,
          from: relative(issuerCapturesRoot(env), capture.path).replace(/\/captures\/.*$/, ''),
          capturedOn: capture.capturedOn,
          sha256: sha256Hex(text),
          length: text.length,
        });
      mined += 1;
    }
  }
  await writeJsonAtomic(join(batch.dir, 'manifest.json'), { schemaVersion: 1, sources: entries });
  const captured = entries.filter((e) => e.kind !== 'issuer-terms').length;
  const now = env.now();
  batch.state.stages.capture = {
    status: code === 0 ? 'done' : 'failed-gate',
    finishedAt: now.toISOString(),
    attempts: (batch.state.stages.capture.attempts ?? 0) + 1,
  };
  if (code === 0)
    batch.state.stages.draft = { status: batch.state.stages.draft.status === 'done' ? 'stale' : 'pending' };
  await writeState(batch.dir, batch.state, now);
  env.log(
    `capture: ${captured} of ${sources.length} pages captured, ${mined} issuer captures mined (${issuerCaptures.length} searched). ${code === 0 ? '' : 'Some pages failed; see capture-report.json.'}`,
  );
  return code;
}

export { type Batch };
