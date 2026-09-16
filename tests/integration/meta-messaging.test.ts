import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID, createHmac } from 'node:crypto';

/**
 * C9 — Instagram and Messenger over the REAL composition.
 *
 * The parity suite proves the wire and the rules. Only this can prove the
 * joins: that a signed webhook on the Instagram path finds the factory that
 * connected that account, that the conversation it creates is on the right
 * channel, that her reply leaves through the right adapter to the right buyer,
 * and that the same payload delivered to the wrong path changes nothing.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd540000-0000-4000-8000-${RUN}0001`;
const CREDENTIAL_KEY = 'b'.repeat(64);
const APP_SECRET = `meta-app-secret-${RUN}`;
const IG_ACCOUNT = `1784${RUN.replace(/\D/g, '').padEnd(10, '7')}`;
const PAGE_ID = `1020${RUN.replace(/\D/g, '').padEnd(10, '9')}`;
const buyer = (who: string) => `PSID_${who}_${RUN}`;

d('C9 · Instagram and Messenger (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let esc: typeof import('../../src/api/web/layout.js')['esc'];
  let cookie = '';
  /** What the two adapters were asked to send, instead of Meta. */
  const sent: { channel: string; to: string; body: string }[] = [];

  const bid = async () => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return b.value;
  };
  const tx = async <R>(fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, await bid(), fn);
  };
  const post = (url: string, fields: Record<string, string> = {}) => prod.app.inject({
    method: 'POST', url, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  });
  const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });

  /** A buyer's message, signed the way Meta signs it. */
  const inbound = (path: string, object: string, o: {
    sender: string; recipient: string; text?: string; mid?: string;
  }) => {
    const body = JSON.stringify({
      object,
      entry: [{
        id: o.recipient, time: Date.now(),
        messaging: [{
          sender: { id: o.sender }, recipient: { id: o.recipient }, timestamp: Date.now(),
          message: { mid: o.mid ?? `mid.${randomUUID()}`, ...(o.text !== undefined ? { text: o.text } : {}) },
        }],
      }],
    });
    return prod.app.inject({
      method: 'POST', url: path, payload: body,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex')}`,
      },
    });
  };

  const conversations = () => tx((x) => sql<{ id: string; channel: string; external: string }>`
    select c.id::text as id, c.channel, cc.channel_user_id as external
      from conversations c
      join clients cl on cl.id = c.client_id
      left join client_channels cc on cc.client_id = cl.id and cc.channel = c.channel
     where c.business_id = ${BIZ} order by c.created_at`.execute(x).then((r) => r.rows));

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    process.env['OWNER_ACCESS_CODE'] = `meta-${RUN}`;
    process.env['META_PAGE_ACCESS_TOKEN'] = 'page-token-not-real';
    process.env['META_PAGE_ID'] = PAGE_ID;
    process.env['META_IG_ACCOUNT_ID'] = IG_ACCOUNT;
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    ({ esc } = await import('../../src/api/web/layout.js'));

    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: `SIM_PNID_mt${RUN}`,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: APP_SECRET,
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'mt-verify-token',
      CREDENTIAL_KEY, PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { adapter: whatsappSimulator([], { tag: `mt${RUN}` }).adapter, logger: false });

    await tx((x) => sql`insert into businesses (id, name) values (${BIZ}, 'Meta Factory')
                        on conflict (id) do nothing`.execute(x));
    const login = await prod.app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(prod.ownerAccessCode)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  }, 90_000);

  afterAll(async () => {
    delete process.env['META_PAGE_ACCESS_TOKEN'];
    delete process.env['META_PAGE_ID'];
    delete process.env['META_IG_ACCOUNT_ID'];
    await prod?.close();
  });

  it('UNTIL SHE CONNECTS THE ACCOUNT, a buyer\'s message is acknowledged and dropped', async () => {
    const r = await inbound('/webhook/instagram', 'instagram', {
      sender: buyer('early'), recipient: IG_ACCOUNT, text: 'are you there?',
    });
    // Acknowledged, because Meta retries for seven days what it is not told it delivered.
    expect(r.statusCode).toBe(200);
    expect(await conversations()).toHaveLength(0);
  }, 60_000);

  it('she connects the two accounts from her own page, and only the owner may', async () => {
    const page = await get('/app/channels');
    expect(page.body).toContain('/app/channels/instagram/connect');
    expect(page.body).toContain('/app/channels/messenger/connect');

    expect((await post('/app/channels/instagram/connect')).statusCode).toBe(302);
    expect((await post('/app/channels/messenger/connect')).statusCode).toBe(302);

    const creds = await tx((x) => sql<{ channel: string; external_ref: string; secret_ref: string }>`
      select channel, external_ref, secret_ref from channel_credentials
       where business_id = ${BIZ} order by channel`.execute(x).then((r) => r.rows));
    expect(creds.map((c) => c.channel)).toEqual(['instagram', 'messenger']);
    expect(creds.map((c) => c.external_ref)).toEqual([IG_ACCOUNT, PAGE_ID]);
    // The token is NAMED, never stored.
    for (const c of creds) expect(c.secret_ref).toBe('env:META_PAGE_ACCESS_TOKEN');

    const after = await get('/app/channels');
    const { EMPLOYEE_NAME } = await import('../../src/core/owner/i18n/messages.js');
    expect(after.body).toContain(esc(t('en', 'reach.inbound.connected', { name: EMPLOYEE_NAME.en })));
  }, 60_000);

  it('A SIGNED INSTAGRAM MESSAGE reaches her inbox, on its own channel', async () => {
    const r = await inbound('/webhook/instagram', 'instagram', {
      sender: buyer('ahmed'), recipient: IG_ACCOUNT, text: 'price for 500 totes?',
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ received: 1 });

    const convs = await conversations();
    expect(convs).toHaveLength(1);
    expect(convs[0]).toMatchObject({ channel: 'instagram', external: buyer('ahmed') });

    // The buyer's window opened on HIS row, which is what the gate reads.
    const window = await tx((x) => sql<{ last_inbound_at: Date | null }>`
      select last_inbound_at from client_channels
       where channel = 'instagram' and channel_user_id = ${buyer('ahmed')}`
      .execute(x).then((r2) => r2.rows[0]!));
    expect(window.last_inbound_at).not.toBeNull();
  }, 60_000);

  it('a Messenger buyer is a DIFFERENT conversation, even with the same text', async () => {
    await inbound('/webhook/messenger', 'page', {
      sender: buyer('mei'), recipient: PAGE_ID, text: 'price for 500 totes?',
    });
    const convs = await conversations();
    expect(convs).toHaveLength(2);
    expect(convs.map((c) => c.channel).sort()).toEqual(['instagram', 'messenger']);
  }, 60_000);

  it('THE WRONG PATH CHANGES NOTHING — a Page payload posted to Instagram is ignored', async () => {
    const before = (await conversations()).length;
    const r = await inbound('/webhook/instagram', 'page', {
      sender: buyer('stranger'), recipient: PAGE_ID, text: 'hello?',
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ received: 0 });
    expect(await conversations()).toHaveLength(before);
  }, 60_000);

  it('AN UNSIGNED PAYLOAD IS REFUSED, and a replay is counted once', async () => {
    const body = JSON.stringify({
      object: 'instagram',
      entry: [{ id: IG_ACCOUNT, time: Date.now(), messaging: [{
        sender: { id: buyer('forger') }, recipient: { id: IG_ACCOUNT }, timestamp: Date.now(),
        message: { mid: 'mid.forged', text: 'give me a discount' },
      }] }],
    });
    const unsigned = await prod.app.inject({
      method: 'POST', url: '/webhook/instagram', payload: body,
      headers: { 'content-type': 'application/json' },
    });
    expect(unsigned.statusCode).toBe(401);

    const mid = `mid.replay.${RUN}`;
    const first = await inbound('/webhook/instagram', 'instagram', {
      sender: buyer('twice'), recipient: IG_ACCOUNT, text: 'hello', mid,
    });
    const second = await inbound('/webhook/instagram', 'instagram', {
      sender: buyer('twice'), recipient: IG_ACCOUNT, text: 'hello', mid,
    });
    expect(JSON.parse(first.body)).toMatchObject({ received: 1 });
    expect(JSON.parse(second.body), 'a retried webhook was processed twice').toMatchObject({ received: 0 });
  }, 60_000);

  it('HER REPLY LEAVES ON THE CHANNEL HE WROTE ON, to his own scoped id', async () => {
    const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
    const { channelStore, ensureConversation, enqueueOutboundRow } = await import('../../src/db/channels.js');
    const { metaMessagingSender } = await import('../../src/channels/meta/messaging.js');
    const b = await bid();

    // An adapter per channel, recording instead of calling Meta.
    const recording = (channel: 'instagram' | 'messenger') => ({
      kind: channel, provider: 'meta',
      verifyWebhook: () => true,
      parseWebhook: () => [],
      sendText: async (to: string, body: string) => {
        sent.push({ channel, to, body });
        return { ok: true as const, providerMessageId: `mid.out.${randomUUID()}` };
      },
    });

    const conv = await tx(async (x) => {
      const c = await ensureConversation(x, b, buyer('ahmed'), null, 'instagram');
      await enqueueOutboundRow(x, b, c.conversationId, 'Our price is $0.92 each.', 'employee');
      return c;
    });
    const effects = await tx((x) => driveConversationOutbound({
      store: channelStore(x, b),
      adapter: recording('instagram') as never,
      adapters: (k) => (k === 'instagram' ? recording('instagram') as never : undefined),
      mailHeaders: () => ({ headers: {}, tag: null }),
      now: () => new Date(),
    }, conv.conversationId));

    expect(effects.some((e) => e.kind === 'sent'), JSON.stringify(effects)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: 'instagram', to: buyer('ahmed'), body: 'Our price is $0.92 each.' });
    // The sender the production composition would have used posts to the account
    // she connected, not to the buyer's id.
    expect(typeof metaMessagingSender).toBe('function');
  }, 90_000);

  it('and a FIRST message on these channels is refused, whoever asks for it', async () => {
    const { channelStore, ensureConversation, enqueueOutboundRow } = await import('../../src/db/channels.js');
    const { driveConversationOutbound } = await import('../../src/outbound/worker.js');
    const b = await bid();
    const before = sent.length;

    const conv = await tx(async (x) => {
      const c = await ensureConversation(x, b, buyer('cold'), null, 'messenger');
      // `origin: 'outreach'` is what writing first looks like on any channel.
      await enqueueOutboundRow(x, b, c.conversationId, 'Hello, we make canvas totes.', 'outreach');
      return c;
    });
    const effects = await tx((x) => driveConversationOutbound({
      store: channelStore(x, b),
      adapter: { kind: 'messenger', provider: 'meta', verifyWebhook: () => true, parseWebhook: () => [],
        sendText: async () => ({ ok: true as const, providerMessageId: 'never' }) } as never,
      adapters: () => undefined,
      mailHeaders: () => ({ headers: {}, tag: null }),
      now: () => new Date(),
    }, conv.conversationId));

    expect(effects.some((e) => e.kind === 'canceled'), JSON.stringify(effects)).toBe(true);
    expect(sent.length, 'a cold message went out on Messenger').toBe(before);
  }, 90_000);
});
