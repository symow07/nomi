import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createDb, withTenantTx, type Db } from '../../src/db/client.js';
import { parseBusinessId } from '../../src/core/types/ids.js';
import { enqueueOutboundRow } from '../../src/db/channels.js';

/**
 * 5.4 — the one writer of outbound rows gained a trailing `comment` parameter (G20: the owner's private reply to a
 * comment goes through it). Default null: every existing caller must write exactly the row it wrote before — the
 * conversation's own identity, its own channel, kind text or the media's kind. A comment reply goes to the
 * commenter's identity on Instagram as `comment_private_reply`, and never carries media.
 */
const suite = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;
suite('5.4 · the one outbound writer, with and without a comment', { timeout: 60_000 }, () => {
  let admin: pg.Client, db: Db;
  const business = randomUUID(), client = randomUUID(), ig = randomUUID(), wa = randomUUID();
  const parsed = parseBusinessId(business); if (!parsed.ok) throw new Error('fixture'); const bid = parsed.value;
  const COLUMNS = 'business_id, conversation_id, body, origin, to_wa_id, channel, subject, asks, notice, approved, kind, media_url, quote_id, status';
  const row = async (id: string | null) => (await admin.query(`select ${COLUMNS} from outbound_messages where id = $1`, [id])).rows[0];
  const count = async () => Number((await admin.query('select count(*) from outbound_messages where business_id = $1', [business])).rows[0].count);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] }); await admin.connect();
    db = createDb(process.env['DATABASE_URL']!);
    await admin.query("insert into businesses (id, name) values ($1, 'Outbound writer fixture')", [business]);
    await admin.query('insert into clients (id, business_id) values ($1, $2)', [client, business]);
    await admin.query("insert into client_channels (client_id, channel, channel_user_id) values ($1, 'instagram', 'igsid-conv'), ($1, 'whatsapp', '15550000001')", [client]);
    await admin.query("insert into conversations (id, business_id, client_id, channel) values ($1, $3, $4, 'instagram'), ($2, $3, $4, 'whatsapp')", [ig, wa, business, client]);
  });
  afterAll(async () => { await db?.destroy(); await admin?.end(); });

  for (const [name, conversation, identity, channel] of [['instagram', () => ig, 'igsid-conv', 'instagram'], ['whatsapp', () => wa, '15550000001', 'whatsapp']] as const) {
    it(`comment = null writes the row it wrote before (${name})`, async () => {
      const before = await withTenantTx(db, bid, (tx) => enqueueOutboundRow(tx, bid, conversation(), 'Same words', 'owner', null, null, null, true, null, false, null));
      const after = await withTenantTx(db, bid, (tx) => enqueueOutboundRow(tx, bid, conversation(), 'Same words', 'owner', null, null, null, true, null, false, null, null));
      expect(await row(after)).toEqual(await row(before));
      expect(await row(after)).toMatchObject({ to_wa_id: identity, channel, kind: 'text', approved: true, origin: 'owner' });
      const picture = await withTenantTx(db, bid, (tx) => enqueueOutboundRow(tx, bid, conversation(), 'Caption', 'owner', null, null, null, true,
        { url: 'https://app.example/assets/x.png' }, false, null, null));
      expect(await row(picture)).toMatchObject({ to_wa_id: identity, channel, kind: 'image' });
    });
  }

  it('a comment reply goes to the commenter, on Instagram, as comment_private_reply', async () => {
    const id = await withTenantTx(db, bid, (tx) => enqueueOutboundRow(tx, bid, ig, 'Hi, thanks for your comment.', 'owner', null, null, null, true, null, false, null, { recipient: 'igsid-commenter' }));
    expect(await row(id)).toMatchObject({ to_wa_id: 'igsid-commenter', channel: 'instagram', kind: 'comment_private_reply', approved: true, origin: 'owner', media_url: null });
  });

  it('a comment reply with media throws, and nothing is written', async () => {
    const n = await count();
    await expect(withTenantTx(db, bid, (tx) => enqueueOutboundRow(tx, bid, ig, 'Look', 'owner', null, null, null, true,
      { url: 'https://app.example/assets/x.png' }, false, null, { recipient: 'igsid-commenter' }))).rejects.toThrow(/carries no media/);
    expect(await count()).toBe(n);
  });
});
