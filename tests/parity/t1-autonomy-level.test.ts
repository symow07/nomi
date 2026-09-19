import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AUTONOMY_LEVELS, aloneAt, isAutonomyLevel, levelOf, modesFor } from '../../src/core/conversation/autonomyLevel.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';

/**
 * T1 — how much she does on her own is the owner's choice, from day one.
 *
 * The evidence ladder was the only door: fifteen handled, twelve approved
 * untouched, two spot checks, five days — before "Hi there!" could go out
 * without a tap. The owner said, on his first real day, that an assistant which
 * waits for approval on every message is not one. The ladder stays as advice;
 * the decision is his. These are the three levels and what none of them can do.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

describe('T1 · the three levels', () => {
  it('waits: nothing goes out alone — what every workspace had until now', () => {
    expect(aloneAt('waits')).toEqual([]);
    expect(Object.values(modesFor('waits')).every((m) => m === 'draft')).toBe(true);
  });

  it('talks: she greets, asks, recommends and follows up; anything that states a price waits', () => {
    expect([...aloneAt('talks')].sort()).toEqual(['follow_up', 'greet', 'qualify', 'recommend']);
    expect(modesFor('talks').quote).toBe('draft');
    expect(modesFor('talks').negotiate).toBe('draft');
  });

  it('sells: quoting and negotiating too', () => {
    expect(modesFor('sells').quote).toBe('auto');
    expect(modesFor('sells').negotiate).toBe('auto');
  });

  it('NO level lets her confirm an order without a person', () => {
    for (const l of AUTONOMY_LEVELS) {
      expect(modesFor(l).confirm_order, l).toBe('draft');
      expect(aloneAt(l)).not.toContain('confirm_order');
      expect(Object.keys(modesFor(l)).sort()).toEqual([...CAPABILITIES].sort());
    }
  });

  it('the level shown is the level she is at — and a mix is called a mix', () => {
    for (const l of AUTONOMY_LEVELS) expect(levelOf(modesFor(l))).toBe(l);
    expect(levelOf({})).toBe('waits');                                   // no rows yet: everything waits
    expect(levelOf({ ...modesFor('talks'), greet: 'draft' })).toBeNull(); // she lost one to a violation
    expect(levelOf({ ...modesFor('waits'), quote: 'auto' })).toBeNull();  // she earned one on the ladder
  });

  it('only the three words are a level', () => {
    expect(isAutonomyLevel('talks')).toBe(true);
    for (const v of ['', 'auto', 'everything', 'SELLS']) expect(isAutonomyLevel(v), v).toBe(false);
  });
});

describe('T1 · what the choice does not loosen', () => {
  it('it is the owner\'s alone, through the same gate as a single grant', () => {
    const app = read('src/api/web/app.ts');
    const route = app.slice(app.indexOf("app.post('/app/employee/autonomy'"));
    expect(route.slice(0, 300)).toContain("ownerOnly(req, reply, 'capability_grant', '/app/employee')");
  });

  it('applying it never touches confirm_order, writes only what changed, and says who decided', () => {
    const src = read('src/pipeline/capability.ts');
    const fn = src.slice(src.indexOf('export async function chooseAutonomyLevel'), src.indexOf('export const promoteCapability'));
    expect(fn).toMatch(/if \(NON_PROMOTABLE\.includes\(capability\)\) continue;/);
    expect(fn).toMatch(/if \(fromMode === toMode\) continue;/);
    expect(fn).toMatch(/owner_chose_\$\{level\}/);
  });

  it('a held turn still waits, whatever the level: a hold overrides the mode where the mode is read', () => {
    // The one line that makes every level safe to offer: her rules can hold a
    // turn (a discount above the ask line, a contradicting price, a heard
    // quantity, guards that failed twice) and a held turn is a draft, full stop.
    expect(read('src/pipeline/turn.ts')).toMatch(/effectiveMode\(r\.hold \? 'draft' : policyMode, capability,/);
    const hold = read('src/core/conversation/hold.ts');
    for (const why of ['discount_needs_owner', 'guards_failed_twice', 'contradicts_history']) expect(hold, why).toContain(why);
  });
});
