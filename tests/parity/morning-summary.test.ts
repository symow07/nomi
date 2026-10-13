import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { morningLines, parseQuietHours, type MorningFacts } from '../../src/core/owner/morningSummary.js';
import { DAILY_KINDS, isDaily, interrupts, waitsInApp, goesByMail } from '../../src/pipeline/notify.js';
import { renderPhoneAlerts } from '../../src/api/web/phoneAlerts.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * Phase 2a (the owner's roadmap, 2026-10-13) — THE MORNING SUMMARY: each morning Nomi tells the owner who is
 * waiting, who went quiet and what sold — 08:00 in the business's zone, never inside the owner's quiet hours,
 * once a day, nothing on a day with nothing to say, and the owner can turn it off. The fourth class of
 * notification (the owner's word). The database half is tests/integration/morning-summary.test.ts.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f: string) => readFileSync(`${ROOT}${f}`, 'utf8');
const empty: MorningFacts = { waiting: 0, quiet: 0, sold: { n: 0, totals: [] } };

describe('Phase 2a · what the summary says', () => {
  it('nothing to say is no summary at all', () => {
    for (const l of LOCALES) expect(morningLines(l, empty), l).toBeNull();
  });
  it('how many wait, how many went quiet, what sold — each only when there is something; counts, never a customer\'s name', () => {
    const lines = morningLines('en', { waiting: 5, quiet: 1, sold: { n: 2, totals: ['$120.00', '€40.00'] } })!;
    expect(lines).toEqual([
      'Customers waiting for you: 5.',
      'Customers who went quiet: 1.',
      'Orders confirmed yesterday: 2 ($120.00 and €40.00).',
    ]);
    // Like every alert that leaves Nomi: the catalogue's summary lines take no name at all.
    for (const l of LOCALES) for (const k of ['summary.waiting', 'summary.quiet', 'summary.sold', 'summary.soldBare'] as const) {
      expect(t(l, k), `${l} ${k}`).not.toMatch(/\{(name|names|buyer)\}/);
    }
    expect(morningLines('en', { ...empty, sold: { n: 1, totals: [] } })).toEqual(['Orders confirmed yesterday: 1.']);
  });
  it('every language says all three, with nothing left unfilled', () => {
    const full: MorningFacts = { waiting: 2, quiet: 1, sold: { n: 1, totals: ['$1.00'] } };
    for (const l of LOCALES) {
      const lines = morningLines(l, full)!;
      expect(lines, l).toHaveLength(3);
      for (const x of lines) expect(x, l).not.toMatch(/\{|\}/);
      expect(t(l, 'notify.morning_summary.subject'), l).not.toBe('notify.morning_summary.subject');
      expect(t(l, 'summary.off', { url: 'u' }), l).toContain('u');
    }
  });
});

describe('Phase 2a · quiet hours and the switch', () => {
  it('both or neither, whole hours, never the same hour twice', () => {
    expect(parseQuietHours('', '')).toEqual({ from: null, until: null });
    expect(parseQuietHours('22', '9')).toEqual({ from: 22, until: 9 });
    expect(parseQuietHours('9', '')).toBeNull();
    expect(parseQuietHours('9', '9')).toBeNull();
    expect(parseQuietHours('24', '3')).toBeNull();
    expect(parseQuietHours('x', '3')).toBeNull();
  });
  it('Notifications draws the switch and the quiet hours for the owner, never for a colleague', () => {
    const ways = { choice: null, email: 'o@shop.example', whatsapp: 'number' as const, ownerPhone: null };
    for (const l of LOCALES) {
      const owner = withoutIsolates(renderPhoneAlerts({ publicKey: null, phones: [],
        ways: { ...ways, isOwner: true, morning: { on: true, quietFrom: 22, quietUntil: 7 } } }, l, null));
      expect(owner, l).toContain('action="/app/settings/alerts/morning"');
      expect(owner, l).toContain(esc(t(l, 'alerts.morning.title')));
      expect(owner, l).toMatch(/name="on" value="1" checked/);
      expect(owner, l).toMatch(/<option value="22" selected>22:00<\/option>/);
      const colleague = withoutIsolates(renderPhoneAlerts({ publicKey: null, phones: [], ways: { ...ways, isOwner: false, morning: null } }, l, null));
      expect(colleague, l).not.toContain('/app/settings/alerts/morning');
    }
    expect(read('src/api/web/app.ts')).toContain("if (!quiet || !bid.ok || !personOf(s).isOwner) return flashTo(reply, '/app/settings/alerts#morning', 'alerts.flash.morningBad');");
  });
});

describe('Phase 2a · the fourth class, and how it leaves', () => {
  it('a daily letter: not an interruption, not quiet in the app, not an operator letter', () => {
    expect([...DAILY_KINDS]).toEqual(['morning_summary']);
    expect([isDaily('morning_summary'), interrupts('morning_summary'), waitsInApp('morning_summary'), goesByMail('morning_summary')])
      .toEqual([true, false, false, false]);
  });
  it('routed after the quiet and the operator kinds, before the interruptions; the same ways and fallback as theirs', () => {
    const src = read('src/pipeline/notify.ts');
    const body = src.slice(src.indexOf('export async function deliverOwnerAlert('), src.indexOf('/** Every kind is classified'));
    expect(body.indexOf('goesByMail(job.kind)')).toBeLessThan(body.indexOf('if (isDaily(job.kind)) return deliverMorningSummary(deps, bid.value, job);'));
    const fn = src.slice(src.indexOf('export async function deliverMorningSummary('));
    expect(fn).toContain('const r = await reachPeople([found.owner], {');
    expect(fn).toContain("if (!lines) { await morningSummaryDone(deps.db, personId, day, 'nothing', null); return 'skipped_quiet'; }");
    expect(fn).toContain('summary.off');
  });
  it('claimed once a local day: 08:00 in the business\'s zone, outside quiet hours, the owner\'s switch on, never a practice copy or a suspended workspace', () => {
    const m = read('migrations/0150_morning_summary.sql');
    expect(m).toContain('primary key (person_id, day)');
    expect(m).toContain('where extract(hour from h.local) >= 8');
    expect(m).toMatch(/p\.is_owner and p\.archived_at is null and p\.morning_summary/);
    expect(m).toContain('where b.practice_of is null');
    expect(m).toContain('s.restored_at is null');
    expect(m).toContain('on conflict (person_id, day) do nothing');
    expect(read('src/main.ts')).toContain("await boss.schedule(QUEUES.morningSummary, '*/15 * * * *', {});");
  });
});
