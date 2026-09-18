import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeLivenessCache, sessionStands, livenessKey } from '../../src/api/web/liveness.js';
import { makeSessionCodec } from '../../src/api/web/session.js';
import { renderPeople } from '../../src/api/web/people.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * S1 — a removed person is signed out. The cookie is stateless and lives seven
 * days; until this, nothing looked at whether the person it named still worked
 * there. What is pinned: the rule that decides whether a session stands, the
 * memory that keeps it to one question a minute, and the three places in the
 * routes that make removal and a password change take effect at once.
 */

const LIVE = { live: true, passwordChangedAt: null } as const;

describe('S1 · does this session still stand?', () => {
  it('someone removed, or a business switched off, holds a cookie that opens nothing', () => {
    expect(sessionStands({ live: false, passwordChangedAt: null }, 1000)).toBe(false);
    expect(sessionStands({ live: false, passwordChangedAt: 5 }, 9999)).toBe(false);
  });

  it('A PASSWORD CHANGE ENDS THE SESSIONS OPENED WITH THE OLD ONE, and only those — by equality, no clock', () => {
    expect(sessionStands({ live: true, passwordChangedAt: 10_000 }, 10_000)).toBe(true);
    expect(sessionStands({ live: true, passwordChangedAt: 10_000 }, 9_999), 'a millisecond earlier is a different password').toBe(false);
    expect(sessionStands({ live: true, passwordChangedAt: 10_000 }, 99_999), 'a stamp from the future is not the login\'s either').toBe(false);
    expect(sessionStands({ live: true, passwordChangedAt: null }, 10_000), 'someone with no password cannot have changed it').toBe(true);
  });

  it('NOBODY IS LOGGED OUT BY A DEPLOY — a cookie from before this milestone has no issue time and is judged on the person alone', () => {
    expect(sessionStands({ live: true, passwordChangedAt: 10_000 }, undefined)).toBe(true);
    expect(sessionStands(LIVE, undefined)).toBe(true);
    const codec = makeSessionCodec('s'.repeat(32));
    const old = codec.verify(codec.sign({ businessId: 'b', exp: Date.now() + 1000 }), Date.now());
    expect(old).not.toBeNull();
    expect(old!.pv).toBeUndefined();
    const fresh = codec.verify(codec.sign({ businessId: 'b', exp: Date.now() + 1000, pv: 42 }), Date.now());
    expect(fresh!.pv).toBe(42);
  });
});

describe('S1 · one question a minute, and none after she removes someone', () => {
  it('remembers for its time, then asks again', () => {
    const c = makeLivenessCache(1000);
    c.set('k', LIVE, 0);
    expect(c.get('k', 999)).toEqual(LIVE);
    expect(c.get('k', 1000)).toBeNull();
    expect(c.get('never', 0)).toBeNull();
  });

  it('FORGETS AT ONCE WHEN TOLD TO — removal is now, not "within a minute"', () => {
    const c = makeLivenessCache(60_000);
    const key = livenessKey('biz', 'person');
    c.set(key, LIVE, 0);
    c.evict(key);
    expect(c.get(key, 1)).toBeNull();
  });

  it('cannot be grown without bound', () => {
    const c = makeLivenessCache(60_000, 10);
    for (let i = 0; i < 1000; i++) c.set(`k${i}`, LIVE, 0);
    expect(c.get('k0', 1)).toBeNull();
    expect(c.get('k999', 1)).toEqual(LIVE);
  });
});

describe('S1 · the routes that make it true', () => {
  const app = readFileSync(fileURLToPath(new URL('../../src/api/web/app.ts', import.meta.url)), 'utf8');

  it('every workspace request is asked, before any handler runs', () => {
    expect(app).toMatch(/app\.addHook\('onRequest'[\s\S]{0,200}req\.url\.startsWith\('\/app'\)/);
    expect(app).toContain('sessionStands(v, s.pv)');
  });

  it('IF THE QUESTION CANNOT BE ASKED THE OWNER STILL GETS IN, and nobody else does', () => {
    const hook = app.slice(app.indexOf("app.addHook('onRequest'"), app.indexOf("app.addHook('onRequest'") + 1400);
    expect(hook).toMatch(/catch \{\s*if \(person\.isOwner\) return;\s*return reply\.redirect\('\/login'\);/);
  });

  it('a removal and a password change drop the remembered answer in the same request', () => {
    expect(app).toMatch(/removePerson\([\s\S]{0,260}liveness\.evict\(livenessKey\(/);
    expect(app).toMatch(/setPassword\([\s\S]{0,400}liveness\.evict\(livenessKey\(/);
  });

  it('a session opened with a password carries WHICH password, read from the row and not from a clock', () => {
    expect(app).toMatch(/signIn\(reply, login\.businessId, login\.person, '\/app', await passwordVersionOf\(/);
    expect(app).toMatch(/await passwordVersionOf\(made\.businessId, made\.personId\)/);
    expect(app).not.toMatch(/iat: Date\.now\(\)/);
  });
});

describe('S1 · she is told what Remove does before it does it', () => {
  it('the button asks first, in her language, naming the person', () => {
    const html = renderPeople({
      people: [
        { id: 'p1', name: 'Mei', isOwner: true, addedAt: new Date('2026-09-01T00:00:00Z') },
        { id: 'p2', name: 'Xiao <Chen>', isOwner: false, addedAt: new Date('2026-09-02T00:00:00Z') },
      ],
      justIssued: null,
    } as unknown as Parameters<typeof renderPeople>[0], 'en', null);
    expect(html.match(/data-confirm=/g)?.length, 'the owner cannot be removed, so only one button asks').toBe(1);
    expect(html).toContain('onclick="return confirm(this.dataset.confirm)"');
    expect(html).toContain('Remove Xiao &lt;Chen&gt;? They are signed out now');
    expect(t('zh', 'people.remove.confirm', { who: 'X' })).toContain('X');
    expect(t('ar', 'people.remove.confirm', { who: 'X' })).toContain('X');
    expect(html).not.toContain('Xiao <Chen>');
  });
});
