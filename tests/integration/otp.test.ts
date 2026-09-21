import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createHmac } from 'node:crypto';
import { flashSaid } from './tenant.js';
import { offlineModels } from '../pipeline/fakes.js';

/** The same derivation main.ts makes, so a notice this app minted can be read. */
const WEB_SECRET = createHmac('sha256', 'b'.repeat(64)).update('yf-web-session').digest('hex');

/**
 * A3 — a code by e-mail, end to end: the real composition, real Postgres, and a
 * mailbox that records what would have been sent so the test can read the code
 * the way she would.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `a3550000-0000-4000-8000-${RUN}0001`;
const ABOUT = { kind: 'brand', sells: 'Leather goods', country: 'MA', website: '', teamSize: '1' };
const A = { factory: `Otp Atlas ${RUN}`, name: 'Mei', email: `mei-${RUN}@otp.example`, password: `otp-password-${RUN}`, ...ABOUT };

d('A3 · a code by e-mail at sign-up and on a new browser (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let admin: pg.Client;
  const outbox: { to: string; subject: string; text: string }[] = [];
  let mailUp = true;

  const form = (url: string, fields: Record<string, string>, cookie = '') => prod.app.inject({
    method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
    payload: new URLSearchParams(fields).toString(),
  });
  const cookies = (r: { headers: Record<string, unknown> }) =>
    Object.fromEntries(([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? []).map((c) => {
      const pair = c.split(';')[0]!; const eq = pair.indexOf('='); return [pair.slice(0, eq), pair.slice(eq + 1)];
    }));
  const jar = (o: Record<string, string>) => Object.entries(o).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${v}`).join('; ');
  const lastCode = () => outbox.at(-1)!.subject.match(/\d{6}/)![0];

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    process.env['OWNER_ACCESS_CODE'] = `otp-${RUN}`;
    process.env['SIGNUP_MODE'] = 'open';
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name) values ($1, $2) on conflict (id) do nothing`, [PILOT, `Otp Pilot ${RUN}`]);
    const { buildProduction } = await import('../../src/main.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    prod = await buildProduction({
      provider: 'disabled', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'a3-verify-token-0001',
      CREDENTIAL_KEY: 'b'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, {
      models: offlineModels(),
      logger: false,
      systemMail: { from: 'no-reply@nomi.test', send: async (m) => { if (!mailUp) return { ok: false, error: 'down' }; outbox.push(m); return { ok: true }; } },
    });
  }, 90_000);

  afterAll(async () => { delete process.env['SIGNUP_MODE']; await admin?.end(); await prod?.close(); });

  let pending = '';
  let session = '';
  let device = '';

  it('NOTHING BECOMES A TENANT UNTIL THE CODE COMES BACK — sign-up sends a code and waits', async () => {
    const r = await form('/signup', A);
    expect([r.statusCode, r.headers['location']], r.body.slice(0, 200)).toEqual([302, '/verify']);
    pending = cookies(r)['yf_otp'] ?? '';
    expect(pending).not.toBe('');
    expect(cookies(r)['yf_session'] ?? cookies(r)['yf'] ?? '', 'she is NOT signed in yet').toBe('');

    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe(A.email);
    expect(outbox[0]!.subject).toMatch(/^\d{6} /);
    expect(outbox[0]!.text).toContain(lastCode());

    expect((await admin.query(`select 1 from businesses where name = $1`, [A.factory])).rowCount).toBe(0);
    const waiting = (await admin.query(`select code_hash, payload from login_codes where email = $1`, [A.email])).rows[0];
    expect(waiting.code_hash).not.toContain(lastCode());
    expect(JSON.stringify(waiting.payload)).not.toContain(A.password);
    expect(waiting.payload.passwordHash).toMatch(/^scrypt\$/);

    const page = await prod.app.inject({ method: 'GET', url: '/verify', headers: { cookie: `yf_otp=${pending}` } });
    expect(page.body).toContain(`m••••••@otp.example`.replace('••••••', '•'.repeat(Math.min(6, A.email.indexOf('@') - 1))));
    expect(page.body, 'never the address in full').not.toContain(A.email);
    expect((await prod.app.inject({ method: 'GET', url: '/verify' })).statusCode, 'a browser that is not waiting is sent to the door').toBe(302);
  });

  it('a wrong code is refused and COUNTED; the right one makes the workspace and remembers this browser', async () => {
    const wrong = await form('/verify', { code: lastCode() === '000000' ? '000001' : '000000' }, `yf_otp=${pending}`);
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toContain(t('en', 'verify.error.wrong'));
    expect((await admin.query(`select attempts from login_codes where email = $1 and consumed_at is null`, [A.email])).rows[0].attempts).toBe(1);

    const spaced = `${lastCode().slice(0, 3)} ${lastCode().slice(3)}`;
    const ok = await form('/verify', { code: spaced }, `yf_otp=${pending}`);
    expect(ok.statusCode, ok.body.slice(0, 200)).toBe(302);
    expect(String(ok.headers['location'])).toBe('/app/factory');
    expect(flashSaid(ok, WEB_SECRET)).toBe(t('en', 'signup.welcome'));
    const set = cookies(ok);
    device = set['yf_dev'] ?? '';
    expect(device, 'this browser is now one we have seen').not.toBe('');
    expect(set['yf_otp'], 'the waiting cookie is taken back').toBe('');
    session = jar(Object.fromEntries(Object.entries(set).filter(([k]) => k !== 'yf_otp' && k !== 'yf_dev')));
    expect((await prod.app.inject({ method: 'GET', url: '/app/settings', headers: { cookie: session } })).body).toContain(A.factory);
    expect((await admin.query(`select kind, description from businesses where name = $1`, [A.factory])).rows[0])
      .toEqual({ kind: 'brand', description: 'Leather goods' });

    const again = await form('/verify', { code: lastCode() }, `yf_otp=${pending}`);
    expect(again.statusCode, 'A CODE IS SPENT ONCE').toBe(400);
    expect(again.body).toContain(t('en', 'verify.error.gone'));
  });

  it('SIGNING IN FROM A BROWSER WE HAVE SEEN asks for nothing more; FROM ONE WE HAVE NOT, for a code', async () => {
    const before = outbox.length;
    const known = await form('/login', { email: A.email, password: A.password }, `yf_dev=${device}`);
    expect([known.statusCode, known.headers['location']]).toEqual([302, '/app']);
    expect(outbox.length, 'no mail').toBe(before);

    const fresh = await form('/login', { email: A.email, password: A.password });
    expect([fresh.statusCode, fresh.headers['location']]).toEqual([302, '/verify']);
    expect(outbox.length).toBe(before + 1);
    const wait = cookies(fresh)['yf_otp']!;
    const page = await prod.app.inject({ method: 'GET', url: '/verify', headers: { cookie: `yf_otp=${wait}` } });
    expect(page.body).toContain('This browser is new to us');

    const wrongPassword = await form('/login', { email: A.email, password: 'not-her-password' });
    expect(wrongPassword.statusCode, 'a wrong password never sends a code').toBe(401);
    expect(outbox.length).toBe(before + 1);

    const ok = await form('/verify', { code: lastCode() }, `yf_otp=${wait}`);
    expect([ok.statusCode, ok.headers['location']]).toEqual([302, '/app']);
    expect(cookies(ok)['yf_dev'], 'and this browser is remembered too').toBeTruthy();
  });

  it('"SEND ME A NEW CODE" closes the old one, and five wrong tries close a code for good', async () => {
    const start = await form('/login', { email: A.email, password: A.password });
    const first = cookies(start)['yf_otp']!;
    const old = lastCode();
    const resent = await form('/verify/resend', {}, `yf_otp=${first}`);
    expect([resent.statusCode, resent.headers['location']]).toEqual([302, '/verify?sent=1']);
    const second = cookies(resent)['yf_otp']!;
    expect(lastCode()).not.toBe(old);
    expect((await form('/verify', { code: old }, `yf_otp=${first}`)).body, 'the earlier mail no longer works').toContain(t('en', 'verify.error.gone'));

    const bad = lastCode() === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i++) expect((await form('/verify', { code: bad }, `yf_otp=${second}`)).statusCode).toBe(401);
    const sixth = await form('/verify', { code: lastCode() }, `yf_otp=${second}`);
    expect(sixth.statusCode, 'even the RIGHT code, after five wrong ones').toBe(400);
    expect(sixth.body).toContain(t('en', 'verify.error.spent'));
  });

  it('AN ADDRESS IS SENT SIX CODES AN HOUR AND NO MORE — counted in the database', async () => {
    const sentSoFar = (await admin.query(`select count(*)::int as n from login_codes where email = $1`, [A.email])).rows[0].n as number;
    let refused = 0;
    for (let i = sentSoFar; i < 8; i++) {
      const r = await form('/login', { email: A.email, password: A.password });
      if (r.statusCode === 429) { refused++; expect(r.body).toContain(t('en', 'login.slow')); }
    }
    expect(refused).toBeGreaterThan(0);
    expect((await admin.query(`select count(*)::int as n from login_codes where email = $1`, [A.email])).rows[0].n).toBe(6);
  });

  it('A SENDER THAT IS DOWN DOES NOT LOCK HER OUT of her own business — and makes no half-made workspace at sign-up', async () => {
    mailUp = false;
    const other = { ...A, factory: `Otp Bolt ${RUN}`, email: `omar-${RUN}@otp.example` };
    const signup = await form('/signup', other);
    expect(signup.statusCode).toBe(502);
    expect(signup.body).toContain(t('en', 'verify.error.mail'));
    expect((await admin.query(`select 1 from businesses where name = $1`, [other.factory])).rowCount).toBe(0);

    await admin.query(`delete from login_codes where email = $1`, [A.email]);   // a fresh hour
    const login = await form('/login', { email: A.email, password: A.password });
    expect([login.statusCode, login.headers['location']], 'the password was right; the mail could not be sent; she is let in').toEqual([302, '/app']);
    mailUp = true;
  });

  it('an address that already has a workspace is told so at once, and is sent nothing', async () => {
    const before = outbox.length;
    const r = await form('/signup', { ...A, factory: 'Copycat' });
    expect(r.statusCode).toBe(400);
    expect(r.body).toContain(t('en', 'signup.error.email_taken'));
    expect(outbox.length).toBe(before);
  });

  it('the application role cannot read a waiting code', async () => {
    const { sql } = await import('kysely');
    await expect(sql`select count(*) from login_codes`.execute(prod.db)).rejects.toThrow(/permission denied/);
  });
});
