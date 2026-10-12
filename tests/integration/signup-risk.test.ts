import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { offlineModels } from '../pipeline/fakes.js';
import { PASSING_BOT_CHECK } from './signUpWithCode.js';

/**
 * Phase 1 (the owner's roadmap, 2026-10-13) — OPEN SIGN-UP WITH TRIAL-ABUSE SCORING, end to end: the production
 * composition (its door limits on), real Postgres, a mailbox that records the codes.
 *
 *   · a first sign-up is low: made, marked, and its subscription would start with the installation's trial;
 *   · the same browser again, or the same mailbox under a "+tag": refused, in plain words, with the way to a
 *     person — no code is sent;
 *   · a throwaway mailbox: made, but a card comes first and there is no trial, and the owner is told at once;
 *   · the same browser on the same network with its cookie gone: a card;
 *   · an invitation vouches: the same browser again is let in;
 *   · the marks: attempts counted for a day, forgotten after two; a workspace's after 180; the app touches only
 *     the functions.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `a1f10000-0000-4000-8000-${RUN}0001`;
// This run's own networks (10.x.y.0/24), so no earlier run's marks are shared.
const A = parseInt(RUN.slice(0, 2), 16);
const B = parseInt(RUN.slice(2, 4), 16);
const net = (n: number, host: number) => `10.${A}.${(B + n) % 256}.${host}`;
const ABOUT = { kind: 'brand', sells: 'Candles', country: 'AE', website: '', teamSize: '2-5', terms: 'on', age: '34' };
const shop = (n: string, email: string) => ({ ...ABOUT, factory: `Risk ${n} ${RUN}`, name: 'Mona', email, password: `risk-password-${RUN}-${n}` });

d('Phase 1 · open sign-up, scored (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let admin: pg.Client;
  let app: pg.Client;
  let trialBefore: number | null = null;
  const outbox: { to: string; subject: string; text: string }[] = [];
  const cookiesOf = (r: { headers: Record<string, unknown> }): string[] =>
    ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? []).map((c) => c.split(';')[0]!);
  /** A browser: its own sign-up cookie (from the form's page), its own address and its own User-Agent. */
  const browser = async (ip: string, ua = 'Mozilla/5.0 (Macintosh) RiskTest/1.0') => {
    const page = await prod.app.inject({ method: 'GET', url: '/signup', headers: { 'x-forwarded-for': ip, 'user-agent': ua } });
    const cookie = cookiesOf(page).find((c) => c.startsWith('yf_signup=')) ?? '';
    return { ip, ua, cookie };
  };
  const post = (b: { ip: string; ua: string; cookie: string }, url: string, fields: Record<string, string>, extra = '') =>
    prod.app.inject({
      method: 'POST', url, payload: new URLSearchParams(fields).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': b.ip, 'user-agent': b.ua,
        cookie: [b.cookie, extra].filter(Boolean).join('; ') },
    });
  /** The form, then the code from the mail: the workspace, and the cookies the answer set. */
  const signUp = async (b: { ip: string; ua: string; cookie: string }, fields: Record<string, string>) => {
    const asked = await post(b, '/signup', fields);
    expect([asked.statusCode, asked.headers['location']], asked.body.slice(0, 300)).toEqual([302, '/verify']);
    const otp = cookiesOf(asked).find((c) => c.startsWith('yf_otp=')) ?? '';
    const code = [...outbox].reverse().find((m) => m.to === fields['email'])?.subject.match(/\d{6}/)?.[0];
    const made = await post(b, '/verify', { code: code! }, otp);
    expect([made.statusCode, made.headers['location']]).toEqual([302, '/app/business']);
    const business = (await admin.query(`select b.id::text as id from businesses b join logins l on l.business_id = b.id where l.email = $1`,
      [fields['email']!.toLowerCase()])).rows[0].id as string;
    return { business, cookies: cookiesOf(made).join('; ') };
  };
  const risk = async (business: string) =>
    (await admin.query(`select tier, reasons from signup_risk where business_id = $1`, [business])).rows[0] as { tier: string; reasons: string[] } | undefined;
  /** As the app, inside the workspace: what billing says. */
  const billing = async (business: string) => {
    await app.query('begin');
    try {
      await app.query(`select set_config('app.business_id', $1, true)`, [business]);
      const r = (await app.query(`select billing_card_needed() as card, (select trial_days from billing_state()) as trial`)).rows[0];
      return { card: r.card as boolean, trial: r.trial as number | null };
    } finally { await app.query('rollback'); }
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    app = new pg.Client({ connectionString: DATABASE_URL });
    await app.connect();
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en') on conflict (id) do nothing`, [PILOT, `Risk Pilot ${RUN}`]);
    // The installation offers a 14-day trial for this file; put back after.
    trialBefore = (await admin.query(`select self_serve_trial_days as d from billing_settings where id`)).rows[0].d;
    await admin.query(`update billing_settings set self_serve_trial_days = 14 where id`);
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    process.env['OWNER_ACCESS_CODE'] = `risk-${RUN}`;
    process.env['SIGNUP_MODE'] = 'open';
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'risk-verify-token-01',
      CREDENTIAL_KEY: 'c'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, {
      adapter: whatsappSimulator([], { tag: `risk${RUN}` }).adapter, media: {}, models: offlineModels(), logger: false,
      // Production's door limits stay on (no `signupGuard` override): the score is one of them.
      botCheck: PASSING_BOT_CHECK,
      systemMail: { from: 'no-reply@nomi.test', send: async (m) => { outbox.push(m); return { ok: true }; } },
    } as Parameters<typeof buildProduction>[1]);
  }, 90_000);
  afterAll(async () => {
    delete process.env['SIGNUP_MODE'];
    await admin?.query(`update billing_settings set self_serve_trial_days = $1 where id`, [trialBefore]).catch(() => undefined);
    await app?.end(); await admin?.end(); await prod?.close();
  });

  let first: { ip: string; ua: string; cookie: string };
  let firstEmail = '';

  it('LOW: a first sign-up is made and marked; its subscription would start with the installation\'s trial; no card is asked for', async () => {
    first = await browser(net(1, 10));
    expect(first.cookie).toMatch(/^yf_signup=[A-Za-z0-9_-]{24}$/);
    firstEmail = `mona.${RUN}@shop-${RUN}.example`;
    const { business } = await signUp(first, shop('first', firstEmail));
    expect(await risk(business)).toEqual({ tier: 'low', reasons: [] });
    expect(await billing(business)).toEqual({ card: false, trial: 14 });
    expect((await admin.query(`select trial_days_for($1::uuid) as d`, [business])).rows[0].d).toBe(14);
  });

  it('HIGH, THE SAME BROWSER: refused in plain words, the way to a person shown, and no code sent', async () => {
    const again = { ...first, ip: net(2, 10) };
    const email = `other.${RUN}@second-${RUN}.example`;
    const r = await post(again, '/signup', shop('again', email));
    expect(r.statusCode).toBe(403);
    expect(r.body).toContain(t('en', 'signup.riskRefused'));
    expect(r.body).not.toContain('<form');
    expect(outbox.some((m) => m.to === email)).toBe(false);
  });

  it('HIGH, THE SAME MAILBOX: a "+tag" of the first address, from another browser and network, is refused', async () => {
    const b = await browser(net(3, 10), 'Mozilla/5.0 (Windows) Other/2.0');
    const [local, domain] = firstEmail.split('@');
    const r = await post(b, '/signup', shop('alias', `${local}+second@${domain}`));
    expect(r.statusCode).toBe(403);
    expect(r.body).toContain(t('en', 'signup.riskRefused'));
  });

  it('MEDIUM, A THROWAWAY MAILBOX: made, but a card comes first and there is no trial — and the owner is told at once', async () => {
    const b = await browser(net(4, 10), 'Mozilla/5.0 (Linux) Throwaway/3.0');
    const { business, cookies } = await signUp(b, shop('throwaway', `box${RUN}@mailinator.com`));
    expect(await risk(business)).toEqual({ tier: 'medium', reasons: ['fresh_email'] });
    expect(await billing(business)).toEqual({ card: true, trial: null });
    const welcome = await prod.app.inject({ method: 'GET', url: '/app/business', headers: { cookie: cookies } });
    expect(welcome.body).toContain(t('en', 'signup.welcome.card'));
  });

  it('MEDIUM, THE SAME BROWSER WITH ITS COOKIE GONE: the same fingerprint on the same network asks for a card', async () => {
    const same = { ip: net(1, 11), ua: first.ua, cookie: '' };
    const { business } = await signUp(same, shop('nocookie', `third.${RUN}@third-${RUN}.example`));
    expect(await risk(business)).toEqual({ tier: 'medium', reasons: ['repeat_fingerprint', 'repeat_network'] });
    expect((await billing(business)).card).toBe(true);
  });

  it('AN INVITATION VOUCHES: the first browser again, holding one, is let in and recorded as low', async () => {
    const invite = (await admin.query(`insert into signup_invites (note) values ($1) returning id::text as id`, [`risk ${RUN}`])).rows[0].id as string;
    const { business } = await signUp({ ...first, ip: net(5, 10) }, { ...shop('invited', `invited.${RUN}@invited-${RUN}.example`), invite });
    const r = await risk(business);
    expect(r?.tier).toBe('low');
    expect(r?.reasons).toContain('repeat_device');
  });

  it('THE MARKS: attempts count for a day; the job forgets an attempt after two days and a workspace\'s after 180', async () => {
    // Every code here is this run's own (its id, then a tag): a fixed one could be another run's, or another of these.
    const hex = (c: string) => `${RUN}${'0'.repeat(55)}${c}`;
    const [dev, nw] = [hex('a'), hex('b')];
    for (let i = 0; i < 6; i++) await app.query(`select signup_mark_attempt($1, $2)`, [dev, nw]);
    const seen = (await app.query(`select * from signup_marks_seen($1, null, $2, $3)`, [dev, nw, hex('e')])).rows[0];
    expect(seen.attempts_device).toBeGreaterThanOrEqual(6);
    expect(seen.attempts_network).toBeGreaterThanOrEqual(6);
    await admin.query(`insert into signup_marks (kind, digest, what, at) values
      ('device', $1, 'attempt', now() - interval '3 days'), ('email', $2, 'workspace', now() - interval '181 days'),
      ('email', $3, 'workspace', now() - interval '179 days')`, [hex('1'), hex('2'), hex('3')]);
    expect(Number((await app.query(`select signup_marks_forget() as n`)).rows[0].n)).toBeGreaterThanOrEqual(2);
    const left = (await admin.query(`select digest from signup_marks where digest in ($1, $2, $3)`, [hex('1'), hex('2'), hex('3')])).rows.map((r) => r.digest);
    expect(left).toEqual([hex('3')]);
    await admin.query(`delete from signup_marks where digest in ($1, $2, $3)`, [dev, nw, hex('3')]);
  });

  it('THE APP touches only the functions: it can neither read nor write the marks, and reads only its own risk row', async () => {
    await expect(app.query(`select count(*) from signup_marks`)).rejects.toThrow(/permission denied/);
    await expect(app.query(`insert into signup_marks (kind, digest, what) values ('device', $1, 'attempt')`, ['a'.repeat(64)]))
      .rejects.toThrow(/permission denied/);
    await app.query('begin');
    await app.query(`select set_config('app.business_id', $1, true)`, [PILOT]);
    expect((await app.query(`select count(*)::int as n from signup_risk`)).rows[0].n).toBe(0);
    await app.query('rollback');
  });
});
