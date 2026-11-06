// Checks which catalog and store list the inspected upload ZIP bundles (Phase 15.7, before a Web Store upload):
// the ZIP matches its inventory, the bundled releases equal the repository's CATALOG_V3 and MERCHANTS_V1, the
// catalog has not expired and, with --hosted, both equal what the API serves. Exit 1 on any difference.
//
//   node extension/scripts/check-release-bundles.mjs [--zip <path>] [--hosted] [--json]
//
// --json prints the facts the release record cites (docs/release/README.md) after the human summary.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOG_V3 } from '../../packages/rewards-core/src/catalog-v3.ts';
import { MERCHANTS_V1 } from '../../packages/rewards-core/src/merchants-v1.ts';
import {
  compareBundles,
  compareHosted,
  daysUntilExpiry,
  hostedReleases,
  readZipBundles,
} from './release-bundles.mjs';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const version = JSON.parse(readFileSync(resolve(root, 'extension/package.json'), 'utf8')).version;
const zip = resolve(option('--zip') ?? resolve(root, `extension/artifacts/ai-checkout-${version}.zip`));
const inventoryPath = zip.replace(/\.zip$/, '.inventory.json');
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
const sha256 = createHash('sha256').update(readFileSync(zip)).digest('hex');
const problems = [];
if (sha256 !== inventory.sha256)
  problems.push(`ZIP hash ${sha256} differs from the inventory's ${inventory.sha256}`);

const bundled = readZipBundles(zip);
const days = daysUntilExpiry(bundled);
if (days < 0) problems.push(`the bundled catalog expired ${-days} day(s) ago (${bundled.catalog.expiresAt})`);
problems.push(...compareBundles(bundled, { catalog: CATALOG_V3, merchants: MERCHANTS_V1 }));

let hosted;
if (args.includes('--hosted')) {
  if (!inventory.catalogOrigin)
    problems.push('--hosted needs a hosted build; the inventory has no catalog origin');
  else {
    hosted = await hostedReleases(inventory.catalogOrigin);
    problems.push(...compareHosted(bundled, hosted));
  }
}

console.log(`ZIP ${zip}\nSHA-256 ${sha256}${sha256 === inventory.sha256 ? ' (inventory agrees)' : ''}`);
console.log(
  `Bundled catalog ${bundled.catalog.version}, verified ${bundled.catalog.verifiedAt}, expires ${bundled.catalog.expiresAt} (${days < 0 ? `expired ${-days} day(s) ago` : `${days} day(s) left`}) in ${bundled.catalog.file}`,
);
console.log(`Bundled store list ${bundled.merchants.version}, verified ${bundled.merchants.verifiedAt}`);
if (hosted)
  for (const kind of ['catalog', 'merchants'])
    console.log(
      hosted[kind].error
        ? `Hosted ${kind}: unavailable (${hosted[kind].status} ${hosted[kind].error})`
        : `Hosted ${kind}: ${hosted[kind].version} (sequence ${hosted[kind].sequence})`,
    );
if (args.includes('--json'))
  console.log(
    JSON.stringify(
      { zip, sha256, catalogOrigin: inventory.catalogOrigin, bundled, hosted: hosted ?? null, problems },
      null,
      2,
    ),
  );
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(
  hosted
    ? 'The ZIP bundles the releases the repository and the API hold.'
    : 'The ZIP bundles the releases the repository holds (add --hosted to compare with the API).',
);
