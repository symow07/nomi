import { describe, it, expect } from 'vitest';
import { gateOutbound, cancelableOnTakeover, noticeSpeaks, GATE_REFUSALS, type GateInput } from '../../src/core/channel/sendGate.js';
import { sendPlan } from '../../src/core/channel/window.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * 0135 — THE SEND GATE AND A BUYER WHO SAID STOP.
 *
 *   · Until they write again, nothing reaches them — the assistant, the owner,
 *     a follow-up, a first message — except the one line that answers the stop.
 *   · After they write, a reply inside their 24 hours may go; never a follow-up,
 *     a first message or the reopening template.
 *   · The line that answers a stop reaches them whoever holds the conversation
 *     and through a pause, never through Stop or the ops switch, never as a
 *     template.
 */

const open = sendPlan('open', 'reply', 'none');
const viaTemplate = sendPlan('expired', 'reply', 'approved');
const base: GateInput = {
  silenced: false, stopped: false, pilotMode: false, activated: true,
  origin: 'employee', assignedTo: null, paused: false, windowPlan: open,
};
const quiet = { optOut: { repliedSince: false } } as const;
const spoke = { optOut: { repliedSince: true } } as const;

describe('0135 · before they write again: nothing, except the line', () => {
  for (const origin of ['employee', 'owner', 'outreach'] as const) {
    it(`${origin}: refused as opted_out`, () => {
      expect(gateOutbound({ ...base, ...quiet, origin, assignedTo: origin === 'owner' ? 'owner' : null }))
        .toEqual({ allow: false, reason: 'opted_out' });
    });
  }
  it('a follow-up a schedule released: refused', () => {
    expect(gateOutbound({ ...base, ...quiet, automated: true })).toEqual({ allow: false, reason: 'opted_out' });
  });
  it('the line that answers the stop goes — the assistant holding it, a person, or waiting for one', () => {
    for (const assignedTo of [null, 'unclaimed', 'owner']) {
      expect(gateOutbound({ ...base, ...quiet, assignedTo, notice: 'opt_out' }), String(assignedTo))
        .toEqual({ allow: true, viaTemplate: false });
    }
    expect(gateOutbound({ ...base, ...quiet, paused: true, notice: 'opt_out' })).toEqual({ allow: true, viaTemplate: false });
  });
  it('…never through Stop or the ops switch, and never as the reopening template', () => {
    expect(gateOutbound({ ...base, ...quiet, notice: 'opt_out', stopped: true })).toEqual({ allow: false, reason: 'stopped' });
    expect(gateOutbound({ ...base, ...quiet, notice: 'opt_out', silenced: true })).toEqual({ allow: false, reason: 'silenced' });
    expect(gateOutbound({ ...base, ...quiet, notice: 'opt_out', windowPlan: viaTemplate })).toEqual({ allow: false, reason: 'window_closed' });
  });
  it('the hand-off sentence is not the line: a stop refuses it', () => {
    expect(gateOutbound({ ...base, ...quiet, notice: 'handoff', assignedTo: 'unclaimed' })).toEqual({ allow: false, reason: 'opted_out' });
  });
});

describe('0135 · after they write: replies inside the window, nothing first', () => {
  it('a reply goes — the assistant\'s or the owner\'s', () => {
    expect(gateOutbound({ ...base, ...spoke })).toEqual({ allow: true, viaTemplate: false });
    expect(gateOutbound({ ...base, ...spoke, origin: 'owner', assignedTo: 'owner' })).toEqual({ allow: true, viaTemplate: false });
  });
  it('a follow-up or a first message: still refused', () => {
    expect(gateOutbound({ ...base, ...spoke, automated: true })).toEqual({ allow: false, reason: 'opted_out' });
    expect(gateOutbound({ ...base, ...spoke, origin: 'outreach' })).toEqual({ allow: false, reason: 'opted_out' });
  });
  it('the reopening template: still refused, for the owner too', () => {
    expect(gateOutbound({ ...base, ...spoke, windowPlan: viaTemplate })).toEqual({ allow: false, reason: 'opted_out' });
    expect(gateOutbound({ ...base, ...spoke, origin: 'owner', assignedTo: 'owner', windowPlan: viaTemplate }))
      .toEqual({ allow: false, reason: 'opted_out' });
  });
});

describe('0135 · no stop: nothing changes', () => {
  it('every ordinary message decides exactly as before', () => {
    expect(gateOutbound(base)).toEqual({ allow: true, viaTemplate: false });
    expect(gateOutbound({ ...base, assignedTo: 'unclaimed' })).toEqual({ allow: false, reason: 'handed_off' });
    expect(gateOutbound({ ...base, windowPlan: viaTemplate })).toEqual({ allow: true, viaTemplate: true });
  });
  it('a hand-off row is not yet a notice that passes a person (fix 1 of the batch)', () => {
    expect(noticeSpeaks('handoff', 'WAITING_HUMAN')).toBe(false);
    expect(noticeSpeaks('opt_out', 'OWNER_CONTROLLED')).toBe(true);
    expect(noticeSpeaks(null, 'AI')).toBe(false);
  });
  it('takeover spares the line, and cancels the rest of what the assistant queued', () => {
    const row = (id: string, notice: 'opt_out' | null) =>
      ({ id, seq: 1, status: 'queued' as const, requiresOrder: false, attempts: 0, sentAt: null, origin: 'employee' as const, notice });
    expect(cancelableOnTakeover([row('a', null), row('b', 'opt_out')], 'WAITING_HUMAN')).toEqual(['a']);
  });
});

describe('0135 · the owner is told, in every locale', () => {
  it('opted_out is the gate\'s, with what, why and what to do', () => {
    expect(GATE_REFUSALS).toContain('opted_out');
    for (const locale of LOCALES) {
      for (const part of ['what', 'why', 'do'] as const) {
        expect(t(locale, `refused.${part}.opted_out`), `${locale}/${part}`).not.toMatch(/\{|\}/);
      }
      expect(t(locale, 'inbox.blocked.opted_out').length, locale).toBeGreaterThan(10);
      expect(t(locale, 'takeover.reason.opted_out').length, locale).toBeGreaterThan(5);
    }
  });
});
