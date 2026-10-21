import { addDecimal, signOf, subDecimal, type Decimal } from '../types/decimal.js';
import type { TrialBalance } from './trialBalance.js';

/**
 * D3 (Phase 5, item 2) — THE ACCOUNTANT PACK, for every shop: what any accountant, in any country, works from — the
 * trial balance, the journal and the general ledger for a period, and what each tax code came to — in the books'
 * currency, from what is posted. Its first sheet says whose books, which period, when it was made and by what
 * (Avis 24: a report carries the entity, the period, the date made, the software; each sheet prints its page
 * numbers). It is a WORKING copy, not a filing: a country's own report comes only where verified (D4).
 *
 * Pure: the figures come in, the sheets go out; their words are the caller's (the owner's language).
 */
export type PackCell = string | { readonly number: string } | null;
export type PackSheet = { readonly name: string; readonly title: string; readonly rows: readonly (readonly PackCell[])[] };

export type PackLine = {
  readonly journalCode: string; readonly journalName: string; readonly number: number; readonly entryDate: string;
  readonly documentRef: string; readonly documentDate: string; readonly accountCode: string; readonly accountName: string;
  readonly partyCode: string | null; readonly partyName: string | null; readonly label: string;
  readonly bookDebit: Decimal; readonly bookCredit: Decimal; readonly currency: string; readonly foreign: Decimal | null; readonly postedAt: string;
};
export type PackTax = { readonly code: string; readonly label: string; readonly rate: Decimal; readonly kind: string; readonly base: Decimal; readonly tax: Decimal };
export type PackTaxAccount = { readonly code: string; readonly name: string; readonly debit: Decimal; readonly credit: Decimal };

export type PackWords = {
  readonly sheets: { readonly about: string; readonly trial: string; readonly journal: string; readonly ledger: string; readonly tax: string };
  readonly about: { readonly entity: string; readonly period: string; readonly made: string; readonly software: string; readonly currency: string; readonly note: string };
  readonly col: Record<'journal' | 'journalName' | 'number' | 'date' | 'document' | 'documentDate' | 'account' | 'accountName' | 'party' | 'partyName'
    | 'label' | 'debit' | 'credit' | 'currency' | 'foreign' | 'posted' | 'balance' | 'openingDebit' | 'openingCredit' | 'periodDebit' | 'periodCredit'
    | 'closingDebit' | 'closingCredit' | 'code' | 'rate' | 'kind' | 'base' | 'tax', string>;
  readonly opening: string; readonly closing: string; readonly total: string; readonly earlier: string; readonly taxAccounts: string;
};

export type PackInput = {
  readonly entity: string; readonly from: string; readonly to: string; readonly madeAt: string; readonly software: string; readonly currency: string;
  readonly trial: TrialBalance; readonly lines: readonly PackLine[]; readonly taxes: readonly PackTax[]; readonly taxAccounts: readonly PackTaxAccount[];
};

const n = (d: Decimal): PackCell => ({ number: d });
const ZERO = '0' as Decimal;

export function accountantPack(p: PackInput, w: PackWords): PackSheet[] {
  const about: PackSheet = { name: w.sheets.about, title: w.sheets.about, rows: [
    [w.about.entity, p.entity], [w.about.period, `${p.from} – ${p.to}`], [w.about.made, p.madeAt], [w.about.software, p.software],
    [w.about.currency, p.currency], [], [w.about.note],
  ] };

  const trial: PackSheet = { name: w.sheets.trial, title: w.sheets.trial, rows: [
    [w.col.account, w.col.accountName, w.col.openingDebit, w.col.openingCredit, w.col.periodDebit, w.col.periodCredit, w.col.closingDebit, w.col.closingCredit],
    ...p.trial.rows.map((r) => [r.code ?? '', r.kind === 'earlier_result' ? w.earlier : r.name ?? '',
      n(r.opening.debit), n(r.opening.credit), n(r.period.debit), n(r.period.credit), n(r.closing.debit), n(r.closing.credit)]),
    [w.total, '', n(p.trial.totals.opening.debit), n(p.trial.totals.opening.credit), n(p.trial.totals.period.debit), n(p.trial.totals.period.credit),
      n(p.trial.totals.closing.debit), n(p.trial.totals.closing.credit)],
  ] };

  // The journal: every posted line of the period, journal by journal, entry by entry; each journal's total.
  const journalRows: PackCell[][] = [[w.col.journal, w.col.journalName, w.col.number, w.col.date, w.col.document, w.col.documentDate, w.col.account,
    w.col.accountName, w.col.party, w.col.partyName, w.col.label, w.col.debit, w.col.credit, w.col.currency, w.col.foreign, w.col.posted]];
  const byJournal = new Map<string, PackLine[]>();
  for (const l of p.lines) byJournal.set(l.journalCode, [...(byJournal.get(l.journalCode) ?? []), l]);
  for (const [code, lines] of [...byJournal].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const sorted = [...lines].sort((a, b) => a.number - b.number);
    for (const l of sorted) {
      journalRows.push([l.journalCode, l.journalName, n(String(l.number) as Decimal), l.entryDate, l.documentRef, l.documentDate, l.accountCode, l.accountName,
        l.partyCode, l.partyName, l.label, n(l.bookDebit), n(l.bookCredit), l.foreign ? l.currency : null, l.foreign ? n(l.foreign) : null, l.postedAt]);
    }
    const dr = sorted.reduce((s, l) => addDecimal(s, l.bookDebit), ZERO); const cr = sorted.reduce((s, l) => addDecimal(s, l.bookCredit), ZERO);
    journalRows.push([`${w.total} ${code}`, null, null, null, null, null, null, null, null, null, null, n(dr), n(cr)], []);
  }

  // The general ledger: each account, its opening, its lines with the running balance, its closing.
  const ledgerRows: PackCell[][] = [[w.col.account, w.col.date, w.col.journal, w.col.number, w.col.document, w.col.label, w.col.party, w.col.debit, w.col.credit, w.col.balance]];
  const byAccount = new Map<string, PackLine[]>();
  for (const l of p.lines) byAccount.set(l.accountCode, [...(byAccount.get(l.accountCode) ?? []), l]);
  for (const r of p.trial.rows) {
    if (r.kind === 'earlier_result' || r.code === null) continue;
    let balance = subDecimal(r.opening.debit, r.opening.credit);
    ledgerRows.push([`${r.code} · ${r.name}`, null, null, null, null, w.opening, null, null, null, n(balance)]);
    const lines = [...(byAccount.get(r.code) ?? [])].sort((a, b) => (a.entryDate < b.entryDate ? -1 : a.entryDate > b.entryDate ? 1
      : a.journalCode < b.journalCode ? -1 : a.journalCode > b.journalCode ? 1 : a.number - b.number));
    for (const l of lines) {
      balance = addDecimal(balance, subDecimal(l.bookDebit, l.bookCredit));
      ledgerRows.push([r.code, l.entryDate, l.journalCode, n(String(l.number) as Decimal), l.documentRef, l.label, l.partyCode, n(l.bookDebit), n(l.bookCredit), n(balance)]);
    }
    ledgerRows.push([r.code, null, null, null, null, w.closing, null, n(r.period.debit), n(r.period.credit), n(balance)], []);
  }

  const tax: PackSheet = { name: w.sheets.tax, title: w.sheets.tax, rows: [
    [w.col.code, w.col.label, w.col.rate, w.col.kind, w.col.base, w.col.tax],
    ...p.taxes.map((t) => [t.code, t.label, n(t.rate), t.kind, n(t.base), n(t.tax)]),
    [],
    [w.taxAccounts],
    [w.col.account, w.col.accountName, w.col.debit, w.col.credit, w.col.balance],
    ...p.taxAccounts.map((a) => {
      const net = subDecimal(a.debit, a.credit);
      return [a.code, a.name, n(a.debit), n(a.credit), n(signOf(net) === 0 ? ZERO : net)];
    }),
  ] };

  return [about, trial, { name: w.sheets.journal, title: w.sheets.journal, rows: journalRows }, { name: w.sheets.ledger, title: w.sheets.ledger, rows: ledgerRows }, tax];
}
