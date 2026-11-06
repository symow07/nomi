import { pdfAmount } from './invoicePdf.js';

/**
 * 0226 — THE FEW FIXED SENTENCES THAT TRAVEL WITH AN INVOICE. English only, as every new customer-facing sentence is
 * until a native reader signs its translation (the owner, 2026-11-06: no gate is lifted for another language). The
 * figures are the invoice's own — its number and what it is for, read from the row the database checked — and no
 * sentence here promises anything: the reminder says the invoice is open and thanks a customer who already paid; what
 * the seller does next is nothing this product knows.
 *
 * `promisesWhatNothingKeeps` (rule 90) is run over them in `tests/parity/invoice-words.test.ts`.
 */

export type InvoiceWords = {
  /** F-2026-0001 */
  readonly key: string;
  readonly currency: string;
  /** The amount still owed, as a decimal string. */
  readonly owed: string;
  readonly business: string;
};

/** "MAD 1,440.60" */
export const invoiceAmount = (currency: string, decimal: string): string => `${currency} ${pdfAmount(decimal)}`;

/** The caption beside the PDF on a channel that carries a caption (WhatsApp, Telegram). */
export const invoiceCaption = (w: InvoiceWords): string => `Invoice ${w.key} — ${invoiceAmount(w.currency, w.owed)}.`;

/** The mail that carries the PDF: its subject and its one line of text. */
export const invoiceMailSubject = (w: InvoiceWords): string => `Invoice ${w.key} from ${w.business}`;
export const invoiceMailText = (w: InvoiceWords): string =>
  `Invoice ${w.key} for ${invoiceAmount(w.currency, w.owed)} is attached.`;

/** The message on a channel that carries no file: the figures, and the proforma link where the details are. */
export const invoiceLinkText = (w: InvoiceWords, url: string): string =>
  `Invoice ${w.key} for ${invoiceAmount(w.currency, w.owed)}. The details are here: ${url}`;

/**
 * The reminder, in the assistant's voice and promising nothing: the invoice is open; a customer who has paid is
 * thanked and asked for nothing. "the books will catch up" was considered and left out — it promises a reconciliation
 * nothing here performs.
 */
export const invoiceReminderText = (w: InvoiceWords): string =>
  `A reminder that invoice ${w.key} for ${invoiceAmount(w.currency, w.owed)} is still open. `
  + 'If it has already been paid, thank you — nothing more is needed.';

export const invoiceReminderSubject = (w: InvoiceWords): string => `Reminder: invoice ${w.key} from ${w.business}`;

/** Which reminder, in the owner's card: the days after the invoice went. */
export const REMINDER_DAYS: Readonly<Record<1 | 2, number>> = { 1: 3, 2: 10 };
