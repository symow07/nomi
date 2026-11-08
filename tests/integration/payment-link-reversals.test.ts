import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { sql } from 'kysely';
import { createDb, withTenantTx, type Db, type Tx } from '../../src/db/client.js';
import type { BusinessId } from '../../src/core/types/ids.js';
import { decimal } from '../../src/core/types/decimal.js';
import { COUNTRY_PACKS } from '../../src/core/books/countryPacks.js';
import { loadCountryPack } from '../../src/db/booksCountry.js';
import { draftInvoice, issueInvoice, recordPayment } from '../../src/db/booksInvoices.js';
import { draftEntry } from '../../src/db/booksEntries.js';
import { draftCreditNote, issueCreditNote } from '../../src/db/booksCreditNotes.js';
import { lockTo, reopenTo } from '../../src/db/booksClose.js';
import { trialBalanceOf } from '../../src/db/booksReports.js';
import { bindStripe, reservePayment, saveStripeMapping } from '../../src/db/stripePayments.js';
import { postCapturedPayment, postStripeRefund, recordStripePayout, confirmStripePayout } from '../../src/db/stripePosting.js';
import { purgeBusinesses } from './books-db.js';

const d = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;
const day = (s: string) => Math.floor(new Date(s + 'T12:00:00Z').getTime() / 1000);
d('payment links · immutable failure reversals', () => {
  let db: Db, admin: pg.Client;
  const businesses: string[] = [];
  beforeAll(async () => { admin = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] }); await admin.connect(); db = createDb(process.env['DATABASE_URL']!); });
  afterAll(async () => { await db?.destroy(); if (admin) { await purgeBusinesses(admin, businesses, 'payment-reversals-test'); await admin.end(); } });
  async function fixture(options: { currency?: 'GBP' | 'USD'; capture?: boolean } = {}) {
    const currency = options.currency ?? 'GBP';
    const bid = randomUUID() as BusinessId; businesses.push(bid);
    await admin.query("insert into businesses(id,name,engine,country,currency,books_area,timezone) values($1,'Reversal fixture','service','GB','GBP',true,'UTC')", [bid]);
    const tx = <T>(f: (t: Tx) => Promise<T>) => withTenantTx(db, bid, f);
    return tx(async t => {
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
  async function refund(f: Fixture, amount: '25' | '100' = '25') {
    const fact = { id: 're_one', intentId: 'pi_one', status: 'succeeded' as const, amount: decimal(amount), currency: f.currency, created: day('2026-10-02'), balance: null };
    await f.tx(async t => {
      const c = await draftCreditNote(t, f.bid, 'owner', { invoiceId: f.invoice, issueDate: '2026-10-02', reason: 'Returned', lines: [{ invoiceLineNo: 1, quantity: decimal(amount === '25' ? '0.25' : '1') }] });
      if (c.kind !== 'drafted') throw new Error(c.reason); expect((await issueCreditNote(t, f.bid, c.id, 'owner')).kind).toBe('issued');
      expect(await postStripeRefund(t, f.bid, f.connection, fact)).toEqual({ state: 'posted' });
    });
    return fact;
  }
  const balance = async (f: Fixture) => f.tx(async t => {
    const b = await trialBalanceOf(t, f.bid, { from: '2026-01-01', to: '2026-12-31' }); expect(b.balanced).toBe(true); expect(b.totals.period.debit).toBe(b.totals.period.credit);
    return b;
  });
  it.each(['25', '100'] as const)('reverses a failed %s refund once, on the return date, retaining the fee and customer credit', async amount => {
    const f = await fixture(), r = await refund(f, amount);
    const failed = { ...r, status: 'failed' as const, failureBalance: { id: 'txn_refundreturn', amount: decimal(amount), currency: 'GBP', created: day('2026-10-05') } };
    expect(await f.tx(t => postStripeRefund(t, f.bid, f.connection, failed))).toEqual({ state: 'posted' });
    expect(await f.tx(t => postStripeRefund(t, f.bid, f.connection, failed))).toEqual({ state: 'posted' });
    const rows = await f.tx(t => sql<{ date: string; kind: string; amount: string }>`select paid_on::text as date,kind,amount::text from invoice_payments where invoice_id=${f.invoice}::uuid order by created_at`.execute(t));
    expect(rows.rows.filter(r => r.kind === 'refund_reversal')).toEqual([{ date: '2026-10-05', kind: 'refund_reversal', amount: amount + '.00' }]);
    expect((await f.tx(t => sql<{ paid: string }>`select invoice_paid(${f.invoice}::uuid)::text as paid`.execute(t))).rows[0]!.paid).toBe('100.00');
    const b = await balance(f); expect(b.rows.find(r => r.code === '1030')!.closing).toEqual({ debit: '97', credit: '0' });
    expect(b.rows.find(r => r.code === '1100')!.closing).toEqual({ debit: '0', credit: amount });
    expect(b.rows.find(r => r.code === '5020')!.closing).toEqual({ debit: '3', credit: '0' });
  });
  it('keeps a closed refund failure date outstanding, then posts only after an explicit owner reopening', async () => {
    const f = await fixture(), r = await refund(f);
    expect(await f.tx(t => lockTo(t, f.bid, '2026-10-05', 'owner'))).toMatchObject({ kind: 'done' });
    const failed = { ...r, status: 'failed' as const, failureBalance: { id: 'txn_closedreturn', amount: decimal('25'), currency: 'GBP', created: day('2026-10-05') } };
    expect(await f.tx(t => postStripeRefund(t, f.bid, f.connection, failed))).toMatchObject({ state: 'exception', reason: 'period' });
    const y = (await f.tx(t => sql<{ id: string; lock: string }>`select id::text,lock_date::text as lock from fiscal_years`.execute(t))).rows[0]!;
    expect(y.lock).toBe('2026-10-05'); await balance(f);
    expect(await f.tx(t => reopenTo(t, f.bid, y.id, null, 'owner', 'Review the failed refund'))).toMatchObject({ kind: 'done' });
    expect(await f.tx(t => postStripeRefund(t, f.bid, f.connection, failed))).toEqual({ state: 'posted' }); await balance(f);
  });
  it.each(['failed', 'canceled'] as const)('reverses a %s payout once on its failure date, preserving a closed period', async status => {
    const f = await fixture();
    const p = { id: 'po_one', amount: decimal('97'), currency: 'GBP', created: day('2026-10-02'), arrival: day('2026-10-03'), status: 'paid' as const, balance: null, destination: 'ba_original' };
    await f.tx(t => recordStripePayout(t, f.bid, f.connection, p));
    expect(await f.tx(t => confirmStripePayout(t, f.bid, f.connection, p.id, decimal('97'), 'owner'))).toEqual({ state: 'posted' });
    expect(await f.tx(t => lockTo(t, f.bid, '2026-10-05', 'owner'))).toMatchObject({ kind: 'done' });
    const failed = { ...p, status, failureBalance: { id: 'txn_payoutreturn', amount: decimal('97'), currency: 'GBP', created: day('2026-10-05') } };
    expect(await f.tx(t => recordStripePayout(t, f.bid, f.connection, failed))).toMatchObject({ state: 'exception', reason: 'period' });
    const y = (await f.tx(t => sql<{ id: string; lock: string }>`select id::text,lock_date::text as lock from fiscal_years`.execute(t))).rows[0]!;
    expect(y.lock).toBe('2026-10-05'); await balance(f);
    await f.tx(t => reopenTo(t, f.bid, y.id, null, 'owner', 'Review failed payout'));
    expect(await f.tx(t => recordStripePayout(t, f.bid, f.connection, failed))).toEqual({ state: 'posted' });
    expect(await f.tx(t => recordStripePayout(t, f.bid, f.connection, failed))).toEqual({ state: 'posted' });
    const rows = (await f.tx(t => sql<{ date: string }>`select e.entry_date::text as date from stripe_payouts p join journal_entries e on e.id=p.reversal_id`.execute(t))).rows;
    expect(rows).toEqual([{ date: '2026-10-05' }]);
    const b = await balance(f); expect(b.totals.period).toEqual({ debit: '397', credit: '397' });
    expect(b.rows.find(r => r.code === '1040')!.closing).toEqual({ debit: '0', credit: '0' });
  });
  it('holds a payout to a changed bank destination without remapping the owner bank', async () => {
    const f = await fixture();
    const p = { id: 'po_one', amount: decimal('40'), currency: 'GBP', created: day('2026-10-02'), arrival: day('2026-10-03'), status: 'paid' as const, balance: null, destination: 'ba_original' };
    await f.tx(t => recordStripePayout(t, f.bid, f.connection, p));
    expect(await f.tx(t => confirmStripePayout(t, f.bid, f.connection, p.id, decimal('40'), 'owner'))).toEqual({ state: 'posted' });
    await f.tx(t => recordStripePayout(t, f.bid, f.connection, { ...p, id: 'po_changed', destination: 'ba_changed' }));
    expect(await f.tx(t => confirmStripePayout(t, f.bid, f.connection, 'po_changed', decimal('40'), 'owner'))).toMatchObject({ state: 'exception', reason: 'destination_changed' });
    expect((await f.tx(t => sql<{ bank: string }>`select bank_id::text as bank from stripe_mappings`.execute(t))).rows[0]!.bank).toBe(f.ids['1000']); await balance(f);
  });
  it('restores exact foreign receivable relief across partial returns, replay and a concurrent payment', async () => {
    const f = await fixture({ currency: 'USD' });
    await f.tx(t => sql`insert into owner_rates(business_id,from_currency,to_currency,rate,stated_at) values(${f.bid}::uuid,'USD','GBP',0.8137,'2026-10-02T00:00:00Z'),(${f.bid}::uuid,'USD','GBP',0.9,'2026-10-05T00:00:00Z')`.execute(t));
    const r = await refund(f, '100');
    const returned = (id: string, amount: string) => ({ ...r, status: 'failed' as const, failureBalance: { id, amount: decimal(amount), currency: 'USD', created: day('2026-10-05') } });
    expect(await f.tx(t => postStripeRefund(t,f.bid,f.connection,returned('txn_partial','33.33')))).toEqual({ state:'posted' });
    expect(await f.tx(t => postStripeRefund(t,f.bid,f.connection,returned('txn_partial','33.33')))).toEqual({ state:'posted' });
    await balance(f);
    const [last,payment] = await Promise.all([
      f.tx(t => postStripeRefund(t,f.bid,f.connection,returned('txn_rest','66.67'))),
      f.tx(t => recordPayment(t,f.bid,f.invoice,'owner',{ paidOn:'2026-10-05',amount:decimal('1'),accountId:f.ids['1000']!,journalId:f.ids['GJ']! })),
    ]);
    expect(last).toEqual({ state:'posted' }); expect(payment).toMatchObject({ kind:'refused',reason:'too_much' });
    expect(await f.tx(t => postStripeRefund(t,f.bid,f.connection,returned('txn_excess','0.01')))).toMatchObject({state:'exception',reason:'too_much'});
    const relief = (await f.tx(t => sql<{ amount:string; relief:string }>`select amount::text,receivable_book::text as relief from invoice_payments where kind='refund_reversal' order by amount`.execute(t))).rows;
    expect(relief).toEqual([{amount:'33.33',relief:'27.12'},{amount:'66.67',relief:'54.25'}]);
    const b = await balance(f); expect(b.rows.find(r=>r.code==='1100')!.closing).toEqual({debit:'0',credit:'81.37'});
  });
  it('serializes competing returns against the original refund ceiling', async () => {
    const f=await fixture(), r=await refund(f);
    const results=await Promise.all(['a','b'].map(id=>f.tx(t=>postStripeRefund(t,f.bid,f.connection,{...r,status:'failed',failureBalance:{id:'txn_'+id,amount:decimal('20'),currency:'GBP',created:day('2026-10-05')}}))));
    expect(results.map(r=>r.state).sort()).toEqual(['exception','posted']);
    expect(results.find(r=>r.state==='exception')?.reason).toBe('too_much'); await balance(f);
  });
  it('keeps existing database guards for overpayment, refund excess, foreign tenant, unposted entry, duplicate, currency, draft and immutability', async () => {
    const f=await fixture(), other=await fixture();
    const entry=(await f.tx(t=>sql<{id:string;entry:string}>`select id::text,entry_id::text as entry from invoice_payments where kind='in'`.execute(t))).rows[0]!;
    const invoice=await f.tx(async t=>{
      const d=await draftInvoice(t,f.bid,'owner',{partyId:f.party,issueDate:'2026-10-02',dueDate:null,currency:'GBP',label:null,lines:[{label:'Second',quantity:decimal('1'),unitPrice:decimal('100'),accountId:f.ids['4000']!,taxCodeId:null}]});
      if(d.kind!=='drafted')throw new Error(d.reason);expect((await issueInvoice(t,f.bid,d.id,'owner')).kind).toBe('issued');return d.id;
    });
    const insert=(o:{invoice?:string;bid?:string;entry?:string;id?:string;kind?:string;currency?:string}={})=>f.tx(t=>sql`insert into invoice_payments(id,business_id,invoice_id,paid_on,currency,amount,receivable_book,account_id,entry_id,created_by,kind)
      values(${o.id??randomUUID()}::uuid,${o.bid??f.bid}::uuid,${o.invoice??invoice}::uuid,'2026-10-05',${o.currency??'GBP'},1,1,${f.ids['1000']}::uuid,${o.entry??entry.entry}::uuid,'owner',${o.kind??'in'})`.execute(t));
    await expect(insert({invoice:f.invoice})).rejects.toThrow(/more than is still owed/);
    await expect(insert({kind:'refund'})).rejects.toThrow(/more than the customer is owed back/);
    await expect(insert({bid:other.bid})).rejects.toThrow(/row-level security|foreign key/);
    await expect(insert({currency:'USD'})).rejects.toThrow(/invoice's currency/);
    await expect(insert({id:entry.id})).rejects.toThrow(/duplicate key/);
    const draft=await f.tx(t=>draftEntry(t,f.bid,'owner',{journalId:f.ids['GJ']!,date:'2026-10-05',label:'Draft',documentRef:'draft',documentDate:'2026-10-05',lines:[]}));
    if(draft.kind==='refused')throw new Error(draft.reason);
    await expect(insert({entry:draft.id})).rejects.toThrow(/posted entry/);
    const draftInv=(await f.tx(t=>sql<{id:string}>`insert into invoices(business_id,party_id,issue_date,currency,created_by) values(${f.bid}::uuid,${f.party}::uuid,'2026-10-05','GBP','owner') returning id::text`.execute(t))).rows[0]!.id;
    await expect(insert({invoice:draftInv})).rejects.toThrow(/only an issued invoice/);
    await expect(f.tx(t=>sql`update invoice_payments set amount=2 where id=${entry.id}::uuid`.execute(t))).rejects.toThrow(/permission denied|never changes/);
    await balance(f);await balance(other);
  });
  it('leaves a missing fiscal year outstanding and recovers on its original date after the owner opens that year', async () => {
    const f=await fixture({capture:false});
    const fact={...f.capture,charge:{...f.capture.charge,created:day('2027-01-02'),balance:{...f.capture.charge.balance,created:day('2027-01-02')}}};
    expect(await f.tx(t=>postCapturedPayment(t,f.bid,f.attempt,fact))).toMatchObject({state:'exception',reason:'no_fiscal_year'});await balance(f);
    await f.tx(t=>sql`insert into fiscal_years(business_id,starts_on,ends_on) values(${f.bid}::uuid,'2027-01-01','2027-12-31')`.execute(t));
    expect(await f.tx(t=>postCapturedPayment(t,f.bid,f.attempt,fact))).toEqual({state:'posted'});
    const b=await f.tx(t=>trialBalanceOf(t,f.bid,{from:'2026-01-01',to:'2027-12-31'}));expect(b.balanced).toBe(true);expect(b.totals.period.debit).toBe(b.totals.period.credit);
    const dates=(await f.tx(t=>sql<{date:string}>`select e.entry_date::text as date from stripe_movements m join journal_entries e on e.id=m.entry_id`.execute(t))).rows;expect(dates.map(r=>r.date)).toEqual(['2027-01-02','2027-01-02']);
  });
  it('leaves a missing owner rate outstanding and recovers without inventing one', async () => {
    const f=await fixture({currency:'USD',capture:false});
    const fact={...f.capture,charge:{...f.capture.charge,created:day('2026-09-30'),balance:{...f.capture.charge.balance,created:day('2026-09-30')}}};
    expect(await f.tx(t=>postCapturedPayment(t,f.bid,f.attempt,fact))).toMatchObject({state:'exception',reason:'no_rate'});await balance(f);
    await f.tx(t=>sql`insert into owner_rates(business_id,from_currency,to_currency,rate,stated_at) values(${f.bid}::uuid,'USD','GBP',0.81,'2026-09-30T00:00:00Z')`.execute(t));
    expect(await f.tx(t=>postCapturedPayment(t,f.bid,f.attempt,fact))).toEqual({state:'posted'});await balance(f);
  });
  it('keeps a retired mapped account outstanding until the owner restores it', async () => {
    const f=await fixture({capture:false});
    await f.tx(t=>sql`update accounts set is_active=false where id=${f.ids['1030']}::uuid`.execute(t));
    expect(await f.tx(t=>postCapturedPayment(t,f.bid,f.attempt,f.capture))).toMatchObject({state:'exception'});await balance(f);
    expect((await f.tx(t=>sql`select 1 from invoice_payments`.execute(t))).rows).toHaveLength(0);
    await f.tx(t=>sql`update accounts set is_active=true where id=${f.ids['1030']}::uuid`.execute(t));
    expect(await f.tx(t=>postCapturedPayment(t,f.bid,f.attempt,f.capture))).toEqual({state:'posted'});await balance(f);
  });

});
