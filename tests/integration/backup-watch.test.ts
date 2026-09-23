import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { seedRunTenant } from './tenant.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { formatDate } from '../../src/core/owner/i18n/format.js';

/**
 * THE BACKUP ALERT REACHES THE OWNER WITH NO CHANNEL CONNECTED.
 *
 * WhatsApp is still pending Meta's verification for the pilot, and an alert
 * that says "your data has no safe copy" must not wait on that. So it travels
 * by the installation's own mail to the owner's sign-in address, always; and
 * by WhatsApp as well, only where a channel is live and a number is set.
 * Only a real database proves the lookups: the login e-mail through the
 * owner's person row, the "live" fact from `channels.activated_at`, and the
 * newest `backup_runs` row, which the app may only read.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const MIGRATE_URL = process.env['MIGRATE_DATABASE_URL'];
const d = DATABASE_URL && MIGRATE_URL ? describe : describe.skip;

const RUN = randomUUID().slice(0, 8);

d('backup alert and backup runs (requires DATABASE_URL + MIGRATE_DATABASE_URL)', () => {
  let db: import('../../src/db/client.js').Db;
  let admin: pg.Client;
  let BIZ = '';
  const EMAIL = `owner-${RUN}@example.com`;

  const mailbox: { to: string; subject: string; text: string }[] = [];
  const mail = { from: 'nomi@example.com', send: async (m: { to: string; subject: string; text: string }) => { mailbox.push(m); return { ok: true as const }; } };
  const texts: { to: string; body: string }[] = [];
  const adapter = { sendText: async (to: string, body: string) => { texts.push({ to, body }); return { ok: true as const, providerMessageId: 'x' }; } };

  beforeAll(async () => {
    await seedRunTenant();
    const { createDb } = await import('../../src/db/client.js');
    const { provisionAccount } = await import('../../src/db/accounts.js');
    db = createDb(DATABASE_URL!);
    admin = new pg.Client({ connectionString: MIGRATE_URL });
    await admin.connect();
    // A workspace the way sign-up makes one: business, owner, login — and
    // nothing else. No channel, no phone.
    const r = await provisionAccount(db, {
      factory: `Backup Alert Co ${RUN}`, language: 'en', ownerName: 'Owner', email: EMAIL,
      passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', invite: null, inviteRequired: false,
      profile: { kind: 'retail', sells: 'lamps', country: 'AE', website: null, teamSize: '1', channels: [] },
    });
    if (r.code !== 'created') throw new Error(`provision: ${r.code}`);
    BIZ = r.businessId;
  }, 60_000);

  afterAll(async () => { await admin?.end(); await db?.destroy(); });

  const deliver = async (job: Partial<import('../../src/queue/boss.js').NotifyJob> = {}, deps: { mail?: typeof mail | null } = { mail }) => {
    const { deliverOwnerAlert } = await import('../../src/pipeline/notify.js');
    return deliverOwnerAlert({ db, adapter, mail: deps.mail ?? null },
      { businessId: BIZ, kind: 'backup_stale', conversationId: null, lastBackupAt: null, ...job });
  };

  it('with NO channel connected and no phone, the alert still arrives — by e-mail, to the sign-in address', async () => {
    mailbox.length = 0; texts.length = 0;
    const when = new Date('2026-09-20T03:00:00Z');
    expect(await deliver({ lastBackupAt: when.toISOString() })).toBe('sent');
    expect(mailbox).toHaveLength(1);
    expect(mailbox[0]!.to).toBe(EMAIL);
    expect(mailbox[0]!.subject).toBe(t('en', 'notify.backup_stale.subject'));
    expect(mailbox[0]!.text).toBe(t('en', 'notify.backup_stale', { when: formatDate('en', when) }));
    expect(texts).toHaveLength(0);
  });

  it('"never completed" is its own sentence', async () => {
    mailbox.length = 0;
    expect(await deliver({ lastBackupAt: null })).toBe('sent');
    expect(mailbox[0]!.text).toBe(t('en', 'notify.backup_stale.never'));
  });

  it('a number without a live channel changes nothing: e-mail only', async () => {
    await admin.query('update businesses set owner_phone = $2 where id = $1', [BIZ, '+971500000001']);
    mailbox.length = 0; texts.length = 0;
    expect(await deliver()).toBe('sent');
    expect(mailbox).toHaveLength(1);
    expect(texts).toHaveLength(0);
  });

  it('a live channel adds WhatsApp beside the e-mail', async () => {
    await admin.query(
      `insert into channels (business_id, kind, status, activated_at) values ($1, 'whatsapp', 'connected', now())
       on conflict do nothing`, [BIZ]);
    mailbox.length = 0; texts.length = 0;
    expect(await deliver()).toBe('sent');
    expect(mailbox).toHaveLength(1);
    expect(texts).toHaveLength(1);
    expect(texts[0]!.to).toBe('+971500000001');
    expect(texts[0]!.body).toBe(mailbox[0]!.text);
  });

  it('no sender and no live channel is reported as nowhere to go, not as sent', async () => {
    await admin.query('update channels set activated_at = null where business_id = $1', [BIZ]);
    mailbox.length = 0; texts.length = 0;
    expect(await deliver({}, { mail: null })).toBe('skipped_no_destination');
    expect(mailbox).toHaveLength(0);
    expect(texts).toHaveLength(0);
  });

  it('the newest completed run is what the app reads, and Getting ready shows it as checked', async () => {
    const { latestBackupRun } = await import('../../src/db/backups.js');
    const { loadPilotReadiness } = await import('../../src/api/web/pilot.js');
    const name = `nomi-backup-test-${RUN}`;
    // The app role may only read; the job writes as the admin it dumps with.
    await expect(sql`insert into backup_runs (name, taken_at, dump_bytes, sha256, schema_version, drill_passed)
      values (${name}, now(), 1, ${'a'.repeat(64)}, 69, true)`.execute(db)).rejects.toThrow();
    await admin.query(
      `insert into backup_runs (name, taken_at, uploaded_at, dump_bytes, sha256, schema_version, drill_passed)
       values ($1, now(), now() + interval '1 second', 1500000, $2, 69, true)`, [name, 'b'.repeat(64)]);
    const latest = await latestBackupRun(db);
    expect(latest?.name).toBe(name);
    expect(latest?.dumpBytes).toBe(1500000);
    const readiness = await loadPilotReadiness(db, BIZ);
    expect(readiness.backupVerifiedAt).not.toBeNull();
    // a failed drill never counts as the latest good one
    await admin.query(
      `insert into backup_runs (name, taken_at, uploaded_at, dump_bytes, sha256, schema_version, drill_passed)
       values ($1, now(), now() + interval '2 seconds', 1, $2, 69, false)`, [`${name}-failed`, 'c'.repeat(64)]);
    expect((await latestBackupRun(db))?.name).toBe(name);
  });
});
