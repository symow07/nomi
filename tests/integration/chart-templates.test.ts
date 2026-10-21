import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { asTenant, refusal, purgeBusinesses, type Q } from './books-db.js';

/**
 * A2.3 (Phase 5, 0171) — a workspace starts its books from a chart template. The template is shared and only a
 * migration writes it; applying it adds what the workspace lacks, parents linked, and never changes what the
 * owner already has. (The CGNC itself is D4's content; this test brings its own small template.)
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `c4a30000-0000-4000-8000-${RUN}0001`;
const OTHER = `c4a30000-0000-4000-8000-${RUN}0002`;
const TPL = `test-a23-${RUN}`;

d('A2.3 · chart templates (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 120_000 }, () => {
  let admin: pg.Client;
  let app: pg.Client;
  const as = <T>(b: string, fn: (q: Q) => Promise<T>) => asTenant(app, b, fn);
  const apply = (b: string) => as(b, async (q) => (await q(`select * from apply_chart_template($1)`, [TPL])).rows[0] as { accounts_added: number; journals_added: number });
  const chart = (b: string) => as(b, async (q) => (await q(`select a.code, a.name, a.kind, p.code as parent from accounts a left join accounts p on p.id = a.parent_id order by a.code`)).rows);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN_URL });
    app = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await app.connect();
    for (const [id, name] of [[BIZ, `Chart ${RUN}`], [OTHER, `Chart other ${RUN}`]]) {
      await admin.query(`insert into businesses (id, name, engine) values ($1, $2, 'service')`, [id, name]);
    }
    await admin.query(`insert into chart_templates (code, name, country, version, source) values ($1, 'A small chart', 'MA', 'test', 'tests/integration/chart-templates.test.ts')`, [TPL]);
    for (const [code, name, kind, parent] of [
      ['5', 'Comptes de trésorerie', 'asset', null], ['51', 'Trésorerie - actif', 'asset', '5'], ['514', 'Banques, T.G. et C.C.P.', 'asset', '51'],
      ['5141', 'Banques', 'asset', '514'], ['7111', 'Ventes de marchandises au Maroc', 'income', null]] as const) {
      await admin.query(`insert into chart_template_accounts (template, code, name, kind, parent_code) values ($1, $2, $3, $4, $5)`, [TPL, code, name, kind, parent]);
    }
    for (const [code, name, kind] of [['VT', 'Ventes', 'sales'], ['CL', 'Clôture', 'closing']] as const) {
      await admin.query(`insert into chart_template_journals (template, code, name, kind) values ($1, $2, $3, $4)`, [TPL, code, name, kind]);
    }
  });
  afterAll(async () => {
    await purgeBusinesses(admin, [BIZ, OTHER], 'chart-templates-test');
    await admin.query('delete from chart_templates where code = $1', [TPL]);
    await app.end();
    await admin.end();
  });

  it('applied, the workspace has the chart, parents linked by code, and the journals — the closing one included', async () => {
    expect(await apply(BIZ)).toEqual({ accounts_added: 5, journals_added: 2 });
    expect(await chart(BIZ)).toEqual([
      { code: '5', name: 'Comptes de trésorerie', kind: 'asset', parent: null },
      { code: '51', name: 'Trésorerie - actif', kind: 'asset', parent: '5' },
      { code: '514', name: 'Banques, T.G. et C.C.P.', kind: 'asset', parent: '51' },
      { code: '5141', name: 'Banques', kind: 'asset', parent: '514' },
      { code: '7111', name: 'Ventes de marchandises au Maroc', kind: 'income', parent: null },
    ]);
    expect(await as(BIZ, async (q) => (await q(`select code, kind from journals order by code`)).rows)).toEqual([{ code: 'CL', kind: 'closing' }, { code: 'VT', kind: 'sales' }]);
  });

  it('applied again it adds nothing, and an account the owner made their own stays theirs', async () => {
    await as(OTHER, (q) => q(`insert into accounts (business_id, code, name, kind) values (current_business_id(), '5141', 'Bank Al-Maghrib account', 'asset')`));
    expect(await apply(OTHER)).toEqual({ accounts_added: 4, journals_added: 2 });
    const mine = (await chart(OTHER)).find((r) => r.code === '5141');
    expect(mine).toEqual({ code: '5141', name: 'Bank Al-Maghrib account', kind: 'asset', parent: null });
    expect(await apply(OTHER)).toEqual({ accounts_added: 0, journals_added: 0 });
    // each workspace has its own copy
    expect((await chart(BIZ)).find((r) => r.code === '5141')?.name).toBe('Banques');
  });

  it('only a migration writes a template; an unknown one, or one applied outside a workspace, is refused', async () => {
    expect(await refusal(app, BIZ, (q) => q(`insert into chart_templates (code, name, version, source) values ('mine', 'Mine', '1', 'me')`))).toMatch(/permission denied/);
    expect(await refusal(app, BIZ, (q) => q(`update chart_template_accounts set name = 'x' where template = $1`, [TPL]))).toMatch(/permission denied/);
    expect(await refusal(app, BIZ, (q) => q(`select * from apply_chart_template('no-such-chart')`))).toMatch(/there is no chart template "no-such-chart"/);
    await expect(app.query(`select * from apply_chart_template($1)`, [TPL])).rejects.toThrow(/applied inside a workspace/);
  });
});
