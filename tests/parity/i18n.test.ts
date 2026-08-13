import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import {
  LOCALES, DEFAULT_LOCALE, isRtl, dirOf, parseLocale, fromAcceptLanguage, resolveLocale,
} from '../../src/core/owner/i18n/locale.js';
import { messages, t, countryName, EMPLOYEE_NAME, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { formatQty, formatMoney, formatDate, formatTime } from '../../src/core/owner/i18n/format.js';

describe('ADR-0008 · locale resolution', () => {
  it('default is English', () => expect(DEFAULT_LOCALE).toBe('en'));

  it('parseLocale accepts only supported locales', () => {
    expect(parseLocale('en')).toBe('en');
    expect(parseLocale('zh')).toBe('zh');
    expect(parseLocale('ar')).toBe('ar');
    expect(parseLocale('fr')).toBeNull();
    expect(parseLocale(undefined)).toBeNull();
  });

  it('fromAcceptLanguage picks the first supported primary subtag', () => {
    expect(fromAcceptLanguage('ar-SA,ar;q=0.9,en;q=0.8')).toBe('ar');
    expect(fromAcceptLanguage('zh-CN,zh;q=0.9')).toBe('zh');
    expect(fromAcceptLanguage('en-GB')).toBe('en');
    expect(fromAcceptLanguage('fr-FR,de;q=0.5')).toBeNull();
    expect(fromAcceptLanguage(null)).toBeNull();
  });

  it('resolveLocale: cookie > Accept-Language > default', () => {
    expect(resolveLocale('zh', 'en-US')).toBe('zh');          // cookie wins
    expect(resolveLocale(null, 'ar-SA')).toBe('ar');          // header next
    expect(resolveLocale('bogus', 'fr-FR')).toBe('en');       // both invalid → default
    expect(resolveLocale(undefined, undefined)).toBe('en');
  });

  it('RTL only for Arabic', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('en')).toBe(false); expect(isRtl('zh')).toBe(false);
    expect(dirOf('ar')).toBe('rtl'); expect(dirOf('en')).toBe('ltr');
  });
});

describe('ADR-0008 · catalog completeness (CI gate)', () => {
  const keys = (l: (typeof LOCALES)[number]) => Object.keys(messages[l]).sort();

  it('every locale has an identical key set — a missing key fails here', () => {
    const base = keys('en');
    expect(base.length).toBeGreaterThan(0);
    for (const l of LOCALES) expect(keys(l), `locale ${l}`).toEqual(base);
  });

  it('no value is empty or an untranslated leftover in any locale', () => {
    for (const l of LOCALES) {
      for (const [k, v] of Object.entries(messages[l])) {
        expect(v.trim().length, `${l}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it('EMPLOYEE_NAME defined for every locale', () => {
    for (const l of LOCALES) expect(EMPLOYEE_NAME[l].length).toBeGreaterThan(0);
    expect(EMPLOYEE_NAME).toEqual({ en: 'Lily', zh: '小雅', ar: 'ياسمين' });
  });

  // Phase A (Nomi): the employee's nav entry IS her name — "you go to her", not
  // "you configure an employee record". Two sources for one name would drift, so
  // this pins them together.
  it('the employee nav label is her name in every locale', () => {
    for (const l of LOCALES) {
      expect(t(l, 'nav.employee'), l).toBe(EMPLOYEE_NAME[l]);
    }
  });

  // Phase A: nav labels are what the owner reads; the KEYS stay untouched so
  // routes, tests and i18n lookups keep working.
  it('no navigation label uses system vocabulary', () => {
    const SYSTEM_WORDS = ['sandbox', 'channel', 'config', 'dashboard', 'admin', 'panel',
                          'console', 'module', 'operations', '沙盒', '配置', '控制台', '后台'];
    for (const l of LOCALES) {
      for (const id of ['home','inbox','conversations','channels','products','knowledge',
                        'employee','analytics','sandbox','settings','onboarding']) {
        const label = t(l, `nav.${id}` as MessageKey).toLowerCase();
        for (const w of SYSTEM_WORDS) {
          expect(label.includes(w), `${l} nav.${id} = "${label}" contains "${w}"`).toBe(false);
        }
      }
    }
  });
});

describe('ADR-0008 · banned technical vocabulary in every locale', () => {
  const LATIN = ['ai', 'llm', 'model', 'token', 'api', 'webhook', 'database', 'confidence', 'automation', 'prompt'];
  const CJK = ['模型', '人工智能', '数据库', '置信度', '接口'];

  it('no catalog string leaks implementation vocabulary', () => {
    for (const l of LOCALES) {
      const blob = Object.values(messages[l]).join(' \n ').toLowerCase();
      for (const w of LATIN) {
        expect(new RegExp(`\\b${w}\\b`).test(blob), `${l}:${w}`).toBe(false);
      }
      for (const w of CJK) expect(blob.includes(w), `${l}:${w}`).toBe(false);
    }
  });
});

describe('ADR-0008 · t() and countryName', () => {
  it('interpolates {params}', () => {
    expect(t('en', 'app.tagline', { name: 'Lily' })).toBe("Lily's workspace");
    expect(t('zh', 'app.tagline', { name: '小雅' })).toBe('小雅的工作台');
    expect(t('en', 'ops.activity.title', { name: 'Lily' })).toBe('What Lily did');
  });

  it('falls back to English then to the raw key', () => {
    // an unknown key returns itself (never throws)
    expect(t('ar', 'does.not.exist' as MessageKey)).toBe('does.not.exist');
  });

  it('countryName localizes a known code, else null', () => {
    expect(countryName('en', 'AE')).toBe('UAE');
    expect(countryName('zh', 'AE')).toBe('阿联酋');
    expect(countryName('ar', 'SA')).toBe('السعودية');
    expect(countryName('en', 'ZZ')).toBeNull();
    expect(countryName('en', null)).toBeNull();
  });
});

describe('ADR-0008 · localized formatting', () => {
  it('formatQty: zh uses 万 and no grouping for small; en/ar group Western', () => {
    expect(formatQty('zh', 5000)).toBe('5000');
    expect(formatQty('zh', 12000)).toBe('1.2万');
    expect(formatQty('zh', 200000)).toBe('20万');
    expect(formatQty('en', 5000)).toBe('5,000');
    expect(formatQty('ar', 5000)).toBe('5,000');   // Western digits, not Arabic-Indic
  });

  it('currency is never localized away from USD', () => {
    expect(formatMoney(usd(0.92))).toBe('$0.92');
    expect(formatMoney(usd(4600))).toBe('$4,600.00');
  });

  it('dates/times render per locale without throwing', () => {
    const d = new Date('2026-07-27T02:30:00Z');
    for (const l of LOCALES) {
      expect(formatDate(l, d).length).toBeGreaterThan(0);
      expect(formatTime(l, d)).toMatch(/\d/);
    }
  });
});
