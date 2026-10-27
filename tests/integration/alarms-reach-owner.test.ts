import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sql } from 'kysely';
import { randomUUID, createECDH, generateKeyPairSync } from 'node:crypto';
import pg from 'pg';
import { seedRunTenant } from './tenant.js';

/**
 * 0217 — AN ALARM THAT REACHES SOMEBODY, over a real database.
 *
 * 2026-10-22: the scheduled backup's upload was refused. 10-23 and 10-24: the app saw it was stale and e-mailed the
 * operator through a mailbox Google had revoked; the refusal was one warning line; WhatsApp's refusal was not even
 * that; the heartbeat stayed green. Here, each of the four fixes against the rows it reads and writes:
 *
 *   1. the heartbeat's alarms: a failed backup, the operator's mailbox dead, an alert that reached nobody;
 *   2. a dead mailbox is told to its owner once;
 *   3. an alert that reached nobody is kept, said, tried again, and closed when a way works — or when it stopped
 *      being true; the owner's phone is a way out too;
 *   4. a failed backup run is a row the app reads, and the operator is told of it once.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);
const RUN_NAME = (n: number) => `nomi-backup-2099010${n}T0300${RUN.replace(/\D/g, '0').slice(0, 2)}Z`;

d('0217 · alarms that reach somebody (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let BIZ = ''; let OTHER = '';
  const EMAIL = `ops-${RUN}@example.com`;
  const names: string[] = [];

  /** A sender that refuses, as the revoked mailbox did; and one that delivers. */
  const refusing = { send: async () => ({ ok: false as const, error: 'mailbox: the mail account must be connected again · smtp: smtp' }) };
  const inbox: { to: string; subject: string; text: string }[] = [];
  const working = { send: async (m: { to: string; subject: string; text: string }) => { inbox.push(m); return { ok: true as const }; } };
  const noWhatsApp = { sendText: async () => ({ ok: false as const, retryable: false, error: 'no adapter' }) };

  const tenant = async <R>(bid: string, fn: (tx: import('../../src/db/client.js').Tx) => Promise<R>): Promise<R> => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const b = parseBusinessId(bid); if (!b.ok) throw new Error('fixture');
    return withTenantTx(db, b.value, fn);
  };
  const mine = async () => tenant(BIZ, (tx) => sql<{ kind: string; tries: number; why: string; delivered: boolean }>`
    select kind, tries, why, delivered_at is not null as delivered from undelivered_alerts order by first_failed_at`.execute(tx).then((r) => r.rows));
  const reasons = async () => {
    const { alarmReasons } = await import('../../src/pipeline/alarms.js');
    return alarmReasons(db, { operatorBusinessId: BIZ, operatorMailbox: true });
  };
  const deliver = async (job: Partial<import('../../src/queue/boss.js').NotifyJob>, deps: Partial<import('../../src/pipeline/notify.js').NotifyDeps> = {}) => {
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    return deliverOwnerAlert({ db, adapter: noWhatsApp, mail: refusing, ...deps },
      { businessId: BIZ, kind: 'backup_stale', conversationId: null, lastBackupAt: null, ...job } as import('../../src/queue/boss.js').NotifyJob);
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    for (const [who, mail] of [['Ops', EMAIL], ['Other', `other-${RUN}@example.com`]] as const) {
      const r = await provisionAccount(db, {
        factory: `Alarm ${who} Co ${RUN}`, language: 'en', ownerName: who, email: mail,
        passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
        profile: { kind: 'retail', sells: 'lamps', country: 'AE', website: null, teamSize: '1', channels: [] },
      });
      if (r.code !== 'created') throw new Error(`provision: ${r.code}`);
      if (who === 'Ops') BIZ = r.businessId; else OTHER = r.businessId;
    }
  }, 60_000);

  afterAll(async () => {
    // backup_runs and backup_failures are the installation's: what this file wrote must not be "the newest" later.
    if (names.length) {
      await admin?.query('delete from backup_failures where name = any($1)', [names]);
      await admin?.query('delete from backup_runs where name = any($1)', [names]);
    }
    await admin?.query('update undelivered_alerts set delivered_at = now() where business_id = any($1) and delivered_at is null', [[BIZ, OTHER]]);
    await admin?.end(); await db?.destroy();
  });

  it('(4) a failed run: the job writes it, the app only reads it, and the operator is told of it once', async () => {
    const failed = RUN_NAME(1); names.push(failed);
    await expect(sql`insert into backup_failures (name, step, reason) values (${failed}, 'upload', 'upload')`.execute(db)).rejects.toThrow();
    await admin.query(`insert into backup_failures (name, failed_at, step, reason) values ($1, now() + interval '1 hour', 'upload', 'upload')`, [failed]);
    expect((await reasons()).some((r) => r.includes(`failed at its upload step (${failed})`))).toBe(true);
    const { backupFailureAlerts } = await import('../../src/pipeline/alarms.js');
    const told = await backupFailureAlerts(db, BIZ);
    const ours = told.filter((j) => j.backupFailure?.name === failed);
    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatchObject({ businessId: BIZ, kind: 'backup_failed', backupFailure: { step: 'upload', reason: 'upload' } });
    expect((await backupFailureAlerts(db, BIZ)).filter((j) => j.backupFailure?.name === failed)).toHaveLength(0);
    // a run that completes after it clears the alarm (the control: the same reader, a newer good run)
    const good = RUN_NAME(2); names.push(good);
    await admin.query(`insert into backup_runs (name, taken_at, uploaded_at, dump_bytes, sha256, schema_version, drill_passed)
      values ($1, now() + interval '2 hours', now() + interval '2 hours', 1500000, $2, 217, true)`, [good, 'd'.repeat(64)]);
    expect((await reasons()).some((r) => r.includes('scheduled backup'))).toBe(false);
  });

  it('(1, 2) the operator\'s mailbox dead fails the heartbeat; its owner is told once', async () => {
    await admin.query(
      `insert into mail_accounts (business_id, provider, address, refresh_token_ciphertext, fingerprint, scopes, connected_by, needs_attention_at, last_error)
       values ($1, 'google', $2, 'v1.x', 'abcdef012345', 'openid email', 'test', now(), 'revoked')`, [BIZ, EMAIL]);
    expect(await reasons()).toContain("the operator's mailbox must be connected again (revoked)");
    // not asked where the operator's mail does not leave through a mailbox (the control)
    const { alarmReasons } = await import('../../src/pipeline/alarms.js');
    expect((await alarmReasons(db, { operatorBusinessId: BIZ, operatorMailbox: false })).some((r) => r.includes('mailbox'))).toBe(false);
    const { mailboxAlerts } = await import('../../src/pipeline/alarms.js');
    const told = (await mailboxAlerts(db)).filter((j) => j.businessId === BIZ);
    expect(told).toEqual([expect.objectContaining({ kind: 'mailbox_disconnected', mailbox: expect.objectContaining({ address: EMAIL }) })]);
    expect((await mailboxAlerts(db)).filter((j) => j.businessId === BIZ)).toHaveLength(0);
  });

  it('(3) an operator alert that reached nobody is kept, said, and fails the heartbeat — one row, its tries counted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await deliver({ kind: 'deletion_due', deletionsDue: [] })).toBe('failed_permanent');
      expect(await deliver({ kind: 'deletion_due', deletionsDue: [] })).toBe('failed_permanent');
    } finally { warn.mockRestore(); }
    const rows = (await mine()).filter((r) => r.kind === 'deletion_due');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tries: 2, delivered: false });
    expect(rows[0]!.why).toContain('e-mail: mailbox: the mail account must be connected again');
    expect((await reasons()).some((r) => /reached nobody.*deletion_due/.test(r))).toBe(true);
    // another workspace sees none of it (row security)
    expect(await tenant(OTHER, (tx) => sql<{ n: number }>`select count(*)::int as n from undelivered_alerts`.execute(tx).then((r) => r.rows[0]!.n))).toBe(0);
  });

  it('(3) a WhatsApp refusal is said in the log, whichever kind it is', async () => {
    await admin.query('update businesses set owner_phone = $2 where id = $1', [BIZ, '+971500000217']);
    await admin.query(`insert into channels (business_id, kind, status, activated_at) values ($1, 'whatsapp', 'connected', now()) on conflict do nothing`, [BIZ]);
    const lines: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation((l: unknown) => { lines.push(String(l)); });
    try {
      const refused = { sendText: async () => ({ ok: false as const, retryable: false, error: '131047 re-engagement message' }) };
      expect(await deliver({ kind: 'deletion_due', deletionsDue: [] }, { adapter: refused })).toBe('failed_permanent');
    } finally { warn.mockRestore(); }
    expect(lines.some((l) => l.includes('deletion_due WhatsApp alert failed: 131047 re-engagement message'))).toBe(true);
    // still one row: the newest words, the third try
    const row = (await mine()).filter((r) => r.kind === 'deletion_due');
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ tries: 3 });
    expect(row[0]!.why).toContain('WhatsApp: 131047');
    await admin.query('update channels set activated_at = null where business_id = $1', [BIZ]);
  });

  it('(3) tried again within the hour: delivered when a way works; one no longer true is closed, never sent', async () => {
    const { retryUndelivered } = await import('../../src/pipeline/notify.js');
    // a backup_stale that waits, while the backups are fresh again (the good run above)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { await deliver({ kind: 'backup_stale' }); } finally { warn.mockRestore(); }
    // not tried within the hour yet: nothing happens
    inbox.length = 0;
    let r = await retryUndelivered({ db, adapter: noWhatsApp, mail: working });
    expect(inbox.filter((m) => m.to === EMAIL)).toHaveLength(0);
    await admin.query(`update undelivered_alerts set last_tried_at = now() - interval '2 hours' where business_id = $1`, [BIZ]);
    r = await retryUndelivered({ db, adapter: noWhatsApp, mail: working });
    expect(r.delivered).toBeGreaterThanOrEqual(1);
    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const sent = inbox.filter((m) => m.to === EMAIL).map((m) => m.subject);
    expect(sent).toEqual([t('en', 'notify.deletion_due.subject')]);   // the backup alert is not among them: closed, never sent
    expect((await mine()).every((row) => row.delivered)).toBe(true);
    expect((await reasons()).some((x) => x.includes('reached nobody') && x.includes('deletion_due'))).toBe(false);
  });

  it('(3) the owner\'s phone is a way out that needs no mailbox and no WhatsApp', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const keys = {
      publicKey: publicKey.export({ format: 'der', type: 'spki' }).subarray(-65).toString('base64url'),
      privateKey: (privateKey.export({ format: 'jwk' }) as { d: string }).d,
      subject: 'mailto:alerts@example.test',
    };
    const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
    await admin.query(`insert into push_subscriptions (business_id, person_id, endpoint, p256dh, auth) values ($1, null, $2, $3, $4)`,
      [BIZ, `https://push.example.test/ops-${RUN}`, ecdh.getPublicKey().toString('base64url'), Buffer.alloc(16, 7).toString('base64url')]);
    const pushed: string[] = [];
    const push = { keys, fetch: async (url: string) => { pushed.push(url); return { status: 201 }; } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await deliver({ kind: 'meta_errors', metaErrors: [] }, { push })).toBe('sent');
    } finally { warn.mockRestore(); }
    expect(pushed).toEqual([`https://push.example.test/ops-${RUN}`]);
    expect((await mine()).some((row) => row.kind === 'meta_errors' && !row.delivered)).toBe(false);
  });

  it('(3) an operator alert with nowhere at all to go is kept too; an account letter with nowhere to go is not', async () => {
    await admin.query('update businesses set owner_phone = null where id = $1', [BIZ]);
    await admin.query('update push_subscriptions set archived_at = now(), archived_reason = $2 where business_id = $1', [BIZ, 'removed']);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await deliver({ kind: 'spend_breaker' }, { mail: null })).toBe('skipped_no_destination');
      expect(await deliver({ kind: 'connection_refused' }, { mail: null })).toBe('skipped_no_destination');
    } finally { warn.mockRestore(); }
    const rows = await mine();
    expect(rows.find((r) => r.kind === 'spend_breaker' && !r.delivered)?.why).toContain('nowhere to go');
    expect(rows.some((r) => r.kind === 'connection_refused')).toBe(false);
  });
});
