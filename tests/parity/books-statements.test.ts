import { describe, it, expect } from 'vitest';
import { readStatement, statementFormatOf } from '../../src/core/books/statements.js';

/** C3 (Phase 5, item 4) — a bank statement read from its file: CSV, OFX (SGML and XML), CAMT.053. */
const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>MAD
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260420120000.000[+1:CET]
<TRNAMT>1440.60
<FITID>BMCE-20260420-0001
<NAME>VIR ATLAS TEXTILES
<MEMO>F-2026-0001
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260421
<TRNAMT>-380.00
<FITID>BMCE-20260421-0002
<NAME>RIF COTON
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
<BkToCstmrStmt><Stmt><Id>STMT-2026-04</Id>
<Ntry><Amt Ccy="EUR">1250.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-04-09</Dt></BookgDt>
  <AcctSvcrRef>BNP-77812</AcctSvcrRef><NtryDtls><TxDtls><RmtInf><Ustrd>Hamburg Taschen GmbH F-2026-0003</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
<Ntry><Amt Ccy="EUR">12.50</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><DtTm>2026-04-10T09:00:00</DtTm></BookgDt>
  <AddtlNtryInf>Frais bancaires &amp; commission</AddtlNtryInf></Ntry>
<Ntry><Amt Ccy="EUR">99.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>PDNG</Sts><BookgDt><Dt>2026-04-11</Dt></BookgDt></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

describe('C3 · a bank statement, read from its file', () => {
  it('knows the format from the file itself', () => {
    expect(statementFormatOf(OFX_SGML)).toBe('ofx');
    expect(statementFormatOf(CAMT)).toBe('camt053');
    expect(statementFormatOf('Date;Amount;Description\n2026-04-01;10;x')).toBe('csv');
    expect(statementFormatOf('%PDF-1.7')).toBeNull();
  });

  it('OFX (SGML, tags unclosed): the day, the signed amount exactly, the bank\'s own reference', () => {
    const r = readStatement(OFX_SGML, 'MAD');
    if (r.kind !== 'read') throw new Error('unreadable');
    expect(r.problems).toEqual([]);
    expect(r.lines).toEqual([
      { bookedOn: '2026-04-20', amount: '1440.6', currency: 'MAD', wording: 'VIR ATLAS TEXTILES · F-2026-0001', reference: 'BMCE-20260420-0001', fingerprint: 'ofx:BMCE-20260420-0001' },
      { bookedOn: '2026-04-21', amount: '-380', currency: 'MAD', wording: 'RIF COTON', reference: 'BMCE-20260421-0002', fingerprint: 'ofx:BMCE-20260421-0002' },
    ]);
  });

  it('CAMT.053: booked entries only, money out below zero, the wording and the bank\'s reference', () => {
    const r = readStatement(CAMT, 'MAD');
    if (r.kind !== 'read') throw new Error('unreadable');
    expect(r.problems).toEqual([]);
    expect(r.lines.map((l) => [l.bookedOn, l.amount, l.currency, l.wording, l.reference])).toEqual([
      ['2026-04-09', '1250', 'EUR', 'Hamburg Taschen GmbH F-2026-0003', 'BNP-77812'],
      ['2026-04-10', '-12.5', 'EUR', 'Frais bancaires & commission', null],
    ]);
  });

  it('CSV: any column order, comma or semicolon, Debit/Credit or Amount; "1.250" refused, never guessed; dates are days', () => {
    const r = readStatement('Description;Date;Debit;Credit;Currency\nCOFFEE;2026-04-02;4,50;;MAD\nCOFFEE;2026-04-02;4,50;;MAD\nSALE;2026-04-03;;1.250;MAD\nX;02/04/2026;;5;MAD', 'MAD');
    if (r.kind !== 'read') throw new Error('unreadable');
    expect(r.lines.map((l) => [l.bookedOn, l.amount, l.fingerprint])).toEqual([
      ['2026-04-02', '-4.5', '2026-04-02|-4.5|MAD|COFFEE|#1'],
      ['2026-04-02', '-4.5', '2026-04-02|-4.5|MAD|COFFEE|#2'],   // two equal coffees are two lines
    ]);
    expect(r.problems).toEqual([{ line: 4, reason: 'ambiguous_amount' }, { line: 5, reason: 'not_a_date' }]);
    const missing = readStatement('Date,Description\n2026-04-01,x', 'MAD');
    expect(missing).toMatchObject({ kind: 'read', problems: [{ line: 1, reason: 'missing_column' }] });
  });

  it('read twice, the same fingerprints — that is what lets the read-in refuse a line it already has', () => {
    const a = readStatement(OFX_SGML, 'MAD'); const b = readStatement(OFX_SGML, 'MAD');
    if (a.kind !== 'read' || b.kind !== 'read') throw new Error('unreadable');
    expect(b.lines.map((l) => l.fingerprint)).toEqual(a.lines.map((l) => l.fingerprint));
  });
});
