import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
// @ts-expect-error — the operator tool, plain JS on purpose (tools/ is not type-checked).
import * as op from '../../tools/lib/operator.mjs';

/**
 * RET (0116) — A WORKSPACE THAT NEVER CONNECTED A CHANNEL, 90 DAYS ON, over
 * Postgres and the operator's tools run for real:
 *
 *   · off by default: nothing is listed, warned or erasable;
 *   · on: never-connected workspaces are listed, one that connected anything
 *     (even since archived) is not; the first warning goes from day 76, once,
 *     naming a date at least 14 days away; the second three days before it;
 *   · the owner's e-mail names the date and opens Channels;
 *   · due only after both warnings and the date; the operator's tool records a
 *     workspace deletion request and erases through erase-workspace — the
 *     neighbours untouched.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUN = randomUUID().slice(0, 8);

d('RET · retention (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let t: typeof import('../../src/core/owner/i18n/messages.js')['t'];
  const ws = {} as Record<'old' | 'young' | 'connected', { id: string; name: string; email: string }>;
  const today = async () => (await admin.query(`select now()::date::text as d, (now()::date + 14)::text as d14`)).rows[0] as { d: string; d14: string };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    const { createDb } = await import('../../src/db/client.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    ({ t } = await import('../../src/core/owner/i18n/messages.js'));
    db = createDb(DATABASE_URL!);
    for (const [key, days] of [['old', 100], ['young', 10], ['connected', 100]] as const) {
      const name = `RET ${key} ${RUN}`;
      const email = `ret-${key}-${RUN}@shop.example`;
      const made = await provisionAccount(db, {
        factory: name, language: 'en', ownerName: 'Lena', email, passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA',
        invite: null, inviteRequired: false, termsVersion: 'abcdef012345',
        profile: { kind: 'retail', sells: 'candles', country: 'AE', website: null, teamSize: '1', channels: [] },
      });
      if (made.code !== 'created') throw new Error(made.code);
      await admin.query(`update businesses set signed_up_at = now() - ($2 || ' days')::interval where id = $1`, [made.businessId, String(days)]);
      ws[key] = { id: made.businessId, name, email };
    }
    await admin.query(`insert into meta_accounts (business_id, page_id, page_name, token_ciphertext, fingerprint, scopes, connected_by, archived_at, archived_by)
                       values ($1, '7000000002', 'Old Page', 'v1.not-a-real-token', '0123456789ab', 'pages_messaging', 'test', now(), 'test')`, [ws.connected.id]);
  }, 60_000);
  afterAll(async () => {
    await op.clearOperatorFlag(admin, { flag: 'retention', businessId: null }).catch(() => undefined);
    await admin?.end(); await db?.destroy();
  });

  const mine = async () => (await op.listRetention(admin)).filter((r: { name: string }) => r.name.endsWith(RUN));

  it('OFF BY DEFAULT: nothing is listed, warned or erasable', async () => {
    await op.clearOperatorFlag(admin, { flag: 'retention', businessId: null });
    expect(await mine()).toEqual([]);
    const { retentionWarnings } = await import('../../src/pipeline/retention.js');
    expect((await retentionWarnings(db)).filter((j) => Object.values(ws).some((w) => w.id === j.businessId))).toEqual([]);
    expect(await op.recordRetentionRequest(admin, { businessId: ws.old.id, by: 'test' })).toBeNull();
    await expect(op.setOperatorFlag(admin, { flag: 'retention', businessId: ws.old.id, reason: 'x', by: 'test' })).rejects.toThrow(/whole installation/);
  });

  it('ON: the never-connected are listed — not one that connected anything, even since archived', async () => {
    expect(await op.setOperatorFlag(admin, { flag: 'retention', businessId: null, reason: `ret test ${RUN}`, by: 'test' })).toBe(1);
    const rows = await mine();
    expect(rows.map((r: { id: string }) => r.id).sort()).toEqual([ws.old.id, ws.young.id].sort());
    expect(rows.every((r: { due: boolean }) => !r.due)).toBe(true);
  });

  it('THE FIRST WARNING from day 76, once, naming a date at least 14 days away; the e-mail opens Channels', async () => {
    const { retentionWarnings } = await import('../../src/pipeline/retention.js');
    const jobs = (await retentionWarnings(db)).filter((j) => Object.values(ws).some((w) => w.id === j.businessId));
    expect(jobs).toEqual([{ businessId: ws.old.id, kind: 'retention_warning', conversationId: null, eraseOn: (await today()).d14 }]);
    expect((await retentionWarnings(db)).filter((j) => j.businessId === ws.old.id)).toEqual([]);
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    const outbox: { to: string; subject: string; text: string }[] = [];
    const mail = { from: 'no-reply@nomi.test', send: async (m: { to: string; subject: string; text: string }) => { outbox.push(m); return { ok: true as const }; } };
    const adapter = { sendText: async () => ({ ok: false as const, retryable: false, error: 'none' }) };
    expect(await deliverOwnerAlert({ db, adapter, mail, publicBaseUrl: 'https://nomi.test' }, jobs[0]!)).toBe('sent');
    expect([outbox[0]!.to, outbox[0]!.subject]).toEqual([ws.old.email, t('en', 'notify.retention_warning.subject')]);
    expect(outbox[0]!.text).toContain('https://nomi.test/app/channels');
    expect(outbox[0]!.text).not.toContain('{date}');
  });

  it('THE SECOND WARNING three days before; DUE only after both and the date; the daily list counts it', async () => {
    const { retentionWarnings } = await import('../../src/pipeline/retention.js');
    // A fortnight later: the date the first warning named has come.
    await admin.query(`update retention_notices set sent_at = now() - interval '15 days' where business_id = $1`, [ws.old.id]);
    expect((await mine()).find((r: { id: string }) => r.id === ws.old.id).due, 'not before the second warning').toBe(false);
    const second = (await retentionWarnings(db)).filter((j) => j.businessId === ws.old.id);
    expect(second.length).toBe(1);
    // Sent late (the date had passed): it still leaves three days.
    expect(second[0]!.eraseOn).toBe((await admin.query(`select (now()::date + 3)::text as d`)).rows[0].d);
    expect((await mine()).find((r: { id: string }) => r.id === ws.old.id)).toMatchObject({ warned14d: true, warned3d: true, due: false });
    await admin.query(`update retention_notices set sent_at = now() - interval '4 days' where business_id = $1 and stage = '3d'`, [ws.old.id]);
    expect((await mine()).find((r: { id: string }) => r.id === ws.old.id)).toMatchObject({ warned14d: true, warned3d: true, due: true });
    expect((await mine()).find((r: { id: string }) => r.id === ws.young.id).due).toBe(false);
    const { signupDigestAlert } = await import('../../src/pipeline/signupDigest.js');
    expect((await signupDigestAlert(db, ws.connected.id, new Date()))?.retentionDue).toBeGreaterThanOrEqual(1);
  });

  it('THE OPERATOR\'S TOOL: a dry run changes nothing; then the due workspace is erased under a request — the neighbours untouched', () => {
    const run = (...args: string[]) => spawnSync(process.execPath, ['tools/retention.mjs', ...args], {
      cwd: ROOT, encoding: 'utf8', timeout: 180_000, env: { ...process.env, MIGRATE_DATABASE_URL: MIGRATE_URL ?? '' },
    });
    const dry = run('--erase', '--by', 'test');
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain('Dry run');
    const go = run('--erase', '--by', 'ret test', '--yes');
    expect(go.status, go.stdout + go.stderr).toBe(0);
    expect(go.stdout).toContain(`${ws.old.name} erased`);
  });

  it('…and afterwards: the workspace is gone, the young one and the connected one remain', async () => {
    expect((await admin.query(`select 1 from businesses where id = $1`, [ws.old.id])).rowCount).toBe(0);
    expect((await admin.query(`select 1 from logins where email = $1`, [ws.old.email])).rowCount).toBe(0);
    for (const w of [ws.young, ws.connected]) expect((await admin.query(`select 1 from businesses where id = $1`, [w.id])).rowCount).toBe(1);
  });

  it('THE APP ROLE cannot read the warnings', async () => {
    const { sql } = await import('kysely');
    await expect(sql`select * from retention_notices`.execute(db)).rejects.toThrow(/permission denied/);
  });
});
