import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { sql } from 'kysely';
import { createDb, withTenantTx, type Db, type Tx } from '../../src/db/client.js';
import type { BusinessId } from '../../src/core/types/ids.js';
import { decimal } from '../../src/core/types/decimal.js';
import { COUNTRY_PACKS } from '../../src/core/books/countryPacks.js';
import { loadCountryPack } from '../../src/db/booksCountry.js';
import { draftInvoice, issueInvoice } from '../../src/db/booksInvoices.js';
import { bindStripe, reservePayment, saveStripeMapping } from '../../src/db/stripePayments.js';
import { postCapturedPayment } from '../../src/db/stripePosting.js';
import { ensureConversation } from '../../src/db/channels.js';

const d = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;
const day = (s: string) => Math.floor(new Date(s + 'T12:00:00Z').getTime() / 1000);
d('payment links · references stay inside the workspace and their subject', () => {
  let db: Db, admin: pg.Client;
  const businesses: string[] = [];
  beforeAll(async () => { admin = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] }); await admin.connect(); db = createDb(process.env['DATABASE_URL']!); });
  // The isolated runner owns these rows, including the erasure ledger.
  afterAll(async () => { await db?.destroy(); await admin?.end(); });
  async function fixture(options: { currency?: 'GBP' | 'USD'; capture?: boolean } = {}) {
    const currency = options.currency ?? 'GBP';
    const bid = randomUUID() as BusinessId; businesses.push(bid);
    await admin.query("insert into businesses(id,name,engine,country,currency,books_area,timezone) values($1,'Reversal fixture','service','GB','GBP',true,'UTC')", [bid]);
    const tx = <T>(f: (t: Tx) => Promise<T>) => withTenantTx(db, bid, f);
    return tx(async t => {
      expect((await sql<{ role: string; scope: string }>`select current_user as role,current_business_id()::text as scope`.execute(t)).rows[0]).toEqual({ role: 'nomi_app', scope: bid });
      await loadCountryPack(t, bid, COUNTRY_PACKS.GB, '2026-01-01');
      await sql`insert into fiscal_years(business_id,starts_on,ends_on) values(${bid}::uuid,'2026-01-01','2026-12-31')`.execute(t);
      if (currency === 'USD') await sql`insert into owner_rates(business_id,from_currency,to_currency,rate,stated_at) values(${bid}::uuid,'USD','GBP',0.8,'2026-10-01T00:00:00Z')`.execute(t);
      const ids = Object.fromEntries((await sql<{ id: string; code: string }>`select id::text,code from accounts union all select id::text,code from journals`.execute(t)).rows.map(r => [r.code, r.id]));
      const party = (await sql<{ id: string }>`insert into parties(business_id,code,name,kind) values(${bid}::uuid,'C1','Buyer','customer') returning id::text`.execute(t)).rows[0]!.id;
      const inv = await draftInvoice(t, bid, 'owner', { partyId: party, issueDate: '2026-10-01', dueDate: null, currency, label: null, lines: [{ label: 'Goods', quantity: decimal('1'), unitPrice: decimal('100'), accountId: ids['4000']!, taxCodeId: null }] });
      if (inv.kind !== 'drafted') throw new Error(inv.reason);
      expect((await issueInvoice(t, bid, inv.id, 'owner')).kind).toBe('issued');
      const c = await bindStripe(t, bid, { id: `acct_${bid.replaceAll('-', '')}`, country: 'GB', currency, ready: true }, false, 'owner'); if (!c.ok) throw new Error(c.reason);
      expect((await saveStripeMapping(t, bid, c.value, { clearingId: ids['1030']!, transitId: ids['1040']!, feeId: ids['5020']!, bankId: ids['1000']!, journalId: ids['GJ']! }, 'owner')).ok).toBe(true);
      const a = await reservePayment(t, bid, inv.id, false, new Date('2026-10-01T12:00:00Z')); if (!a.ok) throw new Error(a.reason);
      const capture = { id: 'pi_one', attemptId: a.value.id, succeeded: true, charge: { id: 'ch_one', amount: decimal('100'), currency, created: day('2026-10-01'), paid: true, captured: true, balance: { id: 'txn_one', gross: decimal('100'), fee: decimal('3'), net: decimal('97'), currency, created: day('2026-10-01') } } };
      if (options.capture !== false) expect(await postCapturedPayment(t, bid, a.value.id, capture)).toEqual({ state: 'posted' });
      return { bid, tx, ids, party, currency, capture, attempt: a.value.id, invoice: inv.id, connection: c.value };
    });
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function customer(f: Fixture) {
    return f.tx(async t => {
      expect((await sql<{ role: string; scope: string }>`select current_user as role,current_business_id()::text as scope`.execute(t)).rows[0]).toEqual({ role: 'nomi_app', scope: f.bid });
      const c = await ensureConversation(t, f.bid, randomUUID() + '@example.test', 'Reference fixture', 'email');
      const outbound = (await sql<{ id: string }>`insert into outbound_messages(business_id,conversation_id,seq,body,channel) values(${f.bid}::uuid,${c.conversationId}::uuid,1,'Invoice link','email') returning id::text`.execute(t)).rows[0]!.id;
      return { ...c, outbound };
    });
  }
  const send = (f: Fixture, conversation: string | null, outbound: string | null) => f.tx(async t =>
    (await sql<{ id: string }>`insert into stripe_link_sends(business_id,attempt_id,conversation_id,outbound_id,sent_by) values(${f.bid}::uuid,${f.attempt}::uuid,${conversation}::uuid,${outbound}::uuid,'owner') returning id::text`.execute(t)).rows[0]!.id);
  const movement = (f: Fixture, connection = f.connection, reverses: string | null = null) => f.tx(async t =>
    (await sql<{ id: string }>`insert into stripe_movements(business_id,connection_id,attempt_id,kind,provider_id,amount,currency,event_date,reverses_id) values(${f.bid}::uuid,${connection}::uuid,${f.attempt}::uuid,${reverses ? 'refund_reversal' : 'refund'},${randomUUID()},1,'GBP','2026-10-02',${reverses}::uuid) returning id::text`.execute(t)).rows[0]!.id);

  it('refuses a foreign conversation on insert and update as the scoped application role', async () => {
    const a = await fixture({ capture: false }), b = await fixture({ capture: false });
    const own = await customer(a), foreign = await customer(b);
    await expect(send(a, foreign.conversationId, null)).rejects.toMatchObject({ code: '23503', message: 'payment link: conversation belongs to another workspace' });
    const id = await send(a, own.conversationId, null);
    await expect(a.tx(t => sql`update stripe_link_sends set conversation_id=${foreign.conversationId}::uuid where id=${id}::uuid`.execute(t))).rejects.toMatchObject({ code: '23503' });
  });
  it('refuses a foreign outbound as the scoped application role', async () => {
    const a = await fixture({ capture: false }), b = await fixture({ capture: false });
    const own = await customer(a), foreign = await customer(b);
    await expect(send(a, own.conversationId, foreign.outbound)).rejects.toMatchObject({ code: '23503', message: 'payment link: outbound belongs to another workspace' });
  });
  it('refuses an outbound from a different conversation in the same workspace', async () => {
    const a = await fixture({ capture: false }), own = await customer(a), other = await customer(a);
    await expect(send(a, own.conversationId, other.outbound)).rejects.toMatchObject({ code: '23503', message: 'payment link: outbound belongs to another conversation' });
    await expect(send(a, null, own.outbound)).rejects.toMatchObject({ code: '23503', message: 'payment link: outbound belongs to another conversation' });
  });
  it('refuses a foreign reversed movement as the scoped application role', async () => {
    const a = await fixture({ capture: false }), b = await fixture({ capture: false });
    await expect(movement(a, a.connection, await movement(b))).rejects.toMatchObject({ code: '23503', message: 'payment link: reversed movement belongs to another workspace' });
  });
  it('refuses a reversed movement from another connection in the same workspace', async () => {
    const a = await fixture({ capture: false }), original = await movement(a);
    const other = (await a.tx(t => sql<{ id: string }>`insert into stripe_connections(business_id,account,live,country,currency,ready,active,connected_by) values(${a.bid}::uuid,${'acct_' + randomUUID().replaceAll('-', '')},false,'GB','GBP',true,false,'owner') returning id::text`.execute(t))).rows[0]!.id;
    await expect(movement(a, other, original)).rejects.toMatchObject({ code: '23503', message: 'payment link: reversed movement belongs to another connection' });
  });
  it('keeps a valid send and same-connection reversal, then detaches both references during customer erasure', async () => {
    const a = await fixture({ capture: false }), own = await customer(a);
    const id = await send(a, own.conversationId, own.outbound);
    expect(await movement(a, a.connection, await movement(a))).toEqual(expect.any(String));
    await a.tx(async t => {
      const request = (await sql<{ id: string }>`insert into deletion_requests(business_id,scope,client_id,asked_by) values(${a.bid}::uuid,'buyer',${own.clientId}::uuid,'owner') returning id::text`.execute(t)).rows[0]!.id;
      await sql`select erase_customer(${request}::uuid,'owner')`.execute(t);
      expect((await sql`select conversation_id,outbound_id from stripe_link_sends where id=${id}::uuid`.execute(t)).rows).toEqual([{ conversation_id: null, outbound_id: null }]);
      expect((await sql`select id from outbound_messages where id=${own.outbound}::uuid`.execute(t)).rows).toEqual([]);
    });
  });
  it('preserves the foreign keys deletion detach when a conversation or an outbound is removed', async () => {
    const a = await fixture({ capture: false }), first = await customer(a), second = await customer(a);
    const one = await send(a, first.conversationId, first.outbound), two = await send(a, second.conversationId, second.outbound);
    await admin.query('delete from outbound_messages where id=$1', [first.outbound]);
    expect((await a.tx(t => sql`select conversation_id,outbound_id from stripe_link_sends where id=${one}::uuid`.execute(t))).rows).toEqual([{ conversation_id: first.conversationId, outbound_id: null }]);
    await admin.query('delete from conversations where id=$1', [second.conversationId]);
    expect((await a.tx(t => sql`select conversation_id,outbound_id from stripe_link_sends where id=${two}::uuid`.execute(t))).rows).toEqual([{ conversation_id: null, outbound_id: null }]);
  });
});
