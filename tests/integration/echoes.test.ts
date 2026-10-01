import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID, createHmac } from 'node:crypto';
import { runDigits } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { Analysis } from '../../src/core/conversation/decide.js';

/**
 * CH3 — A REPLY THE OWNER TYPED IN MESSENGER'S OWN APP, over the real
 * composition: a signed webhook carrying Meta's echo → the echo queue → the
 * transcript, the drafts, the conversation's owner.
 *
 *   · Recorded as the owner's on the transcript; the reply waiting for
 *     approval is superseded; the conversation is the owner's, so the
 *     assistant says nothing more.
 *   · Nomi's own echoes (its app, or an id its send recorded) change nothing.
 *   · Meta's retry of the same echo is one message.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const BIZ = `dd9a0000-0000-4000-8000-${RUN}0001`;
const CREDENTIAL_KEY = 'c'.repeat(64);
const APP_SECRET = `meta-app-secret-${RUN}`;
const PAGE_ID = `1030${runDigits(RUN, 10)}`;
const IG_ACCOUNT = `1785${runDigits(RUN, 10)}`;
/** Meta's own inbox (Business Suite) sends with an app id that is not ours. */
const META_INBOX_APP = '263902037430900';
const OUR_APP = `9${runDigits(RUN, 14)}`;
const customer = (who: string) => `PSID_${who}_${RUN}`;

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 60_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
};

d('CH3 · echoes (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let cookie = '';
  let ownerId = '';
  const analyzer = new FakeAnalyzer();
  const replyWriter = new FakeReplyWriter();
  const metaFetch: import('../../src/channels/meta/messaging.js').MetaFetch = async () =>
    ({ status: 400, text: async () => JSON.stringify({ error: { message: 'not a real token' } }) });

  const tx = async <R>(fn: (x: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(BIZ); if (!b.ok) throw new Error('fixture');
    return withTenantTx(prod.db, b.value, fn);
  };
  const signed = (body: string) => prod.app.inject({
    method: 'POST', url: '/webhook/messenger', payload: body,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex')}` },
  });
  const message = (o: { from: string; to: string; text: string; mid?: string; echo?: { appId: string } }) => JSON.stringify({
    object: 'page',
    entry: [{ id: PAGE_ID, time: Date.now(), messaging: [{
      sender: { id: o.from }, recipient: { id: o.to }, timestamp: Date.now(),
      message: { mid: o.mid ?? `mid.${randomUUID()}`, text: o.text,
        ...(o.echo ? { is_echo: true, app_id: Number(o.echo.appId) } : {}) },
    }] }],
  });
  const conversationOf = (who: string) => tx((x) => sql<{ id: string; assigned_to: string | null }>`
    select c.id::text as id, c.assigned_to from conversations c
      join client_channels cc on cc.client_id = c.client_id and cc.channel = 'messenger'
     where c.business_id = ${BIZ}::uuid and cc.channel_user_id = ${customer(who)}`.execute(x).then((r) => r.rows[0]));
  const drafts = (conv: string) => tx((x) => sql<{ status: string; decided_by: string | null }>`
    select status, decided_by from drafts where conversation_id = ${conv}::uuid order by created_at`.execute(x).then((r) => r.rows));
  const echoRows = (conv: string) => tx((x) => sql<{ text: string | null; direction: string }>`
    select text_content as text, direction from messages where conversation_id = ${conv}::uuid and external_id like 'echo:%'`.execute(x).then((r) => r.rows));

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = BIZ;
    process.env['OWNER_ACCESS_CODE'] = `echo-${RUN}`;
    process.env['META_PAGE_ACCESS_TOKEN'] = 'page-token-not-real';
    process.env['META_PAGE_ID'] = PAGE_ID;
    process.env['META_IG_ACCOUNT_ID'] = IG_ACCOUNT;
    process.env['META_SOCIAL_APP_ID'] = OUR_APP;
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: `SIM_PNID_ec${RUN}`,
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: APP_SECRET,
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'ec-verify-token', CREDENTIAL_KEY, PORT: 0,
    }, { models: { analyzer, replyWriter }, adapter: whatsappSimulator([], { tag: `ec${RUN}` }).adapter, logger: false, metaFetch, echoSettleSeconds: 0 });
    ownerId = await tx(async (x) => {
      await sql`insert into businesses (id, name) values (${BIZ}, 'Echo Boutique') on conflict (id) do nothing`.execute(x);
      await sql`update businesses set batch_debounce_ms = 300, batch_max_window_ms = 10000 where id = ${BIZ}`.execute(x);
      return (await sql<{ id: string }>`insert into people (business_id, name, is_owner) values (${BIZ}, 'Rana', true) returning id::text as id`.execute(x)).rows[0]!.id;
    });
    const login = await prod.app.inject({ method: 'POST', url: '/login', payload: `code=${encodeURIComponent(prod.ownerAccessCode)}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    expect((await prod.app.inject({ method: 'POST', url: '/app/channels/messenger/connect', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: '' })).statusCode).toBe(302);
  }, 90_000);
  afterAll(async () => {
    for (const k of ['META_PAGE_ACCESS_TOKEN', 'META_PAGE_ID', 'META_IG_ACCOUNT_ID', 'META_SOCIAL_APP_ID']) delete process.env[k];
    await prod?.close();
  });

  it('THE OWNER ANSWERED IN MESSENGER: recorded as theirs, the waiting reply superseded, the conversation theirs — and the assistant says nothing more', async () => {
    analyzer.next = {
      language: { detected: 'en', replyIn: 'en' },
      intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
      recommendedPhase: 'clarification', wantsPerson: false,
    } satisfies Analysis;
    replyWriter.replies = ['We ship to Dubai in 3 days.'];
    expect((await signed(message({ from: customer('noor'), to: PAGE_ID, text: 'Do you ship to Dubai?' }))).statusCode).toBe(200);
    const conv = await until(async () => {
      const c = await conversationOf('noor');
      return c && (await drafts(c.id)).some((x) => x.status === 'pending') ? c : undefined;
    }, 'the waiting reply');

    // The owner answers from Messenger's own inbox: Meta echoes it with its own app's id.
    const typed = message({ from: PAGE_ID, to: customer('noor'), text: 'Yes! Free shipping to Dubai this week.', echo: { appId: META_INBOX_APP } });
    expect(JSON.parse((await signed(typed)).body)).toMatchObject({ received: 1 });
    await until(async () => ((await echoRows(conv.id)).length > 0 ? true : undefined), 'the echo on the transcript');
    expect(await echoRows(conv.id)).toEqual([{ text: 'Yes! Free shipping to Dubai this week.', direction: 'outbound' }]);
    expect(await drafts(conv.id)).toEqual([{ status: 'superseded', decided_by: null }]);
    expect((await conversationOf('noor'))?.assigned_to).toBe(ownerId);
    const event = await tx((x) => sql<{ payload: Record<string, unknown> }>`
      select payload from conversation_events where conversation_id = ${conv.id}::uuid and type = 'owner_replied_elsewhere'`
      .execute(x).then((r) => r.rows[0]?.payload));
    expect(event).toEqual({ channel: 'messenger', superseded: 1, canceled: 0 });
    // The transcript says it was the owner, never the assistant.
    const page = await prod.app.inject({ method: 'GET', url: `/app/inbox/${conv.id}`, headers: { cookie } });
    expect(page.body).toContain('Yes! Free shipping to Dubai this week.');
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { esc } = await import('../../src/api/web/layout.js');
    expect(page.body).toContain(esc(t('en', 'conv.by.you')));

    // Meta delivers the same echo again: still one message.
    expect(JSON.parse((await signed(typed)).body)).toMatchObject({ received: 0 });
    // The customer writes again: the conversation is the owner's, so no reply is drafted.
    const before = replyWriter.calls;
    expect((await signed(message({ from: customer('noor'), to: PAGE_ID, text: 'Great, thanks!' }))).statusCode).toBe(200);
    await until(async () => (await tx((x) => sql<{ n: number }>`select count(*)::int as n from messages
      where conversation_id = ${conv.id}::uuid and direction = 'inbound'`.execute(x).then((r) => r.rows[0]!.n))) >= 2 ? true : undefined, 'the second message');
    await new Promise((r) => setTimeout(r, 1500));
    expect(replyWriter.calls).toBe(before);
    expect((await drafts(conv.id)).filter((x) => x.status === 'pending')).toEqual([]);
  }, 120_000);

  it('NOMI\'S OWN ECHOES CHANGE NOTHING: from its own app, or an id its send recorded', async () => {
    const { handleEcho } = await import('../../src/pipeline/echo.js');
    replyWriter.replies = ['Yes, it comes in green.'];
    expect((await signed(message({ from: customer('lina'), to: PAGE_ID, text: 'Does it come in green?' }))).statusCode).toBe(200);
    const conv = await until(async () => {
      const c = await conversationOf('lina');
      return c && (await drafts(c.id)).some((x) => x.status === 'pending') ? c : undefined;
    }, 'the waiting reply');
    const job = (mid: string, appId: string | null) => ({
      businessId: BIZ, channel: 'messenger' as const, mid, customer: customer('lina'), account: PAGE_ID,
      text: 'Yes, it comes in green.', received: 'text', appId, occurredAt: new Date().toISOString(),
    });
    // From Nomi's own Meta app.
    expect(await handleEcho(prod.db, job(`mid.${randomUUID()}`, OUR_APP), [OUR_APP])).toBe('ours');
    // From no app Nomi knows, but its id is one a send of ours recorded.
    const mine = `mid.${randomUUID()}`;
    await tx((x) => sql`insert into outbound_messages (business_id, conversation_id, seq, channel, body, status, origin, provider_message_id)
                        values (${BIZ}, ${conv.id}::uuid, 900, 'messenger', 'Yes, it comes in green.', 'sent', 'employee', ${mine})`.execute(x));
    expect(await handleEcho(prod.db, job(mine, null), [OUR_APP])).toBe('ours');
    expect(await echoRows(conv.id)).toEqual([]);
    expect((await drafts(conv.id)).map((x) => x.status)).toEqual(['pending']);
    expect((await conversationOf('lina'))?.assigned_to).toBeNull();
    // The control: the same job from Meta's inbox is the owner's.
    expect(await handleEcho(prod.db, job(`mid.${randomUUID()}`, META_INBOX_APP), [OUR_APP])).toBe('recorded');
    expect((await drafts(conv.id)).map((x) => x.status)).toEqual(['superseded']);
  }, 120_000);
});
