import { sql } from 'kysely';
import type { Tx } from './client.js';
import { zoneOf } from './zone.js';
import { dayKey } from '../core/owner/i18n/format.js';
import { paymentAccounts } from './bankStatements.js';
import { ENTRY_KEY, draftEntry, postEntry, type DraftLine, type EntryRefusal } from './booksEntries.js';
import { type Decimal, decimal, signOf, subDecimal } from '../core/types/decimal.js';
import { nextOn, splitGross, norefFor, isNoref, type Every } from '../core/books/spending.js';

/**
 * SPENDING (Block 2 PR 3; 0227) — the owner's bills, categories and recurring costs, written only through the one
 * entry writer (`draftEntry` + `postEntry`: the database numbers, locks and refuses as it does for every entry). A
 * bill is one gross figure: its tax split off by the code's rate (`splitGross`), the net on the category's expense
 * account, the tax on the code's account, and the gross credited either to the bank or cash account that paid it
 * (then it is paid) or to the pack's creditors account with the supplier (then it waits under "Not paid yet" until
 * `payBill`). Nothing here posts without the owner's press: the daily job only PROPOSES a recurring cost
 * (`proposeDue`); `decideProposal` posts or skips it, and moves the schedule on either way.
 */
export type Choice = { readonly id: string; readonly code: string; readonly name: string };
export type TaxChoice = { readonly id: string; readonly code: string; readonly label: string; readonly rate: Decimal; readonly accountId: string | null };
export type Category = { readonly id: string; readonly name: string; readonly accountId: string; readonly accountCode: string; readonly accountName: string };
export type SpendingChoices = {
  readonly bookCurrency: string;
  readonly purchasesJournal: string | null;
  readonly bankJournal: string | null;
  readonly payableAccount: string | null;
  readonly expenseAccounts: readonly Choice[];
  readonly taxCodes: readonly TaxChoice[];
  readonly suppliers: readonly Choice[];
  readonly payAccounts: readonly Choice[];
  readonly categories: readonly Category[];
};

export async function spendingChoices(tx: Tx, businessId: string): Promise<SpendingChoices> {
  const q = <T>(s: ReturnType<typeof sql<T>>) => s.execute(tx).then((r) => r.rows);
  const journals = await q(sql<{ id: string; kind: string }>`select id::text as id, kind from journals where business_id = ${businessId}::uuid order by code`);
  const payable = await q(sql<{ id: string }>`select id::text as id from accounts where business_id = ${businessId}::uuid and is_active
    and code in ('4411', '2000') order by case code when '4411' then 0 else 1 end limit 1`);
  return {
    bookCurrency: (await q(sql<{ c: string }>`select books_currency(${businessId}::uuid) as c`))[0]!.c,
    purchasesJournal: journals.find((j) => j.kind === 'purchases')?.id ?? journals[0]?.id ?? null,
    bankJournal: journals.find((j) => j.kind === 'bank')?.id ?? journals.find((j) => j.kind === 'purchases')?.id ?? journals[0]?.id ?? null,
    payableAccount: payable[0]?.id ?? null,
    expenseAccounts: await q(sql<Choice>`select id::text as id, code, name from accounts where business_id = ${businessId}::uuid and is_active and kind = 'expense'
      and not exists (select 1 from accounts c where c.parent_id = accounts.id) order by code`),
    taxCodes: (await q(sql<{ id: string; code: string; label: string; rate: string; account_id: string | null }>`select id::text as id, code, label, rate::text as rate, account_id::text as account_id
      from tax_codes where business_id = ${businessId}::uuid and kind = 'deductible' and valid_to is null order by code`))
      .map((r) => ({ id: r.id, code: r.code, label: r.label, rate: decimal(r.rate), accountId: r.account_id })),
    suppliers: await q(sql<Choice>`select id::text as id, code, name from parties where business_id = ${businessId}::uuid and is_active and kind in ('supplier', 'other') order by name`),
    payAccounts: await paymentAccounts(tx, businessId),
    categories: await listCategories(tx, businessId),
  };
}

export async function listCategories(tx: Tx, businessId: string): Promise<Category[]> {
  return (await sql<{ id: string; name: string; account_id: string; code: string; aname: string }>`
    select c.id::text as id, c.name, c.account_id::text as account_id, a.code, a.name as aname
      from spending_categories c join accounts a on a.id = c.account_id
     where c.business_id = ${businessId}::uuid and c.archived_at is null order by lower(c.name)`.execute(tx)).rows
    .map((r) => ({ id: r.id, name: r.name, accountId: r.account_id, accountCode: r.code, accountName: r.aname }));
}

/** A category: the owner's word for a cost, on one expense account of the chart. Refused when the account is not one. */
export async function addCategory(tx: Tx, businessId: string, name: string, accountId: string): Promise<'added' | 'refused'> {
  const word = name.replace(/\s+/g, ' ').trim();
  if (word.length === 0 || word.length > 60) return 'refused';
  const ok = (await sql<{ ok: boolean }>`select exists (select 1 from accounts where business_id = ${businessId}::uuid and id = ${accountId}::uuid and is_active and kind = 'expense') as ok`.execute(tx)).rows[0]?.ok;
  if (!ok) return 'refused';
  try {
    await sql`savepoint spending_category`.execute(tx);
    await sql`insert into spending_categories (business_id, name, account_id) values (${businessId}::uuid, ${word}, ${accountId}::uuid)`.execute(tx);
    await sql`release savepoint spending_category`.execute(tx);
    return 'added';
  } catch { await sql`rollback to savepoint spending_category`.execute(tx); return 'refused'; }
}
export async function archiveCategory(tx: Tx, businessId: string, id: string): Promise<boolean> {
  const r = await sql`update spending_categories set archived_at = now() where business_id = ${businessId}::uuid and id = ${id}::uuid and archived_at is null`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

export type BillInput = {
  readonly date: string; readonly label: string; readonly gross: Decimal;
  readonly supplierId: string | null; readonly newSupplier: string | null;
  readonly taxCodeId: string | null; readonly categoryId: string | null;
  /** The expense account when no category (or the category's own, read here). */
  readonly accountId: string | null;
  /** Paid on the spot from this bank or cash account; null: not yet paid, credited to the creditors account. */
  readonly payFromAccountId: string | null;
  /** The bill's own number as printed (NB008: a posted entry carries its document's reference and date). */
  readonly documentRef: string;
  /** "No number on this bill": the reference is made here (`NOREF-<date>-<n>`), and a typed one is refused with it. */
  readonly noNumber: boolean;
};
export type BillOutcome = { readonly kind: 'posted'; readonly key: string; readonly entryId: string; readonly billId: string; readonly documentRef: string }
  | { readonly kind: 'refused'; readonly reason: 'choices' | 'supplier' | 'pay_account' | 'tax_account' | 'ref_and_no_number' | 'noref_typed'; readonly detail: string | null }
  | EntryRefusal;

/** The next of Nomi's own references for a bill dated `date`: one more than the highest already in this workspace's
 *  entries for that day, under a lock per workspace so two bills posted at once never share one. */
async function nextNoref(tx: Tx, businessId: string, date: string): Promise<string> {
  await sql`select pg_advisory_xact_lock(hashtext(${`${businessId}:noref`}))`.execute(tx);
  const day = date.replace(/-/g, '');
  const r = (await sql<{ n: string }>`select coalesce(max((regexp_match(document_ref, '^NOREF-[0-9]{8}-([0-9]+)$'))[1]::int), 0)::text as n
    from journal_entries where business_id = ${businessId}::uuid and document_ref like ${`NOREF-${day}-%`}`.execute(tx)).rows[0]!;
  return norefFor(date, Number(r.n) + 1);
}

const code36 = (): string => `S-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0')}`;

/** A supplier by id, or a new one by name (code made here, `kind = 'supplier'`). */
async function supplierOf(tx: Tx, businessId: string, id: string | null, name: string | null): Promise<string | null> {
  if (id) {
    const r = (await sql<{ id: string }>`select id::text as id from parties where business_id = ${businessId}::uuid and id = ${id}::uuid and is_active`.execute(tx)).rows[0];
    return r?.id ?? null;
  }
  const word = (name ?? '').replace(/\s+/g, ' ').trim();
  if (!word || word.length > 200) return null;
  const same = (await sql<{ id: string }>`select id::text as id from parties where business_id = ${businessId}::uuid and is_active and lower(name) = lower(${word}) limit 1`.execute(tx)).rows[0];
  if (same) return same.id;
  return (await sql<{ id: string }>`insert into parties (business_id, code, name, kind) values (${businessId}::uuid, ${code36()}, ${word}, 'supplier') returning id::text as id`.execute(tx)).rows[0]!.id;
}

/** Posts one bill as an entry and records it; `by` is the person who pressed. */
export async function recordBill(tx: Tx, businessId: string, by: string, b: BillInput, c?: SpendingChoices): Promise<BillOutcome> {
  const ch = c ?? await spendingChoices(tx, businessId);
  if (!ch.purchasesJournal || signOf(b.gross) <= 0 || !b.label.trim()) return { kind: 'refused', reason: 'choices', detail: null };
  const typed = b.documentRef.trim();
  if (b.noNumber && typed) return { kind: 'refused', reason: 'ref_and_no_number', detail: null };
  if (!b.noNumber && isNoref(typed)) return { kind: 'refused', reason: 'noref_typed', detail: null };
  if (!b.noNumber && !typed) return { kind: 'refused', reason: 'needs_document', detail: null };
  const category = b.categoryId ? ch.categories.find((x) => x.id === b.categoryId) ?? null : null;
  const accountId = category?.accountId ?? (b.accountId && ch.expenseAccounts.some((a) => a.id === b.accountId) ? b.accountId : null);
  if (!accountId) return { kind: 'refused', reason: 'choices', detail: null };
  const tax = b.taxCodeId ? ch.taxCodes.find((x) => x.id === b.taxCodeId) ?? null : null;
  if (b.taxCodeId && !tax) return { kind: 'refused', reason: 'choices', detail: null };
  if (tax && !tax.accountId) return { kind: 'refused', reason: 'tax_account', detail: tax.code };
  let payFrom: string | null = null;
  if (b.payFromAccountId) {
    if (!ch.payAccounts.some((a) => a.id === b.payFromAccountId)) return { kind: 'refused', reason: 'pay_account', detail: null };
    payFrom = b.payFromAccountId;
  } else if (!ch.payableAccount) return { kind: 'refused', reason: 'choices', detail: 'creditors' };
  const party = await supplierOf(tx, businessId, b.supplierId, b.newSupplier);
  if (!party && !payFrom) return { kind: 'refused', reason: 'supplier', detail: null };
  const { net, tax: taxAmount } = splitGross(b.gross, tax ? tax.rate : null);
  const cur = ch.bookCurrency;
  const lines: DraftLine[] = [
    { accountId, partyId: null, taxCodeId: tax?.id ?? null, currency: cur, debit: net, credit: null, label: b.label.trim().slice(0, 200), isFx: false },
    ...(tax && signOf(taxAmount) > 0 ? [{ accountId: tax.accountId!, partyId: null, taxCodeId: null, currency: cur, debit: taxAmount, credit: null, label: tax.label.slice(0, 200), isFx: false } as DraftLine] : []),
    { accountId: payFrom ?? ch.payableAccount!, partyId: payFrom ? null : party, taxCodeId: null, currency: cur, debit: null, credit: b.gross, label: null, isFx: false },
  ];
  const documentRef = b.noNumber ? await nextNoref(tx, businessId, b.date) : typed.slice(0, 120);
  const made = await draftEntry(tx, businessId, by, { journalId: ch.purchasesJournal, date: b.date, label: b.label.trim().slice(0, 200), documentRef, documentDate: b.date, lines });
  if (made.kind !== 'drafted') return made;
  const posted = await postEntry(tx, businessId, made.id, by);
  if (posted.kind !== 'posted') return posted;
  const bill = (await sql<{ id: string }>`insert into spending_bills (business_id, entry_id, party_id, category_id, gross, currency, paid_entry_id, paid_at, created_by)
    values (${businessId}::uuid, ${made.id}::uuid, ${party}::uuid, ${category?.id ?? null}::uuid, ${b.gross}::numeric, ${cur}, ${payFrom ? made.id : null}::uuid, ${payFrom ? sql`now()` : null}, ${by})
    returning id::text as id`.execute(tx)).rows[0]!.id;
  return { kind: 'posted', key: posted.key, entryId: made.id, billId: bill, documentRef };
}

export type UnpaidBill = { readonly id: string; readonly entryId: string; readonly key: string; readonly date: string; readonly label: string; readonly supplier: string | null; readonly gross: Decimal; readonly currency: string;
  /** The bill's reference; `noNumber` when it is one of Nomi's own (the paper had none). */
  readonly documentRef: string | null; readonly noNumber: boolean };
export async function unpaidBills(tx: Tx, businessId: string): Promise<UnpaidBill[]> {
  return (await sql<{ id: string; entry_id: string; key: string; date: string; label: string; supplier: string | null; gross: string; currency: string; document_ref: string | null }>`
    select b.id::text as id, b.entry_id::text as entry_id, ${ENTRY_KEY} as key, e.entry_date::text as date, e.label, p.name as supplier, b.gross::text as gross, b.currency, e.document_ref
      from spending_bills b join journal_entries e on e.id = b.entry_id join journals j on j.id = e.journal_id join fiscal_years f on f.id = e.fiscal_year_id
      left join parties p on p.id = b.party_id
     where b.business_id = ${businessId}::uuid and b.paid_entry_id is null and e.state = 'posted' order by e.entry_date, e.number`.execute(tx)).rows
    .map((r) => ({ id: r.id, entryId: r.entry_id, key: r.key, date: r.date, label: r.label, supplier: r.supplier, gross: decimal(r.gross), currency: r.currency, documentRef: r.document_ref, noNumber: isNoref(r.document_ref) }));
}

/** The payment of a bill that waited: the creditors account (its supplier) debited, the bank or cash account credited. */
export async function payBill(tx: Tx, businessId: string, by: string, billId: string, accountId: string, date: string): Promise<BillOutcome> {
  const ch = await spendingChoices(tx, businessId);
  if (!ch.payAccounts.some((a) => a.id === accountId)) return { kind: 'refused', reason: 'pay_account', detail: null };
  if (!ch.bankJournal || !ch.payableAccount) return { kind: 'refused', reason: 'choices', detail: null };
  const bill = (await sql<{ party_id: string | null; gross: string; label: string; key: string | null }>`
    select b.party_id::text as party_id, b.gross::text as gross, e.label, ${ENTRY_KEY} as key from spending_bills b join journal_entries e on e.id = b.entry_id
      join journals j on j.id = e.journal_id join fiscal_years f on f.id = e.fiscal_year_id
     where b.business_id = ${businessId}::uuid and b.id = ${billId}::uuid and b.paid_entry_id is null for update of b`.execute(tx)).rows[0];
  if (!bill) return { kind: 'refused', reason: 'choices', detail: null };
  const gross = decimal(bill.gross);
  // The payment's document is the bill's entry (its key), never the bill's own number — a NOREF bill pays the same way.
  const made = await draftEntry(tx, businessId, by, { journalId: ch.bankJournal, date, label: `${bill.label} — ${bill.key ?? ''}`.trim().slice(0, 200), documentRef: bill.key, documentDate: date, lines: [
    { accountId: ch.payableAccount, partyId: bill.party_id, taxCodeId: null, currency: ch.bookCurrency, debit: gross, credit: null, label: null, isFx: false },
    { accountId, partyId: null, taxCodeId: null, currency: ch.bookCurrency, debit: null, credit: gross, label: null, isFx: false },
  ] });
  if (made.kind !== 'drafted') return made;
  const posted = await postEntry(tx, businessId, made.id, by);
  if (posted.kind !== 'posted') return posted;
  await sql`update spending_bills set paid_entry_id = ${made.id}::uuid, paid_at = now() where business_id = ${businessId}::uuid and id = ${billId}::uuid`.execute(tx);
  return { kind: 'posted', key: posted.key, entryId: made.id, billId, documentRef: bill.key ?? '' };
}

export type Recurring = { readonly id: string; readonly label: string; readonly amount: Decimal; readonly currency: string; readonly every: Every; readonly nextOn: string;
  readonly category: string | null; readonly account: string; readonly supplier: string | null; readonly payFrom: string | null };
export async function listRecurring(tx: Tx, businessId: string): Promise<Recurring[]> {
  return (await sql<{ id: string; label: string; amount: string; currency: string; every: Every; next_on: string; category: string | null; account: string; supplier: string | null; pay_from: string | null }>`
    select r.id::text as id, r.label, r.amount::text as amount, r.currency, r.every, r.next_on::text as next_on, c.name as category,
           a.code || ' · ' || a.name as account, p.name as supplier, case when f.id is null then null else f.code || ' · ' || f.name end as pay_from
      from recurring_costs r join accounts a on a.id = r.account_id left join spending_categories c on c.id = r.category_id
      left join parties p on p.id = r.party_id left join accounts f on f.id = r.pay_from_account_id
     where r.business_id = ${businessId}::uuid and r.archived_at is null order by r.next_on, lower(r.label)`.execute(tx)).rows
    .map((r) => ({ id: r.id, label: r.label, amount: decimal(r.amount), currency: r.currency, every: r.every, nextOn: r.next_on, category: r.category, account: r.account, supplier: r.supplier, payFrom: r.pay_from }));
}
export type RecurringInput = { readonly label: string; readonly amount: Decimal; readonly every: Every; readonly firstOn: string; readonly taxCodeId: string | null;
  readonly categoryId: string | null; readonly accountId: string | null; readonly supplierId: string | null; readonly newSupplier: string | null; readonly payFromAccountId: string | null };
export async function addRecurring(tx: Tx, businessId: string, by: string, r: RecurringInput): Promise<'added' | 'refused'> {
  const ch = await spendingChoices(tx, businessId);
  const category = r.categoryId ? ch.categories.find((x) => x.id === r.categoryId) ?? null : null;
  const accountId = category?.accountId ?? (r.accountId && ch.expenseAccounts.some((a) => a.id === r.accountId) ? r.accountId : null);
  if (!accountId || !r.label.trim() || r.label.length > 120 || signOf(r.amount) <= 0) return 'refused';
  if (r.taxCodeId && !ch.taxCodes.some((x) => x.id === r.taxCodeId)) return 'refused';
  if (r.payFromAccountId && !ch.payAccounts.some((a) => a.id === r.payFromAccountId)) return 'refused';
  const party = r.supplierId || r.newSupplier ? await supplierOf(tx, businessId, r.supplierId, r.newSupplier) : null;
  if ((r.supplierId || r.newSupplier) && !party) return 'refused';
  await sql`insert into recurring_costs (business_id, label, amount, currency, tax_code_id, category_id, account_id, party_id, pay_from_account_id, every, next_on, created_by)
    values (${businessId}::uuid, ${r.label.trim()}, ${r.amount}::numeric, ${ch.bookCurrency}, ${r.taxCodeId}::uuid, ${category?.id ?? null}::uuid, ${accountId}::uuid, ${party}::uuid, ${r.payFromAccountId}::uuid, ${r.every}, ${r.firstOn}::date, ${by})`.execute(tx);
  return 'added';
}
export async function archiveRecurring(tx: Tx, businessId: string, id: string): Promise<boolean> {
  const r = await sql`update recurring_costs set archived_at = now() where business_id = ${businessId}::uuid and id = ${id}::uuid and archived_at is null`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0;
}

/** Today in the workspace's own zone: the day a cost falls due by. */
export const spendingToday = async (tx: Tx, businessId: string): Promise<string> => dayKey(new Date(), await zoneOf(tx, businessId));

/** The daily job's half: every active cost due by `today` gets one proposal for its due day (once; never a post). */
export async function proposeDue(tx: Tx, businessId: string, today: string): Promise<number> {
  const r = await sql`insert into spending_proposals (business_id, recurring_id, due_on)
    select r.business_id, r.id, r.next_on from recurring_costs r
     where r.business_id = ${businessId}::uuid and r.archived_at is null and r.next_on <= ${today}::date
    on conflict (recurring_id, due_on) do nothing`.execute(tx);
  return Number(r.numAffectedRows ?? 0);
}
export type Proposal = { readonly id: string; readonly dueOn: string; readonly label: string; readonly amount: Decimal; readonly currency: string; readonly every: Every; readonly payFrom: string | null; readonly category: string | null };
export async function waitingProposals(tx: Tx, businessId: string): Promise<Proposal[]> {
  return (await sql<{ id: string; due_on: string; label: string; amount: string; currency: string; every: Every; pay_from: string | null; category: string | null }>`
    select p.id::text as id, p.due_on::text as due_on, r.label, r.amount::text as amount, r.currency, r.every,
           case when f.id is null then null else f.code || ' · ' || f.name end as pay_from, c.name as category
      from spending_proposals p join recurring_costs r on r.id = p.recurring_id
      left join accounts f on f.id = r.pay_from_account_id left join spending_categories c on c.id = r.category_id
     where p.business_id = ${businessId}::uuid and p.state = 'waiting' order by p.due_on, lower(r.label)`.execute(tx)).rows
    .map((r) => ({ id: r.id, dueOn: r.due_on, label: r.label, amount: decimal(r.amount), currency: r.currency, every: r.every, payFrom: r.pay_from, category: r.category }));
}
/** The owner's tick: post it (through `recordBill`, dated its due day) or skip it; the schedule moves on either way. */
export async function decideProposal(tx: Tx, businessId: string, by: string, id: string, decision: 'post' | 'skip', date?: string): Promise<BillOutcome | { readonly kind: 'skipped' }> {
  const p = (await sql<{ recurring_id: string; due_on: string; label: string; amount: string; tax_code_id: string | null; category_id: string | null; account_id: string; party_id: string | null; pay_from: string | null; every: Every }>`
    select p.recurring_id::text as recurring_id, p.due_on::text as due_on, r.label, r.amount::text as amount, r.tax_code_id::text as tax_code_id, r.category_id::text as category_id,
           r.account_id::text as account_id, r.party_id::text as party_id, r.pay_from_account_id::text as pay_from, r.every
      from spending_proposals p join recurring_costs r on r.id = p.recurring_id
     where p.business_id = ${businessId}::uuid and p.id = ${id}::uuid and p.state = 'waiting' for update of p`.execute(tx)).rows[0];
  if (!p) return { kind: 'refused', reason: 'choices', detail: null };
  const advance = async () => { await sql`update recurring_costs set next_on = ${nextOn(p.due_on, p.every)}::date where id = ${p.recurring_id}::uuid and next_on <= ${p.due_on}::date`.execute(tx); };
  if (decision === 'skip') {
    await sql`update spending_proposals set state = 'skipped', decided_at = now(), decided_by = ${by} where id = ${id}::uuid`.execute(tx);
    await advance();
    return { kind: 'skipped' };
  }
  const out = await recordBill(tx, businessId, by, { date: date ?? p.due_on, label: p.label, gross: decimal(p.amount), supplierId: p.party_id, newSupplier: null,
    taxCodeId: p.tax_code_id, categoryId: p.category_id, accountId: p.account_id, payFromAccountId: p.pay_from,
    // No paper stands behind a recurring cost: the document is the schedule's line for that day.
    documentRef: `${p.label} ${p.due_on}`, noNumber: false });
  if (out.kind !== 'posted') return out;
  await sql`update spending_proposals set state = 'posted', entry_id = ${out.entryId}::uuid, decided_at = now(), decided_by = ${by} where id = ${id}::uuid`.execute(tx);
  await advance();
  return out;
}

/** The expense side of a month, for the page's one figure: posted expense debits less credits in the period. */
export async function spentBetween(tx: Tx, businessId: string, from: string, to: string): Promise<Decimal> {
  const r = (await sql<{ d: string; c: string }>`select coalesce(sum(l.debit), 0)::text as d, coalesce(sum(l.credit), 0)::text as c
    from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
    where l.business_id = ${businessId}::uuid and e.state = 'posted' and a.kind = 'expense' and e.entry_date between ${from}::date and ${to}::date`.execute(tx)).rows[0]!;
  return subDecimal(decimal(r.d), decimal(r.c));
}
