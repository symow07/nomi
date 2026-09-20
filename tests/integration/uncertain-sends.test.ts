import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID, createHmac } from 'node:crypto';
import { flashSaid } from './tenant.js';

/**
 * 0052 — a message is never sent twice by a machine, over the REAL composition.
 *
 * The parity suite proves the rule and the page. Only this can prove the part
 * that matters: that a send interrupted mid-flight leaves a row the worker will
 * NOT pick up again, that her two answers move it exactly once, and that a
 * second press — or a second person — sends nothing more.
 *
 * The interruption is staged the way a crash leaves it: a row in 'sending' with
 * its clock set back past the window. That is precisely the state a killed
 * process leaves behind, and no amount of mocking reproduces it more honestly.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd530000-0000-4000-8000-${RUN}0001`;
const CREDENTIAL_KEY = 'c'.repeat(64);
const WEB_SECRET = createHmac('sha256', CREDENTIAL_KEY).update('yf-web-session').digest('hex');
const addr = (who: string) => `${who}.${RUN}@unsure-buyer.test`;

d('0052 · a send nobody can account for (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let transport: ReturnType<typeof import('../../src/channels/email/transport.js')['fakeMailTransport']>;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let esc: typeof import('../../src/api/web/layout.js')['esc'];
  let cookie = '';
  let conversationId = '';

  const bid = async () => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return b.value;
  };
  const tx = async <R>(fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, await bid(), fn);
  };
  const post = (url: string, fields: Record<string, string> = {}, as = cookie) => prod.app.inject({
    method: 'POST', url, headers: { cookie: as, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  });
  const get = (url: string, as = cookie) => prod.app.inject({ method: 'GET', url, headers: { cookie: as } });
  const flashOf = (res: { headers: Record<string, unknown> }): string => flashSaid(res, WEB_SECRET);
  const login = async (code: string) => {
    const r = await prod.app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(code)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    return String(r.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  };
  const drive = async () => {
    const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
    const { channelStore } = await import('../../src/db/channels.js');
    const { emailAdapter } = await import('../../src/channels/email/adapter.js');
    const b = await bid();
    return tx((x) => driveConversationOutbound({
      store: channelStore(x, b),
      adapter: emailAdapter({ transport }),
      adapters: (k) => (k === 'email' ? emailAdapter({ transport }) : undefined),
      mailHeaders: () => ({ headers: { 'List-Unsubscribe': '<https://nomi.test/u?t=x>' }, tag: 'x' }),
      now: () => new Date(),
    }, conversationId));
  };
  const row = () => tx((x) => sql<{ id: string; status: string; sending_since: Date | null; cancel_reason: string | null }>`
    select id::text as id, status, sending_since, cancel_reason from outbound_messages
     where business_id = ${BIZ} order by created_at desc limit 1`.execute(x).then((r) => r.rows[0]!));

  /** Stage exactly what a killed process leaves: 'sending', clock set back. */
  const interrupt = async (minutesAgo = 5) => tx((x) => sql`
    update outbound_messages
       set status = 'sending', sending_since = now() - make_interval(mins => ${minutesAgo})
     where business_id = ${BIZ}`.execute(x));

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    process.env['OWNER_ACCESS_CODE'] = `unsure-${RUN}`;
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { fakeMailTransport } = await import('../../src/channels/email/transport.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    ({ esc } = await import('../../src/api/web/layout.js'));
    transport = fakeMailTransport();
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: `SIM_PNID_un${RUN}`,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'un-verify-token',
      CREDENTIAL_KEY, PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { adapter: whatsappSimulator([], { tag: `un${RUN}` }).adapter, logger: false, mailTransport: transport });

    await tx((x) => sql`insert into businesses (id, name) values (${BIZ}, 'Unsure Factory')
                        on conflict (id) do nothing`.execute(x));
    cookie = await login(prod.ownerAccessCode);

    // A buyer she may write to, on a verified domain, with writing-first on.
    const { setSendingDomain, recordDomainCheck } = await import('../../src/db/sendingDomain.js');
    const b = await bid();
    await tx(async (x) => {
      await setSendingDomain(x, b, { domain: 'unsure.example', dkimSelector: 'k1', by: 'owner' });
      await recordDomainCheck(x, b, { spf: 'ok', dkim: 'ok', dmarc: 'ok' }, new Date());
    });
    await post('/app/channels/outreach', { channel: 'email', enabled: 'true' });
    await post('/app/contacts', { channel: 'email', identity: addr('ahmed'), name: 'Ahmed', company: '' });
    await post('/app/contacts/consent', { channel: 'email', identity: addr('ahmed') });
    await post('/app/contacts/write', {
      channel: 'email', identity: addr('ahmed'), subject: 'Canvas totes', body: 'Your price for 500 is $0.92 each.',
    });
    conversationId = await tx((x) => sql<{ id: string }>`
      select conversation_id::text as id from outbound_messages where business_id = ${BIZ}
       order by created_at desc limit 1`.execute(x).then((r) => r.rows[0]!.id));
  }, 90_000);

  afterAll(async () => { await prod?.close(); });

  it('AN INTERRUPTED SEND IS NOT SENT AGAIN — it stops, and nothing leaves', async () => {
    await interrupt();
    const before = transport.sent.length;
    const effects = await drive();
    expect(effects).toContainEqual(expect.objectContaining({ kind: 'uncertain' }));
    expect((await row()).status).toBe('uncertain');
    expect(transport.sent.length, 'the worker sent it a second time').toBe(before);

    // And it stays stopped: driving again changes nothing.
    await drive();
    expect((await row()).status).toBe('uncertain');
    expect(transport.sent.length).toBe(before);
  }, 60_000);

  it('a send still in flight is left alone — the window is respected', async () => {
    await interrupt(0);
    await drive();
    expect((await row()).status, 'a send in progress was declared unknown').toBe('sending');
  }, 60_000);

  it('SHE IS ASKED, in her own words, with both answers on the conversation', async () => {
    await interrupt();
    await drive();
    const page = await get(`/app/inbox/${conversationId}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain(esc(t('en', 'unsure.title')));
    expect(page.body).toContain(esc('Your price for 500 is $0.92 each.'));
    const id = (await row()).id;
    expect(page.body).toContain(`/app/outbound/${id}/send-again`);
    expect(page.body).toContain(`/app/outbound/${id}/leave`);
    // Today names it too, so it is not only found by opening the thread.
    expect((await get('/app')).body).toContain(esc(t('en', 'insight.uncertainSends', { count: 1 })));
  }, 60_000);

  it('"LEAVE IT" closes it as never seen to leave, and sends nothing', async () => {
    const id = (await row()).id;
    const before = transport.sent.length;
    expect(flashOf(await post(`/app/outbound/${id}/leave`))).toBe(t('en', 'unsure.flash.left'));
    const after = await row();
    expect(after.status).toBe('canceled');
    expect(after.cancel_reason, 'her decision is not recorded').toMatch(/left by/);
    expect(transport.sent.length).toBe(before);
    // Pressing again decides nothing: the row has moved on.
    expect(flashOf(await post(`/app/outbound/${id}/leave`))).toBe(t('en', 'unsure.flash.gone'));
  }, 60_000);

  it('"SEND IT" queues it once, the worker sends one copy, and a second press sends none', async () => {
    await post('/app/contacts/write', {
      channel: 'email', identity: addr('ahmed'), subject: 'Following up', body: 'Did that reach you?',
    });
    await interrupt();
    await drive();
    const id = (await row()).id;
    expect((await row()).status).toBe('uncertain');

    const before = transport.sent.length;
    expect(flashOf(await post(`/app/outbound/${id}/send-again`))).toBe(t('en', 'unsure.flash.again'));
    expect((await row()).status).toBe('queued');
    await drive();
    expect(transport.sent.length, 'her decision did not send it').toBe(before + 1);
    expect((await row()).status).toBe('sent');

    // A second press — a double click, a colleague on another screen — is refused.
    expect(flashOf(await post(`/app/outbound/${id}/send-again`))).toBe(t('en', 'unsure.flash.gone'));
    await drive();
    expect(transport.sent.length, 'it went twice').toBe(before + 1);
  }, 90_000);

  it('a staff member may answer it too — whoever holds the thread can judge it', async () => {
    const { addPerson } = await import('../../src/api/web/people.js');
    const person = await addPerson(prod.db, BIZ, WEB_SECRET, 'Mei');
    expect(person.code).toBe('added');
    const staff = await login((person as { accessCode: string }).accessCode);

    await post('/app/contacts/write', {
      channel: 'email', identity: addr('ahmed'), subject: 'Third', body: 'One more note.',
    });
    await interrupt();
    await drive();
    const id = (await row()).id;
    expect(flashOf(await post(`/app/outbound/${id}/leave`, {}, staff))).toBe(t('en', 'unsure.flash.left'));
    expect((await row()).cancel_reason).toContain('Mei');
  }, 90_000);
});
