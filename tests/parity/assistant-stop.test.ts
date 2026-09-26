import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gateOutbound, GATE_REFUSALS, type GateInput } from '../../src/core/channel/sendGate.js';
import { isProblemSignal, SIGNAL_SAMPLES, toTriggerReason, PROBLEM_SIGNAL_KINDS } from '../../src/core/scoring/signals.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * 0070 — the owner's Stop, on every channel: what the send gate does with it,
 * and where the worker asks it. The behaviour over Postgres is
 * tests/integration/assistant-stop.test.ts.
 */

const openPlan = { action: 'send_free', ownerNoteZh: '' } as const;
const base: GateInput = {
  origin: 'employee', assignedTo: null, paused: false, windowPlan: openPlan,
  activated: true, pilotMode: false, recipientAllowed: true, silenced: false, stopped: true,
};
const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

describe('the gate: Stop binds the machine, never the owner', () => {
  it('refuses a message the assistant wrote', () => {
    expect(gateOutbound(base)).toEqual({ allow: false, reason: 'stopped' });
  });

  it('refuses a follow-up a schedule released', () => {
    expect(gateOutbound({ ...base, origin: 'outreach', automated: true }))
      .toEqual({ allow: false, reason: 'stopped' });
  });

  it('lets the owner’s own reply through', () => {
    expect(gateOutbound({ ...base, origin: 'owner' })).toEqual({ allow: true, viaTemplate: false });
  });

  it('answers exactly as before when nothing is stopped', () => {
    expect(gateOutbound({ ...base, stopped: false })).toEqual({ allow: true, viaTemplate: false });
  });

  it('names the ops switch first when both are set — the reason the owner did not choose', () => {
    expect(gateOutbound({ ...base, silenced: true })).toEqual({ allow: false, reason: 'silenced' });
  });

  it('is a refusal the owner reads in every language: what happened, why, what to do', () => {
    expect(GATE_REFUSALS).toContain('stopped');
    for (const l of LOCALES) {
      for (const part of ['what', 'why', 'do'] as const) {
        const key = `refused.${part}.stopped` as MessageKey;
        expect(t(l, key, { name: 'X' }), `${l} ${key}`).not.toBe(key);
      }
    }
  });
});

describe('the handoff a stopped assistant makes', () => {
  it('is a problem signal, so the conversation needs a person — with its own reason', () => {
    expect(PROBLEM_SIGNAL_KINDS).toContain('assistant_stopped');
    expect(isProblemSignal(SIGNAL_SAMPLES.assistant_stopped)).toBe(true);
    expect(toTriggerReason(SIGNAL_SAMPLES.assistant_stopped)).toBe('assistant_stopped');
    for (const l of LOCALES) {
      expect(t(l, 'takeover.reason.assistant_stopped' as MessageKey), l).not.toBe('takeover.reason.assistant_stopped');
    }
  });
});

describe('where Stop is asked', () => {
  it('the worker asks FIRST: before an owner’s "answer this", and before any turn can run', () => {
    const w = src('src/worker/main.ts');
    const body = w.slice(w.indexOf('async function onInbound('));
    // 0071 — one question for both holds: the owner's Stop and the ops switch.
    const asked = body.indexOf('assistantHold(');
    expect(asked).toBeGreaterThan(0);
    expect(asked).toBeLessThan(body.indexOf('if (job.data.answerOnly) {'));
    expect(asked).toBeLessThan(body.indexOf('runTurn('));
    expect(asked).toBeLessThan(body.indexOf('flushPendingText('));
  });

  it('the store resolves it inside the send’s own transaction, and the worker hands it to the gate', () => {
    expect(src('src/db/channels.ts')).toMatch(/const stopped = await assistantStopped\(tx, businessId\);/);
    expect(src('src/outbound/worker.ts')).toContain('stopped: ctx.stopped,');
  });

  it('the one hand-back and the one approval path both ask it, inside their own transaction', () => {
    const takeover = src('src/conversations/takeover.ts');
    expect(takeover).toContain('const hold = await assistantHold(tx, input.businessId);');
    expect(takeover).toContain("outcome: hold === 'silenced' ? 'assistant_silenced' : 'assistant_stopped'");
    const approve = src('src/pipeline/approve.ts');
    expect(approve).toContain("cmd.kind === 'approve' || cmd.kind === 'edit' ? await assistantHold(tx, input.businessId) : null");
    expect(approve).toContain("outcome: hold === 'silenced' ? 'assistant_silenced' : 'assistant_stopped'");
  });

  it('0071 — the ops switch hands the buyer to a person under its own reason, in every language', () => {
    expect(PROBLEM_SIGNAL_KINDS).toContain('ops_silenced');
    expect(isProblemSignal(SIGNAL_SAMPLES.ops_silenced)).toBe(true);
    expect(toTriggerReason(SIGNAL_SAMPLES.ops_silenced)).toBe('ops_silenced');
    for (const l of LOCALES) {
      for (const k of ['takeover.reason.ops_silenced', 'takeover.flash.assistant_silenced', 'inbox.flash.assistant_silenced',
        'today.silenced.title', 'today.silenced.body', 'assistant.silenced.note'] as const) {
        expect(t(l, k as MessageKey, { name: 'X' }), `${l} ${k}`).not.toBe(k);
      }
    }
    expect(src('src/worker/main.ts')).toContain("{ kind: hold === 'silenced' ? 'ops_silenced' : 'assistant_stopped' }");
  });
});
