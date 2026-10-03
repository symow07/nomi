import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';
// @ts-expect-error — the operator tool, plain JS on purpose (tools/ is not type-checked).
import { RULES, readSchema, coverage, planErasure, pruneMentions, normalizeIdentity } from '../../tools/erase-buyer.mjs';
import { normalizePhone } from '../../src/core/channel/phone.js';

/**
 * CC-02b — the operator carries out ONE buyer's deletion request.
 *
 * The tool runs as the operator runs it: a child process, as the migration
 * role, against a business seeded here with a buyer (A) who left a row in
 * every table the contract names — two conversations, one holding a confirmed
 * order — beside a second buyer (B) in the same business, a third (D) whose
 * webhook receipt also carried A's message, and the SAME person as A (C) in a
 * different business.
 *
 * The proof is a fingerprint of every row of both businesses, taken before and
 * after: the rows that went must be exactly A's erasable rows, the rows that
 * changed exactly the ones the contract changes, and nothing else — not one
 * byte of B, C or D beyond the receipt D shared with A.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('CC-02b · the erasure tool is an operator tool, never the app', () => {
  it('no npm script runs it and nothing in src/ imports it', () => {
    expect(read('package.json')).not.toContain('erase-buyer');
    const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => {
      const rel = `${dir}/${f}`;
      return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : /\.(ts|mjs|js)$/.test(f) ? [rel] : [];
    });
    const importers = walk('src').filter((f) => read(f).includes('erase-buyer'));
    expect(importers).toEqual([]);
  });

  it('the runbook names it, and the buyer section is no longer "there is no tool"', () => {
    const doc = read('docs/DATA-DELETION-RUNBOOK.md');
    expect(doc).toContain('tools/erase-buyer.mjs');
    expect(doc).not.toMatch(/There is no tool for this yet/);
  });

  it('finds a number the way the product stores it — the same digits as normalizePhone', () => {
    // A second normaliser that disagreed would match nothing, and erase nothing, in silence.
    for (const raw of ['+971 50 000 1234', '00971-50-000-1234', '(971) 50.000.1234', '971 50‐000―1234', '971500001234']) {
      expect(normalizeIdentity('whatsapp', raw), raw).toBe(normalizePhone(raw));
    }
    expect(normalizeIdentity('email', '  Amira@Example.COM ')).toBe('amira@example.com');
  });

  it('prunes one buyer out of a batched webhook and leaves the other buyer whole', () => {
    const them = new Set(['971500000001']);
    const payload = {
      entry: [{ changes: [{ value: {
        contacts: [{ profile: { name: 'Amira' }, wa_id: '971500000001' }, { profile: { name: 'Dana' }, wa_id: '971500000009' }],
        messages: [{ from: '971500000001', text: { body: 'mine' } }, { from: '971500000009', text: { body: 'theirs' } }],
      } }] }],
    };
    const out = JSON.stringify(pruneMentions(payload, them));
    expect(out).not.toContain('971500000001');
    expect(out).not.toContain('Amira');
    expect(out).not.toContain('mine');
    expect(out).toContain('971500000009');
    expect(out).toContain('theirs');
    // Named outside any array element, nothing can be kept apart: the whole document goes.
    expect(pruneMentions({ to: '971500000001', reason: 'x' }, them)).toBeNull();
  });
});

const DATABASE_URL = process.env['DATABASE_URL'];
const ADMIN = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && ADMIN ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const id = (n: number) => `ee5b0000-0000-4000-8000-${RUN}${String(n).padStart(4, '0')}`;
const DIGITS = String(parseInt(RUN, 16) % 1_000_000_000).padStart(9, '0');
const PHONE_A = `971${DIGITS}`;
const PHONE_B = `972${DIGITS}`;
const PHONE_D = `973${DIGITS}`;
const IG_A = `17841${DIGITS}`;
const EMAIL_A = `amira.${RUN}@buyer.test`;
const EMAIL_B = `bilal.${RUN}@buyer.test`;
const NAME_A = `Amira${RUN}`;
const SAID_A = `A-said-${RUN}`;
const W_IN = `wamid.A1in.${RUN}`;
const W_OUT = `wamid.A1out.${RUN}`;

const B1 = id(1);
const B2 = id(2);
const P1 = id(3);
const P2 = id(4);
const SEQ = id(5);
const WS_REQ = id(6);
const A = {
  client: id(10), ccWa: id(11), ccIg: id(12), ccMail: id(13),
  c1: id(20), m1: id(21), m2: id(22), m3: id(23), s1: id(24), q1: id(25), d1: id(26), sig: id(27), note: id(28),
  esc: id(29), ho: id(30), sr: id(31), o1: id(32), dl: id(33), rp: id(34), sc: id(35),
  c2: id(40), q2: id(41), order: id(42), ou1: id(43), ou2: id(44), ec: id(45), m4: id(46), d2: id(47), o2: id(48), s2: id(49),
  c3: id(50), o3: id(51), en: id(52), ct1: id(53), ct2: id(54), cn: id(55), sup: id(56), pl: id(57),
  req: id(60), dup: id(61), ask: id(62),
  frag: `frag-a1-${RUN}`, shadow: `shadow-a1-${RUN}`, proof1: `proof-a1-${RUN}-${'x'.repeat(24)}`, proof2: `proof-a2-${RUN}-${'x'.repeat(24)}`,
  ev1: '', ev2: '', tr1: '', au1: '', au2: '', jobIn: '', jobDone: '',
};
const B = {
  client: id(70), cc: id(71), c: id(72), m: id(73), s: id(74), q: id(75), order: id(76), ou: id(77),
  ct: id(78), sup: id(79), pl: id(80), withdrawn: id(81), au: '', job: '',
};
const D = { client: id(85), cc: id(86), c: id(87), m: id(88) };
const C = { client: id(90), c: id(91), m: id(92), s: id(93), ct: id(94), cn: id(95), sup: id(96), pl: id(97), req: id(98), au: '', job: '' };
/** The same person as A recorded a second time in A's business — by e-mail. */
const Y = { client: id(100) };

/** A key as the snapshot prints it: the row's primary key, `row(...)::text`. */
const k = (...v: (string | number)[]) => `(${v.join(',')})`;

type Run = { code: number | null; out: string; err: string };
const tool = (args: string[], env: NodeJS.ProcessEnv = { ...process.env, MIGRATE_DATABASE_URL: ADMIN }): Run => {
  const r = spawnSync(process.execPath, ['tools/erase-buyer.mjs', ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 120_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const go = ['--request', A.req, '--yes', '--confirm', A.req.slice(0, 8), '--by', 'Operator Test'];

// ── The fingerprint of two businesses ──────────────────────────────────────
type Snapshot = Map<string, Map<string, string>>;
const IN_BUSINESS = 'x.business_id = any($1::uuid[])';
const INDIRECT: Record<string, string> = {
  businesses: 'x.id = any($1::uuid[])',
  messages: 'x.conversation_id in (select id from conversations where business_id = any($1::uuid[]))',
  conversation_state: 'x.conversation_id in (select id from conversations where business_id = any($1::uuid[]))',
  client_channels: 'x.client_id in (select id from clients where business_id = any($1::uuid[]))',
  email_confirmations: 'x.order_id in (select id from orders where business_id = any($1::uuid[]))',
  price_tiers: 'x.product_id in (select id from products where business_id = any($1::uuid[]))',
  product_aliases: 'x.product_id in (select id from products where business_id = any($1::uuid[]))',
  product_images: 'x.product_id in (select id from products where business_id = any($1::uuid[]))',
  login_codes: 'x.login_id in (select id from logins where business_id = any($1::uuid[]))',
};
/** Tables that belong to no business at all. */
const GLOBAL = new Set(['_migrations', 'backup_runs', 'signup_invites', 'mail_sends', 'installation_limits', 'spend_breaker_alerts', 'signup_settings', 'signup_throttles', 'plans', 'billing_settings',
  // 0126 — the ids-only record of every erasure: the operator's, outliving any workspace, asserted on its own below.
  'erasure_ledger']);
/** Every schema but the system's and the queue's (the queue is read on its own, below). */
const USER_SCHEMA = "n.nspname not in ('pg_catalog', 'information_schema', 'pgboss') and n.nspname not like 'pg\\_%'";
const NAMED = "(case when n.nspname = 'public' then c.relname::text else n.nspname || '.' || c.relname end)";
const qt = (t: string) => t.split('.').map((p) => `"${p}"`).join('.');

async function snapshot(db: pg.Client, businesses: string[]): Promise<Snapshot> {
  const tables = (await db.query<{ t: string; pk: string[] | null; biz: boolean }>(`
    select ${NAMED} as t,
           (select array(select a.attname::text from unnest(con.conkey) with ordinality k(n, i)
                           join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.i)
              from pg_constraint con where con.conrelid = c.oid and con.contype = 'p') as pk,
           exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped) as biz
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where ${USER_SCHEMA} and c.relkind in ('r', 'p') and not c.relispartition
     order by 1`)).rows;
  const out: Snapshot = new Map();
  for (const { t, pk, biz } of tables) {
    if (GLOBAL.has(t)) continue;
    const scope = biz ? IN_BUSINESS : INDIRECT[t];
    if (!scope) throw new Error(`the snapshot does not know how ${t} belongs to a business — add it to INDIRECT or GLOBAL`);
    const key = pk?.length ? `row(${pk.map((c) => `x."${c}"`).join(', ')})::text` : 'x.ctid::text';
    const rows = (await db.query<{ k: string; h: string }>(
      `select ${key} as k, md5(x::text) as h from ${qt(t)} x where ${scope}`, [businesses])).rows;
    out.set(t, new Map(rows.map((r) => [r.k, r.h])));
  }
  const jobs = (await db.query<{ k: string; h: string }>(
    `select row(x.id)::text as k, md5(x::text) as h from pgboss.job x where x.data->>'businessId' = any($1::text[])`,
    [businesses])).rows;
  out.set('pgboss.job', new Map(jobs.map((r) => [r.k, r.h])));
  return out;
}

function diff(before: Snapshot, after: Snapshot) {
  const removed: string[] = [];
  const changed: string[] = [];
  const added: string[] = [];
  for (const [t, rows] of before) {
    for (const [key, h] of rows) {
      const now = after.get(t)?.get(key);
      if (now === undefined) removed.push(`${t}:${key}`);
      else if (now !== h) changed.push(`${t}:${key}`);
    }
  }
  for (const [t, rows] of after) for (const key of rows.keys()) if (!before.get(t)?.has(key)) added.push(`${t}:${key}`);
  return { removed: removed.sort(), changed: changed.sort(), added: added.sort() };
}

/** Every table (and the job queue) where a row of these businesses still contains `text`. */
async function mentioning(db: pg.Client, businesses: string[], text: string): Promise<string[]> {
  const snap = await snapshot(db, businesses);
  const found: string[] = [];
  for (const t of snap.keys()) {
    const sql = t === 'pgboss.job'
      ? `select count(*)::int as n from pgboss.job x where x.data->>'businessId' = any($1::text[]) and x::text like $2`
      : `select count(*)::int as n from ${qt(t)} x where ${GLOBAL.has(t) ? 'false' : (INDIRECT[t] ?? IN_BUSINESS)} and x::text like $2`;
    const n = (await db.query<{ n: number }>(sql, [businesses, `%${text}%`])).rows[0]?.n ?? 0;
    if (n > 0) found.push(t);
  }
  return found.sort();
}

d('CC-02b · tools/erase-buyer.mjs carries out one buyer\'s deletion request (requires DATABASE_URL)', () => {
  let db: pg.Client;
  let seeded: Snapshot;

  const ins = async (table: string, row: Record<string, unknown>, ret = 'id'): Promise<string> => {
    const cols = Object.keys(row);
    const r = await db.query<{ k: string }>(
      `insert into ${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning ${ret}::text as k`,
      Object.values(row));
    return r.rows[0]!.k;
  };
  const J = (v: unknown) => JSON.stringify(v);
  const hook = (value: Record<string, unknown>) => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: `PN${RUN}` }, ...value } }] }],
  });
  const now = new Date();

  beforeAll(async () => {
    db = new pg.Client({ connectionString: ADMIN });
    await db.connect();
    await db.query('begin');
    try {
      await ins('businesses', { id: B1, name: `Erase Buyer Co ${RUN}`, owner_locale: 'en' });
      await ins('businesses', { id: B2, name: `Other Shop ${RUN}`, owner_locale: 'en' });
      await ins('products', { id: P1, business_id: B1, sku: `SKU-${RUN}`, name: 'Canvas tote' });
      await ins('products', { id: P2, business_id: B2, sku: `SKU-${RUN}`, name: 'Canvas tote' });
      await ins('sequences', { id: SEQ, business_id: B1, name: 'Follow up', created_by: 'owner', approved_by: 'owner', approved_at: now });
      await ins('channel_audit', { business_id: B1, action: 'export_data', actor: 'owner', detail: J({ subject: 'buyers', rows: 3 }) });

      // ── A: the buyer who asked ─────────────────────────────────────────────
      await ins('clients', {
        id: A.client, business_id: B1, display_name: NAME_A, email: EMAIL_A, phone: PHONE_A, country: 'AE',
        preferred_language: 'ar', notes: `${NAME_A} likes blue`, is_vip: true, total_orders: 1,
      });
      await ins('client_channels', { id: A.ccWa, client_id: A.client, channel: 'whatsapp', channel_user_id: PHONE_A });
      await ins('client_channels', { id: A.ccIg, client_id: A.client, channel: 'instagram', channel_user_id: IG_A });
      await ins('client_channels', { id: A.ccMail, client_id: A.client, channel: 'email', channel_user_id: EMAIL_A });

      // A1 — WhatsApp, handed to a person: the whole footprint of a conversation.
      await ins('conversations', { id: A.c1, business_id: B1, client_id: A.client, channel: 'whatsapp', assigned_to: 'unclaimed' });
      await ins('messages', { id: A.m1, conversation_id: A.c1, external_id: W_IN, direction: 'inbound', text_content: `${SAID_A}: I need 500 bags` });
      await ins('messages', { id: A.m2, conversation_id: A.c1, external_id: W_OUT, direction: 'outbound', text_content: `Hello ${NAME_A}` });
      await ins('messages', { id: A.m3, conversation_id: A.c1, direction: 'inbound', input_type: 'voice_transcribed', text_content: `${SAID_A} 500`, transcription: 'I nead 500' });
      await ins('conversation_state', { id: A.s1, conversation_id: A.c1, context_summary: `${NAME_A} wants 500 bags` });
      await ins('quotes', { id: A.q1, business_id: B1, conversation_id: A.c1, product_id: P1, quantity: 500, inputs: J({ tiers: [] }), unit_price_usd: 2, total_usd: 1000, engine_version: 'test' });
      await ins('turns', { message_id: W_IN, business_id: B1, conversation_id: A.c1, state_before: J({}), input: J({ text: SAID_A }), decision: J({}), engine_version: 'test', quote_id: A.q1 }, 'message_id');
      await ins('quote_proofs', { token: A.proof1, business_id: B1, quote_id: A.q1, conversation_id: A.c1 }, 'token');
      await ins('drafts', { id: A.d1, business_id: B1, conversation_id: A.c1, turn_message_id: W_IN, capability: 'quote', draft_text: `Dear ${NAME_A}`, status: 'approved', decided_at: now });
      await ins('message_fragments', { id: A.frag, business_id: B1, conversation_id: A.c1, text: SAID_A, processed_in: W_IN });
      await ins('conversation_signals', { id: A.sig, conversation_id: A.c1, business_id: B1, kind: 'human_requested' });
      A.ev1 = await ins('conversation_events', { business_id: B1, conversation_id: A.c1, type: 'handed_to', payload: J({ to: 'owner' }) });
      await ins('conversation_notes', { id: A.note, business_id: B1, conversation_id: A.c1, note: `${NAME_A} prefers mornings` });
      await ins('escalation_events', { id: A.esc, conversation_id: A.c1, business_id: B1, trigger_reason: 'client_request' });
      await ins('handoffs', { id: A.ho, business_id: B1, conversation_id: A.c1, reason: 'asked for a person', sla_deadline_at: new Date(now.getTime() + 3600_000) });
      await ins('sample_requests', { id: A.sr, business_id: B1, conversation_id: A.c1, asked_text: `${SAID_A}: a sample please`, address: `1 Palm St ${RUN}` });
      await ins('outbound_messages', { id: A.o1, business_id: B1, conversation_id: A.c1, seq: 1, body: `Hello ${NAME_A}`, provider_message_id: W_OUT, to_wa_id: PHONE_A, status: 'delivered' });
      A.tr1 = await ins('outbound_transitions', { business_id: B1, outbound_id: A.o1, from_status: 'queued', to_status: 'sent' });
      await ins('deliveries', { id: A.dl, business_id: B1, conversation_id: A.c1, kind: 'telegram_alert', payload: J({ text: `${NAME_A} asked for a person` }) });
      await ins('repairs', { id: A.rp, business_id: B1, conversation_id: A.c1, capability: 'quote', record: J({ said: SAID_A }) });
      await ins('spot_checks', { id: A.sc, business_id: B1, conversation_id: A.c1, capability: 'quote', work_ref: A.d1, verdict: 'needs_improvement', correction: `tell ${NAME_A} 500 pcs`, answered_at: now });
      await ins('shadow.turn_decisions', { message_id: A.shadow, conversation_id: A.c1, business_id: B1, svc_decision: J({ reply: `Hello ${NAME_A}` }) }, 'message_id');

      // A2 — the conversation their order points at.
      await ins('conversations', {
        id: A.c2, business_id: B1, client_id: A.client, channel: 'whatsapp', assigned_to: 'someone', assigned_at: now,
        ai_disclosed_at: now, ai_disclosure_delivered_at: now, owner_unsent_reply: `Hi ${NAME_A}, about your order`, owner_unsent_reply_at: now,
      });
      await ins('messages', { id: A.m4, conversation_id: A.c2, direction: 'inbound', text_content: `${SAID_A}: confirmed` });
      await ins('conversation_state', { id: A.s2, conversation_id: A.c2 });
      await ins('quotes', { id: A.q2, business_id: B1, conversation_id: A.c2, product_id: P1, quantity: 500, inputs: J({ tiers: [] }), unit_price_usd: 2, total_usd: 1000, engine_version: 'test' });
      await ins('quote_proofs', { token: A.proof2, business_id: B1, quote_id: A.q2, conversation_id: A.c2 }, 'token');
      await ins('orders', {
        id: A.order, order_reference: `YW-T-${RUN}-A`, business_id: B1, client_id: A.client, conversation_id: A.c2,
        product_id: P1, quantity: 500, unit: 'pcs', agreed_unit_price_usd: 2, total_value_usd: 1000, client_email: EMAIL_A,
        shipping_address: `1 Palm St ${RUN}`, notes: `call ${NAME_A}`, status: 'shipped', quote_id: A.q2, confirmed_at: now,
      });
      await ins('order_updates', { id: A.ou1, business_id: B1, order_id: A.order, state: 'confirmed' });
      await ins('order_updates', { id: A.ou2, business_id: B1, order_id: A.order, state: 'shipped', tracking_reference: 'TRK-1' });
      await ins('email_confirmations', { id: A.ec, order_id: A.order, to_email: EMAIL_A, subject: `Your order, ${NAME_A}`, body_html: `<p>Dear ${NAME_A}</p>`, status: 'sent', sent_at: now });
      await ins('drafts', { id: A.d2, business_id: B1, conversation_id: A.c2, capability: 'confirm_order', draft_text: `Thanks ${NAME_A}`, status: 'pending' });
      await ins('outbound_messages', { id: A.o2, business_id: B1, conversation_id: A.c2, seq: 1, body: `Order confirmed, ${NAME_A}`, to_wa_id: PHONE_A });
      A.ev2 = await ins('conversation_events', { business_id: B1, conversation_id: A.c2, type: 'order_created', payload: J({}) });

      // A3 — an e-mail thread the outreach sequence started.
      await ins('conversations', { id: A.c3, business_id: B1, client_id: A.client, channel: 'email' });
      await ins('outbound_messages', { id: A.o3, business_id: B1, conversation_id: A.c3, seq: 1, body: `Dear ${NAME_A}`, channel: 'email', subject: 'Canvas totes', origin: 'outreach', to_wa_id: EMAIL_A });
      await ins('sequence_enrollments', { id: A.en, business_id: B1, sequence_id: SEQ, channel: 'email', identity: EMAIL_A, conversation_id: A.c3, enrolled_by: 'owner' });
      await ins('sequence_sends', { business_id: B1, enrollment_id: A.en, position: 1, outbound_id: A.o3 }, 'enrollment_id');

      // Who may write to them, and who may not.
      await ins('contacts', { id: A.ct1, business_id: B1, channel: 'email', identity: EMAIL_A, display_name: NAME_A, source: 'manual' });
      await ins('contacts', { id: A.ct2, business_id: B1, channel: 'whatsapp', identity: PHONE_A, display_name: NAME_A, source: 'inbound' });
      await ins('contact_consent', { id: A.cn, business_id: B1, channel: 'email', identity: EMAIL_A, evidence: 'owner_attestation', recorded_by: 'owner', note: `met ${NAME_A} at the fair` });
      await ins('suppressions', { id: A.sup, business_id: B1, channel: 'email', identity: EMAIL_A, reason: 'unsubscribed' });
      await ins('pilot_allowlist', { id: A.pl, business_id: B1, phone: PHONE_A, label: NAME_A, added_by: 'owner' });

      // Their raw webhooks: a message, a status of one sent to them, an Instagram DM.
      await ins('channel_events', {
        id: W_IN, business_id: B1, channel: 'whatsapp', provider: 'meta', event_type: 'message.inbound',
        conversation_external_id: `whatsapp:${PHONE_A}:PN${RUN}`, occurred_at: now, processed_at: now,
        payload: J(hook({ contacts: [{ profile: { name: NAME_A }, wa_id: PHONE_A }], messages: [{ from: PHONE_A, id: W_IN, type: 'text', text: { body: `${SAID_A}: I need 500 bags` } }] })),
      });
      await ins('channel_events', {
        id: `${W_OUT}#delivered`, business_id: B1, channel: 'whatsapp', provider: 'meta', event_type: 'status', occurred_at: now,
        payload: J(hook({ statuses: [{ id: W_OUT, status: 'delivered', recipient_id: PHONE_A }] })),
      });
      await ins('channel_events', {
        id: `mid.ig.${RUN}`, business_id: B1, channel: 'instagram', provider: 'meta', event_type: 'message.inbound',
        conversation_external_id: `instagram:${IG_A}:IG${RUN}`, occurred_at: now,
        payload: J({ object: 'instagram', entry: [{ messaging: [{ sender: { id: IG_A }, message: { text: `${SAID_A} on instagram` } }] }] }),
      });
      // The trail: a refused send addressed to them, and their words corrected by the owner.
      A.au1 = await ins('channel_audit', { business_id: B1, action: 'send_refused', actor: 'system', detail: J({ outboundId: A.o1, to: PHONE_A, reason: 'not_allowlisted' }) });
      A.au2 = await ins('channel_audit', { business_id: B1, action: 'transcript_corrected', actor: 'owner', detail: J({ conversationId: A.c1, messageId: A.m3, before: 'I nead 500', after: `${SAID_A} 500` }) });

      await ins('deletion_requests', {
        id: A.req, business_id: B1, scope: 'buyer', client_id: A.client, asked_by: 'owner',
        subject_note: `the WhatsApp number ending ${PHONE_A.slice(-4)}`, asked_at: new Date(now.getTime() - 3 * 86400_000),
      });
      // 0076 — the request as it was noted from their message, then recorded:
      // it holds their conversation and their message, so it goes with them.
      await ins('deletion_asks', {
        id: A.ask, business_id: B1, client_id: A.client, conversation_id: A.c1, message_id: A.m1,
        asked_at: new Date(now.getTime() - 3 * 86400_000), state: 'recorded', request_id: A.req,
        decided_at: now, decided_by: 'owner',
      });
      // An open WORKSPACE request in the same business: not this tool's to carry out.
      await ins('deletion_requests', { id: WS_REQ, business_id: B1, scope: 'workspace', asked_by: 'owner' });
      // A second buyer row holding A's address. Not named by the request, so not erased — but named in the dry run.
      await ins('clients', { id: Y.client, business_id: B1, display_name: `Mail contact ${RUN}`, email: EMAIL_A });

      // ── B: another buyer of the same business ─────────────────────────────
      await ins('clients', { id: B.client, business_id: B1, display_name: `Bilal${RUN}`, phone: PHONE_B, email: EMAIL_B });
      await ins('client_channels', { id: B.cc, client_id: B.client, channel: 'whatsapp', channel_user_id: PHONE_B });
      await ins('conversations', { id: B.c, business_id: B1, client_id: B.client, channel: 'whatsapp' });
      await ins('messages', { id: B.m, conversation_id: B.c, external_id: `wamid.B1in.${RUN}`, direction: 'inbound', text_content: 'B here' });
      await ins('conversation_state', { id: B.s, conversation_id: B.c });
      await ins('shadow.turn_decisions', { message_id: `shadow-b-${RUN}`, conversation_id: B.c, business_id: B1, svc_decision: J({ reply: 'Hello B' }) }, 'message_id');
      await ins('quotes', { id: B.q, business_id: B1, conversation_id: B.c, product_id: P1, quantity: 100, inputs: J({ tiers: [] }), unit_price_usd: 2, total_usd: 200, engine_version: 'test' });
      await ins('orders', { id: B.order, order_reference: `YW-T-${RUN}-B`, business_id: B1, client_id: B.client, conversation_id: B.c, product_id: P1, quantity: 100, unit: 'pcs', client_email: EMAIL_B, quote_id: B.q, status: 'confirmed' });
      await ins('order_updates', { id: B.ou, business_id: B1, order_id: B.order, state: 'confirmed' });
      await ins('contacts', { id: B.ct, business_id: B1, channel: 'whatsapp', identity: PHONE_B, source: 'inbound' });
      await ins('suppressions', { id: B.sup, business_id: B1, channel: 'whatsapp', identity: PHONE_B, reason: 'complained' });
      await ins('pilot_allowlist', { id: B.pl, business_id: B1, phone: PHONE_B, added_by: 'owner' });
      await ins('channel_events', {
        id: `wamid.B1in.${RUN}`, business_id: B1, channel: 'whatsapp', provider: 'meta', event_type: 'message.inbound',
        conversation_external_id: `whatsapp:${PHONE_B}:PN${RUN}`, occurred_at: now,
        payload: J(hook({ messages: [{ from: PHONE_B, id: `wamid.B1in.${RUN}`, type: 'text', text: { body: 'B here' } }] })),
      });
      B.au = await ins('channel_audit', { business_id: B1, action: 'send_refused', actor: 'system', detail: J({ to: PHONE_B, reason: 'window' }) });
      await ins('deletion_requests', { id: B.withdrawn, business_id: B1, scope: 'buyer', client_id: B.client, asked_by: 'owner', state: 'withdrawn', closed_at: now, closed_by: 'owner' });

      // ── D: another buyer, whose webhook receipt Meta batched with A's message ──
      await ins('clients', { id: D.client, business_id: B1, display_name: `Dana${RUN}`, phone: PHONE_D });
      await ins('client_channels', { id: D.cc, client_id: D.client, channel: 'whatsapp', channel_user_id: PHONE_D });
      await ins('conversations', { id: D.c, business_id: B1, client_id: D.client, channel: 'whatsapp' });
      await ins('messages', { id: D.m, conversation_id: D.c, external_id: `wamid.D1in.${RUN}`, direction: 'inbound', text_content: `D-said-${RUN}` });
      await ins('channel_events', {
        id: `wamid.D1in.${RUN}`, business_id: B1, channel: 'whatsapp', provider: 'meta', event_type: 'message.inbound',
        conversation_external_id: `whatsapp:${PHONE_D}:PN${RUN}`, occurred_at: now, processed_at: now,
        payload: J(hook({
          contacts: [{ profile: { name: NAME_A }, wa_id: PHONE_A }, { profile: { name: `Dana${RUN}` }, wa_id: PHONE_D }],
          messages: [
            { from: PHONE_A, id: `wamid.A1b.${RUN}`, type: 'text', text: { body: `${SAID_A}: batched` } },
            { from: PHONE_D, id: `wamid.D1in.${RUN}`, type: 'text', text: { body: `D-said-${RUN}` } },
          ],
        })),
      });

      // ── C: the same person as A, a buyer of ANOTHER business ──────────────
      // No client_channels row: (channel, channel_user_id) is unique across
      // businesses and A's holds it — so clients.phone is C's only identity.
      await ins('clients', { id: C.client, business_id: B2, display_name: `${NAME_A} (other shop)`, phone: PHONE_A, email: EMAIL_A });
      await ins('conversations', { id: C.c, business_id: B2, client_id: C.client, channel: 'whatsapp' });
      await ins('messages', { id: C.m, conversation_id: C.c, external_id: `wamid.C1in.${RUN}`, direction: 'inbound', text_content: `${SAID_A} to the other shop` });
      await ins('conversation_state', { id: C.s, conversation_id: C.c });
      await ins('contacts', { id: C.ct, business_id: B2, channel: 'email', identity: EMAIL_A, display_name: NAME_A, source: 'manual' });
      await ins('contact_consent', { id: C.cn, business_id: B2, channel: 'email', identity: EMAIL_A, evidence: 'owner_attestation', recorded_by: 'owner' });
      await ins('suppressions', { id: C.sup, business_id: B2, channel: 'email', identity: EMAIL_A, reason: 'bounced' });
      await ins('pilot_allowlist', { id: C.pl, business_id: B2, phone: PHONE_A, label: NAME_A, added_by: 'owner' });
      await ins('channel_events', {
        id: `wamid.C1in.${RUN}`, business_id: B2, channel: 'whatsapp', provider: 'meta', event_type: 'message.inbound',
        conversation_external_id: `whatsapp:${PHONE_A}:PN2${RUN}`, occurred_at: now,
        payload: J(hook({ contacts: [{ profile: { name: NAME_A }, wa_id: PHONE_A }], messages: [{ from: PHONE_A, id: `wamid.C1in.${RUN}`, type: 'text', text: { body: SAID_A } }] })),
      });
      C.au = await ins('channel_audit', { business_id: B2, action: 'send_refused', actor: 'system', detail: J({ to: PHONE_A, reason: 'window' }) });
      await ins('deletion_requests', { id: C.req, business_id: B2, scope: 'buyer', client_id: C.client, asked_by: 'owner' });

      await db.query('commit');
    } catch (e) {
      await db.query('rollback');
      throw e;
    }

    // Queued and finished work, through the production queue — which also
    // makes sure the queues exist on a database no worker has started yet.
    const { startBoss, QUEUES } = await import('../../src/queue/boss.js');
    const boss = await startBoss(DATABASE_URL!);
    try {
      const later = { startAfter: 3600 };
      A.jobIn = (await boss.send(QUEUES.inbound, { businessId: B1, conversationId: A.c1, messageId: A.m1, text: `${SAID_A}: I need 500 bags` }, later))!;
      A.jobDone = (await boss.send(QUEUES.notify, { businessId: B1, kind: 'handoff', conversationId: A.c2 }, later))!;
      B.job = (await boss.send(QUEUES.inbound, { businessId: B1, conversationId: B.c, messageId: B.m, text: 'B here' }, later))!;
      C.job = (await boss.send(QUEUES.inbound, { businessId: B2, conversationId: C.c, messageId: C.m, text: SAID_A }, later))!;
    } finally {
      await boss.stop();
    }
    for (const j of [A.jobIn, A.jobDone, B.job, C.job]) expect(j).toMatch(/^[0-9a-f-]{36}$/);
    await db.query(`update pgboss.job set state = 'completed', completed_on = now() where id = $1`, [A.jobDone]);

    seeded = await snapshot(db, [B1, B2]);
  }, 120_000);

  afterAll(async () => {
    // Work queued here is taken back here; the tenants go with the next run's prune.
    await db?.query(`delete from pgboss.job where data->>'businessId' = any($1::text[])`, [[B1, B2]]).catch(() => {});
    await db?.end();
  });

  // ── Structure: a new table cannot be silently missed ───────────────────────
  it('every table with a foreign-key path to clients or conversations, or a client_id / conversation_id column, is classified', async () => {
    const reached = (await db.query<{ t: string }>(`
      with recursive fk as (
        select ${NAMED} as child, (select case when pn.nspname = 'public' then p.relname::text else pn.nspname || '.' || p.relname end
                                     from pg_class p join pg_namespace pn on pn.oid = p.relnamespace where p.oid = con.confrelid) as parent
          from pg_constraint con
          join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
         where con.contype = 'f' and ${USER_SCHEMA}
      ), down(t) as (
        select 'clients'::text collate "C" union select 'conversations'::text collate "C"
        union select fk.child from fk join down on fk.parent = down.t
      )
      select t from down
      union
      -- A buyer's key without a constraint, in any schema. Views hold no rows of
      -- their own; tables do.
      select ${NAMED} from pg_attribute a
        join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
       where ${USER_SCHEMA} and c.relkind in ('r', 'p') and not c.relispartition
         and not a.attisdropped and a.attname in ('client_id', 'conversation_id')`)).rows.map((r) => r.t).sort();
    expect(reached).toContain('shadow.turn_decisions');
    expect(reached.length).toBeGreaterThan(25);
    expect(reached.filter((t) => !(t in RULES)), 'add them to RULES in tools/erase-buyer.mjs').toEqual([]);

    // The tool's own derivation agrees with this independent one, and is clean.
    const cov = coverage(await readSchema(db));
    expect(cov.unclassified).toEqual([]);
    expect(cov.stale).toEqual([]);
    expect(cov.problems).toEqual([]);
    for (const t of reached) expect(cov.inScope.has(t), `${t} is outside the tool's scope`).toBe(true);
  });

  it('a table the rules do not know makes the tool REFUSE, by name — and so does a bare client_id', async () => {
    const without = (t: string) => Object.fromEntries(Object.entries(RULES).filter(([name]) => name !== t));
    const refusal = await planErasure(db, { businessId: B1, clientId: B.client, requestId: B.withdrawn }, { rules: without('messages') });
    expect(refusal.refusals.join(' ')).toMatch(/will not guess: .*\bmessages\b/);

    // A table added next month with a key to conversations: found by the walk.
    const schema = await readSchema(db);
    schema.tables.add('buyer_photos');
    schema.columns.set('buyer_photos', new Map([['id', { type: 'uuid', notnull: true }], ['conversation_id', { type: 'uuid', notnull: false }]]));
    schema.pks.set('buyer_photos', ['id']);
    schema.fks.push({ child: 'buyer_photos', cols: ['conversation_id'], parent: 'conversations', pcols: ['id'], name: 'buyer_photos_conversation_id_fkey' });
    expect(coverage(schema).unclassified).toEqual(['buyer_photos']);

    // …and one with a buyer's id and NO key: found by its column name.
    const bare = await readSchema(db);
    bare.tables.add('buyer_scores');
    bare.columns.set('buyer_scores', new Map([['id', { type: 'uuid', notnull: true }], ['client_id', { type: 'uuid', notnull: false }]]));
    bare.pks.set('buyer_scores', ['id']);
    const cov = coverage(bare);
    expect(cov.unclassified).toEqual(['buyer_scores']);
    expect(cov.problems.join(' ')).toMatch(/buyer_scores\.client_id links to a buyer with no foreign key/);
  });

  it('a kept order that needs a row the contract erases is a refusal, not a guess', async () => {
    const strict = { ...RULES, quotes: { do: 'erase' } };
    await db.query('begin isolation level repeatable read read only');
    try {
      const plan = await planErasure(db, { businessId: B1, clientId: A.client, requestId: A.req }, { rules: strict });
      expect(plan.refusals.join(' ')).toMatch(/a orders row that stays .* needs a quotes row the contract erases/);
    } finally {
      await db.query('rollback');
    }
  });

  // ── Refusals: nothing changes ──────────────────────────────────────────────
  it('refuses bad usage before it reaches the database', async () => {
    const { MIGRATE_DATABASE_URL: _unset, ...noAdmin } = process.env;
    expect(tool(['--request', A.req], noAdmin)).toMatchObject({ code: 2 });
    expect(tool(['--request', 'not-a-uuid'])).toMatchObject({ code: 2 });
    const noBy = tool(['--request', A.req, '--yes', '--confirm', A.req.slice(0, 8)]);
    expect(noBy.code).toBe(2);
    expect(noBy.err).toMatch(/--yes needs --by/);
    const noConfirm = tool(['--request', A.req, '--yes', '--by', 'Operator Test']);
    expect(noConfirm.code).toBe(2);
    expect(noConfirm.err).toMatch(/--yes needs --confirm/);
    // The app's URL pasted where the migration role's belongs: row security
    // would show it a buyer with nothing to erase.
    const appRole = tool(go, { ...process.env, MIGRATE_DATABASE_URL: DATABASE_URL });
    expect(appRole.code).toBe(1);
    expect(appRole.err).toMatch(/subject to row-level security/);
    expect(diff(seeded, await snapshot(db, [B1, B2]))).toEqual({ removed: [], changed: [], added: [] });
  });

  it('refuses without an open buyer request: none, withdrawn, or a workspace one', async () => {
    const none = tool(['--request', randomUUID(), '--yes', '--confirm', 'whatever', '--by', 'Operator Test']);
    expect(none.code).toBe(1);
    expect(none.err).toMatch(/No deletion request/);

    const withdrawn = tool(['--request', B.withdrawn, '--yes', '--confirm', B.withdrawn.slice(0, 8), '--by', 'Operator Test']);
    expect(withdrawn.code).toBe(1);
    expect(withdrawn.err).toMatch(/is withdrawn .*not open/);

    const workspace = tool(['--request', WS_REQ, '--yes', '--confirm', WS_REQ.slice(0, 8), '--by', 'Operator Test']);
    expect(workspace.code).toBe(1);
    expect(workspace.err).toMatch(/whole workspace.*erase-workspace\.mjs/);

    expect(diff(seeded, await snapshot(db, [B1, B2]))).toEqual({ removed: [], changed: [], added: [] });
  });

  it('refuses a --confirm that is not this request', async () => {
    const r = tool(['--request', A.req, '--yes', '--confirm', 'deadbeef', '--by', 'Operator Test']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/--confirm does not match/);
    expect(diff(seeded, await snapshot(db, [B1, B2]))).toEqual({ removed: [], changed: [], added: [] });
  });

  it('refuses while a worker holds one of their jobs', async () => {
    await db.query(`update pgboss.job set state = 'active', started_on = now() where id = $1`, [A.jobIn]);
    const held = await snapshot(db, [B1, B2]);
    try {
      const r = tool(go);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/A worker is handling this buyer right now/);
      expect(diff(held, await snapshot(db, [B1, B2]))).toEqual({ removed: [], changed: [], added: [] });
    } finally {
      await db.query(`update pgboss.job set state = 'created', started_on = null where id = $1`, [A.jobIn]);
    }
    expect(diff(seeded, await snapshot(db, [B1, B2]))).toEqual({ removed: [], changed: [], added: [] });
  });

  // ── The dry run ────────────────────────────────────────────────────────────
  it('a dry run prints the request, what goes and what stays — and changes nothing', async () => {
    const r = tool(['--request', A.req]);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Erase Buyer Co ${RUN}`);
    expect(r.out).toMatch(/asked by owner on \d{4}-\d{2}-\d{2} · due by \d{4}-\d{2}-\d{2} \((26|27) days left\)/);
    expect(r.out).toContain(`they said: the WhatsApp number ending ${PHONE_A.slice(-4)}`);
    expect(r.out).toMatch(/conversations: 3, of which 1 stay as empty shells/);
    expect(r.out).toMatch(/ERASED[\s\S]*\b4 {2}messages\b[\s\S]*KEPT/);
    expect(r.out).toMatch(/KEPT[\s\S]*\b1 {2}orders — items, prices and status stay/);
    expect(r.out).toMatch(/\b2 {2}order_updates\b/);
    expect(r.out).toMatch(/\b1 {2}suppressions — so they are never written to again/);
    expect(r.out).toMatch(/CHANGED IN PLACE[\s\S]*\b2 {2}channel_audit\b/);
    expect(r.out).toMatch(/sample credit/);
    expect(r.out).toContain(`Another buyer row in this business shares one of their identities: ${Y.client}.`);
    expect(r.out).toContain('Dry run. Nothing was changed.');
    expect(r.out).toContain(`--confirm ${A.req.slice(0, 8)}`);
    // Never the whole identity of someone being erased, on screen or in a log.
    expect(r.out).toContain(`…${PHONE_A.slice(-4)}`);
    for (const whole of [PHONE_A, EMAIL_A, IG_A]) expect(r.out).not.toContain(whole);

    expect(diff(seeded, await snapshot(db, [B1, B2]))).toEqual({ removed: [], changed: [], added: [] });
  });

  // ── The erasure ────────────────────────────────────────────────────────────
  it('--yes erases exactly the contract, keeps exactly the contract, and touches nobody else', async () => {
    const r = tool(go);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/✓ {2}Erase Buyer Co .*: buyer erased/);

    const change = diff(seeded, await snapshot(db, [B1, B2]));
    // 0126 — one row added: the business's own audit trail says a customer was
    // erased, and under which request — never whose.
    expect(change.added).toHaveLength(1);
    expect(change.added[0]).toMatch(/^channel_audit:\(\d+\)$/);
    const trail = (await db.query<{ action: string; actor: string; detail: Record<string, string> }>(
      'select action, actor, detail from channel_audit where id = $1', [change.added[0]!.slice('channel_audit:('.length, -1)])).rows[0]!;
    expect(trail).toMatchObject({ action: 'customer_erased', actor: 'Operator Test', detail: { request: A.req } });
    const ledger = (await db.query<Record<string, unknown>>(
      `select * from erasure_ledger where id = $1::uuid`, [trail.detail['erasure']])).rows[0]!;
    expect(ledger).toMatchObject({ kind: 'customer', business_id: B1, customer_id: A.client, request_id: A.req, via: 'operator', by_who: 'Operator Test' });
    expect((ledger['counts'] as { erased: Record<string, number> }).erased['messages']).toBe(4);
    for (const personal of [PHONE_A, EMAIL_A, IG_A, NAME_A, SAID_A]) expect(JSON.stringify(ledger)).not.toContain(personal);
    expect(change.removed).toEqual([
      ...[A.ccWa, A.ccIg, A.ccMail].map((x) => `client_channels:${k(x)}`),
      ...[A.c1, A.c3].map((x) => `conversations:${k(x)}`),
      ...[A.m1, A.m2, A.m3, A.m4].map((x) => `messages:${k(x)}`),
      ...[A.s1, A.s2].map((x) => `conversation_state:${k(x)}`),
      `turns:${k(W_IN)}`,
      `quotes:${k(A.q1)}`,
      ...[A.proof1, A.proof2].map((x) => `quote_proofs:${k(x)}`),
      ...[A.d1, A.d2].map((x) => `drafts:${k(x)}`),
      `message_fragments:${k(A.frag)}`,
      `conversation_signals:${k(A.sig)}`,
      ...[A.ev1, A.ev2].map((x) => `conversation_events:${k(x)}`),
      `conversation_notes:${k(A.note)}`,
      `escalation_events:${k(A.esc)}`,
      `handoffs:${k(A.ho)}`,
      `sample_requests:${k(A.sr)}`,
      `deletion_asks:${k(A.ask)}`,
      ...[A.o1, A.o2, A.o3].map((x) => `outbound_messages:${k(x)}`),
      `outbound_transitions:${k(A.tr1)}`,
      `deliveries:${k(A.dl)}`,
      `repairs:${k(A.rp)}`,
      `shadow.turn_decisions:${k(A.shadow)}`,
      `sequence_enrollments:${k(A.en)}`,
      `sequence_sends:${k(A.en, 1)}`,
      ...[A.ct1, A.ct2].map((x) => `contacts:${k(x)}`),
      `contact_consent:${k(A.cn)}`,
      `pilot_allowlist:${k(A.pl)}`,
      ...[W_IN, `${W_OUT}#delivered`, `mid.ig.${RUN}`].map((x) => `channel_events:${k(x)}`),
      ...[A.jobIn, A.jobDone].map((x) => `pgboss.job:${k(x)}`),
      // BILL (0117) — their drafts counted them among the month's customers answered: that goes too.
      `customers_answered:${k(B1, `${new Date().toISOString().slice(0, 7)}-01`, A.client)}`,
    ].sort());
    expect(change.changed).toEqual([
      `clients:${k(A.client)}`,
      `conversations:${k(A.c2)}`,
      `orders:${k(A.order)}`,
      `email_confirmations:${k(A.ec)}`,
      `spot_checks:${k(A.sc)}`,
      ...[A.au1, A.au2].map((x) => `channel_audit:${k(x)}`),
      `channel_events:${k(`wamid.D1in.${RUN}`)}`,
      `deletion_requests:${k(A.req)}`,
    ].sort());
  });

  it('what stays is detached from them: an anonymous buyer, an empty closed conversation, an order without contact details', async () => {
    const one = async <T extends pg.QueryResultRow>(sql: string, p: unknown[]) => (await db.query<T>(sql, p)).rows[0]!;

    const client = await one<Record<string, unknown>>('select * from clients where id = $1', [A.client]);
    for (const c of ['display_name', 'email', 'phone', 'country', 'preferred_language', 'notes']) expect(client[c], c).toBeNull();
    expect(client['business_id']).toBe(B1);

    const shell = await one<Record<string, unknown>>('select * from conversations where id = $1', [A.c2]);
    expect(shell).toMatchObject({ is_active: false, phase: 'closed', assigned_to: null, assigned_at: null, ai_disclosed_at: null, ai_disclosure_delivered_at: null, owner_unsent_reply: null, owner_unsent_reply_at: null });
    expect(shell['closed_at']).not.toBeNull();
    for (const t of ['messages', 'drafts', 'outbound_messages', 'conversation_state', 'conversation_events', 'quote_proofs']) {
      expect((await one<{ n: number }>(`select count(*)::int as n from ${t} where conversation_id = $1`, [A.c2])).n, t).toBe(0);
    }

    const order = await one<Record<string, unknown>>('select * from orders where id = $1', [A.order]);
    expect(order).toMatchObject({ client_email: null, shipping_address: null, notes: null, client_id: A.client, conversation_id: A.c2, quote_id: A.q2, quantity: 500, status: 'shipped' });
    expect(Number(order['total_value_usd'])).toBe(1000);
    expect((await one<{ n: number }>('select count(*)::int as n from order_updates where order_id = $1', [A.order])).n).toBe(2);
    expect(await one('select to_email, subject, body_html, status from email_confirmations where id = $1', [A.ec]))
      .toEqual({ to_email: '', subject: null, body_html: null, status: 'sent' });

    expect(await one('select conversation_id, correction, verdict from spot_checks where id = $1', [A.sc]))
      .toEqual({ conversation_id: null, correction: null, verdict: 'needs_improvement' });
    for (const [au, action] of [[A.au1, 'send_refused'], [A.au2, 'transcript_corrected']] as const) {
      expect(await one('select action, detail from channel_audit where id = $1', [au]))
        .toEqual({ action, detail: { erased: 'buyer deletion request', request: A.req } });
    }
    const batched = JSON.stringify((await one<{ payload: unknown }>('select payload from channel_events where id = $1', [`wamid.D1in.${RUN}`])).payload);
    expect(batched).toContain(`D-said-${RUN}`);
    expect(batched).toContain(PHONE_D);
    for (const gone of [PHONE_A, SAID_A, NAME_A]) expect(batched).not.toContain(gone);

    const req = await one<Record<string, unknown>>('select * from deletion_requests where id = $1', [A.req]);
    expect(req).toMatchObject({ state: 'done', closed_by: 'Operator Test', client_id: A.client });
    expect(req['closed_at']).not.toBeNull();
    expect(String(req['closed_note'])).toMatch(/^erased \d+: .*\bmessages 4\b.* · kept \d+: .*\borders 1\b.*\bsuppressions 1\b/);
    expect(String(req['closed_note'])).toMatch(/changed in place 4: channel_audit 2, channel_events 1, spot_checks 1/);
  });

  it('nothing in their business still names them — except the suppression that keeps them from being written to again', async () => {
    expect(await mentioning(db, [B1], PHONE_A)).toEqual([]);
    expect(await mentioning(db, [B1], IG_A)).toEqual([]);
    expect(await mentioning(db, [B1], NAME_A)).toEqual([]);
    expect(await mentioning(db, [B1], SAID_A)).toEqual([]);
    // The suppression — and the second buyer row the request does not name.
    expect(await mentioning(db, [B1], EMAIL_A)).toEqual(['clients', 'suppressions']);
    expect((await db.query('select email from clients where id = $1', [Y.client])).rows[0]).toEqual({ email: EMAIL_A });
    // The same person in another business is that business's buyer, untouched.
    expect(await mentioning(db, [B2], PHONE_A)).toEqual(['channel_audit', 'channel_events', 'clients', 'pilot_allowlist']);
    expect(await mentioning(db, [B2], EMAIL_A)).toEqual(['clients', 'contact_consent', 'contacts', 'suppressions']);
    expect(await mentioning(db, [B2], SAID_A)).toEqual(['channel_events', 'messages', 'pgboss.job']);
  });

  it('a second run refuses: the request is no longer open', async () => {
    const before = await snapshot(db, [B1, B2]);
    const again = tool(go);
    expect(again.code).toBe(1);
    expect(again.err).toMatch(/is done on \d{4}-\d{2}-\d{2} by Operator Test, not open/);
    expect(diff(before, await snapshot(db, [B1, B2]))).toEqual({ removed: [], changed: [], added: [] });
  });

  it('a later request for the same buyer finds nothing left, and its own run closes it as done', async () => {
    await ins('deletion_requests', { id: A.dup, business_id: B1, scope: 'buyer', client_id: A.client, asked_by: 'owner' });
    const before = await snapshot(db, [B1, B2]);
    const dry = tool(['--request', A.dup]);
    expect(dry.code).toBe(0);
    expect(dry.out).toMatch(/ERASED\n {9}— {2}nothing/);
    expect(dry.out).toContain('identities: none left');

    const r = tool(['--request', A.dup, '--yes', '--confirm', A.dup.slice(0, 8), '--by', 'Operator Test']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const again = diff(before, await snapshot(db, [B1, B2]));
    expect(again.removed).toEqual([]);
    expect(again.changed).toEqual([`deletion_requests:${k(A.dup)}`]);
    // The audit trail's line for this request; nothing of theirs was left to change.
    expect(again.added).toHaveLength(1);
    expect(again.added[0]).toMatch(/^channel_audit:/);
    const closed = (await db.query<{ state: string; closed_note: string }>('select state, closed_note from deletion_requests where id = $1', [A.dup])).rows[0]!;
    expect(closed.state).toBe('done');
    expect(closed.closed_note).toMatch(/^erased 0: nothing · kept \d+: /);
  });
});
