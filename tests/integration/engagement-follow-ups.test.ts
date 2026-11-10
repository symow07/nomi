import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createDb, withTenantTx, type Db } from '../../src/db/client.js';
import { foldFollowUpQuote } from '../../src/db/followUps.js';
import type { BusinessId } from '../../src/core/types/ids.js';
import { runDueFollowUps, sweepFollowUpWorkspaces } from '../../src/outbound/followUps.js';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const suite = process.env['DATABASE_URL'] && process.env['MIGRATE_DATABASE_URL'] ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

suite('One owner-written follow-up, drafts only (requires DATABASE_URL)', () => {
  let admin: pg.Client;
  let db: Db;
  let business: string, customer: string, conversation: string, product: string, quote: string;
  const T0 = new Date('2031-05-01T09:00:00Z');
  let seq = 0;
  const query = (text: string, values: unknown[] = []) => admin.query(text, values);
  const one = async (text: string, values: unknown[] = []) => (await query(text, values)).rows[0];
  const sweep = (days = 2) => runDueFollowUps({ db, now: () => new Date(T0.getTime() + days * 86400000) }, business as BusinessId);
  const rule = () => query(`insert into follow_up_rules (business_id, enabled, enabled_at, wording)
    values ($1, true, $2, 'Would you like to ask anything about the quote?')`, [business, new Date(T0.getTime() - 1)]);
  const outbound = (status = 'sent', linked: string | null = quote, when = T0) => one(`insert into outbound_messages
    (business_id, conversation_id, seq, body, status, origin, quote_id, sent_at)
    values ($1, $2, $3, 'The price is 12 dollars.', $4, 'employee', $5, $6) returning *`,
    [business, conversation, ++seq, status, linked, status === 'sent' ? when : null]);
  const inbound = (when = new Date(T0.getTime() + 1000), type = 'text') => one(`insert into messages
    (conversation_id, external_id, direction, input_type, text_content, sent_at)
    values ($1, $2, 'inbound', $3, 'A customer answer', $4) returning *`, [conversation, randomUUID(), type, when]);
  const run = async (draft = false) => {
    const out = await outbound();
    const draftId = draft ? randomUUID() : null;
    if (draftId) await query(`insert into drafts (id, business_id, conversation_id, capability, draft_text)
      values ($1, $2, $3, 'follow_up', 'The owner’s exact words')`, [draftId, business, conversation]);
    return one(`insert into follow_up_runs (business_id, client_id, conversation_id, source_quote_id,
      source_outbound_id, episode_key, channel, quoted_at, due_at, delay_days, wording, state, draft_id)
      values ($1, $2, $3, $4, $5, $2, 'telegram', $6, $7, 2, 'The owner’s exact words', $8, $9) returning *`,
      [business, customer, conversation, quote, out.id, T0, new Date(T0.getTime() + 172800000), draft ? 'draft' : 'scheduled', draftId]);
  };
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] });
    await admin.connect();
    db = createDb(process.env['DATABASE_URL']!);
  });
  afterAll(async () => { await admin?.end(); await db?.destroy(); });
  beforeEach(async () => {
    business = randomUUID(); customer = randomUUID(); conversation = randomUUID(); product = randomUUID(); quote = randomUUID();
    await query(`insert into businesses (id, name, timezone) values ($1, 'Follow-up test shop', 'UTC')`, [business]);
    await query(`insert into clients (id, business_id, display_name) values ($1, $2, 'Customer')`, [customer, business]);
    await query(`insert into conversations (id, business_id, client_id, channel) values ($1, $2, $3, 'telegram')`, [conversation, business, customer]);
    await query(`insert into products (id, business_id, sku, name, unit) values ($1, $2, 'BALM', 'Lip balm', 'item')`, [product, business]);
    await query(`insert into quotes (id, business_id, conversation_id, product_id, quantity, inputs, unit_price_usd,
      discount_pct, total_usd, requires_human, applied_rules, engine_version)
      values ($1, $2, $3, $4, 1, '{}', 12, 0, 12, false, '{}', 'fixture')`, [quote, business, conversation, product]);
  });

  it('stores workspace rules and customer runs separately, with tenant isolation', async () => {
    const rows = (await admin.query(`select relname, relrowsecurity from pg_class
      where relname in ('follow_up_rules', 'follow_up_runs', 'follow_up_observations', 'follow_up_approvals') order by relname`)).rows;
    expect(rows).toEqual([
      { relname: 'follow_up_approvals', relrowsecurity: true },
      { relname: 'follow_up_observations', relrowsecurity: true },
      { relname: 'follow_up_rules', relrowsecurity: true },
      { relname: 'follow_up_runs', relrowsecurity: true },
    ]);
  });

  it('keeps fresh rules off and never backfills an already accepted quote', async () => {
    await outbound();
    await query(`insert into follow_up_rules (business_id) values ($1)`, [business]);
    expect((await one(`select * from follow_up_rules where business_id = $1`, [business])).enabled).toBe(false);
    await query(`update follow_up_rules set enabled = true, enabled_at = $2, wording = 'Owner words' where business_id = $1`, [business, T0]);
    expect((await one(`select count(*)::int as n from follow_up_observations where business_id = $1`, [business])).n).toBe(0);
  });

  it('observes only an exact quote whose outbound reaches sent, keeping the rule snapshot', async () => {
    await rule();
    for (const state of ['queued', 'sending', 'failed', 'uncertain']) await outbound(state);
    await outbound('sent', null);
    expect((await one(`select count(*)::int as n from follow_up_observations where business_id = $1`, [business])).n).toBe(0);
    const queued = await outbound('queued');
    await query(`update outbound_messages set status = 'sent', sent_at = $2 where id = $1`, [queued.id, T0]);
    await query(`update follow_up_rules set wording = 'Changed words', delay_days = 7 where business_id = $1`, [business]);
    const rows = (await query(`select * from follow_up_observations where business_id = $1 and kind = 'quote'`, [business])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outbound_id: queued.id, quote_id: quote, delay_days: 2, wording: 'Would you like to ask anything about the quote?' });
  });

  it('lets the sent row commit and keeps a warning when its quote observer fails', async () => {
    await rule();
    await query(`alter table follow_up_observations add constraint follow_up_test_fault check (business_id <> '${business}' or kind <> 'quote')`);
    try {
      const sent = await outbound();
      expect(sent.status).toBe('sent');
      const warning = await one(`select * from follow_up_observations where business_id = $1`, [business]);
      expect(warning).toMatchObject({ kind: 'warning', client_id: null, wording: null });
      expect(warning.diagnostic_code).toContain('23514');
    } finally { await query(`alter table follow_up_observations drop constraint follow_up_test_fault`); }
  });

  it('persists every inbound kind and supersedes only its own pending follow-up', async () => {
    const own = await run(true);
    const other = await one(`insert into drafts (business_id, conversation_id, capability, draft_text)
      values ($1, $2, 'qualify', 'An unrelated draft') returning id`, [business, conversation]);
    for (const type of ['text', 'voice', 'image', 'image_text', 'voice_transcribed', 'unknown']) await inbound(undefined, type);
    expect((await one(`select status from drafts where id = $1`, [own.draft_id])).status).toBe('superseded');
    expect((await one(`select status from drafts where id = $1`, [other.id])).status).toBe('pending');
    expect((await one(`select * from follow_up_runs where id = $1`, [own.id]))).toMatchObject({ state: 'canceled', reason: 'customer_answered' });
  });

  it('lets an inbound persist when cancellation fails, and records the failure', async () => {
    const own = await run(true);
    await query(`alter table follow_up_runs add constraint follow_up_test_fault check (business_id <> '${business}' or state <> 'canceled')`);
    try {
      const message = await inbound();
      expect((await one(`select id from messages where id = $1`, [message.id])).id).toBe(message.id);
      expect((await one(`select status from drafts where id = $1`, [own.draft_id])).status).toBe('pending');
      expect((await one(`select diagnostic_code from follow_up_observations where business_id = $1 and kind = 'warning'`, [business])).diagnostic_code).toContain('23514');
    } finally { await query(`alter table follow_up_runs drop constraint follow_up_test_fault`); }
  });

  it('lets approval commit when its observer fails', async () => {
    const own = await run(true);
    await query(`alter table follow_up_approvals add constraint follow_up_test_fault check (business_id <> '${business}')`);
    try {
      await query(`update drafts set status = 'approved', sent_text = draft_text, decided_at = $2 where id = $1`, [own.draft_id, T0]);
      expect((await one(`select status from drafts where id = $1`, [own.draft_id])).status).toBe('approved');
      expect((await one(`select diagnostic_code from follow_up_observations where business_id = $1 and kind = 'warning'`, [business])).diagnostic_code).toContain('23514');
    } finally { await query(`alter table follow_up_approvals drop constraint follow_up_test_fault`); }
  });

  it('links the outbound in the approval transaction, never another copy of the same words', async () => {
    const own = await run(true);
    await query('begin');
    let linked: { id: string };
    try {
      await query(`update drafts set status = 'edited', sent_text = 'Edited by the owner', decided_at = $2 where id = $1`, [own.draft_id, T0]);
      linked = await one(`insert into outbound_messages (business_id, conversation_id, seq, body, origin, approved)
        values ($1, $2, $3, 'Edited by the owner', 'employee', true) returning id`, [business, conversation, ++seq]);
      await query('commit');
    } catch (error) { await query('rollback'); throw error; }
    await query(`insert into outbound_messages (business_id, conversation_id, seq, body, origin, approved)
      values ($1, $2, $3, 'Edited by the owner', 'employee', true)`, [business, conversation, ++seq]);
    const accepted = new Date(T0.getTime() + 172800000);
    await query(`update outbound_messages set status = 'sent', sent_at = $2 where id = $1`, [linked.id, accepted]);
    expect(await one(`select outbound_id, accepted_at from follow_up_approvals where draft_id = $1`, [own.draft_id]))
      .toEqual({ outbound_id: linked.id, accepted_at: accepted });
  });

  it('does not wait on a draft held by approval; the owner tap wins and the race is visible', async () => {
    const own = await run(true);
    const approving = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] });
    await approving.connect();
    try {
      await approving.query('begin');
      await approving.query(`select id from drafts where id = $1 for update`, [own.draft_id]);
      await query(`set statement_timeout = '2s'`);
      await inbound();
      await approving.query(`update drafts set status = 'approved', sent_text = draft_text, decided_at = $2 where id = $1`, [own.draft_id, T0]);
      await approving.query('commit');
      expect(await one(`select state, answered_after_approval, reason from follow_up_runs where id = $1`, [own.id]))
        .toMatchObject({ state: 'draft', answered_after_approval: true, reason: 'answer_during_approval' });
      expect((await one(`select status from drafts where id = $1`, [own.draft_id])).status).toBe('approved');
    } finally { await approving.query('rollback'); await approving.end(); await query('set statement_timeout = default'); }
  });

  it('erases the customer observations, words, run and approval link, including restore replay', async () => {
    await rule();
    const own = await run(true);
    await query(`update drafts set status = 'approved', sent_text = draft_text, decided_at = $2 where id = $1`, [own.draft_id, T0]);
    const result = (await one(`select erase_customer_rows($1, $2, null, true) as counts`, [business, customer])).counts;
    expect(result.erased).toMatchObject({ follow_up_observations: 1, follow_up_runs: 1, follow_up_approvals: 1 });
    expect(result.changed ?? {}).not.toHaveProperty('follow_up_runs');
    expect((await one(`select count(*)::int as n from follow_up_rules where business_id = $1`, [business])).n).toBe(1);
    const repeated = (await one(`select erase_customer_rows($1, $2, null, true) as counts`, [business, customer])).counts;
    expect(repeated.erased ?? {}).not.toHaveProperty('follow_up_runs');
    expect((await one(`select count(*)::int as n from follow_up_runs where client_id = $1`, [customer])).n).toBe(0);
  });

  it('THE TOOL ERASES THEM: tools/erase-buyer.mjs, dry run then --yes, on a customer with rows in every follow-up table', async () => {
    const count = async (client: string) => {
      const row = await one(`select
        (select count(*)::int from follow_up_observations where client_id = $1) as observations,
        (select count(*)::int from follow_up_runs where client_id = $1) as runs,
        (select count(*)::int from follow_up_approvals a join follow_up_runs r on r.id = a.run_id where r.client_id = $1) as approvals`, [client]);
      return row as { observations: number; runs: number; approvals: number };
    };
    await rule();
    // Another customer of the same workspace, with rows of their own in every table: kept.
    const target = { customer, conversation, quote };
    const other = { customer: randomUUID(), conversation: randomUUID(), quote: randomUUID() };
    await query(`insert into clients (id, business_id, display_name) values ($1, $2, 'Other customer')`, [other.customer, business]);
    await query(`insert into conversations (id, business_id, client_id, channel) values ($1, $2, $3, 'telegram')`, [other.conversation, business, other.customer]);
    await query(`insert into quotes (id, business_id, conversation_id, product_id, quantity, inputs, unit_price_usd,
      discount_pct, total_usd, requires_human, applied_rules, engine_version)
      values ($1, $2, $3, $4, 1, '{}', 12, 0, 12, false, '{}', 'fixture')`, [other.quote, business, other.conversation, product]);
    for (const who of [target, other]) {
      ({ customer, conversation, quote } = who);
      const own = await run(true);
      await query(`update drafts set status = 'approved', sent_text = draft_text, decided_at = $2 where id = $1`, [own.draft_id, T0]);
      await outbound();   // a second accepted quote: another observation
    }
    ({ customer, conversation, quote } = target);
    const before = await count(target.customer);
    expect(before).toEqual({ observations: 2, runs: 1, approvals: 1 });
    expect(await count(other.customer)).toEqual(before);

    const req = (await one(`insert into deletion_requests (business_id, scope, client_id, asked_by)
      values ($1, 'buyer', $2, 'owner') returning id::text as id`, [business, target.customer])).id as string;
    const tool = (...extra: string[]) => spawnSync(process.execPath, ['tools/erase-buyer.mjs', '--request', req, ...extra],
      { cwd: ROOT, env: { ...process.env, MIGRATE_DATABASE_URL: process.env['MIGRATE_DATABASE_URL'] }, encoding: 'utf8', timeout: 120_000 });
    const dry = tool();
    expect(dry.stderr).toBe('');
    expect(dry.status).toBe(0);
    expect(dry.stdout).toMatch(/follow_up_runs/);
    expect(await count(target.customer)).toEqual(before);   // a dry run changes nothing

    const done = tool('--yes', '--confirm', req.slice(0, 8), '--by', 'Operator Test');
    expect(done.stderr).toBe('');
    expect(done.status).toBe(0);
    expect(await count(target.customer)).toEqual({ observations: 0, runs: 0, approvals: 0 });
    const ledger = (await one('select counts from erasure_ledger where request_id = $1', [req])).counts;
    expect(ledger.erased).toMatchObject({ follow_up_observations: 2, follow_up_runs: 1, follow_up_approvals: 1 });
    for (const t of ['follow_up_observations', 'follow_up_runs', 'follow_up_approvals']) expect(ledger.changed ?? {}).not.toHaveProperty(t);
    expect((await one('select state from deletion_requests where id = $1', [req])).state).toBe('done');
    expect(await count(other.customer)).toEqual({ observations: 2, runs: 1, approvals: 1 });
    expect((await one(`select count(*)::int as n from follow_up_rules where business_id = $1`, [business])).n).toBe(1);
  });

  it('keeps app-role reads inside the workspace and excludes accountants', async () => {
    const own = await run(true);
    const app = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
    await app.connect();
    try {
      await app.query('begin');
      await app.query(`select set_config('app.business_id', $1, true)`, [randomUUID()]);
      expect((await app.query(`select id from follow_up_runs where id = $1`, [own.id])).rows).toHaveLength(0);
      await app.query(`select set_config('app.business_id', $1, true)`, [business]);
      expect((await app.query(`select id from follow_up_runs where id = $1`, [own.id])).rows).toHaveLength(1);
      const accountant = await one(`insert into people (business_id, name, is_owner, kind) values ($1, 'Bookkeeper', false, 'accountant') returning id`, [business]);
      await app.query(`select set_config('app.viewer_id', $1, true)`, [accountant.id]);
      expect((await app.query(`select id from follow_up_runs where id = $1`, [own.id])).rows).toHaveLength(0);
    } finally { await app.query('rollback'); await app.end(); }
  });

  it('uses an injected clock: none at 48h minus 1ms, one at 48h and still one days later', async () => {
    await rule(); await outbound();
    const sweep = (ms: number) => runDueFollowUps({ db, now: () => new Date(T0.getTime() + ms) }, business as BusinessId);
    expect(await sweep(172800000 - 1)).toBe(0);
    expect(await sweep(172800000)).toBe(1);
    expect(await sweep(9 * 86400000)).toBe(0);
    const drafts = (await query(`select * from drafts where business_id = $1`, [business])).rows;
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ status: 'pending', capability: 'follow_up', turn_message_id: null,
      draft_text: 'Would you like to ask anything about the quote?' });
    expect((await one(`select count(*)::int as n from outbound_messages where business_id = $1`, [business])).n).toBe(1);
    expect((await one(`select count(*)::int as n from usage_ledger where business_id = $1`, [business])).n).toBe(0);
  });

  it('still cancels from messages when the inbound observer was deliberately dropped', async () => {
    await rule(); await outbound(); await sweep(1);
    await query('alter table messages disable trigger follow_up_customer_answer');
    try { await inbound(); } finally { await query('alter table messages enable trigger follow_up_customer_answer'); }
    expect(await sweep()).toBe(0);
    expect(await one(`select state, reason from follow_up_runs where business_id = $1`, [business]))
      .toEqual({ state: 'canceled', reason: 'customer_answered' });
    expect((await one(`select count(*)::int as n from drafts where business_id = $1`, [business])).n).toBe(0);
  });

  it('also retires an existing pending draft after a dropped inbound observation', async () => {
    await rule(); await outbound(); expect(await sweep()).toBe(1);
    await query('alter table messages disable trigger follow_up_customer_answer');
    try { await inbound(new Date(T0.getTime() + 3 * 86400000)); }
    finally { await query('alter table messages enable trigger follow_up_customer_answer'); }
    await sweep(3);
    expect((await one(`select status from drafts where business_id = $1`, [business])).status).toBe('superseded');
  });

  it('retires a closed-window notice too when the inbound observer was dropped', async () => {
    await query(`update conversations set channel = 'whatsapp' where id = $1`, [conversation]);
    await rule(); await outbound(); await sweep();
    expect((await one(`select state from follow_up_runs where business_id = $1`, [business])).state).toBe('window_closed');
    await query(`alter table messages disable trigger follow_up_customer_answer`);
    try { await inbound(new Date(T0.getTime() + 3 * 86400000)); }
    finally { await query(`alter table messages enable trigger follow_up_customer_answer`); }
    await sweepFollowUpWorkspaces({ db, now: () => new Date(T0.getTime() + 4 * 86400000) });
    expect(await one(`select state, reason from follow_up_runs where business_id = $1`, [business]))
      .toEqual({ state: 'canceled', reason: 'customer_answered' });
  });

  it('bounds each sweep to 100 runs and reaches the remainder on the next sweep', async () => {
    const first = await run();
    await query(`insert into follow_up_runs(business_id, client_id, conversation_id, source_quote_id, source_outbound_id,
      episode_key, channel, quoted_at, due_at, delay_days, wording)
      select business_id, client_id, conversation_id, source_quote_id, source_outbound_id, gen_random_uuid(),
        channel, quoted_at, due_at, delay_days, wording from follow_up_runs cross join generate_series(1, 101)
      where id = $1`, [first.id]);
    expect(await sweep()).toBe(100);
    expect(await sweep()).toBe(2);
    expect(await sweep(7)).toBe(0);
    expect((await one(`select count(*)::int as n from drafts where business_id = $1`, [business])).n).toBe(102);
  });

  it('cancels at the existing daily allowance and creates no usage of its own', async () => {
    await rule(); await outbound();
    await query(`insert into tenant_budgets(business_id, daily_llm_calls, daily_tokens, soft_warn_pct, on_exceeded)
      values ($1, 1, 100, 80, 'pause')`, [business]);
    await query(`insert into usage_ledger(business_id, day, llm_calls, input_tokens, output_tokens)
      values ($1, (now() at time zone 'UTC')::date, 1, 0, 0)`, [business]);
    const usage = (await query(`select * from usage_ledger where business_id = $1`, [business])).rows;
    expect(await sweep()).toBe(0);
    expect((await one(`select reason from follow_up_runs where business_id = $1`, [business])).reason).toBe('allowance');
    expect((await query(`select * from usage_ledger where business_id = $1`, [business])).rows).toEqual(usage);
  });

  it('cancels at the existing billing hold without queuing a follow-up', async () => {
    await rule(); await outbound();
    await query(`update businesses set signed_up_at = now() where id = $1`, [business]);
    await query(`insert into workspace_billing(business_id, status) values ($1, 'lapsed')`, [business]);
    expect(await sweep()).toBe(0);
    expect((await one(`select reason from follow_up_runs where business_id = $1`, [business])).reason).toBe('billing');
    expect((await one(`select count(*)::int as n from outbound_messages where business_id = $1`, [business])).n).toBe(1);
  });

  it('concurrent sweeps and a retry create exactly one draft and no outbound', async () => {
    await rule(); await outbound();
    expect((await Promise.all([sweep(), sweep(), sweep()])).reduce((a, b) => a + b, 0)).toBe(1);
    expect(await sweep(3)).toBe(0);
    expect((await one(`select count(*)::int as n from drafts where business_id = $1`, [business])).n).toBe(1);
    expect((await one(`select count(*)::int as n from outbound_messages where business_id = $1`, [business])).n).toBe(1);
  });

  it('moves the due time for a newer quote before it is due, keeping the original words and delay', async () => {
    await rule(); await outbound(); await sweep(0);
    await query(`update follow_up_rules set wording = 'A future rule', delay_days = 7 where business_id = $1`, [business]);
    await outbound('sent', quote, new Date(T0.getTime() + 86400000));
    expect(await sweep(2)).toBe(0);
    expect(await sweep(3)).toBe(1);
    expect(await one(`select due_at, wording, delay_days from follow_up_runs where business_id = $1`, [business]))
      .toMatchObject({ due_at: new Date(T0.getTime() + 3 * 86400000), delay_days: 2, wording: 'Would you like to ask anything about the quote?' });
  });

  it.each(['sent', 'delivered', 'read', 'during_window_check'])('recovers a dropped newer quote (%s) before presenting, with a recorded anchor move', async (stage) => {
    await rule(); const original = await outbound(); await sweep(0);
    const initial = await one(`select * from follow_up_runs where business_id = $1`, [business]);
    let newer: { id: string } | undefined;
    const acceptWithoutObservation = async () => {
      const lock = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] });
      await lock.connect();
      try {
        await lock.query('begin');
        await lock.query('select id from clients where id = $1 for update', [customer]);
        newer = await outbound('sent', quote, new Date(T0.getTime() + 86400000));
        if (stage === 'delivered' || stage === 'read') await query('update outbound_messages set status = $2 where id = $1', [newer!.id, stage]);
      } finally { await lock.query('rollback'); await lock.end(); }
      expect((await one(`select count(*)::int as n from follow_up_observations where outbound_id = $1`, [newer!.id])).n).toBe(0);
      expect((await one(`select count(*)::int as n from follow_up_observations where business_id = $1 and kind = 'warning' and diagnostic_code like '%55P03'`, [business])).n).toBe(1);
    };
    if (stage === 'during_window_check') {
      // A real accepted row commits after the due-time read but before the final draft read.
      // The plugin supplies a deterministic barrier; it does not change any query or result.
      const barrierDb = db.withPlugin({
        transformQuery: ({ node }) => node,
        transformResult: async ({ result }) => {
          if (!newer && result.rows.some(row => Object.hasOwn(row as object, 'last_inbound_at'))) await acceptWithoutObservation();
          return result;
        },
      });
      expect(await runDueFollowUps({ db: barrierDb, now: () => new Date(T0.getTime() + 172800000) }, business as BusinessId)).toBe(0);
    } else { await acceptWithoutObservation(); expect(await sweep(2)).toBe(0); }
    expect(await one(`select source_outbound_id, quoted_at, due_at, state from follow_up_runs where id = $1`, [initial.id]))
      .toEqual({ source_outbound_id: newer!.id, quoted_at: new Date(T0.getTime() + 86400000), due_at: new Date(T0.getTime() + 259200000), state: 'scheduled' });
    expect((await query(`select payload from conversation_events where business_id = $1 and type = 'follow_up_rescheduled'`, [business])).rows)
      .toEqual([{ payload: { followUpRunId: initial.id, previousOutboundId: original.id, outboundId: newer!.id,
        previousQuoteId: quote, quoteId: quote, previousDueAt: initial.due_at.toISOString(), dueAt: new Date(T0.getTime() + 259200000).toISOString() } }]);
    expect(await sweep(3 - 1 / 86400000)).toBe(0);
    expect(await sweep(3)).toBe(1);
    expect(await sweep(5)).toBe(0);
    expect((await one(`select count(*)::int as n from drafts where business_id = $1`, [business])).n).toBe(1);
    expect((await one(`select count(*)::int as n from outbound_messages where business_id = $1`, [business])).n).toBe(2);
  });

  it('never rearms a presented episode until an answer AND a fresh sent quote', async () => {
    await rule(); await outbound(); expect(await sweep()).toBe(1);
    const original = await one(`select source_outbound_id, quoted_at, due_at from follow_up_runs where business_id = $1`, [business]);
    await outbound('sent', quote, new Date(T0.getTime() + 3 * 86400000));
    expect(await sweep(6)).toBe(0);
    expect(await one(`select source_outbound_id, quoted_at, due_at from follow_up_runs where business_id = $1`, [business])).toEqual(original);
    await inbound(new Date(T0.getTime() + 7 * 86400000));
    expect(await sweep(8)).toBe(0);
    await outbound('sent', quote, new Date(T0.getTime() + 8 * 86400000));
    expect(await sweep(10)).toBe(1);
    expect((await one(`select count(*)::int as n from drafts where business_id = $1`, [business])).n).toBe(2);
  });

  it('does not move an anchor to an accepted row dated beyond the injected clock', async () => {
    await rule(); const original = await outbound(); await sweep(0);
    await outbound('sent', quote, new Date(T0.getTime() + 3 * 86400000));
    expect(await sweep(2)).toBe(1);
    expect((await one(`select source_outbound_id from follow_up_runs where business_id = $1`, [business])).source_outbound_id).toBe(original.id);
  });

  it.each([
    ['linked email', false, 24], ['linked email', true, 24],
    ['after the old due time', false, 49], ['after the old due time', true, 49],
    ['another customer', false, 24], ['another customer', true, 24],
  ] as const)('%s, observation dropped=%s: both paths use the client’s latest accepted quote', async (scenario, dropped, hours) => {
    await rule(); const first = await outbound(); await sweep(0);
    const original = await one(`select * from follow_up_runs where business_id = $1`, [business]);
    const nextConversation = randomUUID(), nextQuote = randomUUID();
    const nextCustomer = scenario === 'another customer' ? randomUUID() : customer;
    if (nextCustomer !== customer) await query(`insert into clients(id, business_id, display_name) values ($1, $2, 'Other customer')`, [nextCustomer, business]);
    await query(`insert into conversations(id, business_id, client_id, channel) values ($1, $2, $3, 'email')`, [nextConversation, business, nextCustomer]);
    await query(`insert into quotes(id, business_id, conversation_id, product_id, quantity, inputs, unit_price_usd, total_usd, engine_version)
      values ($1, $2, $3, $4, 1, '{}', 12, 12, 'fixture')`, [nextQuote, business, nextConversation, product]);
    const lock = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] });
    await lock.connect();
    let newer: { id: string };
    try {
      await lock.query('begin');
      if (dropped) await lock.query('select id from clients where id = $1 for update', [nextCustomer]);
      newer = await one(`insert into outbound_messages(business_id, conversation_id, seq, body, status, quote_id, sent_at)
        values ($1, $2, 1, 'A newer quote', 'sent', $3, $4) returning id`, [business, nextConversation, nextQuote, new Date(T0.getTime() + hours * 3600000)]);
    } finally { await lock.query('rollback'); await lock.end(); }
    const observations = (await query(`select id from follow_up_observations where outbound_id = $1`, [newer!.id])).rows;
    expect(observations).toHaveLength(dropped ? 0 : 1);
    const at = new Date(T0.getTime() + Math.max(48, hours + 1) * 3600000);
    if (!dropped) {
      // Hold the observation path itself, before the recovery sweep can repair it.
      await withTenantTx(db, business as BusinessId, tx => foldFollowUpQuote(tx, business as BusinessId, observations[0].id, at));
      expect((await one(`select source_outbound_id from follow_up_runs where id = $1`, [original.id])).source_outbound_id)
        .toBe(scenario === 'another customer' ? first.id : newer!.id);
    }
    const made = await runDueFollowUps({ db, now: () => at }, business as BusinessId);
    const current = await one(`select * from follow_up_runs where id = $1`, [original.id]);
    if (scenario === 'another customer') {
      expect(made).toBe(1);
      expect(current).toMatchObject({ source_outbound_id: first.id, conversation_id: conversation, channel: 'telegram', due_at: original.due_at, state: 'draft' });
    } else {
      expect(made).toBe(0);
      const due = new Date(T0.getTime() + (hours + 48) * 3600000);
      expect(current).toMatchObject({ source_outbound_id: newer!.id, source_quote_id: nextQuote, conversation_id: nextConversation, channel: 'email', due_at: due, state: 'scheduled' });
      expect(await runDueFollowUps({ db, now: () => new Date(due.getTime() - 1) }, business as BusinessId)).toBe(0);
      expect(await runDueFollowUps({ db, now: () => due }, business as BusinessId)).toBe(1);
      expect((await query(`select payload from conversation_events where business_id = $1 and type = 'follow_up_rescheduled' and payload->>'followUpRunId' = $2`, [business, original.id])).rows)
        .toEqual([{ payload: { followUpRunId: original.id, previousOutboundId: first.id, outboundId: newer!.id,
          previousQuoteId: quote, quoteId: nextQuote, previousDueAt: original.due_at.toISOString(), dueAt: due.toISOString() } }]);
    }
  });

  it('recovers only the latest accepted exact quote in this conversation, never a queued or unlinked row', async () => {
    await rule(); await outbound(); await sweep(0);
    const lock = new pg.Client({ connectionString: process.env['MIGRATE_DATABASE_URL'] });
    await lock.connect();
    let latest: { id: string };
    try {
      await lock.query('begin');
      await lock.query('select id from clients where id = $1 for update', [customer]);
      await outbound('sent', quote, new Date(T0.getTime() + 86400000));
      latest = await outbound('sent', quote, new Date(T0.getTime() + 36 * 3600000));
    } finally { await lock.query('rollback'); await lock.end(); }
    for (const status of ['queued', 'failed', 'uncertain']) {
      const row = await outbound(status);
      await query('update outbound_messages set sent_at = $2 where id = $1', [row.id, new Date(T0.getTime() + 47 * 3600000)]);
    }
    await outbound('sent', null, new Date(T0.getTime() + 47 * 3600000));
    expect(await sweep(2)).toBe(0);
    expect(await one(`select source_outbound_id, due_at from follow_up_runs where business_id = $1`, [business]))
      .toEqual({ source_outbound_id: latest!.id, due_at: new Date(T0.getTime() + 84 * 3600000) });
    expect(await sweep(3)).toBe(0);
    expect(await sweep(3.5)).toBe(1);
  });

  it.each(['whatsapp', 'messenger', 'instagram'])('records a closed %s window without creating a stale draft', async (channel) => {
    await query(`update conversations set channel = $2 where id = $1`, [conversation, channel]);
    await rule(); await outbound();
    expect(await sweep()).toBe(0);
    expect(await one(`select state, reason from follow_up_runs where business_id = $1`, [business]))
      .toEqual({ state: 'window_closed', reason: 'window_closed' });
    expect((await one(`select count(*)::int as n from drafts where business_id = $1`, [business])).n).toBe(0);
  });

  it.each(['telegram', 'web_chat', 'email'])('creates a draft on %s without any sender or model dependency', async (channel) => {
    await query(`update conversations set channel = $2 where id = $1`, [conversation, channel]);
    await rule(); await outbound(); expect(await sweep()).toBe(1);
    expect((await one(`select count(*)::int as n from usage_ledger where business_id = $1`, [business])).n).toBe(0);
  });

  it.each(['stopped', 'silenced', 'held_by_person', 'conversation_closed', 'deletion', 'opted_out', 'unsubscribed'])('cancels %s once, without later backlog', async (reason) => {
    await rule(); await outbound(); await sweep(0);
    if (reason === 'stopped') await query(`update businesses set assistant_stopped_at = now() where id = $1`, [business]);
    if (reason === 'silenced') await query(`insert into ops_flags(business_id, flag, set_by, reason) values ($1, 'global_silence', 'test', 'fixture')`, [business]);
    if (reason === 'held_by_person') await query(`update conversations set assigned_to = 'owner' where id = $1`, [conversation]);
    if (reason === 'conversation_closed') await query(`update conversations set is_active = false where id = $1`, [conversation]);
    if (reason === 'deletion') await query(`insert into deletion_asks (business_id, client_id, conversation_id, asked_at) values ($1, $2, $3, $4)`, [business, customer, conversation, T0]);
    if (reason === 'opted_out' || reason === 'unsubscribed') {
      await query(`insert into client_channels(client_id, channel, channel_user_id) values ($1, 'email', $2)`, [customer, customer + '@example.test']);
      if (reason === 'opted_out') await query(`insert into opt_outs(business_id, channel, identity, recorded_by) values ($1, 'email', $2, 'owner')`, [business, customer + '@example.test']);
      else await query(`insert into suppressions(business_id, channel, identity, reason) values ($1, 'email', $2, 'unsubscribed')`, [business, customer + '@example.test']);
    }
    expect(await sweep()).toBe(0);
    expect(await one(`select state, reason from follow_up_runs where business_id = $1`, [business]))
      .toEqual({ state: 'canceled', reason });
    await query(`update businesses set assistant_stopped_at = null where id = $1`, [business]);
    expect(await sweep(8)).toBe(0);
  });

  it('never observes owner tests or Practice quotes', async () => {
    await rule();
    await query(`update conversations set owner_testing = true where id = $1`, [conversation]); await outbound();
    await query(`update conversations set owner_testing = false where id = $1`, [conversation]);
    const live = randomUUID();
    await query(`insert into businesses(id, name) values ($1, 'Live fixture')`, [live]);
    await query(`update businesses set practice_of = $2 where id = $1`, [business, live]); await outbound();
    expect(await sweep()).toBe(0);
    expect((await one(`select count(*)::int as n from follow_up_observations where business_id = $1`, [business])).n).toBe(0);
  });

  it('has no unclassified customer tables or relationships', async () => {
    expect((await one('select customer_erasure_problems() as problems')).problems).toEqual([]);
  });
});
