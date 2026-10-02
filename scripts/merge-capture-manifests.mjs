// Merge per-run capture manifests into one manifest ordered like sources.json.
//
//   node scripts/merge-capture-manifests.mjs [--dir evals/curation/expansion] [--parts parts]
//
// Parallel capture runs (one per issuer host, so each host still sees sequential requests) each write
// <dir>/<parts>/manifest.<name>.json; this writes <dir>/manifest.json from them. Entries whose capture file is
// missing or whose hash differs from the file on disk are dropped.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'evals/curation/expansion' },
    parts: { type: 'string', default: 'parts' },
  },
});
const dir = resolve(root, values.dir);
const { sources } = JSON.parse(await readFile(join(dir, 'sources.json'), 'utf8'));
const entries = new Map();
for (const name of (await readdir(join(dir, values.parts)))
  .filter((n) => /^manifest\..+\.json$/.test(n))
  .sort())
  for (const entry of JSON.parse(await readFile(join(dir, values.parts, name), 'utf8')).sources)
    entries.set(entry.id, entry);
const merged = [];
let dropped = 0;
for (const source of sources) {
  const entry = entries.get(source.id);
  if (!entry) continue;
  const text = await readFile(join(dir, 'captures', `${source.id}.txt`), 'utf8').catch(() => null);
  if (text === null || createHash('sha256').update(text, 'utf8').digest('hex') !== entry.sha256) {
    dropped++;
    continue;
  }
  merged.push({ ...source, capturedOn: entry.capturedOn, sha256: entry.sha256, length: entry.length });
}
await writeFile(
  join(dir, 'manifest.json'),
  JSON.stringify({ schemaVersion: 1, sources: merged }, null, 2) + '\n',
);
console.log(
  `manifest.json: ${merged.length} of ${sources.length} sources (${dropped} dropped: file missing or changed)`,
);
