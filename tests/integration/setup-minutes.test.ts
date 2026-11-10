import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runDigits } from './tenant.js';
import { pasteAndAdd } from './importReview.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import { signUpWithCode, type Outbox, PASSING_BOT_CHECK } from './signUpWithCode.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import type { Analysis } from '../../src/core/conversation/decide.js';

/**
 * BLOCK 4.4 — SETUP IN MINUTES, end to end on a fresh workspace, through production's composition and the fake
 * WhatsApp channel, then `tools/acceptance-check.mjs --setup` read from the rows the product wrote:
 *
 *   sign-up (the real door and its e-mailed code) → all four Pending, exit 1
 *   → a pasted price list confirmed (products in) → a customer added from a pasted table (customers in)
 *   → the workspace's own WhatsApp number (a channel connected) → a customer writes, the assistant drafts, the owner
 *     sends it as written and the channel accepts it (the first reply)
 *   → each ✓ with its time and minutes from sign-up, exit 0; Get started shows the clock done.
 *
 * The tool reads dist/ (as the G8 acceptance check does): build before running this file.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const RUN = randomUUID().slice(0, 8);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PILOT = `dd232000-0000-4000-8000-${RUN}0009`;
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const SHOP = `Setup Minutes ${RUN}`;
const BUYER = `9715${runDigits(RUN, 8)}`;
const REPLY = 'Thank you for writing to us. Which scent would you like?';

const reads: Analysis = {
  language: { detected: 'en', replyIn: 'en' },
  intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
  recommendedPhase: 'clarification', wantsPerson: false, wantsDeletion: false, procedureStarted: null,
};

d('4.4 · the --setup check on a workspace that walks all four (requires DATABASE_URL + MIGRATE_DATABASE_URL)', { timeout: 180_000 }, () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  let admin: pg.Client;
  const outbox: Outbox = [];
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();
  let cookie = '';
  let BIZ = '';

  const visitor = `198.51.100.${(RUN.charCodeAt(2) % 200) + 20}`;
  const form = (url: string, fields: Record<string, string>, c = cookie) => prod.app.inject({
    method: 'POST', url,
    headers: { ...FORM, 'x-forwarded-for': visitor, ...(c ? { cookie: c } : {}) },
    payload: new URLSearchParams(fields).toString(),
  });
  const one = async <T>(q: string, args: unknown[]): Promise<T | undefined> => (await admin.query(q, args)).rows[0] as T | undefined;
  const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 90_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await probe();
      if (v !== undefined) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const check = () => spawnSync(process.execPath, ['tools/acceptance-check.mjs', '--setup', '--business', BIZ], {
    cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, MIGRATE_DATABASE_URL: MIGRATE_URL ?? '' },
  });

  beforeAll(async () => {
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    sim = whatsappSimulator([], { tag: `stm${RUN}` });
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name) values ($1, $2) on conflict (id) do nothing`, [PILOT, `Pilot ${RUN}`]);
    analyzer.next = reads;
    replyWriter.replies = [REPLY];
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    process.env['OWNER_ACCESS_CODE'] = `setup-minutes-${RUN}`;
    process.env['SIGNUP_MODE'] = 'open';
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      // The installation's number is the one the workspace's credential holds: since 2026-10-14 that number sends only
      // for its own workspace (src/main.ts `installationNumber`), as in tests/integration/order-proposal.test.ts.
      META_WHATSAPP_PHONE_NUMBER_ID: sim.phoneNumberId,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'stm-verify-token-xx', CREDENTIAL_KEY: 'd'.repeat(64), PORT: 0,
      PUBLIC_BASE_URL: 'https://nomi.test',
    }, {
      adapter: sim.adapter, logger: false, models: { analyzer, replyWriter },
      botCheck: PASSING_BOT_CHECK, signupGuard: null,
      systemMail: { from: 'no-reply@nomi.test', send: async (m) => { outbox.push(m); return { ok: true }; } },
    });
  }, 90_000);

  afterAll(async () => {
    delete process.env['SIGNUP_MODE'];
    // Nothing this file queued may leave through the next file's workers.
    if (prod && BIZ) {
      await sql`update outbound_messages set status = 'canceled', last_error = 'canceled: test ended'
        where business_id = ${BIZ}::uuid and status = 'queued'`.execute(prod.db).catch(() => undefined);
      await sql`delete from pgboss.job where name = 'message.outbound' and data->>'businessId' = ${BIZ}
        and state in ('created', 'retry')`.execute(prod.db).catch(() => undefined);
    }
    await admin?.end();
    await prod?.close();
  });

  it('SIGNED UP: the clock starts and all four are Pending (exit 1)', async () => {
    const made = await signUpWithCode((url, fields, c) => form(url, fields, c ?? ''), outbox, {
      factory: SHOP, name: 'Rania', email: `rania-${RUN}@scents.example`, password: `scents-password-${RUN}`,
      country: 'AE', invite: '', kind: 'retail', sells: 'Perfume oils', website: '', teamSize: '1', terms: 'on', age: '34',
    });
    expect(made.statusCode, made.body.slice(0, 300)).toBe(302);
    cookie = ([] as string[]).concat(made.headers['set-cookie'] as string | string[] ?? [])
      .map((c) => c.split(';')[0]!).find((c) => c.startsWith('yf_session=') && c !== 'yf_session=') ?? '';
    expect(cookie).not.toBe('');
    BIZ = (await one<{ id: string }>(`select id::text as id from businesses where name = $1 and signed_up_at is not null`, [SHOP]))!.id;
    await admin.query(`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 1000 where id = $1`, [BIZ]);

    const r = check();
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toContain(`Setup in minutes — ${SHOP} (${BIZ})`);
    expect(r.stdout).toMatch(/^ {2}Signed up — \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/m);
    expect(r.stdout.match(/^ {2}○ .+ — Pending$/gm)).toHaveLength(4);
    expect(r.stdout).toContain('○ Not all four are on record yet.');
  });

  it('PRODUCTS, then CUSTOMERS: a pasted list confirmed, and a customer added from a pasted table', async () => {
    const { res } = await pasteAndAdd(prod.app, cookie, 'Oud oil AED 120\nMusk oil AED 45');
    expect(res.statusCode).toBe(302);
    expect((await one<{ n: number }>(`select count(*)::int as n from products where business_id = $1`, [BIZ]))!.n).toBeGreaterThanOrEqual(2);

    const started = await form('/app/customers/import', { text: 'name,phone\nSara,+971501110201' });
    expect(started.statusCode, started.body.slice(0, 300)).toBe(303);
    const id = String(started.headers['location']).split('/')[4]!;
    const added = await form(`/app/customers/import/${id}/confirm`, { rows: '2' });
    expect(added.statusCode, added.body.slice(0, 300)).toBe(200);
    expect(await one(`select display_name as name from clients where business_id = $1 and phone = '971501110201'`, [BIZ])).toEqual({ name: 'Sara' });
    // Adding a customer is not a reply, and connects nothing.
    expect((await one<{ n: number }>(`select count(*)::int as n from outbound_messages where business_id = $1`, [BIZ]))!.n).toBe(0);
  });

  it('A CHANNEL, then THE FIRST REPLY: a customer writes, the owner sends the draft as written, WhatsApp accepts it', async () => {
    // The fake channel: the workspace's own WhatsApp number, live and out of pilot mode (as an owner who connected
    // and went live would leave it), routed by the simulator's number.
    await admin.query(`insert into channels (business_id, kind, status, display_phone, connected_at, activated_at, activated_by, pilot_mode)
                       values ($1, 'whatsapp', 'connected', '+971 4 *** 0232', now(), now(), 'test', false)`, [BIZ]);
    await admin.query(`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
                       values ($1, 'whatsapp', $2, 'sim-test', 'service')`, [BIZ, sim.phoneNumberId]);

    const hook = sim.inboundText({ from: BUYER, text: 'Hello, do you have oud oil?', name: 'Lina' });
    const posted = await prod.app.inject({ method: 'POST', url: '/webhook/whatsapp', payload: hook.rawBody, headers: { 'content-type': 'application/json', ...hook.headers } });
    expect(posted.statusCode).toBe(200);
    const conv = await until(async () => (await one<{ id: string }>(`select c.id::text as id from conversations c
        join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
       where c.business_id = $1 and cc.channel_user_id = $2 limit 1`, [BIZ, BUYER]))?.id, 'the conversation');
    // A workspace that signed itself up has not earned sending alone (G4): the reply waits for the owner.
    const draft = await until(async () => (await one<{ id: string }>(`select id::text as id from drafts
        where conversation_id = $1 and status = 'pending' limit 1`, [conv]))?.id, 'the draft');
    expect((await one<{ n: number }>(`select count(*)::int as n from outbound_messages where business_id = $1`, [BIZ]))!.n).toBe(0);

    const act = await form(`/app/inbox/${conv}/act`, { draftId: draft, command: '发送' });
    expect(act.statusCode).toBe(302);
    const sent = await until(async () => one<{ origin: string; status: string; body: string }>(`select origin, status, body from outbound_messages
        where conversation_id = $1 and status in ('sent', 'delivered', 'read') limit 1`, [conv]), 'the reply to leave');
    expect(sent).toEqual({ origin: 'employee', status: 'sent', body: REPLY });
  });

  it('ALL FOUR ON RECORD: each ✓ with its time and minutes from sign-up, exit 0; Get started shows the clock done', async () => {
    const r = check();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    for (const label of ['Products in', 'Customers in', 'A channel connected', 'The first reply sent']) {
      expect(r.stdout).toMatch(new RegExp(`^ {2}✓ ${label} — \\d{4}-\\d{2}-\\d{2}T[0-9:.]+Z · \\d+ min from sign-up$`, 'm'));
    }
    expect(r.stdout).toContain('✓ All four are on record.');
    expect(r.stdout).not.toContain('Sara');
    expect(r.stdout).not.toContain(BUYER);

    // The same four, in order: each one after sign-up and the reply last.
    const { loadSetupMilestones } = await import('../../src/db/setupMilestones.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(BIZ); if (!bid.ok) throw new Error('fixture');
    const m = await withTenantTx(prod.db, bid.value, (tx) => loadSetupMilestones(tx, bid.value));
    const at = (x: Date | null) => x!.getTime();
    expect(at(m.productsIn)).toBeGreaterThanOrEqual(at(m.signedUpAt));
    expect(at(m.contactsIn)).toBeGreaterThanOrEqual(at(m.productsIn));
    expect(at(m.channelConnected)).toBeGreaterThanOrEqual(at(m.contactsIn));
    expect(at(m.firstReply)).toBeGreaterThanOrEqual(at(m.channelConnected));

    const page = await prod.app.inject({ method: 'GET', url: '/app/get-started', headers: { cookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(esc(t('en', 'setupClock.title')));
    expect(page.body).toContain('All four done in');
  });

  it('A WORKSPACE THE OPERATOR MADE: times only, no minutes; a practice copy or no workspace is refused (exit 2)', () => {
    const pilot = spawnSync(process.execPath, ['tools/acceptance-check.mjs', '--setup', '--business', PILOT], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, MIGRATE_DATABASE_URL: MIGRATE_URL ?? '' },
    });
    expect(pilot.status, pilot.stdout + pilot.stderr).toBe(1);
    expect(pilot.stdout).toContain('Signed up — not by sign-up (the operator made it): times only, no minutes');
    expect(pilot.stdout).not.toContain('min from sign-up');
    const nobody = spawnSync(process.execPath, ['tools/acceptance-check.mjs', '--setup', '--business', randomUUID()], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, MIGRATE_DATABASE_URL: MIGRATE_URL ?? '' },
    });
    expect(nobody.status).toBe(2);
  });

  it('CUSTOMERS IN WITHOUT A FILE: the first customer who wrote in; the owner\'s own testing is not one; a later import never moves it', async () => {
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { loadSetupMilestones } = await import('../../src/db/setupMilestones.js');
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const WROTE = `dd232000-0000-4000-8000-${RUN}0011`;
    const TESTING = `dd232000-0000-4000-8000-${RUN}0012`;
    const bidOf = (id: string) => { const b = parseBusinessId(id); if (!b.ok) throw new Error('fixture'); return b.value; };
    for (const [id, name] of [[WROTE, `Wrote In ${RUN}`], [TESTING, `Testing Only ${RUN}`]] as const) {
      await admin.query(`insert into businesses (id, name, signed_up_at) values ($1, $2, date_trunc('second', now()) - interval '1 hour')`, [id, name]);
    }
    // A customer writing in makes their client and conversation through the one writer the webhook uses.
    const writesIn = (id: string, digits: string, name: string) =>
      withTenantTx(prod.db, bidOf(id), (tx) => ensureConversation(tx, bidOf(id), digits, name, 'whatsapp'));
    const milestones = (id: string) => withTenantTx(prod.db, bidOf(id), (tx) => loadSetupMilestones(tx, bidOf(id)));
    const toolFor = (id: string) => spawnSync(process.execPath, ['tools/acceptance-check.mjs', '--setup', '--business', id], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, MIGRATE_DATABASE_URL: MIGRATE_URL ?? '' },
    });

    // No file: the first customer wrote in five minutes after sign-up, and that is when customers came in.
    const mona = await writesIn(WROTE, `9715${runDigits(RUN, 7)}1`, 'Mona');
    await admin.query(`update clients set created_at = (select signed_up_at from businesses where id = $2) + interval '5 minutes'
                        where id = $1`, [mona.clientId, WROTE]);
    const wrote = await milestones(WROTE);
    expect(wrote.contactsIn!.getTime() - wrote.signedUpAt!.getTime()).toBe(5 * 60_000);
    const r = toolFor(WROTE);
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stdout).toMatch(/^ {2}✓ Customers in — \d{4}-\d{2}-\d{2}T[0-9:.]+Z · 5 min from sign-up$/m);
    expect(r.stdout).toContain('○ Products in — Pending');

    // A file added later writes its own stamp, and the earlier time stands.
    await admin.query(`update businesses set contacts_first_imported_at = signed_up_at + interval '1 hour' where id = $1`, [WROTE]);
    expect((await admin.query(`select contacts_first_imported_at is not null as set from businesses where id = $1`, [WROTE])).rows[0].set).toBe(true);
    expect((await milestones(WROTE)).contactsIn).toEqual(wrote.contactsIn);

    // The owner's own testing is not a customer: its only conversation marked, it stays Pending.
    const me = await writesIn(TESTING, `9715${runDigits(RUN, 7)}2`, 'Me Testing');
    await admin.query(`update conversations set owner_testing = true where id = $1`, [me.conversationId]);
    expect((await milestones(TESTING)).contactsIn).toBeNull();
    const pending = toolFor(TESTING);
    expect(pending.stdout, pending.stderr).toContain('○ Customers in — Pending');
    // The control: the same conversation, no longer marked, counts — the exclusion is what kept it Pending.
    await admin.query(`update conversations set owner_testing = false where id = $1`, [me.conversationId]);
    expect((await milestones(TESTING)).contactsIn).not.toBeNull();
  });
});
