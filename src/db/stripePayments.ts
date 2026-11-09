import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import type { Tx } from './client.js';
import { paymentAccounts } from './bankStatements.js';
import { linkRefusal, type Checkout, type ConnectedAccount, type ConnectEvent } from '../core/payments/paymentLink.js';
import { decimal, compareDecimal, type Decimal } from '../core/types/decimal.js';

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };
const uuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export type StripeBinding = { id: string; account: string; live: boolean; country: string; currency: string; ready: boolean; active: boolean };
export type StripeMapping = { id: string; connectionId: string; clearingId: string; transitId: string; feeId: string; journalId: string; bankId: string };
export type PaymentAttempt = { id: string; invoiceId: string; connectionId: string; mappingId: string; amount: Decimal; currency: string; state: string; sessionId: string | null; intentId: string | null; url: string | null; expiresAt: Date; createdAt: Date; reason: string | null };
export async function stripeBinding(tx: Tx, businessId: string, live: boolean): Promise<StripeBinding | null> {
  return (await sql<StripeBinding>`select id::text,account,live,country,currency,ready,active from stripe_connections where business_id=${businessId}::uuid and live=${live} and active`.execute(tx)).rows[0] ?? null;
}
export async function stripeMapping(tx: Tx, businessId: string, connectionId: string): Promise<StripeMapping | null> {
  return (await sql<StripeMapping>`select id::text,connection_id::text as "connectionId",clearing_id::text as "clearingId",transit_id::text as "transitId",fee_id::text as "feeId",journal_id::text as "journalId",bank_id::text as "bankId"
    from stripe_mappings where business_id=${businessId}::uuid and connection_id=${connectionId}::uuid order by created_at desc,id desc limit 1`.execute(tx)).rows[0] ?? null;
}
export async function bindStripe(tx: Tx, businessId: string, account: ConnectedAccount, live: boolean, actor: string): Promise<Result<string>> {
  const b = (await sql<{ country: string; practice: boolean }>`select country,practice_of is not null as practice from businesses where id=${businessId}::uuid for update`.execute(tx)).rows[0];
  if (!b || b.practice || !['GB','US'].includes(b.country) || b.country !== account.country) return { ok: false, reason: 'country' };
  if ((await sql`select 1 from stripe_connections where business_id=${businessId}::uuid and live=${live} and deauthorization_state='pending'`.execute(tx)).rows.length) return {ok:false,reason:'deauthorization_pending'};
  const current = (await sql<StripeBinding>`select id::text,account,currency,active from stripe_connections where business_id=${businessId}::uuid and live=${live} and (active or account=${account.id}) for update`.execute(tx)).rows;
  if (current.some(c => c.active && c.account !== account.id)) return { ok: false, reason: 'already_connected' };
  const same = current.find(c => c.account === account.id);
  if (same && same.currency !== account.currency) return { ok: false, reason: 'currency' };
  try {
    await sql`savepoint stripe_bind`.execute(tx);
    const row = same ? (await sql<{ id: string }>`update stripe_connections set active=true,ready=${account.ready},disconnected_at=null,deauthorization_state=null,deauthorization_reason=null,connected_by=${actor}
      where id=${same.id}::uuid and business_id=${businessId}::uuid returning id::text`.execute(tx)).rows[0]!
      : (await sql<{ id: string }>`insert into stripe_connections(business_id,account,live,country,currency,ready,connected_by)
        values(${businessId}::uuid,${account.id},${live},${account.country},${account.currency},${account.ready},${actor}) returning id::text`.execute(tx)).rows[0]!;
    await sql`release savepoint stripe_bind`.execute(tx); return { ok: true, value: row.id };
  } catch (e) {
    await sql`rollback to savepoint stripe_bind`.execute(tx);
    if ((e as { code?: string }).code === '23505') return { ok: false, reason: 'account_in_use' };
    throw e;
  }
}
export async function saveStripeMapping(tx: Tx, businessId: string, connectionId: string, input: Omit<StripeMapping,'id'|'connectionId'>, actor: string): Promise<Result<string>> {
  if (![connectionId,...Object.values(input)].every(uuid)) return { ok: false, reason: 'accounts' };
  const c = (await sql`select id from stripe_connections where business_id=${businessId}::uuid and id=${connectionId}::uuid and active for update`.execute(tx)).rows[0];
  if (!c) return { ok: false, reason: 'disconnected' };
  const existing = await stripeMapping(tx,businessId,connectionId);
  if (existing && Object.entries(input).every(([k,v]) => existing[k as keyof StripeMapping] === v)) return { ok: true, value: existing.id };
  if ((await sql`select 1 from stripe_checkout_attempts where business_id=${businessId}::uuid and connection_id=${connectionId}::uuid limit 1`.execute(tx)).rows.length) return { ok: false, reason: 'mapping_in_use' };
  const money = await paymentAccounts(tx,businessId);
  if (!money.some(a => a.id === input.bankId) || money.some(a => a.id === input.clearingId || a.id === input.transitId) || new Set([input.bankId,input.clearingId,input.transitId,input.feeId]).size !== 4) return { ok: false, reason: 'accounts' };
  const rows = (await sql<{ id: string; kind: string }>`select a.id::text,a.kind from accounts a where a.business_id=${businessId}::uuid and a.id=any(${[input.clearingId,input.transitId,input.feeId]}::uuid[]) and a.is_active
    and not exists(select 1 from accounts child where child.business_id=a.business_id and child.parent_id=a.id and child.is_active)`.execute(tx)).rows;
  if (rows.length !== 3 || rows.some(a => a.kind !== (a.id === input.feeId ? 'expense' : 'asset')) || !(await sql`select id from journals where business_id=${businessId}::uuid and id=${input.journalId}::uuid and kind='general'`.execute(tx)).rows.length) return { ok: false, reason: 'accounts' };
  const id = (await sql<{ id: string }>`insert into stripe_mappings(business_id,connection_id,clearing_id,transit_id,fee_id,journal_id,bank_id,created_by)
    values(${businessId}::uuid,${connectionId}::uuid,${input.clearingId}::uuid,${input.transitId}::uuid,${input.feeId}::uuid,${input.journalId}::uuid,${input.bankId}::uuid,${actor}) returning id::text`.execute(tx)).rows[0]!.id;
  return { ok: true, value: id };
}

export async function newStripeState(tx: Tx, businessId: string, owner: string, session: string, live: boolean, now: Date): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  await sql`insert into stripe_oauth_states(business_id,digest,owner_id,session_digest,live,expires_at)
    values(${businessId}::uuid,${digest(raw)},${owner},${digest(session)},${live},${new Date(now.getTime()+600_000)})`.execute(tx);
  return raw;
}
export async function claimStripeState(tx: Tx, businessId: string, raw: string, owner: string, session: string, live: boolean, now: Date): Promise<boolean> {
  const r = await sql`update stripe_oauth_states set claimed_at=${now} where business_id=${businessId}::uuid and digest=${digest(raw)} and owner_id=${owner}
    and session_digest=${digest(session)} and live=${live} and claimed_at is null and expires_at>${now}`.execute(tx);
  return Number(r.numAffectedRows) === 1;
}
export async function paymentAttempt(tx: Tx, businessId: string, id: string): Promise<PaymentAttempt | null> {
  if (!uuid(id)) return null;
  const r = (await sql<PaymentAttempt>`select id::text,invoice_id::text as "invoiceId",connection_id::text as "connectionId",mapping_id::text as "mappingId",amount::text,currency,state,
    session_id as "sessionId",intent_id as "intentId",url,expires_at as "expiresAt",created_at as "createdAt",reason from stripe_checkout_attempts where business_id=${businessId}::uuid and id=${id}::uuid`.execute(tx)).rows[0];
  return r ? { ...r, amount: decimal(r.amount) } : null;
}
export async function reservePayment(tx: Tx, businessId: string, invoiceId: string, live: boolean, now: Date): Promise<Result<PaymentAttempt>> {
  if (!uuid(invoiceId)) return { ok: false, reason: 'not_issued' };
  const b = (await sql<{ country: string; practice: boolean }>`select country,practice_of is not null as practice from businesses where id=${businessId}::uuid`.execute(tx)).rows[0];
  let c = await stripeBinding(tx,businessId,live);
  if (!b || !c) return { ok: false, reason: 'disconnected' };
  await sql`select id from stripe_connections where id=${c.id}::uuid and business_id=${businessId}::uuid for update`.execute(tx);
  c = await stripeBinding(tx,businessId,live);
  if (!c) return {ok:false,reason:'disconnected'};
  const inv = (await sql<{ state: string; currency: string; owed: string }>`select state,currency,(invoice_total(id)-invoice_credited(id)-invoice_paid(id))::text as owed from invoices
    where business_id=${businessId}::uuid and id=${invoiceId}::uuid for update`.execute(tx)).rows[0];
  if (!inv) return { ok: false, reason: 'not_issued' };
  const reason = linkRefusal({ country:b.country,practice:b.practice,accountCountry:c.country,ready:c.ready,connected:c.active,invoiceState:inv.state,owed:decimal(inv.owed),currency:inv.currency,accountCurrency:c.currency });
  if (reason) return { ok: false, reason };
  const old = (await sql<{ id: string }>`select id::text from stripe_checkout_attempts where business_id=${businessId}::uuid and invoice_id=${invoiceId}::uuid and state in ('creating','open','processing')`.execute(tx)).rows[0];
  if (old) {
    const attempt = (await paymentAttempt(tx,businessId,old.id))!;
    if (attempt.connectionId !== c.id || compareDecimal(attempt.amount,decimal(inv.owed)) !== 0 || attempt.currency !== inv.currency || attempt.expiresAt <= now) return { ok: false, reason: 'expire_first' };
    return { ok: true, value: attempt };
  }
  const m = await stripeMapping(tx,businessId,c.id);
  if (!m) return { ok: false, reason: 'accounts' };
  const id = (await sql<{ id: string }>`insert into stripe_checkout_attempts(business_id,connection_id,mapping_id,invoice_id,amount,currency,expires_at,created_at)
    values(${businessId}::uuid,${c.id}::uuid,${m.id}::uuid,${invoiceId}::uuid,${inv.owed}::numeric,${inv.currency},${new Date(now.getTime()+23*3_600_000)},${now}) returning id::text`.execute(tx)).rows[0]!.id;
  return { ok: true, value: (await paymentAttempt(tx,businessId,id))! };
}
export async function keepCheckout(tx: Tx, businessId: string, attemptId: string, checkout: Checkout): Promise<boolean> {
  const found = await paymentAttempt(tx,businessId,attemptId);
  if (!found) return false;
  await sql`select id from stripe_connections where business_id=${businessId}::uuid and id=${found.connectionId}::uuid for update`.execute(tx);
  const a = await paymentAttempt(tx,businessId,attemptId);
  if (!a || checkout.attemptId !== a.id || checkout.currency !== a.currency || compareDecimal(checkout.amount,a.amount) !== 0 || a.sessionId && a.sessionId !== checkout.id || a.intentId && checkout.intentId && a.intentId !== checkout.intentId) return false;
  if (a.state==='expired' && checkout.status==='open') return false;
  // A delayed expiry must never erase a captured payment, an event already being reconciled, or a recorded failure.
  await sql`update stripe_checkout_attempts set session_id=${checkout.id},intent_id=coalesce(intent_id,${checkout.intentId}),url=${checkout.url},
    state=case when state in ('paid','processing','failed') then state else ${checkout.status === 'complete' ? 'processing' : checkout.status} end
    where business_id=${businessId}::uuid and id=${attemptId}::uuid`.execute(tx);
  return true;
}
export async function storeStripeEvent(tx: Tx, businessId: string, connectionId: string, e: ConnectEvent): Promise<boolean> {
  const r = await sql`insert into stripe_event_inbox(business_id,connection_id,event_id,event_type,event_created,object_id,intent_id)
    select ${businessId}::uuid,id,${e.id},${e.type},${e.created},${e.objectId},${e.intentId} from stripe_connections
    where business_id=${businessId}::uuid and id=${connectionId}::uuid and account=${e.account} and live=${e.live}
    on conflict(connection_id,event_id) do nothing`.execute(tx);
  return Number(r.numAffectedRows) === 1;
}
