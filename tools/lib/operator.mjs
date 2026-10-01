/**
 * G7 — THE OPERATOR'S CONTROLS (the plan's KS2–KS4 and KS6's stop flag),
 * called by tools/suspend-workspace.mjs, tools/ops-flags.mjs and
 * tools/workspaces.mjs over the ADMIN connection: they reach every workspace,
 * which the app role never does. Every write here is the operator's; the app
 * only reads what they leave (ops_flags, meta_accounts, is_active).
 *
 * A pg client, and — for the Page — Meta's two calls passed in: the tools hand
 * in the built `subscribeMetaPage` / `unsubscribeMetaPage`, a test a recorder.
 *
 * @typedef {{ query(text: string, values?: readonly unknown[]): Promise<{ rows: any[]; rowCount: number | null }> }} Query
 * @typedef {{
 *   openToken: (ciphertext: string) => string | null,
 *   subscribe: (page: { pageId: string, token: string }) => Promise<boolean>,
 *   unsubscribe: (page: { pageId: string, token: string }) => Promise<void>,
 * }} GraphDeps
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The capabilities force_draft holds back, one row each (0014); confirm_order already always drafts. */
export const FORCE_DRAFT_CAPABILITIES = ['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'follow_up'];
export const OPERATOR_FLAGS = ['global_silence', 'force_draft', 'connections_off', 'practice_off', 'approve_connections'];
/** KS6 — flags that exist only for the whole installation (0115). */
export const INSTALLATION_ONLY_FLAGS = ['approve_connections'];

async function inTx(c, fn) {
  await c.query('begin');
  try {
    const r = await fn();
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  }
}

/** KS — every workspace (practice copies left out), the newest sign-up first. */
export async function listWorkspaces(c, opts = {}) {
  const r = await c.query(`
    select b.id::text as id, b.name, b.kind, b.country, b.signed_up_at, b.auto_earned_at, b.auto_earned_by, b.is_active,
           exists (select 1 from workspace_suspensions s where s.business_id = b.id and s.restored_at is null) as suspended,
           m.page_name, case when m.id is null then null when m.last_error is null then 'live' else m.last_error end as page_state,
           exists (select 1 from channels ch where ch.business_id = b.id and ch.status = 'connected') as whatsapp,
           (select floor(greatest(100.0 * coalesce(u.llm_calls, 0) / nullif(t.daily_llm_calls, 0),
                                  100.0 * (coalesce(u.input_tokens, 0) + coalesce(u.output_tokens, 0)) / nullif(t.daily_tokens, 0)))
              from tenant_budgets t left join usage_ledger u on u.business_id = t.business_id and u.day = (now() at time zone 'UTC')::date
             where t.business_id = b.id) as used_today,
           (select max(cc.last_inbound_at) from client_channels cc join clients cl on cl.id = cc.client_id where cl.business_id = b.id) as last_customer_at
      from businesses b
      left join meta_accounts m on m.business_id = b.id and m.archived_at is null
     where b.practice_of is null ${opts.selfServeOnly ? 'and b.signed_up_at is not null' : ''}
     order by b.signed_up_at desc nulls last, b.name`);
  return r.rows.map((x) => ({
    id: String(x['id']), name: String(x['name']), kind: x['kind'] ?? null, country: x['country'] ?? null,
    signedUpAt: x['signed_up_at'] ?? null, earnedAt: x['auto_earned_at'] ?? null,
    earnedBy: x['auto_earned_by'] ?? null, active: x['is_active'] === true, suspended: x['suspended'] === true,
    page: x['page_name'] ?? null, pageState: x['page_state'] ?? null, whatsapp: x['whatsapp'] === true,
    usedToday: x['used_today'] == null ? null : Number(x['used_today']), lastCustomerAt: x['last_customer_at'] ?? null,
  }));
}

async function workspaceOf(c, businessId) {
  if (!UUID.test(businessId)) return null;
  const r = (await c.query(`select id::text as id, name, practice_of::text as practice_of from businesses where id = $1::uuid`, [businessId])).rows[0];
  return r ? { id: String(r['id']), name: String(r['name']), practiceOf: r['practice_of'] ?? null } : null;
}

/**
 * KS2 — SUSPEND ONE WORKSPACE COMPLETELY, in four steps a restore reverses:
 *   1. its own `global_silence` row: no model is asked, the send gate refuses
 *      the assistant's sends, every customer goes to a person;
 *   2. its Page marked `refused` (`needs_attention_at`) — never archived: an
 *      archived row would make the app fall back to the installation's own
 *      Page adapters, and a Page that needs attention gets none, so every
 *      send through it, the owner's own included, is refused;
 *   3. `is_active = false`: nobody signs in;
 *   4. the Page unsubscribed from Nomi's webhook at Meta (after the commit,
 *      best effort: the first three already stop everything).
 * The installation's own workspace and practice copies are refused.
 */
/** @param {Query} c @param {GraphDeps | null} graph @param {{ businessId: string, reason: string, by: string, installationId: string | null }} input */
export async function suspendWorkspace(c, graph, input) {
  const w = await workspaceOf(c, input.businessId);
  if (!w) return { ok: false, why: 'not_a_workspace' };
  if (w.practiceOf) return { ok: false, why: 'practice_copy' };
  if (input.installationId && w.id === input.installationId) return { ok: false, why: 'installation' };
  const done = await inTx(c, async () => {
    const open = (await c.query(`select 1 from workspace_suspensions where business_id = $1::uuid and restored_at is null for update`, [w.id])).rowCount;
    if (open) return null;
    const flag = (await c.query(`insert into ops_flags (business_id, flag, reason, set_by) values ($1::uuid, 'global_silence', $2, $3) returning id`,
      [w.id, `suspended: ${input.reason}`, input.by])).rows[0]['id'];
    const page = (await c.query(`update meta_accounts set needs_attention_at = now(), last_error = 'refused'
                                   where business_id = $1::uuid and archived_at is null and last_error is null
                               returning page_id, token_ciphertext`, [w.id])).rows[0] ?? null;
    const was = (await c.query(`select is_active from businesses where id = $1::uuid for update`, [w.id])).rows[0]['is_active'] === true;
    await c.query(`update businesses set is_active = false where id = $1::uuid`, [w.id]);
    await c.query(`insert into workspace_suspensions (business_id, reason, suspended_by, silence_flag_id, page_marked, was_active)
                   values ($1::uuid, $2, $3, $4, $5, $6)`, [w.id, input.reason, input.by, flag, page !== null, was]);
    return { page };
  });
  if (!done) return { ok: false, why: 'already_suspended' };
  let unsubscribed = null;
  if (done.page && graph) {
    const token = graph.openToken(String(done.page['token_ciphertext']));
    if (token) {
      await graph.unsubscribe({ pageId: String(done.page['page_id']), token });
      unsubscribed = true;
    } else unsubscribed = false;
  }
  return { ok: true, name: w.name, unsubscribed };
}

/** KS2 — --restore: exactly what the open suspension changed, and nothing else. */
/** @param {Query} c @param {GraphDeps | null} graph @param {{ businessId: string, by: string }} input */
export async function restoreWorkspace(c, graph, input) {
  const w = await workspaceOf(c, input.businessId);
  if (!w) return { ok: false, why: 'not_a_workspace' };
  const done = await inTx(c, async () => {
    const s = (await c.query(`select id, silence_flag_id, page_marked, was_active from workspace_suspensions
                               where business_id = $1::uuid and restored_at is null for update`, [w.id])).rows[0];
    if (!s) return null;
    if (s['silence_flag_id'] != null) await c.query(`update ops_flags set cleared_at = now() where id = $1 and cleared_at is null`, [s['silence_flag_id']]);
    const page = s['page_marked'] === true
      ? (await c.query(`update meta_accounts set needs_attention_at = null, last_error = null
                          where business_id = $1::uuid and archived_at is null and last_error = 'refused'
                      returning page_id, token_ciphertext`, [w.id])).rows[0] ?? null
      : null;
    if (s['was_active'] === true) await c.query(`update businesses set is_active = true where id = $1::uuid`, [w.id]);
    await c.query(`update workspace_suspensions set restored_at = now(), restored_by = $2 where id = $1`, [s['id'], input.by]);
    return { page };
  });
  if (!done) return { ok: false, why: 'not_suspended' };
  let resubscribed = null;
  if (done.page && graph) {
    const token = graph.openToken(String(done.page['token_ciphertext']));
    resubscribed = token ? await graph.subscribe({ pageId: String(done.page['page_id']), token }) : false;
  }
  return { ok: true, name: w.name, resubscribed };
}

/**
 * KS4 / KS6 — an operator's flag, for one workspace or (no id) for everyone.
 * `force_draft` writes one row per capability (0014 needs one); the rest one
 * row. A flag already on is not written twice. Returns the rows written.
 */
/** @param {Query} c @param {{ flag: string, businessId: string | null, reason: string, by: string }} input */
export async function setOperatorFlag(c, input) {
  if (input.businessId !== null && INSTALLATION_ONLY_FLAGS.includes(input.flag)) throw new Error(`${input.flag} is for the whole installation: use --all`);
  if (input.businessId !== null && !(await workspaceOf(c, input.businessId))) throw new Error('no such workspace');
  const caps = input.flag === 'force_draft' ? FORCE_DRAFT_CAPABILITIES : [null];
  return inTx(c, async () => {
    let n = 0;
    for (const cap of caps) {
      const on = (await c.query(`select 1 from ops_flags where flag = $1 and cleared_at is null
                                   and business_id is not distinct from $2::uuid and capability is not distinct from $3`,
        [input.flag, input.businessId, cap])).rowCount;
      if (on) continue;
      await c.query(`insert into ops_flags (business_id, flag, capability, reason, set_by) values ($1::uuid, $2, $3, $4, $5)`,
        [input.businessId, input.flag, cap, input.reason, input.by]);
      n++;
    }
    return n;
  });
}

/** Clears that flag (every capability row of it) for that workspace, or the global one. Returns rows cleared. */
/** @param {Query} c @param {{ flag: string, businessId: string | null }} input */
export async function clearOperatorFlag(c, input) {
  return (await c.query(`update ops_flags set cleared_at = now()
                           where flag = $1 and cleared_at is null and business_id is not distinct from $2::uuid`,
    [input.flag, input.businessId])).rowCount ?? 0;
}

/**
 * The ramp gate (G4), lifted for a pilot by the operator, or put back. Only a
 * workspace that signed itself up has a gate; the operator's name is kept.
 */
/** @param {Query} c @param {{ businessId: string, by: string, earned: boolean }} input */
export async function setEarned(c, input) {
  const w = await workspaceOf(c, input.businessId);
  if (!w || w.practiceOf) return 'not_a_workspace';
  const r = await c.query(input.earned
    ? `update businesses set auto_earned_at = now(), auto_earned_by = $2 where id = $1::uuid and signed_up_at is not null`
    : `update businesses set auto_earned_at = null, auto_earned_by = null where id = $1::uuid and signed_up_at is not null`,
  input.earned ? [w.id, input.by] : [w.id]);
  if (!r.rowCount) return 'not_self_serve';
  return input.earned ? 'earned' : 'unearned';
}

/**
 * KS5 (0113) — the installation's spend ceiling: today's use against it, and
 * the operator's change of it. Positive whole numbers only; who and when are
 * kept on the row.
 */
export async function readSpendCeiling(c) {
  const r = (await c.query(`select tokens::text as tokens, calls::text as calls, max_tokens::text as max_tokens, max_calls
                              from installation_usage_today()`)).rows[0];
  return { tokens: Number(r.tokens), calls: Number(r.calls), maxTokens: Number(r.max_tokens), maxCalls: Number(r.max_calls) };
}
export async function setSpendCeiling(c, input) {
  const ok = (n) => n === undefined || (Number.isInteger(n) && n > 0);
  if (!ok(input.tokens) || !ok(input.calls) || (input.tokens === undefined && input.calls === undefined)) return 'invalid';
  if (!input.by || !String(input.by).trim()) return 'invalid';
  await c.query(`update installation_limits
                    set daily_tokens = coalesce($1::bigint, daily_tokens), daily_calls = coalesce($2::int, daily_calls),
                        set_at = now(), set_by = $3
                  where id`, [input.tokens ?? null, input.calls ?? null, String(input.by).trim().slice(0, 120)]);
  return 'set';
}

/**
 * BOT (0114) — the operator's sign-up switch: open, invite or closed, read by
 * the app on every request; null follows the deployment's SIGNUP_MODE.
 */
export const SIGNUP_SWITCH = ['open', 'invite', 'closed', 'deployment'];
export async function readSignupSwitch(c) {
  const r = (await c.query(`select mode, set_at, set_by from signup_settings where id`)).rows[0];
  return { mode: r?.mode ?? null, setAt: r?.set_at ?? null, setBy: r?.set_by ?? null };
}
export async function setSignupSwitch(c, input) {
  if (!SIGNUP_SWITCH.includes(input.mode)) return 'invalid';
  if (!input.by || !String(input.by).trim()) return 'invalid';
  await c.query(`update signup_settings set mode = $1, set_at = now(), set_by = $2 where id`,
    [input.mode === 'deployment' ? null : input.mode, String(input.by).trim().slice(0, 120)]);
  return 'set';
}

/**
 * BOT (0114) — the invitations, listed and taken back. An invitation's id IS
 * the ticket, so a list shows only its first eight characters, and a revoke
 * names it by at least those eight: enough to choose one, never the ticket
 * whole on a screen someone else can read.
 */
export async function listInvitations(c, { all = false } = {}) {
  const rows = (await c.query(`
    select left(id::text, 8) as ref, note, created_at, expires_at, used_at, revoked_at, revoked_by,
           (used_at is null and expires_at > now()) as open
      from signup_invites
     where $1::boolean or (used_at is null and expires_at > now())
     order by created_at desc limit 200`, [all])).rows;
  return rows.map((r) => ({
    ref: r.ref, note: r.note, createdAt: r.created_at, expiresAt: r.expires_at, open: r.open,
    state: r.open ? 'open' : r.revoked_at ? 'revoked' : r.used_at ? 'used' : 'lapsed', revokedBy: r.revoked_by,
  }));
}
export async function revokeInvitation(c, input) {
  const ref = String(input.ref ?? '').trim().toLowerCase();
  if (!/^[0-9a-f-]{8,36}$/.test(ref) || !input.by || !String(input.by).trim()) return 'invalid';
  const found = (await c.query(`select id from signup_invites where id::text like $1 || '%'`, [ref])).rows;
  if (found.length === 0) return 'none';
  if (found.length > 1) return 'ambiguous';
  // Lapses at once: 0055's and 0100's checks already refuse a lapsed invitation.
  const r = await c.query(`
    update signup_invites set expires_at = least(expires_at, now()), revoked_at = now(), revoked_by = $2
     where id = $1 and used_at is null and expires_at > now()`, [found[0].id, String(input.by).trim().slice(0, 120)]);
  return r.rowCount === 1 ? 'revoked' : 'not_open';
}

/**
 * KS6 (0115) — the asks to connect a first channel, and the operator's
 * decision. The list is what the operator looks at: the business, what it
 * sells, its website, where it can be seen. Waiting asks by default; --all is
 * the KS6 log the step 4 → 5 criteria are measured by.
 */
export async function listConnectionAsks(c, { all = false } = {}) {
  const r = await c.query(`
    select a.business_id::text as id, b.name, b.kind, b.country, b.description as sells, b.website, a.page,
           a.asked_at, a.asked_by, a.decision, a.decided_at, a.decided_by, a.note, a.told_at
      from connection_approvals a join businesses b on b.id = a.business_id
     where $1::boolean or a.decision is null
     order by a.asked_at`, [all]);
  return r.rows.map((x) => ({
    id: x.id, name: x.name, kind: x.kind ?? null, country: x.country ?? null, sells: x.sells ?? null, website: x.website ?? null,
    page: x.page, askedAt: x.asked_at, askedBy: x.asked_by, decision: x.decision ?? null, decidedAt: x.decided_at ?? null,
    decidedBy: x.decided_by ?? null, note: x.note ?? null, told: x.told_at !== null,
  }));
}

/**
 * Approve or refuse. An approval needs no ask (a workspace the operator already
 * knows); a refusal answers one. A decision changed later is told again.
 */
export async function decideConnection(c, input) {
  if (!['approved', 'refused'].includes(input.decision) || !input.by || !String(input.by).trim()) return 'invalid';
  const ws = await workspaceOf(c, String(input.businessId ?? ''));
  if (!ws) return 'none';
  if (ws.practiceOf) return 'practice';
  const by = String(input.by).trim().slice(0, 120);
  const note = input.note ? String(input.note).slice(0, 500) : null;
  return inTx(c, async () => {
    const ask = (await c.query(`select decision from connection_approvals where business_id = $1::uuid for update`, [ws.id])).rows[0];
    if (!ask && input.decision === 'refused') return 'no_ask';
    if (ask && ask.decision === input.decision) return 'unchanged';
    if (!ask) {
      await c.query(`insert into connection_approvals (business_id, page, asked_by, decision, decided_at, decided_by, note)
                     values ($1::uuid, '(approved before asking)', $2, 'approved', now(), $2, $3)`, [ws.id, by, note]);
    } else {
      await c.query(`update connection_approvals set decision = $2, decided_at = now(), decided_by = $3, note = coalesce($4, note), told_at = null
                      where business_id = $1::uuid`, [ws.id, input.decision, by, note]);
    }
    return input.decision;
  });
}
