import { describe, it, expect } from 'vitest';
import { withWorkspace } from '../../src/api/web/say.js';

// D — the switch exists only for a workspace whose outreach area is on; these
// tests are about the switch, so they render inside one.
const AREA_ON = { name: null, several: false, outreach: true, setup: null } as const;
const reach = (...a: Parameters<typeof renderReach>) => withWorkspace(AREA_ON, () => renderReach(...a));
import { readFile } from 'node:fs/promises';
import {
  OUTREACH_REFUSALS, gateOutreach, type OutreachInput,
} from '../../src/core/outreach/gate.js';
import { GATE_REFUSALS, gateOutbound } from '../../src/core/channel/sendGate.js';
import { REQUIREMENTS, OUTREACH_CHANNELS, CHANNEL_REGISTRY, type Requirement } from '../../src/core/channel/registry.js';
import { CONTACT_CHANNELS, type Consent, type Suppression } from '../../src/core/outreach/consent.js';
import { renderReach } from '../../src/api/web/channels.js';
import { canBeEnabled } from '../../src/db/outreach.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M42 — where reach meets the invariant.
 *
 * The product can now describe a message no buyer asked for. This is the one
 * thing that decides whether it leaves the building, and what it must never
 * become is a third opinion: it asks M39 whether the channel can carry a first
 * message and M38 whether this person may be written to, and it knows only what
 * neither could — her decision, and today's quota.
 */

const AT = new Date('2026-08-20T02:00:00Z');
const consent = (): Consent => ({ evidence: 'owner_attestation', obtainedAt: AT, recordedBy: 'Mei' });
const suppression = (): Suppression => ({ reason: 'unsubscribed', at: AT });
const ALL = new Set<Requirement>(REQUIREMENTS);

const input = (over: Partial<OutreachInput> = {}): OutreachInput => ({
  channel: 'email', availableHere: true, enabled: true, satisfied: ALL,
  consent: consent(), suppression: null, ceilingReached: false, ...over,
});

describe('M42 · the order is physics, then her decision, then this person', () => {
  it('a clean case goes', () => {
    expect(gateOutreach(input()).ok).toBe(true);
  });

  it('WHAT THE CHANNEL CANNOT CARRY IS REFUSED FIRST — before anything she can change', () => {
    // Reporting "turn writing-first on" for Instagram would advise an action
    // that cannot help, whatever else is true.
    for (const channel of ['instagram', 'messenger'] as const) {
      const r = gateOutreach(input({ channel, enabled: true, consent: consent() }));
      expect(r.ok === false && r.error, channel).toBe('channel_cannot_initiate');
    }
  });

  it('and it stays refused however much else is in order', () => {
    for (const enabled of [true, false]) {
      for (const c of [null, consent()]) {
        const r = gateOutreach(input({ channel: 'instagram', enabled, consent: c }));
        expect(r.ok === false && r.error).toBe('channel_cannot_initiate');
      }
    }
  });

  it('A CHANNEL THIS PRODUCT CANNOT SEND ON IS REFUSED THE SAME WAY', () => {
    /**
     * What the channel allows and what we can do are different facts, and the
     * connections page shows both — "e-mail lets you write first" is true and
     * worth her knowing. But a message still cannot go, and before this the
     * list told her the reason was a decision she had not made, about a switch
     * that does not exist for e-mail yet.
     */
    const r = gateOutreach(input({ availableHere: false, enabled: false }));
    expect(r.ok === false && r.error).toBe('channel_cannot_initiate');
  });

  it('a channel whose conditions are unmet is refused the same way', () => {
    // WhatsApp without an approved template cannot carry a first message
    // either. One refusal, pointing at the page that holds the whole story,
    // rather than a second vocabulary restating M39's requirement list.
    const r = gateOutreach(input({ channel: 'whatsapp', satisfied: new Set() }));
    expect(r.ok === false && r.error).toBe('channel_cannot_initiate');
    expect(gateOutreach(input({ channel: 'whatsapp', satisfied: ALL })).ok).toBe(true);
  });

  it('HER DECISION COMES NEXT — before anything about a particular buyer', () => {
    const r = gateOutreach(input({ enabled: false, consent: null, suppression: suppression() }));
    expect(r.ok === false && r.error).toBe('outreach_not_enabled');
  });

  it('then this person: suppressed outranks consent, in M38’s order', () => {
    expect(gateOutreach(input({ suppression: suppression() })).ok === false
      && gateOutreach(input({ suppression: suppression() })).ok).toBe(false);
    const r = gateOutreach(input({ consent: consent(), suppression: suppression() }));
    expect(r.ok === false && r.error).toBe('suppressed');
    const n = gateOutreach(input({ consent: null }));
    expect(n.ok === false && n.error).toBe('no_consent');
  });

  it('and the ceiling last — the only refusal here that is false tomorrow', () => {
    const r = gateOutreach(input({ ceilingReached: true }));
    expect(r.ok === false && r.error).toBe('outreach_ceiling');
  });

  it('IT DOES NOT RE-DECIDE CONSENT OR THE CHANNEL — it asks', async () => {
    // A gate that re-derived either would be a second answer to a question
    // another milestone exists to answer once.
    const src = await readFile(new URL('../../src/core/outreach/gate.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    expect(code).toContain('mayContact(');
    expect(code).toContain('mayInitiate(');
    // no local re-implementation of either rule
    expect(code).not.toMatch(/CHANNEL_REGISTRY|coldInitiate|\.evidence|obtainedAt/);
  });
});

describe('M42 · the send path', () => {
  const base = {
    origin: 'employee' as const, assignedTo: null, paused: false,
    windowPlan: { action: 'send_free' as const, ownerNoteZh: '可以直接回复' },
    activated: true, silenced: false, pilotMode: false, recipientAllowed: true,
  };

  it('an outreach message answers the outreach gate AND everything else', () => {
    expect(gateOutbound({ ...base, outreach: input() }).allow).toBe(true);
    const r = gateOutbound({ ...base, outreach: input({ consent: null }) });
    expect(r.allow === false && r.reason).toBe('no_consent');
  });

  it('it does not REPLACE the rest — a handed-off thread still refuses', () => {
    const r = gateOutbound({ ...base, assignedTo: 'owner', outreach: input() });
    expect(r.allow === false && r.reason).toBe('handed_off');
  });

  it('activation is still first: before the pilot is live, nothing else matters', () => {
    const r = gateOutbound({ ...base, activated: false, outreach: input({ consent: null }) });
    expect(r.allow === false && r.reason).toBe('not_activated');
  });

  it('AN OUTREACH ROW THAT FORGOT TO DECLARE ITSELF IS STILL REFUSED', () => {
    /**
     * The safety of the optional field. A message to someone who never wrote
     * has no inbound behind it, so the window plan is `wait_for_buyer` and the
     * window check refuses it — for the wrong reason, which is a legible bug
     * rather than a silent send to a buyer who never consented.
     */
    const r = gateOutbound({
      ...base, windowPlan: { action: 'wait_for_buyer', ownerNoteZh: '需要你确认后再联系' },
    });
    expect(r.allow).toBe(false);
    expect(r.allow === false && r.reason).toBe('window_closed');
  });

  it('the gate’s vocabulary SPREADS the outreach list rather than restating it', async () => {
    for (const r of OUTREACH_REFUSALS) expect(GATE_REFUSALS, r).toContain(r);
    const src = await readFile(new URL('../../src/core/channel/sendGate.ts', import.meta.url), 'utf8');
    expect(src).toContain('...OUTREACH_REFUSALS');
  });

  it('every outreach refusal reaches the owner in three locales', () => {
    // Coverage is enforced over REFUSAL_REASONS in refusals.test.ts; this
    // asserts the sentences are hers, not a code word leaking through.
    for (const locale of LOCALES) {
      for (const r of OUTREACH_REFUSALS) {
        for (const part of ['what', 'why', 'do'] as const) {
          const s = t(locale, `refused.${part}.${r}` as MessageKey, { name: 'Lily' });
          expect(s, `${locale}/${part}/${r}`).not.toContain(r);
          expect(s.length, `${locale}/${part}/${r}`).toBeGreaterThan(4);
        }
      }
    }
  });
});

describe('M42 · her decision, on the screen where it is made', () => {
  const on = (ch: 'email' | 'whatsapp') => new Map([[ch, true] as const]);

  it('OFFERED ONLY WHERE THE DECISION CAN TAKE EFFECT', () => {
    /**
     * Two conditions, and the second one is a screenshot's doing: the e-mail
     * card read "Not set up here yet — she cannot send on this one" directly
     * above a switch she had just turned on.
     *
     * A switch that changes nothing is worse than no switch — Instagram is
     * where an owner would most expect one to work, and e-mail is where she
     * would most expect one to matter.
     */
    const html = reach('en', ALL, new Map());
    for (const c of OUTREACH_CHANNELS) {
      const card = html.slice(html.indexOf(t('en', `reach.channel.${c}` as MessageKey)));
      const mine = card.slice(0, card.indexOf('class="card reach"') + 1 || undefined);
      const cap = CHANNEL_REGISTRY[c];
      expect(mine.includes('/app/channels/outreach'), c)
        .toBe(cap.coldInitiate !== 'never' && cap.availableHere);
      expect(canBeEnabled(c), `canBeEnabled(${c})`).toBe(mine.includes('/app/channels/outreach'));
    }
  });

  it('THE WARNING IS ON THE SCREEN, not behind the click', () => {
    const html = reach('en', ALL, new Map());
    expect(html).toContain(t('en', 'outreach.warn.whatsapp'));
    // It names the consequence and does not hedge it: the number, and for good.
    const warn = t('en', 'outreach.warn.whatsapp').toLowerCase();
    expect(warn).toContain('number');
    expect(warn).toContain('for good');
    expect(warn).not.toMatch(/\bmay\b|\bcould possibly\b|\bunlikely\b/);
  });

  it('and it is reversible — on says turn off', () => {
    const html = reach('en', ALL, on('whatsapp'));
    expect(html).toContain(t('en', 'outreach.turnOff'));
    expect(html).toContain(t('en', 'outreach.on'));
    expect(html).toContain('name="enabled" value="false"');
  });

  it('the migration allows exactly the channels that can initiate', async () => {
    const sql = await readFile(new URL('../../migrations/0037_outreach.sql', import.meta.url), 'utf8');
    const initiable = OUTREACH_CHANNELS.filter((c) => CHANNEL_REGISTRY[c].coldInitiate !== 'never');
    expect(sql).toContain(`channel in (${initiable.map((c) => `'${c}'`).join(',')})`);
    for (const c of OUTREACH_CHANNELS) {
      if (CHANNEL_REGISTRY[c].coldInitiate !== 'never') continue;
      expect(sql, `${c} must not be storable`).not.toContain(`'${c}'`);
    }
  });

  it('a contact channel is always a channel the product knows how to reach', () => {
    for (const c of CONTACT_CHANNELS) expect(OUTREACH_CHANNELS, c).toContain(c);
  });

  it('the decision is insert-only — turning it off records, it does not erase', async () => {
    const sql = await readFile(new URL('../../migrations/0037_outreach.sql', import.meta.url), 'utf8');
    expect(sql).toContain('revoke update on outreach_settings from nomi_app');
    expect(sql).not.toMatch(/unique[\s\S]{0,80}outreach_settings/i);
  });
});
