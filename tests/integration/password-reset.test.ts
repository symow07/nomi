import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { offlineModels } from '../pipeline/fakes.js';

/**
 * PWR2 — "Forgot your password?" held to the standard, end to end: the real
 * composition, real Postgres, and a mailbox that records what would have been
 * sent, so the test opens each link the way its owner would.
 *
 *   · a link by e-mail: only its digest stored; it works once; a second use and
 *     a lapsed link are refused and change nothing;
 *   · saving a new password ends every other session of that login AT ONCE,
 *     and the address is told a new password was saved;
 *   · an unknown address, an address that never answered, an archived login:
 *     the same status, headers and words — and no mail;
 *   · an address proves itself by typing back a code (0129), and only then is
 *     it sent a link;
 *   · a staff member's login works the same as the owner's;
 *   · the same answer time, measured over many asks;
 *   · the link opens in the mail's language, and switching language keeps it;
 *   · a mail that cannot leave is written down for the operator, without the
 *     address.
 *
 * tests/integration/password-recovery.test.ts holds 0084's own rules (three an
 * hour, the newest link, the per-caller limit); tests/integration/
 * password-reset-mailbox.test.ts holds the way the mail leaves (HTTPS).
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `a5c00000-0000-4000-8000-${RUN}0001`;
const SHOP = `a5c00000-0000-4000-8000-${RUN}0002`;
const NEWB = `a5c00000-0000-4000-8000-${RUN}0003`;
const OWNER = `owner-${RUN}@reset.example`;
const STAFF = `staff-${RUN}@reset.example`;
const FRESH = `fresh-${RUN}@reset.example`;
const TIMED = `timed-${RUN}@reset.example`;
const BROKEN = `broken-${RUN}@reset.example`;
const GONE = `gone-${RUN}@reset.example`;
const OLD = `old-password-${RUN}`;

d('PWR2 · a self-service reset, to the standard (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 180_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let admin: pg.Client;
  const outbox: { to: string; subject: string; text: string }[] = [];
  /** An address whose mail does not leave: the transport's answer names it, as a provider's might. */
  const failFor = new Set<string>();
  /** How long a mail takes to leave — the answer must never wait for it. */
  let mailDelayMs = 0;

  const form = (url: string, fields: Record<string, string>, headers: Record<string, string> = {}) => prod.app.inject({
    method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    payload: new URLSearchParams(fields).toString(),
  });
  let caller = 0;
  /** A distinct caller each time, so the per-caller limit is not what is tested. */
  const from = (): Record<string, string> => ({ 'x-forwarded-for': `198.18.${Math.floor(++caller / 250)}.${caller % 250}` });
  const ask = (email: string, headers: Record<string, string> = {}) => form('/login/forgot', { email }, { ...from(), ...headers });
  const mailsTo = (to: string) => outbox.filter((m) => m.to === to);
  const until = async (ok: () => boolean | Promise<boolean>, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await ok()) return true; await new Promise((r) => setTimeout(r, 25)); }
    return ok();
  };
  const tokenIn = (text: string): string => {
    const m = /https:\/\/nomi\.test\/login\/set-password\?t=([A-Za-z0-9_-]{43})&l=(en|zh|ar|es|fr)/.exec(text);
    if (!m) throw new Error('no link in the mail');
    return m[1]!;
  };
  /** Ask, and the token of the mail that arrives for it. */
  const linkFor = async (email: string, headers: Record<string, string> = {}): Promise<string> => {
    const before = mailsTo(email).length;
    expect((await ask(email, headers)).statusCode).toBe(200);
    expect(await until(() => mailsTo(email).length > before), `a link for ${email}`).toBe(true);
    return tokenIn(mailsTo(email).at(-1)!.text);
  };
  const setCookies = (r: { headers: Record<string, unknown> }): string[] => ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? []);
  const cookieValue = (r: { headers: Record<string, unknown> }, name: string): string | undefined =>
    setCookies(r).map((c) => c.split(';')[0]!).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
  /** Signs in as a new browser would: the password, then the code the address was mailed. The session cookie. */
  const signIn = async (email: string, password: string): Promise<string> => {
    const r = await form('/login', { email, password }, from());
    expect(r.statusCode, r.body.slice(0, 300)).toBe(302);
    if (r.headers['location'] !== '/verify') return `yf_session=${cookieValue(r, 'yf_session')}`;
    const waiting = cookieValue(r, 'yf_otp')!;
    const code = outbox.filter((m) => m.to === email).at(-1)!.subject.match(/\d{6}/)![0];
    const v = await form('/verify', { code }, { ...from(), cookie: `yf_otp=${waiting}` });
    expect(v.statusCode, v.body.slice(0, 300)).toBe(302);
    const session = cookieValue(v, 'yf_session');
    expect(session, 'a session').toBeTruthy();
    return `yf_session=${session}`;
  };
  const save = (token: string, password: string, cookie = '') =>
    form('/login/set-password', { t: token, password, repeat: password }, { ...from(), ...(cookie ? { cookie } : {}) });
  const hashOf = async (email: string): Promise<string> =>
    (await admin.query('select password_hash from logins where email = $1 and archived_at is null', [email])).rows[0].password_hash;

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    process.env['OWNER_ACCESS_CODE'] = `pwr2-${RUN}`;
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { hashPassword } = await import('../../src/security/password.js');
    const old = await hashPassword(OLD);
    for (const [id, name] of [[PILOT, `Pwr2 Pilot ${RUN}`], [SHOP, `Pwr2 Shop ${RUN}`], [NEWB, `Pwr2 New ${RUN}`]] as const) {
      await admin.query('insert into businesses (id, name, is_active) values ($1, $2, true) on conflict (id) do nothing', [id, name]);
    }
    // [business, e-mail, owner?, address proven?, archived?]
    const people: [string, string, boolean, boolean, boolean][] = [
      [SHOP, OWNER, true, true, false], [SHOP, STAFF, false, true, false], [SHOP, TIMED, false, true, false],
      [SHOP, BROKEN, false, true, false], [SHOP, GONE, false, true, true], [NEWB, FRESH, true, false, false],
    ];
    for (const [biz, email, owner, proven, archived] of people) {
      const person = (await admin.query(
        'insert into people (business_id, name, is_owner) values ($1, $2, $3) returning id', [biz, email.split('-')[0], owner])).rows[0].id;
      await admin.query(`insert into logins (business_id, person_id, email, password_hash, email_verified_at, archived_at)
                         values ($1, $2, $3, $4, $5, $6)`,
        [biz, person, email, old, proven ? new Date() : null, archived ? new Date() : null]);
    }
    const { buildProduction } = await import('../../src/main.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    prod = await buildProduction({
      provider: 'disabled', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'pwr2-verify-token-001',
      CREDENTIAL_KEY: 'f'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, {
      models: offlineModels(), logger: false,
      systemMail: {
        from: 'no-reply@nomi.test',
        send: async (m) => {
          if (mailDelayMs) await new Promise((r) => setTimeout(r, mailDelayMs));
          if (failFor.has(m.to)) return { ok: false, error: `mailbox: provider 500 for ${m.to} · smtp: unreachable` };
          outbox.push(m);
          return { ok: true };
        },
      },
    });
  }, 90_000);
  afterAll(async () => { await admin?.end(); await prod?.close(); });

  it('a link: only its digest kept, good for 60 minutes, works ONCE; a second use and a lapsed link change nothing', async () => {
    const token = await linkFor(OWNER);
    const row = (await admin.query(
      `select s.token_hash, s.made_by, extract(epoch from s.expires_at - s.created_at)::int as secs
         from login_setups s join logins l on l.id = s.login_id where l.email = $1 order by s.created_at desc limit 1`, [OWNER])).rows[0];
    expect(row.token_hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(row.made_by).toBe('recovery');
    expect(row.secs).toBe(3600);
    expect((await admin.query('select count(*)::int as n from login_setups where token_hash = $1', [token])).rows[0].n, 'never the token itself').toBe(0);

    const opened = await prod.app.inject({ method: 'GET', url: `/login/set-password?t=${token}&l=en`, headers: from() });
    expect(opened.statusCode).toBe(200);
    expect(opened.headers['referrer-policy']).toBe('no-referrer');
    expect(opened.headers['cache-control']).toBe('no-store');
    expect(setCookies(opened).find((c) => c.startsWith('yf_setlink='))).toMatch(/HttpOnly; Path=\/login\/set-password; SameSite=Lax; Max-Age=3600/);

    const saved = await save(token, `new-password-${RUN}`);
    expect(saved.statusCode).toBe(200);
    expect(saved.body).toContain(t('en', 'login.passwordSet'));
    expect(setCookies(saved).find((c) => c.startsWith('yf_setlink='))).toMatch(/^yf_setlink=; .*Max-Age=0/);
    const afterFirst = await hashOf(OWNER);

    // used: refused, whichever way it comes back
    expect((await prod.app.inject({ method: 'GET', url: `/login/set-password?t=${token}`, headers: from() })).statusCode).toBe(404);
    const again = await save(token, `third-password-${RUN}`);
    expect(again.statusCode).toBe(404);
    expect(again.body).toContain(t('en', 'setpw.gone.title'));
    expect(await hashOf(OWNER), 'a second use changes nothing').toBe(afterFirst);

    // lapsed: refused
    const late = await linkFor(OWNER);
    await admin.query(`update login_setups set expires_at = now() - interval '1 minute' where token_hash = $1`,
      [createHash('sha256').update(late, 'utf8').digest('hex')]);
    expect((await prod.app.inject({ method: 'GET', url: `/login/set-password?t=${late}`, headers: from() })).statusCode).toBe(404);
    expect((await save(late, `late-password-${RUN}`)).statusCode).toBe(404);
    expect(await hashOf(OWNER), 'a lapsed link changes nothing').toBe(afterFirst);

    // the address is told a new password was saved, with the way to undo it
    const told = mailsTo(OWNER).filter((m) => m.subject === t('en', 'setpw.changed.mail.subject'));
    expect(told).toHaveLength(1);
    expect(told[0]!.text).toContain('https://nomi.test/login/forgot');
    expect(told[0]!.text).not.toMatch(/set-password\?t=/);
  });

  it('saving a new password signs out every other session of that login at once', async () => {
    const elsewhere = await signIn(OWNER, `new-password-${RUN}`);
    // seen once, so this process holds the answer for a minute
    expect((await prod.app.inject({ method: 'GET', url: '/app', headers: { cookie: elsewhere } })).statusCode).toBe(200);
    const token = await linkFor(OWNER);
    expect((await save(token, `fourth-password-${RUN}`)).statusCode).toBe(200);
    const after = await prod.app.inject({ method: 'GET', url: '/app', headers: { cookie: elsewhere } });
    expect([after.statusCode, after.headers['location']], 'the other session ended now, not within the minute').toEqual([302, '/login']);
    // and the new password opens a fresh one
    const fresh = await signIn(OWNER, `fourth-password-${RUN}`);
    expect((await prod.app.inject({ method: 'GET', url: '/app', headers: { cookie: fresh } })).statusCode).toBe(200);
  });

  it('an unknown address, one that never answered, an archived login: the same status, headers and words — and no mail', async () => {
    const before = outbox.length;
    const known = await ask(STAFF);
    expect(await until(() => mailsTo(STAFF).length > 0)).toBe(true);
    const shape = (r: Awaited<ReturnType<typeof ask>>, email: string) => ({
      status: r.statusCode,
      type: r.headers['content-type'],
      cookies: setCookies(r).length,
      location: r.headers['location'] ?? null,
      body: r.body.replaceAll(email, '{email}'),
    });
    for (const email of [`nobody-${RUN}@reset.example`, FRESH, GONE]) {
      expect(shape(await ask(email), email), email).toEqual(shape(known, STAFF));
    }
    await new Promise((r) => setTimeout(r, 300));
    expect(outbox.slice(before).map((m) => m.to)).toEqual([STAFF]);
    const open = (await admin.query(
      `select count(*)::int as n from login_setups s join logins l on l.id = s.login_id where l.email = any($1) and s.used_at is null`,
      [[FRESH, GONE]])).rows[0].n;
    expect(open, 'no link was made for them').toBe(0);
  });

  it('a code typed back proves the address (0129) — and only then is it sent a link', async () => {
    expect((await admin.query('select email_verified_at from logins where email = $1', [FRESH])).rows[0].email_verified_at).toBeNull();
    // a new browser: the password, then the code mailed to the address
    await signIn(FRESH, OLD);
    expect((await admin.query('select email_verified_at from logins where email = $1', [FRESH])).rows[0].email_verified_at).not.toBeNull();
    const token = await linkFor(FRESH);
    expect((await save(token, `fresh-new-${RUN}`)).statusCode).toBe(200);
  });

  it("a staff member's login works the same as the owner's", async () => {
    const token = tokenIn(mailsTo(STAFF).at(-1)!.text);
    const opened = await prod.app.inject({ method: 'GET', url: `/login/set-password?t=${token}`, headers: from() });
    expect(opened.statusCode).toBe(200);
    expect(opened.body).toContain(STAFF);
    expect((await save(token, `staff-new-${RUN}`)).statusCode).toBe(200);
    const session = await signIn(STAFF, `staff-new-${RUN}`);
    expect((await prod.app.inject({ method: 'GET', url: '/app', headers: { cookie: session } })).statusCode).toBe(200);
  });

  it('the same answer time whether or not the address signs in here, measured over many asks — the mail is never waited for', async () => {
    mailDelayMs = 250;
    try {
      const known: number[] = [];
      const unknown: number[] = [];
      const time = async (email: string) => {
        const t0 = process.hrtime.bigint();
        const r = await ask(email);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        expect(r.statusCode).toBe(200);
        return ms;
      };
      for (let i = 0; i < 4; i++) { await time(`warm-${i}-${RUN}@reset.example`); }
      for (let i = 0; i < 40; i++) {
        known.push(await time(TIMED));
        unknown.push(await time(`nobody-${i}-${RUN}@reset.example`));
      }
      const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
      const [k, u] = [median(known), median(unknown)];
      // eslint-disable-next-line no-console
      console.log(`PWR2 timing over 40 each: known median ${k.toFixed(2)} ms, unknown median ${u.toFixed(2)} ms`);
      expect(k, 'a known address does not wait for its mail').toBeLessThan(100);
      expect(Math.abs(k - u), `medians ${k.toFixed(2)} vs ${u.toFixed(2)} ms`).toBeLessThan(10);
    } finally {
      mailDelayMs = 0;
    }
    expect(await until(() => mailsTo(TIMED).length >= 3, 5000)).toBe(true);
  });

  it('the link opens in the language its mail was written in, and switching language keeps it', async () => {
    const before = mailsTo(BROKEN).length;
    expect((await ask(BROKEN, { cookie: 'yf_locale=ar' })).statusCode).toBe(200);
    expect(await until(() => mailsTo(BROKEN).length > before)).toBe(true);
    const mail = mailsTo(BROKEN).at(-1)!;
    expect(mail.subject).toBe(t('ar', 'forgot.mail.subject'));
    expect(mail.text, 'the address isolated in the Arabic sentence').toContain(`⁨${BROKEN}⁩`);
    // the link bare on its own line: nothing around it a mail program could take into the address
    expect(mail.text.split('\n').filter((line) => line.includes('/login/set-password')))
      .toEqual([expect.stringMatching(/^https:\/\/nomi\.test\/login\/set-password\?t=[A-Za-z0-9_-]{43}&l=ar$/)]);
    const token = tokenIn(mail.text);

    const opened = await prod.app.inject({ method: 'GET', url: `/login/set-password?t=${token}&l=ar`, headers: from() });
    expect(opened.body).toContain('<html lang="ar" dir="rtl">');
    expect(cookieValue(opened, 'yf_locale')).toBe('ar');
    const held = cookieValue(opened, 'yf_setlink')!;
    expect(held).toBe(token);
    // the switcher: /locale, then back to the page's own address — without the token in it
    const sw = await prod.app.inject({ method: 'GET', url: '/locale?set=zh&next=/login/set-password', headers: from() });
    expect([sw.statusCode, sw.headers['location']]).toEqual([302, '/login/set-password']);
    const back = await prod.app.inject({ method: 'GET', url: '/login/set-password', headers: { ...from(), cookie: `yf_locale=zh; yf_setlink=${held}` } });
    expect(back.statusCode).toBe(200);
    expect(back.body).toContain('<html lang="zh"');
    expect(back.body).toContain(`<input type="hidden" name="t" value="${token}" />`);
    expect(back.body.split(token).length - 1, 'the token only in the hidden field').toBe(1);
    // without a link and without the cookie: the door
    const none = await prod.app.inject({ method: 'GET', url: '/login/set-password', headers: from() });
    expect([none.statusCode, none.headers['location']]).toEqual([302, '/login']);
  });

  it('a mail that cannot leave is written down for the operator — the reason, never the address — and the door says the same', async () => {
    failFor.add(BROKEN);
    try {
      const since = (await admin.query('select now() as at')).rows[0].at as Date;
      const r = await ask(BROKEN);
      expect(r.statusCode).toBe(200);
      expect(r.body).toContain(t('en', 'forgot.sent', { email: `<bdi>${BROKEN}</bdi>`, minutes: 60 }));
      const row = async () => (await admin.query(
        `select "where", name, message, route from app_errors
          where name = 'DoorMailFailed' and message like '%recovery mail%' and last_seen >= $1
          order by last_seen desc limit 1`, [since])).rows[0];
      expect(await until(async () => Boolean(await row()), 5000), 'written down').toBe(true);
      const e = await row();
      expect(e.where).toBe('web');
      expect(e.route).toBe('POST /login/forgot');
      expect(e.message).toContain('recovery mail could not be sent: mailbox: provider 500 for <address> · smtp: unreachable');
      expect(e.message).not.toContain('@');
    } finally {
      failFor.delete(BROKEN);
    }
  });
});
