import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { seedRunTenant } from './tenant.js';

/**
 * M40.1 — the sending domain, end to end.
 *
 * The parity suite proves the record rules and the refusals. Only Postgres can
 * prove that naming a new domain CLEARS the old one's passing check, that the
 * result and the time it was taken are stored together, and that the page
 * refuses a stale pass rather than reading three green columns.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd400000-0000-4000-8000-${RUN}0001`;
const SPF = 'v=spf1 include:mail.example.net ~all';
const DKIM = 'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQ==';
const DMARC = 'v=DMARC1; p=quarantine';

d('M40.1 · the sending domain (requires DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let cookie = '';
  /** What DNS "returns". Reassigned per test — no network in a test suite. */
  let answers: { spf: string[]; dkim: string[]; dmarc: string[] } = { spf: [], dkim: [], dmarc: [] };
  let asked: string[] = [];

  const post = (url: string, payload = '') =>
    app.inject({
      method: 'POST', url, payload,
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    });

  const tx = async <T>(fn: (t: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(db, bid.value, fn);
  };

  const row = () => tx((t) => sql<{
    domain: string; dkim_selector: string; spf_state: string | null;
    dkim_state: string | null; dmarc_state: string | null; checked_at: Date | null;
  }>`select domain, dkim_selector, spf_state, dkim_state, dmarc_state, checked_at
       from sending_domains where business_id = ${BIZ}`.execute(t).then((r) => r.rows[0]));

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    db = createDb(DATABASE_URL!);
    await tx(async (t) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Domain Factory')
                on conflict (id) do nothing`.execute(t);
    });

    process.env['PILOT_BUSINESS_ID'] = BIZ;
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: BIZ, accessCode: 'domain-code',
      sessionSecret: 'a-test-session-secret-of-sufficient-length',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled',
      secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
      sendingInclude: 'mail.example.net',
      resolveDns: async (domain: string, selector: string) => {
        asked.push(`${selector}._domainkey.${domain}`);
        return answers;
      },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    const login = await app.inject({
      method: 'POST', url: '/login', payload: 'code=domain-code',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);

  afterAll(async () => { await app?.close(); await db?.destroy(); });

  it('THE PRODUCTION CALLER: she names her domain, and nothing is verified yet', async () => {
    const res = await post('/app/channels/domain', 'domain=YiwuHF.com&selector=K1');
    expect(res.statusCode).toBe(302);
    const r = await row();
    // Stored canonical, so the host we look up and the host she creates match.
    expect(r!.domain).toBe('yiwuhf.com');
    expect(r!.dkim_selector).toBe('k1');
    expect(r!.checked_at).toBeNull();
    expect(r!.spf_state).toBeNull();
  });

  it('and the page refuses to call it ready', async () => {
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const res = await app.inject({ method: 'GET', url: '/app/channels', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('k1._domainkey.yiwuhf.com');
    expect(res.body).toContain(t('en', 'domain.neverChecked'));
    expect(res.body).not.toContain(t('en', 'domain.ready'));
  });

  it('a look that finds nothing is stored as missing, WITH the time it was taken', async () => {
    asked = [];
    const res = await post('/app/channels/domain/check');
    expect(res.statusCode).toBe(302);
    // It looked at the host derived from HER selector, not a default.
    expect(asked).toContain('k1._domainkey.yiwuhf.com');
    const r = await row();
    expect([r!.spf_state, r!.dkim_state, r!.dmarc_state]).toEqual(['missing', 'missing', 'missing']);
    expect(r!.checked_at).not.toBeNull();
  });

  it('she adds the three, and e-mail becomes able to carry a first message', async () => {
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    answers = { spf: [SPF], dkim: [DKIM], dmarc: [DMARC] };
    await post('/app/channels/domain/check');
    const r = await row();
    expect([r!.spf_state, r!.dkim_state, r!.dmarc_state]).toEqual(['ok', 'ok', 'ok']);

    const page = await app.inject({ method: 'GET', url: '/app/channels', headers: { cookie } });
    expect(page.body).toContain(t('en', 'domain.ready'));
    // The registry requirement it satisfies is now shown as done.
    expect(page.body).toContain(t('en', 'reach.req.verified_sending_domain'));
  });

  it('AN SPF THAT DOES NOT LIST US IS NOT A PASS — and says which', async () => {
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    answers = { spf: ['v=spf1 include:someone-else.net ~all'], dkim: [DKIM], dmarc: [DMARC] };
    await post('/app/channels/domain/check');
    expect((await row())!.spf_state).toBe('unauthorized');
    const page = await app.inject({ method: 'GET', url: '/app/channels', headers: { cookie } });
    expect(page.body).toContain(t('en', 'domain.state.unauthorized'));
    expect(page.body).not.toContain(t('en', 'domain.ready'));
  });

  it('A NEW DOMAIN CLEARS THE OLD ONE’S PASS — inheriting it would send unverified', async () => {
    answers = { spf: [SPF], dkim: [DKIM], dmarc: [DMARC] };
    await post('/app/channels/domain/check');
    expect((await row())!.spf_state).toBe('ok');

    await post('/app/channels/domain', 'domain=other-factory.com&selector=k1');
    const r = await row();
    expect(r!.domain).toBe('other-factory.com');
    expect([r!.spf_state, r!.dkim_state, r!.dmarc_state, r!.checked_at])
      .toEqual([null, null, null, null]);
  });

  it('changing only the selector clears it too — a different selector is a different record', async () => {
    await post('/app/channels/domain/check');
    expect((await row())!.checked_at).not.toBeNull();
    await post('/app/channels/domain', 'domain=other-factory.com&selector=k2');
    expect((await row())!.checked_at).toBeNull();
  });

  it('A STALE PASS IS NOT A PASS — the page reads the predicate, not the columns', async () => {
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { DOMAIN_CHECK_TTL_MS } = await import('../../src/core/outreach/domain.js');
    await post('/app/channels/domain/check');
    const long = new Date(Date.now() - DOMAIN_CHECK_TTL_MS - 60_000);
    await tx((t) => sql`update sending_domains set checked_at = ${long}
                         where business_id = ${BIZ}`.execute(t));
    const page = await app.inject({ method: 'GET', url: '/app/channels', headers: { cookie } });
    expect(page.body).not.toContain(t('en', 'domain.ready'));
    expect(page.body).toContain('Last looked at');
  });

  it('one sending domain per business, and the app role cannot delete it', async () => {
    await expect(tx((t) => sql`
      insert into sending_domains (business_id, domain) values (${BIZ}, 'third.com')
    `.execute(t))).rejects.toThrow(/duplicate key|unique/i);
    await expect(tx((t) => sql`
      delete from sending_domains where business_id = ${BIZ}
    `.execute(t))).rejects.toThrow(/permission denied/i);
  });

  it('what is not a domain is refused, and nothing is stored', async () => {
    const before = await row();
    const res = await post('/app/channels/domain', 'domain=not a domain&selector=k1');
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain(encodeURIComponent('does not look like'));
    expect((await row())!.domain).toBe(before!.domain);
  });
});
