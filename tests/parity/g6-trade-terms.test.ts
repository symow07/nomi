import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateTradeTerms, MAX_PAYMENT_TERMS } from '../../src/core/commerce/terms.js';
import { INCOTERM_KEYS } from '../../src/core/safety/claims.js';
import { renderTerms } from '../../src/api/web/settings.js';
import { esc } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * G6 — the terms on a proforma are the owner's, or there is no proforma.
 *
 * Every order used to be stamped "30% deposit, 70% before shipment" and every
 * proforma said FOB. Neither came from her.
 */

const src = (rel: string) => readFile(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const NOW = new Date('2026-09-11T08:00:00Z');

describe('G6 · stating her terms', () => {
  it('her payment wording is kept verbatim, trimmed, never parsed', () => {
    const r = validateTradeTerms({ payment: '  50% with order, balance against B/L copy ', incoterm: 'CIF', now: NOW });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.paymentTerms).toBe('50% with order, balance against B/L copy');
      expect(r.value.incoterm).toBe('CIF');
      expect(r.value.statedAt).toBe(NOW);
    }
  });

  it('an incoterm is one of the guard’s own, in either case', () => {
    const r = validateTradeTerms({ payment: 'T/T', incoterm: 'fob', now: NOW });
    expect(r.ok && r.value.incoterm).toBe('FOB');
    for (const bad of ['', 'FOB Ningbo', 'XYZ', null]) {
      const v = validateTradeTerms({ payment: 'T/T', incoterm: bad, now: NOW });
      expect(v.ok ? 'ok' : v.error, String(bad)).toBe('incoterm_invalid');
    }
  });

  it('nothing is assumed: empty payment is refused, and so is a contract', () => {
    for (const blank of ['', '   ', null]) {
      const v = validateTradeTerms({ payment: blank, incoterm: 'CIF', now: NOW });
      expect(v.ok ? 'ok' : v.error).toBe('payment_missing');
    }
    const long = validateTradeTerms({ payment: 'x'.repeat(MAX_PAYMENT_TERMS + 1), incoterm: 'CIF', now: NOW });
    expect(long.ok ? 'ok' : long.error).toBe('payment_too_long');
  });

  it('the table accepts exactly the guard’s incoterms — one vocabulary, two places', async () => {
    const sql = await src('migrations/0041_trade_terms.sql');
    const m = sql.match(/incoterm\s+text not null check \(incoterm in \(([^)]*)\)\)/);
    expect(m, 'the CHECK is present').not.toBeNull();
    const listed = m![1]!.split(',').map((s) => s.trim().replace(/'/g, ''));
    expect([...listed].sort()).toEqual([...INCOTERM_KEYS].sort());
  });

  it('insert-only: what an order was confirmed under stays on the record', async () => {
    const sql = await src('migrations/0041_trade_terms.sql');
    expect(sql).toMatch(/grant select, insert on trade_terms to nomi_app/);
    expect(sql).toMatch(/revoke update on trade_terms from nomi_app/);
    expect(sql).toMatch(/enable row level security/);
  });
});

describe('G6 · no literal stands in for her', () => {
  it('the turn pipeline carries no payment-terms wording of its own', async () => {
    const turn = await src('src/pipeline/turn.ts');
    const code = turn.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/deposit|before shipment/i);
    expect(code).toMatch(/tenant\.catalog\.tradeTerms\(\)/);
  });

  it('no message key supplies a delivery term', async () => {
    const messages = await src('src/core/owner/i18n/messages.ts');
    expect(messages).not.toContain("'order.invoice.incoterm'");
  });
});

describe('G6 · the settings page', () => {
  const stated = {
    paymentTerms: '50% with order, balance against B/L copy', incoterm: 'CIF', statedAt: NOW,
  };

  it('offers exactly the guard’s incoterms, and posts to its own route', () => {
    const html = renderTerms({ terms: null }, 'en', null);
    const offered = [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    expect(offered).toEqual(INCOTERM_KEYS);
    expect(html).toContain('action="/app/settings/terms"');
  });

  it('with nothing stated it says so — no option is pre-chosen for her', () => {
    for (const locale of LOCALES) {
      const html = renderTerms({ terms: null }, locale, null);
      expect(html, locale).toContain(esc(t(locale, 'terms.none', { name: EMPLOYEE_NAME[locale] })));
      expect(html).not.toMatch(/<option value="[A-Z]+" selected>/);
    }
  });

  it('with terms stated it shows hers, and the one she chose is selected', () => {
    const html = renderTerms({ terms: stated }, 'zh', null);
    expect(html).toContain('50% with order, balance against B/L copy');
    expect(html).toContain('<option value="CIF" selected>');
    expect(html).not.toContain(esc(t('zh', 'terms.none', { name: EMPLOYEE_NAME.zh })));
  });

  it('is reachable from settings, and the write is owner-only', async () => {
    const settings = await src('src/api/web/settings.ts');
    expect(settings).toContain("deeper('/app/settings/terms'");
    const app = await src('src/api/web/app.ts');
    expect(app).toContain("app.get('/app/settings/terms'");
    expect(app).toMatch(/app\.post\('\/app\/settings\/terms'[\s\S]{0,200}ownerOnly\(req, reply, 'price_rules'/);
  });

  it('every string exists in all three locales', () => {
    const KEYS: MessageKey[] = [
      'terms.title', 'terms.intro', 'terms.none', 'terms.setOn', 'terms.payment.label',
      'terms.payment.placeholder', 'terms.incoterm.label', 'terms.incoterm.hint', 'terms.save',
      'terms.flash.saved', 'terms.flash.payment_missing', 'terms.flash.payment_too_long',
      'terms.flash.incoterm_invalid', 'terms.flash.failed', 'order.invoice.noTerms',
    ];
    for (const locale of LOCALES) {
      for (const k of KEYS) {
        const s = t(locale, k, { name: EMPLOYEE_NAME[locale], date: '3 Aug' });
        expect(s.length, `${locale} ${k}`).toBeGreaterThan(1);
        expect(s, `${locale} ${k}`).not.toContain('{');
      }
    }
  });
});
