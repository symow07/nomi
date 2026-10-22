import type { Decimal } from '../types/decimal.js';

/**
 * D4 (Phase 5, item 10) — THE MOROCCAN FEC, « Fichier des Ecritures Comptables », as CNC Avis n° 24 (14 June 2023)
 * lists it in its annex, point 3: for each fiscal year, every entry of every journal, with at least these fields, in
 * this order, under these names. Read from the ministry's own PDF (docs/PHASE-5.md, D4).
 *
 * The Avis sets the FIELDS, not the file: no name, separator, encoding or date format, and the DGI has published no
 * upload specification yet. Those are `FEC_ENVELOPE`, one place, until it does.
 */
export const FEC_FIELDS = [
  'Code_Journal', 'Libelle_Journal', 'Num_Ecriture', 'Date_Ecriture', 'Num_Compte', 'Libelle_Compte', 'Num_Compte_Aux',
  'Libelle_Compte_Aux', 'Ref_Piece', 'Date_Piece', 'Libelle_Ecriture', 'Montant_Debit', 'Montant_Credit', 'Lettrage_Ecriture',
  'Date_Lettrage', 'Date_Validation', 'Montant_Devise', 'Id_devise',
] as const;

/**
 * E2 (0206) — THE BUSINESS'S OWN IDENTIFIERS, after the eighteen, on every line: its ICE, its IF, its RC and the
 * court that holds it. The Avis lists the fields a FEC holds « au minimum » and names none for the business itself;
 * these names are Nomi's, in this one place, until the DGI publishes its own. Empty where the owner has not given one.
 */
export const FEC_IDENTITY_FIELDS = ['ICE', 'Identifiant_Fiscal', 'Num_RC', 'Tribunal_RC'] as const;
export type FecIdentity = { readonly ice: string | null; readonly taxId: string | null; readonly rc: string | null; readonly rcCourt: string | null };
export const NO_IDENTITY: FecIdentity = { ice: null, taxId: null, rc: null, rcCourt: null };

/**
 * The file around the fields — NOT set by Avis 24, so a choice of Nomi's until the DGI publishes its own: UTF-8, one
 * header line of the field names, `|` between fields (a character no field of Nomi's carries once cleaned), dates
 * as AAAAMMJJ, amounts with a full stop and two decimals, lines ended by CR LF.
 */
export const FEC_ENVELOPE = { separator: '|', lineEnd: '\r\n', dateFormat: 'AAAAMMJJ', decimal: '.' } as const;

export type FecLine = {
  readonly journalCode: string; readonly journalName: string; readonly number: number; readonly entryDate: string;
  readonly accountCode: string; readonly accountName: string; readonly partyCode: string | null; readonly partyName: string | null;
  readonly documentRef: string; readonly documentDate: string; readonly label: string;
  readonly debit: Decimal; readonly credit: Decimal; readonly validatedOn: string;
  /** A line in another currency than the books': its own amount (signed: a credit below zero) and its currency. */
  readonly foreign: { readonly amount: Decimal; readonly currency: string } | null;
};

const day = (iso: string) => iso.slice(0, 10).replace(/-/g, '');
/** A field's text as the file can carry it: no separator, no line break. */
const field = (s: string | null) => (s ?? '').replace(/[|\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
const amount = (d: Decimal) => {
  const [i, f = ''] = String(d).replace(/^-/, '').split('.');
  return `${String(d).startsWith('-') ? '-' : ''}${i}.${(f + '00').slice(0, 2)}`;
};

export function fecFile(lines: readonly FecLine[], identity: FecIdentity): string {
  const e = FEC_ENVELOPE;
  const who = [identity.ice, identity.taxId, identity.rc, identity.rcCourt];
  const rows = lines.map((l) => [
    l.journalCode, l.journalName, String(l.number), day(l.entryDate), l.accountCode, l.accountName, l.partyCode, l.partyName,
    l.documentRef, day(l.documentDate), l.label, amount(l.debit), amount(l.credit), '', '', day(l.validatedOn),
    l.foreign ? amount(l.foreign.amount) : '', l.foreign ? l.foreign.currency : '', ...who,
  ].map(field).join(e.separator));
  return [[...FEC_FIELDS, ...FEC_IDENTITY_FIELDS].join(e.separator), ...rows].join(e.lineEnd) + e.lineEnd;
}

/**
 * Avis 24, annex 2.2 b — the CHECK PROGRAM: in each journal of a fiscal year, the posted entries' numbers are 1 … n,
 * no gap, no repeat. `numbers` per journal; what is wrong, said per journal (the database's own rules make it
 * impossible — this is the check the Avis asks a system to be able to run, and to show).
 */
export function numberingProblems(numbers: ReadonlyMap<string, readonly number[]>): { readonly journal: string; readonly missing: number[]; readonly repeated: number[] }[] {
  const out: { journal: string; missing: number[]; repeated: number[] }[] = [];
  for (const [journal, ns] of [...numbers].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const seen = new Map<number, number>();
    for (const n of ns) seen.set(n, (seen.get(n) ?? 0) + 1);
    const max = Math.max(0, ...ns);
    const missing = Array.from({ length: max }, (_, i) => i + 1).filter((n) => !seen.has(n));
    const repeated = [...seen].filter(([, c]) => c > 1).map(([n]) => n).sort((a, b) => a - b);
    if (missing.length > 0 || repeated.length > 0) out.push({ journal, missing, repeated });
  }
  return out;
}
