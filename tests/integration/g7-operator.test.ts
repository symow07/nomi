import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { offlineModels } from '../pipeline/fakes.js';

/**
 * G7 — THE OPERATOR'S CONTROLS (KS2–KS4, KS6's stop flag), over Postgres and
 * production's composition, with Meta's Graph a recorder.
 *
 *   · Suspending a workspace silences it, marks its Page refused (never
 *     archived), switches it off and unsubscribes the Page; a send through it
 *     — the owner's own — is refused, and the installation's own Page is
 *     never used instead. Restoring undoes exactly that, and not a Page that
 *     was already broken.
 *   · The flags: force_draft is six rows, never doubled; connections_off
 *     refuses a connection; the daily list names what is still on.
 *   · The ramp gate lifted for a pilot, by name; never for a workspace that
 *     has no gate.
 *   · The tools: dry runs change nothing.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RUN = randomUUID().slice(0, 8);
const PILOT = `dd970000-0000-4000-8000-${RUN}0001`;
const SHOP = `dd970000-0000-4000-8000-${RUN}0002`;
const BROKEN = `dd970000-0000-4000-8000-${RUN}0003`;
const CREDENTIAL_KEY = 'e'.repeat(64);
const PAGE = `7${RUN.replace(/[^0-9]/g, '1').padEnd(8, '1')}01`;
const BROKEN_PAGE = `7${RUN.replace(/[^0-9]/g, '1').padEnd(8, '1')}02`;
const PILOT_PAGE_TOKEN = `pilot-page-token-${RUN}`;

d('G7 · the operator\'s controls (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let admin: pg.Client;
  let op: typeof import('../../src/db/operator.js');
  let graph: import('../../src/db/operator.js').GraphDeps;
  const calls: { method: string; url: string }[] = [];
  const recorder: import('../../src/channels/meta/messaging.js').MetaFetch = async (url, init) => {
    calls.push({ method: init.method, url });
    return { status: 200, text: async () => JSON.stringify({ success: true, recipient_id: '1', message_id: 'm.1' }) };
  };
  const row = async (q: string, args: unknown[]) => (await admin.query(q, args)).rows[0];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    op = await import('../../src/db/operator.js');
    const { deriveKey, encryptSecret, decryptSecret, credentialFingerprint } = await import('../../src/security/credentials.js');
    const key = deriveKey(CREDENTIAL_KEY);
    graph = { openToken: (c) => { try { return decryptSecret(c, key).plain; } catch { return null; } }, graphVersion: 'v23.0', fetch: recorder };
    await admin.query(`insert into businesses (id, name) values ($1, $2)`, [PILOT, `G7 installation ${RUN}`]);
    for (const [id, name, page] of [[SHOP, `G7 Shop ${RUN}`, PAGE], [BROKEN, `G7 Broken ${RUN}`, BROKEN_PAGE]] as const) {
      await admin.query(`insert into businesses (id, name, signed_up_at) values ($1, $2, now())`, [id, name]);
      const token = `page-token-${id}`;
      await admin.query(`insert into meta_accounts (business_id, page_id, page_name, token_ciphertext, fingerprint, scopes, connected_by)
                         values ($1, $2, $3, $4, $5, 'pages_messaging', 'test')`, [id, page, `${name} Page`, encryptSecret(token, key), credentialFingerprint(token)]);
    }
    // The second Page was broken before anything the operator did.
    await admin.query(`update meta_accounts set needs_attention_at = now(), last_error = 'revoked' where business_id = $1`, [BROKEN]);
    // A Messenger customer of the shop, to send to.
    const client = (await admin.query(`insert into clients (business_id, display_name) values ($1, 'Lina') returning id`, [SHOP])).rows[0].id;
    // She wrote an hour ago: the 24-hour window is open, so only the channel can refuse.
    await admin.query(`insert into client_channels (client_id, channel, channel_user_id, last_inbound_at) values ($1, 'messenger', $2, now() - interval '1 hour')`, [client, `psid-${RUN}`]);
    await admin.query(`insert into conversations (business_id, client_id, channel) values ($1, $2, 'messenger')`, [SHOP, client]);

    process.env['PILOT_BUSINESS_ID'] = PILOT;
    process.env['META_PAGE_ACCESS_TOKEN'] = PILOT_PAGE_TOKEN;
    process.env['META_PAGE_ID'] = '99999999901';
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator } = await import('../../src/channels/whatsapp/simulator.js');
    prod = await buildProduction({
      provider: 'meta', DATABASE_URL: DATABASE_URL!, ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok', META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765', META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0', WEBHOOK_VERIFY_TOKEN: 'g7-verify-token-xxxx', CREDENTIAL_KEY, PORT: 0,
      PUBLIC_BASE_URL: 'https://nomi.test',
    }, { models: offlineModels(), adapter: whatsappSimulator([], { tag: `g7${RUN}` }).adapter, logger: false, metaFetch: recorder } as Parameters<typeof buildProduction>[1]);
  }, 90_000);
  afterAll(async () => {
    delete process.env['META_PAGE_ACCESS_TOKEN'];
    delete process.env['META_PAGE_ID'];
    await admin?.end(); await prod?.close();
  });

  it('SUSPEND: silenced, its Page marked refused (not archived), switched off, unsubscribed — once', async () => {
    const r = await op.suspendWorkspace(admin, graph, { businessId: SHOP, reason: 'spam reports', by: 'operator', installationId: PILOT });
    expect(r).toMatchObject({ ok: true, unsubscribed: true });
    expect(await row(`select count(*)::int as n from ops_flags where business_id = $1 and flag = 'global_silence' and cleared_at is null`, [SHOP])).toEqual({ n: 1 });
    expect(await row(`select last_error, archived_at from meta_accounts where business_id = $1`, [SHOP])).toEqual({ last_error: 'refused', archived_at: null });
    expect(await row(`select is_active from businesses where id = $1`, [SHOP])).toEqual({ is_active: false });
    expect(calls.some((c) => c.method === 'DELETE' && c.url.includes(`/${PAGE}/subscribed_apps`))).toBe(true);
    expect(await op.suspendWorkspace(admin, graph, { businessId: SHOP, reason: 'again', by: 'operator', installationId: PILOT })).toEqual({ ok: false, why: 'already_suspended' });
    expect(await op.suspendWorkspace(admin, graph, { businessId: PILOT, reason: 'no', by: 'operator', installationId: PILOT })).toEqual({ ok: false, why: 'installation' });
  });

  it('A SEND THROUGH IT — the owner\'s own — is refused, and the installation\'s own Page is never used instead', async () => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { enqueueOutboundRow } = await import('../../src/db/channels.js');
    const { QUEUES } = await import('../../src/queue/boss.js');
    const b = parseBusinessId(SHOP); if (!b.ok) throw new Error('fixture');
    const conv = (await row(`select id::text as id from conversations where business_id = $1`, [SHOP])).id as string;
    const before = calls.length;
    await withTenantTx(prod.db, b.value, (tx) => enqueueOutboundRow(tx, b.value, conv, 'Hello Lina, your order is ready.', 'owner'));
    await prod.boss.send(QUEUES.outbound, { businessId: SHOP, conversationId: conv });
    const settled = await (async () => {
      for (let i = 0; i < 150; i++) {
        const r = await row(`select status, cancel_reason from outbound_messages where conversation_id = $1`, [conv]);
        if (r && r.status !== 'queued' && r.status !== 'sending') return r;
        await new Promise((res) => setTimeout(res, 200));
      }
      return undefined;
    })();
    expect(String(settled?.cancel_reason)).toContain('channel_unavailable');
    const sent = calls.slice(before);
    expect(sent.some((c) => c.url.includes(PILOT_PAGE_TOKEN) || c.url.includes('/99999999901/')), 'never the installation\'s Page').toBe(false);
    expect(sent.some((c) => c.method === 'POST' && c.url.includes('/messages')), 'nothing was sent at all').toBe(false);
  }, 60_000);

  it('RESTORE undoes exactly that — and leaves a Page that was already broken as it was', async () => {
    const r = await op.restoreWorkspace(admin, graph, { businessId: SHOP, by: 'operator' });
    expect(r).toMatchObject({ ok: true, resubscribed: true });
    expect(await row(`select count(*)::int as n from ops_flags where business_id = $1 and cleared_at is null`, [SHOP])).toEqual({ n: 0 });
    expect(await row(`select last_error from meta_accounts where business_id = $1`, [SHOP])).toEqual({ last_error: null });
    expect(await row(`select is_active from businesses where id = $1`, [SHOP])).toEqual({ is_active: true });
    expect(calls.some((c) => c.method === 'POST' && c.url.includes(`/${PAGE}/subscribed_apps`))).toBe(true);
    expect(await op.restoreWorkspace(admin, graph, { businessId: SHOP, by: 'operator' })).toEqual({ ok: false, why: 'not_suspended' });
    // A Page broken before the suspension stays broken after the restore.
    await op.suspendWorkspace(admin, graph, { businessId: BROKEN, reason: 'test', by: 'operator', installationId: PILOT });
    await op.restoreWorkspace(admin, graph, { businessId: BROKEN, by: 'operator' });
    expect(await row(`select last_error from meta_accounts where business_id = $1`, [BROKEN])).toEqual({ last_error: 'revoked' });
  });

  it('FLAGS: force_draft is six rows, never doubled; connections_off refuses a connection; the daily list names them', async () => {
    expect(await op.setOperatorFlag(admin, { flag: 'force_draft', businessId: SHOP, reason: 'review', by: 'operator' })).toBe(6);
    expect(await op.setOperatorFlag(admin, { flag: 'force_draft', businessId: SHOP, reason: 'review', by: 'operator' })).toBe(0);
    expect(await op.setOperatorFlag(admin, { flag: 'connections_off', businessId: SHOP, reason: 'pause', by: 'operator' })).toBe(1);
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const { connectionsPaused } = await import('../../src/db/opsFlags.js');
    const b = parseBusinessId(SHOP); if (!b.ok) throw new Error('fixture');
    expect(await withTenantTx(prod.db, b.value, (tx) => connectionsPaused(tx, SHOP))).toBe(true);
    const { signupDigestAlert } = await import('../../src/pipeline/signupDigest.js');
    const job = await signupDigestAlert(prod.db, PILOT, new Date());
    const mine = (job?.flags ?? []).filter((f) => f.business === `G7 Shop ${RUN}`).map((f) => f.flag).sort();
    expect(mine).toEqual(['connections_off', 'force_draft']);
    expect(await op.clearOperatorFlag(admin, { flag: 'force_draft', businessId: SHOP })).toBe(6);
    expect(await op.clearOperatorFlag(admin, { flag: 'connections_off', businessId: SHOP })).toBe(1);
    expect(await withTenantTx(prod.db, b.value, (tx) => connectionsPaused(tx, SHOP))).toBe(false);
  });

  it('THE RAMP GATE lifted for a pilot, by name — and never for a workspace that has none', async () => {
    expect(await op.setEarned(admin, { businessId: SHOP, by: 'operator', earned: true })).toBe('earned');
    expect(await row(`select auto_earned_by from businesses where id = $1`, [SHOP])).toEqual({ auto_earned_by: 'operator' });
    expect(await op.setEarned(admin, { businessId: PILOT, by: 'operator', earned: true })).toBe('not_self_serve');
    expect(await op.setEarned(admin, { businessId: SHOP, by: 'operator', earned: false })).toBe('unearned');
  });

  it('THE TOOLS: listing works, and a dry run changes nothing', () => {
    const run = (tool: string, ...args: string[]) => spawnSync(process.execPath, [`tools/${tool}`, ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000, env: { ...process.env, MIGRATE_DATABASE_URL: MIGRATE_URL ?? '', PILOT_BUSINESS_ID: PILOT },
    });
    const list = run('workspaces.mjs', '--self-serve');
    expect(list.status, list.stderr).toBe(0);
    expect(list.stdout).toContain(`G7 Shop ${RUN} (${SHOP})`);
    const dry = run('suspend-workspace.mjs', '--business', SHOP, '--reason', 'test', '--by', 'operator');
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain('Dry run');
    const flags = run('ops-flags.mjs', '--set', 'global_silence', '--business', SHOP, '--reason', 'test', '--by', 'operator');
    expect(flags.stdout).toContain('Dry run');
    return Promise.all([
      row(`select is_active from businesses where id = $1`, [SHOP]),
      row(`select count(*)::int as n from ops_flags where business_id = $1 and cleared_at is null`, [SHOP]),
    ]).then(([a, f]) => { expect(a).toEqual({ is_active: true }); expect(f).toEqual({ n: 0 }); });
  }, 120_000);
});
