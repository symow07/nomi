import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { usd } from '../../src/core/types/money.js';
import { renderProformaPage, type ProformaView } from '../../src/api/web/proforma.js';
import { notFoundPage } from '../../src/api/web/proof.js';
import { proformaRow } from '../../src/api/web/inbox.js';
import { proformaUrl } from '../../src/db/proformaLinks.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * Phase 2c (the owner's roadmap, 2026-10-13; 0151) — THE PROFORMA AS A PAGE THE CUSTOMER OPENS.
 *
 *   · the order's own figures, in the customer's language, with the sample credit as two lines and the amount due;
 *   · nothing of the order beyond the document (the view has no e-mail, history or ids to draw) and nothing of Nomi;
 *   · a link that no longer opens says only what it was for, and the route answers 404 like the price link's;
 *   · the owner's row: nothing to do without what a proforma needs, one tap to make it, the whole link, one tap off.
 */

const VIEW: ProformaView = {
  locale: 'en', zone: 'Asia/Shanghai',
  seller: 'Westlake Canvas Co.', sellerAddress: 'Room 1203, Block B\nYiwu, Zhejiang 322000, China',
  buyer: 'Khalid Mansoor', reference: '2026-0014', issuedAt: new Date('2026-10-12T03:20:00Z'),
  product: 'Canvas tote bag', sku: 'ZX-200', quantity: 5000, unit: 'pcs',
  unitPrice: usd(0.38), total: usd(1900), sampleCredit: usd(25),
  incoterm: 'FOB Ningbo', paymentTerms: '30% deposit, 70% before shipment',
};

const visible = (html: string): string =>
  html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<\/?bdi[^>]*>/g, '').replace(/<[^>]+>/g, ' ').replace(/[\u2068\u2069]/g, '').replace(/\s+/g, ' ');

describe('Phase 2c · the proforma page', () => {
  it('states the order’s figures, the credit as two lines and what is due, the terms in the owner’s words', () => {
    const page = visible(renderProformaPage(VIEW));
    for (const s of ['Proforma invoice', '2026-0014', 'Westlake Canvas Co.', 'Khalid Mansoor', 'Canvas tote bag', 'ZX-200',
      '5,000 pcs', '$0.38', '$1,900.00', 'Less sample already paid', '−$25.00', 'Amount due', '$1,875.00',
      'FOB Ningbo', '30% deposit, 70% before shipment', 'Room 1203, Block B']) expect(page, s).toContain(s);
    // A seller's name that ends its own sentence takes no second full stop.
    expect(page).toContain('Reply in your conversation with Westlake Canvas Co.');
    expect(page).not.toContain('Co..');
  });

  it('without a credit: one total, which is what is due — and no address line when none is on record', () => {
    const page = visible(renderProformaPage({ ...VIEW, sampleCredit: null, sellerAddress: null }));
    expect(page).toContain('$1,900.00');
    expect(page).not.toContain('Less sample');
    expect(page).not.toContain('Amount due');
    expect(page).not.toContain('Room 1203');
    expect(renderProformaPage({ ...VIEW, sampleCredit: null })).toMatch(/class="pi-sumrow pi-due"><dt>Total<\/dt>/);
  });

  it('in every language: the document’s own words, the page’s direction, never indexed, nothing of Nomi', () => {
    for (const l of LOCALES) {
      const html = renderProformaPage({ ...VIEW, locale: l });
      expect(html, l).toContain(`<html lang="${l}" dir="${l === 'ar' ? 'rtl' : 'ltr'}"`);
      expect(html, l).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(html, l).toContain(`<h1>${t(l, 'pi.heading')}</h1>`);
      for (const k of ['pi.billTo', 'pi.col.item', 'pi.col.quantity', 'pi.col.unitPrice', 'pi.col.amount', 'pi.lessSample',
        'pi.due', 'pi.incoterm', 'pi.payment', 'pi.what'] as const) expect(html, `${l} ${k}`).toContain(t(l, k));
      // The seller's paper: no mark, no name of the service, no way into the app, no script.
      expect(visible(html), l).not.toMatch(/Nomi/);
      expect(html, l).not.toContain('href="/');
      expect(html, l).not.toContain('<script');
    }
  });

  it('Arabic: the credit is one left-to-right run, its sign before its figure; names and owner’s words isolated', () => {
    const html = renderProformaPage({ ...VIEW, locale: 'ar' });
    expect(html).toMatch(/<bdi dir="ltr">−<bdi>/);
    expect(html).toContain('<div class="pi-seller"><bdi>Westlake Canvas Co.</bdi></div>');
    expect(html).toContain('<dd><bdi>30% deposit, 70% before shipment</bdi></dd>');
  });

  it('NO BANK DETAILS, on purpose: no field for one, and no page in any language names one (docs/PROFORMA-LINK.md)', () => {
    // A forwardable page carrying payment details is an invoice-fraud vector. Changing this is the owner's decision.
    const src = readFileSync('src/api/web/proforma.ts', 'utf8');
    const type = src.slice(src.indexOf('export type ProformaView'), src.indexOf('};', src.indexOf('export type ProformaView'))).toLowerCase();
    for (const field of ['bank', 'iban', 'swift', 'bic', 'account', 'routing', 'payee', 'beneficiary', 'paylink', 'paymentlink']) {
      expect(type, field).not.toContain(field);
    }
    const said: Record<string, RegExp> = {
      en: /bank|iban|swift|account (number|no)/i, zh: /银行|账号|账户/, ar: /بنك|مصرف|حساب/, es: /banco|bancari|cuenta/i, fr: /banque|bancaire|compte/i,
    };
    for (const l of LOCALES) expect(visible(renderProformaPage({ ...VIEW, locale: l, paymentTerms: 'as agreed' })), l).not.toMatch(said[l]!);
  });

  it('the view is the whole of what the renderer gets: it has no field for the e-mail, the history or any id', () => {
    const src = readFileSync('src/api/web/proforma.ts', 'utf8');
    const type = src.slice(src.indexOf('export type ProformaView'), src.indexOf('};', src.indexOf('export type ProformaView')));
    for (const banned of ['email', 'history', 'Id', 'note', 'tracking', 'conversation']) expect(type, banned).not.toContain(banned);
  });
});

describe('Phase 2c · a link that does not open', () => {
  it('says what it was for, in the reader’s language, and names no seller', () => {
    for (const l of LOCALES) {
      const html = notFoundPage(l, 'proforma');
      expect(html, l).toContain(`<h1>${t(l, 'public.notFound.proforma.title')}</h1>`);
      expect(html, l).toContain(t(l, 'public.notFound.proforma.next'));
      expect(html.includes('dir="rtl"'), l).toBe(l === 'ar');
      expect(t(l, 'public.notFound.proforma.title'), l).not.toBe(t(l, 'public.notFound.proof.title'));
    }
  });

  it('the route: 404 for every failure, never 403; no-store, no referrer, never indexed', () => {
    const src = readFileSync('src/api/web/app.ts', 'utf8');
    const at = src.indexOf("app.get('/pi/:token'");
    expect(at).toBeGreaterThan(-1);
    const handler = src.slice(at, src.indexOf('});', at));
    expect(handler).toContain("reply.code(404).type('text/html; charset=utf-8').send(notFoundPage(localeOf(req), 'proforma'))");
    expect(handler).not.toContain('403');
    for (const h of ["'cache-control', 'no-store'", "'referrer-policy', 'no-referrer'", "'x-robots-tag', 'noindex, nofollow'"]) {
      expect(handler, h).toContain(h);
    }
    expect(src).toMatch(/\{ method: 'GET', url: '\/pi\/:token', why: '[^']+' \}/);
  });
});

describe('Phase 2c · the owner’s row, on the conversation and the order', () => {
  const order = (proforma: { ready: boolean; token: string | null; url?: string | null }) => ({ id: 'o-1', proforma });

  it('nothing when the order lacks what a proforma needs', () => {
    expect(proformaRow(order({ ready: false, token: null }), 'en', 'conversation')).toBe('');
    expect(proformaRow({ id: 'o-1' }, 'en', 'order')).toBe('');
  });

  it('one tap makes it, sending nothing; the page says which page it came from', () => {
    const html = proformaRow(order({ ready: true, token: null }), 'en', 'conversation');
    expect(html).toContain('action="/app/orders/o-1/proforma-link"');
    expect(html).toContain('<input type="hidden" name="from" value="conversation">');
    expect(html).toContain(t('en', 'pi.owner.none'));
    expect(html).toContain(t('en', 'pi.owner.make'));
  });

  it('a live link: the whole address, a look as the customer sees it, and one confirmed tap off', () => {
    const url = 'https://app.example.test/pi/' + 'x'.repeat(43);
    const html = proformaRow(order({ ready: true, token: 'x'.repeat(43), url }), 'en', 'order');
    expect(html).toContain(`<code class="prooflink"><bdi>${url}</bdi></code>`);
    expect(html).toContain(`href="${url}" target="_blank" rel="noopener"`);
    expect(html).toContain('action="/app/orders/o-1/proforma-link/off"');
    expect(html).toContain(`data-confirm="${t('en', 'pi.owner.offConfirm')}"`);
    // No public address: the reason, never a relative path.
    const none = proformaRow(order({ ready: true, token: 'x'.repeat(43), url: null }), 'en', 'order');
    expect(none).toContain(t('en', 'pi.owner.noAddress'));
    expect(none).not.toContain('/pi/');
  });

  it('the link is built from the public address only, never guessed', () => {
    expect(proformaUrl(null, 'tok')).toBeNull();
    expect(proformaUrl('https://app.example.test/', 'tok')).toBe('https://app.example.test/pi/tok');
  });
});
