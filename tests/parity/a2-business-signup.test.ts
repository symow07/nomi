import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BUSINESS_KINDS, TEAM_SIZES, CHANNELS_USED, countryCodes, countryOptions, isCountryCode, normalizeWebsite,
} from '../../src/core/owner/business.js';
import { signupPage } from '../../src/api/web/layout.js';
import { messages, t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { PASSWORD_MIN } from '../../src/security/password.js';

/**
 * A2 — Nomi is for any business that talks to buyers on social channels, not
 * one factory. Sign-up asks what kind, and nothing the owner or a buyer reads
 * says "factory" any more — except the one category that IS a factory.
 */

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('A2 · the lists are one list', () => {
  const migration = readFileSync(`${root}migrations/0056_business_kind.sql`, 'utf8');

  it('THE DATABASE ACCEPTS EXACTLY WHAT THE FORM OFFERS — kinds and team sizes', () => {
    const inCheck = (column: string): string[] =>
      [...(migration.match(new RegExp(`${column} is null or ${column} in\\s*\\(([^)]*)\\)`))?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    expect(inCheck('kind')).toEqual([...BUSINESS_KINDS]);
    expect(inCheck('team_size')).toEqual([...TEAM_SIZES]);
  });

  it('every choice has a name in every language', () => {
    for (const locale of LOCALES) {
      for (const k of BUSINESS_KINDS) expect(messages[locale][`business.kind.${k}` as MessageKey], `${locale} ${k}`).toBeTruthy();
      for (const s of TEAM_SIZES) expect(messages[locale][`business.team.${s}` as MessageKey], `${locale} ${s}`).toBeTruthy();
      for (const c of CHANNELS_USED) expect(messages[locale][`business.channel.${c}` as MessageKey], `${locale} ${c}`).toBeTruthy();
    }
  });

  it('a tenant is still made in ONE place, and the old name still answers the old code during a deploy', () => {
    expect(migration).toMatch(/create or replace function provision_workspace\(/);
    expect(migration).toMatch(/revoke all on function provision_workspace\([^)]*\) from public/);
    expect(migration).not.toMatch(/drop function/i);
    const db = readFileSync(`${root}src/db/accounts.ts`, 'utf8');
    expect(db).toContain('from provision_workspace(');
    expect(db).not.toContain('from provision_account(');
  });
});

describe('A2 · countries', () => {
  it('the places a business is registered — not groupings, reserved codes or countries that are gone', () => {
    const codes = countryCodes();
    for (const c of ['MA', 'CN', 'US', 'AE', 'DE', 'XK', 'HK', 'TW']) expect(codes, c).toContain(c);
    for (const c of ['EU', 'UN', 'ZZ', 'SU', 'YU', 'AC', 'QO']) expect(codes, c).not.toContain(c);
    expect(codes.length).toBeGreaterThan(230);
    expect(codes.length).toBeLessThan(260);
    expect(isCountryCode('MA')).toBe(true);
    expect(isCountryCode('ma'), 'the validator upper-cases first; the list itself is exact').toBe(false);
  });

  it('named and sorted in the reader\'s own language', () => {
    expect(countryOptions('en').find((c) => c.code === 'MA')?.name).toBe('Morocco');
    expect(countryOptions('zh').find((c) => c.code === 'MA')?.name).toBe('摩洛哥');
    expect(countryOptions('ar').find((c) => c.code === 'MA')?.name).toBe('المغرب');
    const en = countryOptions('en').map((c) => c.name);
    expect([...en].sort((a, b) => a.localeCompare(b, 'en'))).toEqual(en);
  });
});

describe('A2 · a web address as she might type it', () => {
  it('becomes the one shape that is stored', () => {
    expect(normalizeWebsite('atlas.example')).toEqual({ ok: true, value: 'https://atlas.example' });
    expect(normalizeWebsite(' WWW.Atlas.Example/shop/ ')).toEqual({ ok: true, value: 'https://www.atlas.example/shop' });
    expect(normalizeWebsite('http://atlas.example')).toEqual({ ok: true, value: 'https://atlas.example' });
    expect(normalizeWebsite('')).toEqual({ ok: true, value: null });
  });

  it('and what is not an address is refused rather than stored', () => {
    for (const bad of ['not a site', 'localhost', 'ftp://atlas.example', 'javascript:alert(1)', 'https://user:pw@atlas.example', `a.${'x'.repeat(300)}.example`])
      expect(normalizeWebsite(bad), bad).toEqual({ ok: false });
  });
});

describe('A2 · the sign-up page asks about the business', () => {
  const html = signupPage({
    locale: 'en', path: '/signup', mode: 'open', passwordMin: PASSWORD_MIN,
    values: { kind: 'agency', country: 'AE', teamSize: '6-20', channels: ['instagram'], sells: '<i>ads</i>' },
  });

  it('every answer but two is a choice from a list, and what she chose is still chosen after a mistake', () => {
    for (const name of ['kind', 'country', 'teamSize']) expect(html, name).toMatch(new RegExp(`<select[^>]*name="${name}"[^>]*required`));
    expect(html).toContain('<option value="agency" selected>');
    expect(html).toContain('<option value="AE" selected>');
    expect(html).toContain('<option value="6-20" selected>');
    expect(html).toMatch(/name="channel_instagram" checked/);
    expect(html).not.toMatch(/name="channel_whatsapp" checked/);
    expect(html).toContain('&lt;i&gt;ads&lt;/i&gt;');
    expect(html.match(/name="channel_[a-z]+"/g)?.length, 'one name per box: a shared name would keep only the last tick').toBe(CHANNELS_USED.length);
  });

  it('the website is the one question she may leave empty', () => {
    expect(html).toMatch(/name="website"(?![^>]*required)/);
    expect(html).toMatch(/name="sells"[^>]*required/);
  });
});

describe('A2 · nothing says "factory" any more', () => {
  it('IN ANY LANGUAGE — except the one category that is a factory', () => {
    const allowed = new Set(['business.kind.manufacturer']);
    const word = /factor(y|ies)|工厂|مصنع|مصانع/i;
    const left: string[] = [];
    for (const locale of LOCALES) for (const [key, value] of Object.entries(messages[locale])) {
      if (!allowed.has(key) && word.test(value)) left.push(`${locale} ${key}: ${value}`);
    }
    expect(left, left.join('\n')).toEqual([]);
  });

  it('the menu, the door and the buyer\'s proof page say it the new way', () => {
    expect(t('en', 'nav.factory')).toBe('My business');
    expect(t('zh', 'nav.factory')).toBe('我的公司');
    expect(t('ar', 'nav.factory')).toBe('شركتي');
    expect(t('en', 'proof.source.taught')).toBe('Confirmed by the company');
    expect(t('en', 'signup.title')).toBe('Set up your business');
  });
});
