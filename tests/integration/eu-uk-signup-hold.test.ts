import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { offlineModels } from '../pipeline/fakes.js';
import { PASSING_BOT_CHECK } from './signUpWithCode.js';

/**
 * A BUSINESS IN THE EU, THE EEA OR THE UK WAITS AT SIGN-UP (the owner, 2026-10-28; src/core/legal/transfer.ts) —
 * through the production composition, which reads `EU_UK_SIGNUP` itself:
 *
 *   · unset, a French or a British business is told plainly, with the contact address; no code is sent and nothing
 *     is made. A business elsewhere signs up as before.
 *   · `EU_UK_SIGNUP=open`, a British business gets its code…
 *   · …and if the hold is back before the code returns (the installation started again without it), /verify opens
 *     nothing.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `e0e00000-0000-4000-8000-${RUN}0001`;
const shop = (country: string, who: string) => ({
  factory: `Hold ${who} ${RUN}`, name: 'Sam', email: `${who}-${RUN}@shop.example`, password: `hold-password-${RUN}`,
  kind: 'brand', sells: 'Linen shirts', country, website: '', teamSize: '2-5', terms: 'on', age: '34',
});
const FR = shop('FR', 'paris');
const UK = shop('UK', 'leeds');          // typed as people type it; read as GB
const NO = shop('NO', 'oslo');           // the EEA: the GDPR applies in full
const AE = shop('AE', 'dubai');
const GB = shop('GB', 'york');

d('the EU, the EEA and the UK wait at sign-up (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 180_000 }, () => {
  type Production = import('../../src/main.js').Production;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let admin: pg.Client;
  const outbox: { to: string; subject: string }[] = [];
  const mailTo = (to: string) => outbox.filter((m) => m.to === to);
  const made = async (email: string) =>
    (await admin.query(`select count(*)::int as n from logins where email = $1`, [email])).rows[0].n as number;

  const build = async (): Promise<Production> => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    return buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'eu-uk-verify-token-01',
      CREDENTIAL_KEY: 'e'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test', LEGAL_CONTACT_EMAIL: 'legal@nomi.test',
    }, {
      adapter: whatsappSimulator([], { tag: `eu${RUN}` }).adapter, media: {}, models: offlineModels(), logger: false,
      botCheck: PASSING_BOT_CHECK, signupGuard: null,
      systemMail: { from: 'no-reply@nomi.test', send: async (m) => { outbox.push({ to: m.to, subject: m.subject }); return { ok: true }; } },
    } as Parameters<typeof buildProduction>[1]);
  };
  const form = (prod: Production, url: string, fields: Record<string, string>, cookie = '') => prod.app.inject({
    method: 'POST', url, payload: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `198.51.100.${RUN.charCodeAt(2) % 200}`, ...(cookie ? { cookie } : {}) },
  });
  const otpCookie = (r: { headers: Record<string, unknown> }) =>
    ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_otp=')) ?? '';

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en') on conflict (id) do nothing`, [PILOT, `EU hold pilot ${RUN}`]);
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    process.env['OWNER_ACCESS_CODE'] = `eu-${RUN}`;
    process.env['SIGNUP_MODE'] = 'open';
    delete process.env['EU_UK_SIGNUP'];
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
  }, 60_000);
  afterAll(async () => {
    for (const k of ['SIGNUP_MODE', 'EU_UK_SIGNUP']) delete process.env[k];
    await admin?.end();
  });

  it('unset: a business in France, the UK or Norway is told plainly, with the contact address; no code, nothing made', async () => {
    const prod = await build();
    try {
      for (const s of [FR, UK, NO]) {
        const r = await form(prod, '/signup', s);
        expect(r.statusCode, s.country).toBe(403);
        expect(r.body, s.country).toContain(`role="alert">${t('en', 'signup.transferHeld')}</p>`);
        expect(r.body, s.country).toContain('href="mailto:legal@nomi.test"');
        expect(r.body, s.country).not.toContain('action="/signup"');
        expect(mailTo(s.email), `${s.country}: no code`).toEqual([]);
        expect(await made(s.email), s.country).toBe(0);
      }
      // a business elsewhere goes on to its code, as before
      const ae = await form(prod, '/signup', AE);
      expect([ae.statusCode, ae.headers['location']]).toEqual([302, '/verify']);
      expect(mailTo(AE.email).length).toBe(1);
    } finally {
      await prod.close();
    }
  });

  it('EU_UK_SIGNUP=open: a British business gets its code; the hold back before it returns, /verify opens nothing', async () => {
    process.env['EU_UK_SIGNUP'] = 'open';
    let prod = await build();
    let sent: Awaited<ReturnType<typeof form>>;
    try {
      sent = await form(prod, '/signup', GB);
      expect([sent.statusCode, sent.headers['location']]).toEqual([302, '/verify']);
    } finally {
      await prod.close();
    }
    const code = mailTo(GB.email).at(-1)!.subject.match(/\d{6}/)![0];

    delete process.env['EU_UK_SIGNUP'];
    prod = await build();
    try {
      const back = await form(prod, '/verify', { code }, otpCookie(sent));
      expect(back.statusCode).toBe(403);
      expect(back.body).toContain(t('en', 'signup.transferHeld'));
      expect(await made(GB.email)).toBe(0);
    } finally {
      await prod.close();
    }
  });
});
