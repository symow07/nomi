import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  URGENT_KINDS, INTERRUPTION_KINDS, QUIET_KINDS, DAILY_KINDS, OPERATOR_ALERT_KINDS, URGENT_PRIORITY, DAILY_PRIORITY, URGENT_LATE_MS,
  alertPriority, isUrgent, lateUrgentAlert, sendAlert,
} from '../../src/pipeline/notify.js';
import type { NotifyJob } from '../../src/queue/boss.js';

/**
 * THE GUARD THE 106 SECONDS ASKED FOR (the owner, 2026-10-13). A customer's hand-over waited 106 s behind a batch the
 * morning summary queued; #320 lowered the summaries. This holds the general rule, so the next job that floods the
 * alert queue fails here instead of delaying a buyer:
 *   · the alerts a customer is waiting on now (URGENT_KINDS) go above every other alert, the daily letter below all;
 *   · every alert is queued through `sendAlert`, which gives it its class's priority — no other send to the queue;
 *   · an urgent alert that waited more than a minute is reported by the worker (`lateUrgentAlert`).
 * `tests/integration/alert-time-to-send.test.ts` measures it on the real queue.
 */

const ALL = [...new Set([...INTERRUPTION_KINDS, ...QUIET_KINDS, ...DAILY_KINDS, ...OPERATOR_ALERT_KINDS])];

describe('the alerts a customer is waiting on go first', () => {
  it('urgent is a hand-over, an order waiting, a deletion request — each an interruption; the daily chase is not urgent', () => {
    expect([...URGENT_KINDS].sort()).toEqual(['deletion_requested', 'handoff', 'order_proposed']);
    for (const k of URGENT_KINDS) expect(INTERRUPTION_KINDS as readonly string[], k).toContain(k);
    expect(isUrgent('deletion_reminder')).toBe(false);
  });

  it('every urgent alert outranks every other alert; the daily letter is below everything', () => {
    const others = ALL.filter((k) => !isUrgent(k));
    for (const u of URGENT_KINDS) for (const o of others) expect(alertPriority(u), `${u} over ${o}`).toBeGreaterThan(alertPriority(o));
    expect(alertPriority('handoff')).toBe(URGENT_PRIORITY);
    for (const d of DAILY_KINDS) for (const o of ALL.filter((k) => !(DAILY_KINDS as readonly string[]).includes(k))) {
      expect(alertPriority(d), `${d} under ${o}`).toBeLessThan(alertPriority(o));
    }
    expect(alertPriority('morning_summary')).toBe(DAILY_PRIORITY);
  });

  it('sendAlert queues on the alert queue with the class priority, keeping every other option', async () => {
    const sent: { name: string; data: unknown; options: Record<string, unknown> }[] = [];
    const boss = { send: async (name: string, data: unknown, options: Record<string, unknown>) => { sent.push({ name, data, options }); return 'id'; } };
    const job = { businessId: 'b', kind: 'handoff', conversationId: 'c' } as NotifyJob;
    await sendAlert(boss as never, job, { singletonKey: 'k' });
    await sendAlert(boss as never, { ...job, kind: 'morning_summary' } as NotifyJob);
    expect(sent).toEqual([
      { name: 'notify.team', data: job, options: { singletonKey: 'k', priority: URGENT_PRIORITY } },
      { name: 'notify.team', data: { ...job, kind: 'morning_summary' }, options: { priority: DAILY_PRIORITY } },
    ]);
  });

  it('nothing in src/ queues an alert any other way', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
    walk('src');
    const bypass = files.filter((f) => !f.endsWith('pipeline/notify.ts'))
      .filter((f) => /\.send\(\s*QUEUES\.notify\b|\.send\(\s*'notify\.team'/.test(readFileSync(f, 'utf8')));
    expect(bypass, 'an alert queued without its class priority').toEqual([]);
    const notify = readFileSync('src/pipeline/notify.ts', 'utf8');
    expect(notify.match(/\.send\(\s*QUEUES\.notify\b/g)).toHaveLength(1);
  });
});

describe('the alarm on time-to-send', () => {
  const at = new Date('2026-10-13T08:00:00Z');
  it('an urgent alert that waited over a minute is late; under, or any other kind, or no time on record, is not', () => {
    expect(lateUrgentAlert('handoff', new Date(at.getTime() - URGENT_LATE_MS - 1000), at)).toBe(URGENT_LATE_MS + 1000);
    expect(lateUrgentAlert('handoff', new Date(at.getTime() - URGENT_LATE_MS), at)).toBeNull();
    expect(lateUrgentAlert('morning_summary', new Date(at.getTime() - 10 * URGENT_LATE_MS), at)).toBeNull();
    expect(lateUrgentAlert('order_proposed', null, at)).toBeNull();
  });

  it('the alert worker reads when each job was queued and reports a late urgent one', () => {
    const src = readFileSync('src/main.ts', 'utf8');
    const worker = src.slice(src.indexOf('await boss.work(QUEUES.notify'), src.indexOf('deliverOwnerAlert(', src.indexOf('await boss.work(QUEUES.notify')));
    expect(worker).toContain('{ includeMetadata: true }');
    expect(worker).toContain('lateUrgentAlert(job.data.kind, job.createdOn, new Date())');
    expect(worker).toMatch(/errors\.report\(/);
  });
});
