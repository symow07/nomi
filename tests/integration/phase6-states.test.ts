import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import pg from 'pg';
import { FLASH_COOKIE } from '../../src/api/web/flash.js';
import { offlineModels } from '../pipeline/fakes.js';
import { signUpWithCode, type Outbox, PASSING_BOT_CHECK } from './signUpWithCode.js';

/** The same derivation main.ts makes, so a notice this app minted can be read. */
const WEB_SECRET = createHmac('sha256', 'a'.repeat(64)).update('yf-web-session').digest('hex');

/**
 * PHASE 6 OF THE UI REBUILD (2026-10-02), through the real production
 * composition and real Postgres: a refusal about one field comes back on the
 * same page (400), under that field, with what was typed; a page that is not
 * there says so as a state; "Mine" with nothing held is not an empty business;
 * Billing back from Stripe watches for the card.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `c0de0000-0000-4000-8000-${RUN}0006`;
const ABOUT = { kind: 'retail', sells: 'Rugs', website: '', teamSize: '2-5', terms: 'on' };

d('phase 6 · states (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  const outbox: Outbox = [];
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let admin: pg.Client;
  let cookie = '';
  let bid = '';

  const visitor = `198.51.100.${(RUN.charCodeAt(3) % 200) + 20}`;
  const form = (url: string, fields: Record<string, string>, c = '') => prod.app.inject({
    method: 'POST', url,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': visitor, ...(c ? { cookie: c } : {}) },
    payload: new URLSearchParams(fields).toString(),
  });
  const cookieOf = (r: { headers: Record<string, unknown> }, name: string) =>
    ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? [])
      .map((c) => c.split(';')[0]!).find((c) => c.startsWith(`${name}=`) && c !== `${name}=`) ?? '';
  /** Where an action lands, drawn with the notice it left — as the browser follows the redirect. */
  const landing = async (r: { statusCode: number; headers: Record<string, unknown> }) => {
    expect(r.statusCode).toBe(302);
    const flash = cookieOf(r, FLASH_COOKIE);
    return prod.app.inject({ method: 'GET', url: String(r.headers['location']), headers: { cookie: `${cookie}; ${flash}` } });
  };
  const one = async <T>(q: string, args: unknown[]): Promise<T> => (await admin.query(q, args)).rows[0] as T;
  const UNDO = (action: string) => `<form method="post" action="${action}" class="undo">`;

  const A = { ...ABOUT, factory: `Rug Room ${RUN}`, name: 'Sami', email: `sami-${RUN}@rugs.example`, password: `rugs-password-${RUN}`, country: 'AE', invite: '' };

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    process.env['OWNER_ACCESS_CODE'] = `phase6-${RUN}`;
    process.env['SIGNUP_MODE'] = 'open';
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name) values ($1, $2) on conflict (id) do nothing`, [PILOT, `Pilot ${RUN}`]);
    const { buildProduction } = await import('../../src/main.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    prod = await buildProduction({
      provider: 'disabled', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'p6-verify-token-0001',
      CREDENTIAL_KEY: 'a'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { models: offlineModels(), logger: false, botCheck: PASSING_BOT_CHECK, signupGuard: null, systemMail: { from: 'no-reply@nomi.test', send: async (m) => { outbox.push(m); return { ok: true }; } } });
    const made = await signUpWithCode(form, outbox, A);
    expect(made.statusCode, made.body.slice(0, 300)).toBe(302);
    cookie = cookieOf(made, 'yf_session');
    bid = (await one<{ id: string }>(`select id::text as id from businesses where name = $1`, [A.factory])).id;
  }, 90_000);

  afterAll(async () => {
    delete process.env['SIGNUP_MODE'];
    await admin?.end();
    await prod?.close();
  });

  const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });

  it('A CLOSURE WITH ITS DAYS BACK TO FRONT: the same page, 400, the reason under the last day, everything typed still there', async () => {
    const r = await form('/app/settings/closures', { label: 'Eid', from: '2026-12-04', to: '2026-12-01' }, cookie);
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain('action="/app/settings/closures"');
    expect(r.body).toContain('value="Eid"');
    expect(r.body).toContain(`<span class="fielderr" role="alert" id="cl-to-err">${t('en', 'closures.flash.ends_before_starts')}</span>`);
    // The warmth run, phase 9 (V1-008) — a date posted whole comes back in its three parts, the wrong one marked.
    expect(r.body).toContain('name="to_d" inputmode="numeric" autocomplete="off" required maxlength="2" value="01" aria-invalid="true"');
    expect(r.body).toContain('<option value="12" selected>');
    expect((await one<{ n: number }>(`select count(*)::int as n from factory_closures where business_id = $1`, [bid])).n).toBe(0);
  });

  it('A FORBIDDEN WORD LEFT EMPTY, and the rate and the sample price not numbers: each said under its own field', async () => {
    const w = await form('/app/settings/forbidden', { term: '   ', note: 'why' }, cookie);
    expect(w.statusCode).toBe(400);
    expect(w.body).toContain('id="fb-term-err"');
    expect(w.body).toContain('value="why"');
    const s = await form('/app/settings/samples', { price: 'abc' }, cookie);
    expect(s.statusCode).toBe(400);
    expect(s.body).toContain('id="sm-price-err"');
    expect(s.body).toContain('value="abc"');
  });

  it('A PAGE OF THE SITE THAT IS NOT AN ADDRESS: Knowledge itself, 400, the reason under the address, the address kept', async () => {
    const r = await form('/app/knowledge/from-page', { address: 'not a shop', text: '' }, cookie);
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain('id="pf-err"');
    expect(r.body).toContain('value="not a shop"');
    expect(r.body).toContain(`<h1 class="page">${t('en', 'nav.knowledge')}</h1>`);
  });

  it('A PRODUCT, A CONVERSATION AND AN ORDER THAT ARE NOT THERE: a state with the reason and the way back', async () => {
    for (const url of ['/app/products/00000000-0000-4000-8000-000000000000', '/app/inbox/00000000-0000-4000-8000-000000000000', '/app/orders/00000000-0000-4000-8000-000000000000']) {
      const r = await get(url);
      expect(r.body, url).toContain(`<div class="empty">${t('en', 'common.notFoundBody')}`);
    }
  });

  // The warmth run, phase 4 — "Mine" was team machinery the owner ruled out: its address leads
  // to the whole list (the closest lens), so its empty panel is never drawn.
  it('"MINE" is not a view any more: its address leads to the whole list', async () => {
    const r = await get('/app/inbox?filter=mine');
    expect(r.statusCode).toBe(302);
    expect(r.headers['location']).toBe('/app/inbox');
    expect((await get('/app/inbox')).body).not.toContain(t('en', 'inbox.empty.mine'));
  });

  it('BILLING ASKS WHETHER THE CARD IS CONFIRMED: at work until it is', async () => {
    const r = await prod.app.inject({ method: 'GET', url: '/app/live/billing?since=0.none', headers: { cookie, accept: 'application/json' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ working: true });
  });
});
