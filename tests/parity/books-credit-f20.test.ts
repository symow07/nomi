import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { renderNewCreditNote, renderCreditNote, renderCreditTotal, type CreditInvoice } from '../../src/api/web/booksInvoices.js';
import { creditPreview, creditLineFigures, creditWishes, type CreditableLine, type CreditNoteView } from '../../src/db/booksCreditNotes.js';
import { decimal } from '../../src/core/types/decimal.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * F20 (UI correction, Block 5) — credit notes: the editor names its invoice and what is owed on it, takes the reason,
 * and works the credit out beside Save with what it does to the balance; the page shows the amount, its invoice and
 * that effect before Issue; the paper holds only what the customer reads; owner copy never says "posts its entry".
 */
const d = decimal;
const owner = { isOwner: true };
const accountant = { isOwner: false, kind: 'accountant' as const };
const inv: CreditInvoice = { id: 'inv', key: 'F-2026-0005', party: 'Casa Olivo', currency: 'USD', owed: d('75') };
const lines: CreditableLine[] = [
  { lineNo: 1, label: 'Beach bag', quantity: d('10'), unitPrice: d('22'), left: d('10'), leftNet: d('220'), leftTax: d('0'), rate: d('0') },
  { lineNo: 2, label: 'Tote', quantity: d('3'), unitPrice: d('1.2345'), left: d('3'), leftNet: d('3.70'), leftTax: d('0.74'), rate: d('20') },
];
const billedTo = { code: 'C3', name: 'Casa Olivo', address: null, country: 'US', ice: null, taxNumber: null, registry: null, siret: null, registro: null, asIssued: true };
const note: CreditNoteView = { id: 'cn', key: null, state: 'draft', issueDate: '2026-11-13', reason: 'Straps faulty', currency: 'USD', invoiceId: 'inv', invoiceKey: 'F-2026-0005',
  entryId: null, billedTo, total: d('44'), lines: [{ invoiceLineNo: 1, label: 'Beach bag', quantity: d('2'), net: d('44'), tax: d('0') }] };

describe('F20 · credit notes', () => {
  it('the editor names its invoice, its customer and what is owed; the reason comes before the lines; the credit sits beside Save', () => {
    const html = renderNewCreditNote('en', inv, lines, {}, [], '2026-11-19', null);
    expect(html).toContain('href="/app/books/invoices/inv"><bdi>F-2026-0005</bdi>'); expect(html).toContain('Casa Olivo'); expect(html).toContain('Still owed');
    expect(html.indexOf('name="reason"')).toBeLessThan(html.indexOf('name="qty1"'));
    expect(html).toContain('data-total="/app/books/invoices/inv/credit-notes/preview" data-total-now');
    expect(html.indexOf('data-total-out')).toBeLessThan(html.indexOf('Save the draft'));
    expect(html).toContain('$1.2345'); expect(html).not.toContain('posts its entry');
    // what the preview route answers into that place
    const answer = renderCreditTotal('en', creditPreview([{ invoiceLineNo: 1, quantity: d('10') }], lines), inv);
    expect(answer).toContain('Credit total'); expect(answer).toContain('$220.00');
    expect(answer).toContain('Still owed on F-2026-0005: $75.00 now. Once this credit note is issued, $145.00 is due back to the customer.');
  });
  it('F20 fix — without the script the editor shows no figure an edit could leave behind: the total is worked out on Save', () => {
    // the verify's case: a quantity typed over the default, and a form sent back with a problem
    for (const [values, problems] of [[{}, []], [{ qty1: '1', reason: 'Straps' }, ['Check this line.']]] as const) {
      const html = renderNewCreditNote('en', inv, lines, values, problems, '2026-11-19', null);
      const region = html.slice(html.indexOf('data-total-out'), html.indexOf('Save the draft'));
      expect(region).toContain('The total, with tax, is worked out when you save the draft.');
      expect(region).not.toContain('Credit total');
      expect(region).not.toMatch(/\$\d/);
    }
  });
  it('the running credit is Save\'s own figures: the last of a line takes what is left; a part at the line\'s price and tax', () => {
    const all = creditPreview([{ invoiceLineNo: 2, quantity: d('3') }], lines);
    expect(all).toEqual({ kind: 'figures', net: d('3.70'), tax: d('0.74'), total: d('4.44') });
    const part = creditLineFigures(creditWishes([{ invoiceLineNo: 2, quantity: d('1') }]), lines);
    expect([part[0]!.net, part[0]!.tax]).toEqual([d('1.23'), d('0.25')]);
    expect(creditPreview([{ invoiceLineNo: 1, quantity: d('11') }], lines)).toEqual({ kind: 'over', line: 1 });
    expect(creditPreview([{ invoiceLineNo: 1, quantity: d('0'), reduction: d('221') }], lines)).toEqual({ kind: 'over', line: 1 });
    expect(creditPreview([{ invoiceLineNo: 1, quantity: d('0') }], lines)).toEqual({ kind: 'nothing' });
    expect(creditPreview([{ invoiceLineNo: 9, quantity: d('1') }], lines)).toEqual({ kind: 'missing' });
  });
  it('a credit that leaves something owed says so; one not yet worked out is never a zero', () => {
    expect(renderCreditTotal('en', { kind: 'figures', net: d('20'), tax: d('0'), total: d('20') }, inv)).toContain('Still owed on F-2026-0005: $75.00 now, $55.00 once this credit note is issued.');
    const notYet = renderCreditTotal('en', null, inv);
    expect(notYet).toContain('cannot be worked out yet'); expect(notYet).not.toMatch(/\$0\.00/);
    expect(renderCreditTotal('en', { kind: 'over', line: 2 }, inv)).toContain('Line 2 has less left to credit than that.');
  });
  it('the page: before Issue, the amount, its invoice and the balance it leaves; the paper only what the customer reads', () => {
    const html = renderCreditNote('en', owner, note, { creditInvoice: inv });
    const summary = html.slice(html.indexOf('<header class="bd-summary"'), html.indexOf('<article'));
    expect(summary).toContain('<h1 class="page">'); expect(summary).toContain('$44.00'); expect(summary).toContain('href="/app/books/invoices/inv"');
    expect(summary).toContain('Still owed on F-2026-0005: $75.00 now, $31.00 once this credit note is issued.');
    const paper = html.match(/<article class="book-document"[\s\S]*?<\/article>/)?.[0] ?? '';
    expect(paper).not.toContain('class="pill'); expect(paper).not.toContain('<a '); expect(paper).toContain('Straps faulty');
    expect(html.indexOf('/cn/issue')).toBeGreaterThan(html.indexOf('</article>'));
    expect(html).toContain('data-confirm='); expect(html).toContain('/cn/discard');
    const issued = renderCreditNote('en', owner, { ...note, state: 'issued', key: 'A-2026-0001', entryId: 'e' }, { creditInvoice: { ...inv, owed: d('31') } });
    expect(issued).toContain('Still owed on F-2026-0005: $31.00.'); expect(issued).not.toContain('/cn/issue'); expect(issued).toContain('/app/books/advanced/entries/e');
    expect(renderCreditNote('en', accountant, note, { creditInvoice: inv })).not.toContain('<form');
  });
  it('owner copy never says the entry is posted, in any language; the new words are in all five', () => {
    for (const l of LOCALES) for (const k of ['books.credit.newLede', 'books.credit.issueAsk'] as const) {
      expect(messages[l][k]).not.toMatch(/posts its entry|entry is posted|记账|يسجّل قيده|يُسجَّل قيده|se registra su asiento|passe son écriture|écriture est passée/);
    }
    for (const k of ['booksCredit.total', 'booksCredit.against', 'booksCredit.nothing', 'booksCredit.effect', 'booksCredit.effectRefund', 'booksCredit.owedNow', 'booksCredit.refundNow', 'booksCredit.leftNet', 'booksCredit.over', 'booksCredit.notYet'] as const)
      for (const l of LOCALES) { expect(messages[l][k], `${l} ${k}`).toBeTruthy(); if (l !== 'en') expect(messages[l][k], `${l} ${k}`).not.toBe(messages.en[k]); }
  });
  it('F20 fix — the shipped script asks a data-total-now form for its total as the page opens, and only such a form', () => {
    const run = (now: boolean) => {
      const asked: string[] = [];
      const form = { hasAttribute: (n: string) => now && n === 'data-total-now', getAttribute: (n: string) => n === 'data-total' ? '/app/books/invoices/inv/credit-notes/preview' : null };
      const out = { firstChild: null };
      const document = {
        querySelector: (s: string) => s === 'form[data-total]' ? form : s === '[data-total-out]' ? out : null,
        querySelectorAll: () => [], addEventListener: () => {},
      };
      const fetch = (url: string) => { asked.push(url); return new Promise(() => {}); };
      const window = { addEventListener: () => {}, fetch, FormData: function FormData() {}, URLSearchParams: function URLSearchParams() {}, DOMParser: function DOMParser() {} };
      vm.runInNewContext(LIVE_SCRIPT, { document, window, fetch, FormData: window.FormData, URLSearchParams: window.URLSearchParams, DOMParser: window.DOMParser,
        location: { pathname: '/app/books', hash: '', search: '' }, setTimeout: () => 0, clearTimeout: () => {} });
      return asked;
    };
    expect(run(true)).toEqual(['/app/books/invoices/inv/credit-notes/preview']);
    expect(run(false)).toEqual([]);
  });
});
