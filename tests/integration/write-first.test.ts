import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID, createHmac } from 'node:crypto';
import { flashSaid } from './tenant.js';
import { offlineModels } from '../pipeline/fakes.js';

/**
 * C4.a — one e-mail, written by her, sent to one contact. Over the REAL
 * production composition (`buildProduction`): her own routes, the real outbound
 * worker on pg-boss, the adapter map in `src/main.ts`, and a recording mail
 * transport where M52's provider will go.
 *
 * The parity suite proves the worker and the gate with a store it wrote itself.
 * Only this can show the joins: that `channelStore.load` resolves the outreach
 * facts from the rows her pages wrote, that `enqueueOutboundRow` finds an
 * address on an e-mail conversation, that the unsubscribe token minted at the
 * composition root is one the `/u` route accepts — and that every refusal the
 * page promises is the one the database produces.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd460000-0000-4000-8000-${RUN}0001`;
const OTHER_BIZ = `dd460000-0000-4000-8000-${RUN}0002`;
const CREDENTIAL_KEY = 'e'.repeat(64);
const WEB_SECRET = createHmac('sha256', CREDENTIAL_KEY).update('yf-web-session').digest('hex');
/** Addresses are unique across ALL tenants in `client_channels`, so per run. */
const addr = (who: string) => `${who}.${RUN}@buyer-example.test`;

d('C4.a · she writes first, by e-mail (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let transport: ReturnType<typeof import('../../src/channels/email/transport.js')['fakeMailTransport']>;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let cookie = '';
  let firstConversation = '';
  let firstToken = '';

  const tenant = async <T>(biz: string, fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>): Promise<T> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(prod.db, bid.value, fn);
  };
  const tx = <T>(fn: (tx: import('../../src/db/client.js').Tx) => Promise<T>) => tenant(BIZ, fn);
  const bidOf = async (biz: string) => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(biz); if (!bid.ok) throw new Error('fixture');
    return bid.value;
  };
  const post = (url: string, fields: Record<string, string>) => prod.app.inject({
    method: 'POST', url, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  });
  const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });
  /** The sentence a redirect carries back to her. */
  const flashOf = (res: { headers: Record<string, unknown> }): string => flashSaid(res, WEB_SECRET);
  const write = (who: string, subject: string, body: string) =>
    post('/app/contacts/write', { channel: 'email', identity: who, subject, body });
  const addAndAttest = async (who: string, name: string) => {
    expect((await post('/app/contacts', { channel: 'email', identity: who, name, company: '' })).statusCode).toBe(302);
    expect((await post('/app/contacts/consent', { channel: 'email', identity: who })).statusCode).toBe(302);
  };
  const until = async (cond: () => boolean | Promise<boolean>, what: string, ms = 45_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await cond()) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    process.env['OWNER_ACCESS_CODE'] = `write-first-${RUN}`;
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    const { fakeMailTransport } = await import('../../src/channels/email/transport.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    transport = fakeMailTransport();
    const sim = whatsappSimulator([], { tag: `wf${RUN}` });
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: `SIM_PNID_wf${RUN}`,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'wf-verify-token',
      CREDENTIAL_KEY, PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { models: offlineModels(), adapter: sim.adapter, logger: false, mailTransport: transport });

    for (const [id, name] of [[BIZ, 'Write First Factory'], [OTHER_BIZ, 'Another Factory']] as const) {
      // D — workspaces WITH the outreach area, as the pilot's is.
      await tenant(id, (x) => sql`insert into businesses (id, name, outreach_area) values (${id}, ${name}, true)
                                   on conflict (id) do nothing`.execute(x));
    }
    const login = await prod.app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(prod.ownerAccessCode)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect(cookie).not.toBe('');
  }, 60_000);

  afterAll(async () => { await prod?.close(); });

  it('WITH HER DOMAIN UNVERIFIED nothing can go, and the page says so rather than offering a button', async () => {
    const ahmed = addr('ahmed');
    await addAndAttest(ahmed, 'Ahmed');
    const list = await get('/app/contacts');
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain('/app/contacts/write?');

    const res = await write(ahmed, 'Canvas totes', 'We make canvas totes.');
    expect(res.statusCode).toBe(302);
    expect(flashOf(res)).toBe(t('en', 'refused.why.channel_cannot_initiate'));
    const rows = await tx((x) => sql<{ n: number }>`
      select count(*)::int as n from outbound_messages where business_id = ${BIZ}`.execute(x).then((r) => r.rows[0]!.n));
    expect(rows, 'a refused first message was still queued').toBe(0);
  });

  it('domain verified but writing first still off: her switch, named', async () => {
    const { setSendingDomain, recordDomainCheck } = await import('../../src/db/sendingDomain.js');
    const bid = await bidOf(BIZ);
    // The owner route that checks DNS needs the internet; the two writers it
    // calls are the ones used here.
    await tx(async (x) => {
      await setSendingDomain(x, bid, { domain: 'writefirst.example', dkimSelector: 'k1', by: 'owner' });
      await recordDomainCheck(x, bid, { spf: 'ok', dkim: 'ok', dmarc: 'ok' }, new Date());
    });
    const res = await write(addr('ahmed'), 'Canvas totes', 'We make canvas totes.');
    expect(flashOf(res)).toBe(t('en', 'refused.why.outreach_not_enabled'));
  });

  it('switch on, and a contact she never vouched for is still refused: no consent', async () => {
    expect((await post('/app/channels/outreach', { channel: 'email', enabled: 'true' })).statusCode).toBe(302);
    const stranger = addr('stranger');
    expect((await post('/app/contacts', { channel: 'email', identity: stranger, name: '', company: '' })).statusCode).toBe(302);
    const res = await write(stranger, 'Hello', 'Hello there.');
    expect(flashOf(res)).toBe(t('en', 'refused.why.no_consent'));
  });

  it('where the gate says yes the button appears, and the composer opens for him', async () => {
    const list = await get('/app/contacts');
    expect(list.body).toContain(`/app/contacts/write?channel=email&amp;identity=${encodeURIComponent(addr('ahmed'))}`);
    const page = await get(`/app/contacts/write?channel=email&identity=${encodeURIComponent(addr('ahmed'))}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('action="/app/contacts/write"');
    expect(page.body).toContain('Ahmed');
  });

  it('a mail with no subject comes back to her WITH HER WORDS, and nothing is queued', async () => {
    const res = await write(addr('ahmed'), '   ', 'Words she should not have to type twice.');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Words she should not have to type twice.');
    expect(res.body).toContain(t('en', 'contacts.flash.empty'));
  });

  it('SHE WRITES, AND IT LEAVES — through the one worker, with her subject and a way out', async () => {
    const res = await write(addr('ahmed'), 'Canvas totes from Yiwu', 'We make canvas totes, 500 pcs and up.');
    expect(res.statusCode).toBe(302);
    const location = String(res.headers['location']);
    expect(location).toMatch(/^\/app\/inbox\/[0-9a-f-]{36}$/);
    firstConversation = location.split('/')[3]!.split('?')[0]!;

    // Matched by recipient, never by position: pg-boss is durable, so a mail an
    // earlier interrupted run queued is delivered by whichever worker starts
    // next — at-least-once working as designed, and this process may be it.
    const mine = () => transport.sent.filter((x) => x.to === addr('ahmed'));
    await until(() => mine().length > 0, 'the mail to reach the transport');
    expect(mine(), 'one press sent more than one mail').toHaveLength(1);
    const m = mine()[0]!;
    expect({ to: m.to, subject: m.subject, text: m.text }).toEqual({
      to: addr('ahmed'), subject: 'Canvas totes from Yiwu', text: 'We make canvas totes, 500 pcs and up.',
    });
    const link = /^<(https:\/\/nomi\.test\/u\?t=([^>]+))>$/.exec(m.headers['List-Unsubscribe'] ?? '');
    expect(link, 'no RFC 8058 link on a first message').not.toBeNull();
    expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    // THE TOKEN IS ONE THE PAGE ACCEPTS: minted at the composition root with the
    // key the /u route reads with, for exactly this business and address.
    firstToken = decodeURIComponent(link![2]!);
    const { readUnsubscribe } = await import('../../src/outbound/unsubscribe.js');
    expect(readUnsubscribe(WEB_SECRET, firstToken)).toMatchObject({
      businessId: BIZ, channel: 'email', identity: addr('ahmed'),
    });

    await until(async () => (await tx((x) => sql<{ status: string }>`
      select status from outbound_messages where conversation_id = ${firstConversation}`.execute(x)
      .then((r) => r.rows[0]?.status))) === 'sent', 'the row to be marked sent');
    const row = await tx((x) => sql<{
      channel: string; origin: string; subject: string | null; to_wa_id: string; sent_at: Date | null; id: string;
    }>`select id, channel, origin, subject, to_wa_id, sent_at from outbound_messages
        where conversation_id = ${firstConversation}`.execute(x).then((r) => r.rows[0]!));
    expect(row).toMatchObject({ channel: 'email', origin: 'outreach', subject: 'Canvas totes from Yiwu', to_wa_id: addr('ahmed') });
    expect(row.sent_at).not.toBeNull();

    const conv = await tx((x) => sql<{ channel: string; email: string | null; phone: string | null; display_name: string | null }>`
      select c.channel, cl.email, cl.phone, cl.display_name from conversations c
        join clients cl on cl.id = c.client_id where c.id = ${firstConversation}`.execute(x).then((r) => r.rows[0]!));
    expect(conv).toEqual({ channel: 'email', email: addr('ahmed'), phone: null, display_name: 'Ahmed' });

    // On her timeline, as the words that left — and her name on the act.
    const timeline = await tx((x) => sql<{ n: number }>`
      select count(*)::int as n from messages where conversation_id = ${firstConversation}
         and direction = 'outbound' and external_id = ${'out:' + row.id}`.execute(x).then((r) => r.rows[0]!.n));
    expect(timeline).toBe(1);
    const events = await tx((x) => sql<{ type: string; channel: string }>`
      select type, payload->>'channel' as channel from conversation_events
       where conversation_id = ${firstConversation} and type = 'wrote_first'`.execute(x).then((r) => r.rows));
    expect(events).toEqual([{ type: 'wrote_first', channel: 'email' }]);
    const page = await get(`/app/inbox/${firstConversation}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('We make canvas totes, 500 pcs and up.');
  }, 60_000);

  it('THE LINK IN IT WORKS: he stops her, and she is never offered him again', async () => {
    const res = await prod.app.inject({ method: 'POST', url: `/u?t=${encodeURIComponent(firstToken)}` });
    expect(res.statusCode).toBe(200);
    const s = await tx((x) => sql<{ reason: string }>`
      select reason from suppressions where business_id = ${BIZ} and channel = 'email'
         and identity = ${addr('ahmed')}`.execute(x).then((r) => r.rows[0]));
    expect(s?.reason).toBe('unsubscribed');

    const again = await write(addr('ahmed'), 'Following up', 'Just checking in.');
    expect(flashOf(again)).toBe(t('en', 'refused.why.suppressed'));
    expect((await get('/app/contacts')).body)
      .not.toContain(`/app/contacts/write?channel=email&amp;identity=${encodeURIComponent(addr('ahmed'))}`);
  });

  it('A SUPPRESSION THAT ARRIVES AFTER SHE PRESSED SEND still stops it — the worker asks again', async () => {
    const { ensureConversation, enqueueOutboundRow, channelStore } = await import('../../src/db/channels.js');
    const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
    const { emailAdapter } = await import('../../src/channels/email/adapter.js');
    const { fakeMailTransport } = await import('../../src/channels/email/transport.js');
    const { suppress } = await import('../../src/db/contacts.js');
    const { loadRefusals } = await import('../../src/api/web/refusals.js');
    const bid = await bidOf(BIZ);
    const late = addr('late');
    await addAndAttest(late, 'Late Bounce');

    // Queued the way writeFirst queues it, without the kick — then the bounce.
    const cid = await tx(async (x) => {
      const c = await ensureConversation(x, bid, late, 'Late Bounce', 'email');
      await enqueueOutboundRow(x, bid, c.conversationId, 'Hello.', 'outreach', { subject: 'Hello' });
      await suppress(x, bid, { channel: 'email', identity: late, reason: 'bounced', detail: null });
      return c.conversationId;
    });
    const own = fakeMailTransport();
    const email = emailAdapter({ transport: own });
    const effects = await tx((x) => driveConversationOutbound({
      store: channelStore(x, bid), adapter: email, adapters: (k) => (k === 'email' ? email : undefined),
      mailHeaders: () => ({ headers: { 'List-Unsubscribe': '<https://nomi.test/u?t=x>' }, tag: 'x' }), now: () => new Date(),
    }, cid));
    expect(effects).toContainEqual(expect.objectContaining({ kind: 'canceled', reason: 'suppressed' }));
    expect(own.sent).toEqual([]);

    const shown = await loadRefusals(prod.db, BIZ, { conversationId: cid });
    expect(shown.map((r) => [r.reason, r.origin, r.buyer])).toEqual([['suppressed', 'outreach', 'Late Bounce']]);
    const page = await get(`/app/inbox/${cid}`);
    expect(page.body).toContain(t('en', 'refused.what.suppressed'));
  });

  it('HER CAP: she sets one, it binds today, and setting it never flips her switch', async () => {
    expect((await post('/app/channels/outreach/cap', { channel: 'email', cap: '1' })).statusCode).toBe(302);
    const setting = await tx((x) => sql<{ enabled: boolean; daily_cap: number | null }>`
      select enabled, daily_cap from outreach_settings where business_id = ${BIZ} and channel = 'email'
       order by at desc, id desc limit 1`.execute(x).then((r) => r.rows[0]!));
    expect(setting).toEqual({ enabled: true, daily_cap: 1 });
    expect((await get('/app/channels')).body).toMatch(/name="cap"[^>]*value="1"/);

    const third = addr('third');
    await addAndAttest(third, 'Third Buyer');
    // One mail already left today (Ahmed's), so the cap of one is spent.
    expect(flashOf(await write(third, 'Hello', 'Hello.'))).toBe(t('en', 'refused.why.outreach_ceiling'));

    // Cleared, it falls back to the default the form states — and the send goes.
    expect((await post('/app/channels/outreach/cap', { channel: 'email', cap: '' })).statusCode).toBe(302);
    const res = await write(third, 'Hello', 'Hello.');
    expect(String(res.headers['location'])).toMatch(/^\/app\/inbox\//);
    await until(() => transport.sent.some((m) => m.to === third), 'the second mail');
  }, 60_000);

  it('turning writing first OFF keeps the number she chose', async () => {
    await post('/app/channels/outreach/cap', { channel: 'email', cap: '7' });
    await post('/app/channels/outreach', { channel: 'email', enabled: 'false' });
    const setting = await tx((x) => sql<{ enabled: boolean; daily_cap: number | null }>`
      select enabled, daily_cap from outreach_settings where business_id = ${BIZ} and channel = 'email'
       order by at desc, id desc limit 1`.execute(x).then((r) => r.rows[0]!));
    expect(setting).toEqual({ enabled: false, daily_cap: 7 });
    await post('/app/channels/outreach', { channel: 'email', enabled: 'true' });
  });

  it('AN ADDRESS ANOTHER FACTORY ALREADY HOLDS writes nothing here — not even an empty thread', async () => {
    const { ensureConversation } = await import('../../src/db/channels.js');
    const shared = addr('shared');
    const other = await bidOf(OTHER_BIZ);
    await tenant(OTHER_BIZ, (x) => ensureConversation(x, other, shared, 'Theirs', 'email'));

    await addAndAttest(shared, 'Ours Too');
    const res = await write(shared, 'Hello', 'Hello.');
    expect(flashOf(res)).toBe(t('en', 'contacts.flash.no_channel'));
    const ghosts = await tx((x) => sql<{ n: number }>`
      select count(*)::int as n from clients where business_id = ${BIZ} and email = ${shared}`
      .execute(x).then((r) => r.rows[0]!.n));
    expect(ghosts, 'a client with no address was left behind in her list').toBe(0);
  });

  it('ONE BUYER ON TWO CHANNELS HAS TWO THREADS — a first mail never lands in his WhatsApp conversation', async () => {
    const { ensureConversation } = await import('../../src/db/channels.js');
    const bid = await bidOf(BIZ);
    const phone = `9715${RUN.replace(/[^0-9]/g, '').padEnd(8, '7').slice(0, 8)}`;
    const both = addr('both');
    const [wa, mail] = await tx(async (x) => {
      const w = await ensureConversation(x, bid, phone, 'Two Ways');
      await sql`insert into client_channels (client_id, channel, channel_user_id)
                values (${w.clientId}, 'email', ${both})`.execute(x);
      const m = await ensureConversation(x, bid, both, 'Two Ways', 'email');
      return [w, m];
    });
    expect(mail.clientId).toBe(wa.clientId);
    expect(mail.conversationId).not.toBe(wa.conversationId);
    const channels = await tx((x) => sql<{ id: string; channel: string }>`
      select id, channel from conversations where id in (${wa.conversationId}, ${mail.conversationId})`
      .execute(x).then((r) => Object.fromEntries(r.rows.map((row) => [row.id, row.channel]))));
    expect(channels).toEqual({ [wa.conversationId]: 'whatsapp', [mail.conversationId]: 'email' });
  });
});
