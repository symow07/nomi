import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { NOTHING_TODAY } from '../../src/api/web/today.js';
import { renderPhotoRefusal } from '../../src/api/web/products.js';
import { renderOwnerAlert, goesByMail, waitsInApp, ALLOWANCE_ALERT_KINDS } from '../../src/pipeline/notify.js';
import { allowanceRenewsAt, PHOTO_READS_A_DAY } from '../../src/db/allowance.js';
import { HOLD_OUTCOME, HOLD_REASON } from '../../src/db/assistantStop.js';
import { PROBLEM_SIGNAL_KINDS, TRIGGER_REASONS, toTriggerReason, SIGNAL_SAMPLES } from '../../src/core/scoring/signals.js';
import { withZone } from '../../src/api/web/zone.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, ASSISTANT_FALLBACK, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * G3 (0101) — the day's allowance: a third hold, before any model call; what
 * the owner reads of it on Today, on My business, in the two e-mails and when
 * a photo of a list is refused. Over Postgres: tests/integration/g3-allowance.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-01T15:00:00Z');
const RENEWS = allowanceRenewsAt(NOW);
const snapshot = (budget: OperationsSnapshot['budget']): OperationsSnapshot => ({
  range: 'today',
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 },
  activity: { handled: 3, draftsCreated: 2, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'connected', provider: 'meta' },
  budget, hasAttention: false,
});

describe('G3 · the hold', () => {
  it('a third reason, asked last: ops, then the owner\'s Stop, then the allowance', () => {
    const hold = src('src/db/assistantStop.ts');
    const body = hold.slice(hold.indexOf('export async function assistantHold'));
    const [ops, stop, allowance] = ['globalSilence', 'assistantStopped(tx, businessId)', 'allowanceUsed(await allowanceOf(tx))'].map((s) => body.indexOf(s));
    expect(ops).toBeGreaterThan(-1);
    expect(ops).toBeLessThan(stop!);
    expect(stop).toBeLessThan(allowance!);
  });
  it('its own hand-off reason: a problem that gates, with its own words in every language', () => {
    expect(HOLD_REASON.allowance).toBe('allowance_used');
    expect(HOLD_OUTCOME.allowance).toBe('allowance_used');
    expect(PROBLEM_SIGNAL_KINDS).toContain('allowance_used');
    expect(TRIGGER_REASONS).toContain('allowance_used');
    expect(toTriggerReason(SIGNAL_SAMPLES.allowance_used)).toBe('allowance_used');
    const m = src('migrations/0101_allowance.sql');
    expect(m.match(/'price_to_owner',\n {4}'allowance_used'\)\);/g)).toHaveLength(2);
    for (const l of LOCALES) {
      for (const k of ['takeover.reason.allowance_used', 'takeover.flash.allowance_used', 'inbox.flash.allowance_used', 'order.flash.allowance_used'] as const) {
        expect(t(l, k as MessageKey, { name: 'X' }), `${l} ${k}`).not.toBe(k);
      }
    }
  });
  it('the send gate, Today and My business read the one reader — none keeps its own budget query', () => {
    for (const f of ['src/db/channels.ts', 'src/api/web/operations.ts', 'src/api/web/factory.ts']) {
      expect(src(f), f).toContain('allowanceOf(tx)');
      expect(src(f), f).not.toMatch(/from tenant_budgets/);
    }
    // BILL — a lapsed payment pauses the same way.
    expect(src('src/db/channels.ts')).toContain('paused: allowanceUsed(await allowanceOf(tx)) || await billingHeld(tx),');
  });
});

describe('G3 · what the owner reads', () => {
  it('the allowance renews at the next midnight UTC', () => {
    expect(RENEWS.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    expect(allowanceRenewsAt(new Date('2026-10-01T00:00:00Z')).toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });
  for (const locale of LOCALES) {
    it(`${locale} · Today: used up, new messages wait, and when that ends — in the workspace's own time`, () => {
      const html = withoutIsolates(withZone('Asia/Dubai', () => renderOperationsHome(
        snapshot({ pctUsed: 100, stops: true, reached: true, renewsAt: RENEWS }), locale, NOTHING_TODAY(NOW))));
      expect(html).toContain(esc(t(locale, 'today.budget.reached', { name: ASSISTANT_FALLBACK[locale], time: '04:00' })));
      expect(html).not.toContain(esc(t(locale, 'today.budget.thenStops')));
    });
    it(`${locale} · the two e-mails: how much, and when it renews`, () => {
      const warn = renderOwnerAlert(locale, 'allowance_warn', null, { allowancePct: 82, renewsAt: RENEWS, zone: 'Asia/Dubai' });
      expect(warn).toBe(t(locale, 'notify.allowance_warn', { pct: 82, time: '04:00' }));
      const reached = renderOwnerAlert(locale, 'allowance_reached', null, { renewsAt: RENEWS, zone: 'Asia/Shanghai' });
      expect(reached).toBe(t(locale, 'notify.allowance_reached', { time: '08:00' }));
    });
    it(`${locale} · a photo of a list: how many are left today, none, or the allowance`, () => {
      const left = withoutIsolates(renderPhotoRefusal('daily_limit', locale, undefined, 2));
      expect(left).toContain(esc(t(locale, 'product.photo.refused.daily_limit', { n: 2, max: PHOTO_READS_A_DAY })));
      expect(withoutIsolates(renderPhotoRefusal('daily_limit', locale, undefined, 0))).toContain(esc(t(locale, 'product.photo.refused.daily_limit_none', { max: PHOTO_READS_A_DAY })));
      expect(renderPhotoRefusal('allowance_used', locale)).toContain(esc(t(locale, 'product.photo.refused.allowance_used')));
      // Another photo would be refused the same way: the door is pasting the text, which works now.
      expect(left).toContain(esc(t(locale, 'product.photo.pasteInstead')));
      expect(left).not.toContain(esc(t(locale, 'product.photo.retake')));
    });
  }
  it('phase 8 of the warmth run: both wait in the app now — at 100% each new message is handed over, and that is what reaches the owner', () => {
    // Deliberately changed from "by mail always": the owner (2026-10-03): "Only two things may interrupt the owner outside the app: an order waiting for their tap, and a conversation the assistant handed over because it could not handle it. Everything else waits quietly in-app."
    for (const k of ALLOWANCE_ALERT_KINDS) {
      expect(goesByMail(k), k).toBe(false);
      expect(waitsInApp(k), k).toBe(true);
    }
  });
  it('My business shows the allowance always: none, how much, or used up with a door to who waits', () => {
    const f = src('src/api/web/factory.ts');
    expect(f).toContain("'business.allowance.none'");
    expect(f).toContain("'business.allowance.used', { pct: Math.min(100, a.pctUsed), time: show.time(locale, a.renewsAt) }");
    expect(f).toContain("deeper('/app/inbox?filter=pending', t(locale, 'assistant.stop.needsYou'))");
    // Phase 7 — on the going-live screen, after the Stop and before WhatsApp's switch.
    expect(f).toContain('const readyBody = everyBlock + allowanceBlock + (s.waRelevant');
  });
  it('20 photos a day, counted on the ledger as each is read', () => {
    expect(PHOTO_READS_A_DAY).toBe(20);
    expect(src('src/api/web/app.ts')).toContain('recordSpendAlone(deps.db, s.businessId, u, { turn: false, photoReads: 1 })');
  });
});
