/**
 * 0226 (Block 2, PR 2) — AN INVOICE AS A ONE-PAGE PDF, written by hand.
 *
 * No library: the repository had no PDF writer beyond the hand-made page `tools/check-ext.mjs` feeds the reader, and
 * an invoice needs only text, rules and figures. The page is A4, Helvetica and Helvetica-Bold from the standard
 * fourteen (every reader has them, nothing is embedded), text in WinAnsi — so a name, an address or a line that
 * holds a character WinAnsi has no code for (Chinese, Arabic, Cyrillic…) cannot be drawn, and `invoicePdf` answers
 * NULL. The caller then sends the proforma LINK instead, a page that reads any script; it never sends a PDF with the
 * customer's name mangled. Embedding Noto to draw every script is a later change, and this is where it goes.
 *
 * What the page says is in ENGLISH, as the text proforma on the order page is ("as most buyers expect it",
 * docs/PROFORMA-LINK.md "Two proformas, two language rules"): the words are few and fixed, and the figures are the
 * invoice's own, as the database checked them. Aligning its language with the owner's or the customer's is the same
 * later decision the proforma's is.
 *
 * NO PAYMENT DETAILS, on purpose — the proforma link's rule (docs/PROFORMA-LINK.md "No bank details"), for the same
 * reason: the document is made to be forwarded, and a forwardable document carrying an account number is how invoice
 * fraud works. The page says so in one line, so the customer asks the seller.
 *
 * Deterministic for the same view (no date of printing, no random id), so a test can hold the bytes to the figures.
 */

export type InvoicePdfParty = {
  readonly name: string;
  readonly address: string | null;
  /** Identifiers as the books print them ("ICE 001234567000089", "VAT GB123456789"), one a line. */
  readonly lines: readonly string[];
};

export type InvoicePdfLine = {
  readonly label: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly net: string;
  readonly tax: string;
  readonly taxCode: string | null;
};

export type InvoicePdfView = {
  /** F-2026-0001 */
  readonly key: string;
  readonly seller: InvoicePdfParty;
  readonly billedTo: InvoicePdfParty;
  readonly issueDate: string;
  readonly dueDate: string | null;
  readonly currency: string;
  readonly label: string | null;
  readonly lines: readonly InvoicePdfLine[];
  readonly totals: {
    readonly net: string; readonly tax: string; readonly total: string;
    readonly credited: string; readonly paid: string; readonly owed: string;
  };
};

/** One page holds this many lines; a longer invoice goes as the link (a second page is a later change). */
export const INVOICE_PDF_MAX_LINES = 28;

// ── WinAnsi ────────────────────────────────────────────────────────────────────────────────────────────────────────
const WINANSI_EXTRA: Readonly<Record<string, number>> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91,
  '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98,
  '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
};

/** The WinAnsi code of one character, or null where the encoding has none. Tabs and line breaks read as a space. */
export function winAnsiCode(ch: string): number | null {
  const cp = ch.codePointAt(0) ?? -1;
  if (cp === 0x09 || cp === 0x0A || cp === 0x0D) return 0x20;
  if (cp >= 0x20 && cp <= 0x7E) return cp;
  if (cp >= 0xA0 && cp <= 0xFF) return cp;
  return WINANSI_EXTRA[ch] ?? null;
}

/** Whether every character of the text can be drawn. */
export const winAnsiEncodable = (text: string): boolean => [...text].every((ch) => winAnsiCode(ch) !== null);

// Helvetica's advance widths (AFM, per 1000 em) for 0x20–0x7E; anything else is read as 556 (a digit's width).
const HELVETICA: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const textWidth = (text: string, size: number): number =>
  [...text].reduce((w, ch) => { const c = ch.codePointAt(0) ?? 0; return w + (c >= 0x20 && c <= 0x7E ? HELVETICA[c - 0x20]! : 556); }, 0) * size / 1000;

/** A PDF string literal: WinAnsi bytes, ASCII written as itself (escaped), the rest as octal. */
function literal(text: string): string {
  let out = '(';
  for (const ch of text) {
    const code = winAnsiCode(ch);
    if (code === null) throw new Error('not WinAnsi');
    if (code === 0x28 || code === 0x29 || code === 0x5C) out += `\\${String.fromCharCode(code)}`;
    else if (code >= 0x20 && code <= 0x7E) out += String.fromCharCode(code);
    else out += `\\${code.toString(8).padStart(3, '0')}`;
  }
  return `${out})`;
}

// ── figures ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** "1440.6" → "1,440.60"; a quantity keeps the decimals it has, trailing zeros trimmed. */
export function pdfAmount(decimal: string, places: number | null = 2): string {
  const neg = decimal.trim().startsWith('-');
  const [i = '0', f = ''] = decimal.trim().replace(/^[-+]/, '').split('.');
  const whole = i.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = places === null ? f.replace(/0+$/, '') : (f + '0'.repeat(places)).slice(0, places);
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}
const money = (currency: string, decimal: string): string => `${currency} ${pdfAmount(decimal)}`;

// ── the page ───────────────────────────────────────────────────────────────────────────────────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const RIGHT = PAGE_W - MARGIN;

type Pen = { ops: string[] };
const text = (pen: Pen, font: 'F1' | 'F2', size: number, x: number, y: number, s: string): void => {
  pen.ops.push(`BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm ${literal(s)} Tj ET`);
};
const textRight = (pen: Pen, font: 'F1' | 'F2', size: number, right: number, y: number, s: string): void =>
  text(pen, font, size, right - textWidth(s, size), y, s);
const rule = (pen: Pen, y: number, x1 = MARGIN, x2 = RIGHT): void => {
  pen.ops.push(`0.5 w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`);
};
/** Cut a label to the column: never wrapped, so a long description ends in an ellipsis rather than a spill. */
const fit = (s: string, size: number, width: number): string => {
  if (textWidth(s, size) <= width) return s;
  const chars = [...s];
  while (chars.length && textWidth(`${chars.join('')}…`, size) > width) chars.pop();
  return `${chars.join('')}…`;
};
const addressLines = (p: InvoicePdfParty): string[] =>
  [...(p.address ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean), ...p.lines.map((l) => l.trim()).filter(Boolean)];

/** The file name the document is sent under: its key, nothing else ("F-2026-0001.pdf"). */
export const invoicePdfFilename = (key: string): string => `${key.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;

/**
 * The PDF's bytes, or null: a text WinAnsi cannot draw, or more lines than one page holds. The caller falls back to
 * the proforma link in both cases.
 */
export function invoicePdf(v: InvoicePdfView): Uint8Array | null {
  const every = [
    v.key, v.seller.name, ...addressLines(v.seller), v.billedTo.name, ...addressLines(v.billedTo),
    v.issueDate, v.dueDate ?? '', v.currency, v.label ?? '',
    ...v.lines.flatMap((l) => [l.label, l.quantity, l.unitPrice, l.net, l.tax, l.taxCode ?? '']),
  ];
  if (!every.every(winAnsiEncodable)) return null;
  if (v.lines.length > INVOICE_PDF_MAX_LINES || v.lines.length === 0) return null;

  const pen: Pen = { ops: [] };
  let y = PAGE_H - MARGIN - 10;
  // Seller, top left; the document's name and number, top right.
  text(pen, 'F2', 14, MARGIN, y, fit(v.seller.name, 14, 300));
  textRight(pen, 'F2', 18, RIGHT, y, 'INVOICE');
  y -= 18;
  textRight(pen, 'F1', 11, RIGHT, y + 2, v.key);
  for (const line of addressLines(v.seller).slice(0, 6)) { text(pen, 'F1', 9.5, MARGIN, y, fit(line, 9.5, 300)); y -= 12; }
  y -= 10;
  // Dates and the reference.
  const meta: [string, string][] = [['Issued', v.issueDate], ...(v.dueDate ? [['Due', v.dueDate] as [string, string]] : []),
    ...(v.label ? [['Reference', v.label] as [string, string]] : [])];
  let my = PAGE_H - MARGIN - 48;
  for (const [k, val] of meta) {
    textRight(pen, 'F1', 9.5, RIGHT - 110, my, k);
    textRight(pen, 'F1', 9.5, RIGHT, my, fit(val, 9.5, 100));
    my -= 12;
  }
  y = Math.min(y, my) - 14;
  // Bill to.
  text(pen, 'F2', 9.5, MARGIN, y, 'Bill to'); y -= 13;
  text(pen, 'F1', 11, MARGIN, y, fit(v.billedTo.name, 11, 400)); y -= 13;
  for (const line of addressLines(v.billedTo).slice(0, 6)) { text(pen, 'F1', 9.5, MARGIN, y, fit(line, 9.5, 400)); y -= 12; }
  y -= 14;
  // The table: description | qty | unit price | tax | net.
  const col = { qty: MARGIN + 290, unit: MARGIN + 365, tax: MARGIN + 430, net: RIGHT };
  text(pen, 'F2', 9, MARGIN, y, 'Description');
  textRight(pen, 'F2', 9, col.qty, y, 'Qty');
  textRight(pen, 'F2', 9, col.unit, y, 'Unit price');
  textRight(pen, 'F2', 9, col.tax, y, 'Tax');
  textRight(pen, 'F2', 9, col.net, y, 'Net');
  y -= 5; rule(pen, y); y -= 13;
  for (const l of v.lines) {
    text(pen, 'F1', 9.5, MARGIN, y, fit(l.label, 9.5, 225));
    textRight(pen, 'F1', 9.5, col.qty, y, pdfAmount(l.quantity, null));
    textRight(pen, 'F1', 9.5, col.unit, y, pdfAmount(l.unitPrice));
    textRight(pen, 'F1', 9.5, col.tax, y, l.taxCode ? `${pdfAmount(l.tax)} ${fit(l.taxCode, 9.5, 40)}` : pdfAmount(l.tax));
    textRight(pen, 'F1', 9.5, col.net, y, pdfAmount(l.net));
    y -= 14;
  }
  y += 4; rule(pen, y); y -= 16;
  // Totals, right.
  const totals: [string, string, 'F1' | 'F2'][] = [
    ['Net', money(v.currency, v.totals.net), 'F1'],
    ['Tax', money(v.currency, v.totals.tax), 'F1'],
    ['Total', money(v.currency, v.totals.total), 'F2'],
    ...(v.totals.credited !== '0' && v.totals.credited !== '0.00' ? [['Credited', money(v.currency, v.totals.credited), 'F1'] as [string, string, 'F1']] : []),
    ...(v.totals.paid !== '0' && v.totals.paid !== '0.00' ? [['Paid', money(v.currency, v.totals.paid), 'F1'] as [string, string, 'F1']] : []),
    ['Amount due', money(v.currency, v.totals.owed), 'F2'],
  ];
  for (const [k, val, font] of totals) {
    textRight(pen, font, 10, RIGHT - 150, y, k);
    textRight(pen, font, 10, RIGHT, y, val);
    y -= 14;
  }
  // The one line about payment details — the proforma link's rule.
  const foot = MARGIN + 24;
  rule(pen, foot + 14);
  text(pen, 'F1', 8.5, MARGIN, foot, fit(`No payment details are printed on this document on purpose. Confirm them with ${v.seller.name} directly.`, 8.5, RIGHT - MARGIN));

  const content = pen.ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title ${literal(`Invoice ${v.key}`)} /Producer (Nomi) >>`,
  ];
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
