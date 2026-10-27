import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { backupState } from '../../src/core/ops/backups.js';
import { heartbeatTick, type PingFetch } from '../../src/worker/heartbeat.js';
import { BACKUP_STEPS, goesByMail, isOperatorAlert, renderOwnerAlert } from '../../src/pipeline/notify.js';
import { messages, t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * 0217 — AN ALARM THAT REACHES SOMEBODY, in the parts that need no database. On 2026-10-22 the backup's upload was
 * refused; the app's alert went into a mailbox Google had revoked; the heartbeat stayed green.
 */
const ROOT = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('the backups, as the heartbeat reads them', () => {
  const now = new Date('2026-10-28T06:00:00Z');
  const h = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
  it('a failure newer than the last good run is a failed backup — now, not 36 hours later', () => {
    expect(backupState(h(27), h(3), now)).toBe('failed');
    expect(backupState(null, h(3), now)).toBe('failed');
  });
  it('a good run after the failure clears it; an old good run alone is stale; neither ever is nothing to judge', () => {
    expect(backupState(h(1), h(3), now)).toBe('fresh');
    expect(backupState(h(37), null, now)).toBe('stale');
    expect(backupState(h(37), h(40), now)).toBe('stale');
    expect(backupState(h(30), null, now)).toBe('fresh');
    expect(backupState(null, null, now)).toBe('none');
  });
});

describe('the heartbeat does not stay green through an alarm', () => {
  const ping = () => {
    const asked: string[] = [];
    const fetch: PingFetch = async (url) => { asked.push(url); return { ok: true, status: 200 }; };
    return { asked, fetch };
  };
  const base = { url: 'https://hc-ping.com/abc', probeDb: async () => true, probeHttp: async () => true, probeTimeoutMs: 200 };

  it('a reason fails the tick: /fail is pinged and the log says why, never the address', async () => {
    const p = ping(); const lines: string[] = [];
    const r = await heartbeatTick({ ...base, fetch: p.fetch, log: (l) => lines.push(l),
      alarms: async () => ["the operator's mailbox must be connected again (revoked)"] });
    expect(r).toBe('unhealthy');
    expect(p.asked).toEqual(['https://hc-ping.com/abc/fail']);
    expect(lines.join('\n')).toContain("the operator's mailbox must be connected again");
    expect(lines.join('\n')).not.toContain('hc-ping.com');
  });
  it('no reason is the healthy ping (the control)', async () => {
    const p = ping();
    expect(await heartbeatTick({ ...base, fetch: p.fetch, log: () => {}, alarms: async () => [] })).toBe('healthy');
    expect(p.asked).toEqual(['https://hc-ping.com/abc']);
  });
  it('alarms that throw or never answer are a reason too', async () => {
    for (const alarms of [async () => { throw new Error('no'); }, () => new Promise<readonly string[]>(() => {})]) {
      const p = ping(); const lines: string[] = [];
      expect(await heartbeatTick({ ...base, fetch: p.fetch, log: (l) => lines.push(l), alarms })).toBe('unhealthy');
      expect(p.asked).toEqual(['https://hc-ping.com/abc/fail']);
      expect(lines.join('\n')).toContain('the alarm checks did not answer');
    }
  });
  it('production hands the heartbeat its alarms', () => {
    const main = read('src/main.ts');
    expect(main).toContain('alarms: prod.alarms');
    expect(main).toContain('alarms: () => alarmReasons(db, { operatorBusinessId: PILOT_BUSINESS_ID, operatorMailbox: systemSmtp !== null })');
  });
});

describe('the two new alerts', () => {
  it('a failed backup is the operator\'s; a dead mailbox is a letter to its own owner; both go by e-mail always', () => {
    expect(isOperatorAlert('backup_failed')).toBe(true);
    expect(goesByMail('backup_failed')).toBe(true);
    expect(isOperatorAlert('mailbox_disconnected')).toBe(false);
    expect(goesByMail('mailbox_disconnected')).toBe(true);
  });
  it('say which run, when, at which step and in the job\'s words — in every language', () => {
    const at = new Date('2026-10-22T03:04:16Z');
    for (const l of LOCALES) {
      const said = renderOwnerAlert(l, 'backup_failed', null, { backupFailure: { name: 'nomi-backup-20261022T030412Z', at, step: 'upload', reason: 'upload' }, zone: 'UTC' });
      expect(said, l).toContain('nomi-backup-20261022T030412Z');
      expect(said, l).toContain(t(l, 'backup.failedStep.upload'));
      expect(messages[l]['notify.backup_failed.subject'].length, l).toBeGreaterThan(0);
      for (const s of [...BACKUP_STEPS, 'other'] as const) expect(messages[l][`backup.failedStep.${s}`].length, `${l} ${s}`).toBeGreaterThan(0);
      // a step the job did not name is said as "running", never as a raw key
      expect(renderOwnerAlert(l, 'backup_failed', null, { backupFailure: { name: 'n', at, step: 'weird', reason: 'r' } }), l)
        .toContain(t(l, 'backup.failedStep.other'));
      const mailbox = renderOwnerAlert(l, 'mailbox_disconnected', null, { mailbox: { address: 'ops@example.com', since: at }, zone: 'UTC' });
      expect(mailbox, l).toContain('ops@example.com');
      expect(messages[l]['notify.mailbox_disconnected.subject'].length, l).toBeGreaterThan(0);
    }
  });
  it('the five-minute sweep tells them; the hourly retry tries again what reached nobody', () => {
    const main = read('src/main.ts');
    expect(main).toContain('...await backupFailureAlerts(db, PILOT_BUSINESS_ID), ...await mailboxAlerts(db)');
    expect(main).toMatch(/boss\.schedule\(QUEUES\.alertRetry, '45 \* \* \* \*'/);
    expect(main).toContain('await retryUndelivered(notifyDeps())');
  });
});

describe('backup/run.sh — a failed run writes its row before it pings /fail', () => {
  const run = read('backup/run.sh');
  it('every section sets its step, in order, and each is one the table takes', () => {
    const marks = ['STEP=read', 'STEP=dump', 'STEP=drill', 'STEP=encrypt', 'STEP=upload', 'STEP=record', 'STEP=prune'];
    const at = marks.map((m) => run.indexOf(m));
    expect(at.every((i) => i > 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    const migration = read('migrations/0217_alarms_reach_owner.sql');
    for (const m of marks) expect(migration).toContain(`'${m.slice(5)}'`);
    // each step is set before its section's first command can fail
    expect(run.indexOf('STEP=dump')).toBeLessThan(run.indexOf('"$PGBIN/pg_dumpall"'));
    expect(run.indexOf('STEP=upload')).toBeLessThan(run.indexOf('rclone copy'));
    expect(run.indexOf('STEP=prune')).toBeLessThan(run.indexOf('the prune did not finish: $PRUNE_PROBLEM'));
  });

  // The functions, lifted out and run with a psql that writes down what it was asked.
  const fns = run.slice(run.indexOf('ping() {'), run.indexOf('ping /start'));
  const lifted = (psqlExit: number) => {
    const dir = mkdtempSync(join(tmpdir(), 'nomi-failrow-'));
    const psql = join(dir, 'psql');
    writeFileSync(psql, `#!/usr/bin/env bash\n{ echo "ARGS $*"; echo "PGOPTIONS $PGOPTIONS"; cat; } > "${dir}/asked"\nexit ${psqlExit}\n`);
    chmodSync(psql, 0o755);
    const script = ['set -uo pipefail', `PGBIN="${dir}"`, 'PING=""', 'NAME=nomi-backup-20261022T030412Z', fns,
      'STEP=upload', 'fail "upload"'].join('\n');
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    let asked = '';
    try { asked = readFileSync(join(dir, 'asked'), 'utf8'); } catch { /* not asked */ }
    return { status: r.status, err: r.stderr, asked };
  };
  it('names the run, the step and the reason, with a time limit, and still fails the run', () => {
    const r = lifted(0);
    expect(r.status).toBe(1);
    expect(r.asked).toContain('name=nomi-backup-20261022T030412Z');
    expect(r.asked).toContain('step=upload');
    expect(r.asked).toContain('reason=upload');
    expect(r.asked).toContain('statement_timeout=10000');
    expect(r.asked).toContain("insert into backup_failures (name, step, reason) values (:'name', :'step', left(:'reason', 500));");
    expect(r.err).toContain('FAILED: upload');
  });
  it('a database that cannot be reached is said, and the run still ends as failed', () => {
    const r = lifted(2);
    expect(r.status).toBe(1);
    expect(r.err).toContain('the failure could not be written to backup_failures either');
  });
});
