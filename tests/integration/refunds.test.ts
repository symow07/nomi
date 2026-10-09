import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import Fastify from 'fastify';
import { sql } from 'kysely';
// @ts-expect-error — the operator tool, plain JS on purpose (tools/ is not type-checked).
import * as op from '../../tools/lib/operator.mjs';

/**
 * PRE-LAUNCH item 5 (0134) — the refund terms over Postgres and the web app:
 *
 *   · /refunds draws its trial clause from the self-serve trial, through the definer function the app role may
 *     call (the table stays closed to it), and leaves the clause out while none is set;
 *   · monthly only: the database refuses a plan of any other period, and the operator's tool refuses a yearly price
 *     before it writes anything.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);

d('PRE-LAUNCH 5 · the refund terms (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let esc: typeof import('../../src/api/web/layout.js')['esc'];
  let before: number | null = null;
  const trial = (days: number | null) => admin.query(`update billing_settings set self_serve_trial_days = $1 where id`, [days]);
  const page = async () => (await app.inject({ method: 'GET', url: '/refunds' })).body.replace(/[\u2066-\u2069]/g, '');

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    before = (await admin.query(`select self_serve_trial_days as d from billing_settings where id`)).rows[0]?.d ?? null;
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    ({ esc } = await import('../../src/api/web/layout.js'));
    db = createDb(DATABASE_URL!);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, sessionSecret: 'x'.repeat(64), accessCode: `refunds-${RUN}`, businessId: 'de300000-0000-4000-8000-0000000000b1',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false,
      kickOutbound: async () => {}, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
  }, 60_000);
  afterAll(async () => {
    await trial(before).catch(() => undefined);
    await admin?.end();
    await app?.close();
    await db?.destroy();
  });

  it('no self-serve trial set: the page has no trial clause; one set: its days, read by the app role through the function', async () => {
    await trial(null);
    const none = await page();
    expect(none).toContain(esc(t('en', 'legal.refunds.cancel.title')));
    expect(none).not.toContain(esc(t('en', 'legal.refunds.trial.title')));
    await trial(14);
    const fourteen = await page();
    expect(fourteen).toContain(`<h2>${esc(t('en', 'legal.refunds.trial.title'))}</h2>`);
    expect(fourteen).toContain(esc(t('en', 'legal.refunds.trial.body', { days: 14 })));
    // the app role reads the one number, never the table
    await expect(sql`select * from billing_settings`.execute(db)).rejects.toThrow(/permission denied/);
    await trial(before);
  });

  it('monthly only: the database refuses a yearly plan, and the operator\'s tool refuses one before writing anything', async () => {
    await expect(admin.query(
      `insert into plans (id, name, stripe_price_id, amount_minor, currency, period, customers_a_month, set_by)
       values ($1, 'Annual', $2, 49000, 'usd', 'year', 100, 'test')`, [`annual-${RUN}`, `price_${RUN}annual`],
    )).rejects.toThrow(/plans_monthly_only/);
    const said = await op.setPlan(admin, {
      id: `annual-${RUN}`, name: 'Annual', customers: 100, by: 'test',
      price: { id: `price_${RUN}annual`, amountMinor: 49000, currency: 'usd', interval: 'year', active: true },
    });
    expect(said).toBe('not_monthly');
    expect((await admin.query(`select count(*)::int as n from plans where id = $1`, [`annual-${RUN}`])).rows[0].n).toBe(0);
  });
});
