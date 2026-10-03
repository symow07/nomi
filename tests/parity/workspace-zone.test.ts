import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_ZONES, isZone, zonesOf, onlyZoneOf, zoneChoices, zoneForSignup, zoneLabel } from '../../src/core/owner/zones.js';
import { countryCodes } from '../../src/core/owner/business.js';
import { validateSignup } from '../../src/core/owner/signup.js';
import { signupPage } from '../../src/api/web/layout.js';
import { withZone, workspaceZone } from '../../src/api/web/zone.js';
import { formatTime, dayKey } from '../../src/core/owner/i18n/format.js';
import { PASSWORD_MIN, PASSWORD_MAX } from '../../src/security/password.js';

/**
 * TZ (the owner's decision, 2026-09-30) — one time zone per workspace, chosen
 * at sign-up. Shanghai time for everyone was a leftover of the export
 * positioning. What is pinned: every zone offered is one this build can format
 * in; every country sign-up offers has one; a country with one zone is never
 * asked, a country with several always is; the same instant reads differently
 * in two workspaces; and no code outside the country table, the demo and the
 * golden scenarios names Shanghai.
 */

const opts = { mode: 'open' as const, passwordMin: PASSWORD_MIN, passwordMax: PASSWORD_MAX };
const good = {
  factory: 'Corner Bakery', name: 'Sam', email: 'sam@bakery.example', password: 'correct horse battery', invite: '',
  kind: 'retail', sells: 'Bread and cakes', country: 'US', website: '', teamSize: '2-5', channels: ['instagram'], terms: 'on',
};

describe('TZ · the zones offered are real', () => {
  it('every zone in the country table is one this build can format in', () => {
    expect(ALL_ZONES.length).toBeGreaterThan(300);
    const unknown = ALL_ZONES.filter((z) => !isZone(z));
    expect(unknown).toEqual([]);
  });

  it('every country the sign-up form offers is either given its zone or asked a question it can answer', () => {
    // Kosovo was neither before this test: no zone, so no question — and sign-up
    // refused it for a missing answer it had no field for.
    const stuck = countryCodes().filter((c) => {
      if (onlyZoneOf(c)) return false;
      const page = signupPage({ locale: 'en', path: '/signup', mode: 'open', passwordMin: PASSWORD_MIN, values: { country: c } });
      return !page.includes('name="zone"') || zoneChoices(c).length < 2;
    });
    expect(stuck).toEqual([]);
    expect(onlyZoneOf('XK')).toBe('Europe/Belgrade');
    // A country the table has no zone for is offered every zone.
    expect(zonesOf('BV')).toEqual([]);
    expect(zoneChoices('BV')).toEqual(ALL_ZONES);
    expect(zoneForSignup('BV', 'Europe/Oslo')).toBe('Europe/Oslo');
    // Before a country is chosen, nothing is asked.
    expect(zoneChoices('')).toEqual([]);
  });

  it('isZone refuses what is not a zone', () => {
    for (const bad of ['', 'Mars/Olympus', 'UTC; drop table', '../../etc', 'Asia/Shanghai\n']) expect(isZone(bad)).toBe(false);
    expect(isZone('Europe/London')).toBe(true);
  });
});

describe('TZ · sign-up asks only where the country has several', () => {
  it('a country with one zone gets it without the question', () => {
    expect(onlyZoneOf('MA')).toBe('Africa/Casablanca');
    expect(zoneForSignup('MA', '')).toBe('Africa/Casablanca');
    // Even a stray pick cannot move a one-zone country elsewhere.
    expect(zoneForSignup('MA', 'Asia/Tokyo')).toBe('Africa/Casablanca');
    const v = validateSignup({ ...good, country: 'MA', currency: 'USD' }, opts);
    expect(v.ok && v.value.profile.zone).toBe('Africa/Casablanca');
  });

  it('a country with several is asked, and only its own zones are accepted', () => {
    expect(onlyZoneOf('US')).toBeNull();
    expect(zoneForSignup('US', '')).toBeNull();
    expect(zoneForSignup('US', 'Europe/London')).toBeNull();
    expect(zoneForSignup('US', 'America/New_York')).toBe('America/New_York');

    expect(validateSignup(good, opts)).toMatchObject({ ok: false, problems: { zone: 'zone_missing' } });
    const v = validateSignup({ ...good, zone: 'America/Chicago' }, opts);
    expect(v.ok && v.value.profile.zone).toBe('America/Chicago');
  });

  it('the form shows the question for a several-zone country, and not for a one-zone one', () => {
    const us = signupPage({ locale: 'en', path: '/signup', mode: 'open', passwordMin: PASSWORD_MIN, values: { country: 'US' } });
    expect(us).toMatch(/<select id="su-zone" name="zone" required>/);
    expect(us).toContain('value="America/New_York"');
    expect(us).not.toContain('value="Europe/London"');
    const ma = signupPage({ locale: 'en', path: '/signup', mode: 'open', passwordMin: PASSWORD_MIN, values: { country: 'MA' } });
    expect(ma).not.toContain('name="zone"');
  });

  it('a zone reads as the place, then the time it keeps, in the owner\'s language', () => {
    expect(zoneLabel('en', 'America/New_York')).toMatch(/^New York — .+/);
    expect(zoneLabel('zh', 'America/Argentina/Buenos_Aires')).toMatch(/^Buenos Aires, Argentina — .+/);
  });
});

describe('TZ · every date is said in the workspace\'s zone', () => {
  const at = new Date('2026-09-30T23:30:00Z');

  it('one instant, two workspaces: two local times and two days', () => {
    expect(formatTime('en', at, 'Europe/London')).toBe('00:30');
    expect(formatTime('en', at, 'America/Los_Angeles')).toBe('16:30');
    expect(dayKey(at, 'Europe/London')).toBe('2026-10-01');
    expect(dayKey(at, 'America/Los_Angeles')).toBe('2026-09-30');
  });

  it('outside a workspace the zone is UTC — never a business\'s it does not belong to', () => {
    expect(workspaceZone()).toBe('UTC');
    expect(withZone('Asia/Tokyo', () => workspaceZone())).toBe('Asia/Tokyo');
    expect(workspaceZone()).toBe('UTC');
  });
});

describe('TZ · no code decides Shanghai for a workspace', () => {
  const SRC = fileURLToPath(new URL('../../src', import.meta.url));
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
  // The country table offers it to China; the demo workspace and the golden
  // scenarios keep it as their stated zone; format.ts's note says what it was.
  const ALLOWED = ['core/owner/zones.ts', 'core/owner/i18n/format.ts', 'trust/harness.ts', 'trust/scenarios.ts'];
  const allowed = (p: string) => ALLOWED.some((a) => p.endsWith(join(...a.split('/')))) || p.includes(`${join('src', 'demo')}`);

  it('the search finds the one the country table names (positive control)', () => {
    const table = files(SRC).find((p) => p.endsWith(join('core', 'owner', 'zones.ts')))!;
    expect(readFileSync(table, 'utf8')).toContain("'Asia/Shanghai'");
  });

  it('nowhere else', () => {
    const named = files(SRC).filter((p) => !allowed(p) && readFileSync(p, 'utf8').includes('Asia/Shanghai'));
    expect(named).toEqual([]);
  });
});

describe('Phase 9 (V1-522) · a country\'s zones, told apart by the time each keeps', () => {
  it('in the owner\'s language; the tz city only where two zones keep the same time', async () => {
    const { zoneChoices, zoneLabelsAmong } = await import('../../src/core/owner/zones.js');
    const cn = zoneChoices('CN'); const zh = zoneLabelsAmong('zh', cn);
    for (const z of cn) expect(zh(z), z).not.toMatch(/[A-Za-z]/);
    const br = zoneChoices('BR'); const es = zoneLabelsAmong('es', br);
    expect(es('America/Recife')).toMatch(/\(Recife\)$/);
    expect(new Set(br.map(es)).size).toBe(br.length);   // every zone of the list is told apart
  });
});
