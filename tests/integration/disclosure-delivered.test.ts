import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ChannelAdapter } from '../../src/channels/contract.js';

/**
 * 0079 — "has this buyer been told?" is what REACHED him, over Postgres.
 *
 * The owner's rule (2026-09-28): a shop's opener asked again after the buyer
 * was told hands off; before, it is answered — the same in draft and in
 * auto-send. Told = the provider accepted a message carrying the disclosure,
 * whoever wrote it. Here, with the real store, the real drive loop and the
 * real state loader:
 *
 *   · queued is not told: nothing is stamped;
 *   · sent is told: stamped once, the first time stays, and a repeated opener
 *     on the loaded state hands off;
 *   · refused at send time (the owner's Stop) is not told;
 *   · accepted, then reported failed by the provider's status webhook, is
 *     untold again — the stamp is rebuilt from what still stands;
 *   · the owner's own message carrying it — an approved draft, a typed reply —
 *     tells him too; one that does not carry it tells him nothing;
 *   · a turn's saveState, written from a state read before the send landed,
 *     never erases the stamp;
 *   · the migration's backfill stamps what already went out, and only that.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_DATABASE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd790000-0000-4000-8000-${RUN}0001`;

type Db = import('../../src/db/client.js').Db;
type Tx = import('../../src/db/client.js').Tx;
type BusinessId = import('../../src/core/types/ids.js').BusinessId;
type ConversationId = import('../../src/core/types/ids.js').ConversationId;

const bidOf = async (raw: string): Promise<BusinessId> => {
  const { parseBusinessId } = await import('../../src/core/types/ids.js');
  const b = parseBusinessId(raw); if (!b.ok) throw new Error('fixture'); return b.value;
};

d('0079 · the disclosure is told when it reaches the buyer (requires DATABASE_URL, MIGRATE_DATABASE_URL)', () => {
  let db: Db;
  let admin: Db;
  let told = '';
  const sent: string[] = [];
  const instagram: ChannelAdapter = {
    kind: 'instagram', provider: 'test',
    verifyWebhook: () => false, parseWebhook: () => [],
    sendText: async (_to, body) => { sent.push(body); return { ok: true, providerMessageId: `ig-${RUN}-${sent.length}` }; },
  };

  const inTenant = async <R>(fn: (tx: Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, await bidOf(BIZ), fn);
  };
  let buyers = 0;
  /** A fresh conversation on Instagram, the buyer's window open. */
  const conversation = async (): Promise<string> => {
    const { ensureConversation } = await import('../../src/db/channels.js');
    return inTenant(async (tx) => {
      const c = await ensureConversation(tx, await bidOf(BIZ), `ig-buyer-${RUN}-${++buyers}`, `Buyer ${buyers}`, 'instagram');
      await sql`update client_channels set last_inbound_at = now() - interval '1 minute'
                 where client_id = ${c.clientId} and channel = 'instagram'`.execute(tx);
      await sql`update conversations set assigned_to = null where id = ${c.conversationId}::uuid`.execute(tx);
      return c.conversationId;
    });
  };
  const queue = async (cid: string, body: string, origin: 'employee' | 'owner' = 'employee') => {
    const { enqueueOutboundRow } = await import('../../src/db/channels.js');
    const id = await inTenant(async (tx) => enqueueOutboundRow(tx, await bidOf(BIZ), cid, body, origin));
    expect(id).not.toBeNull();
    return id!;
  };
  const drive = async (cid: string) => {
    const { channelStore } = await import('../../src/db/channels.js');
    const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
    const bid = await bidOf(BIZ);
    return inTenant((tx) => driveConversationOutbound(
      { store: channelStore(tx, bid), adapters: (ch) => (ch === 'instagram' ? instagram : undefined), now: () => new Date() }, cid));
  };
  const state = async (cid: string) => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const bid = await bidOf(BIZ);
    return inTenant((tx) => tenantRepos(tx, bid).conversations.loadState(cid as ConversationId));
  };
  /** The provider's status webhook for the Nth message sent in this file. */
  const statusOf2 = async (n: number, status: 'delivered' | 'failed') => {
    const { channelStore } = await import('../../src/db/channels.js');
    const bid = await bidOf(BIZ);
    return inTenant((tx) => channelStore(tx, bid).reconcileStatus(`ig-${RUN}-${n}`, status, status === 'failed' ? '131026 undeliverable' : null));
  };
  const deliveredAt = (cid: string) => inTenant((tx) => sql<{ at: Date | null }>`
    select ai_disclosure_delivered_at as at from conversations where id = ${cid}::uuid`.execute(tx).then((r) => r.rows[0]?.at ?? null));
  const statusOf = (id: string) => inTenant((tx) => sql<{ status: string }>`
    select status from outbound_messages where id = ${id}::uuid`.execute(tx).then((r) => r.rows[0]!.status));
  /** A repeated opener, read on the conversation's state as the turn loads it. */
  const openerHandsOff = async (cid: string) => {
    const { detectSignals } = await import('../../src/core/scoring/detect.js');
    const s = (await state(cid))!;
    return detectSignals({ text: '客服在吗', state: s, analysis: null, unitPrice: null }).some((x) => x.kind === 'human_requested');
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { disclosureFor, withDisclosure } = await import('../../src/core/conversation/disclosure.js');
    db = createDb(DATABASE_URL!);
    admin = createDb(MIGRATE_DATABASE_URL!);
    told = withDisclosure(disclosureFor({ detected: 'en', name: 'Lily', business: 'Told Co' })!, 'Which colour would you like?');
    await inTenant((tx) => sql`insert into businesses (id, name, owner_locale) values (${BIZ}, 'Told Co', 'en')
                               on conflict (id) do nothing`.execute(tx));
    await inTenant((tx) => sql`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine, is_active)
                               values (${BIZ}, 'instagram', ${`ig-acct-${RUN}`}, 'told-secret', 'service', true)`.execute(tx));
  }, 60_000);
  afterAll(async () => { await db?.destroy(); await admin?.destroy(); });

  it('the database is at 79 or later and has the column', async () => {
    const { REQUIRED_SCHEMA_VERSION } = await import('../../src/db/schemaVersion.js');
    expect(REQUIRED_SCHEMA_VERSION).toBeGreaterThanOrEqual(79);
    const col = await sql<{ n: number }>`select count(*)::int as n from information_schema.columns
      where table_name = 'conversations' and column_name = 'ai_disclosure_delivered_at'`.execute(admin);
    expect(col.rows[0]!.n).toBe(1);
  });

  it('queued is not told; sent is told, and a repeated opener then hands off', async () => {
    const cid = await conversation();
    await queue(cid, told);
    expect((await state(cid))!.aiDisclosureDeliveredAt).toBeNull();
    expect(await openerHandsOff(cid)).toBe(false);

    const effects = await drive(cid);
    expect(effects.some((e) => e.kind === 'sent')).toBe(true);
    expect((await state(cid))!.aiDisclosureDeliveredAt).toBeInstanceOf(Date);
    expect(await openerHandsOff(cid)).toBe(true);
  });

  it('accepted, then reported FAILED by the provider: untold again — and told by the next one that stands', async () => {
    const cid = await conversation();
    await queue(cid, told);
    await drive(cid);
    const n1 = sent.length;
    expect(await deliveredAt(cid)).toBeInstanceOf(Date);

    expect((await statusOf2(n1, 'failed')).outcome).toBe('applied');
    expect(await deliveredAt(cid)).toBeNull();
    expect(await openerHandsOff(cid)).toBe(false);

    await queue(cid, told.replace('Which colour would you like?', 'Sorry — which colour?'));
    await drive(cid);
    const n2 = sent.length;
    const second = await deliveredAt(cid);
    expect(second).toBeInstanceOf(Date);

    // A THIRD carrier fails later: the second still stands, so he is still told, from the second.
    await statusOf2(n2, 'delivered');
    await queue(cid, told.replace('Which colour would you like?', 'And the size?'));
    await drive(cid);
    await statusOf2(sent.length, 'failed');
    expect(await deliveredAt(cid)).toEqual(second);
  });

  it("refused at send time by the owner's Stop: not told, and the opener is still answered", async () => {
    const cid = await conversation();
    const id = await queue(cid, told);
    await inTenant((tx) => sql`update businesses set assistant_stopped_at = now() where id = ${BIZ}::uuid`.execute(tx));
    try {
      await drive(cid);
    } finally {
      await inTenant((tx) => sql`update businesses set assistant_stopped_at = null where id = ${BIZ}::uuid`.execute(tx));
    }
    expect(await statusOf(id)).toBe('canceled');
    expect(await deliveredAt(cid)).toBeNull();
    expect(await openerHandsOff(cid)).toBe(false);
  });

  it("the owner's own message carrying it tells him (an approved draft, a typed reply); one without it tells him nothing", async () => {
    const withIt = await conversation();
    await queue(withIt, `Hello from the team! ${told}`, 'owner');
    await drive(withIt);
    expect(await deliveredAt(withIt)).toBeInstanceOf(Date);

    const without = await conversation();
    const id = await queue(without, 'Hello from the team — which colour would you like?', 'owner');
    await drive(without);
    expect(await statusOf(id)).toBe('sent');
    expect(await deliveredAt(without)).toBeNull();
    expect(await openerHandsOff(without)).toBe(false);
  });

  it('the first time stays, and a turn saving a state read before the send never erases it', async () => {
    const { tenantRepos } = await import('../../src/db/repos.js');
    const bid = await bidOf(BIZ);
    const cid = await conversation();
    const stale = (await state(cid))!;          // the turn read this before the send landed
    expect(stale.aiDisclosureDeliveredAt).toBeNull();

    await queue(cid, told);
    await drive(cid);
    const first = await deliveredAt(cid);
    expect(first).toBeInstanceOf(Date);

    await inTenant((tx) => tenantRepos(tx, bid).conversations.saveState(stale));
    expect(await deliveredAt(cid)).toEqual(first);

    // A later message carrying it again (the buyer asked what he is talking to): the stamp stays the first.
    await inTenant((tx) => sql`update outbound_messages set status = 'delivered', delivered_at = now()
                               where conversation_id = ${cid}::uuid and status = 'sent'`.execute(tx));
    await queue(cid, told.replace('Which colour would you like?', 'Anything else I can help with?'));
    await drive(cid);
    expect(await deliveredAt(cid)).toEqual(first);
  });

  it("the migration's backfill stamps a conversation whose disclosure already went out, at the time it left — and nothing else", async () => {
    const statement = readFileSync('migrations/0079_disclosure_delivered.sql', 'utf8').match(/update conversations c[\s\S]*?;/)![0];
    // Scoped to this test's business so the shared database is left alone.
    const scoped = statement.replace(/;\s*$/, ` and c.business_id = '${BIZ}'::uuid;`);

    const [wentOut, oldArabic, onlyRefused, neverMarked] = [await conversation(), await conversation(), await conversation(), await conversation()];
    const left = new Date('2026-09-01T10:00:00Z');
    const later = new Date('2026-09-01T11:00:00Z');
    let seq = 1000;
    const row = (cid: string, body: string, status: string, at: Date | null) => sql`
      insert into outbound_messages (business_id, conversation_id, seq, body, to_wa_id, status, sent_at)
      values (${BIZ}::uuid, ${cid}::uuid, ${seq++}, ${body}, 'x', ${status}, ${at})`.execute(admin);
    for (const cid of [wentOut, oldArabic, onlyRefused]) {
      await sql`update conversations set ai_disclosed_at = ${left}, ai_disclosure_delivered_at = null where id = ${cid}::uuid`.execute(admin);
    }
    await row(wentOut, 'Which colour?', 'sent', new Date('2026-09-01T09:00:00Z'));   // earlier, without it: not the one
    await row(wentOut, told, 'delivered', left);
    await row(wentOut, told, 'sent', later);
    await row(oldArabic, 'مرحبًا، أنا ليلى، المساعد الذكي لدى متجر الورد. إذا أردت التحدث مع شخص من فريقنا فأخبرني، وسيرد عليك في أقرب وقت.', 'read', left);
    await row(onlyRefused, told, 'canceled', null);
    await row(neverMarked, told, 'sent', left);   // never marked as told (ai_disclosed_at null): left alone

    await sql.raw(scoped).execute(admin);

    expect(await deliveredAt(wentOut)).toEqual(left);
    expect(await deliveredAt(oldArabic)).toEqual(left);
    expect(await deliveredAt(onlyRefused)).toBeNull();
    expect(await deliveredAt(neverMarked)).toBeNull();
  });
});
