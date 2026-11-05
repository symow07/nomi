import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import Fastify from 'fastify';
import { createDb, createReadOnlyDb, type Db } from '../../src/db/client.js';
import { asViewer } from '../../src/db/viewer.js';
import { readConversationContext, type ReadCtx } from '../../src/advisor/reads.js';
import { conversationAdvisorRoutes, type CopilotPanelView } from '../../src/api/web/conversationAdvisor.js';
import { advisorMemory } from '../../src/advisor/memory.js';
import { advisorKeysFrom } from '../../src/advisor/seal.js';
import type { AdvisorSpent } from '../../src/advisor/answer.js';
import type { BusinessId } from '../../src/core/types/ids.js';

const APP = process.env['DATABASE_URL']; const ADMIN = process.env['MIGRATE_DATABASE_URL'];
const suite = APP && ADMIN ? describe : describe.skip;
const B = randomUUID(); const OTHER = randomUUID(); const C = randomUUID(); const OCLIENT = randomUUID();
const CHAT = randomUUID(); const OTHER_CHAT = randomUUID(); const SAME_CUSTOMER_CHAT = randomUUID(); const TEST_CHAT = randomUUID();
const PRODUCT = randomUUID(); const POLICY = randomUUID(); const DRAFT = randomUUID(); const PERSON = randomUUID(); const PEER = randomUUID(); const ACCOUNTANT = randomUUID();

suite('contextual Advisor: tenant records, read-only replies, metering and consent', () => {
  let admin: pg.Client; let ro: Db; let writes: Db; let app: ReturnType<typeof Fastify>;
  let memory: ReturnType<typeof advisorMemory>; let calls = 0; let held: boolean | 'error' = false;
  const spends: AdvisorSpent[] = [];
  const ctx = (): ReadCtx => ({ db: ro, businessId: B as BusinessId, viewerId: PERSON, locale: 'en', now: new Date(), params: { period: null, product: null, customer: null, reference: null } });
  const read = () => readConversationContext(ctx(), CHAT);
  const request = (method: 'GET' | 'POST', suffix = '', payload?: Record<string, unknown>) => app.inject({ method, url: `/app/inbox/${CHAT}/copilot${suffix}`, ...(payload ? { payload } : {}) });
  const panel = async (payload?: Record<string, unknown>): Promise<CopilotPanelView> => JSON.parse((await request(payload ? 'POST' : 'GET', '?fragment=1', payload)).body) as CopilotPanelView;
  const use = (revision: string) => app.inject({ method: 'POST', url: `/app/inbox/${CHAT}/copilot/reply`, headers: { accept: 'application/json' }, payload: { q: 'Offer 5% off', revision, text: 'FORGED REPLY' } });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: ADMIN }); await admin.connect();
    await admin.query(`insert into businesses(id,name,currency,owner_locale) values ($1,'Copilot fixture','USD','en'),($2,'Other shop','USD','en')`, [B, OTHER]);
    await admin.query(`insert into people(id,business_id,name,is_owner,kind) values ($1,$4,'Owner',true,'team'),($2,$4,'Peer',false,'team'),($3,$4,'Accountant',false,'accountant')`, [PERSON, PEER, ACCOUNTANT, B]);
    await admin.query(`insert into clients(id,business_id,display_name) values ($1,$3,'Same name'),($2,$4,'Same name')`, [C, OCLIENT, B, OTHER]);
    await admin.query(`insert into conversations(id,business_id,client_id,channel,owner_testing) values ($1,$5,$7,'whatsapp',false),($2,$6,$8,'whatsapp',false),($3,$5,$7,'whatsapp',false),($4,$5,$7,'whatsapp',true)`,
      [CHAT, OTHER_CHAT, SAME_CUSTOMER_CHAT, TEST_CHAT, B, OTHER, C, OCLIENT]);
    await admin.query(`insert into products(id,business_id,sku,name,unit,moq,is_active) values ($1,$2,'COP20','Canvas 20','pieces',10,true)`, [PRODUCT, B]);
    await admin.query(`insert into price_tiers(product_id,min_qty,unit_price_usd,currency) values ($1,10,10,'USD')`, [PRODUCT]);
    await admin.query(`insert into pricing_policy(id,business_id,product_id,floor_price_usd,currency,max_discount_pct,human_required_above_pct) values ($1,$2,$3,9,'USD',10,8)`, [POLICY, B, PRODUCT]);
    await admin.query(`insert into conversation_state(conversation_id,identified_product_id,inquiry_quantity) values ($1,$2,100) on conflict (conversation_id) do update set identified_product_id=excluded.identified_product_id,inquiry_quantity=excluded.inquiry_quantity`, [CHAT, PRODUCT]);
    await admin.query(`insert into drafts(id,business_id,conversation_id,capability,draft_text,status) values ($1,$2,$3,'quote','Original draft','pending')`, [DRAFT, B, CHAT]);
    await admin.query(`insert into messages(conversation_id,direction,input_type,text_content,sent_at) select $1,'inbound','text','Customer message ' || n, now()-make_interval(mins=>60-n) from generate_series(1,55) n`, [CHAT]);
    await admin.query(`insert into messages(conversation_id,direction,input_type,text_content) values ($1,'inbound','text','OTHER TENANT SECRET')`, [OTHER_CHAT]);
    await admin.query(`insert into orders(order_reference,business_id,client_id,conversation_id,product_id,quantity,unit,agreed_unit_price_usd,total_value_usd,currency,status,created_at)
      values ($1,$3,$4,$5,$7,100,'pieces',10,1000,'USD','confirmed',now()-interval '2 days'),($2,$3,$4,$6,$7,200,'pieces',9,1800,'USD','confirmed',now()-interval '1 day')`,
      [`OLD-${B.slice(0,8)}`, `LATEST-${B.slice(0,8)}`, B, C, CHAT, SAME_CUSTOMER_CHAT, PRODUCT]);
    ro = createReadOnlyDb(APP!); writes = createDb(APP!); memory = advisorMemory(writes, advisorKeysFrom({ ADVISOR_KEY: 'ac'.repeat(32) }));
    app = Fastify();
    conversationAdvisorRoutes(app, {
      viewer: (req) => req.headers['x-signed-out'] ? null : { businessId: B, viewerId: PERSON }, locale: () => 'en', page: (_req, o) => o.bodyHtml,
      db: ro, model: { recognise: async () => { calls++; return { pick: { id: 'draft_reply', product: 'forged', customer: OCLIENT, period: null, reference: null }, usage: { inputTokens: 25, outputTokens: 4 } }; }, phrase: async () => { throw new Error('customer text must never come from phrase'); } },
      allowanceUsed: async () => { if (held === 'error') throw new Error('unreadable allowance'); return held; }, spent: async (_bid, used) => { spends.push(used); },
      memory, processor: () => 'Scripted provider', provider: { name: 'scripted', model: 'fixture' }, flashTo: (r, p) => r.redirect(p), takeFlash: () => null,
      renderCopilotPanel: (_locale, v) => JSON.stringify(v),
    });
    await app.ready();
  }, 90_000);
  afterAll(async () => { await app?.close(); await ro?.destroy(); await writes?.destroy(); await admin?.end(); });

  it('server-resolves exact tenant chat/customer, excludes tests, and RLS refuses accountants', async () => {
    const c = (await read())!;
    expect(c.customerId).toBe(C); expect(c.messages).toHaveLength(50); expect(c.earlier).toBe(true);
    expect(c.messages[0]!.text).toBe('Customer message 6'); expect(JSON.stringify(c)).not.toContain('OTHER TENANT SECRET');
    expect(await readConversationContext(ctx(), OTHER_CHAT)).toBeNull();
    expect(await readConversationContext(ctx(), TEST_CHAT)).toBeNull();
    expect(await readConversationContext(ctx(), 'invalid')).toBeNull();
    expect(await asViewer(ACCOUNTANT, read)).toBeNull();
  });
  it('latest order belongs to this customer across chats, not a name lookup or current-chat-only result', async () => {
    const v = await panel({ q: 'Last order', intent: 'last_order', customerId: OCLIENT });
    expect(v.answer?.facts.find((f) => f.id === 'order')?.value).toBe(`LATEST-${B.slice(0,8)}`);
    expect(v.customerId).toBe(C);
  });
  it('open makes no model call, signed-out redirects, foreign conversation is not found', async () => {
    const before = calls; const v = await panel(); expect(v.answer).toBeNull(); expect(v.allowance).toBe('available'); expect(calls).toBe(before);
    expect((await app.inject({ url: `/app/inbox/${CHAT}/copilot`, headers: { 'x-signed-out': 'yes' } })).statusCode).toBe(302);
    expect((await app.inject({ method: 'POST', url: `/app/inbox/${OTHER_CHAT}/copilot`, payload: { q: 'Offer 5% off' } })).statusCode).toBe(404);
    expect(calls).toBe(before);
  });
  it.each([true, 'error'] as const)('used or unreadable allowance denies explicit and freeform questions (%s)', async (h) => {
    held = h; const before = calls; const n = spends.length;
    for (const intent of [undefined, 'draft_reply']) { const v = await panel({ q: 'Offer 5% off', intent }); expect(v.answer?.kind).toBe('failed'); expect(v.answer?.reply).toBeNull(); }
    expect(calls).toBe(before); expect(spends).toHaveLength(n); held = false;
  });
  it('only completed recognition usage is recorded, and no-consent history stores nothing', async () => {
    const before = calls; const n = spends.length;
    const v = await panel({ q: 'Offer 5% off', thread: 'someone-elses-thread' });
    expect(v.answer?.reply?.text).toContain('$950.00'); expect(calls - before).toBe(1);
    expect(spends.slice(n)).toEqual([{ llmCalls: 1, inputTokens: 25, outputTokens: 4, cachedInputTokens: 0 }]);
    expect((await admin.query(`select count(*)::int as n from advisor_turns where business_id=$1`, [B])).rows[0].n).toBe(0);
  });
  it('Use recomputes text without model calls or changes to order, draft, ownership or outbound queue', async () => {
    const snapshot = async () => (await admin.query(`select to_jsonb(c) as conversation, (select jsonb_agg(to_jsonb(d)) from drafts d where d.conversation_id=c.id) as drafts,
      (select jsonb_agg(to_jsonb(o)) from orders o where o.client_id=c.client_id) as orders,
      (select count(*)::int from outbound_messages x where x.conversation_id=c.id) as outbound from conversations c where c.id=$1`, [CHAT])).rows[0];
    const before = await snapshot(); const n = calls; const c = (await read())!;
    const r = await use(c.revision); expect(r.statusCode).toBe(200); expect(r.json().text).toContain('$950.00'); expect(r.json().text).not.toContain('FORGED'); expect(r.json().draftId).toBe(DRAFT);
    expect(calls).toBe(n); expect(await snapshot()).toEqual(before);
  });
  it('keeping owner words does not invalidate independent price sources or replace those words', async () => {
    const before = (await read())!.revision;
    await admin.query(`update drafts set owner_edit='Owner still typing',owner_edit_at=now() where id=$1`, [DRAFT]);
    await admin.query(`update conversations set owner_unsent_reply='Unsent owner words',owner_unsent_reply_at=now() where id=$1`, [CHAT]);
    expect((await read())!.revision).toBe(before);
    expect((await use(before)).statusCode).toBe(200);
    expect((await admin.query(`select owner_edit from drafts where id=$1`, [DRAFT])).rows[0].owner_edit).toBe('Owner still typing');
  });
  it('same-count edits, ownership, draft replacement and rule changes all invalidate insertion', async () => {
    const changes: [string, unknown[]][] = [
      [`update messages set text_content='Changed latest request' where id=(select id from messages where conversation_id=$1 order by sent_at desc,id desc limit 1)`, [CHAT]],
      [`update conversations set assigned_to='owner' where id=$1`, [CHAT]],
      [`update drafts set draft_text='Different proposal' where id=$1`, [DRAFT]],
      [`update pricing_policy set floor_price_usd=9.2 where id=$1`, [POLICY]],
    ];
    for (const [query, params] of changes) {
      const before = (await read())!.revision; await admin.query(query, params);
      expect((await read())!.revision).not.toBe(before);
      const r = await use(before); expect(r.statusCode).toBe(409); expect(r.json()).toEqual({ ok: false, reason: 'stale' });
    }
  });
  it('fresh below-floor offer is refused, not silently clamped or inserted', async () => {
    await admin.query(`update pricing_policy set floor_price_usd=9.8 where id=$1`, [POLICY]);
    const c = (await read())!; const r = await use(c.revision); expect(r.statusCode).toBe(409); expect(r.json().reason).toBe('refused');
    await admin.query(`update pricing_policy set floor_price_usd=9 where id=$1`, [POLICY]);
  });
  it('consented turns are sealed, person-only, and linked to the exact customer for erasure', async () => {
    expect(await memory.workspace(B, PERSON, true)).toBe('ok');
    expect(await memory.consent(B, PERSON, 'granted', 'en')).toBe('ok');
    const v = await panel({ q: 'Offer 5% off', intent: 'draft_reply', thread: PEER });
    const thread = v.history.threadHref?.split('/').at(-1); expect(thread).toBeTruthy();
    expect(await memory.open(B, PEER, thread!)).toBeNull();
    const own = await memory.open(B, PERSON, thread!); expect(own && own !== 'unreadable' ? own.turns[0]?.params.reference : null).toBe(CHAT);
    expect(own && own !== 'unreadable' ? own.turns[0]?.lines.join('\n') : '').toContain('I can offer 5%');
    const rows = (await admin.query(`select s.client_id::text, t.question_ciphertext, t.answer_ciphertext from advisor_turns t join advisor_turn_subjects s on s.turn_id=t.id where t.thread_id=$1`, [thread])).rows;
    expect(rows).toHaveLength(1); expect(rows[0].client_id).toBe(C); expect(rows[0].question_ciphertext).not.toContain('Offer 5% off'); expect(rows[0].answer_ciphertext).not.toContain('Canvas 20');
  });
  it('replacing a pending draft preserves the count but changes its target; no draft means takeover is still required', async () => {
    const before = (await read())!.revision; const newer = randomUUID();
    await admin.query(`update drafts set status='expired' where id=$1`, [DRAFT]);
    await admin.query(`insert into drafts(id,business_id,conversation_id,capability,draft_text,status) values ($1,$2,$3,'quote','Replacement draft','pending')`, [newer, B, CHAT]);
    expect((await use(before)).json().reason).toBe('stale');
    expect((await use((await read())!.revision)).json().draftId).toBe(newer);
    await admin.query(`update drafts set status='expired' where id=$1`, [newer]);
    await admin.query(`update conversations set assigned_to=null where id=$1`, [CHAT]);
    expect((await use((await read())!.revision)).json()).toEqual({ ok: false, reason: 'refused' });
    await admin.query(`update conversations set assigned_to=$2 where id=$1`, [CHAT, PERSON]);
    const manual = (await use((await read())!.revision)).json(); expect(manual.ok).toBe(true); expect(manual.draftId).toBeNull(); expect(manual.assignedTo).toBe(PERSON);
  });
});
