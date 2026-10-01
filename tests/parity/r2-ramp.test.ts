import { describe, it, expect } from 'vitest';
import { talksProgress, sellsProgress, rungOf, rungOfLevel, type RampDecision } from '../../src/core/trust/ramp.js';
import { renderEmployee, type EmployeeProfile } from '../../src/api/web/employee.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * R2 — the ramp's rules (decisions 9, 12, 23) and what the owner reads of
 * them. Over Postgres: tests/integration/r2-ramp.test.ts.
 */

const dec = (over: Partial<RampDecision> = {}): RampDecision => ({
  asWritten: true, figureChanged: false, priced: false, byOwner: true, customer: 'c1', day: '2026-10-01', flagged: false, ...over,
});
/** n decisions over `customers` customers and `days` days, newest first. */
const spread = (n: number, customers: number, days: number, over: Partial<RampDecision> = {}) =>
  Array.from({ length: n }, (_, i) => dec({ customer: `c${i % customers}`, day: `2026-10-${String(1 + (i % days)).padStart(2, '0')}`, ...over }));
const ok = { checklistComplete: true, named: true };

describe('R2 · rung 1, talks', () => {
  it('17 of the last 20 as written, 5 customers, 3 days, nothing flagged, the checklist and the name', () => {
    const twenty = spread(20, 5, 3).map((d, i) => (i < 3 ? { ...d, asWritten: false } : d));
    expect(talksProgress(twenty, ok)).toMatchObject({ done: 17, of: 20, need: 17, customers: 5, days: 3, ready: true });
  });
  it('each condition holds it back on its own', () => {
    expect(talksProgress(spread(20, 5, 3).map((d, i) => (i < 4 ? { ...d, asWritten: false } : d)), ok).ready).toBe(false);
    expect(talksProgress(spread(20, 4, 3), ok).ready).toBe(false);
    expect(talksProgress(spread(20, 5, 2), ok).ready).toBe(false);
    expect(talksProgress(spread(19, 5, 3), ok).ready).toBe(false);
    expect(talksProgress(spread(20, 5, 3).map((d, i) => (i === 7 ? { ...d, flagged: true } : d)), ok)).toMatchObject({ clean: false, ready: false });
    expect(talksProgress(spread(20, 5, 3), { checklistComplete: false, named: true }).ready).toBe(false);
    expect(talksProgress(spread(20, 5, 3), { checklistComplete: true, named: false }).ready).toBe(false);
  });
  it('only the last 20 count: an owner who edited heavily while fixing the catalogue still earns it', () => {
    const recent = spread(20, 5, 3);
    const older = spread(30, 5, 3, { asWritten: false });
    expect(talksProgress([...recent, ...older], ok).ready).toBe(true);
  });
  it('staff decisions count toward talks (decision 12)', () => {
    expect(talksProgress(spread(20, 5, 3, { byOwner: false }), ok).ready).toBe(true);
  });
  it('N comes from the workspace\'s own setting, the bar 85% of it', () => {
    expect(talksProgress(spread(10, 5, 3), { ...ok, n: 10 })).toMatchObject({ of: 10, need: 9, ready: true });
  });
});

describe('R2 · rung 2, sells', () => {
  const priced = (n: number, over: Partial<RampDecision> = {}) => spread(n, 10, 7, { priced: true, ...over });
  it('the last 30 priced drafts the owner decided, none with a figure changed, 10 customers, 7 days — after rung 1', () => {
    expect(sellsProgress(priced(30), true, true)).toMatchObject({ done: 30, of: 30, customers: 10, days: 7, ready: true });
    expect(sellsProgress(priced(30), false, true)!.ready).toBe(false);
  });
  it('one changed figure starts the run again; a wording edit does not', () => {
    const run = priced(30).map((d, i) => (i === 12 ? { ...d, figureChanged: true } : i === 3 ? { ...d, asWritten: false } : d));
    expect(sellsProgress(run, true, true)).toMatchObject({ done: 12, ready: false });
  });
  it('staff decisions never count toward prices (rule 11)', () => {
    expect(sellsProgress(priced(30, { byOwner: false }), true, true)).toMatchObject({ done: 0, ready: false });
  });
  it('where prices go to the owner, or nothing has a price, rung 1 is the ceiling', () => {
    expect(sellsProgress(priced(30), true, false)).toBeNull();
  });
});

describe('R2 · what each rung unlocks', () => {
  it('talks: greet, qualify, recommend, follow_up; sells: quote, negotiate; confirm_order never', () => {
    expect(['greet', 'qualify', 'recommend', 'follow_up'].map((c) => rungOf(c as never))).toEqual([1, 1, 1, 1]);
    expect(['quote', 'negotiate'].map((c) => rungOf(c as never))).toEqual([2, 2]);
    expect(rungOf('confirm_order')).toBe(3);
    expect([rungOfLevel('waits'), rungOfLevel('talks'), rungOfLevel('sells')]).toEqual([0, 1, 2]);
  });
});

describe('R2 · the level page', () => {
  const base: EmployeeProfile = {
    knows: 3, assistantNamed: true, spotChecks: [], hireDate: new Date('2026-10-01T00:00:00Z'), stage: 'probation',
    canDo: [], needConfirm: [], growth: [], promoted: false, conditions: [],
    capabilities: [{ capability: 'greet', mode: 'draft', promotable: false }],
  };
  const ramp = (rung: 0 | 1 | 2, over: object = {}) => ({
    gated: true, rung, checklistComplete: true, named: true, talksEarnedAt: rung >= 1 ? new Date('2026-10-05T00:00:00Z') : null, sellsEarnedAt: null,
    talks: { done: 14, of: 20, need: 17, customers: 4, customersNeed: 5, days: 2, daysNeed: 3, clean: true, ready: false },
    sells: { done: 12, of: 30, customers: 6, customersNeed: 10, days: 5, daysNeed: 7, clean: true, ready: false },
    ...over,
  });
  for (const l of LOCALES) {
    it(`${l} · "14 of 20" where the hints were, and only the levels the rung allows`, () => {
      const html = withoutIsolates(renderEmployee({ ...base, earned: false, ramp: ramp(0) }, l, null));
      expect(html).toContain(esc(withoutIsolates(t(l, 'ramp.talks', { done: 14, of: 20, need: 17, customers: 4, customersNeed: 5, days: 2, daysNeed: 3 }))));
      expect(html).toContain(esc(withoutIsolates(t(l, 'ramp.sells', { done: 12, of: 30, customers: 6, customersNeed: 10, days: 5, daysNeed: 7 }))));
      const one = renderEmployee({ ...base, earned: true, ramp: ramp(1) }, l, null);
      expect(one).toMatch(/name="level" value="talks"/);
      expect(one).not.toMatch(/name="level" value="sells"/);
    });
  }
  it('no prices: the second rung says prices stay with the owner', () => {
    const html = renderEmployee({ ...base, earned: true, ramp: ramp(1, { sells: null }) }, 'en', null);
    expect(html).toContain(esc(t('en', 'ramp.sells.none')));
  });
});
