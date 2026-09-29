import pg, { type PoolConfig } from 'pg';
import type { LedgerQuery } from './ledger.ts';

export function curationDatabaseConfig(connectionUrl: string, ca?: string): PoolConfig {
  try {
    const url = new URL(connectionUrl),
      user = decodeURIComponent(url.username),
      password = decodeURIComponent(url.password);
    const port = url.port ? Number(url.port) : 5432;
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !user ||
      !password ||
      url.pathname !== '/postgres' ||
      url.search ||
      url.hash ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      /^(postgres|supabase_admin|supabase_auth_admin|authenticator|service_role|authenticated|anon)(\.|$)/.test(
        user,
      ) ||
      (ca !== undefined && (!ca.includes('-----BEGIN CERTIFICATE-----') || Buffer.byteLength(ca) > 32768))
    )
      throw new Error();
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return {
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port,
      database: 'postgres',
      user,
      password,
      ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
      application_name: 'aicheckout-curation',
      max: 2,
      min: 0,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      maxLifetimeSeconds: 300,
      statement_timeout: 5000,
      query_timeout: 7000,
      options:
        '-c search_path=pg_catalog -c statement_timeout=5000 -c idle_in_transaction_session_timeout=5000',
    };
  } catch {
    throw new Error('Invalid scoped curation database configuration.');
  }
}

/** A dedicated direct/session connection: never use transaction pooling with session SET ROLE. */
export function createCurationDatabase(
  connectionUrl: string,
  ca?: string,
  onPoolError: () => void = () => {},
) {
  const config = curationDatabaseConfig(connectionUrl, ca);
  const pool = new pg.Pool({
    ...config,
    onConnect: async (client) => {
      const result =
        await client.query(`select r.rolcanlogin and not(r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls)
      and pg_has_role(session_user,'aicheckout_curation_executor','MEMBER')
      and not exists(select 1 from pg_roles other where other.rolname not in (session_user,'aicheckout_curation_executor')
        and pg_has_role(session_user,other.oid,'MEMBER'))
      and not exists(select 1 from pg_auth_members m where m.member=r.oid and m.admin_option)
      and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.relkind in ('r','p','v','m','f') and (n.nspname in ('catalog_private','auth')
          or (n.nspname='public' and c.relname in ('catalog_releases','catalog_head')))
        and has_table_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
      and not has_function_privilege(session_user,'public.publish_catalog(uuid,integer,text,bigint,text)','EXECUTE')
      and not has_function_privilege(session_user,'catalog_private.publish_catalog(uuid,integer,text,bigint,text)','EXECUTE')
      and not has_function_privilege(session_user,'public.apply_reviewed_extraction(uuid,uuid,integer,text,jsonb,text)','EXECUTE')
      and not has_function_privilege(session_user,'catalog_private.apply_reviewed_extraction(uuid,uuid,integer,text,jsonb,text)','EXECUTE') as scoped
      from pg_roles r where r.rolname=session_user`);
      if (result.rows.length !== 1 || result.rows[0].scoped !== true)
        throw new Error('Curation connection must use a dedicated executor login.');
      await client.query('set role aicheckout_curation_executor');
    },
  });
  // Never emit driver errors: they may contain connection information or SQL parameters.
  pool.on('error', () => onPoolError());
  const query: LedgerQuery = (sql, parameters) => pool.query(sql, parameters);
  return {
    query,
    async ready() {
      try {
        const client = await pool.connect();
        client.release();
      } catch {
        await pool.end();
        throw new Error('Curation database is unavailable or its login is not scoped correctly.');
      }
    },
    close: () => pool.end(),
  };
}
