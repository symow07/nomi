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
// M20.1 — these cases are about the ALLOWLIST, so the channel is live; the
// activation refusal has its own tests below.
const base = { origin: 'employee' as const, assignedTo: null, paused: false, windowPlan: openPlan, activated: true, silenced: false };

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

/**
 * M20.1 — activation is a property of the CHANNEL, not of who is speaking.
 * Connected means the credentials work. Activated means the owner decided.
 * Until then nothing reaches a buyer, whoever wrote it.
 */
describe('M20.1 · nothing goes out before the owner turns messaging on', () => {
  const live = { ...base, recipientAllowed: true };

  it('refuses an employee message on a channel that was never activated', () => {
    expect(gateOutbound({ ...live, activated: false }))
      .toEqual({ allow: false, reason: 'not_activated' });
  });

  it('refuses the OWNER’s own reply too — no exceptions', () => {
    // The owner takeover path is exempt from the daily ceiling and from the
    // pause/handoff gates, deliberately. It is NOT exempt from this one.
    expect(gateOutbound({ ...live, origin: 'owner', activated: false }))
      .toEqual({ allow: false, reason: 'not_activated' });
  });

  it('FAIL-CLOSED: a caller that never resolves activation blocks, it does not send', () => {
    const { activated: _omitted, ...withoutActivation } = live;
    expect(gateOutbound(withoutActivation)).toEqual({ allow: false, reason: 'not_activated' });
  });

  it('activation is checked FIRST — before the pilot is live nothing else matters', () => {
    // A message that would also fail the allowlist, the ceiling and the window
    // still reports the reason the owner can act on.
    expect(gateOutbound({ ...base, activated: false, recipientAllowed: false, pilotMode: true,
      dailyCeilingReached: true, windowPlan: closedPlan, assignedTo: 'owner', paused: true,
    })).toEqual({ allow: false, reason: 'not_activated' });
  });

  it('once activated, the other gates decide as before', () => {
    expect(gateOutbound({ ...live, activated: true })).toEqual({ allow: true, viaTemplate: false });
    expect(gateOutbound({ ...live, activated: true, pilotMode: true, recipientAllowed: false }))
      .toEqual({ allow: false, reason: 'not_allowlisted' });
    expect(gateOutbound({ ...live, activated: true, origin: 'employee', assignedTo: 'owner' }))
      .toEqual({ allow: false, reason: 'handed_off' });
  });

  it('being connected is not being activated — the states are independent', () => {
    // A reconnect restores the connection; it must not make the system live.
    // The gate only ever reads `activated`, so a connected-but-not-activated
    // channel is silent by construction.
    const connectedNotActivated = { ...live, pilotMode: true, recipientAllowed: true, activated: false };
    expect(gateOutbound(connectedNotActivated).allow).toBe(false);
  });
});
