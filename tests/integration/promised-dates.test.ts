import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { ChannelAdapter } from '../../src/channels/contract.js';

/**
 * 0083 — WHAT A REPLY PROMISED, over Postgres, the real store and the real
 * drive loop (the design pass, decided 2026-09-29). A promise is written when
 * the reply LEAVES: a queued reply promised nothing yet, a sent one did, once;
 * the calendar shows it on its day, the customer's panel with the words that
 * reached them, the assistant's with ✦.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `dd7c0000-0000-4000-8000-${RUN}0006`;

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;
type BusinessId = import('../../src/core/types/ids.js').BusinessId;

const bidOf = async (raw: string): Promise<BusinessId> => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
};

d('0083 · a sent reply\'s promises (requires DATABASE_URL)', () => {
  let db: Db;
  let cid = '';
  const sent: string[] = [];
  const instagram: ChannelAdapter = {
    kind: 'instagram', provider: 'test',
    verifyWebhook: () => false, parseWebhook: () => [],
    sendText: async (_to, body) => { sent.push(body); return { ok: true, providerMessageId: `ig-p-${RUN}-${sent.length}` }; },
  };
  const inTenant = async <R>(fn: (tx: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, await bidOf(BIZ), fn);
  };
  const queue = async (body: string, origin: 'employee' | 'owner' = 'employee') => {
    const { enqueueOutboundRow } = await import('../../src/db/channels.js');
    return inTenant(async (tx) => enqueueOutboundRow(tx, await bidOf(BIZ), cid, body, origin));
  };
  const drive = async () => {
    const { channelStore } = await import('../../src/db/channels.js');
    const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
    const bid = await bidOf(BIZ);
    return inTenant((tx) => driveConversationOutbound(
      { store: channelStore(tx, bid), adapters: (ch) => (ch === 'instagram' ? instagram : undefined), now: () => new Date() }, cid));
  };
  const promises = () => inTenant((tx) => sql<{ kind: string; due_on: string; said: string; said_by: string }>`
    select kind, to_char(due_on, 'YYYY-MM-DD') as due_on, said, said_by from promised_dates order by created_at, kind`.execute(tx).then((r) => r.rows));

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    db = createDb(DATABASE_URL!);
    await inTenant((tx) => sql`insert into businesses (id, name, owner_locale) values (${BIZ}, 'Promise Shop', 'en')
                               on conflict (id) do nothing`.execute(tx));
    await inTenant(async (tx) => {
      await sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
                values (${BIZ}, 'instagram', ${`ig-prom-${RUN}`}, 'prom-secret', 'service', true)`.execute(tx);
      const c = await ensureConversation(tx, await bidOf(BIZ), `ig-maya-p-${RUN}`, 'Maya Rahman', 'instagram');
      cid = c.conversationId;
      await sql`update client_channels set last_inbound_at = now() - interval '1 minute' where client_id = ${c.clientId}`.execute(tx);
      await sql`update conversations set assigned_to = null where id = ${cid}::uuid`.execute(tx);
    });
  }, 60_000);
  afterAll(async () => { await db?.destroy(); });

  it('a queued reply has promised nothing; once it leaves, each promise is written with its sentence, once', async () => {
    await queue('Thanks Maya! This price is valid until December 15. I\'ll check the 100 ml and get back to you tomorrow.');
    expect(await promises()).toEqual([]);
    await drive();
    expect(sent).toHaveLength(1);
    const { dayKey, addDays } = await import('../../src/core/owner/i18n/format.js');
    const today = dayKey(new Date(), 'Asia/Shanghai');
    const found = await promises();
    expect(found).toEqual(expect.arrayContaining([
      { kind: 'follow_up', due_on: addDays(today, 1), said: 'I\'ll check the 100 ml and get back to you tomorrow.', said_by: 'assistant' },
      { kind: 'price_end', due_on: expect.stringMatching(/^\d{4}-12-15$/), said: 'This price is valid until December 15.', said_by: 'assistant' },
    ]));
    expect(found).toHaveLength(2);
    await drive();   // nothing more to send: nothing written twice
    expect(await promises()).toHaveLength(2);
  });

  it('a person\'s own reply that promises is theirs', async () => {
    // the first reply's delivery receipt, so the next may go (messages go in order)
    await inTenant((tx) => sql`update outbound_messages set status = 'delivered', delivered_at = now()
                                where conversation_id = ${cid}::uuid and status = 'sent'`.execute(tx));
    await queue('I will confirm the colours on Friday.', 'owner');
    await drive();
    expect((await promises()).find((p) => p.said === 'I will confirm the colours on Friday.')?.said_by).toBe('person');
  });

  it('the calendar shows it on its day, from the conversation, with the assistant\'s mark; the panel quotes it', async () => {
    const { loadCalendar } = await import('../../src/db/calendar.js');
    const { renderCalendar, parseCalendarQuery } = await import('../../src/api/web/calendar.js');
    const { dayKey, addDays } = await import('../../src/core/owner/i18n/format.js');
    const now = new Date();
    const q = parseCalendarQuery({ view: 'day', at: addDays(dayKey(now, 'Asia/Shanghai'), 1) }, now);
    const html = renderCalendar(await loadCalendar(db, BIZ, { ...q, outreach: false }, now), 'en', { view: 'day', at: q.at, now });
    // Phase 7 — the day is one list: the row from the conversation (solid), a door to it, the sentence as sent.
    expect(html).toMatch(new RegExp(`<li class="dl-row solid" data-src="promised_dates:[0-9a-f-]{36}" data-col="due_on"[^>]*>[\\s\\S]*?<a class="dl-go" href="/app/inbox/${cid}#latest">`));
    expect(html).toContain("“I'll check the 100 ml and get back to you tomorrow.”");
    expect(html).toContain('<span class="as" aria-hidden="true">✦</span> Follow-up promised');

    const { loadCustomerPanel } = await import('../../src/db/customerPanel.js');
    const panel = await inTenant((tx) => loadCustomerPanel(tx, cid));
    expect(panel!.promised.map((p) => p.said)).toContain('I\'ll check the 100 ml and get back to you tomorrow.');
  });
});
