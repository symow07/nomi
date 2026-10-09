import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { registerWebApp, PUBLIC_ROUTES } from '../../src/api/web/app.js';
import { renderRefunds } from '../../src/api/web/legal.js';
import { renderBilling, type BillingView } from '../../src/api/web/billing.js';
import { renderSite } from '../../src/api/web/site.js';
import { REFUND_TERMS_COVER, coveredByRefundTerms } from '../../src/core/billing/refunds.js';
import { OPERATOR } from '../../src/core/legal/operator.js';
import { LOCALES, dirOf } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * PRE-LAUNCH item 5 — the refund terms at /refunds, in five languages, linked beside the subscribe button and from
 * the site's foot. Monthly terms only: the page says so, and nothing but a monthly plan can be offered beside it
 * (core/billing/refunds.ts; 0134 `plans_monthly_only`; the operator's tool). The trial clause is drawn from the
 * self-serve trial and left out while none is set. Cancel-at-period-end is Stripe's page as Nomi sets it:
 * tests/parity/bill-stripe.test.ts. Over Postgres: tests/integration/refunds.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const ALWAYS = ['cancel', 'partial', 'fails', 'mistake'] as const;

describe('PRE-LAUNCH 5 · the refund terms', () => {
  for (const l of LOCALES) {
    it(`${l} · cancelling, part-used months, Nomi failing, a charge by mistake; how to ask; the page's own date`, () => {
      const page = renderRefunds(l, 'billing@nomi.test', { trialDays: null });
      const read = withoutIsolates(page);
      expect(page).toContain(`dir="${dirOf(l)}"`);
      expect(read).toContain(`<h1>${esc(t(l, 'legal.refunds.title'))}</h1>`);
      expect(read).toContain(esc(t(l, 'legal.refunds.intro')));
      for (const c of ALWAYS) {
        expect(read, c).toContain(`<h2>${esc(t(l, `legal.refunds.${c}.title`))}</h2>`);
      }
      // the cancel clause names the very page and button where it is done
      expect(read).toContain(esc(t(l, 'legal.refunds.cancel.body', { billing: t(l, 'billing.title'), portal: t(l, 'billing.portal') })));
      expect(read).toContain(esc(t(l, 'legal.refunds.ask')));
      expect(page).toContain('href="mailto:billing@nomi.test"');
      expect(read).toContain(esc(t(l, 'legal.updated.refunds')));
      expect(page).toContain('href="/terms"');
      expect(page).toContain('href="/privacy"');
      expect(page).not.toMatch(/\{[a-z]+\}/);
    });

    it(`${l} · the trial clause only while a self-serve trial is set, with its days`, () => {
      const none = withoutIsolates(renderRefunds(l, null, { trialDays: null }));
      expect(none).not.toContain(esc(t(l, 'legal.refunds.trial.title')));
      const fourteen = withoutIsolates(renderRefunds(l, null, { trialDays: 14 }));
      expect(fourteen).toContain(`<h2>${esc(t(l, 'legal.refunds.trial.title'))}</h2>`);
      expect(fourteen).toContain(esc(t(l, 'legal.refunds.trial.body', { days: 14 })));
      // first, before cancelling
      const h2 = (c: string) => fourteen.indexOf(`<h2>${esc(t(l, `legal.refunds.${c}.title` as Parameters<typeof t>[1]))}</h2>`);
      expect(h2('trial')).toBeGreaterThan(0);
      expect(h2('trial')).toBeLessThan(h2('cancel'));
    });

    it(`${l} · linked from the site's foot, after the cookie policy`, () => {
      const foot = /<nav class="site-links"[\s\S]*?<\/nav>/.exec(renderSite({ locale: l, path: '/', contact: null, signIn: '/login', noindex: false }))?.[0] ?? '';
      expect(foot).toContain(`<a href="/refunds">${esc(t(l, 'legal.refunds.title'))}</a>`);
      expect(foot.indexOf('/cookies')).toBeLessThan(foot.indexOf('/refunds'));
    });

    it(`${l} · beside the subscribe button: the renewal line, then the refund terms`, () => {
      const plan = { id: 'starter', name: 'Starter', amountMinor: 4900, currency: 'usd', period: 'month' as const, customersAMonth: 100, seats: null, assistants: null, stripePriceId: 'price_x' };
      const state = { billed: true, exempt: false, planId: null, status: 'none' as const, cardSavedAt: null, trialDays: null, trialStartedAt: null,
        trialEndsAt: null, currentPeriodEnd: null, hasCustomer: false, customersThisMonth: 0, firstChannelAt: null };
      const view: BillingView = { configured: true, state, plans: [plan], people: 1, assistants: 1, returned: null };
      const page = renderBilling(view, l, null, 'Back');
      const renews = `<p>${esc(t(l, 'billing.renews', { portal: t(l, 'billing.portal') }))}</p>`;
      const link = `<p><a href="/refunds">${esc(t(l, 'legal.refunds.title'))}</a></p>`;
      expect(page.indexOf(link), 'right after the renewal line').toBe(page.indexOf(renews) + renews.length + '\n        '.length);
    });
  }

  it('the renewal line says monthly, and that a cancelled plan runs to the end of the month paid for', () => {
    const en = t('en', 'billing.renews');
    expect(en).toMatch(/renews every month/);
    expect(en).not.toMatch(/year/);
    expect(en).toMatch(/runs to the end of the month already paid for, and nothing more is charged/);
    expect(t('zh', 'billing.renews')).not.toMatch(/每年/);
    expect(t('es', 'billing.renews')).not.toMatch(/año/);
    expect(t('fr', 'billing.renews')).not.toMatch(/année/);
    expect(t('ar', 'billing.renews')).not.toMatch(/سنة/);
  });

  it('the English words are the policy\'s own', () => {
    expect(t('en', 'legal.refunds.trial.body')).toMatch(/No card is charged during the trial\. Cancel before it ends and nothing is paid\./);
    expect(t('en', 'legal.refunds.cancel.body')).toMatch(/runs to the end of the period already paid for, and stops\. Nothing more is charged\./);
    expect(t('en', 'legal.refunds.partial.body')).toBe('A month already started is not refunded. Access continues until that month ends.');
    expect(t('en', 'legal.refunds.fails.body')).toMatch(/cannot be fixed, that month is refunded in full\. Ask within 30 days\./);
    expect(t('en', 'legal.refunds.mistake.body')).toBe('A double charge, a charge after cancelling, or a wrong amount is always refunded in full.');
  });

  it('who provides Nomi is named only once both the name and the address are known — no placeholder before', () => {
    expect(OPERATOR).toEqual({ name: '', address: '' });
    for (const l of LOCALES) {
      const page = renderRefunds(l, null, { trialDays: 14 });
      expect(page).not.toContain(esc(t(l, 'legal.refunds.operator', { company: '\u0000', address: '' })).split('\u0000')[0]!);
      expect(page).not.toMatch(/TODO|TBD|XXX|\[name\]|\[address\]/i);
    }
  });

  it('public, like the other legal pages; a database that does not answer leaves the trial out, the page still served', async () => {
    expect(PUBLIC_ROUTES.some((r) => r.method === 'GET' && r.url === '/refunds')).toBe(true);
    const app = Fastify({ logger: false });
    registerWebApp(app, {
      db: {} as never, sessionSecret: 'x'.repeat(64), accessCode: 'let-me-in', businessId: 'de300000-0000-4000-8000-0000000000b1',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: true,
      kickOutbound: async () => {}, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    } as unknown as Parameters<typeof registerWebApp>[1]);
    const res = await app.inject({ method: 'GET', url: '/refunds', headers: { cookie: 'yf_locale=es' } });
    expect(res.statusCode).toBe(200);
    expect(withoutIsolates(res.body)).toContain(esc(t('es', 'legal.refunds.title')));
    expect(withoutIsolates(res.body)).not.toContain(esc(t('es', 'legal.refunds.trial.title')));
    await app.close();
  });
});

describe('PRE-LAUNCH 5 · monthly only: nothing else can be offered beside these terms', () => {
  it('the terms cover the month and nothing else', () => {
    expect(REFUND_TERMS_COVER).toEqual(['month']);
    expect(coveredByRefundTerms('month')).toBe(true);
    expect(coveredByRefundTerms('year')).toBe(false);
  });

  it('the plans offered are filtered by them, a plan not offered cannot be chosen, and the database refuses another period', () => {
    const db = src('src/db/billing.ts');
    expect(db).toContain('.filter((p) => coveredByRefundTerms(p.period));');
    expect(db).toContain("if (!(await plansOnOffer(tx)).some((p) => p.id === planId)) return 'no_plan';");
    expect(src('migrations/0134_refund_terms.sql')).toContain("add constraint plans_monthly_only check (period = 'month');");
  });

  it('the operator\'s tool refuses a yearly price, and changes nothing', async () => {
    const op = await import('../../tools/lib/operator.mjs' as string) as { setPlan: (c: unknown, i: unknown) => Promise<string> };
    const touched: string[] = [];
    const client = { query: async (q: string) => { touched.push(q); return { rows: [], rowCount: 0 }; } };
    const yearly = { id: 'price_yearly01', amountMinor: 49000, currency: 'usd', interval: 'year', active: true };
    expect(await op.setPlan(client, { id: 'annual', name: 'Annual', price: yearly, customers: 100, by: 'ops' })).toBe('not_monthly');
    expect(touched).toEqual([]);
    expect(await op.setPlan(client, { id: 'starter', name: 'Starter', price: { ...yearly, interval: 'month' }, customers: 100, by: 'ops' })).toBe('set');
    expect(touched).toHaveLength(1);
    expect(src('tools/billing.mjs')).toContain('Nomi sells monthly plans only, and the refund terms (/refunds) describe nothing else. Nothing was changed.');
  });
});
