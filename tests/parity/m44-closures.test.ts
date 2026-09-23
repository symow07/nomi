import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { blockingClosure, validateClosure, type FactoryClosure } from '../../src/core/commerce/closures.js';
import { computeQuote } from '../../src/core/commerce/quote.js';
import { guardNumerals } from '../../src/core/safety/numerals.js';
import { renderClosures, type ClosureView } from '../../src/api/web/settings.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { product, tiers, policy, emptyState } from './fixtures.js';

/**
 * M44 — she does not promise a date her factory cannot hit.
 *
 * Nothing in this product knew about Chinese New Year, so every lead time it
 * quoted in January was a lie stated with confidence: "25 days" from the 20th
 * lands inside two weeks when the machines are off and the workers are on
 * trains. Correct arithmetic, false promise — the worst combination available,
 * because it is checkable and a buyer will check it.
 *
 * Two decisions carry the milestone, and both are refusals:
 *
 *   THE CALENDAR IS HERS. No built-in holiday table. The dates are lunar and
 *   move; the LENGTH is a business decision (eight days here, five weeks
 *   there); and a guess about when someone else's factory is shut is the same
 *   invented number this product refuses everywhere else.
 *
 *   IT REFUSES, IT DOES NOT RESCHEDULE. Adding the closed days and quoting the
 *   later date invents a promise she never made. So the lead time becomes
 *   ABSENT — and absence is enforcement, because `guardNumerals` sources every
 *   figure from the quote.
 */

const jan = (d: number) => new Date(`2027-01-${String(d).padStart(2, '0')}T09:00:00Z`);
const cny: FactoryClosure = {
  label: '春节', from: new Date('2027-02-05T00:00:00Z'), to: new Date('2027-02-21T00:00:00Z'),
};

describe('M44 · a closure inside the window blocks the promise', () => {
  it('blocks when the shutdown falls inside the lead time', () => {
    const b = blockingClosure({ now: jan(20), leadTimeDays: 25, closures: [cny] });
    expect(b).not.toBeNull();
    expect(b!.closure.label).toBe('春节');
  });

  it('blocks a shutdown in the MIDDLE, not only at the end', () => {
    // Fifteen days shut in the middle of a twenty-five-day lead time is
    // twenty-five days of nothing being made.
    const b = blockingClosure({ now: new Date('2027-02-01T09:00:00Z'), leadTimeDays: 60, closures: [cny] });
    expect(b).not.toBeNull();
  });

  it('does NOT block when the window clears it', () => {
    expect(blockingClosure({ now: jan(1), leadTimeDays: 10, closures: [cny] })).toBeNull();
    expect(blockingClosure({ now: new Date('2027-03-01T09:00:00Z'), leadTimeDays: 25, closures: [cny] })).toBeNull();
  });

  it('a closure that starts today counts as today', () => {
    const today: FactoryClosure = {
      label: 'maintenance', from: jan(20), to: jan(22),
    };
    expect(blockingClosure({ now: jan(20), leadTimeDays: 3, closures: [today] })).not.toBeNull();
  });

  it('NO closures stated is not "open" — it is unchanged behaviour', () => {
    // She has not told us. Inventing a calendar of our own would be worse than
    // knowing nothing, because it would look like knowledge.
    expect(blockingClosure({ now: jan(20), leadTimeDays: 25, closures: [] })).toBeNull();
  });

  it('reports the NEAREST blocking closure — the first reason the date fails', () => {
    const later: FactoryClosure = {
      label: 'summer', from: new Date('2027-07-01T00:00:00Z'), to: new Date('2027-07-10T00:00:00Z'),
    };
    const b = blockingClosure({ now: jan(20), leadTimeDays: 300, closures: [later, cny] });
    expect(b!.closure.label).toBe('春节');
  });
});

describe('M44 · the quote loses the date, and cannot get it back', () => {
  const quoteOn = (now: Date, closures: readonly FactoryClosure[]) => computeQuote({
    product: product(), tiers: tiers(), policy: policy(), rules: [], quantity: 20000, closures, now,
  });

  it('a blocked lead time becomes null, with the reason attached FOR THE OWNER', () => {
    const r = quoteOn(jan(20), [cny]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.leadTimeDays).toBeNull();
    expect(r.value.leadTimeBlocked?.closure.label).toBe('春节');
    // The PRICE is untouched: her factory being shut does not change what a bag
    // costs, and refusing the whole quote would be refusing more than she did.
    expect(r.value.unitPrice.amount).toBeGreaterThan(0);
  });

  it('an unblocked quote keeps the lead time exactly as before', () => {
    const r = quoteOn(jan(1), [cny]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.leadTimeDays).toBe(product().leadTimeDays);
      expect(r.value.leadTimeBlocked).toBeNull();
    }
  });

  it('THE ENFORCEMENT: a reply cannot state a date the quote does not carry', () => {
    // This is why the number is removed rather than replaced. `guardNumerals`
    // sources every figure from the quote, so a lead time that is not there
    // cannot be said — no prompt, no wording, no retry gets it back.
    const blocked = quoteOn(jan(20), [cny]);
    const open = quoteOn(jan(1), [cny]);
    if (!blocked.ok || !open.ok) throw new Error('fixture');

    const reply = 'For 20,000 pcs the unit price is $0.38, and delivery takes 25 days.';
    const state = emptyState();
    expect(guardNumerals({ reply, quote: open.value, state, clientText: '' }).ok).toBe(true);
    expect(guardNumerals({ reply, quote: blocked.value, state, clientText: '' }).ok).toBe(false);
  });

  it('and it does NOT invent a later date to replace it', () => {
    const r = quoteOn(jan(20), [cny]);
    if (!r.ok) throw new Error('fixture');
    // A factory does not resume at full rate the morning it reopens, and a
    // rescheduled date is a promise SHE never made.
    expect(r.value.leadTimeDays).toBeNull();
    const src = JSON.stringify(r.value);
    expect(src).not.toMatch(/"leadTimeDays":\s*\d/);
  });

  it('without a clock, nothing is blocked — a caller that cannot say when is not guessed for', () => {
    const r = computeQuote({
      product: product(), tiers: tiers(), policy: policy(), rules: [], quantity: 20000, closures: [cny],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.leadTimeDays).toBe(product().leadTimeDays);
  });
});

describe('M44 · what she typed', () => {
  it('accepts a named range', () => {
    const v = validateClosure({ label: ' 春节 ', from: '2027-02-05', to: '2027-02-21' });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.label).toBe('春节');
      expect(v.value.from).toEqual(new Date('2027-02-05T00:00:00Z'));
    }
  });

  it('refuses a nameless closure, a missing date, and a range that ends before it starts', () => {
    for (const [input, code] of [
      [{ label: '', from: '2027-02-05', to: '2027-02-21' }, 'label_missing'],
      [{ label: 'x', from: '', to: '2027-02-21' }, 'from_missing'],
      [{ label: 'x', from: '2027-02-05', to: '' }, 'to_missing'],
      [{ label: 'x', from: 'not-a-date', to: '2027-02-21' }, 'not_a_date'],
      // Constructed from parts and round-trip checked: Date.UTC(2027, 1, 30)
      // silently becomes the 2nd of March, and a closure that moved a month
      // would block the wrong window while looking perfectly valid.
      [{ label: 'x', from: '2027-02-30', to: '2027-03-05' }, 'not_a_date'],
      [{ label: 'x', from: '2027-13-01', to: '2027-13-05' }, 'not_a_date'],
      [{ label: 'x', from: '2027-02-21', to: '2027-02-05' }, 'ends_before_starts'],
    ] as const) {
      const v = validateClosure(input);
      expect(v.ok, JSON.stringify(input)).toBe(false);
      if (!v.ok) expect(v.error, JSON.stringify(input)).toBe(code);
    }
  });

  it('holds no opinion about how long a shutdown may be', () => {
    // Six weeks next March is her business. A band would be this module knowing
    // something about her factory that it does not know.
    const v = validateClosure({ label: 'rebuild', from: '2027-03-01', to: '2027-04-15' });
    expect(v.ok).toBe(true);
  });

  it('a single day is a closure', () => {
    const v = validateClosure({ label: 'stocktake', from: '2027-05-01', to: '2027-05-01' });
    expect(v.ok).toBe(true);
    if (v.ok) expect(blockingClosure({
      now: new Date('2027-05-01T09:00:00Z'), leadTimeDays: 1, closures: [v.value],
    })).not.toBeNull();
  });
});

describe('M44 · the surface', () => {
  const view: ClosureView = { closures: [{ id: 'c1', ...cny }] };

  it('shows what she stated, and offers to remove it', () => {
    const html = renderClosures(view, 'en', null);
    expect(html).toContain('春节');
    expect(html).toContain('/app/settings/closures/c1/remove');
    expect(html).toContain('action="/app/settings/closures"');
  });

  it('empty state says what happens WITHOUT a closure, and names the action', () => {
    for (const locale of LOCALES) {
      const html = renderClosures({ closures: [] }, locale, null);
      const visible = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
      // The employee's name is substituted by `t` itself, so the fixture asks
      // for the same string the renderer produced rather than a trimmed guess.
      expect(visible, locale).toContain(t(locale, 'closures.empty'));
      expect(visible, locale).toContain(t(locale, 'closures.add.button'));
    }
  });

  it('never claims to know a holiday she has not stated', async () => {
    // A date table anywhere in this feature would be outside knowledge about
    // her factory, and it would be wrong: the length is hers, not the calendar's.
    const core = await readFile(new URL('../../src/core/commerce/closures.ts', import.meta.url), 'utf8');
    // COMMENTS may name a date — one of them explains a driver off-by-one with
    // a worked example. What must not exist is a date in the CODE: the moment
    // this file contains a calendar, it is asserting when someone else's
    // factory is shut.
    const code = core
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    expect(code, 'a date literal reached the code — that is a calendar')
      .not.toMatch(/\b\d{4}-\d\d-\d\d\b/);
    expect(code).not.toMatch(/HOLIDAYS|LUNAR|CHINESE_NEW_YEAR|RAMADAN/i);
  });

  it('is reachable from My business (D), and registered as routes', async () => {
    const settings = await readFile(new URL('../../src/api/web/factory.ts', import.meta.url), 'utf8');
    expect(settings).toContain("deeper('/app/settings/closures'");
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(app).toContain("app.get('/app/settings/closures'");
    expect(app).toContain("app.post('/app/settings/closures'");
    expect(app).toContain("app.post('/app/settings/closures/:id/remove'");
  });

  it('THE PRODUCTION CALLER reads her closures and passes them to the engine', async () => {
    const turn = await readFile(new URL('../../src/pipeline/turn.ts', import.meta.url), 'utf8');
    expect(turn).toContain('tenant.catalog.factoryClosures()');
    expect(turn).toMatch(/computeQuote\(\{[\s\S]{0,200}closures, now: ports\.now\(\)/);
  });

  it('every string exists in all three locales', () => {
    const KEYS: MessageKey[] = [
      'closures.title', 'closures.intro', 'closures.empty', 'closures.add.label',
      'closures.add.placeholder', 'closures.add.from', 'closures.add.to',
      'closures.add.button', 'closures.remove', 'closures.range',
      'closures.blocked.title', 'closures.blocked.body', 'closures.blocked.action',
      'closures.flash.added', 'closures.flash.removed', 'closures.flash.label_missing',
      'closures.flash.from_missing', 'closures.flash.to_missing', 'closures.flash.not_a_date',
      'closures.flash.ends_before_starts', 'closures.flash.failed',
    ];
    for (const locale of LOCALES) {
      for (const k of KEYS) {
        const s = t(locale, k, { label: '春节', from: '5 Feb', to: '21 Feb' });
        expect(s.length, `${locale} ${k}`).toBeGreaterThan(1);
        expect(s, `${locale} ${k}`).not.toContain('{');
      }
    }
  });
});
