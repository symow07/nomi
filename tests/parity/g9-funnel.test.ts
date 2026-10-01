import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { exitMeasures, type FunnelRow } from '../../src/pipeline/funnel.js';
import { renderOwnerAlert } from '../../src/pipeline/notify.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * G9 — the cohort's funnel, measured against decision 33's exit criteria.
 * Over Postgres (the milestones from real rows): tests/integration/g9-funnel.test.ts.
 */

const at = (iso: string) => new Date(iso);
const base: FunnelRow = {
  businessId: 'x', name: 'Shop', kind: 'retail', signedUpAt: at('2026-10-01T08:00:00Z'),
  firstImportAt: null, firstImportConfirmedAt: null, checksSeen: 0, checksTotal: 8, checklistCompleteAt: null,
  namedAt: null, connectedAt: null, firstCustomerAt: null, firstReplyAt: null,
  draftsDecided: 0, draftsExpired: 0, medianDecisionSeconds: null, operatorBeforeFirstReply: false,
};
const row = (over: Partial<FunnelRow>): FunnelRow => ({ ...base, ...over });
const NOW = at('2026-10-20T08:00:00Z');

describe('G9 · decision 33\'s measures', () => {
  it('a first reply within 7 days of being able to connect — counted once the 7 days are over, or it replied', () => {
    const m = exitMeasures([
      row({ firstReplyAt: at('2026-10-03T08:00:00Z') }),                                          // day 2: pass
      row({ firstReplyAt: at('2026-10-12T08:00:00Z') }),                                          // day 11: counted, fails
      row({}),                                                                                    // never: counted, fails
      row({ signedUpAt: at('2026-10-18T08:00:00Z') }),                                            // 2 days in: not counted yet
    ], NOW, null);
    expect(m.firstReplyIn7Days).toEqual({ pass: 1, of: 3 });
  });
  it('"able to connect" is the day Meta approved Nomi when that came after the sign-up', () => {
    const m = exitMeasures([row({ firstReplyAt: at('2026-10-14T08:00:00Z') })], NOW, at('2026-10-10T00:00:00Z'));
    expect(m.firstReplyIn7Days).toEqual({ pass: 1, of: 1 });
  });
  it('the medians: sign-up to a complete checklist, and the owner\'s decision on a draft', () => {
    const m = exitMeasures([
      row({ checklistCompleteAt: at('2026-10-01T08:40:00Z'), medianDecisionSeconds: 600 }),
      row({ checklistCompleteAt: at('2026-10-01T09:20:00Z'), medianDecisionSeconds: 3600 }),
      row({ medianDecisionSeconds: 1200 }),
    ], NOW, null);
    expect(m.signupToChecklistMinutes).toBe(60);   // 40 and 80
    expect(m.decisionMinutes).toBe(20);            // 10, 20, 60
  });
  it('expired drafts of all drafts decided or expired; a first reply with no operator action before it', () => {
    const m = exitMeasures([
      row({ draftsDecided: 8, draftsExpired: 2, firstReplyAt: at('2026-10-02T08:00:00Z') }),
      row({ draftsDecided: 10, firstReplyAt: at('2026-10-02T08:00:00Z'), operatorBeforeFirstReply: true }),
      row({}),
    ], NOW, null);
    expect(m.expired).toEqual({ expired: 2, of: 20 });
    expect(m.firstReplyWithoutOperator).toEqual({ pass: 1, of: 2 });
  });
  it('nothing yet is nothing, never a zero that reads as a result', () => {
    const m = exitMeasures([], NOW, null);
    expect(m.signupToChecklistMinutes).toBeNull();
    expect(m.decisionMinutes).toBeNull();
  });
});

describe('G9 · the daily list counts the forms', () => {
  for (const l of LOCALES) {
    it(`${l} · how many sign-up forms were sent, and how many came back with their code`, () => {
      const text = renderOwnerAlert(l, 'signup_digest', null, { signups: [], forms: { forms: 5, codesUsed: 3 } });
      expect(text.split('\n')[1]).toBe(t(l, 'notify.signup_digest.forms', { forms: 5, used: 3 }));
    });
  }
  it('and where the cohort stands: how many, how many finished Practice, how many replied', () => {
    const text = renderOwnerAlert('en', 'signup_digest', null, { signups: [], cohort: { workspaces: 12, practised: 7, replied: 4 } });
    expect(text.split('\n')[1]).toBe(t('en', 'notify.signup_digest.cohort', { workspaces: 12, practised: 7, replied: 4 }));
    expect(readFileSync(new URL('../../src/pipeline/signupDigest.ts', import.meta.url), 'utf8')).toContain('const funnel = await loadFunnel(db);');
  });
  it('the funnel is read from rows already kept — one definer, no second record', () => {
    const m = readFileSync(new URL('../../migrations/0104_funnel.sql', import.meta.url), 'utf8');
    expect(m).toContain('create or replace function funnel_workspaces()');
    expect(m).not.toMatch(/create table/i);
    expect(m).toContain("where b.signed_up_at is not null and b.practice_of is null");
  });
});
