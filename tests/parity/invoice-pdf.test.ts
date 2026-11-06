import { describe, it, expect } from 'vitest';
import { invoicePdf, invoicePdfFilename, pdfAmount, winAnsiEncodable, INVOICE_PDF_MAX_LINES, type InvoicePdfView } from '../../src/core/books/invoicePdf.js';
import { invoiceLinkPath, invoiceLinkToken, invoiceLinkUrl } from '../../src/db/invoiceLinks.js';
import { documentFilename, servedByNomi } from '../../src/outbound/worker.js';

/**
 * 0226 — THE INVOICE AS A PDF, written by hand (core/books/invoicePdf.ts). The bytes are a PDF a reader opens: the
 * header, one page, the two standard fonts, a cross-reference table whose offsets point where they say. The page holds
 * the invoice's figures and names and NO payment details; a text WinAnsi cannot draw, or more lines than a page holds,
 * is refused with null so the caller sends the proforma link instead.
 */
const view = (over: Partial<InvoicePdfView> = {}): InvoicePdfView => ({
  key: 'F-2026-0001',
  seller: { name: 'Westlake Canvas Co.', address: 'Futian Market\nYiwu', lines: ['ICE 001234567000089'] },
  billedTo: { name: 'Atlas Textiles SARL', address: '12 rue des Tisserands\nCasablanca', lines: ['MA', 'ICE 001122334455667'] },
  issueDate: '2026-04-02', dueDate: '2026-05-02', currency: 'USD', label: 'Order YW-1042',
  lines: [
    { label: 'Canvas tote bag, natural', quantity: '500', unitPrice: '2.4', net: '1200.00', tax: '240.00', taxCode: 'TVA20' },
    { label: 'Printing, one colour', quantity: '1', unitPrice: '0.6', net: '0.60', tax: '0.00', taxCode: null },
  ],
  totals: { net: '1200.60', tax: '240.00', total: '1440.60', credited: '0.00', paid: '500.00', owed: '940.60' },
  ...over,
});
const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');

describe('0226 · the invoice PDF', () => {
  it('is a PDF: the header, one page, Helvetica in WinAnsi, and a cross-reference table that points where it says', () => {
    const bytes = invoicePdf(view());
    expect(bytes).not.toBeNull();
    const s = latin1(bytes!);
    expect(s.startsWith('%PDF-1.4\n')).toBe(true);
    expect(s).toContain('/Type /Pages /Kids [3 0 R] /Count 1');
    expect(s).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
    expect(s).toContain('/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding');
    expect(s.endsWith('%%EOF\n')).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(s)![1]);
    expect(s.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...s.slice(startxref).matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]));
    expect(entries.length).toBe(7);
    entries.forEach((offset, i) => expect(s.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    // The content stream's declared length is its real length.
    const [, len, stream] = /\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(s)!;
    expect(Buffer.byteLength(stream!, 'latin1')).toBe(Number(len));
  });

  it('says the invoice: its number, the seller, who is billed, each line, the totals — and the figures are the row\'s own', () => {
    const s = latin1(invoicePdf(view())!);
    for (const word of ['(F-2026-0001)', '(Westlake Canvas Co.)', '(Atlas Textiles SARL)', '(ICE 001122334455667)', '(Canvas tote bag, natural)',
      '(500)', '(2.40)', '(1,200.00)', '(240.00 TVA20)', '(USD 1,440.60)', '(USD 500.00)', '(USD 940.60)', '(Order YW-1042)', '(2026-05-02)', '(INVOICE)']) {
      expect(s, word).toContain(word);
    }
    // Nothing paid, nothing credited: those lines are not drawn.
    const unpaid = latin1(invoicePdf(view({ totals: { net: '1200.60', tax: '240.00', total: '1440.60', credited: '0.00', paid: '0.00', owed: '1440.60' } }))!);
    expect(unpaid).not.toContain('(Paid)');
    expect(unpaid).not.toContain('(Credited)');
  });

  it('carries NO payment details, by the proforma link\'s rule, and says so in one line', () => {
    const s = latin1(invoicePdf(view())!);
    expect(s).toMatch(/No payment details are printed on this document on purpose/);
    for (const word of ['IBAN', 'SWIFT', 'BIC', 'account number', 'Routing']) expect(s).not.toContain(word);
  });

  it('is deterministic for the same view', () => {
    expect(latin1(invoicePdf(view())!)).toBe(latin1(invoicePdf(view())!));
  });

  it('refuses what WinAnsi cannot draw — a Chinese or Arabic name, a line in another script — and the caller sends the link', () => {
    expect(invoicePdf(view({ billedTo: { name: '义乌纺织有限公司', address: null, lines: [] } }))).toBeNull();
    expect(invoicePdf(view({ seller: { name: 'شركة أطلس', address: null, lines: [] } }))).toBeNull();
    expect(invoicePdf(view({ lines: [{ label: 'Сумка', quantity: '1', unitPrice: '1', net: '1.00', tax: '0.00', taxCode: null }] }))).toBeNull();
    // Latin with accents, the euro sign and typographic quotes are WinAnsi: drawn.
    expect(invoicePdf(view({ billedTo: { name: 'Société Générale « Œuvres » — Zürich €', address: null, lines: [] } }))).not.toBeNull();
    expect(winAnsiEncodable('Ångström € – “quotes”')).toBe(true);
    expect(winAnsiEncodable('发票')).toBe(false);
  });

  it('refuses more lines than one page holds, and an invoice with none', () => {
    const line = { label: 'Line', quantity: '1', unitPrice: '1', net: '1.00', tax: '0.00', taxCode: null };
    expect(invoicePdf(view({ lines: Array.from({ length: INVOICE_PDF_MAX_LINES }, () => line) }))).not.toBeNull();
    expect(invoicePdf(view({ lines: Array.from({ length: INVOICE_PDF_MAX_LINES + 1 }, () => line) }))).toBeNull();
    expect(invoicePdf(view({ lines: [] }))).toBeNull();
  });

  it('escapes what a PDF string cannot hold as it is, and writes WinAnsi above ASCII as octal', () => {
    const s = latin1(invoicePdf(view({ label: 'Order (A) \\ B' }))!);
    expect(s).toContain('(Order \\(A\\) \\\\ B)');
    const accented = latin1(invoicePdf(view({ label: 'Café' }))!);
    expect(accented).toContain('(Caf\\351)');
  });

  it('formats figures: thousands commas, two decimals for money, a quantity as it is', () => {
    expect(pdfAmount('1440.6')).toBe('1,440.60');
    expect(pdfAmount('1234567.891')).toBe('1,234,567.89');
    expect(pdfAmount('0.5')).toBe('0.50');
    expect(pdfAmount('-12')).toBe('-12.00');
    expect(pdfAmount('500.0000', null)).toBe('500');
    expect(pdfAmount('2.5000', null)).toBe('2.5');
  });

  it('is named after the invoice, and the link ends in that name so every channel calls it the same', () => {
    expect(invoicePdfFilename('F-2026-0001')).toBe('F-2026-0001.pdf');
    expect(invoicePdfFilename('F/2026 0001')).toBe('F_2026_0001.pdf');
    const token = 'a'.repeat(43);
    const url = invoiceLinkUrl('https://nomi.test/', token, 'F-2026-0001');
    expect(url).toBe(`https://nomi.test${invoiceLinkPath(token, 'F-2026-0001')}`);
    expect(url).toBe(`https://nomi.test/inv/${token}/F-2026-0001.pdf`);
    expect(invoiceLinkToken(url!)).toBe(token);
    expect(documentFilename(url!)).toBe('F-2026-0001.pdf');
    expect(servedByNomi(url!, 'https://nomi.test')).toBe(true);
    expect(servedByNomi(url!, 'https://elsewhere.test')).toBe(false);
    // No public address: no link, never a guess at the host.
    expect(invoiceLinkUrl(null, token, 'F-2026-0001')).toBeNull();
    expect(invoiceLinkToken('https://nomi.test/pi/abc')).toBeNull();
    expect(invoiceLinkToken('not a url')).toBeNull();
    expect(documentFilename('https://nomi.test/inv/x/some%20file%20%C3%A9.pdf')).toBe('document.pdf');
  });
});
