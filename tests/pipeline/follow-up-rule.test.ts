import { describe, expect, it } from 'vitest';
import { DEFAULT_FOLLOW_UP_RULE, readFollowUpRule } from '../../src/core/conversation/followUps.js';

describe('The owner’s follow-up rule', () => {
  it('starts off with a two-day delay and no invented wording', () => {
    expect(DEFAULT_FOLLOW_UP_RULE).toEqual({ enabled: false, delayDays: 2, wording: '' });
  });
  it.each(['0', '8', '2.5', '-1', '02', '2e0', '', 'NaN'])('refuses the non-whole or out-of-range delay %s', (delayDays) => {
    expect(readFollowUpRule({ enabled: '1', delayDays, wording: 'My words' })).toEqual({ ok: false, reason: 'delay' });
  });
  it('preserves every character and accepts all seven whole-day choices', () => {
    const wording = '  My exact words.\n🙂  ';
    for (let delayDays = 1; delayDays <= 7; delayDays++) {
      expect(readFollowUpRule({ enabled: '1', delayDays, wording })).toEqual({ ok: true, rule: { enabled: true, delayDays, wording } });
    }
  });
  it('requires words when on, permits empty when off and bounds Unicode characters', () => {
    expect(readFollowUpRule({ enabled: true, delayDays: 2, wording: ' \n ' })).toEqual({ ok: false, reason: 'wording' });
    expect(readFollowUpRule({ delayDays: 2, wording: '' })).toEqual({ ok: true, rule: DEFAULT_FOLLOW_UP_RULE });
    expect(readFollowUpRule({ enabled: true, delayDays: 2, wording: '🙂'.repeat(500) }).ok).toBe(true);
    expect(readFollowUpRule({ enabled: true, delayDays: 2, wording: '🙂'.repeat(501) })).toEqual({ ok: false, reason: 'wording' });
  });
});
