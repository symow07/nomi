import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import Fastify from 'fastify';
import { flashSaid, flashWasRefusal } from './tenant.js';
// @ts-expect-error — the operator tool, plain JS on purpose (tools/ is not type-checked).
import * as op from '../../tools/lib/operator.mjs';

/**
 * KS6 (0115) — THE OPERATOR APPROVES EACH WORKSPACE'S FIRST CONNECTION, over
 * Postgres and the web app:
 *
 *   · while the installation's switch is on, a workspace that signed itself up
 *     connects neither WhatsApp nor a Page until approved — both routes, every
 *     step of the Page's; the installation's own workspace, and a workspace
 *     that connected before, are never asked;
 *   · the owner asks once, naming where the business can be seen; the operator
 *     hears at once, and the daily list counts the asks waiting;
 *   · the operator decides with the tool; the owner hears once, by e-mail,
 *     with the door to Channels; then the routes let the connection through;
 *   · a refusal says so on the page, with the legal contact;
 *   · the app role reads its own row and nothing else, and writes none.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `ad600000-0000-4000-8000-${RUN}0001`;
const CODE = `ks6-${RUN}`;
const SECRET = 'a-test-session-secret-of-sufficient-length';
const OPERATOR = `operator-${RUN}@nomi.example`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

d('KS6 · approval before the first connection (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let app: import('fastify').FastifyInstance;
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  const outbox: { to: string; subject: string; text: string }[] = [];
  const shops: Record<string, { id: string; cookie: string; email: string }> = {};
  const cookieOf = (r: { headers: Record<string, unknown> }) => ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? [])
    .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=') && c !== 'yf_session=') ?? '';
  const post = (cookie: string, url: string, fields: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, headers: { ...FORM, cookie }, payload: new URLSearchParams(fields).toString() });
  const get = (cookie: string, url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  let pilotCookie = '';
  /** With a sender, a browser not seen before is asked for the code mailed to it (A3). */
  const signIn = async (email: string, password: string): Promise<string> => {
    const r = await app.inject({ method: 'POST', url: '/login', headers: FORM, payload: new URLSearchParams({ email, password }).toString() });
    if (cookieOf(r)) return cookieOf(r);
    const otp = ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_otp=')) ?? '';
    const code = [...outbox].reverse().find((m) => m.to === email)?.subject.match(/\d{6}/)?.[0] ?? '';
    return cookieOf(await app.inject({ method: 'POST', url: '/verify', headers: { ...FORM, cookie: otp }, payload: `code=${code}` }));
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    const { registerWebApp } = await import('../../src/api/web/app.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    const { hashPassword } = await import('../../src/security/password.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    db = createDb(DATABASE_URL!);
    // The installation's own workspace, whose owner the operator's mail reaches.
    await admin.query(`insert into businesses (id, name, owner_locale) values ($1, $2, 'en')`, [PILOT, `KS6 installation ${RUN}`]);
    const person = (await admin.query(`insert into people (business_id, name, is_owner) values ($1, 'Operator', true) returning id`, [PILOT])).rows[0].id;
    await admin.query(`insert into logins (business_id, person_id, email, password_hash) values ($1, $2, $3, 'scrypt$never-used')`, [PILOT, person, OPERATOR]);
    app = Fastify({ logger: false });
    registerWebApp(app, {
      db, businessId: PILOT, accessCode: CODE, sessionSecret: SECRET, legalContact: 'legal@nomi.example',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: false, messagingEnabled: false,
      kickOutbound: async () => {}, kickDrive: async () => {},
      systemMail: { from: 'no-reply@nomi.test', send: async (m: { to: string; subject: string; text: string }) => { outbox.push(m); return { ok: true as const }; } },
    } as unknown as Parameters<typeof registerWebApp>[1]);
    await app.ready();
    pilotCookie = cookieOf(await app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(CODE)}`, headers: FORM }));
    // Three workspaces that signed themselves up: one that asks, one refused, one that connected a Page before.
    for (const name of ['asks', 'refused', 'before']) {
      const email = `ks6-${name}-${RUN}@shop.example`;
      const made = await provisionAccount(db, {
        factory: `KS6 ${name} ${RUN}`, language: 'en', ownerName: 'Samira', email, passwordHash: await hashPassword(`ks6-password-${RUN}`),
        invite: null, inviteRequired: false, termsVersion: 'abcdef012345',
        profile: { kind: 'retail', sells: 'olive oil soap', country: 'AE', website: 'https://soap.example', teamSize: '1', channels: [] },
      });
      if (made.code !== 'created') throw new Error(`provision: ${made.code}`);
      const cookie = await signIn(email, `ks6-password-${RUN}`);
      expect(cookie, name).not.toBe('');
      shops[name] = { id: made.businessId, cookie, email };
    }
    await admin.query(`insert into meta_accounts (business_id, page_id, page_name, token_ciphertext, fingerprint, scopes, connected_by, archived_at, archived_by)
                       values ($1, '7000000001', 'Old Page', 'v1.not-a-real-token', '0123456789ab', 'pages_messaging', 'test', now(), 'test')`, [shops['before']!.id]);
    expect(await op.setOperatorFlag(admin, { flag: 'approve_connections', businessId: null, reason: `ks6 test ${RUN}`, by: 'test' })).toBe(1);
  }, 90_000);
  afterAll(async () => {
    await op.clearOperatorFlag(admin, { flag: 'approve_connections', businessId: null }).catch(() => undefined);
    await app?.close(); await db?.destroy(); await admin?.end();
  });

  it('THE SWITCH is the installation\'s alone', async () => {
    await expect(op.setOperatorFlag(admin, { flag: 'approve_connections', businessId: shops['asks']!.id, reason: 'x', by: 'test' })).rejects.toThrow(/whole installation/);
    await expect(admin.query(`insert into ops_flags (business_id, flag, reason, set_by) values ($1, 'approve_connections', 'x', 'x')`, [shops['asks']!.id]))
      .rejects.toThrow(/ops_flags_approve_everyone/);
  });

  it('NOT APPROVED: both connect routes refuse, every step of the Page\'s — and nothing is written', async () => {
    const { cookie, id } = shops['asks']!;
    for (const r of [await post(cookie, '/app/channels/whatsapp/connect'), await post(cookie, '/app/channels/messenger/connect'),
      await post(cookie, '/app/channels/instagram/connect'), await get(cookie, '/app/connect/meta/start'),
      await get(cookie, '/app/connect/meta/callback?code=x&state=y'), await post(cookie, '/app/connect/meta/choose', { state: 'x', page: '1' })]) {
      expect(r.headers['location']).toBe('/app/channels');
      expect(flashSaid(r, SECRET)).toBe(t('en', 'connect.flash.approval'));
      expect(flashWasRefusal(r, SECRET)).toBe(true);
    }
    expect((await admin.query(`select 1 from channels where business_id = $1`, [id])).rowCount).toBe(0);
  });

  it('NEVER ASKED: the installation\'s own workspace, and one that connected a channel before', async () => {
    for (const cookie of [pilotCookie, shops['before']!.cookie]) {
      const r = await get(cookie, '/app/connect/meta/start');
      expect(flashSaid(r, SECRET)).not.toBe(t('en', 'connect.flash.approval'));
      expect((await get(cookie, '/app/channels')).body).not.toContain('id="approval"');
    }
  });

  it('THE OWNER ASKS once, naming where the business can be seen; the operator hears at once and the daily list counts it', async () => {
    const { cookie, id } = shops['asks']!;
    const page = await get(cookie, '/app/channels');
    expect(page.body).toContain('id="approval"');
    expect(page.body).toContain('action="/app/channels/approval"');
    expect(page.body.indexOf('id="approval"')).toBeLessThan(page.body.indexOf('📱 WhatsApp'));
    const bad = await post(cookie, '/app/channels/approval', { page: 'not an address' });
    expect(flashSaid(bad, SECRET)).toBe(t('en', 'approval.flash.bad_page'));
    expect((await admin.query(`select 1 from connection_approvals where business_id = $1`, [id])).rowCount).toBe(0);
    const before = outbox.length;
    const asked = await post(cookie, '/app/channels/approval', { page: 'Facebook.com/SoapHouse' });
    expect(flashSaid(asked, SECRET)).toBe(t('en', 'approval.flash.asked'));
    expect((await admin.query(`select page, asked_by, decision from connection_approvals where business_id = $1`, [id])).rows[0])
      .toEqual({ page: 'https://facebook.com/SoapHouse', asked_by: 'Samira', decision: null });
    for (let i = 0; i < 50 && outbox.length === before; i++) await new Promise((r) => setTimeout(r, 50));
    const told = outbox.at(-1)!;
    expect(told.to).toBe(OPERATOR);
    expect(told.subject).toBe(t('en', 'notify.connection_asked.subject', { business: `KS6 asks ${RUN}` }));
    expect(told.text).toContain('https://facebook.com/SoapHouse');
    expect(told.text).toContain('olive oil soap');
    expect(told.text).toContain(`node tools/connections.mjs approve ${id}`);
    // Asked again: nothing changes, and the operator is not told twice.
    const again = await post(cookie, '/app/channels/approval', { page: '@another' });
    expect(flashSaid(again, SECRET)).toBe(t('en', 'approval.flash.already'));
    expect((await admin.query(`select page from connection_approvals where business_id = $1`, [id])).rows[0].page).toBe('https://facebook.com/SoapHouse');
    expect((await get(cookie, '/app/channels')).body).toContain(t('en', 'approval.where'));
    const { signupDigestAlert } = await import('../../src/pipeline/signupDigest.js');
    expect((await signupDigestAlert(db, PILOT, new Date()))?.approvals).toBeGreaterThanOrEqual(1);
  });

  it('THE OPERATOR DECIDES; the owner hears once, with the door to Channels — and the routes let the connection through', async () => {
    const { cookie, id, email } = shops['asks']!;
    expect(await op.decideConnection(admin, { businessId: id, decision: 'approved', by: '' })).toBe('invalid');
    expect(await op.decideConnection(admin, { businessId: id, decision: 'approved', by: 'operator' })).toBe('approved');
    expect(await op.decideConnection(admin, { businessId: id, decision: 'approved', by: 'operator' })).toBe('unchanged');
    const { connectionDecisionAlerts } = await import('../../src/pipeline/approvalWatch.js');
    const jobs = (await connectionDecisionAlerts(db)).filter((j) => j.businessId === id);
    expect(jobs).toEqual([{ businessId: id, kind: 'connection_approved', conversationId: null }]);
    expect((await connectionDecisionAlerts(db)).filter((j) => j.businessId === id)).toEqual([]);
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    const mail = { from: 'no-reply@nomi.test', send: async (m: { to: string; subject: string; text: string }) => { outbox.push(m); return { ok: true as const }; } };
    const adapter = { sendText: async () => ({ ok: false as const, retryable: false, error: 'none' }) };
    expect(await deliverOwnerAlert({ db, adapter, mail, publicBaseUrl: 'https://nomi.test' }, jobs[0]!)).toBe('sent');
    const heard = outbox.at(-1)!;
    expect([heard.to, heard.subject]).toEqual([email, t('en', 'notify.connection_approved.subject')]);
    expect(heard.text).toContain('https://nomi.test/app/channels');
    // Now the routes let it through: Meta is not configured here, so that is what the page says.
    const start = await get(cookie, '/app/connect/meta/start');
    expect(flashSaid(start, SECRET)).toBe(t('en', 'connect.flash.not_configured'));
    expect((await get(cookie, '/app/channels')).body).not.toContain('id="approval"');
  });

  it('A REFUSAL is said on the page, with the legal contact; refusing needs an ask', async () => {
    const { cookie, id } = shops['refused']!;
    expect(await op.decideConnection(admin, { businessId: id, decision: 'refused', by: 'operator' })).toBe('no_ask');
    expect(flashSaid(await post(cookie, '/app/channels/approval', { page: '@soap.house' }), SECRET)).toBe(t('en', 'approval.flash.asked'));
    expect(await op.decideConnection(admin, { businessId: id, decision: 'refused', by: 'operator', note: 'sells look like counterfeits' })).toBe('refused');
    const page = (await get(cookie, '/app/channels')).body;
    expect(page).toContain(t('en', 'approval.refused'));
    expect(page).toContain('legal@nomi.example');
    expect(page).not.toContain('counterfeits');
    expect(page).not.toContain('action="/app/channels/approval"');
    expect(flashSaid(await get(cookie, '/app/connect/meta/start'), SECRET)).toBe(t('en', 'connect.flash.approval'));
    const { connectionDecisionAlerts } = await import('../../src/pipeline/approvalWatch.js');
    expect((await connectionDecisionAlerts(db)).filter((j) => j.businessId === id).map((j) => j.kind)).toEqual(['connection_refused']);
    const log = (await op.listConnectionAsks(admin, { all: true })).find((r: { id: string }) => r.id === id);
    expect(log).toMatchObject({ page: 'https://www.instagram.com/soap.house', decision: 'refused', decidedBy: 'operator', note: 'sells look like counterfeits' });
  });

  it('THE SWITCH OFF: nobody waits', async () => {
    expect(await op.clearOperatorFlag(admin, { flag: 'approve_connections', businessId: null })).toBe(1);
    expect(flashSaid(await get(shops['refused']!.cookie, '/app/connect/meta/start'), SECRET)).toBe(t('en', 'connect.flash.not_configured'));
    expect((await get(shops['refused']!.cookie, '/app/channels')).body).not.toContain('id="approval"');
    expect(await op.setOperatorFlag(admin, { flag: 'approve_connections', businessId: null, reason: `ks6 test ${RUN}`, by: 'test' })).toBe(1);
  });

  it('THE APP ROLE reads its own row only, and writes none', async () => {
    const { sql } = await import('kysely');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(shops['before']!.id); if (!b.ok) throw new Error('fixture');
    const seen = await withTenantTx(db, b.value, (tx) => sql<{ n: number }>`select count(*)::int as n from connection_approvals`.execute(tx));
    expect(seen.rows[0]!.n).toBe(0);
    for (const stmt of [sql`update connection_approvals set decision = 'approved', decided_at = now(), decided_by = 'me'`,
      sql`insert into connection_approvals (business_id, page, asked_by, decision, decided_at, decided_by) values (${shops['before']!.id}::uuid, 'x.example', 'me', 'approved', now(), 'me')`]) {
      await expect(withTenantTx(db, b.value, (tx) => stmt.execute(tx))).rejects.toThrow(/permission denied/);
    }
  });
});
