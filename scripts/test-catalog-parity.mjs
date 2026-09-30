import assert from 'node:assert/strict';
import pg from 'pg';
import { catalogSchema } from '../packages/rewards-core/src/schema.ts';
import { catalogCases, catalogV2Cases } from '../packages/rewards-core/test-cases.ts';

// Local read-only comparison of both actual implementations against common domain cases.
const client = new pg.Client({
  host: '127.0.0.1',
  port: 54322,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
  connectionTimeoutMillis: 5000,
});
try {
  await client.connect();
  const check = async (fn, cases) => {
    for (const { name, input, valid } of cases) {
      const result = await client.query(`select catalog_private.${fn}($1::jsonb) as valid`, [
        JSON.stringify(input),
      ]);
      assert.equal(result.rows[0].valid, valid, `Database ${fn}: ${name}`);
      assert.equal(catalogSchema.safeParse(input).success, valid, `Shared runtime: ${name}`);
    }
  };
  // Each version's own validator, then the union entry point the table constraints use.
  await check('valid_catalog_v1', catalogCases);
  await check('valid_catalog_v2', catalogV2Cases);
  await check('valid_catalog', [...catalogCases, ...catalogV2Cases]);
  console.log(
    `PASS: database and shared runtime agree on ${catalogCases.length} v1 and ${catalogV2Cases.length} v2 contract cases.`,
  );
} finally {
  await client.end();
}
