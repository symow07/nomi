import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * 0136 — the reopening template carries only what a person approved. The mark
 * is written when the row is queued and read back by the send path's store:
 * a person's kick (a draft sent, an order confirmed) says approved; the turn's
 * own sends do not.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const BIZ = `dd8f0000-0000-4000-8000-${RUN}0001`;

type Db = import('../../src/db/client.js').Db;

d('0136 · approved sends, written and read back (requires DATABASE_URL)', () => {
  let db: Db;
  let conv = '';
  const tx = async <R>(fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, BIZ as never, fn);
  };

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    db = createDb(DATABASE_URL!);
    await tx((x) => sql`insert into businesses (id, name) values (${BIZ}, 'Approved Sends') on conflict (id) do nothing`.execute(x));
    conv = (await tx((x) => ensureConversation(x, BIZ as never, `9717${RUN.replace(/\D/g, '1').slice(0, 7)}`, 'Buyer', 'whatsapp'))).conversationId;
  });
  afterAll(async () => { await db?.destroy(); });

  it('a person\'s row is marked approved, the turn\'s is not, and the send path reads both', async () => {
    const { enqueueOutboundRow, channelStore } = await import('../../src/db/channels.js');
    const { lockConversation } = await import('../../src/db/client.js');
    const ids = await tx(async (x) => {
      await lockConversation(x, conv);
      const alone = await enqueueOutboundRow(x, BIZ as never, conv, 'Sent alone by the assistant.', 'employee');
      const approved = await enqueueOutboundRow(x, BIZ as never, conv, 'A draft the owner approved.', 'employee', null, null, null, true);
      return { alone, approved };
    });
    const { rows } = await tx((x) => channelStore(x, BIZ as never).load(conv));
    expect(rows.find((r) => r.id === ids.alone)?.approved).toBeUndefined();
    expect(rows.find((r) => r.id === ids.approved)?.approved).toBe(true);
  });

  it('every kick of the outbound queue is a person\'s act, and says so', () => {
    const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
    const kick = main.slice(main.indexOf('kickOutbound: async'), main.indexOf('kickDrive: async'));
    expect(kick).toContain('approved: true');
    // …and the turn's own send does not.
    const worker = readFileSync(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    const turnSend = worker.slice(worker.indexOf('if (effects.outbound) {'), worker.indexOf("}, { singletonKey: input.messageId });"));
    expect(turnSend).not.toContain('approved');
  });
});
