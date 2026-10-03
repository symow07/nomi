import { describe, it, expect } from 'vitest';
import {
  REFUSAL_ALERT_AFTER_MS, refusalAlertAt, refusalAlertDue, parseDeepSeekBalance, payingLine, balanceFloor,
  spendPerDay, balanceVerdict, mostUrgent, balanceEndpointFor, DEFAULT_BALANCE_FLOOR,
  type BalancePoint, type BalanceReading,
} from '../../src/core/ops/providerWatch.js';

/**
 * BILLING RESILIENCE (2026-10-04) — when the operator hears, step by step,
 * with the clock and the balance as fakes. The database's half (each step
 * claimed once) is tests/integration/provider-billing.test.ts.
 */

const H = 3_600_000;
const T0 = new Date('2026-10-04T08:00:00Z');
const at = (h: number) => new Date(T0.getTime() + h * H);

describe('the refusal’s escalation: at once, after an hour, after six, then daily', () => {
  it('the steps, as stated', () => {
    expect(REFUSAL_ALERT_AFTER_MS).toEqual([0, H, 6 * H, 24 * H]);
    expect([0, 1, 2, 3, 4, 5, 9].map(refusalAlertAt)).toEqual([0, H, 6 * H, 24 * H, 48 * H, 72 * H, 168 * H]);
  });

  const table: readonly [number, number, number | null][] = [
    // [hours since the refusal began, alerts already sent, the step due]
    [0, 0, 0],            // the first refusal: at once
    [0.5, 1, null],       // told once; the hour has not passed
    [1, 1, 1],            // an hour: the second
    [5.9, 2, null],
    [6, 2, 2],            // six hours: the third
    [23, 3, null],
    [24, 3, 3],           // a day: the fourth
    [47, 4, null],
    [48, 4, 4],           // then once a day
    [72, 5, 5],
    [200, 2, 2],          // a missed sweep catches up one step at a time, never a burst
  ];
  for (const [hours, sent, due] of table) {
    it(`${hours} h in, ${sent} sent → ${due === null ? 'nothing' : `step ${due}`}`, () => {
      expect(refusalAlertDue(T0, sent, at(hours))).toBe(due);
    });
  }
});

describe('the balance, as DeepSeek states it', () => {
  it('the documented example (api-docs.deepseek.com/api/get-user-balance)', () => {
    const r = parseDeepSeekBalance({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }],
    });
    expect(r).toEqual({ available: true, lines: [{ currency: 'CNY', total: 110, granted: 10, toppedUp: 100 }] });
  });

  it('production’s shape on 2026-10-04 — two currencies, one funded: the funded one pays', () => {
    const r = parseDeepSeekBalance({
      is_available: true,
      balance_infos: [
        { currency: 'CNY', total_balance: '7.21', granted_balance: '0.00', topped_up_balance: '7.21' },
        { currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' },
      ],
    })!;
    expect(payingLine(r)?.currency).toBe('CNY');
    expect(payingLine({ available: false, lines: [] })).toBeNull();
  });

  it('anything else is not a balance', () => {
    expect(parseDeepSeekBalance(null)).toBeNull();
    expect(parseDeepSeekBalance({ error: { message: 'Authentication Fails' } })).toBeNull();
    expect(parseDeepSeekBalance({ is_available: 'yes', balance_infos: [] })).toBeNull();
    expect(parseDeepSeekBalance({ is_available: true, balance_infos: [{ currency: 'cny', total_balance: 'x' }] }))
      .toEqual({ available: true, lines: [] });
  });

  it('only DeepSeek’s host has a balance to read; Anthropic has none', () => {
    expect(balanceEndpointFor('https://api.deepseek.com/anthropic')).toBe('https://api.deepseek.com/user/balance');
    expect(balanceEndpointFor(null)).toBeNull();
    expect(balanceEndpointFor('https://api.example.com')).toBeNull();
    expect(balanceEndpointFor('not a url')).toBeNull();
  });
});

describe('the floor', () => {
  it('defaults: USD 1.50, CNY 10; nothing for a currency the operator has not named', () => {
    expect(DEFAULT_BALANCE_FLOOR).toEqual({ USD: 1.5, CNY: 10 });
    expect(balanceFloor('CNY', undefined)).toBe(10);
    expect(balanceFloor('USD', '')).toBe(1.5);
    expect(balanceFloor('EUR', undefined)).toBeNull();
  });
  it('LLM_BALANCE_FLOOR sets it, in the account’s currency; a nonsense value is ignored', () => {
    expect(balanceFloor('CNY', '25')).toBe(25);
    expect(balanceFloor('EUR', '3.5')).toBe(3.5);
    expect(balanceFloor('CNY', 'lots')).toBe(10);
    expect(balanceFloor('CNY', '-1')).toBe(10);
  });
});

describe('the recent spend, from the balance’s own trend', () => {
  const pts = (xs: readonly [number, number][], currency = 'CNY'): BalancePoint[] =>
    xs.map(([h, total]) => ({ at: at(h), currency, total }));

  it('needs twelve hours of readings', () => {
    expect(spendPerDay(pts([[0, 10], [6, 9]]), 'CNY', at(6))).toBeNull();
    expect(spendPerDay(pts([[0, 10]]), 'CNY', at(0))).toBeNull();
  });
  it('every fall summed over the span: 2 in 12 hours is 4 a day', () => {
    expect(spendPerDay(pts([[0, 10], [6, 9], [12, 8]]), 'CNY', at(12))).toBeCloseTo(4);
  });
  it('a top-up is not negative spend', () => {
    // 10 → 9 (−1), top-up to 50, 50 → 49 (−1): 2 spent in 24 h.
    expect(spendPerDay(pts([[0, 10], [6, 9], [7, 50], [24, 49]]), 'CNY', at(24))).toBeCloseTo(2);
  });
  it('another currency’s readings and readings older than seven days are left out', () => {
    expect(spendPerDay([...pts([[0, 10], [12, 8]]), ...pts([[1, 100], [11, 1]], 'USD')], 'CNY', at(12))).toBeCloseTo(4);
    expect(spendPerDay(pts([[-200, 100], [0, 10], [12, 8]]), 'CNY', at(12))).toBeCloseTo(4);
  });
  it('nothing spent is no estimate', () => {
    expect(spendPerDay(pts([[0, 10], [12, 10]]), 'CNY', at(12))).toBeNull();
  });
});

describe('the steps: floor, three days, one day, unavailable', () => {
  const reading = (total: number, available = true): BalanceReading => ({ available, lines: [{ currency: 'CNY', total, granted: 0, toppedUp: total }] });
  const history = (perDay: number, now: number): BalancePoint[] =>
    // 24 hourly readings falling `perDay` over the day before `now`.
    Array.from({ length: 24 }, (_, i) => ({ at: at(i), currency: 'CNY', total: now + perDay * (24 - i) / 24 }));

  it('plenty, no history: nothing', () => {
    expect(balanceVerdict(reading(100), [], at(24), undefined).steps).toEqual([]);
  });
  it('at or under the floor: floor', () => {
    expect(balanceVerdict(reading(10), [], at(24), undefined).steps).toEqual(['floor']);
    expect(balanceVerdict(reading(7.21), [], at(24), undefined).steps).toEqual(['floor']);   // production, 2026-10-04
  });
  it('about three days at the recent spend: days3, and the days are told', () => {
    const v = balanceVerdict(reading(50), history(20, 50), at(24), undefined);
    expect(v.daysLeft).toBeCloseTo(2.5, 1);
    expect(v.steps).toEqual(['days3']);
  });
  it('about a day: days3 and days1 both true, and one alert names the more urgent', () => {
    const v = balanceVerdict(reading(15), history(20, 15), at(24), undefined);
    expect(v.steps).toEqual(['days3', 'days1']);
    expect(mostUrgent(v.steps)).toBe('days1');
  });
  it('the provider says the balance no longer pays: unavailable, the most urgent of all', () => {
    const v = balanceVerdict(reading(0, false), [], at(24), undefined);
    expect(v.steps).toEqual(['floor', 'unavailable']);
    expect(mostUrgent(v.steps)).toBe('unavailable');
    expect(mostUrgent([])).toBeNull();
  });
});

describe('what counts as billing when a turn fails (the watch’s own question)', () => {
  // A database nobody may touch: every case here must answer before any write.
  const untouchable = new Proxy({}, { get: () => { throw new Error('the database was touched'); } }) as never;
  const watchWith = async (readBalance: (() => Promise<BalanceReading | null>) | null) => {
    const { providerWatch } = await import('../../src/pipeline/providerWatch.js');
    return providerWatch({ db: untouchable, operatorBusinessId: null, send: async () => {}, provider: 'DeepSeek', probe: null, readBalance, log: () => {} });
  };
  const timeout = Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' });

  it('a timeout while the balance still pays is not billing: the queue retries it as before (rule 19)', async () => {
    const w = await watchWith(async () => ({ available: true, lines: [{ currency: 'CNY', total: 50, granted: 0, toppedUp: 50 }] }));
    expect(await w.billingReason(timeout)).toBeNull();
  });
  it('a timeout where no balance can be read (Anthropic) is not billing either', async () => {
    expect(await (await watchWith(null)).billingReason(timeout)).toBeNull();
  });
  it('a balance that cannot be read is not taken for an empty one', async () => {
    expect(await (await watchWith(async () => { throw new Error('network'); })).billingReason(timeout)).toBeNull();
    expect(await (await watchWith(async () => null)).billingReason(timeout)).toBeNull();
  });
  it('an error that is not the provider’s is never billing, and asks no balance', async () => {
    let asked = 0;
    const w = await watchWith(async () => { asked++; return { available: false, lines: [] }; });
    expect(await w.billingReason(new Error('relation "turns" does not exist'))).toBeNull();
    expect(await w.billingReason(Object.assign(new Error('500'), { status: 500, error: { error: { message: 'Server Error' } } }))).toBeNull();
    expect(asked).toBe(0);
  });
});
