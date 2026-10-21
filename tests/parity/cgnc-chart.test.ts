import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEC_FIELDS, fecFile, numberingProblems, type FecLine } from '../../src/core/books/fec.js';
import type { Decimal } from '../../src/core/types/decimal.js';

/**
 * D4 (Phase 5, item 10) — the CGNC chart and the Moroccan FEC, held to their sources. The chart: migration 0190 is
 * exactly the list read from the CNC's text page by page (docs/cgnc/plan-normal.tsv), and the accounts a shop uses
 * every day carry the titles the CGNC prints. The FEC: the eighteen fields of Avis 24, annex 3, in its order.
 */
const ROOT = join(__dirname, '..', '..');
const tsv = readFileSync(join(ROOT, 'docs/cgnc/plan-normal.tsv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
const sql = readFileSync(join(ROOT, 'migrations/0190_cgnc_chart.sql'), 'utf8');
const rows = [...sql.matchAll(/\('cgnc-normal', '([^']+)', '((?:[^']|'')*)', '(\w+)', (?:'([^']+)'|null)\)/g)]
  .map((m) => [m[1]!, m[2]!.replace(/''/g, "'"), m[3]!, m[4] ?? ''] as const);

describe('D4 · the CGNC chart, as the CNC prints it', () => {
  it('the migration is the list read from the text — 871 accounts, each with its parent, kind and title', () => {
    expect(tsv.length).toBe(871);
    expect(rows.length).toBe(871);
    const fromTsv = new Map(tsv.map(([code, parent, kind, , title]) => [code, `${parent}|${kind}|${title}`]));
    expect(new Map(rows.map(([code, title, kind, parent]) => [code, `${parent}|${kind}|${title}`]))).toEqual(fromTsv);
  });

  it('every parent is an account of the chart, and comes before its children in the migration', () => {
    const seen = new Set<string>();
    for (const [code, , , parent] of rows) {
      if (parent) expect(seen.has(parent), `${code} → ${parent}`).toBe(true);
      seen.add(code);
    }
  });

  it('the accounts used every day, with the titles the CGNC prints (Tome II, read from the page)', () => {
    const title = new Map(rows.map(([code, t]) => [code, t]));
    expect(Object.fromEntries(['1111', '1191', '3421', '3455', '4411', '4455', '5141', '5161', '6111', '6331', '7111', '7331'].map((c) => [c, title.get(c)]))).toEqual({
      1111: 'Capital social', 1191: "Résultat net de l'exercice (créditeur)", 3421: 'Clients', 3455: 'ETAT - T.V.A. récupérable',
      4411: 'Fournisseurs', 4455: 'Etat, T.V.A. facturée', 5141: 'Banques (soldes débiteurs)', 5161: 'Caisses',
      6111: 'Achats de marchandises "groupe A"', 6331: "Pertes de change propres à l'exercice", 7111: 'Ventes de marchandises au Maroc',
      7331: "Gains de change propres à l'exercice",
    });
  });

  it('each account\'s kind follows its class', () => {
    const kind = new Map(rows.map(([code, , k]) => [code, k]));
    expect([kind.get('1111'), kind.get('1410'), kind.get('2340'), kind.get('3421'), kind.get('4411'), kind.get('5141'), kind.get('5541'), kind.get('6111'), kind.get('7111')])
      .toEqual(['equity', 'liability', 'asset', 'asset', 'liability', 'asset', 'liability', 'expense', 'income']);
  });
});

describe('D4 · the Moroccan FEC (CNC Avis n° 24, annex 3)', () => {
  const d = (s: string) => s as Decimal;
  const line = (o: Partial<FecLine> = {}): FecLine => ({ journalCode: 'VE', journalName: 'Ventes', number: 1, entryDate: '2026-04-02', accountCode: '3421',
    accountName: 'Clients', partyCode: 'C001', partyName: 'Atlas | Fils', documentRef: 'F-2026-0001', documentDate: '2026-04-02', label: 'Facture\nF-2026-0001',
    debit: d('1440.6'), credit: d('0'), validatedOn: '2026-04-03', foreign: null, ...o });

  it('the eighteen fields, named and ordered as the Avis lists them', () => {
    expect(FEC_FIELDS).toEqual(['Code_Journal', 'Libelle_Journal', 'Num_Ecriture', 'Date_Ecriture', 'Num_Compte', 'Libelle_Compte', 'Num_Compte_Aux',
      'Libelle_Compte_Aux', 'Ref_Piece', 'Date_Piece', 'Libelle_Ecriture', 'Montant_Debit', 'Montant_Credit', 'Lettrage_Ecriture', 'Date_Lettrage',
      'Date_Validation', 'Montant_Devise', 'Id_devise']);
  });

  it('a line: its party as the auxiliary account, amounts to the cent, dates as AAAAMMJJ, the currency only where foreign; no field carries the separator', () => {
    const file = fecFile([line(), line({ accountCode: '7111', accountName: 'Ventes de marchandises au Maroc', partyCode: null, partyName: null, debit: d('0'),
      credit: d('1440.6'), foreign: { amount: d('-144.06'), currency: 'EUR' } })]);
    const [head, a, b] = file.split('\r\n');
    expect(head).toBe(FEC_FIELDS.join('|'));
    expect(a!.split('|')).toEqual(['VE', 'Ventes', '1', '20260402', '3421', 'Clients', 'C001', 'Atlas Fils', 'F-2026-0001', '20260402', 'Facture F-2026-0001',
      '1440.60', '0.00', '', '', '20260403', '', '']);
    expect(b!.split('|').slice(11)).toEqual(['0.00', '1440.60', '', '', '20260403', '-144.06', 'EUR']);
    expect(file.endsWith('\r\n')).toBe(true);
  });

  it('the check program (annex 2.2 b) finds a gap and a repeat, journal by journal', () => {
    expect(numberingProblems(new Map([['VE', [1, 2, 3]], ['AC', [1, 3, 3]]]))).toEqual([{ journal: 'AC', missing: [2], repeated: [3] }]);
    expect(numberingProblems(new Map([['VE', [2, 1]]]))).toEqual([]);
  });
});
