import { describe, it, expect } from 'vitest';
import {
  windowState, windowMsLeft, sendPlan, WINDOW_MS, CLOSING_SOON_MS,
} from '../../src/core/channel/window.js';
import {
  applyStatus, retryDelayMs, onSendFailure, shouldReclaim,
  MAX_SEND_ATTEMPTS, RETRY_MAX_MS, SENDING_RECLAIM_MS,
} from '../../src/core/channel/delivery.js';
import { gateOutbound, cancelableOnTakeover } from '../../src/core/channel/sendGate.js';
import { deriveHealth, CHANNEL_STATUS_ZH } from '../../src/core/channel/health.js';
import {
  renderChannelCard, renderTestResult, renderPermissions, renderComingSoon,
  renderOwnerProblem, validatePhoneZh, validateConnectCodeZh, CONNECT_STEPS,
  TEST_RESULT_ZH,
} from '../../src/core/owner/channel.js';
import { summarizeTest } from '../../src/channels/testflow.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { textWidth } from '../../src/core/owner/components.js';
import { BUDGET } from '../../src/core/owner/tokens.js';

const NOW = new Date('2026-07-18T02:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);

/* ── 24h window state machine (spec M3 §2 — every transition) ────────────── */
describe('M3 · 24h window compliance', () => {
  it('window open / nearing expiry / expired / never-written', () => {
    expect(windowState(hoursAgo(1), NOW)).toBe('open');
    expect(windowState(hoursAgo(23), NOW)).toBe('closing_soon');
    expect(windowState(hoursAgo(25), NOW)).toBe('expired');
    expect(windowState(null, NOW)).toBe('expired');
    expect(windowMsLeft(hoursAgo(23), NOW)).toBe(WINDOW_MS - 23 * 3600 * 1000);
    expect(WINDOW_MS - CLOSING_SOON_MS).toBe(22 * 3600 * 1000);
  });

  it('open window → free reply (可以直接回复)', () => {
    expect(sendPlan('open', 'reply', 'none')).toEqual({ action: 'send_free', ownerNoteZh: '可以直接回复' });
    expect(sendPlan('closing_soon', 'reply', 'none').action).toBe('send_free');
  });

  it('expired + approved template → template send, owner confirms first', () => {
    const p = sendPlan('expired', 'follow_up', 'approved');
    expect(p.action).toBe('send_template');
    expect(p.ownerNoteZh).toContain('需要使用已批准的消息');
    expect(p.ownerNoteZh).toContain('需要你确认后再联系');
  });

  it('expired + no/rejected template → wait for buyer (暂时不能主动发送)', () => {
    for (const t of ['none', 'rejected'] as const) {
      const p = sendPlan('expired', 'follow_up', t);
      expect(p.action).toBe('wait_for_buyer');
      expect(p.ownerNoteZh).toBe('暂时不能主动发送，客户回复后即可继续');
    }
  });

  it('buyer reopens the window: new inbound flips expired → open', () => {
    expect(windowState(hoursAgo(25), NOW)).toBe('expired');
    expect(windowState(hoursAgo(0.01), NOW)).toBe('open');   // buyer just wrote
    expect(sendPlan(windowState(hoursAgo(0.01), NOW), 'reply', 'none').action).toBe('send_free');
  });

  it('a late "reply" is a re-engagement too — intent never bypasses the window', () => {
    expect(sendPlan('expired', 'reply', 'none').action).toBe('wait_for_buyer');
  });
});

/* ── Delivery reconciliation: duplicates, out-of-order, regressions ──────── */
describe('M3 · delivery-state reconciliation', () => {
  it('moves forward: sent → delivered → read', () => {
    expect(applyStatus('sent', 'delivered')).toEqual({ apply: true, next: 'delivered' });
    expect(applyStatus('delivered', 'read')).toEqual({ apply: true, next: 'read' });
  });

  it('duplicates and late statuses are ignored, never regress', () => {
    expect(applyStatus('delivered', 'delivered')).toMatchObject({ apply: false, reason: 'duplicate_or_late' });
    expect(applyStatus('read', 'delivered')).toMatchObject({ apply: false });   // out-of-order webhook
    expect(applyStatus('delivered', 'sent')).toMatchObject({ apply: false });
  });

  it('a "failed" after the handset confirmed receipt is provider noise', () => {
    expect(applyStatus('delivered', 'failed')).toMatchObject({ apply: false, reason: 'failed_after_receipt' });
    expect(applyStatus('read', 'failed')).toMatchObject({ apply: false });
    expect(applyStatus('sent', 'failed')).toEqual({ apply: true, next: 'failed' });
  });

  it('terminal rows never change again', () => {
    expect(applyStatus('canceled', 'delivered')).toMatchObject({ apply: false, reason: 'already_terminal' });
    expect(applyStatus('failed', 'read')).toMatchObject({ apply: false });
  });

  it('bounded exponential backoff: 2s, 4s, 8s … capped', () => {
    expect(retryDelayMs(1)).toBe(2_000);
    expect(retryDelayMs(2)).toBe(4_000);
    expect(retryDelayMs(5)).toBe(32_000);
    expect(retryDelayMs(20)).toBe(RETRY_MAX_MS);
  });

  it('retryable exhausts to dead-letter; 4xx never retries', () => {
    expect(onSendFailure({ retryable: true, error: 'x' }, 1)).toMatchObject({ kind: 'retry' });
    expect(onSendFailure({ retryable: true, error: 'x' }, MAX_SEND_ATTEMPTS)).toEqual({ kind: 'dead_letter' });
    expect(onSendFailure({ retryable: false, error: '24h window' }, 1)).toEqual({ kind: 'fail_permanent' });
  });

  it('restart safety: stuck sending rows get reclaimed', () => {
    expect(shouldReclaim(new Date(NOW.getTime() - SENDING_RECLAIM_MS - 1), NOW)).toBe(true);
    expect(shouldReclaim(new Date(NOW.getTime() - 1_000), NOW)).toBe(false);
    expect(shouldReclaim(null, NOW)).toBe(false);
  });
});

/* ── Send-time suppression gate ──────────────────────────────────────────── */
describe('M3 · send gate (takeover / pause / window, at SEND time)', () => {
  const openPlan = sendPlan('open', 'reply', 'none');
  const closedPlan = sendPlan('expired', 'reply', 'none');

  it('after owner takeover the employee is silent — even for queued messages', () => {
    expect(gateOutbound({ origin: 'employee', assignedTo: 'owner', paused: false, windowPlan: openPlan }))
      .toEqual({ allow: false, reason: 'handed_off' });
    expect(gateOutbound({ origin: 'employee', assignedTo: 'unclaimed', paused: false, windowPlan: openPlan }))
      .toEqual({ allow: false, reason: 'handed_off' });
  });

  it('pause blocks the employee; the owner speaks for himself', () => {
    expect(gateOutbound({ origin: 'employee', assignedTo: null, paused: true, windowPlan: openPlan }))
      .toEqual({ allow: false, reason: 'paused' });
    expect(gateOutbound({ origin: 'owner', assignedTo: 'owner', paused: true, windowPlan: openPlan }))
      .toEqual({ allow: true, viaTemplate: false });
  });

  it('the closed window binds everyone — the provider rejects violations anyway', () => {
    expect(gateOutbound({ origin: 'owner', assignedTo: null, paused: false, windowPlan: closedPlan }))
      .toEqual({ allow: false, reason: 'window_closed' });
  });

  it('takeover cancels queued employee messages, spares owner text and in-flight rows', () => {
    const rows = [
      { id: 'a', seq: 1, status: 'queued' as const, requiresOrder: true, attempts: 0, sentAt: null, origin: 'employee' as const },
      { id: 'b', seq: 2, status: 'sending' as const, requiresOrder: true, attempts: 1, sentAt: null, origin: 'employee' as const },
      { id: 'c', seq: 3, status: 'queued' as const, requiresOrder: true, attempts: 0, sentAt: null, origin: 'owner' as const },
    ];
    expect(cancelableOnTakeover(rows)).toEqual(['a']);
  });
});

/* ── Connection health + owner surfaces ──────────────────────────────────── */
describe('M3 · connection health and 对话渠道 surfaces', () => {
  const base = {
    credentialActive: true, connecting: false, disconnectedByOwner: false,
    lastInboundAt: hoursAgo(2), lastDeliveredAt: hoursAgo(1), lastWebhookAt: hoursAgo(1),
    consecutiveSendFailures: 0, lastError: null,
  };

  it('the five statuses map to the locked Chinese labels', () => {
    expect(Object.values(CHANNEL_STATUS_ZH)).toEqual(['已连接', '正在连接', '需要处理', '已断开', '暂时异常']);
    expect(deriveHealth(base, '小雅').status).toBe('connected');
    expect(deriveHealth({ ...base, connecting: true }, '小雅').status).toBe('connecting');
    expect(deriveHealth({ ...base, credentialActive: false }, '小雅').status).toBe('needs_attention');
    expect(deriveHealth({ ...base, disconnectedByOwner: true }, '小雅').status).toBe('disconnected');
    expect(deriveHealth({ ...base, consecutiveSendFailures: 3 }, '小雅').status).toBe('degraded');
  });

  it('every problem uses the three-part structure; degraded asks nothing of the owner', () => {
    const p = deriveHealth({ ...base, credentialActive: false }, '小雅').problem!;
    expect(p.whatHappened).toContain('重新登录');
    expect(p.beingDone).toContain('小雅');
    expect(p.whatYouDo).toContain('重新连接');
    expect(deriveHealth({ ...base, consecutiveSendFailures: 5 }, '小雅').problem!.whatYouDo).toBeNull();
  });

  it('raw diagnostics stay internal — devDetail never reaches an owner surface', () => {
    const h = deriveHealth({ ...base, credentialActive: false, lastError: 'HTTP 401 invalid api key D360' }, '小雅');
    const card = renderChannelCard({ health: h, displayPhone: '+86 138****1234', lastMessageAt: hoursAgo(2), lastCheckAt: hoursAgo(0.5), now: NOW });
    expect(card).not.toContain('401');
    expect(card).not.toContain('D360');
    expect(h.devDetail).toContain('401');   // support still sees it
  });

  const surfaces: Record<string, string> = {
    cardConnected: renderChannelCard({
      health: deriveHealth(base, '小雅'), displayPhone: '+86 138****1234',
      lastMessageAt: hoursAgo(2), lastCheckAt: hoursAgo(0.5), now: NOW,
    }),
    cardBroken: renderChannelCard({
      health: deriveHealth({ ...base, credentialActive: false }, '小雅'),
      displayPhone: '+86 138****1234', lastMessageAt: hoursAgo(30), lastCheckAt: hoursAgo(0.5), now: NOW,
    }),
    testResults: (Object.keys(TEST_RESULT_ZH) as (keyof typeof TEST_RESULT_ZH)[])
      .map((v) => renderTestResult(v, '小雅')).join('\n'),
    permissions: renderPermissions('小雅'),
    comingSoon: renderComingSoon(),
    wizardCopy: CONNECT_STEPS.map((s) => [s.title, s.prompt, s.help].join('\n')).join('\n'),
    problemBlock: renderOwnerProblem({ whatHappened: 'a', beingDone: 'b', whatYouDo: null }),
    validationErrors: [
      (validatePhoneZh('abc') as { errorZh: string }).errorZh,
      (validateConnectCodeZh('') as { errorZh: string }).errorZh,
      (validateConnectCodeZh('x x') as { errorZh: string }).errorZh,
    ].join('\n'),
  };

  for (const [name, text] of Object.entries(surfaces)) {
    it(`${name}: banned-term scan + phone-width budget`, () => {
      const lower = text.toLowerCase();
      for (const banned of BANNED_OWNER_TERMS) {
        const needle = banned.toLowerCase();
        const hit = /^[a-z ]+$/.test(needle)
          ? new RegExp(`\\b${needle}\\b`).test(lower)
          : lower.includes(needle);
        expect(hit, `"${banned}" found in ${name}`).toBe(false);
      }
      for (const l of text.split('\n')) expect(textWidth(l), l).toBeLessThanOrEqual(BUDGET.lineColumns);
    });
  }

  it('wizard validation accepts what it should', () => {
    expect(validatePhoneZh('+86 138-0000-1234')).toEqual({ ok: true, value: '+8613800001234' });
    expect(validateConnectCodeZh('  ak_live_9f8e7d6c5b4a  ')).toEqual({ ok: true, value: 'ak_live_9f8e7d6c5b4a' });
    expect(validateConnectCodeZh('短码').ok).toBe(false);
  });
});

/* ── 测试连接 summary ────────────────────────────────────────────────────── */
describe('M3 · test-connection verdicts', () => {
  const all = { outboundAccepted: true, statusCallbackSeen: true, inboundSeen: true, orderingOk: true, persisted: true };
  it('four owner-visible outcomes', () => {
    expect(summarizeTest(all).verdict).toBe('all_good');
    expect(summarizeTest({ ...all, outboundAccepted: false }).verdict).toBe('inbound_only');
    expect(summarizeTest({ ...all, statusCallbackSeen: false }).verdict).toBe('inbound_only');
    expect(summarizeTest({ ...all, inboundSeen: false }).verdict).toBe('outbound_only');
    expect(summarizeTest({ ...all, inboundSeen: false, outboundAccepted: false }).verdict).toBe('reconnect');
  });
  it('persistence or ordering failure always means reconnect', () => {
    expect(summarizeTest({ ...all, persisted: false }).verdict).toBe('reconnect');
    expect(summarizeTest({ ...all, orderingOk: false }).verdict).toBe('reconnect');
  });
});
