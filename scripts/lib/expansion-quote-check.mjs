// The committed-file quote check of scripts/check-expansion-quotes.mjs as a function, so the pipeline's gates
// (tools/catalog-pipeline) can run it in process and print only where a problem is, never the capture text.
//
// Scans every string of corpus.draft.json, corpus.json, product-notes.json, product-notes.verified.json,
// reward-programs.json, catalog-overlay.json, merchants.json, verification/*.json, research/*.json and overlay/*.json
// (the last two exist only in pipeline batches) and, unless `catalog` is null, the built CATALOG_V3; and every line or
// table cell of verify/*.md, verification-report.md, catalog-build-report.md, verification/README.md and
// verification/conventions/*.md. See the script for the rules.
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import {
  MAX_QUOTE_WORDS,
  captureIndex,
  joinedCaptureRun,
  longCaptureRun,
  markdownUnits,
  quoteArraysOf,
  resolves,
  stringsOf,
  wordCount,
} from './expansion-quotes.mjs';
import { overlayAnchors } from './catalog-overlay.mjs';
import { rewardProgramAnchors } from './reward-programs.mjs';

const listIn = async (folder, ext) =>
  (await readdir(folder).catch(() => []))
    .filter((name) => name.endsWith(ext))
    .sort()
    .map((name) => join(folder, name));

/**
 * Problems as `{ file, at, code, message }`: `file` and `at` say where, `code` what (`long-run`, `joined-run`,
 * `no-capture`, `not-verbatim`, `too-long`), `message` is the script's line (it may quote capture words). Returns
 * `{ problems, checked, captures }`, or `{ problems: [], noCaptures: true }` when the capture folders hold no capture.
 */
export async function checkQuoteFiles({ root, dir, captureDirs, catalog }) {
  const captureFiles = (await Promise.all(captureDirs.map((folder) => listIn(folder, '.txt')))).flat();
  if (!captureFiles.length) return { problems: [], checked: 0, captures: 0, noCaptures: true };
  const bodies = await Promise.all(captureFiles.map((path) => readFile(path, 'utf8')));
  const index = captureIndex(bodies);
  const captureById = new Map(captureFiles.map((path, i) => [basename(path, '.txt'), bodies[i]]));
  const list = (sub, ext) => listIn(join(dir, sub), ext);

  const jsonFiles = [
    ...[
      'corpus.draft.json',
      'corpus.json',
      'product-notes.json',
      'product-notes.verified.json',
      'reward-programs.json',
      'catalog-overlay.json',
      'merchants.json',
    ].map((name) => join(dir, name)),
    ...(await list('verification', '.json')),
    ...(await list('research', '.json')),
    ...(await list('overlay', '.json')),
  ];
  const markdownFiles = [
    ...(await list('verify', '.md')),
    join(dir, 'verification-report.md'),
    join(dir, 'catalog-build-report.md'),
    join(dir, 'verification', 'README.md'),
    ...(await list(join('verification', 'conventions'), '.md')),
  ];

  const problems = [];
  const add = (file, at, code, message) => problems.push({ file, at, code, message: `${file} ${message}` });
  let checked = 0;
  for (const path of jsonFiles) {
    const text = await readFile(path, 'utf8').catch(() => null);
    if (text === null) continue;
    checked++;
    const file = relative(root, path);
    const data = JSON.parse(text);
    for (const [at, value] of stringsOf(data)) {
      const run = longCaptureRun(value, index);
      if (run) add(file, at, 'long-run', `${at}: quotes ${wordCount(run)}+ words: "${run.slice(0, 120)}…"`);
    }
    for (const [at, texts] of quoteArraysOf(data)) {
      const run = joinedCaptureRun(texts, index);
      if (run)
        add(
          file,
          at,
          'joined-run',
          `${at}: items ${run.texts.join(', ')} read together form a run of ${run.words}+ capture words`,
        );
    }
    const name = basename(path);
    const isOverlay = name === 'catalog-overlay.json' || basename(join(path, '..')) === 'overlay';
    const anchored = isOverlay
      ? overlayAnchors(data)
      : name === 'reward-programs.json'
        ? // A pipeline batch's reward-programs.json maps cards only, without anchors.
          rewardProgramAnchors({ programs: [], ...data }).filter(([, anchor]) => anchor)
        : [];
    for (const [at, anchor] of anchored) {
      const body = captureById.get(anchor.sourceId);
      if (body === undefined) add(file, at, 'no-capture', `${at}: no capture ${anchor.sourceId}`);
      else if (!resolves(anchor.quote, { documents: [{ id: anchor.sourceId, body }] }))
        add(file, at, 'not-verbatim', `${at}: not verbatim in ${anchor.sourceId}`);
    }
    if (isOverlay) {
      const corpus = JSON.parse(await readFile(join(dir, 'corpus.json'), 'utf8'));
      const sourcesOf = new Map(corpus.cases.map((item) => [item.cardId, item.sourceIds]));
      for (const card of data.cards ?? [])
        for (const added of card.addedRules ?? []) {
          const documents = (sourcesOf.get(card.cardId) ?? [])
            .filter((id) => captureById.has(id))
            .map((id) => ({ id, body: captureById.get(id) }));
          if (!resolves(added.issuerWording, { documents })) {
            const at = `cards.${card.cardId}.addedRules.${added.key}.issuerWording`;
            add(file, at, 'not-verbatim', `${at}: not verbatim in the card's captures`);
          }
        }
    }
    for (const item of data.cases ?? [])
      for (const [at, value] of stringsOf(item.reference, `${item.id}.reference`))
        if (/\.(anchors\[\d+\]|issuerWording)$/.test(at) && wordCount(value) > MAX_QUOTE_WORDS)
          add(file, at, 'too-long', `${at}: ${wordCount(value)} words`);
  }
  // The built catalog v3 joins corpus strings that the corpus keeps apart (a card's exclusions become one array).
  if (catalog) {
    checked++;
    const file = 'packages/rewards-core/src/catalog-v3.ts';
    for (const [at, value] of stringsOf(catalog, 'CATALOG_V3')) {
      const run = longCaptureRun(value, index);
      if (run) add(file, at, 'long-run', `${at}: quotes ${wordCount(run)}+ words`);
    }
    for (const [at, texts] of quoteArraysOf(catalog, 'CATALOG_V3')) {
      const run = joinedCaptureRun(texts, index);
      if (run)
        add(
          file,
          at,
          'joined-run',
          `${at}: items ${run.texts.join(', ')} read together form a run of ${run.words}+ capture words`,
        );
    }
  }
  for (const path of markdownFiles) {
    const text = await readFile(path, 'utf8').catch(() => null);
    if (text === null) continue;
    checked++;
    const file = relative(root, path);
    const units = markdownUnits(text);
    let single = false;
    for (const [at, unit] of units) {
      const run = longCaptureRun(unit, index);
      if (run) {
        single = true;
        add(file, at, 'long-run', `${at}: quotes ${wordCount(run)}+ words: "${run.slice(0, 120)}…"`);
      }
    }
    // Consecutive lines and cells read as one text (only reported when no single unit already is).
    const joined = !single && longCaptureRun(units.map(([, unit]) => unit).join(' '), index);
    if (joined)
      problems.push({
        file,
        at: '(file)',
        code: 'joined-run',
        message: `${file}: consecutive lines or cells read together quote ${wordCount(joined)}+ words: "${joined.slice(0, 120)}…"`,
      });
  }
  return { problems, checked, captures: captureFiles.length };
}
