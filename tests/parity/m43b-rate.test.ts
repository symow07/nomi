import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  convertMoney, rateFor, validateRate, type OwnerRate,
} from '../../src/core/commerce/exchange.js';
import { usd, type Money } from '../../src/core/types/money.js';
import { renderRate, type RateView } from '../../src/api/web/settings.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M43b — the rate SHE stated, or nothing.
 *
 * The temptation this milestone refuses is not a lazy one; it is the sensible
 * one. Fetching today's USD/CNY rate is easy, free, and correct to four
 * decimals — and that is precisely what makes it dangerous. It moves while she
 * sleeps. A total she showed a buyer on Tuesday reads differently on Thursday,
 * and nobody typed anything wrong.
 *
 * Every other number in this product traces to a row she wrote. A rate is no
 * different, so there is no fallback, no default, no cached last-known value,
 * and no "approximately".
 */

const march = new Date('2026-03-04T10:00:00Z');
const august = new Date('2026-08-12T10:00:00Z');
const rate = (r: number, at: Date): OwnerRate => ({ from: 'USD', to: 'CNY', rate: r, statedAt: at });

describe('M43b · she states it, or nothing converts', () => {
  it('converts at HER rate', () => {
    const c = convertMoney(usd(100), 'CNY', [rate(7.15, august)]);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.value.money).toEqual({ amount: 715, currency: 'CNY' });
  });

  it('REFUSES when she has stated nothing — it does not guess, average, or fetch', () => {
    const c = convertMoney(usd(100), 'CNY', []);
    expect(c.ok).toBe(false);
    if (c.ok) return;
    expect(c.error.kind).toBe('no_rate_stated');
    expect(c.error.from).toBe('USD');
    expect(c.error.to).toBe('CNY');
  });

  it('the converted figure carries the rate it went through', () => {
    const c = convertMoney(usd(100), 'CNY', [rate(7.15, august)]);
    if (!c.ok) throw new Error('unreachable');
    // Not the amount alone: a number in ￥ with no rate behind it is exactly
    // the thing this refuses to produce.
    expect(c.value.rate.rate).toBe(7.15);
    expect(c.value.rate.statedAt).toEqual(august);
  });

  it('the same currency is the identity, and needs no row', () => {
    const c = convertMoney(usd(100), 'USD', []);
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.value.money).toEqual(usd(100));
  });

  it('the NEWEST rate wins — what she will honour is the last thing she said', () => {
    const r = rateFor([rate(6.90, march), rate(7.15, august)], 'USD', 'CNY');
    expect(r!.rate).toBe(7.15);
    // and order of the array does not decide it
    expect(rateFor([rate(7.15, august), rate(6.90, march)], 'USD', 'CNY')!.rate).toBe(7.15);
  });

  it('the INVERSE is not implied — 1/7.15 is arithmetic she did not do', () => {
    // She stated what a dollar is worth in yuan. She did not state what a yuan
    // is worth in dollars, and inverting it for her is inventing a rate.
    expect(rateFor([rate(7.15, august)], 'CNY', 'USD')).toBeNull();
    expect(convertMoney({ amount: 715, currency: 'CNY' }, 'USD', [rate(7.15, august)]).ok).toBe(false);
  });
});

describe('M43b · staleness is HER judgement, not an invented threshold', () => {
  it('an old rate still converts — refusing it would need a number nobody stated', () => {
    // Thirty days? Ninety? Any answer is invented, and an invented threshold is
    // an invented number wearing a responsible-looking hat.
    const ancient = rate(6.10, new Date('2019-01-01T00:00:00Z'));
    const c = convertMoney(usd(100), 'CNY', [ancient]);
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.value.rate.statedAt).toEqual(ancient.statedAt);
  });

  it('so the DATE is shown wherever the rate is', () => {
    const html = renderRate({ current: rate(7.15, august), previous: [] }, 'en', null);
    expect(html).toContain(t('en', 'rate.current', { rate: 7.15 }));
    expect(html).toMatch(/You set this on/);
  });

  it('and beside every converted figure, not only on the settings page', () => {
    const html = renderConversationDetail(detail(rate(7.15, august)), 'en', august, null);
    expect(html).toContain('￥');
    expect(html).toContain('at the rate you set on');
  });
});

describe('M43b · what she typed', () => {
  it('accepts a plain positive number', () => {
    const r = validateRate({ from: 'USD', to: 'CNY', rate: '7.15', now: august });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ from: 'USD', to: 'CNY', rate: 7.15, statedAt: august });
  });

  it('refuses blank, non-numeric, zero and negative', () => {
    for (const [raw, code] of [['', 'missing'], ['   ', 'missing'], ['seven', 'not_a_number'],
      ['0', 'not_positive'], ['-7', 'not_positive']] as const) {
      const r = validateRate({ from: 'USD', to: 'CNY', rate: raw, now: august });
      expect(r.ok, raw).toBe(false);
      if (!r.ok) expect(r.error, raw).toBe(code);
    }
  });

  it('holds NO opinion about what a yuan is worth', () => {
    // A plausibility band would be this module knowing something about the
    // world — the outside knowledge it exists to keep out. The number is hers.
    for (const absurd of ['0.0001', '900']) {
      expect(validateRate({ from: 'USD', to: 'CNY', rate: absurd, now: august }).ok, absurd).toBe(true);
    }
  });

  it('a currency to itself is not a rate', () => {
    const r = validateRate({ from: 'USD', to: 'USD', rate: '1', now: august });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('same_currency');
  });
});

describe('M43b · the surface', () => {
  it('with no rate stated, it says so and names the next action, in every locale', () => {
    for (const locale of LOCALES) {
      const html = renderRate({ current: null, previous: [] }, locale, null);
      const visible = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
      expect(visible, locale).toContain(t(locale, 'rate.empty'));
      expect(visible, locale).toContain(t(locale, 'rate.add.button'));
      expect(html).toContain('action="/app/settings/rate"');
    }
  });

  it('shows the rates she stated BEFORE — history, not state', () => {
    const html = renderRate({ current: rate(7.15, august), previous: [rate(6.90, march)] }, 'en', null);
    expect(html).toContain(t('en', 'rate.history.title'));
    expect(html).toContain(t('en', 'rate.current', { rate: 6.9 }));
  });

  it('and NOTHING in ￥ appears until she has stated one', () => {
    const html = renderConversationDetail(detail(null), 'en', august, null);
    expect(html).not.toContain('￥');
    expect(html).not.toContain('at the rate you set on');
  });

  it('is reachable from settings, and registered as a route', async () => {
    const settings = await readFile(new URL('../../src/api/web/settings.ts', import.meta.url), 'utf8');
    expect(settings).toContain("deeper('/app/settings/rate'");
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(app).toContain("app.get('/app/settings/rate'");
    expect(app).toContain("app.post('/app/settings/rate'");
  });

  it('every string exists in all three locales', () => {
    const KEYS: MessageKey[] = [
      'rate.title', 'rate.intro', 'rate.current', 'rate.setOn', 'rate.empty',
      'rate.add.label', 'rate.add.placeholder', 'rate.add.button', 'rate.history.title',
      'rate.at', 'rate.flash.set', 'rate.flash.missing', 'rate.flash.not_a_number',
      'rate.flash.not_positive', 'rate.flash.same_currency', 'rate.flash.failed',
    ];
    for (const locale of LOCALES) {
      for (const k of KEYS) {
        const s = t(locale, k, { rate: 7.15, date: '12 Aug' });
        expect(s.length, `${locale} ${k}`).toBeGreaterThan(1);
        expect(s, `${locale} ${k}`).not.toContain('{');
      }
    }
  });
});

describe('M43b · no live rate can enter this product', () => {
  it('nothing in src fetches one', async () => {
    const { execSync } = await import('node:child_process');
    const hits = execSync(
      'grep -rniE "exchangerate|openexchange|fixer\\\\.io|currencyapi|fx ?rate api|latest.*rates" src || true',
      { cwd: new URL('../../', import.meta.url).pathname, encoding: 'utf8' },
    ).split('\n').filter((l) => l.trim() !== '');
    expect(hits, `a live rate source reached the code:\n${hits.join('\n')}`).toEqual([]);
  });

  it('the conversion path takes rates as an ARGUMENT — it cannot go and get one', async () => {
    const src = await readFile(new URL('../../src/core/commerce/exchange.ts', import.meta.url), 'utf8');
    expect(src).toContain('rates: readonly OwnerRate[]');
    // Pure per ADR-0002: no import that could reach a network or a clock.
    expect(src).not.toMatch(/^import .*(node:|fetch|http)/m);
  });
});

/** A conversation detail carrying a quote, with or without a stated rate. */
function detail(r: OwnerRate | null): ConversationDetail {
  const money = (n: number): Money => usd(n);
  return {
    conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
    product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: 5000,
    quote: { unitPrice: money(0.92), total: money(4600), quantity: 5000 },
    order: null,
    messages: [{ direction: 'inbound', text: 'Price for 5000?', at: march }],
    pendingDraft: null, ownership: 'AI', refusals: [], handoffReasons: [],
    unheardReason: null, lastHumanAction: null, knowledgeUsed: [], rate: r,
    proof: { quoteId: null, token: null },
  };
}
