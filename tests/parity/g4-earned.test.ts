import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderEmployee, type EmployeeProfile } from '../../src/api/web/employee.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, assistantName } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * G4 (0102) — sending alone is earned in a workspace that signed itself up:
 * the level page says replies wait for now and offers only stepping down;
 * both grant routes refuse anything above "waits". The turn's half is
 * tests/pipeline/not-earned.test.ts; over Postgres, tests/integration/g4-earned.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const profile = (over: Partial<EmployeeProfile>): EmployeeProfile => ({
  knows: 3, assistantNamed: true, spotChecks: [], hireDate: new Date('2026-10-01T00:00:00Z'), stage: 'probation',
  canDo: [], needConfirm: [], growth: [], promoted: false, conditions: [],
  capabilities: [{ capability: 'greet', mode: 'draft', promotable: false }, { capability: 'qualify', mode: 'draft', promotable: false }],
  ...over,
});

describe('G4 · the level page', () => {
  for (const locale of LOCALES) {
    it(`${locale} · not earned: replies wait for now, and no level above "waits" is offered`, () => {
      const html = withoutIsolates(renderEmployee(profile({ earned: false }), locale, null));
      expect(html).toContain(esc(t(locale, 'autonomy.notEarned.title')));
      expect(html).toContain(esc(withoutIsolates(t(locale, 'autonomy.notEarned.body', { name: assistantName(locale) }))));
      expect(html).not.toMatch(/name="level" value="(talks|sells)"/);
    });
  }
  it('a level chosen before G4 can be taken back from the same page', () => {
    const html = renderEmployee(profile({ earned: false, capabilities: [{ capability: 'greet', mode: 'auto', promotable: false }, { capability: 'qualify', mode: 'auto', promotable: false }] }), 'en', null);
    expect(html).toContain('<input type="hidden" name="level" value="waits" />');
    expect(html).toContain(esc(t('en', 'autonomy.notEarned.stepDown')));
  });
  it('earned (and every workspace the operator made): the levels as before', () => {
    for (const earned of [true, undefined]) {
      const html = renderEmployee(profile(earned === undefined ? {} : { earned }), 'en', null);
      expect(html).toMatch(/name="level" value="sells"/);
      expect(html).not.toContain(esc(t('en', 'autonomy.notEarned.title')));
    }
  });
});

describe('G4 · the rule, where it is decided', () => {
  it('both grant routes ask it, after the native-review gate, and "waits" never', () => {
    const app = src('src/api/web/app.ts');
    // R2 — rung-aware since 0106: a level, or a capability, past the earned rung.
    expect(app).toContain("if (verb === 'promote' && need <= 2 && need > await rungFor(s.businessId)) {");
    expect(app).toContain('if (rungOfLevel(level) > await rungFor(s.businessId)) {');
  });
  it('commitTurn asks it before it would send alone, and names it first', () => {
    const turn = src('src/pipeline/turn.ts');
    expect(turn).toContain('const earned = !speaksAlone || (await tenant.autonomy.earnedRung()) >= rungOf(capability);');
    // R3 — and the product's first quote, beside it.
    expect(turn).toContain('const mayDisclose = !speaksAlone || (earned && vetted && released && named && sentence !== null);');
    expect(turn).toContain("reason: !earned ? 'not_earned' :");
  });
  it('the one function answers for the caller only, from the workspace that pays, and no outside a tenant', () => {
    const m = src('migrations/0102_sending_alone_earned.sql');
    expect(m).toContain('join businesses p on p.id = coalesce(me.practice_of, me.id)');
    expect(m).toContain('where me.id = current_business_id()), false);');
  });
});
