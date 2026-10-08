import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import pg from 'pg';
import { FLASH_COOKIE } from '../../src/api/web/flash.js';
import { offlineModels } from '../pipeline/fakes.js';
import { signUpWithCode, type Outbox, PASSING_BOT_CHECK } from './signUpWithCode.js';

/** The same derivation main.ts makes, so a notice this app minted can be read. */
const WEB_SECRET = createHmac('sha256', 'a'.repeat(64)).update('yf-web-session').digest('hex');

/**
 * PHASE 5 OF THE UI REBUILD (2026-10-02), through the real production
 * composition and real Postgres:
 *
 *   UNDO OVER CONFIRM — a forbidden word, a closure, a business-wide fact and
 *   an owner's date go at once; the page the owner lands on carries Undo, and
 *   Undo brings each back. A word added again since is not doubled.
 *
 *   THE ASSISTANT AT WORK — a customer's message no turn has taken yet, in a
 *   conversation the assistant holds: the page says so where the reply will
 *   be, its live answer says `working`, and neither does once a person holds
 *   it or the message has been answered.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const PILOT = `c0de0000-0000-4000-8000-${RUN}0005`;
const ABOUT = { kind: 'retail', sells: 'Ceramic tiles', website: '', teamSize: '2-5', terms: 'on', age: '34' };

d('phase 5 · undo over confirm, and the assistant at work (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  const outbox: Outbox = [];
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  let admin: pg.Client;
  let cookie = '';
  let bid = '';

  const visitor = `198.51.100.${(RUN.charCodeAt(2) % 200) + 20}`;
  const form = (url: string, fields: Record<string, string>, c = '') => prod.app.inject({
    method: 'POST', url,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': visitor, ...(c ? { cookie: c } : {}) },
    payload: new URLSearchParams(fields).toString(),
  });
  const cookieOf = (r: { headers: Record<string, unknown> }, name: string) =>
    ([] as string[]).concat(r.headers['set-cookie'] as string | string[] ?? [])
      .map((c) => c.split(';')[0]!).find((c) => c.startsWith(`${name}=`) && c !== `${name}=`) ?? '';
  /** Where an action lands, drawn with the notice it left — as the browser follows the redirect. */
  const landing = async (r: { statusCode: number; headers: Record<string, unknown> }) => {
    expect(r.statusCode).toBe(302);
    const flash = cookieOf(r, FLASH_COOKIE);
    return prod.app.inject({ method: 'GET', url: String(r.headers['location']), headers: { cookie: `${cookie}; ${flash}` } });
  };
  const one = async <T>(q: string, args: unknown[]): Promise<T> => (await admin.query(q, args)).rows[0] as T;
  const UNDO = (action: string) => `<form method="post" action="${action}" class="undo">`;

  const A = { ...ABOUT, factory: `Tile House ${RUN}`, name: 'Noor', email: `noor-${RUN}@tiles.example`, password: `tiles-password-${RUN}`, country: 'AE', invite: '' };

  beforeAll(async () => {
    process.env['PILOT_BUSINESS_ID'] = PILOT;
    process.env['OWNER_ACCESS_CODE'] = `phase5-${RUN}`;
    process.env['SIGNUP_MODE'] = 'open';
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    await admin.query(`insert into businesses (id, name) values ($1, $2) on conflict (id) do nothing`, [PILOT, `Pilot ${RUN}`]);
    const { buildProduction } = await import('../../src/main.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    prod = await buildProduction({
      provider: 'disabled', DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'p5-verify-token-0001',
      CREDENTIAL_KEY: 'a'.repeat(64), PORT: 0, PUBLIC_BASE_URL: 'https://nomi.test',
    }, { models: offlineModels(), logger: false, botCheck: PASSING_BOT_CHECK, signupGuard: null, systemMail: { from: 'no-reply@nomi.test', send: async (m) => { outbox.push(m); return { ok: true }; } } });
    const made = await signUpWithCode(form, outbox, A);
    expect(made.statusCode, made.body.slice(0, 300)).toBe(302);
    cookie = cookieOf(made, 'yf_session');
    bid = (await one<{ id: string }>(`select id::text as id from businesses where name = $1`, [A.factory])).id;
  }, 90_000);

  afterAll(async () => {
    delete process.env['SIGNUP_MODE'];
    await admin?.end();
    await prod?.close();
  });

  it('A FORBIDDEN WORD: removed at once, Undo on the page it lands on, and back', async () => {
    await form('/app/settings/forbidden', { term: 'cheapest', note: '' }, cookie);
    const { id } = await one<{ id: string }>(`select id::text as id from forbidden_terms where business_id = $1 and term = 'cheapest'`, [bid]);
    const page = await landing(await form(`/app/settings/forbidden/${id}/remove`, {}, cookie));
    expect(page.body).toContain(t('en', 'forbidden.flash.removed'));
    expect(page.body).toContain(UNDO(`/app/settings/forbidden/${id}/restore`));
    expect((await one<{ gone: boolean }>(`select archived_at is not null as gone from forbidden_terms where id = $1`, [id])).gone).toBe(true);
    const back = await landing(await form(`/app/settings/forbidden/${id}/restore`, {}, cookie));
    expect(back.body).toContain(t('en', 'forbidden.flash.restored'));
    expect((await one<{ gone: boolean }>(`select archived_at is not null as gone from forbidden_terms where id = $1`, [id])).gone).toBe(false);
  });

  it('…and a word added again in the meantime is not doubled: Undo says it could not', async () => {
    const { id } = await one<{ id: string }>(`select id::text as id from forbidden_terms where business_id = $1 and term = 'cheapest' and archived_at is null`, [bid]);
    await form(`/app/settings/forbidden/${id}/remove`, {}, cookie);
    await form('/app/settings/forbidden', { term: 'Cheapest', note: '' }, cookie);
    const back = await landing(await form(`/app/settings/forbidden/${id}/restore`, {}, cookie));
    expect(back.body).toContain(t('en', 'forbidden.flash.failed'));
    expect((await one<{ n: number }>(`select count(*)::int as n from forbidden_terms where business_id = $1 and lower(term) = 'cheapest' and archived_at is null`, [bid])).n).toBe(1);
  });

  it('A CLOSURE: removed at once, and Undo puts it back', async () => {
    await form('/app/settings/closures', { label: 'Eid', from: '2026-12-01', to: '2026-12-04' }, cookie);
    const { id } = await one<{ id: string }>(`select id::text as id from factory_closures where business_id = $1 and label = 'Eid'`, [bid]);
    const page = await landing(await form(`/app/settings/closures/${id}/remove`, {}, cookie));
    expect(page.body).toContain(UNDO(`/app/settings/closures/${id}/restore`));
    const back = await landing(await form(`/app/settings/closures/${id}/restore`, {}, cookie));
    expect(back.body).toContain(t('en', 'closures.flash.restored'));
    expect((await one<{ live: boolean }>(`select archived_at is null as live from factory_closures where id = $1`, [id])).live).toBe(true);
  });

  it('A BUSINESS-WIDE FACT: archived at once on Knowledge, which now says so, with Undo — and back in use', async () => {
    await form('/app/knowledge/teach', { kind: 'faq', label: 'Delivery', content: 'We deliver across the UAE in three days.' }, cookie);
    const { id } = await one<{ id: string }>(`select id::text as id from product_knowledge where business_id = $1 and label = 'Delivery'`, [bid]);
    const page = await landing(await form('/app/knowledge/archive', { id, productId: '' }, cookie));
    expect(page.body).toContain(t('en', 'knowledge.flash.archived'));
    expect(page.body).toContain(UNDO(`/app/knowledge/${id}/restore`));
    const back = await landing(await form(`/app/knowledge/${id}/restore`, {}, cookie));
    expect(back.body).toContain(t('en', 'knowledge.flash.restored'));
    expect((await one<{ status: string }>(`select status from product_knowledge where id = $1`, [id])).status).toBe('active');
  });

  it('AN OWNER\'S DATE: taken off the calendar at once, and Undo puts it back', async () => {
    const { id } = await one<{ id: string }>(
      `insert into calendar_entries (business_id, title, starts_at, all_day) values ($1, 'Kiln service', now() + interval '2 days', true) returning id::text as id`, [bid]);
    const page = await landing(await form(`/app/calendar/entries/${id}/remove`, {}, cookie));
    expect(page.body).toContain(UNDO(`/app/calendar/entries/${id}/restore`));
    const back = await landing(await form(`/app/calendar/entries/${id}/restore`, {}, cookie));
    expect(back.body).toContain(t('en', 'calendar.flash.restored'));
    expect((await one<{ live: boolean }>(`select removed_at is null as live from calendar_entries where id = $1`, [id])).live).toBe(true);
  });

  it('THE ASSISTANT AT WORK: said where the reply will be, and in the live answer; gone once a person holds it, or it is answered', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(bid); if (!b.ok) throw new Error('fixture');
    const c = await withTenantTx(prod.db, b.value, (tx) => ensureConversation(tx, b.value, `+9715${RUN.replace(/\D/g, '').padEnd(8, '7').slice(0, 8)}`, 'Huda'));
    const cid = c.conversationId as string;
    const fid = `wamid.p5.${RUN}`;
    await admin.query(`insert into message_fragments (id, business_id, conversation_id, text) values ($1, $2, $3, 'Do you have 60x60 in grey?')`, [fid, bid, cid]);
    const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie, accept: 'application/json' } });

    const pageNow = (await prod.app.inject({ method: 'GET', url: `/app/inbox/${cid}`, headers: { cookie } })).body;
    expect(pageNow).toContain('class="block working" role="status"');
    expect(pageNow).toContain('data-live-working="1"');
    expect(pageNow).not.toContain(t('en', 'inbox.draft.none'));
    const mark = /data-live="\/app\/live\/conversation\/[^?]+\?since=([^"]+)"/.exec(pageNow)?.[1] ?? '';
    expect((await get(`/app/live/conversation/${cid}?since=${mark}`)).json()).toMatchObject({ news: false, working: true });

    // A person takes it: the assistant is not answering, so nothing says it is.
    await admin.query(`update conversations set assigned_to = 'owner' where id = $1`, [cid]);
    expect((await get(`/app/live/conversation/${cid}?since=${mark}`)).json()).not.toHaveProperty('working');
    expect((await prod.app.inject({ method: 'GET', url: `/app/inbox/${cid}`, headers: { cookie } })).body).not.toContain('class="block working"');

    // Back with the assistant, and the message taken by a turn: no longer at work.
    await admin.query(`update conversations set assigned_to = null where id = $1`, [cid]);
    expect((await get(`/app/live/conversation/${cid}?since=${mark}`)).json()).toMatchObject({ working: true });
    await admin.query(`update message_fragments set received_at = now() - interval '16 minutes' where id = $1`, [fid]);
    expect((await get(`/app/live/conversation/${cid}?since=${mark}`)).json()).not.toHaveProperty('working');   // fifteen minutes and no turn: not "writing"
    expect((await prod.app.inject({ method: 'GET', url: `/app/inbox/${cid}`, headers: { cookie } })).body).toContain(t('en', 'inbox.draft.none'));

    // A message still in the queue — before the worker records it, or a voice note, which never becomes a
    // fragment — is the assistant at work too. Held back an hour so no worker takes it during the test.
    const { QUEUES } = await import('../../src/queue/boss.js');
    const job = await prod.boss.send(QUEUES.inbound, { businessId: bid, conversationId: cid, messageId: `wamid.p5q.${RUN}`, text: '', messageType: 'audio' },
      { singletonKey: cid, startAfter: 3600 });
    expect(job).toBeTruthy();
    expect((await get(`/app/live/conversation/${cid}?since=${mark}`)).json()).toMatchObject({ working: true });
    await prod.boss.cancel(QUEUES.inbound, job!);
    expect((await get(`/app/live/conversation/${cid}?since=${mark}`)).json()).not.toHaveProperty('working');
  });

  it('the fix wave (w4-conversation-20) · a line somebody already answered is not "being written": the owner replied, or it was handed to a person', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { ensureConversation } = await import('../../src/db/channels.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(bid); if (!b.ok) throw new Error('fixture');
    const c = await withTenantTx(prod.db, b.value, (tx) => ensureConversation(tx, b.value, `+9716${RUN.replace(/\D/g, '').padEnd(8, '3').slice(0, 8)}`, 'Rana'));
    const cid = c.conversationId as string;
    const get = (url: string) => prod.app.inject({ method: 'GET', url, headers: { cookie, accept: 'application/json' } });
    const page = async () => (await prod.app.inject({ method: 'GET', url: `/app/inbox/${cid}`, headers: { cookie } })).body;
    const working = async () => (await get(`/app/live/conversation/${cid}?since=0.0.00000000`)).json() as { working?: boolean };

    // A line no turn took (its turn failed), two minutes old: the assistant still holds it.
    await admin.query(`insert into message_fragments (id, business_id, conversation_id, text, received_at)
                       values ($1, $2, $3, 'Do you make them in 500 pieces?', now() - interval '2 minutes')`, [`wamid.w5.${RUN}`, bid, cid]);
    expect(await working()).toMatchObject({ working: true });
    // The owner answered it (took it, replied, handed it back): nothing is being written.
    await admin.query(`insert into outbound_messages (business_id, conversation_id, seq, body, origin, status, sent_at)
                       values ($1, $2, 1, 'Yes, we make them. 500 pieces is fine.', 'owner', 'sent', now() - interval '1 minute')`, [bid, cid]);
    expect(await working()).not.toHaveProperty('working');
    expect(await page()).not.toContain('class="block working"');
    // A reply that never reached them answers nothing.
    await admin.query(`update outbound_messages set status = 'failed' where conversation_id = $1`, [cid]);
    expect(await working()).toMatchObject({ working: true });
    // Handed to a person after it (the failed turn's own hand-over): not being written either.
    await admin.query(`insert into conversation_events (business_id, conversation_id, type, payload) values ($1, $2, 'handoff', '{"reason":"not_answered"}')`, [bid, cid]);
    expect(await working()).not.toHaveProperty('working');
    // A new line after all that is the assistant at work again.
    await admin.query(`insert into message_fragments (id, business_id, conversation_id, text) values ($1, $2, $3, 'And with our logo?')`, [`wamid.w5b.${RUN}`, bid, cid]);
    expect(await working()).toMatchObject({ working: true });
  });
});
