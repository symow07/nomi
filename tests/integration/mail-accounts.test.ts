import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { createHash, randomUUID } from 'node:crypto';

/**
 * C6 · M50 — connecting her mailbox, over Postgres and her own routes; then the
 * transport that sends through it.
 *
 * The providers are a recording fake at the wire (token endpoint, Gmail, Graph),
 * handed in where production hands in `fetch`. So what is proven is everything
 * this side of Google and Microsoft: the redirect she is sent on, that the
 * callback connects only for the person who started it, that the refresh token
 * is stored locked, and that the real transport refuses — rather than pretends —
 * every way a mail cannot leave.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd500000-0000-4000-8000-${RUN}0001`;
const CODE = `mail-accounts-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const GOOGLE = { clientId: `google-${RUN}.apps.googleusercontent.com`, clientSecret: 'g-secret' };
const MS = { clientId: '11111111-2222-3333-4444-555555555555', clientSecret: 'm-secret' };
const DOMAIN = `yiwu-${RUN}.test`;

const jwt = (claims: Record<string, unknown>): string =>
  `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

d('C6 · her mailbox (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let esc: typeof import('../../src/api/web/layout.js')['esc'];
  let ownerCookie = '';
  let staffCookie = '';
  let credentialKey: Buffer;
  let lastVerifier = '';
  let lastChallenge = '';
  let refreshAnswer: { status: number; body: unknown } = { status: 200, body: { access_token: 'access-1', expires_in: 3600 } };
  const wireCalls: { url: string; body?: string; headers: Record<string, string> }[] = [];
  let dns = { spf: [] as string[], dkim: ['v=DKIM1; k=rsa; p=MIIB'], dmarc: ['v=DMARC1; p=quarantine'] };

  const fetchImpl: import('../../src/connectors/oauth.js').OAuthFetch = async (url, init) => {
    wireCalls.push({ url, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) });
    const answer = (status: number, body: unknown) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    if (url.endsWith('/token')) {
      const form = new URLSearchParams(init.body ?? '');
      if (form.get('grant_type') === 'refresh_token') return answer(refreshAnswer.status, refreshAnswer.body);
      lastVerifier = form.get('code_verifier') ?? '';
      const google = url.startsWith('https://oauth2.googleapis.com');
      return answer(200, {
        access_token: 'access-0', refresh_token: `refresh-${google ? 'g' : 'm'}-${RUN}`, expires_in: 3600,
        scope: google ? 'openid email https://www.googleapis.com/auth/gmail.send' : 'openid email offline_access Mail.Send',
        id_token: jwt(google
          ? { iss: 'https://accounts.google.com', aud: GOOGLE.clientId, exp: Date.now() / 1000 + 600, email: `lily@${DOMAIN}`, email_verified: true }
          : { iss: 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0', aud: MS.clientId, exp: Date.now() / 1000 + 600, preferred_username: `sales@${DOMAIN}` }),
      });
    }
    return answer(404, '');
  };

  const bid = async () => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return b.value;
  };
  const tx = async <R>(fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(db, await bid(), fn);
  };
  const get = (cookie: string, url: string, extra = '') =>
    app.inject({ method: 'GET', url, headers: { cookie: [cookie, extra].filter(Boolean).join('; ') } });
  const post = (cookie: string, url: string, fields: Record<string, string> = {}) => app.inject({
    method: 'POST', url, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  });
  const flashOf = (res: { headers: Record<string, unknown> }): string =>
    new URL(String(res.headers['location'] ?? ''), 'https://x.test').searchParams.get('flash') ?? '';
  const login = async (code: string) => String((await app.inject({
    method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })).headers['set-cookie'] ?? '').split(';')[0] ?? '';
  /** Press Connect: the redirect she is sent on, and the state cookie it set. */
  const start = async (provider: 'google' | 'microsoft') => {
    const res = await get(ownerCookie, `/app/connect/${provider}/start`);
    const location = new URL(String(res.headers['location']));
    const cookie = String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    lastChallenge = location.searchParams.get('code_challenge') ?? '';
    return { res, location, cookie, state: location.searchParams.get('state') ?? '' };
  };
  const live = () => tx((x) => sql<{ provider: string; address: string; refresh_token_ciphertext: string; fingerprint: string; last_error: string | null }>`
    select provider, address, refresh_token_ciphertext, fingerprint, last_error from mail_accounts
     where business_id = ${BIZ} and archived_at is null`.execute(x).then((r) => r.rows[0] ?? null));

  beforeAll(async () => {
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { deriveKey } = await import('../../src/security/credentials.js');
    const { addPerson } = await import('../../src/api/web/people.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    ({ esc } = await import('../../src/api/web/layout.js'));
    db = createDb(DATABASE_URL!);
    credentialKey = deriveKey('d'.repeat(64));
    await tx((x) => sql`insert into businesses (id, name) values (${BIZ}, 'Mailbox Factory')
                        on conflict (id) do nothing`.execute(x));
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: CODE, sessionSecret: SECRET,
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'meta',
      secureCookie: false, messagingEnabled: true,
      kickOutbound: async () => {}, kickDrive: async () => {},
      publicBaseUrl: 'https://nomi.test', credentialKey,
      oauthClients: { google: GOOGLE, microsoft: MS }, oauthFetch: fetchImpl,
      resolveDns: async () => dns,
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    ownerCookie = await login(CODE);
    const person = await addPerson(db, BIZ, SECRET, 'Mei');
    staffCookie = await login((person as { accessCode: string }).accessCode);
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('her accounts page offers Gmail and Outlook to connect — to her, not to staff', async () => {
    const owner = await get(ownerCookie, '/app/channels');
    expect(owner.body).toContain(esc(t('en', 'connect.title')));
    expect(owner.body).toContain('href="/app/connect/google/start"');
    expect(owner.body).toContain('href="/app/connect/microsoft/start"');
    const staff = await get(staffCookie, '/app/channels');
    expect(staff.body).not.toContain('/start"');
    const tried = await get(staffCookie, '/app/connect/google/start');
    expect(decodeURIComponent(String(tried.headers['location']))).toContain('Only the owner');
  });

  it('PRESSING CONNECT sends her to Google with PKCE, and leaves a short, scoped, HttpOnly state cookie', async () => {
    const s = await start('google');
    expect(s.location.origin).toBe('https://accounts.google.com');
    expect(s.location.searchParams.get('redirect_uri')).toBe('https://nomi.test/app/connect/google/callback');
    expect(s.location.searchParams.get('code_challenge_method')).toBe('S256');
    const setCookie = String(s.res.headers['set-cookie']);
    expect(setCookie).toMatch(/^yf_oauth=/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/app/connect');
    expect(setCookie).toContain('Max-Age=600');
  });

  it('A CALLBACK THAT IS NOT HERS connects nothing: no cookie, a wrong state, or another provider', async () => {
    const s = await start('google');
    const cb = (q: string, cookie: string) => get(ownerCookie, `/app/connect/google/callback?${q}`, cookie);
    expect(flashOf(await cb(`code=c&state=${s.state}`, ''))).toBe(t('en', 'connect.flash.expired'));
    expect(flashOf(await cb(`code=c&state=not-the-nonce`, s.cookie))).toBe(t('en', 'connect.flash.expired'));
    const m = await start('microsoft');
    expect(flashOf(await get(ownerCookie, `/app/connect/google/callback?code=c&state=${m.state}`, m.cookie)))
      .toBe(t('en', 'connect.flash.expired'));
    expect(await live()).toBeNull();
    expect(wireCalls.filter((c) => c.url.endsWith('/token'))).toEqual([]);
  });

  it('she says no at Google: nothing is connected and nothing is exchanged', async () => {
    const s = await start('google');
    const res = await get(ownerCookie, `/app/connect/google/callback?error=access_denied&state=${s.state}`, s.cookie);
    expect(flashOf(res)).toBe(t('en', 'connect.flash.denied'));
    expect(await live()).toBeNull();
  });

  it('SHE CONNECTS GMAIL: the verifier matches the challenge, and the refresh token is stored LOCKED', async () => {
    const { credentialFingerprint } = await import('../../src/security/credentials.js');
    const s = await start('google');
    const res = await get(ownerCookie, `/app/connect/google/callback?code=auth-code&state=${s.state}`, s.cookie);
    expect(flashOf(res)).toBe(t('en', 'connect.flash.connected', { address: `lily@${DOMAIN}` }));
    expect(createHash('sha256').update(lastVerifier).digest('base64url')).toBe(lastChallenge);
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');   // used once

    const row = (await live())!;
    expect(row).toMatchObject({ provider: 'google', address: `lily@${DOMAIN}`, last_error: null });
    expect(row.refresh_token_ciphertext.startsWith('v1.')).toBe(true);
    expect(row.refresh_token_ciphertext).not.toContain(`refresh-g-${RUN}`);
    expect(row.fingerprint).toBe(credentialFingerprint(`refresh-g-${RUN}`));
    const page = await get(ownerCookie, '/app/channels');
    expect(page.body).toContain(`<bdi>lily@${DOMAIN}</bdi>`);
    expect(page.body).not.toContain(`refresh-g-${RUN}`);
  });

  it('HER DOMAIN CHECK now requires the provider she connected — Google\'s SPF, not a setting nobody filled in', async () => {
    await post(ownerCookie, '/app/channels/domain', { domain: DOMAIN, selector: 'k1' });
    dns = { ...dns, spf: ['v=spf1 include:spf.protection.outlook.com -all'] };
    await post(ownerCookie, '/app/channels/domain/check');
    const wrong = await tx((x) => sql<{ spf_state: string }>`select spf_state from sending_domains where business_id = ${BIZ}`.execute(x).then((r) => r.rows[0]!));
    expect(wrong.spf_state, 'an SPF record without Google passed for a Gmail mailbox').toBe('unauthorized');
    dns = { ...dns, spf: ['v=spf1 include:_spf.google.com ~all'] };
    await post(ownerCookie, '/app/channels/domain/check');
    const right = await tx((x) => sql<{ spf_state: string }>`select spf_state from sending_domains where business_id = ${BIZ}`.execute(x).then((r) => r.rows[0]!));
    expect(right.spf_state).toBe('ok');
  });

  it('THE REAL TRANSPORT SENDS AS HER: one refresh, the token cached, the address hers', async () => {
    const { accountMailTransport } = await import('../../src/channels/email/accountTransport.js');
    const sent: { token: string; from: string; to: string }[] = [];
    const transport = accountMailTransport({
      db, businessId: await bid(), credentialKey, clients: { google: GOOGLE, microsoft: MS }, fetchImpl,
      senders: {
        google: async (token, m) => { sent.push({ token, from: m.from, to: m.to }); return { ok: true, providerMessageId: `id-${sent.length}@${DOMAIN}` }; },
        microsoft: async () => ({ ok: false, retryable: false, error: 'unused' }),
      },
    });
    const refreshesBefore = wireCalls.filter((c) => c.body?.includes('grant_type=refresh_token')).length;
    const mail = { to: 'buyer@gulf.test', subject: 'Hello', text: 'Hi', headers: {}, tag: null };
    expect(await transport.send(mail)).toEqual({ ok: true, providerMessageId: `id-1@${DOMAIN}` });
    expect(await transport.send(mail)).toEqual({ ok: true, providerMessageId: `id-2@${DOMAIN}` });
    expect(sent.map((s) => [s.token, s.from])).toEqual([['access-1', `lily@${DOMAIN}`], ['access-1', `lily@${DOMAIN}`]]);
    const refreshes = wireCalls.filter((c) => c.body?.includes('grant_type=refresh_token'));
    expect(refreshes.length - refreshesBefore, 'the access token was not cached').toBe(1);
    // …and the refresh used the token she granted, decrypted.
    expect(new URLSearchParams(refreshes.at(-1)!.body!).get('refresh_token')).toBe(`refresh-g-${RUN}`);
  });

  it('AN EXPIRED APP SECRET is the installation\'s to fix: the mail is refused saying so, and her mailbox is NOT marked for reconnecting', async () => {
    const { accountMailTransport } = await import('../../src/channels/email/accountTransport.js');
    refreshAnswer = { status: 401, body: { error: 'invalid_client' } };
    const transport = accountMailTransport({
      db, businessId: await bid(), credentialKey, clients: { google: GOOGLE }, fetchImpl,
      senders: { google: async () => ({ ok: true, providerMessageId: 'x' }), microsoft: async () => ({ ok: true, providerMessageId: 'x' }) },
    });
    const r = await transport.send({ to: 'buyer@gulf.test', subject: 'Hello', text: 'Hi', headers: {}, tag: null });
    expect(r).toMatchObject({ ok: false, retryable: false, error: expect.stringContaining('client secret') });
    expect((await live())!.last_error).toBeNull();
    refreshAnswer = { status: 200, body: { access_token: 'access-1', expires_in: 3600 } };
  });

  it('A DEAD TOKEN is recorded once and asks her to reconnect — every later mail says why instead of vanishing', async () => {
    const { accountMailTransport } = await import('../../src/channels/email/accountTransport.js');
    refreshAnswer = { status: 400, body: { error: 'invalid_grant' } };
    const transport = accountMailTransport({
      db, businessId: await bid(), credentialKey, clients: { google: GOOGLE }, fetchImpl,
      senders: { google: async () => ({ ok: true, providerMessageId: 'x' }), microsoft: async () => ({ ok: true, providerMessageId: 'x' }) },
    });
    const r = await transport.send({ to: 'buyer@gulf.test', subject: 'Hello', text: 'Hi', headers: {}, tag: null });
    expect(r).toEqual({ ok: false, retryable: false, error: 'the mail account must be connected again' });
    expect((await live())!.last_error).toBe('revoked');
    const page = await get(ownerCookie, '/app/channels');
    expect(page.body).toContain(esc(t('en', 'connect.state.attention')));
    refreshAnswer = { status: 200, body: { access_token: 'access-1', expires_in: 3600 } };
  });

  it('CONNECTING OUTLOOK replaces Gmail: one sending mailbox, the old one archived, and the fresh one healthy', async () => {
    const s = await start('microsoft');
    const res = await get(ownerCookie, `/app/connect/microsoft/callback?code=ms-code&state=${s.state}`, s.cookie);
    expect(flashOf(res)).toBe(t('en', 'connect.flash.connected', { address: `sales@${DOMAIN}` }));
    const rows = await tx((x) => sql<{ live: number; archived: number }>`
      select count(*) filter (where archived_at is null)::int as live,
             count(*) filter (where archived_at is not null)::int as archived
        from mail_accounts where business_id = ${BIZ}`.execute(x).then((r) => r.rows[0]!));
    expect(rows).toEqual({ live: 1, archived: 1 });
    expect(await live()).toMatchObject({ provider: 'microsoft', last_error: null });
  });

  it('every way a mail cannot leave is a refusal: off her domain, no app for it, nothing connected', async () => {
    const { accountMailTransport } = await import('../../src/channels/email/accountTransport.js');
    const senders = { google: async () => ({ ok: true as const, providerMessageId: 'x' }), microsoft: async () => ({ ok: true as const, providerMessageId: 'x' }) };
    const mail = { to: 'b@x.test', subject: 's', text: 't', headers: {}, tag: null };
    const noApp = accountMailTransport({ db, businessId: await bid(), credentialKey, clients: { google: GOOGLE }, fetchImpl, senders });
    expect(await noApp.send(mail)).toMatchObject({ ok: false, retryable: false, error: expect.stringContaining('microsoft') });

    await tx((x) => sql`update sending_domains set domain = 'another-domain.test' where business_id = ${BIZ}`.execute(x));
    const offDomain = accountMailTransport({ db, businessId: await bid(), credentialKey, clients: { microsoft: MS }, fetchImpl, senders });
    expect(await offDomain.send(mail)).toMatchObject({ ok: false, retryable: false, error: expect.stringContaining('verified sending domain') });

    expect(flashOf(await post(ownerCookie, '/app/connect/mail/disconnect'))).toBe(t('en', 'connect.flash.disconnected'));
    expect(await offDomain.send(mail)).toEqual({ ok: false, retryable: false, error: 'no mail account is connected' });
    expect(decodeURIComponent(String((await post(staffCookie, '/app/connect/mail/disconnect')).headers['location'])))
      .toContain('Only the owner');
  });
});
