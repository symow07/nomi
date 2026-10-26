import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

/**
 * 0214 (the owner's order, 2026-10-26; found 2026-10-01) — WHAT THE APP ROLE MAY WRITE WITHOUT ROW SECURITY.
 *
 * Row security is what keeps one workspace's rows from another's. A table the app role can write with none is
 * either installation-wide on purpose, or a hole. `_migrations` was a hole: 0005 granted the app insert and update
 * on it, so the app could record a migration it never ran (the boot guard would then serve a build against a schema
 * that is not there) or rewrite a checksum (G20's whole point).
 *
 * The list below is every table the app role may write with no row security, each with why — outside `pgboss`, the
 * queue's own schema, which the app owns by design (0015) and whose jobs carry ids, never a customer's words. A new one fails here
 * until it is named — or given row security, or its grant taken away.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;

const INSTALLATION_WIDE: Readonly<Record<string, string>> = {
  'public.deploy_lag': 'the deploy watch (0167): how far production is behind, one installation-wide row the app keeps',
  'public.model_checks': "the model's health (0165): the app records each check; no workspace's data",
  'public.model_check_log': "the model checks' log (0166): insert only; no workspace's data",
};

d('0214 · the app role writes no table without row security, except the installation-wide three', () => {
  let app: pg.Client;
  let admin: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: DATABASE_URL }); await app.connect();
    admin = new pg.Client({ connectionString: ADMIN_URL }); await admin.connect();
  });
  afterAll(async () => {
    // a write that should have been refused and was not (the hole open again) must not outlive the run
    await admin?.query(`delete from _migrations where version = 99999 and name = 'forged'`);
    await app?.end(); await admin?.end();
  });

  it('the list of tables the app may write with no row security is exactly the named three', async () => {
    const r = await admin.query<{ t: string }>(`
      select n.nspname || '.' || c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       -- pgboss is the queue's own schema, the app's by design (0015): pg-boss makes its tables at run time, as the app
       where c.relkind in ('r', 'p') and n.nspname not in ('pg_catalog', 'information_schema', 'pgboss') and not c.relrowsecurity
         and (has_table_privilege('nomi_app', c.oid, 'INSERT') or has_table_privilege('nomi_app', c.oid, 'UPDATE')
           or has_table_privilege('nomi_app', c.oid, 'DELETE') or has_table_privilege('nomi_app', c.oid, 'TRUNCATE'))
       order by 1`);
    expect(r.rows.map((x) => x.t)).toEqual(Object.keys(INSTALLATION_WIDE).sort());
  });

  it('the app role is refused writing the migration record, and still reads the schema version', async () => {
    const refused = async (text: string) => {
      try { await app.query(text); return 'written'; } catch (e) { return (e as { code?: string }).code; }
    };
    expect(await refused(`insert into _migrations (version, name) values (99999, 'forged')`)).toBe('42501');
    expect(await refused(`update _migrations set checksum = 'forged' where version = 1`)).toBe('42501');
    expect(await refused(`delete from _migrations where version = 99999`)).toBe('42501');
    const v = await app.query<{ v: number }>(`select max(version)::int as v from _migrations`);
    const { REQUIRED_SCHEMA_VERSION } = await import('../../src/db/schemaVersion.js');
    expect(v.rows[0]!.v).toBe(REQUIRED_SCHEMA_VERSION);
    expect((await admin.query(`select count(*)::int as n from _migrations where version = 99999`)).rows[0].n).toBe(0);
  });
});
