import assert from 'node:assert/strict';
import pg from 'pg';
import { catalogSchema } from '../packages/rewards-core/src/schema.ts';
import { MERCHANT_CATEGORIES_V3, REWARD_CATEGORIES_V3 } from '../packages/rewards-core/src/types.ts';
import { catalogCases, catalogV2Cases, catalogV3Cases } from '../packages/rewards-core/test-cases.ts';

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
  await check('valid_catalog_v3', catalogV3Cases);
  await check('valid_catalog', [...catalogCases, ...catalogV2Cases, ...catalogV3Cases]);
  // The v3 category lists are SQL functions so a later migration can extend them; they must match.
  const categories = await client.query(
    `select catalog_private.catalog_v3_reward_categories() as reward,
            catalog_private.catalog_v3_merchant_categories() as merchant`,
  );
  assert.deepEqual(categories.rows[0].reward, [...REWARD_CATEGORIES_V3], 'v3 reward categories');
  assert.deepEqual(categories.rows[0].merchant, [...MERCHANT_CATEGORIES_V3], 'v3 merchant categories');
  console.log(
    `PASS: database and shared runtime agree on ${catalogCases.length} v1, ${catalogV2Cases.length} v2 and ${catalogV3Cases.length} v3 contract cases, and on the v3 category lists.`,
  );
} finally {
  await client.end();
}
