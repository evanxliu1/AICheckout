import assert from 'node:assert/strict';
import pg from 'pg';
import { catalogSchema } from '../packages/rewards-core/src/schema.ts';
import { catalogCases } from '../packages/rewards-core/test-cases.ts';

// Local read-only comparison of both actual implementations against common domain cases.
const client = new pg.Client({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres', connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  for (const { name, input, valid } of catalogCases) {
    const result = await client.query('select catalog_private.valid_catalog_v1($1::jsonb) as valid', [JSON.stringify(input)]);
    assert.equal(result.rows[0].valid, valid, `Database: ${name}`);
    assert.equal(catalogSchema.safeParse(input).success, valid, `Shared runtime: ${name}`);
  }
  console.log(`PASS: database and shared runtime agree on ${catalogCases.length} contract cases.`);
} finally { await client.end(); }
