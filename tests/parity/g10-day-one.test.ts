import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { precheckOwnerSend, type ChannelFacts } from '../../src/core/channel/lifecycle.js';
import { sendPlan, windowState } from '../../src/core/channel/window.js';
import { unlistedDuringPilot } from '../../src/core/conversation/inbound.js';
import { PROBLEM_SIGNAL_KINDS, computeScores } from '../../src/core/scoring/signals.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, ASSISTANT_FALLBACK, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * G10 — day-one WhatsApp. The production walk is
 * tests/integration/day-one.test.ts; these are the rules it exercises.
 */

const src = (rel: string) => readFile(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const NOW = new Date('2026-09-11T08:00:00Z');
const live: ChannelFacts = {
  hasChannel: true, status: 'connected', credentialActive: true, providerConfigured: true,
  activatedAt: new Date('2026-09-01T00:00:00Z'), disconnectedAt: null,
};
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);
const plan = (lastInboundAt: Date | null, template: 'none' | 'approved' = 'none') =>
  sendPlan(windowState(lastInboundAt, NOW), 'reply', template).action;

describe('G10b · she is told his window is shut, when she presses send', () => {
  it('open window: ok. Shut, with no approved template: window_closed', () => {
    expect(precheckOwnerSend(live, { recipientAllowed: true, pilotMode: true, windowAction: plan(hoursAgo(2)) })).toBe('ok');
    expect(precheckOwnerSend(live, { recipientAllowed: true, pilotMode: true, windowAction: plan(hoursAgo(25)) })).toBe('window_closed');
    // A buyer who never wrote has no window at all.
    expect(precheckOwnerSend(live, { recipientAllowed: true, pilotMode: true, windowAction: plan(null) })).toBe('window_closed');
  });

  it('an approved template carries it past the window — the gate would send it', () => {
    expect(precheckOwnerSend(live, { recipientAllowed: true, pilotMode: true, windowAction: plan(hoursAgo(25), 'approved') })).toBe('ok');
  });

  it('the gate’s own order: not live, then not on her list, then the window', () => {
    const notLive = { ...live, activatedAt: null };
    expect(precheckOwnerSend(notLive, { recipientAllowed: false, pilotMode: true, windowAction: plan(null) })).toBe('not_activated');
    expect(precheckOwnerSend(live, { recipientAllowed: false, pilotMode: true, windowAction: plan(null) })).toBe('not_allowlisted');
  });

  it('unknown window stays quiet — the gate decides', () => {
    expect(precheckOwnerSend(live, { recipientAllowed: true, pilotMode: true })).toBe('ok');
  });

  it('the send path reads the BUYER’s window, and the webhook writes it', async () => {
    const channels = await src('src/db/channels.ts');
    expect(channels).toMatch(/cc\.last_inbound_at,\s*\n\s*ch\.pilot_mode/);
    const main = await src('src/main.ts');
    expect(main).toMatch(/update client_channels\s+set last_inbound_at = greatest/);
  });

  it('both owner send routes ask — the reply AND the approval', async () => {
    const app = await src('src/api/web/app.ts');
    const act = app.slice(app.indexOf("app.post('/app/inbox/:conversationId/act'"));
    expect(act.slice(0, act.indexOf('applyOwnerCommand('))).toContain('ownerSendVerdict(');
    const reply = app.slice(app.indexOf("app.post('/app/inbox/:conversationId/reply'"));
    expect(reply.slice(0, reply.indexOf('ownerReply('))).toContain('ownerSendVerdict(');
  });
});

describe('G10c · a number not on her list, while she is live in pilot', () => {
  it('is not answered only when all three hold', () => {
    for (const activated of [true, false])
      for (const pilotMode of [true, false])
        for (const allowlisted of [true, false])
          expect(unlistedDuringPilot({ activated, pilotMode, allowlisted }), JSON.stringify({ activated, pilotMode, allowlisted }))
            .toBe(activated && pilotMode && !allowlisted);
  });

  it('it is a reason she was needed, and it scores nothing against the buyer', () => {
    expect(PROBLEM_SIGNAL_KINDS).toContain('unlisted_number');
    expect(computeScores([{ kind: 'unlisted_number' }])).toEqual({ problem: 0, lead: 0 });
  });

  it('the owner is told what happened, why, and what to do — in every locale', () => {
    for (const l of LOCALES) {
      for (const k of ['unlisted.title', 'unlisted.what', 'unlisted.why', 'unlisted.do',
        'takeover.reason.unlisted_number', 'received.photo', 'received.voice', 'inbox.blocked.window_closed'] as MessageKey[]) {
        const said = t(l, k, { name: ASSISTANT_FALLBACK[l] });
        expect(said, `${l} ${k}`).not.toBe(k);
        expect(said, `${l} ${k}`).not.toContain('{');
      }
    }
  });
});

describe('G10a · the timeline holds what was said', () => {
  it('a typed line is recorded as it arrives, and a reply when the provider took it', async () => {
    // Proven end to end by tests/integration/day-one.test.ts; this only names
    // the two writers, so deleting one fails here before it fails in a pilot.
    const worker = await src('src/worker/main.ts');
    expect(worker).toContain('await recordTypedMessage(tx, conversationId.value, job.data.messageId, job.data.text);');
    const channels = await src('src/db/channels.ts');
    expect(channels).toContain("if (to === 'sent') {");
    expect(channels).toContain("${'out:' + id}, 'outbound'");
  });
});
