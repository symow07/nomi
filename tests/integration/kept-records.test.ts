import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

/**
 * D10 (the data-protection audit, 2026-10-12; 0140) — WHAT IS KEPT AFTER AN
 * ERASURE NO LONGER DESCRIBES THEM.
 *
 * A buyer with an order (a tracking number), two order updates (a note, a
 * tracking number), a request whose note describes them, a do-not-contact
 * entry with free-text detail, a standing stop on WhatsApp and a stop they
 * took back on Instagram. The operator tool runs for real, so its plan and the
 * database's erasure must agree on every count (the standing stop used to be
 * counted by the tool alone). After: the kept rows hold nothing that describes
 * them, the standing stop stays, the lifted one is gone.
 */

const ADMIN = process.env['MIGRATE_DATABASE_URL'];
const DATABASE_URL = process.env['DATABASE_URL'];
const d = ADMIN && DATABASE_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RUN = randomUUID().slice(0, 8);
const BIZ = `d1000000-0000-4000-8000-${RUN}0001`;
const DIGITS = String(parseInt(RUN, 16) % 1_000_000_000).padStart(9, '0');
const PHONE = `971${DIGITS}`;
const EMAIL = `nadia.${RUN}@buyer.test`;
const IG = `ig-${RUN}`;

d('D10 · kept records stop describing an erased buyer (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: pg.Client;
  const ids = { client: '', conv: '', ig: '', order: '', req: '', supp: '', standing: '', lifted: '' };
  const one = async (q: string, p: unknown[]) => (await db.query(q, p)).rows[0];

  beforeAll(async () => {
    db = new pg.Client({ connectionString: ADMIN });
    await db.connect();
    await db.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [BIZ, `Kept Records ${RUN}`]);
    ids.client = (await one(`insert into clients (business_id, display_name, phone, email) values ($1, $2, $3, $4) returning id::text as id`,
      [BIZ, `Nadia ${RUN}`, PHONE, EMAIL])).id;
    await db.query(`insert into client_channels (client_id, channel, channel_user_id) values ($1, 'whatsapp', $2), ($1, 'instagram', $3)`, [ids.client, PHONE, IG]);
    ids.conv = (await one(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'whatsapp') returning id::text as id`, [BIZ, ids.client])).id;
    await db.query(`insert into messages (conversation_id, direction, text_content, sent_at) values ($1, 'inbound', 'please delete me', now())`, [ids.conv]);
    const product = (await one(`insert into products (business_id, sku, name) values ($1, $2, 'Lamp') returning id::text as id`, [BIZ, `KR-${RUN}`])).id;
    ids.order = (await one(`insert into orders (order_reference, business_id, client_id, conversation_id, product_id, quantity, unit, client_email, shipping_address, tracking_reference, status)
                            values ($1, $2, $3, $4, $5, 3, 'pcs', $6, '4 Olive St', $7, 'shipped') returning id::text as id`,
      [`KR-${RUN}`, BIZ, ids.client, ids.conv, product, EMAIL, `TRACK-${RUN}`])).id;
    await db.query(`insert into order_updates (business_id, order_id, state, note, tracking_reference) values
                      ($1, $2, 'confirmed', $3, null), ($1, $2, 'shipped', null, $4)`, [BIZ, ids.order, `left with the neighbour of Nadia ${RUN}`, `TRACK-${RUN}`]);
    ids.req = (await one(`insert into deletion_requests (business_id, scope, client_id, asked_by, subject_note) values ($1, 'buyer', $2, 'owner', $3) returning id::text as id`,
      [BIZ, ids.client, `the WhatsApp number ending ${PHONE.slice(-4)}`])).id;
    ids.supp = (await one(`insert into suppressions (business_id, channel, identity, reason, detail) values ($1, 'email', $2, 'bounced', $3) returning id::text as id`,
      [BIZ, EMAIL, `550 mailbox ${EMAIL} unavailable`])).id;
    ids.standing = (await one(`insert into opt_outs (business_id, channel, identity, recorded_by) values ($1, 'whatsapp', $2, 'buyer') returning id::text as id`, [BIZ, PHONE])).id;
    ids.lifted = (await one(`insert into opt_outs (business_id, channel, identity, recorded_by, lifted_at, lifted_by) values ($1, 'instagram', $2, 'buyer', now(), 'owner') returning id::text as id`, [BIZ, IG])).id;
  }, 60_000);

  afterAll(async () => { await db?.end(); });

  it('the tool and the database agree, and every kept row is emptied of them', async () => {
    const r = spawnSync(process.execPath, ['tools/erase-buyer.mjs', '--request', ids.req, '--yes', '--confirm', ids.req.slice(0, 8), '--by', 'Operator Test'],
      { cwd: ROOT, env: { ...process.env, MIGRATE_DATABASE_URL: ADMIN }, encoding: 'utf8', timeout: 120_000 });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);

    expect(await one('select tracking_reference, client_email, shipping_address from orders where id = $1', [ids.order]))
      .toEqual({ tracking_reference: null, client_email: null, shipping_address: null });
    expect((await db.query('select state, note, tracking_reference from order_updates where order_id = $1 order by state', [ids.order])).rows)
      .toEqual([{ state: 'confirmed', note: null, tracking_reference: null }, { state: 'shipped', note: null, tracking_reference: null }]);
    expect(await one('select state, subject_note from deletion_requests where id = $1', [ids.req])).toEqual({ state: 'done', subject_note: null });
    expect(await one('select reason, detail from suppressions where id = $1', [ids.supp])).toEqual({ reason: 'bounced', detail: null });
    // The standing stop keeps doing its job; the one taken back is gone.
    expect(await one('select channel, lifted_at from opt_outs where id = $1', [ids.standing])).toEqual({ channel: 'whatsapp', lifted_at: null });
    expect((await db.query('select 1 from opt_outs where id = $1', [ids.lifted])).rowCount).toBe(0);

    const ledger = await one(`select counts from erasure_ledger where request_id = $1`, [ids.req]);
    expect(ledger.counts.erased.opt_outs).toBe(1);
    expect(ledger.counts.kept.opt_outs).toBe(1);
    // Nothing left in the business names them but the stop and the do-not-contact entry.
    for (const v of [`Nadia ${RUN}`, `TRACK-${RUN}`, `ending ${PHONE.slice(-4)}`, '550 mailbox']) {
      const hits = (await db.query(`select 1 from orders where business_id = $1 and (tracking_reference like $2 or notes like $2)
                                    union all select 1 from order_updates where business_id = $1 and (note like $2 or tracking_reference like $2)
                                    union all select 1 from deletion_requests where business_id = $1 and subject_note like $2
                                    union all select 1 from suppressions where business_id = $1 and detail like $2`, [BIZ, `%${v}%`])).rowCount;
      expect(hits, v).toBe(0);
    }
  });
});
