import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { accountantPack, type PackLine, type PackWords } from '../../src/core/books/pack.js';
import { trialBalance } from '../../src/core/books/trialBalance.js';
import { xlsxSheets, xlsxWrite } from '../../src/net/xlsx.js';
import type { Decimal } from '../../src/core/types/decimal.js';

/** D3 (Phase 5, item 2) — the accountant pack: its sheets agree with each other, and each prints its page numbers. */
const d = (s: string) => s as Decimal;
/** Each column's word is its own key: enough to read the sheets by. */
const col = new Proxy({}, { get: (_t, k) => String(k) }) as PackWords['col'];
const W: PackWords = { col, opening: 'Opening', closing: 'Closing', total: 'Total', earlier: 'Earlier', taxAccounts: 'Tax accounts',
  sheets: { about: 'About', trial: 'Trial balance', journal: 'Journal', ledger: 'General ledger', tax: 'Tax by code' },
  about: { entity: 'Business', period: 'Period', made: 'Made', software: 'Made with', currency: 'Currency', note: 'A working copy' } };
const line = (journal: string, number: number, day: string, account: string, dr: string, cr: string): PackLine => ({
  journalCode: journal, journalName: journal, number, entryDate: day, documentRef: `P-${number}`, documentDate: day, accountCode: account, accountName: account,
  partyCode: null, partyName: null, label: 'x', bookDebit: d(dr), bookCredit: d(cr), currency: 'MAD', foreign: null, postedAt: `${day}T10:00:00Z` });

describe('D3 · the accountant pack', () => {
  const tb = trialBalance([
    { code: '5141', name: 'Banque', kind: 'asset', opening: d('100'), periodDebit: d('50'), periodCredit: d('20') },
    { code: '7111', name: 'Ventes', kind: 'income', opening: d('-100'), periodDebit: d('0'), periodCredit: d('50') },
    { code: '6111', name: 'Achats', kind: 'expense', opening: d('0'), periodDebit: d('20'), periodCredit: d('0') },
  ], d('0'));
  const lines = [line('VE', 1, '2026-03-02', '5141', '50', '0'), line('VE', 1, '2026-03-02', '7111', '0', '50'),
    line('AC', 1, '2026-03-05', '6111', '20', '0'), line('AC', 1, '2026-03-05', '5141', '0', '20')];
  const sheets = accountantPack({ entity: 'Atlas & Fils', from: '2026-03-01', to: '2026-03-31', madeAt: '2026-04-01 09:00 UTC', software: 'Nomi · local build · schema 190',
    currency: 'MAD', trial: tb, lines, taxes: [], taxAccounts: [] }, W);

  it('five sheets, named within the 31 characters a workbook allows', () => {
    expect(sheets.map((s) => s.name)).toEqual(['About', 'Trial balance', 'Journal', 'General ledger', 'Tax by code']);
    expect(sheets.every((s) => s.name.length <= 31)).toBe(true);
  });

  it('each account\'s ledger ends on its trial-balance closing; the journals\' totals are the period\'s', () => {
    const ledger = sheets[3]!.rows;
    const closingOf = (code: string) => ledger.find((r) => r[0] === code && r[5] === 'Closing')![9];
    expect([closingOf('5141'), closingOf('7111'), closingOf('6111')]).toEqual([{ number: '130' }, { number: '-150' }, { number: '20' }]);
    const totals = sheets[2]!.rows.filter((r) => typeof r[0] === 'string' && r[0].startsWith('Total '));
    const sum = (i: number) => totals.reduce((s, r) => s + Number((r[i] as { number: string }).number), 0);
    expect([sum(11), sum(12)]).toEqual([70, 70]);
    expect([tb.totals.period.debit, tb.totals.period.credit]).toEqual(['70', '70']);
  });

  it('written, each sheet prints whose books, the period, the software and its page numbers — an & in a name kept as itself', () => {
    const file = xlsxWrite(sheets.map((s) => ({ name: s.name, rows: s.rows, print: { left: 'Atlas & Fils', centre: s.title, right: '2026-03-01 – 2026-03-31', footLeft: 'Nomi · local build' } })));
    // the first sheet's XML, out of the zip
    const nameAt = file.indexOf(Buffer.from('xl/worksheets/sheet1.xml'));
    const size = file.readUInt32LE(nameAt - 30 + 18); const start = nameAt + 'xl/worksheets/sheet1.xml'.length;
    const xml = inflateRawSync(file.subarray(start, start + size)).toString('utf8');
    expect(xml).toContain('<oddHeader>&amp;LAtlas &amp;&amp; Fils&amp;CAbout&amp;R2026-03-01 – 2026-03-31</oddHeader>');
    expect(xml).toContain('<oddFooter>&amp;LNomi · local build&amp;R&amp;P / &amp;N</oddFooter>');
    // and it reads back: the trial balance's figures as numbers
    const back = xlsxSheets(file)!;
    const trial = back.sheets.find((s) => s.name === 'Trial balance')!;
    expect([...trial.rows.values()].find((r) => r[0]?.text === '5141')!.map((c) => c.text)).toEqual(['5141', 'Banque', '100', '0', '50', '20', '130', '0']);
  });
});
