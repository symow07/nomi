import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { backupFreshness, BACKUP_MAX_AGE_HOURS } from '../../src/core/ops/backups.js';
import { renderOwnerAlert } from '../../src/pipeline/notify.js';
import { t, messages } from '../../src/core/owner/i18n/messages.js';
import { formatDate } from '../../src/core/owner/i18n/format.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { QUEUES } from '../../src/queue/boss.js';

/**
 * The scheduled backup, and the owner being told when it stops.
 *
 * The backup itself runs as a Railway cron service (backup/run.sh); this file
 * holds the parts that live in this build — the staleness rule, the alert's
 * words, the daily check's wiring — and the SHAPE of the job script: the
 * order of its steps is what makes an uploaded backup one that restores.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const H = 3_600_000;

describe('when is a backup stale', () => {
  const now = new Date('2026-09-24T06:30:00Z');
  it('a run within 36 hours is fresh, older is stale, none ever is stale with no age', () => {
    expect(BACKUP_MAX_AGE_HOURS).toBe(36);
    expect(backupFreshness(new Date(now.getTime() - 3 * H), now)).toEqual({ stale: false, hoursSince: 3 });
    expect(backupFreshness(new Date(now.getTime() - 35 * H), now).stale).toBe(false);
    expect(backupFreshness(new Date(now.getTime() - 37 * H), now)).toEqual({ stale: true, hoursSince: 37 });
    expect(backupFreshness(null, now)).toEqual({ stale: true, hoursSince: null });
  });
});

describe('the alert, in the owner’s words', () => {
  it('says since when, or that there has never been one, in every language', () => {
    const when = new Date('2026-09-20T03:00:00Z');
    for (const l of LOCALES) {
      const dated = renderOwnerAlert(l, 'backup_stale', null, { lastBackupAt: when });
      expect(dated, l).toContain(formatDate(l, when));
      expect(dated, l).toBe(t(l, 'notify.backup_stale', { when: formatDate(l, when) }));
      expect(renderOwnerAlert(l, 'backup_stale', null, { lastBackupAt: null }), l).toBe(t(l, 'notify.backup_stale.never'));
      expect(messages[l]['notify.backup_stale.subject'].length, l).toBeGreaterThan(0);
    }
  });

  it('carries no technical vocabulary, and no pronoun for anyone', () => {
    for (const l of LOCALES) {
      for (const key of ['notify.backup_stale', 'notify.backup_stale.never', 'notify.backup_stale.subject'] as const) {
        const s = messages[l][key].toLowerCase();
        for (const w of ['server', 'database', 'cron', 'job', 'railway', 'bucket', 's3', 'api']) {
          expect(new RegExp(`\\b${w}\\b`).test(s), `${l}/${key}: ${w}`).toBe(false);
        }
        expect(s).not.toMatch(/\b(she|her|he|his)\b/);
      }
    }
  });
});

describe('the daily check is wired, and the alert can leave by e-mail', () => {
  const main = read('src/main.ts');
  it('schedules the backups queue after the job’s hour and hands the notify worker the installation’s sender', () => {
    expect(QUEUES.backups).toBe('ops.backups');
    expect(main).toMatch(/boss\.schedule\(QUEUES\.backups, '30 6 \* \* \*'/);
    expect(main).toMatch(/deliverOwnerAlert\(\{ db, adapter: adapter \?\? noNumberForAlerts, mail: systemMail \}/);
    expect(main).toMatch(/kind: 'backup_stale'/);
  });
});

describe('backup/run.sh — the order of steps is the guarantee', () => {
  const run = read('backup/run.sh');
  const at = (s: string) => { const i = run.indexOf(s); expect(i, `missing: ${s}`).toBeGreaterThan(-1); return i; };

  it('dumps, drills with the laptop’s own script, encrypts, uploads, prunes, records, pings — in that order', () => {
    const dump = at('pg_dump" -Fc');
    const drill = at('bash /app/verify-restore.sh "$STAGE"');
    const encrypt = at('age -r "$AGE_RECIPIENT"');
    const upload = at('rclone copy "$ENC"');
    const prune = at('rclone delete "BK:$BUCKET/daily/" --min-age');
    const record = at('insert into backup_runs');
    const ping = run.lastIndexOf('ping ""');
    expect([dump, drill, encrypt, upload, prune, record, ping]).toEqual([dump, drill, encrypt, upload, prune, record, ping].slice().sort((a, b) => a - b));
    expect(run).toContain('NOT uploaded');                      // a failed drill stops the run
    expect(run).toMatch(/set -uo pipefail/);
  });

  it('prunes only under daily/, never the laptop’s manual pairs at the root', () => {
    expect(run).not.toMatch(/rclone delete "BK:\$BUCKET\/?"\s/);
    expect(run).toContain('--min-age "${RETENTION_DAYS}d"');
  });

  it('connects through the environment only — no URL is built anywhere', () => {
    expect(run).not.toMatch(/postgres(ql)?:\/\//);
    expect(run).not.toMatch(/\s-d\s+"?\$/);
    expect(run).toMatch(/: "\$\{PGHOST:\?\}"/);
  });

  it('the image matches the server’s major, carries pgvector, and does not run as root', () => {
    const df = read('backup/Dockerfile');
    expect(df).toMatch(/^FROM postgres:18-/m);
    expect(df).toContain('postgresql-18-pgvector');
    expect(df).toContain('COPY tools/verify-restore.sh /app/verify-restore.sh');
    expect(df).toMatch(/^USER postgres/m);
  });

  it('verify-restore.sh no longer pins the table count at 40', () => {
    const v = read('tools/verify-restore.sh');
    expect(v).not.toContain('"40"');
    expect(v).toContain('"$VIOL_OFF" = "0" ] && [ "$VIOL_NOPOL" = "0" ]');
  });
});
