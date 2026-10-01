import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { allowanceUsed, type Allowance } from '../../src/db/allowance.js';
import { renderOwnerAlert, goesByMail, OPERATOR_ALERT_KINDS } from '../../src/pipeline/notify.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
// @ts-expect-error — the operator tool, plain JS on purpose (tools/ is not type-checked).
import { setSpendCeiling } from '../../tools/lib/operator.mjs';

/**
 * KS5 (0113, decision 37) — the spend breaker: past the installation's daily
 * ceiling, beta workspaces wait as if their own allowance were used; the
 * pilots run; the operator hears once a day. Over Postgres:
 * tests/integration/ks5-breaker.test.ts.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const open: Allowance = { budget: null, usage: { llmCalls: 0, tokens: 0 }, photoReads: 0, verdict: { kind: 'ok' }, pctUsed: null };

describe('KS5 · the hold', () => {
  it('the breaker holds as the workspace\'s own cap does: one reader, one hold', () => {
    expect(allowanceUsed(open)).toBe(false);
    expect(allowanceUsed({ ...open, breaker: true })).toBe(true);
    expect(src('src/db/allowance.ts')).toContain('select spend_breaker_held() as h');
  });
  it('only the beta: a workspace the operator made, or opened by hand, is never held', () => {
    const m = src('migrations/0113_spend_breaker.sql');
    expect(m).toContain('select p.signed_up_at is not null');
    expect(m).toContain("and not (p.auto_earned_at is not null and coalesce(p.auto_earned_by, 'operator') <> 'ramp')");
  });
  it('Today says so, with when it ends — as for its own cap', () => {
    expect(src('src/api/web/operations.ts')).toContain('if (a.breaker) return { pctUsed: 100, stops: true, reached: true, renewsAt: allowanceRenewsAt(now) };');
  });
});

describe('KS5 · the operator hears', () => {
  for (const l of LOCALES) {
    it(`${l} · how much, against what — and that the beta waits while the pilots run`, () => {
      const w = renderOwnerAlert(l, 'spend_breaker', null, { spend: { tokens: 20500000, calls: 1200, maxTokens: 20000000, maxCalls: 20000 } });
      expect(w).not.toContain('{');
      expect(t(l, 'notify.spend_breaker.subject')).not.toBe('notify.spend_breaker.subject');
    });
  }
  it('an operator alert, by e-mail always; swept every five minutes, claimed once a day', () => {
    expect(OPERATOR_ALERT_KINDS).toContain('spend_breaker');
    expect(goesByMail('spend_breaker')).toBe(true);
    expect(src('src/main.ts')).toContain('const breaker = await spendBreakerAlert(db, PILOT_BUSINESS_ID);');
  });
  it('the operator\'s tool takes whole positive numbers, and a name', async () => {
    const calls: unknown[][] = [];
    const c = { query: async (...a: unknown[]) => { calls.push(a); return { rows: [] }; } };
    expect(await setSpendCeiling(c, { tokens: 0, by: 'me' })).toBe('invalid');
    expect(await setSpendCeiling(c, { tokens: 1.5, by: 'me' })).toBe('invalid');
    expect(await setSpendCeiling(c, { tokens: 1000, by: '' })).toBe('invalid');
    expect(await setSpendCeiling(c, { by: 'me' })).toBe('invalid');
    expect(calls).toHaveLength(0);
    expect(await setSpendCeiling(c, { tokens: 40000000, by: 'operator' })).toBe('set');
  });
});
