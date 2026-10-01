import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_PRICES_PER_MTOK, estimateCost, summarizePaths, type MeasuredTurn } from '../../src/core/conversation/answerPath.js';

/**
 * T7 — COMPLETE METERING (the one-month build order, 2026-09-29): the parts a
 * database is not needed to prove. What reaches the ledger, through the real
 * worker and routes, is tests/integration/metering.test.ts.
 *
 *   · one clock: every statement that reads or writes `usage_ledger` uses the
 *     UTC day — it was written on the database's date and read on Shanghai's,
 *     so for eight hours a day every reader saw an empty day;
 *   · the production model has a price, so a cost can be estimated at all;
 *   · the per-turn figure is the summary divided honestly.
 */

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
});

/** Each place the ledger is named, with the statement around it. */
const ledgerStatements = (): { file: string; around: string }[] => files(SRC).flatMap((file) => {
  const text = readFileSync(file, 'utf8');
  const out: { file: string; around: string }[] = [];
  for (let i = text.indexOf('usage_ledger'); i !== -1; i = text.indexOf('usage_ledger', i + 1)) {
    out.push({ file: file.slice(SRC.length), around: text.slice(Math.max(0, i - 500), i + 500) });
  }
  return out;
});

const OLD_CLOCKS = /Asia\/Shanghai|current_date/;
const UTC_DAY = /\(now\(\) at time zone 'UTC'\)::date|LEDGER_DAY/;

describe('T7 · the ledger has one clock, UTC', () => {
  it('every statement on usage_ledger uses the UTC day, and none uses another', () => {
    const found = ledgerStatements().filter((s) => /\b(select|insert|update|join)\b/i.test(s.around));
    expect(found.map((s) => s.file).sort()).toEqual(expect.arrayContaining(['db/usage.ts']));
    for (const s of found) {
      expect(s.around, s.file).toMatch(UTC_DAY);
      expect(s.around, s.file).not.toMatch(OLD_CLOCKS);
    }
    // G3 — the readers (the hold, the send gate, Today, My business, the
    // alerts) ask allowance_today() and claim_allowance_alerts() (0101): the
    // same UTC day, in SQL.
    const sql0101 = readFileSync(fileURLToPath(new URL('../../migrations/0101_allowance.sql', import.meta.url)), 'utf8')
      .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    expect(sql0101).toContain("and u.day = (now() at time zone 'UTC')::date");
    expect(sql0101).toContain("v_day date := (now() at time zone 'UTC')::date;");
    expect(sql0101).not.toMatch(OLD_CLOCKS);
  });

  it('the check can fail: the statement it replaced is caught', () => {
    const before = `left join usage_ledger u on u.business_id = b.business_id and u.day = (now() at time zone 'Asia/Shanghai')::date`;
    expect(before).toMatch(OLD_CLOCKS);
    expect(before).not.toMatch(UTC_DAY);
  });

  it('nothing calls record_usage() any more — it wrote inside the turn, and only for a turn', () => {
    for (const f of files(SRC)) expect(readFileSync(f, 'utf8'), f).not.toMatch(/record_usage\s*\(/);
  });
});

describe('T7 · what a turn costs', () => {
  it('the production model has its list price, dated', () => {
    expect(MODEL_PRICES_PER_MTOK['deepseek-flash']).toEqual({
      input: { amount: 0.3, currency: 'USD' }, output: { amount: 1.2, currency: 'USD' }, asOf: '2026-09-29',
    });
    expect(estimateCost('deepseek-flash', 1_000_000, 1_000_000)).toEqual({ amount: 1.5, currency: 'USD' });
  });

  const turn = (o: Partial<MeasuredTurn>): MeasuredTurn => ({
    path: 'model', modelId: 'deepseek-flash', llmCalls: 2, inputTokens: 1000, outputTokens: 400, analyserAvoidable: false, ...o,
  });

  it('per turn is every measured turn\'s tokens and cost, divided by every measured turn — a silent one included', () => {
    const s = summarizePaths([turn({}), turn({ inputTokens: 1400, outputTokens: 200 }), turn({ path: 'silent', llmCalls: 0, inputTokens: 0, outputTokens: 0 })]);
    const one = s.perTurn!;
    expect(one.inputTokens).toBe(800);
    expect(one.outputTokens).toBe(200);
    expect(one.cost!.currency).toBe('USD');
    expect(one.cost!.amount).toBeCloseTo((2400 * 0.3 + 600 * 1.2) / 1_000_000 / 3, 12);
  });

  it('nothing measured is no figure; a model with no price is no cost, never a smaller one', () => {
    expect(summarizePaths([]).perTurn).toBeNull();
    const unpriced = summarizePaths([turn({}), turn({ modelId: 'a-model-with-no-price' })]).perTurn!;
    expect(unpriced.inputTokens).toBe(1000);
    expect(unpriced.cost).toBeNull();
  });
});
