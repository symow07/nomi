import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  invoiceAmount, invoiceCaption, invoiceLinkText, invoiceMailSubject, invoiceMailText, invoiceReminderSubject, invoiceReminderText, REMINDER_DAYS,
} from '../../src/core/books/invoiceWords.js';
import { promisesWhatNothingKeeps } from '../../src/core/safety/unkeptPromise.js';
import { mimeMessage } from '../../src/channels/email/senders.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { FLASH_CONFIRMATIONS, FLASH_REFUSALS, flashTone } from '../../src/core/owner/flashTone.js';
import { PRACTICE_SKIP } from '../integration/practice-tables.js';
import { REMINDER_DAYS_1, REMINDER_DAYS_2, REMINDER_HOURS } from '../../src/outbound/invoiceReminders.js';
import { DOCUMENT_CHANNELS } from '../../src/db/invoiceSending.js';
import { QUEUES } from '../../src/queue/boss.js';

/**
 * 0226 — THE WORDS THAT TRAVEL WITH AN INVOICE, and the plumbing around them that has no database: the fixed sentences
 * promise nothing and carry the invoice's own figures; a mail with a file is multipart; every new owner-facing string is
 * in five languages and classified for its banner; the three tables are known to the erasure tool and to Practice.
 */
const W = { key: 'F-2026-0001', currency: 'MAD', owed: '1440.6', business: 'Atlas Bags' };
const MIGRATION = readFileSync(fileURLToPath(new URL('../../migrations/0226_invoices_out.sql', import.meta.url)), 'utf8');

describe('0226 · the sentences', () => {
  it('the reminder names the invoice and what is owed, speaks plainly, and promises nothing (rule 90)', () => {
    const text = invoiceReminderText(W);
    expect(text).toBe('A reminder that invoice F-2026-0001 for MAD 1,440.60 is still open. If it has already been paid, thank you — nothing more is needed.');
    expect(promisesWhatNothingKeeps(text)).toBeNull();
    // "the books will catch up" was the first draft: it promised a reconciliation nothing performs.
    expect(text).not.toMatch(/catch up|will|we'll|I'll/i);
    expect(invoiceReminderSubject(W)).toBe('Reminder: invoice F-2026-0001 from Atlas Bags');
  });

  it('the caption, the mail and the link sentence carry the figures and no promise either', () => {
    expect(invoiceAmount('USD', '12')).toBe('USD 12.00');
    expect(invoiceCaption(W)).toBe('Invoice F-2026-0001 — MAD 1,440.60.');
    expect(invoiceMailSubject(W)).toBe('Invoice F-2026-0001 from Atlas Bags');
    expect(invoiceMailText(W)).toBe('Invoice F-2026-0001 for MAD 1,440.60 is attached.');
    expect(invoiceLinkText(W, 'https://nomi.test/pi/abc')).toBe('Invoice F-2026-0001 for MAD 1,440.60. The details are here: https://nomi.test/pi/abc');
    for (const s of [invoiceCaption(W), invoiceMailText(W), invoiceLinkText(W, 'https://nomi.test/pi/abc')]) expect(promisesWhatNothingKeeps(s)).toBeNull();
  });

  it('the schedule is +3 and +10 days, in the workspace\'s daytime; files go where the channel carries them', () => {
    expect(REMINDER_DAYS).toEqual({ 1: 3, 2: 10 });
    expect([REMINDER_DAYS_1, REMINDER_DAYS_2]).toEqual([3, 10]);
    expect(REMINDER_HOURS).toEqual([9, 17]);
    expect([...DOCUMENT_CHANNELS].sort()).toEqual(['email', 'messenger', 'telegram', 'whatsapp']);
    expect(QUEUES.invoiceReminders).toBe('books.invoice_reminders');
  });
});

describe('0226 · a mail with a file', () => {
  const base = { from: 'shop@example.test', to: 'ahmed@example.test', subject: 'Invoice F-2026-0001', text: 'Attached.', headers: {}, tag: null };
  const when = new Date('2026-11-06T10:00:00Z');

  it('without attachments the mail is exactly what it was: text/plain, base64', () => {
    const m = mimeMessage(base, 'id@example.test', when);
    expect(m).toContain('Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64');
    expect(m).not.toContain('multipart');
  });

  it('with a PDF it is multipart/mixed: the text first, then the file, base64, named and typed', () => {
    const bytes = new Uint8Array(Buffer.from('%PDF-1.4\n%fake\n', 'latin1'));
    const m = mimeMessage({ ...base, attachments: [{ filename: 'F-2026-0001.pdf', contentType: 'application/pdf', bytes }] }, 'id@example.test', when);
    const boundary = /multipart\/mixed; boundary="([^"]+)"/.exec(m)![1]!;
    const parts = m.split(`--${boundary}`);
    expect(parts.length).toBe(4);   // the headers, the text, the file, the closing dashes
    expect(parts[1]).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(Buffer.from(parts[1]!.split('\r\n\r\n')[1]!.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('Attached.');
    expect(parts[2]).toContain('Content-Type: application/pdf; name="F-2026-0001.pdf"');
    expect(parts[2]).toContain('Content-Disposition: attachment; filename="F-2026-0001.pdf"');
    expect(Buffer.from(parts[2]!.split('\r\n\r\n')[1]!.replace(/\r\n/g, ''), 'base64').toString('latin1')).toBe('%PDF-1.4\n%fake\n');
    expect(parts[3]!.startsWith('--')).toBe(true);
  });

  it('a file name that could break a header is made plain; a type that is no type is octet-stream', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const m = mimeMessage({ ...base, attachments: [{ filename: 'bad"name\r\n.pdf', contentType: 'not a type', bytes }] }, 'id@example.test', when);
    expect(m).toContain('Content-Type: application/octet-stream; name="bad_name__.pdf"');
    expect(m).not.toContain('bad"name');
    expect(m).not.toContain('name\r\n');
  });
});

describe('0226 · the owner\'s words, in five languages and classified', () => {
  const keys: MessageKey[] = [
    'inbox.draft.held.invoice_window', 'inbox.draft.held.invoice_language', 'inbox.draft.held.invoice_mailbox', 'inbox.draft.held.invoice_held', 'inbox.draft.held.invoice_unnamed',
    'invoice.row.title', 'invoice.row.open', 'invoice.row.send', 'invoice.send.title', 'invoice.send.off', 'invoice.send.noConversation', 'invoice.send.howPdf',
    'invoice.send.howLink', 'invoice.send.button', 'invoice.send.reminders', 'invoice.settings.title', 'invoice.settings.explain', 'invoice.settings.switch',
  ];
  it('every string is written in every locale, with its placeholders', () => {
    for (const locale of LOCALES) {
      for (const key of keys) {
        const s = t(locale, key, { key: 'F-2026-0001', name: 'Lily', channel: 'WhatsApp', days: '3' });
        expect(s.length, `${locale} ${key}`).toBeGreaterThan(3);
        expect(s, `${locale} ${key}`).not.toMatch(/\{(key|name|channel|days)\}/);
      }
      // The reminder's reasons name the invoice.
      for (const key of keys.slice(0, 5)) expect(t(locale, key, { key: 'F-2026-0001', name: 'Lily' })).toContain('F-2026-0001');
    }
  });
  it('a refused send is a refusal banner; an invoice on its way and the saved switch are confirmations', () => {
    for (const k of ['invoice.flash.ownerOnly', 'invoice.flash.window', 'invoice.flash.not_found', 'invoice.flash.not_issued', 'invoice.flash.no_conversation',
      'invoice.flash.no_address', 'invoice.flash.no_proforma', 'invoice.flash.no_channel', 'invoice.flash.off'] as MessageKey[]) {
      expect(FLASH_REFUSALS.has(k), k).toBe(true); expect(flashTone(k)).toBe('bad');
    }
    for (const k of ['invoice.flash.switchedOn', 'invoice.flash.switchedOff', 'invoice.flash.sentPdf', 'invoice.flash.sentLink'] as MessageKey[]) {
      expect(FLASH_CONFIRMATIONS.has(k), k).toBe(true); expect(flashTone(k)).toBe('ok');
    }
  });
});

describe('0226 · the three tables are decided everywhere a table must be', () => {
  it('the erasure tool: the link is unrelated; a send and a reminder stay, detached from the customer (the database\'s copy is held equal by customer-erasure.test.ts)', () => {
    const tool = readFileSync(fileURLToPath(new URL('../../tools/erase-buyer.mjs', import.meta.url)), 'utf8');
    expect(tool).toContain("invoice_links: { do: 'unrelated' }");
    expect(tool).toMatch(/invoice_sends: \{\n\s+do: 'detach', detach: \['conversation_id', 'outbound_id'\]/);
    expect(tool).toMatch(/invoice_reminders: \{\n\s+do: 'detach', detach: \['conversation_id', 'outbound_id', 'draft_id'\]/);
  });
  it('the migration says the same, links every key, and wraps the erasure function whatever it is when it runs', () => {
    expect(MIGRATION).toContain("('invoice_links', 'unrelated', null, null, null, null)");
    expect(MIGRATION).toContain("('invoice_sends', 'detach', null, null, array['conversation_id','outbound_id'], null)");
    expect(MIGRATION).toContain("('invoice_reminders', 'detach', null, null, array['conversation_id','outbound_id','draft_id'], null)");
    for (const edge of ["('invoice_sends', 'conversation_id', 'conversations', 'id')", "('invoice_sends', 'outbound_id', 'outbound_messages', 'id')",
      "('invoice_reminders', 'conversation_id', 'conversations', 'id')", "('invoice_reminders', 'outbound_id', 'outbound_messages', 'id')",
      "('invoice_reminders', 'draft_id', 'drafts', 'id')"]) expect(MIGRATION).toContain(edge);
    expect(MIGRATION).toContain('rename to erase_customer_rows_before_0226');
    // The app role may not delete; the accountant sees none of it; a reminder draft outlives the ten-minute expiry.
    for (const table of ['invoice_links', 'invoice_sends', 'invoice_reminders']) {
      expect(MIGRATION).toContain(`revoke delete, truncate on ${table} from nomi_app`);
      expect(MIGRATION).toContain(`create policy not_for_accountants on ${table} as restrictive`);
    }
    expect(MIGRATION).toContain('and not exists (select 1 from invoice_reminders r where r.draft_id = d.id)');
    expect(MIGRATION).toMatch(/insert into _migrations \(version, name\) values \(226, 'invoices_out'\)/);
  });
  it('Practice never copies them', () => {
    for (const table of ['invoice_links', 'invoice_sends', 'invoice_reminders']) expect(PRACTICE_SKIP).toContain(table);
  });
});
