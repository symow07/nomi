import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID, createHmac } from 'node:crypto';
import { flashSaid } from './tenant.js';
import { offlineModels } from '../pipeline/fakes.js';

/**
 * C4.c — the reply is the opt-in, over the REAL production composition.
 *
 * The loop, end to end: a follow-up sequence sends her first mail; he answers it
 * through the signed inbound webhook; his words land on the conversation, his
 * answer becomes consent, a person is told, and the follow-ups stop. She takes
 * the conversation and answers him, and her mail threads under his with a
 * "Re:" subject. And the tag every mail now carries is the one a bounce event
 * echoes — so M40.2's webhook, which could never have matched a real provider's
 * event before, suppresses the right address.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd480000-0000-4000-8000-${RUN}0001`;
const CREDENTIAL_KEY = 'a'.repeat(64);
const WEB_SECRET = createHmac('sha256', CREDENTIAL_KEY).update('yf-web-session').digest('hex');
const HOOK_SECRET = `hook-secret-${RUN}`;
const addr = (who: string) => `${who}.${RUN}@reply-buyer.test`;
const DAY = 24 * 3600_000;

d('C4.c · he answers her e-mail (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let transport: ReturnType<typeof import('../../src/channels/email/transport.js')['fakeMailTransport']>;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let esc: typeof import('../../src/api/web/layout.js')['esc'];
  let cookie = '';
  let seqId = '';
  let conversationId = '';
  let ourMessageId = '';
  const T0 = new Date();
  const HIS_ID = `his-answer-${RUN}@reply-buyer.test`;

  const bid = async () => {
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return b.value;
  };
  const tx = async <R>(fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    return withTenantTx(prod.db, await bid(), fn);
  };
  const post = (url: string, fields: Record<string, string>) => prod.app.inject({
    method: 'POST', url, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(fields).toString(),
  });
  const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie } });
  const flashOf = (res: { headers: Record<string, unknown> }): string => flashSaid(res, WEB_SECRET);
  const until = async (cond: () => boolean | Promise<boolean>, what: string, ms = 45_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await cond()) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  /** A provider's signed POST: HMAC-SHA256 over the exact bytes, base64url. */
  const hook = (url: string, payload: unknown, secret = HOOK_SECRET) => {
    const body = JSON.stringify(payload);
    return prod.app.inject({
      method: 'POST', url, payload: body,
      headers: {
        'content-type': 'application/json',
        'x-webhook-signature': createHmac('sha256', secret).update(body).digest('base64url'),
      },
    });
  };
  const sweep = async (at: Date) => {
    const { runDueSteps } = await import('../../src/outbound/sequences.js');
    const { QUEUES } = await import('../../src/queue/boss.js');
    return runDueSteps({
      db: prod.db, now: () => at, templateState: 'none', repliesObservable: true,
      kickDrive: async (b, c) => { await prod.boss.send(QUEUES.outbound, { businessId: b, conversationId: c }, { singletonKey: c }); },
    }, await bid());
  };
  const counts = () => tx((x) => sql<{ inbound: number; consent: number; signals: number }>`
    select (select count(*)::int from messages where conversation_id = ${conversationId}::uuid and direction = 'inbound') as inbound,
           (select count(*)::int from contact_consent where business_id = ${BIZ} and identity = ${addr('ahmed')}
               and evidence = 'replied_to_email') as consent,
           (select count(*)::int from conversation_signals where conversation_id = ${conversationId}::uuid
               and kind = 'email_reply') as signals`.execute(x).then((r) => r.rows[0]!));

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    process.env['OWNER_ACCESS_CODE'] = `replies-${RUN}`;
    process.env['EMAIL_WEBHOOK_SECRET'] = HOOK_SECRET;
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
      META_WHATSAPP_PHONE_NUMBER_ID: `SIM_PNID_rp${RUN}`,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'rp-verify-token',
      CREDENTIAL_KEY, PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { models: offlineModels(), adapter: whatsappSimulator([], { tag: `rp${RUN}` }).adapter, logger: false, mailTransport: transport });

    await tx((x) => sql`insert into businesses (id, name) values (${BIZ}, 'Reply Factory')
                        on conflict (id) do nothing`.execute(x));
    const login = await prod.app.inject({
      method: 'POST', url: '/login', payload: `code=${encodeURIComponent(prod.ownerAccessCode)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';

    const { setSendingDomain, recordDomainCheck } = await import('../../src/db/sendingDomain.js');
    const b = await bid();
    await tx(async (x) => {
      await setSendingDomain(x, b, { domain: 'replies.example', dkimSelector: 'k1', by: 'owner' });
      await recordDomainCheck(x, b, { spf: 'ok', dkim: 'ok', dmarc: 'ok' }, new Date());
    });
    await post('/app/channels/outreach', { channel: 'email', enabled: 'true' });
    await post('/app/contacts', { channel: 'email', identity: addr('ahmed'), name: 'Ahmed', company: '' });
    await post('/app/contacts/consent', { channel: 'email', identity: addr('ahmed') });

    // A two-mail sequence, approved, with Ahmed on it; the first mail goes.
    const created = await post('/app/sequences', { name: 'Totes' });
    seqId = /\/app\/sequences\/([0-9a-f-]{36})/.exec(String(created.headers['location']))![1]!;
    await post(`/app/sequences/${seqId}/steps`, { delayDays: '0', subject: 'Canvas totes from Yiwu', body: 'We make canvas totes.' });
    await post(`/app/sequences/${seqId}/steps`, { delayDays: '2', subject: 'Following up', body: 'Any interest?' });
    const fp = /name="fingerprint" value="([0-9a-f]{64})"/.exec((await get(`/app/sequences/${seqId}`)).body)![1]!;
    await post(`/app/sequences/${seqId}/approve`, { fingerprint: fp });
    expect(flashOf(await post(`/app/sequences/${seqId}/enroll`, { identity: addr('ahmed') }))).toBe(t('en', 'seq.flash.enrolled'));
    await sweep(new Date(T0.getTime() + 60_000));
    await until(async () => (await tx((x) => sql<{ status: string }>`
      select status from outbound_messages where business_id = ${BIZ} and to_wa_id = ${addr('ahmed')}`
      .execute(x).then((r) => r.rows[0]?.status))) === 'sent', 'the first mail to be sent');
    const row = await tx((x) => sql<{ conversation_id: string; provider_message_id: string }>`
      select conversation_id::text as conversation_id, provider_message_id from outbound_messages
       where business_id = ${BIZ} and to_wa_id = ${addr('ahmed')}`.execute(x).then((r) => r.rows[0]!));
    conversationId = row.conversation_id;
    ourMessageId = row.provider_message_id;
    expect(ourMessageId).toMatch(/@/);
  }, 120_000);

  afterAll(async () => {
    delete process.env['EMAIL_WEBHOOK_SECRET'];
    await prod?.close();
  });

  const answer = (over: Record<string, unknown> = {}) => ({
    from: `Ahmed <${addr('ahmed')}>`, messageId: `<${HIS_ID}>`,
    subject: 'Re: Canvas totes from Yiwu', text: 'Yes — send prices for 5,000.\n\n> We make canvas totes.',
    references: `<${ourMessageId}>`, ...over,
  });

  it('A FORGED SIGNATURE is not heard, and cannot be told apart from no route at all', async () => {
    const res = await hook('/hooks/email/inbound', answer(), 'not-the-secret');
    expect(res.statusCode).toBe(404);
    expect(await counts()).toEqual({ inbound: 0, consent: 0, signals: 0 });
  });

  it('SOMEONE ELSE answering her mail — a colleague, a forward — records nothing in his name', async () => {
    const res = await hook('/hooks/email/inbound', answer({ from: addr('colleague') }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'not_the_recipient' });
    expect(await counts()).toEqual({ inbound: 0, consent: 0, signals: 0 });
  });

  it('a reply to a mail this product never sent is acknowledged and ignored', async () => {
    const res = await hook('/hooks/email/inbound', answer({ references: '<somebody-elses@mail.test>' }));
    expect(res.json()).toMatchObject({ outcome: 'unknown_thread' });
    expect(await counts()).toEqual({ inbound: 0, consent: 0, signals: 0 });
  });

  it('HE ANSWERS: his words on the thread, consent from his own reply, and a person is told', async () => {
    const res = await hook('/hooks/email/inbound', answer());
    expect(res.json()).toMatchObject({ outcome: 'recorded' });
    expect(await counts()).toEqual({ inbound: 1, consent: 1, signals: 1 });

    const conv = await tx((x) => sql<{ assigned_to: string | null }>`
      select assigned_to from conversations where id = ${conversationId}::uuid`.execute(x).then((r) => r.rows[0]!));
    expect(conv.assigned_to, 'his answer did not reach a person').toBe('unclaimed');

    const page = await get(`/app/inbox/${conversationId}`);
    expect(page.body).toContain(esc('Yes — send prices for 5,000.'));
    expect(page.body).toContain(esc(t('en', 'takeover.reason.email_reply')));
    expect((await get('/app/contacts')).body).toContain(esc(t('en', 'contacts.evidence.replied_to_email')));
  });

  it('the provider delivering it again changes nothing', async () => {
    const res = await hook('/hooks/email/inbound', answer());
    expect(res.json()).toMatchObject({ outcome: 'duplicate' });
    expect(await counts()).toEqual({ inbound: 1, consent: 1, signals: 1 });
  });

  it('HIS ANSWER STOPS THE FOLLOW-UPS', async () => {
    await sweep(new Date(T0.getTime() + 3 * DAY));
    const e = await tx((x) => sql<{ stop_reason: string | null }>`
      select stop_reason from sequence_enrollments where business_id = ${BIZ} and identity = ${addr('ahmed')}`
      .execute(x).then((r) => r.rows[0]!));
    expect(e.stop_reason).toBe('replied');
    await new Promise((r) => setTimeout(r, 1500));
    expect(transport.sent.filter((m) => m.to === addr('ahmed'))).toHaveLength(1);
  }, 60_000);

  it('SHE ANSWERS HIM: "Re:" his subject, threaded under his mail, through the one send path', async () => {
    expect((await post(`/app/inbox/${conversationId}/takeover`, {})).statusCode).toBe(302);
    const res = await post(`/app/inbox/${conversationId}/reply`, { text: 'Prices attached — 5,000 at $0.92.' });
    expect(res.statusCode).toBe(302);
    expect(flashOf(res)).not.toBe(t('en', 'inbox.blocked.not_connected'));
    await until(() => transport.sent.filter((m) => m.to === addr('ahmed')).length === 2, 'her answer to go');
    const mine = transport.sent.filter((m) => m.to === addr('ahmed'))[1]!;
    expect(mine.subject).toBe('Re: Canvas totes from Yiwu');
    expect(mine.text).toBe('Prices attached — 5,000 at $0.92.');
    expect(mine.headers['In-Reply-To']).toBe(`<${HIS_ID}>`);
  }, 60_000);

  it('THE TAG EVERY MAIL CARRIES is the one a bounce event echoes — and it suppresses the right address', async () => {
    const tag = transport.sent.find((m) => m.to === addr('ahmed'))!.tag;
    expect(tag, 'the provider was never handed the signed tag').toBeTruthy();
    const res = await hook('/hooks/email', { events: [{ type: 'bounce', permanent: true, tag, detail: '550' }] });
    expect(res.statusCode).toBe(200);
    const s = await tx((x) => sql<{ reason: string }>`
      select reason from suppressions where business_id = ${BIZ} and channel = 'email' and identity = ${addr('ahmed')}`
      .execute(x).then((r) => r.rows[0]));
    expect(s?.reason).toBe('bounced');
  });
});
