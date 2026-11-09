import { sql } from 'kysely';
import type { Tx } from './client.js';
import { recordPayment } from './booksInvoices.js';
import { draftEntry, postEntry, type DraftLine } from './booksEntries.js';
import { matchLine, paymentAccounts } from './bankStatements.js';
import { paymentAttempt, stripeMapping, type PaymentAttempt, type StripeMapping } from './stripePayments.js';
import { compareDecimal, decimal, signOf, type Decimal } from '../core/types/decimal.js';
import type { IntentFact, PayoutFact, RefundFact } from '../core/payments/paymentLink.js';
import { dayKey } from '../core/owner/i18n/format.js';

export type StripePosting = { readonly state: 'posted' | 'pending' | 'fee_pending' | 'exception'; readonly reason?: string };
async function lock(tx: Tx, businessId: string, connectionId: string): Promise<void> {
  await sql`select id from stripe_connections where business_id=${businessId}::uuid and id=${connectionId}::uuid for update`.execute(tx);
}
async function dateOf(tx: Tx, businessId: string, seconds: number): Promise<string> {
  const zone = (await sql<{ timezone: string | null }>`select timezone from businesses where id=${businessId}::uuid`.execute(tx)).rows[0]?.timezone ?? 'UTC';
  return dayKey(new Date(seconds*1000),zone);
}
async function mappingFor(tx: Tx, businessId: string, a: PaymentAttempt): Promise<StripeMapping | null> {
  return (await sql<StripeMapping>`select id::text,connection_id::text as "connectionId",clearing_id::text as "clearingId",transit_id::text as "transitId",fee_id::text as "feeId",journal_id::text as "journalId",bank_id::text as "bankId"
    from stripe_mappings where business_id=${businessId}::uuid and id=${a.mappingId}::uuid`.execute(tx)).rows[0] ?? null;
}
async function usableAccounts(tx: Tx, businessId: string, ids: readonly string[]): Promise<boolean> {
  const rows = (await sql<{ id: string; active: boolean; leaf: boolean }>`select a.id::text,a.is_active as active,
    not exists(select 1 from accounts ch where ch.business_id=a.business_id and ch.parent_id=a.id and ch.is_active) as leaf
    from accounts a where a.business_id=${businessId}::uuid and a.id=any(${[...new Set(ids)]}::uuid[]) for share of a`.execute(tx)).rows;
  return rows.length===new Set(ids).size && rows.every(a=>a.active && a.leaf);
}
const line = (accountId: string, currency: string, amount: Decimal, debit: boolean): DraftLine => ({ accountId,currency,debit:debit?amount:null,credit:debit?null:amount,partyId:null,taxCodeId:null,label:null,isFx:false });
/** Every transfer uses the same draft/post writer and its period, account, currency and balance checks. */
async function transfer(tx: Tx, businessId: string, journalId: string, date: string, ref: string, currency: string, amount: Decimal, debit: string, credit: string, actor: string, label: string = ref): Promise<{ id: string } | { reason: string }> {
  if (!await usableAccounts(tx,businessId,[debit,credit])) return { reason:'accounts' };
  await sql`savepoint stripe_transfer`.execute(tx);
  const d = await draftEntry(tx,businessId,actor,{ journalId,date,label,documentRef:ref,documentDate:date,lines:[line(debit,currency,amount,true),line(credit,currency,amount,false)] });
  if (d.kind==='refused') { await sql`rollback to savepoint stripe_transfer`.execute(tx); return { reason:d.reason }; }
  const p = await postEntry(tx,businessId,d.id,actor);
  if (p.kind==='refused') { await sql`rollback to savepoint stripe_transfer`.execute(tx); return { reason:p.reason }; }
  await sql`release savepoint stripe_transfer`.execute(tx); return { id:d.id };
}
async function movement(tx: Tx, businessId: string, a: PaymentAttempt, kind: 'payment'|'fee'|'refund'|'refund_reversal', providerId: string, amount: Decimal, currency: string, date: string, reverses: string | null = null) {
  await sql`insert into stripe_movements(business_id,connection_id,attempt_id,kind,provider_id,amount,currency,event_date,reverses_id)
    values(${businessId}::uuid,${a.connectionId}::uuid,${a.id}::uuid,${kind},${providerId},${amount}::numeric,${currency},${date}::date,${reverses}::uuid)
    on conflict(connection_id,kind,provider_id) do nothing`.execute(tx);
  const row = (await sql<{ id:string; amount:string; currency:string; date:string; entryId:string|null; attemptId:string; reverses:string|null }>`select id::text,amount::text,currency,event_date::text as date,entry_id::text as "entryId",attempt_id::text as "attemptId",reverses_id::text as reverses from stripe_movements
    where business_id=${businessId}::uuid and connection_id=${a.connectionId}::uuid and kind=${kind} and provider_id=${providerId} for update`.execute(tx)).rows[0]!;
  return { ...row, same:row.reverses===reverses && row.attemptId===a.id && compareDecimal(decimal(row.amount),amount)===0 && row.currency===currency && row.date===date };
}
async function result(tx: Tx, businessId: string, a: PaymentAttempt, out: StripePosting): Promise<StripePosting> {
  await sql`update stripe_checkout_attempts set reason=${out.reason ?? (out.state==='fee_pending'?'fee_pending':null)},
    state=case when ${out.state==='posted'||out.state==='fee_pending'} then 'paid' when state='paid' then state else 'processing' end where business_id=${businessId}::uuid and id=${a.id}::uuid`.execute(tx);
  return out;
}
export async function postCapturedPayment(tx: Tx, businessId: string, attemptId: string, fact: IntentFact): Promise<StripePosting> {
  const found = await paymentAttempt(tx,businessId,attemptId);
  if (!found) return { state:'exception',reason:'unknown_payment' };
  await lock(tx,businessId,found.connectionId);
  const a = (await paymentAttempt(tx,businessId,attemptId))!;
  await sql`select id from invoices where business_id=${businessId}::uuid and id=${a.invoiceId}::uuid for update`.execute(tx);
  if (!fact.succeeded || !fact.charge?.paid || !fact.charge.captured) return { state:'pending' };
  const ch=fact.charge;
  if (ch.currency!==a.currency || compareDecimal(ch.amount,a.amount)!==0 || a.intentId && a.intentId!==fact.id || fact.attemptId && fact.attemptId!==a.id) return result(tx,businessId,a,{ state:'exception',reason:'payment_differs' });
  const m=await mappingFor(tx,businessId,a); if (!m || !await usableAccounts(tx,businessId,[m.clearingId,m.feeId])) return result(tx,businessId,a,{ state:'exception',reason:'accounts' });
  const date=await dateOf(tx,businessId,ch.created);
  const pay=await movement(tx,businessId,a,'payment',ch.id,ch.amount,ch.currency,date);
  if (!pay.same) return result(tx,businessId,a,{ state:'exception',reason:'payment_differs' });
  await sql`update stripe_checkout_attempts set intent_id=${fact.id} where business_id=${businessId}::uuid and id=${a.id}::uuid`.execute(tx);
  if (!pay.entryId) {
    const posted=await recordPayment(tx,businessId,a.invoiceId,'stripe',{paidOn:date,amount:a.amount,journalId:m.journalId,accountId:m.clearingId});
    if (posted.kind==='refused') {
      await sql`update stripe_movements set reason=${posted.reason} where id=${pay.id}::uuid`.execute(tx);
      return result(tx,businessId,a,{state:'exception',reason:posted.reason});
    }
    await sql`update stripe_movements set entry_id=${posted.entryId}::uuid,reason=null where id=${pay.id}::uuid`.execute(tx);
  }
  const b=ch.balance;
  if (!b || b.currency!==a.currency || compareDecimal(b.gross,a.amount)!==0) {
    const kept=(await sql`select 1 from stripe_movements where business_id=${businessId}::uuid and attempt_id=${a.id}::uuid and kind='fee' and reason is null and (entry_id is not null or amount=0)`.execute(tx)).rows.length>0;
    return result(tx,businessId,a,{state:kept?'posted':'fee_pending'});
  }
  const fee=await movement(tx,businessId,a,'fee',b.id,b.fee,b.currency,await dateOf(tx,businessId,b.created));
  if (!fee.same) return result(tx,businessId,a,{state:'exception',reason:'fee_differs'});
  if (!fee.entryId && signOf(b.fee)>0) {
    const posted=await transfer(tx,businessId,m.journalId,fee.date,b.id,b.currency,b.fee,m.feeId,m.clearingId,'stripe');
    if ('reason' in posted) { await sql`update stripe_movements set reason=${posted.reason} where id=${fee.id}::uuid`.execute(tx); return result(tx,businessId,a,{state:'exception',reason:posted.reason}); }
    await sql`update stripe_movements set entry_id=${posted.id}::uuid,reason=null where id=${fee.id}::uuid`.execute(tx);
  }
  return result(tx,businessId,a,{state:'posted'});
}

/**
 * A payment that has not succeeded. Only Stripe's documented asynchronous failure
 * (`checkout.session.async_payment_failed`, read against the CURRENT session and intent)
 * ends the attempt as failed; nothing is posted and a new link may then be made. A
 * failed attempt's other events are done. A still-processing attempt with no failure
 * stays as it is: money may still arrive. A later success is posted by
 * `postCapturedPayment`, which replaces this state.
 */
export async function settleUnpaidPayment(tx: Tx, businessId: string, attemptId: string, fact: IntentFact, failed: boolean): Promise<StripePosting> {
  const found = await paymentAttempt(tx,businessId,attemptId);
  if (!found) return { state:'exception',reason:'unknown_payment' };
  await lock(tx,businessId,found.connectionId);
  const a = (await paymentAttempt(tx,businessId,attemptId))!;
  if (fact.succeeded || a.intentId && a.intentId!==fact.id || fact.attemptId && fact.attemptId!==a.id) return { state:'pending' };
  if (failed && ['open','processing'].includes(a.state)) {
    await sql`update stripe_checkout_attempts set state='failed',reason=null where business_id=${businessId}::uuid and id=${a.id}::uuid`.execute(tx);
    return { state:'posted' };
  }
  return a.state==='failed' ? { state:'posted' } : { state:'pending' };
}

export async function postStripeRefund(tx: Tx,businessId:string,connectionId:string,fact:RefundFact):Promise<StripePosting> {
  await lock(tx,businessId,connectionId);
  const id=(await sql<{id:string}>`select id::text from stripe_checkout_attempts where business_id=${businessId}::uuid and connection_id=${connectionId}::uuid and intent_id=${fact.intentId}`.execute(tx)).rows[0]?.id;
  if (!id) return {state:'exception',reason:'unknown_payment'};
  const a=(await paymentAttempt(tx,businessId,id))!,m=await mappingFor(tx,businessId,a);
  if (fact.currency!==a.currency) return {state:'exception',reason:'currency'};
  if (!m || !await usableAccounts(tx,businessId,[m.clearingId])) return {state:'exception',reason:'accounts'};
  const date=await dateOf(tx,businessId,fact.created),row=await movement(tx,businessId,a,'refund',fact.id,fact.amount,fact.currency,date);
  if (!row.same) return {state:'exception',reason:'refund_differs'};
  if (fact.status==='failed' && row.entryId) {
    const b=fact.failureBalance;
    if (!b) { await sql`update stripe_movements set reason='failure_pending' where id=${row.id}::uuid`.execute(tx); return {state:'pending',reason:'failure_pending'}; }
    if (b.currency!==a.currency || signOf(b.amount)<=0) return {state:'exception',reason:'refund_differs'};
    const returned=await movement(tx,businessId,a,'refund_reversal',b.id,b.amount,b.currency,await dateOf(tx,businessId,b.created),row.id);
    if (!returned.same) return {state:'exception',reason:'refund_differs'};
    if (!returned.entryId) {
      const original=(await sql<{id:string}>`select id::text from invoice_payments where business_id=${businessId}::uuid and entry_id=${row.entryId}::uuid and kind='refund'`.execute(tx)).rows[0];
      if (!original) return {state:'exception',reason:'unknown_payment'};
      const posted=await recordPayment(tx,businessId,a.invoiceId,'stripe',{paidOn:returned.date,amount:b.amount,journalId:m.journalId,accountId:m.clearingId,reversesRefundId:original.id});
      if (posted.kind==='refused') { await sql`update stripe_movements set reason=${posted.reason} where id=${returned.id}::uuid`.execute(tx); return {state:'exception',reason:posted.reason}; }
      await sql`update stripe_movements set entry_id=${posted.entryId}::uuid,reason=null where id=${returned.id}::uuid`.execute(tx);
    }
    await sql`update stripe_movements set reason=null where id=${row.id}::uuid`.execute(tx);
    return {state:'posted'};
  }
  if (fact.status!=='succeeded') {
    // Once posted, a refund failure is a visible exception, never an automatic change to a customer's credit note.
    const reason=row.entryId?'refund_changed':fact.status;
    await sql`update stripe_movements set reason=${reason} where id=${row.id}::uuid`.execute(tx);
    return {state:row.entryId?'exception':'pending',reason};
  }
  if (row.entryId) return {state:'posted'};
  await sql`select id from invoices where business_id=${businessId}::uuid and id=${a.invoiceId}::uuid for update`.execute(tx);
  const p=await recordPayment(tx,businessId,a.invoiceId,'stripe',{paidOn:date,amount:fact.amount,journalId:m.journalId,accountId:m.clearingId,refund:true});
  if (p.kind==='refused') { await sql`update stripe_movements set reason=${p.reason} where id=${row.id}::uuid`.execute(tx); return {state:'exception',reason:p.reason}; }
  await sql`update stripe_movements set entry_id=${p.entryId}::uuid,reason=null where id=${row.id}::uuid`.execute(tx);
  return {state:'posted'};
}

type PayoutRow={id:string;amount:string;currency:string;date:string;status:string;nomi:string|null;mappingId:string|null;entryId:string|null;receiptId:string|null;reversalId:string|null;destination:string|null;failureId:string|null;failureDate:string|null};
async function payoutRow(tx:Tx,bid:string,cid:string,id:string):Promise<PayoutRow|null> {
  return (await sql<PayoutRow>`select provider_id as id,amount::text,currency,event_date::text as date,status,nomi_amount::text as nomi,mapping_id::text as "mappingId",entry_id::text as "entryId",receipt_id::text as "receiptId",reversal_id::text as "reversalId",destination,failure_balance_id as "failureId",failure_date::text as "failureDate"
    from stripe_payouts where business_id=${bid}::uuid and connection_id=${cid}::uuid and provider_id=${id} for update`.execute(tx)).rows[0]??null;
}
/**
 * A payout entry's label is words and its date, never Stripe's id: the label is the entry page's heading, and a
 * 35-character id does not wrap on a phone. The id stays the entry's document reference.
 */
export function payoutLabel(kind:'sent'|'received'|'returned',date:string):string {
  // The owner's own words from the payments page ('paymentLinks.received', 'paymentLinks.payoutReturned').
  return `${kind==='sent'?'Stripe payout':kind==='received'?'Stripe payout · Bank receipt matched':'Payout returned to your Stripe balance'} · ${date}`;
}
export async function recordStripePayout(tx:Tx,bid:string,cid:string,fact:PayoutFact):Promise<StripePosting> {
  await lock(tx,bid,cid);
  await sql`insert into stripe_payouts(business_id,connection_id,provider_id,amount,currency,event_date,arrival_date,status)
    values(${bid}::uuid,${cid}::uuid,${fact.id},${fact.amount}::numeric,${fact.currency},${await dateOf(tx,bid,fact.created)}::date,${await dateOf(tx,bid,fact.arrival)}::date,${fact.status})
    on conflict(connection_id,provider_id) do nothing`.execute(tx);
  const p=(await payoutRow(tx,bid,cid,fact.id))!;
  if (compareDecimal(decimal(p.amount),fact.amount)!==0||p.currency!==fact.currency) return {state:'exception',reason:'payout_differs'};
  const changedDestination=p.destination!==null && fact.destination!=null && p.destination!==fact.destination;
  const failed=['failed','canceled'].includes(fact.status)||['failed','canceled'].includes(p.status);
  await sql`update stripe_payouts set destination=coalesce(destination,${fact.destination??null}),
    status=case when status in ('failed','canceled') then status else ${fact.status} end
    where business_id=${bid}::uuid and connection_id=${cid}::uuid and provider_id=${fact.id}`.execute(tx);
  const refuse=async(reason:string):Promise<StripePosting>=>{ await sql`update stripe_payouts set reason=${reason} where business_id=${bid}::uuid and connection_id=${cid}::uuid and provider_id=${fact.id}`.execute(tx); return {state:'exception',reason}; };
  if (failed && p.entryId) {
    if (p.reversalId) return {state:'posted'};
    const b=fact.failureBalance;
    if (!b) return refuse('failure_pending');
    const date=await dateOf(tx,bid,b.created);
    if (b.currency!==p.currency || compareDecimal(b.amount,decimal(p.amount))!==0 || p.failureId && (p.failureId!==b.id || p.failureDate!==date)) return refuse('payout_differs');
    await sql`update stripe_payouts set failure_balance_id=${b.id},failure_date=${date}::date where business_id=${bid}::uuid and connection_id=${cid}::uuid and provider_id=${fact.id}`.execute(tx);
    const m=(await sql<StripeMapping>`select id::text,clearing_id::text as "clearingId",transit_id::text as "transitId",journal_id::text as "journalId" from stripe_mappings where business_id=${bid}::uuid and id=${p.mappingId}::uuid`.execute(tx)).rows[0];
    if (!m || p.nomi===null) return refuse('accounts');
    const reversal=await transfer(tx,bid,m.journalId,date,b.id,p.currency,decimal(p.nomi),m.clearingId,m.transitId,'stripe',payoutLabel('returned',date));
    if ('reason' in reversal) return refuse(reversal.reason);
    await sql`update stripe_payouts set reversal_id=${reversal.id}::uuid,reason=${p.receiptId?'bank_receipt_review':null} where business_id=${bid}::uuid and connection_id=${cid}::uuid and provider_id=${fact.id}`.execute(tx);
    return {state:'posted'};
  }
  if (changedDestination) return refuse('destination_changed');
  return {state:'pending'};
}
export async function confirmStripePayout(tx:Tx,bid:string,cid:string,id:string,amount:Decimal,actor:string):Promise<StripePosting> {
  await lock(tx,bid,cid); const p=await payoutRow(tx,bid,cid,id),m=await stripeMapping(tx,bid,cid);
  if (!p||!m||!['paid','in_transit'].includes(p.status)) return {state:'exception',reason:'payout_not_ready'};
  if (p.entryId) return compareDecimal(decimal(p.nomi!),amount)===0?{state:'posted'}:{state:'exception',reason:'already_confirmed'};
  const destination=(await sql<{destination:string|null}>`select payout_destination as destination from stripe_connections where business_id=${bid}::uuid and id=${cid}::uuid`.execute(tx)).rows[0]!.destination;
  if (destination && p.destination && destination!==p.destination) {
    await sql`update stripe_payouts set reason='destination_changed' where business_id=${bid}::uuid and connection_id=${cid}::uuid and provider_id=${id}`.execute(tx);
    return {state:'exception',reason:'destination_changed'};
  }
  if (signOf(amount)<=0||compareDecimal(amount,decimal(p.amount))>0) return {state:'exception',reason:'payout_amount'};
  const pending=(await sql`select 1 from stripe_checkout_attempts where business_id=${bid}::uuid and connection_id=${cid}::uuid and (reason is not null or state='processing')
    union all select 1 from stripe_movements where business_id=${bid}::uuid and connection_id=${cid}::uuid and reason is not null limit 1`.execute(tx)).rows.length;
  if (pending) return {state:'exception',reason:'payments_outstanding'};
  const available=(await sql<{n:string}>`select (
    coalesce((select sum(case when kind in ('payment','refund_reversal') then amount else -amount end) from stripe_movements where business_id=${bid}::uuid and connection_id=${cid}::uuid and currency=${p.currency} and entry_id is not null),0)
    -coalesce((select sum(nomi_amount) from stripe_payouts where business_id=${bid}::uuid and connection_id=${cid}::uuid and currency=${p.currency} and entry_id is not null and reversal_id is null),0))::text as n`.execute(tx)).rows[0]!.n;
  if (compareDecimal(amount,decimal(available))>0) return {state:'exception',reason:'not_from_nomi'};
  const entry=await transfer(tx,bid,m.journalId,p.date,id,p.currency,amount,m.transitId,m.clearingId,actor,payoutLabel('sent',p.date));
  if ('reason' in entry) { await sql`update stripe_payouts set reason=${entry.reason} where business_id=${bid}::uuid and connection_id=${cid}::uuid and provider_id=${id}`.execute(tx); return {state:'exception',reason:entry.reason}; }
  await sql`update stripe_payouts set nomi_amount=${amount}::numeric,mapping_id=${m.id}::uuid,entry_id=${entry.id}::uuid,confirmed_by=${actor},confirmed_at=now(),reason=null
    where business_id=${bid}::uuid and connection_id=${cid}::uuid and provider_id=${id}`.execute(tx);
  await sql`update stripe_connections set payout_destination=coalesce(payout_destination,${p.destination}) where business_id=${bid}::uuid and id=${cid}::uuid`.execute(tx);
  return {state:'posted'};
}

/** A full Nomi payout: the owner chooses an imported statement line; its existing exact-match guard is the final word. */
export async function receiveStripePayout(tx:Tx,bid:string,cid:string,id:string,statementId:string,actor:string):Promise<StripePosting> {
  await lock(tx,bid,cid); const p=await payoutRow(tx,bid,cid,id);
  if (!p||!p.entryId||!p.mappingId||p.status!=='paid') return {state:'exception',reason:'payout_not_ready'};
  if (p.receiptId) return {state:'posted'};
  if (p.nomi===null||compareDecimal(decimal(p.nomi),decimal(p.amount))!==0) return {state:'exception',reason:'mixed_payout'};
  const m=(await sql<{transit:string;journal:string;bank:string}>`select transit_id::text as transit,journal_id::text as journal,bank_id::text as bank from stripe_mappings where business_id=${bid}::uuid and id=${p.mappingId}::uuid`.execute(tx)).rows[0]!;
  // Imported lines are immutable and the app has no UPDATE grant. The match's unique constraint arbitrates races.
  const s=(await sql<{account:string;currency:string;amount:string;date:string}>`select account_id::text as account,currency,amount::text,booked_on::text as date from statement_lines where business_id=${bid}::uuid and id::text=${statementId}`.execute(tx)).rows[0];
  if (!s||s.account!==m.bank||s.currency!==p.currency||compareDecimal(decimal(s.amount),decimal(p.amount))!==0||!(await paymentAccounts(tx,bid)).some(a=>a.id===m.bank)) return {state:'exception',reason:'bank_receipt'};
  await sql`savepoint stripe_receipt`.execute(tx);
  const entry=await transfer(tx,bid,m.journal,s.date,`${id} receipt`,p.currency,decimal(p.nomi),m.bank,m.transit,actor,payoutLabel('received',s.date));
  if ('reason' in entry) {await sql`rollback to savepoint stripe_receipt`.execute(tx);return {state:'exception',reason:entry.reason};}
  const jl=(await sql<{id:string}>`select id::text from journal_lines where business_id=${bid}::uuid and entry_id=${entry.id}::uuid and account_id=${m.bank}::uuid`.execute(tx)).rows[0]!.id;
  if (!await matchLine(tx,bid,actor,statementId,jl)) {await sql`rollback to savepoint stripe_receipt`.execute(tx);return {state:'exception',reason:'bank_receipt'};}
  await sql`update stripe_payouts set receipt_id=${entry.id}::uuid,reason=null where business_id=${bid}::uuid and connection_id=${cid}::uuid and provider_id=${id}`.execute(tx);
  await sql`release savepoint stripe_receipt`.execute(tx);return {state:'posted'};
}
