import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import pg from 'pg';
import { flashSaid } from './tenant.js';
import { currencyLabel } from '../../src/core/owner/currencies.js';
import { importAt, submitReview } from './importReview.js';
import { offlineModels } from '../pipeline/fakes.js';
import { signUpWithCode, type Outbox, PASSING_BOT_CHECK } from './signUpWithCode.js';

/** The same derivation main.ts makes, so a notice this app minted can be read. */
const WEB_SECRET = createHmac('sha256', 'a'.repeat(64)).update('yf-web-session').digest('hex');

/**
 * CUR (the owner's decision, 2026-09-30) — ONE CURRENCY PER WORKSPACE, chosen at
 * sign-up, through the real production composition and real Postgres: the
 * column sign-up writes, the profile that changes it until the first price,
 * and every way a price comes in — a pasted list, a floor, a product's page, a
 * sample — landing in it. Then a quote worked out from those rows is in it,
 * and the numeral guard refuses the same figure in dollars.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `c0de0000-0000-4000-8000-${RUN}0001`;
const ABOUT = { kind: 'retail', sells: 'Perfume oils', website: '', teamSize: '2-5', terms: 'on' };

d('CUR · one currency per workspace (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  const outbox: Outbox = [];
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let admin: pg.Client;
  let cookie = '';

  // Its own visitor: sign-up allows five tries an hour from one address.
  const visitor = `198.51.100.${(RUN.charCodeAt(1) % 200) + 20}`;
  const form = (url: string, fields: Record<string, string>, c = '') => prod.app.inject({
    method: 'POST', url,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': visitor, ...(c ? { cookie: c } : {}) },
    payload: new URLSearchParams(fields).toString(),
  });
  const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });
  const cookieOf = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? [])
      .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=') && c !== 'yf_session=') ?? '';
  const one = async <T>(q: string, args: unknown[]): Promise<T> => (await admin.query(q, args)).rows[0] as T;

  const A = { ...ABOUT, factory: `Oud House ${RUN}`, name: 'Rana', email: `rana-${RUN}@oud.example`, password: `oud-password-${RUN}`, country: 'AE', invite: '' };
  let bid = '';

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    process.env['OWNER_ACCESS_CODE'] = `currency-${RUN}`;
    process.env['SIGNUP_MODE'] = 'open';
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name) values ($1, $2) on conflict (id) do nothing`, [PILOT, `Pilot ${RUN}`]);
    const { buildProduction } = await import('../../src/main.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    prod = await buildProduction({
      provider: 'disabled', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'cur-verify-token-0001',
      CREDENTIAL_KEY: 'a'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { models: offlineModels(), logger: false, botCheck: PASSING_BOT_CHECK, signupGuard: null, systemMail: { from: 'no-reply@nomi.test', send: async (m) => { outbox.push(m); return { ok: true }; } } });
  }, 90_000);

  afterAll(async () => {
    delete process.env['SIGNUP_MODE'];
    await admin?.end();
    await prod?.close();
  });

  it('SIGN-UP GIVES THE COUNTRY ITS OWN MONEY, and asks where that is not on the list', async () => {
    const made = await signUpWithCode(form, outbox, A);
    expect(made.statusCode, made.body.slice(0, 300)).toBe(302);
    cookie = cookieOf(made);
    const row = await one<{ id: string; currency: string }>(`select id::text as id, currency from businesses where name = $1`, [A.factory]);
    expect(row.currency).toBe('AED');
    bid = row.id;

    // Morocco's dirham is not on the list: the form asks, and nothing is made until it is answered.
    const M = { ...ABOUT, factory: `Atlas Shop ${RUN}`, name: 'Sam', email: `sam-${RUN}@atlas.example`, password: `atlas-password-${RUN}`, country: 'MA', invite: '' };
    const asked = await form('/signup', M);
    expect(asked.statusCode).toBe(400);
    expect(asked.body).toContain(t('en', 'signup.problem.currency_missing'));
    expect(asked.body).toContain('<select id="su-currency" name="currency" required>');
    expect((await admin.query(`select 1 from businesses where name = $1`, [M.factory])).rowCount).toBe(0);
    const picked = await signUpWithCode(form, outbox, { ...M, currency: 'USD' });
    expect(picked.statusCode, picked.body.slice(0, 300)).toBe(302);
    expect((await one<{ currency: string }>(`select currency from businesses where name = $1`, [M.factory])).currency).toBe('USD');
  });

  it('THE OWNER CHANGES IT UNTIL THE FIRST PRICE — and no further', async () => {
    const saved = await form('/app/settings/currency', { currency: 'SAR' }, cookie);
    expect(flashSaid(saved, WEB_SECRET)).toBe(t('en', 'settings.flash.currencySaved'));
    expect((await one<{ currency: string }>(`select currency from businesses where id = $1`, [bid])).currency).toBe('SAR');
    const back = await form('/app/settings/currency', { currency: 'AED' }, cookie);
    expect(flashSaid(back, WEB_SECRET)).toBe(t('en', 'settings.flash.currencySaved'));
    const bad = await form('/app/settings/currency', { currency: 'EUR' }, cookie);
    expect(flashSaid(bad, WEB_SECRET)).toBe(t('en', 'settings.flash.currencyInvalid'));
    expect((await get('/app/settings/profile')).body).toContain('<option value="AED" selected>');
  });

  it('PHASE 3 · the profile\'s one form saves the zone and the currency with the rest', async () => {
    const name = (await one<{ name: string }>(`select name from businesses where id = $1`, [bid])).name;
    const r = await form('/app/settings', { name, zone: 'Asia/Dubai', currency: 'SAR' }, cookie);
    expect(flashSaid(r, WEB_SECRET)).toBe(t('en', 'settings.flash.profileSaved'));
    expect(await one(`select currency, timezone from businesses where id = $1`, [bid])).toEqual({ currency: 'SAR', timezone: 'Asia/Dubai' });
    // back, for the tests that follow
    await form('/app/settings', { name, currency: 'AED' }, cookie);
    expect((await one<{ currency: string }>(`select currency from businesses where id = $1`, [bid])).currency).toBe('AED');
  });

  let pid = '';
  it('A PASTED LIST IS READ IN DIRHAMS: its own marks are prices, a dollar line is refused', async () => {
    const text = 'Oud oil AED 120\nMusk oil 45 درهم\nAmber $30';
    // K1 — the list becomes a kept import; its review names the refused line.
    const at = importAt(await form('/app/products/add/review', { text }, cookie));
    const review = await get(at);
    expect(review.statusCode).toBe(200);
    expect(review.body).toContain(t('en', 'product.reject.other_currency', { currency: 'AED', sign: 'AED' }));
    const { res: confirm } = await submitReview(prod.app, cookie, at, { tickAll: true });
    expect(confirm.statusCode).toBe(302);
    const rows = (await admin.query(
      `select p.name, p.currency, p.price_usd_per_unit::float as price, t.currency as tier_currency
         from products p left join price_tiers t on t.product_id = p.id where p.business_id = $1 order by p.name`, [bid])).rows;
    expect(rows).toEqual([
      { name: 'Musk oil', currency: 'AED', price: 45, tier_currency: 'AED' },
      { name: 'Oud oil', currency: 'AED', price: 120, tier_currency: 'AED' },
    ]);
    pid = (await one<{ id: string }>(`select id::text as id from products where business_id = $1 and name = 'Oud oil'`, [bid])).id;

    // Now there is a price: the currency is fixed.
    const fixed = await form('/app/settings/currency', { currency: 'SAR' }, cookie);
    expect(flashSaid(fixed, WEB_SECRET)).toBe(t('en', 'settings.flash.currencyFixed'));
    expect((await one<{ currency: string }>(`select currency from businesses where id = $1`, [bid])).currency).toBe('AED');
    expect((await get('/app/settings/profile')).body).toContain(t('en', 'settings.currency.fixed'));
  });

  it('A FLOOR, A NEW PRICE AND A SAMPLE are in dirhams too', async () => {
    await form('/app/business/prices', { productId: pid, floor: '100', maxDiscountPct: '10', askAbovePct: '5' }, cookie);
    expect(await one(`select currency, floor_price_usd::float as floor from pricing_policy where business_id = $1 and product_id = $2`, [bid, pid]))
      .toEqual({ currency: 'AED', floor: 100 });
    // The page posts the "offered" box with every save; left out, it would switch the product off.
    const edited = await form(`/app/products/${pid}/edit`, { price: '1,250.50', isActive: 'on' }, cookie);
    expect(edited.statusCode).toBe(302);
    expect(await one(`select currency, unit_price_usd::float as price from price_tiers where product_id = $1 and min_qty = 1`, [pid]))
      .toEqual({ currency: 'AED', price: 1250.5 });
    await form('/app/settings/samples', { price: '15', credited: 'on' }, cookie);
    expect(await one(`select currency, price_amount::float as price from sample_policy where business_id = $1 order by stated_at desc limit 1`, [bid]))
      .toEqual({ currency: 'AED', price: 15 });
    // The product's page names the currency on its price box.
    expect((await get(`/app/products/${pid}`)).body).toContain(t('en', 'product.edit.price', { currency: 'AED' }));
  });

  it('THE RATE PAGE HAS NOTHING TO CONVERT for a workspace selling in its country\'s own money', async () => {
    expect((await get('/app/settings/rate')).body).toContain(t('en', 'rate.none', { from: currencyLabel('en', 'AED') }));
    const r = await form('/app/settings/rate', { rate: '3.67' }, cookie);
    expect(flashSaid(r, WEB_SECRET)).toBe(t('en', 'rate.flash.none'));
    expect((await admin.query(`select 1 from owner_rates where business_id = $1`, [bid])).rowCount).toBe(0);
    expect((await get('/app/business')).body).not.toContain('href="/app/settings/rate"');
  });

  it('A QUOTE FROM THOSE ROWS IS IN DIRHAMS, and the same figure in dollars does not leave', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { tenantRepos } = await import('../../src/db/repos.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { computeQuote } = await import('../../src/core/commerce/quote.js');
    const { guardNumerals } = await import('../../src/core/safety/numerals.js');
    const b = parseBusinessId(bid); if (!b.ok) throw new Error('fixture');
    const quote = await withTenantTx(prod.db, b.value, async (tx) => {
      const c = tenantRepos(tx, b.value).catalog;
      const product = await c.product(pid as never);
      if (!product) throw new Error('the floor made it sellable');
      return computeQuote({ product, tiers: await c.priceTiers(pid as never), policy: await c.pricingPolicy(pid as never), rules: [], quantity: 2 });
    });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.value.unitPrice).toEqual({ amount: 1250.5, currency: 'AED' });
    expect(quote.value.total).toEqual({ amount: 2501, currency: 'AED' });
    const state = { quantity: { value: 2, unit: 'pcs' } } as never;
    expect(guardNumerals({ reply: 'That is AED 1,250.50 each, AED 2,501 for the two.', quote: quote.value, state, clientText: '' }).ok).toBe(true);
    expect(guardNumerals({ reply: 'That is $1,250.50 each, $2,501 for the two.', quote: quote.value, state, clientText: '' }).ok).toBe(false);
  });
});
