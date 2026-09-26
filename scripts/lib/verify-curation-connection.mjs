import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createCurationDatabase } from '../../apps/api/src/curation/database.ts';

/** Exercise actual startup role validation; use only the disposable local database. */
export async function verifyCurationConnection() {
  const owner = new pg.Client({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres',
    connectionTimeoutMillis: 5000, statement_timeout: 10000, application_name: 'aicheckout-connection-test' });
  const name = `checkout_scope_${randomUUID().replaceAll('-', '')}`, role = pg.escapeIdentifier(name), password = randomUUID();
  const url = new URL('postgresql://127.0.0.1:54322/postgres'); url.username = name; url.password = password;
  let created = false;
  const rejected = async () => {
    const pool = createCurationDatabase(url.href);
    // ready() closes a failed pool itself, and returns only a safe error.
    await assert.rejects(pool.ready(), error => error.message === 'Curation database is unavailable or its login is not scoped correctly.');
  };
  try {
    await owner.connect(); await owner.query('select pg_advisory_lock(722093117)');
    await owner.query(`create role ${role} login password ${pg.escapeLiteral(password)} nosuperuser nocreatedb nocreaterole noreplication nobypassrls`); created = true;
    await rejected(); // No executor membership.
    await owner.query(`grant aicheckout_curation_executor to ${role}`);
    const pool = createCurationDatabase(url.href);
    try {
      await pool.ready();
      const { rows } = await pool.query("select json_build_object('login',session_user,'role',current_user) as value", []);
      assert.deepEqual(rows[0].value, { login: name, role: 'aicheckout_curation_executor' });
      await assert.rejects(pool.query('select * from catalog_private.curation_policy', []), error => error.code === '42501');
    } finally { await pool.close(); }

    await owner.query(`alter role ${role} createrole`); await rejected();
    await owner.query(`alter role ${role} nocreaterole`);
    await owner.query(`grant aicheckout_curation_executor to ${role} with admin option`); await rejected();
    await owner.query(`revoke admin option for aicheckout_curation_executor from ${role}`);
    await owner.query(`grant update on catalog_private.curation_policy to ${role}`); await rejected();
    await owner.query(`revoke update on catalog_private.curation_policy from ${role}`);
    await owner.query(`grant execute on function public.publish_catalog(uuid,integer,text,bigint,text) to ${role}`); await rejected();
    await owner.query(`revoke execute on function public.publish_catalog(uuid,integer,text,bigint,text) from ${role}`);
    await owner.query(`grant execute on function catalog_private.publish_catalog(uuid,integer,text,bigint,text) to ${role}`); await rejected();
    await owner.query(`revoke execute on function catalog_private.publish_catalog(uuid,integer,text,bigint,text) from ${role}`);
    for (const schema of ['public', 'catalog_private']) {
      await owner.query(`grant execute on function ${schema}.apply_reviewed_extraction(uuid,uuid,integer,text,jsonb,text) to ${role}`); await rejected();
      await owner.query(`revoke execute on function ${schema}.apply_reviewed_extraction(uuid,uuid,integer,text,jsonb,text) from ${role}`);
    }
    await owner.query(`grant authenticated to ${role}`); await rejected();
    await owner.query(`revoke authenticated from ${role}`);
    console.log('PASS: actual scoped LOGIN selects only the executor role; startup rejects missing membership, admin powers, sensitive grants, publication/application authority, and extra roles.');
  } finally {
    if (created) {
      // This unique test role owns no objects. Remove its test-only grants even on failure.
      await owner.query(`revoke all on catalog_private.curation_policy from ${role}`);
      await owner.query(`revoke all on function public.publish_catalog(uuid,integer,text,bigint,text) from ${role}`);
      await owner.query(`revoke all on function catalog_private.publish_catalog(uuid,integer,text,bigint,text) from ${role}`);
      await owner.query(`revoke all on function public.apply_reviewed_extraction(uuid,uuid,integer,text,jsonb,text) from ${role}`);
      await owner.query(`revoke all on function catalog_private.apply_reviewed_extraction(uuid,uuid,integer,text,jsonb,text) from ${role}`);
      await owner.query(`drop role ${role}`);
    }
    await owner.end();
  }
}
