import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { driveConversationOutbound, type OutboundStore, type OutboundWorkRow } from '../../src/outbound/worker.js';
import { gateOutbound } from '../../src/core/channel/sendGate.js';
import { switchesFrom, effectiveMode, NO_KILL_SWITCHES } from '../../src/core/ops/killSwitch.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { REFUSAL_REASONS } from '../../src/api/web/refusals.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import type { ChannelAdapter, SendResult } from '../../src/channels/contract.js';

/**
 * M34.6 — the kill switch is connected.
 *
 * For six months `core/ops/killSwitch.ts` was correct, tested, and reached by
 * nothing, while INCIDENT-PLAYBOOK.md handed an operator SQL to insert a
 * `global_silence` row. The insert committed. The employee kept sending.
 *
 * So the tests that matter here are NOT "does effectiveMode compute the right
 * mode" — that was always true and proved nothing. They are:
 *   1. a PRODUCTION path reads ops_flags at all, and
 *   2. a set flag actually stops a message leaving the building.
 * Everything else is detail.
 */

const NOW = new Date('2026-08-12T10:00:00Z');
const RECENT = new Date(NOW.getTime() - 60_000);

function adapter(): ChannelAdapter & { sent: string[] } {
  const sent: string[] = [];
  return {
    kind: 'whatsapp' as const, provider: 'test', sent,
    verifyWebhook: () => true,
    parseWebhook: () => [],
    sendText: async (to: string, body: string): Promise<SendResult> => {
      sent.push(`${to}:${body}`);
      return { ok: true, providerMessageId: `wamid.${sent.length}` };
    },
  };
}

/**
 * One queued employee reply, and a store whose ONLY variable is the switch.
 * Fully typed on purpose — the first draft of this file cast the fakes through
 * `unknown` and the casts hid two wrong method names, which the silenced case
 * could never reveal because it never reaches the adapter at all.
 */
function storeWith(silenced: boolean): OutboundStore & { refusals: string[] } {
  const refusals: string[] = [];
  const row: OutboundWorkRow = {
    id: 'o1', seq: 1, status: 'queued', requiresOrder: true, attempts: 0,
    sentAt: null, to: '971500001111', body: 'Our price is $1.20.',
    origin: 'employee', sendingSince: null,
  };
  return {
    refusals,
    load: async () => ({
      rows: [row],
      ctx: {
        assignedTo: null, paused: false, lastInboundAt: RECENT, template: 'none',
        pilotMode: false, recipientAllowed: true, dailyCeilingReached: false,
        activated: true,
        silenced,
      },
    }),
    transition: async () => {},
    recordProviderId: async () => {},
    scheduleRetry: async () => {},
    deadLetter: async () => {},
    recordRefusal: async (_id, _to, reason) => { refusals.push(reason); },
  };
}

describe('M34.6 · a set flag stops a real send', () => {
  it('the employee message does NOT reach the adapter when the switch is on', async () => {
    const a = adapter();
    const store = storeWith(true);
    const effects = await driveConversationOutbound(
      { store, adapter: a, now: () => NOW }, 'conv-1',
    );
    // The whole milestone, in one assertion: nothing left the building.
    expect(a.sent).toEqual([]);
    expect(effects.some((e) => e.kind === 'canceled' && e.reason === 'silenced')).toBe(true);
    expect(store.refusals).toContain('silenced');
  });

  it('the SAME message sends once the switch is off — the switch is the only difference', async () => {
    const a = adapter();
    await driveConversationOutbound(
      { store: storeWith(false), adapter: a, now: () => NOW }, 'conv-1',
    );
    expect(a.sent).toEqual(['971500001111:Our price is $1.20.']);
  });

  it('a reply queued BEFORE the switch was thrown is still stopped', () => {
    // The reason the gate is the enforcement point rather than the turn: by the
    // time an operator reaches for a kill switch, the replies that motivated it
    // are already queued. A switch that only affected future turns would let
    // exactly the messages you are panicking about go out.
    const queuedEarlier = {
      origin: 'employee' as const, assignedTo: null, paused: false,
      windowPlan: { action: 'send_free', ownerNoteZh: '' } as const,
      activated: true, pilotMode: false, recipientAllowed: true,
    };
    expect(gateOutbound({ ...queuedEarlier, silenced: true }))
      .toEqual({ allow: false, reason: 'silenced' });
  });

  it('silencing the employee does not silence the OWNER', () => {
    const g = {
      assignedTo: null, paused: false,
      windowPlan: { action: 'send_free', ownerNoteZh: '' } as const,
      activated: true, pilotMode: false, recipientAllowed: true, silenced: true,
    };
    expect(gateOutbound({ ...g, origin: 'owner' })).toEqual({ allow: true, viaTemplate: false });
    expect(gateOutbound({ ...g, origin: 'employee' })).toEqual({ allow: false, reason: 'silenced' });
  });
});

describe('M34.6 · a production path reads ops_flags', () => {
  it('the send-gate context loader queries the table', async () => {
    // This is the assertion the M34.5 checker exists to generalize: not "the
    // function is right" but "something real calls it". If db/channels.ts stops
    // resolving switches, the gate silently reverts to a switch nobody reads.
    const src = await readFile(new URL('../../src/db/channels.ts', import.meta.url), 'utf8');
    expect(src).toContain('loadKillSwitches');
    expect(src).toContain('silenced: switches.globalSilence');

    const loader = await readFile(new URL('../../src/db/opsFlags.ts', import.meta.url), 'utf8');
    expect(loader).toMatch(/from\s+ops_flags/);
    expect(loader).toContain('cleared_at is null');
    // Platform-wide flags (business_id is null) must be visible to every tenant.
    expect(loader).toContain('business_id is null');
  });

  it('the turn reads them too, for the per-capability switches', async () => {
    const src = await readFile(new URL('../../src/pipeline/turn.ts', import.meta.url), 'utf8');
    expect(src).toContain('tenant.ops.switches()');
    expect(src).toContain('effectiveMode(');
  });

  it('the only writer is ops, never the app: the loader issues no write', async () => {
    const loader = await readFile(new URL('../../src/db/opsFlags.ts', import.meta.url), 'utf8');
    // The SQL itself, not the prose around it — the first version of this test
    // matched the word "insert" in a comment describing the bug being fixed,
    // which is the same class of error as checking the wrong artifact.
    const statements = [...loader.matchAll(/sql<[^>]*>`([^`]*)`/g)].map((m) => m[1]);
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) expect(s).not.toMatch(/\b(insert|update|delete)\b/i);
  });

  it('killSwitch.ts is reachable from a production entrypoint', async () => {
    // The M34.5 rule, asserted for this module specifically: a chain of
    // non-test imports from src/main.ts must arrive here.
    const chain = [
      ['src/main.ts', 'db/channels.js'],
      ['src/db/channels.ts', './opsFlags.js'],
      ['src/db/opsFlags.ts', '../core/ops/killSwitch.js'],
    ] as const;
    for (const [file, imported] of chain) {
      const src = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
      expect(src, `${file} should import ${imported}`).toContain(imported);
    }
  });
});

describe('M34.6 · interpreting the rows', () => {
  it('reads a global_silence row', () => {
    expect(switchesFrom([{ flag: 'global_silence', capability: null }]).globalSilence).toBe(true);
    expect(switchesFrom([]).globalSilence).toBe(false);
  });

  it('collects per-capability switches', () => {
    const k = switchesFrom([
      { flag: 'force_draft', capability: 'quote' },
      { flag: 'silence_capability', capability: 'follow_up' },
    ]);
    expect(k.forceDraft).toEqual(['quote']);
    expect(k.silenceCapability).toEqual(['follow_up']);
  });

  it('IGNORES rows it does not understand rather than guessing', () => {
    // ADR-0007: an older build must run unchanged against a newer row. A flag
    // name it does not know is not a switch it applies by accident.
    const k = switchesFrom([
      { flag: 'some_future_flag', capability: 'quote' },
      { flag: 'force_draft', capability: 'not_a_capability' },
      { flag: 'force_draft', capability: null },
    ]);
    expect(k).toEqual(NO_KILL_SWITCHES);
  });

  it('a switch only ever REDUCES authority — it can never grant one', () => {
    for (const cap of CAPABILITIES) {
      // draft never becomes auto, whatever combination is set
      for (const k of [
        NO_KILL_SWITCHES,
        switchesFrom([{ flag: 'force_draft', capability: cap }]),
        switchesFrom([{ flag: 'silence_capability', capability: cap }]),
        switchesFrom([{ flag: 'global_silence', capability: null }]),
      ]) {
        expect(effectiveMode('draft', cap, k)).not.toBe('auto');
      }
      // and auto is only ever equal or lower
      expect(effectiveMode('auto', cap, NO_KILL_SWITCHES)).toBe('auto');
      expect(effectiveMode('auto', cap, switchesFrom([{ flag: 'force_draft', capability: cap }]))).toBe('draft');
      expect(effectiveMode('auto', cap, switchesFrom([{ flag: 'silence_capability', capability: cap }]))).toBe('silent');
    }
  });

  it('the capability vocabulary is the schema vocabulary', async () => {
    // ops_flags and autonomy_policy both CHECK the capability names. If the
    // list here and the constraint there drift, a flag an operator can insert
    // is a flag this build silently ignores.
    const sql = await readFile(new URL('../../migrations/0014_ops_flags.sql', import.meta.url), 'utf8');
    for (const cap of CAPABILITIES) expect(sql).toContain(`'${cap}'`);
  });
});

describe('M34.6 · the owner is told, in words', () => {
  it('a silenced refusal is a nameable refusal', () => {
    expect(REFUSAL_REASONS).toContain('silenced');
  });

  it('every locale explains it without naming a switch, a flag, or a system', () => {
    for (const locale of LOCALES) {
      for (const part of ['what', 'why', 'do'] as const) {
        const copy = t(locale, `refused.${part}.silenced` as MessageKey, { name: '小雅' });
        expect(copy.length, `${locale}/${part}`).toBeGreaterThan(0);
        expect(copy).not.toMatch(/ops_flags|kill|switch|flag|silenced/i);
      }
    }
  });

  it('it says the owner is not the one who was paused', () => {
    // The one thing this copy must not do is make the owner think he broke it,
    // or that he has to wait for us to reply to his buyer.
    expect(t('en', 'refused.do.silenced' as MessageKey, { name: 'Nomi' })).toMatch(/yourself/i);
    expect(t('zh', 'refused.why.silenced' as MessageKey, { name: '小雅' })).toContain('不是你');
  });
});
