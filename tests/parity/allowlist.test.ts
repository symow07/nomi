import { describe, it, expect } from 'vitest';
import { normalizePhone, samePhone, displayPhone } from '../../src/core/channel/phone.js';
import { gateOutbound } from '../../src/core/channel/sendGate.js';
import { DAILY_OUTBOUND_CEILING } from '../../src/core/channel/limits.js';
import type { SendPlan } from '../../src/core/channel/window.js';

/**
 * M18.2 — the pilot allowlist rule, at the level where it is enforced: the ONE
 * send gate. These are the tests that must never be weakened, because they are
 * what stands between a bug and a real buyer's phone.
 */

const openPlan: SendPlan = { action: 'send_free', ownerNoteZh: '' };
const closedPlan: SendPlan = { action: 'wait_for_buyer', ownerNoteZh: '' };
const base = { origin: 'employee' as const, assignedTo: null, paused: false, windowPlan: openPlan };

describe('M18.2 · phone normalization (the comparison key)', () => {
  it('an owner-typed number and a WhatsApp wa_id normalize to the same thing', () => {
    // this equality IS the feature — if it breaks, the allowlist silently fails
    for (const written of ['+971 50 000 1234', '+971-50-000-1234', '00971500001234', '971500001234', ' +971 (50) 000.1234 ']) {
      expect(normalizePhone(written), written).toBe('971500001234');
    }
    expect(samePhone('+971 50 000 1234', '971500001234')).toBe(true);
  });

  it('rejects anything that is not a phone number — never falls open', () => {
    for (const bad of [null, undefined, '', '   ', 'not-a-number', '+971-50-ABCD', '12345', '1'.repeat(16), 'https://evil', '+']) {
      expect(normalizePhone(bad as string), String(bad)).toBeNull();
    }
    // and a rejected number is never "equal" to anything
    expect(samePhone('garbage', 'garbage')).toBe(false);
  });

  it('display form is for showing only', () => {
    expect(displayPhone('971500001234')).toBe('+971500001234');
  });
});

describe('M18.2 · the send gate enforces the allowlist', () => {
  it('an allowlisted recipient sends', () => {
    expect(gateOutbound({ ...base, pilotMode: true, recipientAllowed: true }))
      .toEqual({ allow: true, viaTemplate: false });
  });

  it('a NON-allowlisted recipient is refused', () => {
    expect(gateOutbound({ ...base, pilotMode: true, recipientAllowed: false }))
      .toEqual({ allow: false, reason: 'not_allowlisted' });
  });

  it('FAIL-CLOSED: a caller that forgets the pilot fields blocks, it does not send', () => {
    // the most important test here — silence-by-omission must be safe
    expect(gateOutbound(base)).toEqual({ allow: false, reason: 'not_allowlisted' });
    expect(gateOutbound({ ...base, pilotMode: true }))
      .toEqual({ allow: false, reason: 'not_allowlisted' });
  });

  it('the allowlist binds the OWNER too — during a pilot the question is which buyer, not who is speaking', () => {
    expect(gateOutbound({ ...base, origin: 'owner', pilotMode: true, recipientAllowed: false }))
      .toEqual({ allow: false, reason: 'not_allowlisted' });
    expect(gateOutbound({ ...base, origin: 'owner', pilotMode: true, recipientAllowed: true }))
      .toEqual({ allow: true, viaTemplate: false });
  });

  it('with pilot mode off the allowlist does not apply', () => {
    expect(gateOutbound({ ...base, pilotMode: false, recipientAllowed: false }))
      .toEqual({ allow: true, viaTemplate: false });
  });

  it('the allowlist does not replace the existing guards — they still fire first', () => {
    // takeover still wins, and is reported as takeover, not as an allowlist miss
    expect(gateOutbound({ ...base, assignedTo: 'owner', pilotMode: true, recipientAllowed: true }))
      .toEqual({ allow: false, reason: 'handed_off' });
    expect(gateOutbound({ ...base, paused: true, pilotMode: true, recipientAllowed: true }))
      .toEqual({ allow: false, reason: 'paused' });
    // and the window still binds an allowlisted recipient
    expect(gateOutbound({ ...base, windowPlan: closedPlan, pilotMode: true, recipientAllowed: true }))
      .toEqual({ allow: false, reason: 'window_closed' });
  });
});

describe('M18.5 · daily outbound ceiling (blocks, never warns)', () => {
  const allowed = { ...base, pilotMode: true, recipientAllowed: true };

  it('blocks the employee once the ceiling is reached', () => {
    expect(gateOutbound({ ...allowed, dailyCeilingReached: true }))
      .toEqual({ allow: false, reason: 'daily_ceiling' });
  });

  it('never blocks the OWNER — a human typing is not the runaway this guards', () => {
    expect(gateOutbound({ ...allowed, origin: 'owner', dailyCeilingReached: true }))
      .toEqual({ allow: true, viaTemplate: false });
  });

  it('is a plain fixed number, not a score', () => {
    expect(Number.isInteger(DAILY_OUTBOUND_CEILING)).toBe(true);
    expect(DAILY_OUTBOUND_CEILING).toBeGreaterThan(0);
  });

  it('the allowlist is checked BEFORE the ceiling — the more specific refusal wins', () => {
    expect(gateOutbound({ ...base, pilotMode: true, recipientAllowed: false, dailyCeilingReached: true }))
      .toEqual({ allow: false, reason: 'not_allowlisted' });
  });
});
