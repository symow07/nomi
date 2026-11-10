import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
// @ts-expect-error — the operator tool, plain JS on purpose (tools/ is not type-checked).
import * as op from '../../tools/lib/operator.mjs';

/**
 * 4.1 fix O1 — THE TRIAL STARTS FROM THE FIRST CHANNEL, WHATEVER IT IS. `first_channel_at()` (re-made in 0240) over
 * every place a connection is written. Before, a workspace on Telegram, TikTok or the web chat alone had no first
 * channel: its trial never started or ended, the sweep never made its subscription, and 0240 never held it.
 *
 *   · one workspace per kind of connection, holding only that one: its first channel is when it connected;
 *   · a channel Reconnect wrote again: the first `connect` on the trail still counts, not the later time;
 *   · the sweep (`billing_to_subscribe`) now subscribes a Telegram-only workspace with a plan and a card;
 *   · with `billing_required` on and its trial over with no card, a web-chat-only workspace is held.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const PLAN = `o1-${RUN}`;

d('4.1 fix O1 · first_channel_at counts every channel (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let admin: pg.Client;
  let defaultDays: number | null = null;
  const made: string[] = [];
  const at = new Date(Date.now() - 20 * DAY);
  const shop = async (label: string): Promise<string> => {
    const id = randomUUID();
    await admin.query(`insert into businesses (id, name, owner_locale, signed_up_at) values ($1, $2, 'en', now() - interval '30 days')`, [id, `O1 ${label} ${RUN}`]);
    made.push(id);
    return id;
  };
  const first = async (id: string): Promise<number | null> => {
    const v = (await admin.query(`select first_channel_at($1) as at`, [id])).rows[0].at as Date | null;
    return v ? v.getTime() : null;
  };
  const channel = (id: string, kind: string, when: Date) => admin.query(
    `insert into channels (business_id, kind, status, connected_at) values ($1, $2, 'connected', $3)`, [id, kind, when]);
  const digits = () => randomUUID().replace(/[^0-9]/g, '').padEnd(14, '7').slice(0, 14);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    defaultDays = (await admin.query(`select self_serve_trial_days as d from billing_settings where id`)).rows[0]?.d ?? null;
    await admin.query(`update billing_settings set self_serve_trial_days = null where id`);
  });
  afterAll(async () => {
    await op.clearOperatorFlag(admin, { flag: 'billing_required', businessId: null }).catch(() => undefined);
    await admin?.query(`update billing_settings set self_serve_trial_days = $1 where id`, [defaultDays]).catch(() => undefined);
    await admin?.query(`update plans set active = false where id = $1`, [PLAN]).catch(() => undefined);
    await admin?.query(`delete from businesses where id = any($1)`, [made]).catch(() => undefined);
    await admin?.end();
  });

  for (const kind of ['whatsapp', 'instagram', 'messenger', 'telegram', 'web_chat', 'tiktok', 'email', 'line'] as const) {
    it(`a channels row of kind ${kind}, alone`, async () => {
      const id = await shop(kind);
      expect(await first(id)).toBeNull();
      await channel(id, kind, at);
      expect(await first(id)).toBe(at.getTime());
    });
  }

  it('each accounts table, alone: a Page, a mailbox, WhatsApp\'s own number, TikTok', async () => {
    const page = await shop('page');
    await admin.query(`insert into meta_accounts (business_id, page_id, page_name, token_ciphertext, fingerprint, scopes, connected_by, connected_at)
                       values ($1, $2, 'P', 'v1.x', '0123456789ab', 'pages_messaging', 't', $3)`, [page, digits(), at]);
    const mail = await shop('mail');
    await admin.query(`insert into mail_accounts (business_id, provider, address, refresh_token_ciphertext, fingerprint, scopes, connected_by, connected_at)
                       values ($1, 'google', $2, 'v1.x', '0123456789ab', 'x', 't', $3)`, [mail, `o1-${RUN}@shop.example`, at]);
    const wa = await shop('wa');
    await admin.query(`insert into whatsapp_accounts (business_id, waba_id, phone_number_id, token_ciphertext, fingerprint, connected_by, connected_at)
                       values ($1, $2, $3, 'v1.x', '0123456789ab', 't', $4)`, [wa, digits(), digits(), at]);
    const tt = await shop('tiktok-account');
    await admin.query(`insert into tiktok_accounts (business_id, open_id, token_ciphertext, fingerprint, scopes, connected_by, connected_at)
                       values ($1, $2, 'v1.x', '0123456789ab', 'user.info.basic', 't', $3)`, [tt, `open${digits()}`, at]);
    expect([await first(page), await first(mail), await first(wa), await first(tt)]).toEqual(Array(4).fill(at.getTime()));
  });

  it('Reconnect writes the row\'s connected_at again; the first connect on the trail still counts', async () => {
    const id = await shop('reconnected');
    const ch = (await admin.query(`insert into channels (business_id, kind, status, connected_at) values ($1, 'telegram', 'connected', now()) returning id`, [id])).rows[0].id;
    await admin.query(`insert into channel_audit (business_id, channel_id, action, actor, at) values ($1, $2, 'connect', 'owner', $3)`, [id, ch, at]);
    expect(await first(id)).toBe(at.getTime());
  });

  it('the sweep subscribes a Telegram-only workspace with a plan and a card; with no card and the switch on, a web-chat one is held', async () => {
    expect(await op.setPlan(admin, { id: PLAN, name: 'Nomi', price: { id: `price_${RUN}o1`, amountMinor: 4900, currency: 'usd', interval: 'month', active: true },
      customers: 300, assistants: 1, by: 'test' })).toBe('set');
    const tg = await shop('telegram-card');
    await channel(tg, 'telegram', at);
    await admin.query(`insert into workspace_billing (business_id, plan_id, stripe_customer_id, card_saved_at) values ($1, $2, $3, now())`,
      [tg, PLAN, `cus_${RUN}o1tg`]);
    const sweep = (await admin.query(`select business_id::text as id, first_channel_at from billing_to_subscribe() where business_id = $1`, [tg])).rows;
    expect(sweep.map((r: { id: string; first_channel_at: Date }) => [r.id, r.first_channel_at.getTime()])).toEqual([[tg, at.getTime()]]);

    const chat = await shop('web-chat');
    await channel(chat, 'web_chat', at);
    expect((await admin.query(`select billing_trial_over($1) as o`, [chat])).rows[0].o, 'switch off: nothing').toBe(false);
    expect(await op.setOperatorFlag(admin, { flag: 'billing_required', businessId: null, reason: `o1 ${RUN}`, by: 'test' })).toBe(1);
    expect((await admin.query(`select billing_trial_over($1) as o`, [chat])).rows[0].o, 'switch on, no trial, no card').toBe(true);
    expect(await op.clearOperatorFlag(admin, { flag: 'billing_required', businessId: null })).toBe(1);
  });
});
