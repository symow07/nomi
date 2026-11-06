import { sql } from 'kysely';
import type { Tx } from './client.js';
import { applyCgncChart } from './booksOrders.js';
import { holdsMoney } from '../core/books/moneyAccounts.js';
import { COUNTRY_PACKS, stateOfTaxCode, stateTaxCode, type BooksCountry, type CountryPack } from '../core/books/countryPacks.js';

/**
 * THE COUNTRY PAGE'S ROWS (Block 2 PR 1; 0225). What the page shows and what Save writes, over the workspace's own
 * rows: the country (`businesses.country`, the one column every reader of the books' country uses — retention, the
 * Moroccan gate, the FEC), the chart and tax codes the pack adds (idempotent: a code or account already there is left
 * as the owner has it), the identifier, which accounts hold money.
 */
export type CountryBooksView = {
  readonly country: string | null;
  readonly currency: string | null;
  readonly start: { readonly day: string; readonly length: 'month' | 'quarter' } | null;
  readonly firstYear: { readonly startsOn: string; readonly endsOn: string } | null;
  readonly companyNumber: string | null;
  readonly ein: string | null;
  /** Morocco's identifiers on record (0206): any of the three. */
  readonly moroccanIds: boolean;
  /** Entries posted: once any is, the country stays. */
  readonly posted: number;
  readonly accounts: number;
  /** The tax codes on record, by code (the newest version of each). */
  readonly taxCodes: readonly { readonly code: string; readonly label: string; readonly rate: string }[];
};

export async function countryBooksOf(tx: Tx, businessId: string): Promise<CountryBooksView> {
  const b = (await sql<{ country: string | null; currency: string | null; company_number: string | null; ein: string | null; ids: boolean;
    day: string | null; length: 'month' | 'quarter' | null }>`
    select b.country, b.currency, b.company_number, b.ein, (b.legal_ice is not null or b.legal_if is not null or b.legal_rc is not null) as ids,
           s.books_start::text as day, s.period_length as length
      from businesses b left join books_settings s on s.business_id = b.id where b.id = ${businessId}::uuid`.execute(tx)).rows[0];
  const year = (await sql<{ starts_on: string; ends_on: string }>`select starts_on::text as starts_on, ends_on::text as ends_on from fiscal_years
    where business_id = ${businessId}::uuid order by starts_on limit 1`.execute(tx)).rows[0];
  const counts = (await sql<{ posted: number; accounts: number }>`select
      (select count(*)::int from journal_entries where business_id = ${businessId}::uuid and state = 'posted') as posted,
      (select count(*)::int from accounts where business_id = ${businessId}::uuid) as accounts`.execute(tx)).rows[0]!;
  const taxCodes = (await sql<{ code: string; label: string; rate: string }>`select distinct on (code) code, label, rate::text as rate from tax_codes
    where business_id = ${businessId}::uuid order by code, valid_from desc`.execute(tx)).rows;
  return {
    country: b?.country ?? null, currency: b?.currency ?? null,
    start: b?.day ? { day: b.day, length: b.length ?? 'month' } : null,
    firstYear: year ? { startsOn: year.starts_on, endsOn: year.ends_on } : null,
    companyNumber: b?.company_number ?? null, ein: b?.ein ?? null, moroccanIds: b?.ids ?? false,
    posted: counts.posted, accounts: counts.accounts, taxCodes,
  };
}

/** The country, written once nothing is posted; audited by field name, as the profile's writes are. */
export async function saveBooksCountry(tx: Tx, businessId: string, country: BooksCountry, actor: string): Promise<'saved' | 'unchanged' | 'posted'> {
  const cur = (await sql<{ country: string | null; posted: number }>`select country,
      (select count(*)::int from journal_entries where business_id = ${businessId}::uuid and state = 'posted') as posted
    from businesses where id = ${businessId}::uuid`.execute(tx)).rows[0];
  if (!cur || cur.country === country) return 'unchanged';
  if (cur.posted > 0) return 'posted';
  await sql`update businesses set country = ${country} where id = ${businessId}::uuid`.execute(tx);
  await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
    values (${businessId}::uuid, null, 'update_profile', ${actor}, ${JSON.stringify({ fields: ['country'] })}::jsonb)`.execute(tx);
  return 'saved';
}

/**
 * The pack loaded: its chart (the CGNC exactly as `applyCgncChart` applies it; a plain chart through the same
 * `apply_chart_template`, then the accounts Nomi drafts with where the owner has not chosen), and its tax codes where
 * the workspace has none of that code — valid from the first fiscal year's start, else today.
 */
export async function loadCountryPack(tx: Tx, businessId: string, pack: CountryPack, validFrom: string):
  Promise<{ readonly accounts: number; readonly journals: number; readonly taxCodes: number }> {
  const chart = pack.chart === 'cgnc-normal' ? await applyCgncChart(tx, businessId) : await applyPlainChart(tx, businessId, pack);
  let taxCodes = 0;
  for (const c of pack.taxCodes) {
    const r = await sql`insert into tax_codes (business_id, code, label, rate, kind, account_id, valid_from)
      select ${businessId}::uuid, ${c.code}, ${c.label}, ${c.rate}::numeric, ${c.kind},
             ${c.account === null ? sql`null` : sql`(select id from accounts where business_id = ${businessId}::uuid and code = ${c.account})`}, ${validFrom}::date
       where not exists (select 1 from tax_codes where business_id = ${businessId}::uuid and code = ${c.code})
         and (${c.account === null} or exists (select 1 from accounts where business_id = ${businessId}::uuid and code = ${c.account}))`.execute(tx);
    taxCodes += Number(r.numAffectedRows ?? 0);
  }
  return { ...chart, taxCodes };
}

async function applyPlainChart(tx: Tx, businessId: string, pack: CountryPack): Promise<{ readonly accounts: number; readonly journals: number }> {
  const r = (await sql<{ accounts_added: number; journals_added: number }>`select * from apply_chart_template(${pack.chart})`.execute(tx)).rows[0]!;
  const id = (table: 'accounts' | 'journals', code: string) => sql`(select id from ${sql.table(table)} where business_id = ${businessId}::uuid and code = ${code})`;
  const d = pack.drafts;
  await sql`insert into books_settings (business_id, sales_journal_id, receivable_account_id, sales_account_id, fx_loss_account_id, fx_gain_account_id)
    values (${businessId}::uuid, ${id('journals', d.salesJournal)}, ${id('accounts', d.receivable)}, ${id('accounts', d.sales)}, ${id('accounts', d.fxLoss)}, ${id('accounts', d.fxGain)})
    on conflict (business_id) do update set
      sales_journal_id = coalesce(books_settings.sales_journal_id, excluded.sales_journal_id),
      receivable_account_id = coalesce(books_settings.receivable_account_id, excluded.receivable_account_id),
      sales_account_id = coalesce(books_settings.sales_account_id, excluded.sales_account_id),
      fx_loss_account_id = coalesce(books_settings.fx_loss_account_id, excluded.fx_loss_account_id),
      fx_gain_account_id = coalesce(books_settings.fx_gain_account_id, excluded.fx_gain_account_id)`.execute(tx);
  return { accounts: r.accounts_added, journals: r.journals_added };
}

/** The pack's identifier, already checked (`checkRegistry` for GB, `isEin` for US); null clears it. Audited by name. */
export async function saveCountryIdentifier(tx: Tx, businessId: string, field: 'company_number' | 'ein', value: string | null, actor: string): Promise<void> {
  const cur = (await sql<{ v: string | null }>`select ${sql.ref(field)} as v from businesses where id = ${businessId}::uuid`.execute(tx)).rows[0]?.v ?? null;
  if (cur === value) return;
  await sql`update businesses set ${sql.ref(field)} = ${value} where id = ${businessId}::uuid`.execute(tx);
  await sql`insert into channel_audit (business_id, channel_id, action, actor, detail)
    values (${businessId}::uuid, null, 'update_profile', ${actor}, ${JSON.stringify({ fields: [field] })}::jsonb)`.execute(tx);
}

/** A state's sales tax: one code per state, collected on the pack's sales-tax account, valid from today. */
export async function addStateTax(tx: Tx, businessId: string, state: string, rate: string, day: string): Promise<'added' | 'exists' | 'no_account'> {
  const account = COUNTRY_PACKS.US.salesTaxAccount!;
  const acc = (await sql<{ id: string }>`select id::text as id from accounts where business_id = ${businessId}::uuid and code = ${account} and is_active`.execute(tx)).rows[0];
  if (!acc) return 'no_account';
  const code = stateTaxCode(state);
  const r = await sql`insert into tax_codes (business_id, code, label, rate, kind, account_id, valid_from)
    select ${businessId}::uuid, ${code}, ${`Sales tax ${state}`}, ${rate}::numeric, 'collected', ${acc.id}::uuid, ${day}::date
     where not exists (select 1 from tax_codes where business_id = ${businessId}::uuid and code = ${code})`.execute(tx);
  return Number(r.numAffectedRows ?? 0) > 0 ? 'added' : 'exists';
}

/** The states with a rate on record, newest version each. */
export async function stateTaxesOf(tx: Tx, businessId: string): Promise<readonly { readonly state: string; readonly rate: string }[]> {
  const rows = (await sql<{ code: string; rate: string }>`select distinct on (code) code, rate::text as rate from tax_codes
    where business_id = ${businessId}::uuid and code like 'ST\\_%' order by code, valid_from desc`.execute(tx)).rows;
  return rows.flatMap((r) => { const s = stateOfTaxCode(r.code); return s ? [{ state: s, rate: r.rate }] : []; });
}

/**
 * Which accounts hold money: the active asset accounts with nothing under them (the ones a payment can land in), each
 * with the chart's marker and whether the code's rules already recognise it (`holdsMoney`: the CGNC's numbering or
 * the word bank / cash in its name).
 */
export async function moneyAccountChoices(tx: Tx, businessId: string):
  Promise<readonly { readonly id: string; readonly code: string; readonly name: string; readonly marked: boolean; readonly byRule: boolean }[]> {
  const rows = (await sql<{ id: string; code: string; name: string; holds_money: boolean }>`select a.id::text as id, a.code, a.name, a.holds_money from accounts a
    where a.business_id = ${businessId}::uuid and a.kind = 'asset' and a.is_active
      and not exists (select 1 from accounts c where c.business_id = a.business_id and c.parent_id = a.id and c.is_active)
    order by a.code`.execute(tx)).rows;
  return rows.map((a) => ({ id: a.id, code: a.code, name: a.name, marked: a.holds_money, byRule: holdsMoney(a.code, a.name) }));
}

/**
 * The owner's ticks: the ticked accounts hold money, the rest of the choices do not. Only the accounts the rule does not
 * already recognise are moved (those are drawn ticked and fixed, and keep the marker the chart gave them).
 */
export async function setMoneyAccounts(tx: Tx, businessId: string, ticked: readonly string[]): Promise<void> {
  const choices = (await moneyAccountChoices(tx, businessId)).filter((a) => !a.byRule).map((a) => a.id);
  const yes = choices.filter((id) => ticked.includes(id));
  await sql`update accounts set holds_money = (id = any(${yes}::uuid[])) where business_id = ${businessId}::uuid and id = any(${choices}::uuid[])`.execute(tx);
}
