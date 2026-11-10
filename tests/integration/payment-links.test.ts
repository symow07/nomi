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
import { lockTo, reopenTo } from '../../src/db/booksClose.js';
import { paymentAccounts, importStatement } from '../../src/db/bankStatements.js';
import { purgeBusinesses } from './books-db.js';
import { bindStripe, saveStripeMapping, reservePayment, keepCheckout, newStripeState, claimStripeState, storeStripeEvent } from '../../src/db/stripePayments.js';
import { postCapturedPayment, recordStripePayout, confirmStripePayout, receiveStripePayout, postStripeRefund, payoutLabel, feeLabel } from '../../src/db/stripePosting.js';
import type { IntentFact } from '../../src/core/payments/paymentLink.js';
import { createPaymentLink, expirePaymentLink, reconcileStripePayments } from '../../src/payments/invoicePayments.js';
import { paymentProvider } from '../fixtures/paymentProvider.js';

const d = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;
const BIZ = randomUUID() as BusinessId, OTHER = randomUUID() as BusinessId;
const now = new Date('2026-10-10T12:00:00Z');
const intent = (id: string, amount = '100', fee: string | null = '3'): IntentFact => ({ id: `pi_${id}`, attemptId: null, succeeded: true, charge: {
  id: `ch_${id}`, amount: decimal(amount), currency: 'GBP', created: Math.floor(now.getTime() / 1000), paid: true, captured: true,
  balance: fee === null ? null : { id: `txn_${id}`, gross: decimal(amount), fee: decimal(fee), net: decimal(amount === '100' ? '97' : '22'), currency: 'GBP', created: Math.floor(now.getTime() / 1000) },
} });

d('invoice payment links · tenant records and real ledger', { timeout: 120_000 }, () => {
  let db: Db, admin: pg.Client, connection: string, mapping: string;
  let accounts: Record<string, string>, journals: Record<string, string>, party: string;
  const as = <T>(fn: (tx: Tx) => Promise<T>, bid = BIZ) => withTenantTx(db, bid, fn);
  const invoice = async (amount = '100') => as(async tx => {
    const draft = await draftInvoice(tx, BIZ, 'owner', { partyId: party, issueDate: '2026-10-10', dueDate: null, currency: 'GBP', label: null,
      lines: [{ label: 'Goods', quantity: decimal('1'), unitPrice: decimal(amount), accountId: accounts['4000']!, taxCodeId: null }] });
    if (draft.kind !== 'drafted') throw new Error(JSON.stringify(draft));
    expect((await issueInvoice(tx, BIZ, draft.id, 'owner')).kind).toBe('issued');
    return draft.id;
  });
  const reserve = async (invoiceId: string) => {
    const r = await as(tx => reservePayment(tx, BIZ, invoiceId, false, now));
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.value;
  };
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] }); await admin.connect();
    db = createDb(process.env['DATABASE_URL']!);
    for (const id of [BIZ, OTHER]) await admin.query("insert into businesses(id,name,engine,country,currency,books_area,timezone) values($1,'Payment fixture','service','GB','GBP',true,'Europe/London')", [id]);
    await as(async tx => {
      await loadCountryPack(tx, BIZ, COUNTRY_PACKS.GB, '2026-01-01');
      await sql`insert into fiscal_years(business_id,starts_on,ends_on) values(${BIZ}::uuid,'2026-01-01','2026-12-31')`.execute(tx);
      accounts = Object.fromEntries((await sql<{ id: string; code: string }>`select id::text,code from accounts`.execute(tx)).rows.map(r => [r.code, r.id]));
      journals = Object.fromEntries((await sql<{ id: string; code: string }>`select id::text,code from journals`.execute(tx)).rows.map(r => [r.code, r.id]));
      party = (await sql<{ id: string }>`insert into parties(business_id,code,name,kind) values(${BIZ}::uuid,'C001','Fixture customer','customer') returning id::text`.execute(tx)).rows[0]!.id;
      const b = await bindStripe(tx, BIZ, { id: `acct_${BIZ.replaceAll('-', '')}`, country: 'GB', currency: 'GBP', ready: true }, false, 'owner');
      if (!b.ok) throw new Error(JSON.stringify(b)); connection = b.value;
      const m = await saveStripeMapping(tx, BIZ, connection, { clearingId: accounts['1030']!, transitId: accounts['1040']!, feeId: accounts['5020']!, journalId: journals['GJ']!, bankId: accounts['1000']! }, 'owner');
      if (!m.ok) throw new Error(JSON.stringify(m)); mapping = m.value;
    });
  });
  afterAll(async () => { await db?.destroy(); if (admin) { await purgeBusinesses(admin, [BIZ, OTHER], 'payment-links-test'); await admin.end(); } });

  it('keeps clearing/transit out of manual payment choices and freezes a checked mapping', async () => {
    expect((await as(tx => paymentAccounts(tx, BIZ))).map(a => a.code)).not.toContain('1030');
    expect((await as(tx => paymentAccounts(tx, BIZ))).map(a => a.code)).not.toContain('1040');
    expect(await as(tx => saveStripeMapping(tx, BIZ, connection, { clearingId: accounts['1000']!, transitId: accounts['1040']!, feeId: accounts['5020']!, journalId: journals['GJ']!, bankId: accounts['1000']! }, 'owner'))).toMatchObject({ ok: false });
    expect(mapping).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('binds one account to one workspace and RLS hides every payment record from a different tenant', async () => {
    expect(await as(tx => bindStripe(tx, OTHER, { id: `acct_${BIZ.replaceAll('-', '')}`, country: 'GB', currency: 'GBP', ready: true }, false, 'owner'), OTHER)).toMatchObject({ ok: false, reason: 'account_in_use' });
    expect((await as(tx => sql`select * from stripe_connections`.execute(tx), OTHER)).rows).toEqual([]);
  });
  it('claims OAuth state only once, in its workspace and owner session, before exchanging a code', async () => {
    const state = await as(tx => newStripeState(tx, BIZ, 'owner', 'session-one', false, now));
    expect(await as(tx => claimStripeState(tx, BIZ, state, 'owner', 'session-two', false, now))).toBe(false);
    expect(await as(tx => claimStripeState(tx, BIZ, state, 'owner', 'session-one', false, now))).toBe(true);
    expect(await as(tx => claimStripeState(tx, BIZ, state, 'owner', 'session-one', false, now))).toBe(false);
  });
  it('reserves one stable attempt under simultaneous requests; a stale session cannot replace another amount', async () => {
    const id = await invoice();
    const [a, b] = await Promise.all([reserve(id), reserve(id)]);
    expect(a.id).toBe(b.id); expect(a.mappingId).toBe(mapping);
    expect(await as(tx => keepCheckout(tx, BIZ, a.id, { id: 'cs_test_concurrent', status: 'open', paid: false, amount: decimal('101'), currency: 'GBP', url: 'https://checkout.stripe.com/c/pay/x', intentId: null, expiresAt: 1800003600, attemptId: a.id }))).toBe(false);
  });
  it('posts capture and fee once, even after duplicate or reordered facts, with the invoice paid in full', async () => {
    const id = await invoice(), a = await reserve(id), fact = intent('paid');
    expect(await as(tx => postCapturedPayment(tx, BIZ, a.id, fact))).toMatchObject({ state: 'posted' });
    expect(await as(tx => postCapturedPayment(tx, BIZ, a.id, fact))).toMatchObject({ state: 'posted' });
    const rows = await as(tx => sql<{ n: number; amount: string }>`select count(*)::int as n,sum(amount)::text as amount from invoice_payments where invoice_id=${id}::uuid`.execute(tx));
    expect(rows.rows[0]).toEqual({ n: 1, amount: '100.00' });
    expect((await as(tx => sql`select * from stripe_movements where attempt_id=${a.id}::uuid and entry_id is not null`.execute(tx))).rows).toHaveLength(2);
    // The fee entry's label is words and a date (the entry page's heading); the balance transaction's id is its document reference.
    const fee = (await as(tx => sql<{ label: string; ref: string; date: string }>`select e.label, e.document_ref as ref, e.entry_date::text as date from journal_entries e
      join stripe_movements m on m.entry_id = e.id where m.attempt_id=${a.id}::uuid and m.kind='fee'`.execute(tx))).rows;
    expect(fee).toHaveLength(1);
    expect(fee[0]!.label).not.toContain('txn_');
    expect(fee[0]!.label).toBe(`Stripe fee · ${fee[0]!.date}`);
    expect(fee[0]).toEqual({ label: feeLabel(fee[0]!.date), ref: 'txn_paid', date: fee[0]!.date });
  });
  it('leaves a missing fee pending, then posts the real fee once when it arrives', async () => {
    const a = await reserve(await invoice());
    expect(await as(tx => postCapturedPayment(tx, BIZ, a.id, intent('late', '100', null)))).toMatchObject({ state: 'fee_pending' });
    expect(await as(tx => postCapturedPayment(tx, BIZ, a.id, intent('late')))).toMatchObject({ state: 'posted' });
    expect((await as(tx => sql`select * from stripe_movements where attempt_id=${a.id}::uuid`.execute(tx))).rows).toHaveLength(2);
    expect(await as(tx=>postCapturedPayment(tx,BIZ,a.id,intent('late','100',null)))).toMatchObject({state:'posted'});
    expect((await as(tx=>sql<{reason:string|null}>`select reason from stripe_checkout_attempts where id=${a.id}::uuid`.execute(tx))).rows[0]!.reason).toBeNull();
  });
  it('moves only the owner-confirmed Nomi portion to transit, and matches an exact bank receipt', async () => {
    const payout = { id: 'po_fixture', status: 'paid' as const, amount: decimal('97'), currency: 'GBP', created: Math.floor(now.getTime() / 1000), arrival: Math.floor(now.getTime() / 1000), balance: null };
    await as(tx => recordStripePayout(tx, BIZ, connection, payout));
    expect(await as(tx => confirmStripePayout(tx, BIZ, connection, payout.id, decimal('98'), 'owner'))).toMatchObject({ state: 'exception' });
    expect(await as(tx => confirmStripePayout(tx, BIZ, connection, payout.id, decimal('97'), 'owner'))).toMatchObject({ state: 'posted' });
    await as(tx => importStatement(tx, BIZ, 'owner', accounts['1000']!, 'csv', 'fixture', [{ bookedOn: '2026-10-11', amount: decimal('97'), currency: 'GBP', wording: 'Payout', reference: 'po_fixture', fingerprint: 'payment-fixture' }]));
    const line = (await as(tx => sql<{ id: string }>`select id::text from statement_lines where reference='po_fixture'`.execute(tx))).rows[0]!.id;
    expect(await as(tx => receiveStripePayout(tx, BIZ, connection, payout.id, line, 'owner'))).toMatchObject({ state: 'posted' });
    expect(await as(tx => receiveStripePayout(tx, BIZ, connection, payout.id, line, 'owner'))).toMatchObject({ state: 'posted' });
    expect((await as(tx => sql`select * from statement_matches where statement_line_id=${line}::uuid and unmatched_at is null`.execute(tx))).rows).toHaveLength(1);
    // The entries' labels are words and a date (the entry page's heading); the payout's id is their document reference.
    const entries = (await as(tx => sql<{ label: string; ref: string; date: string }>`select e.label, e.document_ref as ref, e.entry_date::text as date from journal_entries e
      join stripe_payouts p on e.id in (p.entry_id, p.receipt_id) where p.provider_id = 'po_fixture' order by e.created_at`.execute(tx))).rows;
    for (const e of entries) expect(e.label).not.toContain('po_');
    expect(entries[0]!.label).toBe(`Stripe payout · ${entries[0]!.date}`);
    expect(entries).toEqual([
      { label: payoutLabel('sent', entries[0]!.date), ref: 'po_fixture', date: entries[0]!.date },
      { label: payoutLabel('received', '2026-10-11'), ref: 'po_fixture receipt', date: '2026-10-11' },
    ]);
  });
  // t1r's ruling (2026-11-10) replaces "a manual-payment race is an exception": the link's money arrived, so it is
  // recorded whole, the excess is owed back (refund_due) and the owner is told — never a refund, never a lost payment.
  it('records a link paid after a manual payment in full: the excess owed back, the owner to be told, posted once', async () => {
    const id = await invoice(), a = await reserve(id);
    expect((await as(tx => recordPayment(tx, BIZ, id, 'owner', { paidOn: '2026-10-10', amount: decimal('100'), journalId: journals['BK']!, accountId: accounts['1000']! }))).kind).toBe('recorded');
    expect(await as(tx => postCapturedPayment(tx, BIZ, a.id, intent('race')))).toEqual({ state: 'posted' });
    expect(await as(tx => postCapturedPayment(tx, BIZ, a.id, intent('race')))).toEqual({ state: 'posted' });
    expect((await admin.query("select amount::text,created_by='stripe' as link,stripe_attempt_id::text as attempt from invoice_payments where invoice_id=$1 order by created_at", [id])).rows)
      .toEqual([{ amount: '100.00', link: false, attempt: null }, { amount: '100.00', link: true, attempt: a.id }]);
    expect((await admin.query('select (invoice_total(id)-invoice_credited(id)-invoice_paid(id))::text as owed from invoices where id=$1', [id])).rows[0].owed).toBe('-100.00');
    expect((await admin.query('select state,paid_over from stripe_checkout_attempts where id=$1', [a.id])).rows[0]).toEqual({ state: 'paid', paid_over: 'untold' });
  });
  it('keeps closed-period work visible and posts it on the original event date after reopening', async () => {
    const id = await invoice(), a = await reserve(id);
    expect(await as(tx => lockTo(tx, BIZ, '2026-10-10', 'owner'))).toMatchObject({ kind: 'done' });
    expect(await as(tx => postCapturedPayment(tx, BIZ, a.id, intent('closed')))).toMatchObject({ state: 'exception', reason: 'period' });
    const year = (await as(tx => sql<{ id: string }>`select id::text from fiscal_years where business_id=${BIZ}::uuid`.execute(tx))).rows[0]!.id;
    expect(await as(tx => reopenTo(tx, BIZ, year, null, 'owner', 'Review the original payment'))).toMatchObject({ kind: 'done' });
    expect(await as(tx => postCapturedPayment(tx, BIZ, a.id, intent('closed')))).toMatchObject({ state: 'posted' });
    expect((await as(tx => sql<{ date: string }>`select paid_on::text as date from invoice_payments where invoice_id=${id}::uuid`.execute(tx))).rows[0]!.date).toBe('2026-10-10');
  });
  it('records a succeeded refund without a credit note as outstanding; a pending refund posts nothing', async () => {
    const a = await reserve(await invoice()); await as(tx => postCapturedPayment(tx, BIZ, a.id, intent('refund')));
    const f = { id: 're_example', intentId: 'pi_refund', status: 'pending' as const, amount: decimal('25'), currency: 'GBP', created: Math.floor(now.getTime() / 1000), balance: null };
    expect(await as(tx => postStripeRefund(tx, BIZ, connection, f))).toMatchObject({ state: 'pending' });
    expect(await as(tx => postStripeRefund(tx, BIZ, connection, { ...f, status: 'succeeded' }))).toMatchObject({ state: 'exception', reason: 'too_much_refund' });
  });
  it('deduplicates its durable minimal event inbox', async () => {
    const e = { id: 'evt_one', type: 'payment_intent.succeeded', account: `acct_${BIZ.replaceAll('-', '')}`, live: false, created: Math.floor(now.getTime() / 1000), objectId: 'pi_paid', intentId: null };
    expect(await as(tx => storeStripeEvent(tx, BIZ, connection, e))).toBe(true);
    expect(await as(tx => storeStripeEvent(tx, BIZ, connection, e))).toBe(false);
  });

  it('rechecks the intent binding after the connection lock, so two different payments cannot replace each other', async () => {
    const a = await reserve(await invoice());
    const results = await Promise.all(['conflictA','conflictB'].map(id => as(tx => postCapturedPayment(tx,BIZ,a.id,intent(id)))));
    expect(results.filter(r => r.state==='posted')).toHaveLength(1);
    expect(results.filter(r => r.reason==='payment_differs')).toHaveLength(1);
    expect(await as(tx=>keepCheckout(tx,BIZ,a.id,{id:'cs_test_conflict',attemptId:a.id,status:'complete',paid:true,amount:a.amount,currency:a.currency,url:null,intentId:'pi_other',expiresAt:1800003600}))).toBe(false);
  });
  it('rolls back the payment and all its facts together if the process fails before commit', async () => {
    const id=await invoice(),a=await reserve(id);
    await expect(as(async tx => { await postCapturedPayment(tx,BIZ,a.id,intent('crash')); throw new Error('simulated crash'); })).rejects.toThrow('simulated crash');
    expect((await as(tx=>sql`select * from invoice_payments where invoice_id=${id}::uuid`.execute(tx))).rows).toHaveLength(0);
    expect((await as(tx=>sql`select * from stripe_movements where attempt_id=${a.id}::uuid`.execute(tx))).rows).toHaveLength(0);
    expect(await as(tx=>postCapturedPayment(tx,BIZ,a.id,intent('crash')))).toMatchObject({state:'posted'});
  });
  it('recovers an ambiguous creation with the same key and expires a previous open link before replacement',async()=>{
    const p=paymentProvider({id:`acct_${BIZ.replaceAll('-','')}`,country:'GB',currency:'GBP',ready:true});
    const deps={db,client:p.client,live:false,now:()=>now,publicBaseUrl:'https://nomi.example'};
    const id=await invoice();p.ambiguousNextCreate();
    expect(await createPaymentLink(deps,BIZ,id)).toMatchObject({ok:false,reason:'unavailable'});
    const a=await createPaymentLink(deps,BIZ,id);expect(a.ok).toBe(true);expect(p.created()).toBe(1);
    if(!a.ok)throw new Error(a.reason);
    expect(await expirePaymentLink(deps,BIZ,a.value.id)).toEqual({ok:true});
    const b=await createPaymentLink(deps,BIZ,id);expect(b.ok).toBe(true);expect(p.created()).toBe(2);
    if(!b.ok)throw new Error(b.reason);expect(b.value.id).not.toBe(a.value.id);
  });
  it('durably receives an unpaid session, then later settles the saved event from current capture facts',async()=>{
    const p=paymentProvider({id:`acct_${BIZ.replaceAll('-','')}`,country:'GB',currency:'GBP',ready:true});
    const deps={db,client:p.client,live:false,now:()=>now,publicBaseUrl:'https://nomi.example'};
    const id=await invoice(),made=await createPaymentLink(deps,BIZ,id);if(!made.ok)throw new Error(made.reason);
    const a=made.value,s=p.sessions.get(a.id)!;
    p.sessions.set(a.id,{...s,status:'complete',paid:false,intentId:'pi_delayed',url:null});
    p.intents.set('pi_delayed',{id:'pi_delayed',attemptId:a.id,succeeded:false,charge:null});
    await as(tx=>storeStripeEvent(tx,BIZ,connection,{id:'evt_delayed',type:'checkout.session.completed',account:`acct_${BIZ.replaceAll('-','')}`,live:false,created:Math.floor(now.getTime()/1000),objectId:s.id,intentId:'pi_delayed'}));
    await reconcileStripePayments(deps,BIZ);
    expect((await as(tx=>sql`select * from invoice_payments where invoice_id=${id}::uuid`.execute(tx))).rows).toHaveLength(0);
    p.intents.set('pi_delayed',{...intent('delayed'),attemptId:a.id});
    await reconcileStripePayments(deps,BIZ);await reconcileStripePayments(deps,BIZ);
    expect((await as(tx=>sql`select * from invoice_payments where invoice_id=${id}::uuid`.execute(tx))).rows).toHaveLength(1);
    expect((await as(tx=>sql<{state:string}>`select state from stripe_event_inbox where event_id='evt_delayed'`.execute(tx))).rows[0]!.state).toBe('done');
  });
  it('recovers an elapsed ambiguous create by metadata, then expires exactly that session',async()=>{
    const p=paymentProvider({id:`acct_${BIZ.replaceAll('-','')}`,country:'GB',currency:'GBP',ready:true});
    let clock=now;const deps={db,client:p.client,live:false,now:()=>clock,publicBaseUrl:'https://nomi.example'};
    const id=await invoice();p.ambiguousNextCreate();expect(await createPaymentLink(deps,BIZ,id)).toMatchObject({ok:false});
    const a=(await as(tx=>sql<{id:string}>`select id::text from stripe_checkout_attempts where invoice_id=${id}::uuid`.execute(tx))).rows[0]!;
    clock=new Date(now.getTime()+25*3600000);
    expect(await expirePaymentLink(deps,BIZ,a.id)).toEqual({ok:true});expect(p.calls).toContain('find');expect(p.created()).toBe(1);
    const fresh=await createPaymentLink(deps,BIZ,id);expect(fresh.ok).toBe(true);expect([...p.sessions.values()].filter(s=>s.status==='open')).toHaveLength(1);
  });
  it('proves absence after the maximum lifetime before releasing an elapsed reservation; concurrent replacements share one link',async()=>{
    const p=paymentProvider({id:`acct_${BIZ.replaceAll('-','')}`,country:'GB',currency:'GBP',ready:true});
    let clock=new Date(now.getTime()+23.5*3600000);const deps={db,client:p.client,live:false,now:()=>clock,publicBaseUrl:'https://nomi.example'};
    const id=await invoice(),a=await reserve(id);
    expect(await expirePaymentLink(deps,BIZ,a.id)).toMatchObject({ok:false,reason:'recovery_wait'});expect(p.created()).toBe(0);
    clock=new Date(now.getTime()+25*3600000);
    expect(await expirePaymentLink(deps,BIZ,a.id)).toEqual({ok:true});
    const results=await Promise.all([createPaymentLink(deps,BIZ,id),createPaymentLink(deps,BIZ,id)]);
    expect(results.every(r=>r.ok)).toBe(true);expect(p.created()).toBe(1);
    const late={id:'cs_test_late',attemptId:a.id,status:'open' as const,paid:false,amount:a.amount,currency:a.currency,url:'https://checkout.stripe.com/c/pay/late',intentId:null,expiresAt:Math.floor(a.expiresAt.getTime()/1000)};
    expect(await as(tx=>keepCheckout(tx,BIZ,a.id,late))).toBe(false);
  });
  it('keeps the reservation when recovery is unavailable or finds a completed payment',async()=>{
    const p=paymentProvider({id:`acct_${BIZ.replaceAll('-','')}`,country:'GB',currency:'GBP',ready:true});
    const id=await invoice(),a=await reserve(id),deps={db,client:p.client,live:false,now:()=>new Date(now.getTime()+25*3600000),publicBaseUrl:'https://nomi.example'};
    p.client.findCheckout=async()=>({ok:false,reason:'unavailable',retryable:true});
    expect(await expirePaymentLink(deps,BIZ,a.id)).toMatchObject({ok:false,reason:'unavailable'});
    expect(await createPaymentLink(deps,BIZ,id)).toMatchObject({ok:false,reason:'expire_first'});
    p.client.findCheckout=async()=>({ok:true,value:{id:'cs_test_complete',attemptId:a.id,status:'complete',paid:true,amount:a.amount,currency:a.currency,url:null,intentId:'pi_recovered',expiresAt:Math.floor(a.expiresAt.getTime()/1000)}});
    expect(await expirePaymentLink(deps,BIZ,a.id)).toMatchObject({ok:false,reason:'processing'});
    expect(await createPaymentLink(deps,BIZ,id)).toMatchObject({ok:false});expect(p.created()).toBe(0);
  });

});
