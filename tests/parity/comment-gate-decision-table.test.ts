import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gateOutbound, type GateInput } from '../../src/core/channel/sendGate.js';
import { gateOutbound as mainGate, type GateInput as MainInput } from './fixtures/sendGate.main-8e570755.js';
import { sendPlan } from '../../src/core/channel/window.js';

/**
 * 5.4 — the supervisor's ruling 1(d): every existing kind's send decision is unchanged by the comment branch. A
 * finite enumeration that RUNS inside `npm run check`: the gate as it is now against main's gate at 8e570755, copied
 * byte for byte (only its four import paths moved, which this test proves), over K dimensions of the gate's inputs.
 * For each point, main's decision is compared with the current gate's for every existing kind (and none), each also
 * given a comment fact it must ignore. Zero differences. The counts and the decisions' hash are printed for the log.
 */
const MAIN_SHA = 'c6e94f871de8c430073a6d6608dd1beb9126a788f9bb06f48b87c79035ef2d11';
const EXISTING_KINDS = [undefined, 'text', 'image', 'document', 'quote_card'] as const;

const dims = {
  origin: ['employee', 'owner', 'outreach'] as const,
  approved: [undefined, true] as const,
  automated: [undefined, true] as const,
  assignedTo: [null, 'person-1'] as const,
  hold: ['none', 'paused', 'silenced', 'stopped', 'frozen'] as const,
  window: ['send_free', 'send_template', 'wait_for_buyer'] as const,
  pilot: ['none', 'listed', 'unlisted'] as const,
  activated: [undefined, false, true] as const,
  ceiling: [undefined, true] as const,
  notice: [null, 'handoff', 'opt_out'] as const,
  optOut: [null, false, true] as const,
  extra: ['none', 'garbled', 'unreviewed', 'tiktok_limit'] as const,
};
const PLANS = { send_free: sendPlan('open', 'reply', 'none'), send_template: sendPlan('expired', 'reply', 'approved'), wait_for_buyer: sendPlan('expired', 'reply', 'none') };

function* points(): Generator<MainInput> {
  for (const origin of dims.origin) for (const approved of dims.approved) for (const automated of dims.automated)
  for (const assignedTo of dims.assignedTo) for (const hold of dims.hold) for (const window of dims.window)
  for (const pilot of dims.pilot) for (const activated of dims.activated) for (const ceiling of dims.ceiling)
  for (const notice of dims.notice) for (const optOut of dims.optOut) for (const extra of dims.extra) {
    yield {
      origin, assignedTo, windowPlan: PLANS[window],
      paused: hold === 'paused', silenced: hold === 'silenced', stopped: hold === 'stopped', frozen: hold === 'frozen',
      ...(approved !== undefined ? { approved } : {}), ...(automated !== undefined ? { automated } : {}),
      ...(pilot !== 'none' ? { pilotMode: true, recipientAllowed: pilot === 'listed' } : {}),
      ...(activated !== undefined ? { activated } : {}), ...(ceiling !== undefined ? { dailyCeilingReached: ceiling } : {}),
      notice, ...(optOut !== null ? { optOut: { repliedSince: optOut } } : { optOut: null }),
      ...(extra === 'garbled' ? { garbled: true } : {}), ...(extra === 'unreviewed' ? { buyerLanguage: 'unreviewed' as const } : {}),
      ...(extra === 'tiktok_limit' ? { channelLimitReached: true } : {}),
    };
  }
}
const IGNORED_FACT = { channel: 'instagram', enabled: true, asking: true, accountBound: true, claim: 'ready' as const,
  createdAt: new Date('2026-11-10T00:00:00Z'), now: new Date('2026-11-10T01:00:00Z') };

describe('5.4 · decision-table parity: every existing kind decides exactly as on main', () => {
  it('the fixture is main\'s gate byte for byte, apart from its four import paths', () => {
    const here = readFileSync(new URL('./fixtures/sendGate.main-8e570755.ts', import.meta.url), 'utf8')
      .replace("'../../../src/core/conversation/ownership.js'", "'../conversation/ownership.js'")
      .replace("'../../../src/core/outreach/gate.js'", "'../outreach/gate.js'")
      .replace("'../../../src/core/channel/window.js'", "'./window.js'")
      .replace("'../../../src/outbound/sequencer.js'", "'../../outbound/sequencer.js'");
    expect(createHash('sha256').update(here).digest('hex')).toBe(MAIN_SHA);
  });

  it('zero differences over the whole enumeration', () => {
    const K = Object.keys(dims).length;
    let n = 0; let compared = 0; const diffs: string[] = [];
    const main = createHash('sha256'); const now = createHash('sha256');
    const reasons = new Map<string, number>();
    for (const p of points()) {
      n++;
      const expected = JSON.stringify(mainGate(p));
      main.update(expected + '\n');
      reasons.set(expected, (reasons.get(expected) ?? 0) + 1);
      for (const kind of EXISTING_KINDS) for (const withFact of [false, true]) {
        const input = { ...p, ...(kind !== undefined ? { messageKind: kind } : {}), ...(withFact ? { commentPrivateReply: IGNORED_FACT } : {}) } as GateInput;
        const got = JSON.stringify(gateOutbound(input));
        if (kind === undefined && !withFact) now.update(got + '\n');
        compared++;
        if (got !== expected && diffs.length < 5) diffs.push(`${JSON.stringify(input)} main=${expected} now=${got}`);
      }
    }
    const mainHash = main.digest('hex'); const nowHash = now.digest('hex');
    console.log(`[5.4 decision table] K=${K} points=${n} comparisons=${compared} decisions=${reasons.size} differences=${diffs.length} main=${mainHash} now=${nowHash}`);
    expect(diffs).toEqual([]);
    expect(nowHash).toBe(mainHash);
    expect(n).toBe(3 * 2 * 2 * 2 * 5 * 3 * 3 * 3 * 2 * 3 * 3 * 4);
    expect(reasons.size).toBeGreaterThan(10);
  });

  it('negative control: the same enumeration does see the new kind decide differently', () => {
    let differs = 0;
    for (const p of points()) {
      const input = { ...p, messageKind: 'comment_private_reply', commentPrivateReply: IGNORED_FACT } as GateInput;
      if (JSON.stringify(gateOutbound(input)) !== JSON.stringify(mainGate(p))) differs++;
    }
    expect(differs).toBeGreaterThan(0);
  });
});
