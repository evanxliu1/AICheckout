// Builds the bundled merchant release deterministically from the committed records, never from model output.
//
//   node scripts/build-merchants-v1.mjs            write packages/rewards-core/src/merchants-v1.ts and
//                                                  evals/merchants/db/release.json
//   node scripts/build-merchants-v1.mjs --check    fail if either committed file is stale (CI)
//
// Inputs: evals/merchants/db/release-config.json (version, verifiedAt, sources) and evals/merchants/db/records/*.json
// (one record per store). The release is validated with merchantReleaseSchema before anything is written.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { format, resolveConfig } from 'prettier';
import { buildMerchantRelease, merchantsModuleText } from './lib/merchants-v1.mjs';

const { values: args } = parseArgs({ options: { check: { type: 'boolean', default: false } } });
const root = new URL('../', import.meta.url);
const dbDir = new URL('evals/merchants/db/', root);
const recordsDir = new URL('records/', dbDir);
const out = new URL('packages/rewards-core/src/merchants-v1.ts', root);
const jsonOut = new URL('release.json', dbDir);

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));
const config = readJson(new URL('release-config.json', dbDir));
const records = readdirSync(recordsDir)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => {
    const record = readJson(new URL(name, recordsDir));
    if (`${record.id}.json` !== name)
      throw new Error(`records/${name} holds record ${record.id}; name it ${record.id}.json`);
    return record;
  });
let release;
try {
  release = buildMerchantRelease(config, records);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const text = await format(merchantsModuleText(release), {
  ...(await resolveConfig(out.pathname)),
  filepath: out.pathname,
});
const json = `${JSON.stringify(release, null, 2)}\n`;

const current = (url) => {
  try {
    return readFileSync(url, 'utf8');
  } catch {
    return null;
  }
};
if (args.check) {
  const stale = [
    [out, text],
    [jsonOut, json],
  ]
    .filter(([url, expected]) => current(url) !== expected)
    .map(([url]) => url.pathname.slice(root.pathname.length));
  if (stale.length) {
    console.error(`Stale: ${stale.join(', ')}. Run \`npm run merchants\`.`);
    process.exit(1);
  }
  console.log(`merchants-v1 is up to date (${release.version}, ${release.merchants.length} records).`);
} else {
  writeFileSync(out, text);
  writeFileSync(jsonOut, json);
  console.log(`Wrote ${release.version}: ${release.merchants.length} records.`);
}
