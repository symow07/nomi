import { describe, it, expect } from 'vitest';
import { renderSpending, renderPaper } from '../../src/api/web/booksPapers.js';
import { decimal } from '../../src/core/types/decimal.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import type { OverviewPaper } from '../../src/db/booksOverview.js';
import type { ReadingRow } from '../../src/db/booksDocuments.js';

/**
 * F24 (UI correction, Block 5) — receipts as spending records: the page's title first, each receipt with a thumbnail of
 * the kept original, what was read so far (a missing fact said, never a zero or a dash) and its state; on a receipt the
 * reading, the draft form and the read button sit beside the original. Nothing read is posted from here.
 */
const owner = { isOwner: true };
const accountant = { isOwner: false, kind: 'accountant' as const };
const base = { id: 'p1', name: 'receipt.png', mediaType: 'image/png', addedOn: '2026-11-19', entryId: null, readSupplier: null, readDate: null, readTotal: null, readCurrency: null };
const paper = (o: Partial<OverviewPaper>): OverviewPaper => ({ ...base, state: 'unread', lastOutcome: null, ...o });
const pageOf = (rows: OverviewPaper[]) => ({ rows, total: rows.length, from: 1, to: rows.length, page: 1, pageSize: 50, next: null, prev: null });
const choices = { journals: [{ id: 'j', code: 'PJ', name: 'Purchases' }], parties: [], accounts: [{ id: 'a', code: '6000', name: 'Costs' }], taxCodes: [], payableDefault: null, purchasesDefault: 'j' };
const reading = (o: Partial<ReadingRow['reading'] & object> = {}): ReadingRow => ({ id: 'r1', readAt: '2026-11-19T09:00:00Z', outcome: 'read', modelId: 'm', problems: [], entryId: null,
  reading: { kind: 'receipt', supplierName: 'Corner Print Shop', supplierTaxId: null, number: 'PRN-1', date: '2026-11-14', currency: 'USD', total: decimal('45.90'), lines: [{ label: 'Flyers', net: decimal('45.90'), taxRate: decimal('0'), tax: decimal('0') }], ...o } });

describe('F24 · receipts', () => {
  it('the title comes before the spending book; the receipts follow under their own heading', () => {
    const html = renderSpending('en', owner, pageOf([]), true, { book: '<section class="books-spending-book">BOOK</section>' });
    expect(html.indexOf('<h1')).toBeLessThan(html.indexOf('BOOK'));
    expect(html.indexOf('BOOK')).toBeLessThan(html.indexOf('id="receipts"'));
    expect(html).toContain('<h2 id="receipts-title">Receipts and bills</h2>');
  });
  it('each receipt shows a thumbnail, what was read so far and its state; missing is said, never zero', () => {
    const html = renderSpending('en', owner, pageOf([
      paper({ id: 'p1', state: 'ready', lastOutcome: 'read', readSupplier: 'Corner Print Shop', readDate: '2026-11-14', readTotal: '45.90', readCurrency: 'USD' }),
      paper({ id: 'p2', state: 'ready', lastOutcome: 'read', readSupplier: null, readDate: null, readTotal: null, readCurrency: null }),
      paper({ id: 'p3' }), paper({ id: 'p4', state: 'problem', lastOutcome: 'unreadable' }), paper({ id: 'p5', mediaType: 'application/pdf' })]), true);
    const row = (id: string) => html.slice(html.indexOf(`id="paper-${id}"`), html.indexOf('</li>', html.indexOf(`id="paper-${id}"`)));
    expect(row('p1')).toContain('<img src="/app/books/spending/p1/preview" alt="" loading="lazy"');
    expect(row('p1')).toContain('Corner Print Shop'); expect(row('p1')).toContain('$45.90'); expect(row('p1')).toContain('Nov 14, 2026'); expect(row('p1')).toContain('Ready to make a draft');
    expect(row('p2').match(/>Not found</g)?.length).toBe(3); expect(row('p2')).not.toContain('$0');
    expect(row('p3')).toContain('Supplier, date and total: not read yet'); expect(row('p3')).toContain('Not read yet');
    expect(row('p4')).toContain('Supplier, date and total: not found in the reading');
    expect(row('p5')).not.toContain('<img'); expect(row('p5')).toContain('<svg');
  });
  it('an unread receipt lists its facts as not read, the original beside them, Read it the one action', () => {
    const html = renderPaper('en', owner, { id: 'p1', name: 'receipt.png', mediaType: 'image/png', readings: [] }, choices, { available: true, canRead: true }, { previewHref: '/app/books/spending/p1/preview' });
    const side = html.slice(html.indexOf('class="bs-side"'));
    expect(html.indexOf('bs-original-image')).toBeLessThan(html.indexOf('class="bs-side"'));
    expect(side.match(/<dd>Not read yet<\/dd>/g)?.length).toBe(4);
    expect(side.match(/<button/g)?.length).toBe(1); expect(side).toContain('class="btn send" type="submit">Read it');
    expect(html).toContain('/app/books/papers/p1/file');
  });
  it('a clean reading: the draft form beside the original, then Read it again; a missing fact is said', () => {
    const html = renderPaper('en', owner, { id: 'p1', name: 'receipt.png', mediaType: 'image/png', readings: [reading({ number: null })] }, choices, { available: true, canRead: true });
    const side = html.slice(html.indexOf('class="bs-side"'));
    expect(side.indexOf('What Nomi read')).toBeLessThan(side.indexOf('id="draft"'));
    expect(side.indexOf('Save the draft')).toBeLessThan(side.indexOf('Read it again'));
    expect(side).toContain('<dd>Not found</dd>'); expect(side).not.toContain('<bdi>—</bdi>');
    const read = renderPaper('en', accountant, { id: 'p1', name: 'receipt.png', mediaType: 'image/png', readings: [reading()] }, choices, { available: true, canRead: true });
    expect(read).not.toContain('method="post"'); expect(read).toContain('Corner Print Shop');
  });
  it('the new words are in all five languages', () => {
    for (const k of ['receipt.title', 'receipt.added', 'receipt.notReadFacts', 'receipt.noFacts', 'receipt.notFound', 'receipt.notRead', 'receipt.nothingRead'] as const)
      for (const l of LOCALES) { expect(messages[l][k], `${l} ${k}`).toBeTruthy(); if (l !== 'en') expect(messages[l][k]).not.toBe(messages.en[k]); }
  });
});
