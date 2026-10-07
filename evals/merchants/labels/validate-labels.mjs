#!/usr/bin/env node
// Validate a reader-labels.2 file (labeller or final): the schema, then currency in currency-minor-units.json,
// expected = the most preferred displayed kind (afterCredit > estimatedTotal > subtotal) unless null with its reason,
// unique ids, id parts matching state and origin, every label in the file's split. Prints {ok, labels, problems}
// with ids and messages only (no page text); exit 1 when a problem is found.
//
//   node evals/merchants/labels/validate-labels.mjs <labels.json>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateLabelFile } from './schema.mjs';

function main([file]) {
  if (!file) {
    console.error('usage: validate-labels.mjs <labels.json>');
    return 2;
  }
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const r = validateLabelFile(data);
  console.log(JSON.stringify({ ok: r.ok, labels: data.labels?.length ?? 0, problems: r.problems }, null, 1));
  return r.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  process.exitCode = main(process.argv.slice(2));
