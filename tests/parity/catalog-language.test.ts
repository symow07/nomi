import { describe, it, expect } from 'vitest';
import { messages, t, EMPLOYEE_NAME, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';

/**
 * Phase F — the final owner-language pass, enforced over the WHOLE catalog
 * rather than over whatever a renderer happened to emit. The rule the product
 * lives by: the owner understands it without knowing how it works inside.
 */
const entries = (l: Locale) => Object.entries(messages[l]) as [MessageKey, string][];

/** Words an owner would never use about her own business. */
const INTERNAL: readonly (readonly [string, RegExp])[] = [
  ['automation', /\bautomat(e|ed|ic|ically|ion)\b/i],
  ['configuration', /\bconfigur(e|ed|ation)\b/i],
  ['workflow', /\bworkflow\b/i],
  ['metrics', /\bmetrics?\b/i],
  ['endpoint', /\bendpoints?\b/i],
  ['adapter', /\badapters?\b/i],
  ['credential', /\bcredentials?\b/i],
  ['parameter', /\bparameters?\b/i],
  ['deploy', /\bdeploy(ed|ment)?\b/i],
  ['runtime', /\bruntime\b/i],
  ['schema', /\bschemas?\b/i],
  ['migration', /\bmigrations?\b/i],
  ['tenant', /\btenants?\b/i],
  ['simulation', /\bsimulat(e|ed|ion)\b/i],
  ['test case', /\btest cases?\b/i],
  ['zh 系统', /系统/],
  ['zh 配置', /配置/],
  ['zh 自动', /自动/],
  ['zh 部署', /部署/],
  ['ar نظام', /نظام/],
  ['ar تلقائي', /تلقائي/],
];

/** The operator's own panels — an owner never has to read these to sell. */
const OPERATOR_PREFIXES = ['runbook.deploy.', 'meta.'];
const isOperator = (k: string) => OPERATOR_PREFIXES.some((p) => k.startsWith(p));

describe('Phase F · the catalog speaks to an owner, not to an engineer', () => {
  it('no internal vocabulary survives in any locale', () => {
    const hits: string[] = [];
    for (const l of LOCALES)
      for (const [key, s] of entries(l)) {
        // Exempt: the operator's own panels, the zh trade term for a spec sheet,
        // and certification names (ISO 9001 *is* a quality management system).
        if (isOperator(key) || key === 'knowledge.kind.specification' || key.startsWith('claim.')) continue;
        for (const [label, re] of INTERNAL) if (re.test(s)) hits.push(`${l}/${key}: "${s}" (${label})`);
      }
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('she is called by her name, never "your employee"', () => {
    const hits: string[] = [];
    for (const l of LOCALES)
      for (const [key, s] of entries(l)) {
        if (key.startsWith('login.')) continue;          // shown before an owner is known
        if (/your employee|员工|موظفتك/.test(s)) hits.push(`${l}/${key}: "${s}"`);
      }
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('t() fills her name even when a caller forgets to pass it', () => {
    for (const l of LOCALES) {
      const s = t(l, 'takeover.status.ai');
      expect(s).not.toContain('{name}');
      expect(s).toContain(EMPLOYEE_NAME[l]);
    }
  });

  it('a placeholder is spelled identically in all three locales', () => {
    // A misspelled {nmae} in one locale renders literally to that owner and to
    // nobody else — the failure that is invisible until a customer sees it.
    const of = (s: string) => [...new Set(s.match(/\{[a-zA-Z]+\}/g) ?? [])].sort().join(',');
    for (const [key, en] of entries('en'))
      for (const l of LOCALES)
        expect(of(messages[l][key]), `${l}/${key}`).toBe(of(en));
  });

  it('the zh catalog speaks TO the owner, never about her in the third person', () => {
    const hits = entries('zh')
      .filter(([k, s]) => !k.startsWith('login.') && /老板/.test(s))
      .map(([k, s]) => `${k}: ${s}`);
    expect(hits, hits.join('\n')).toEqual([]);
  });

  it('the retired surface names are gone', () => {
    const retired: Record<Locale, RegExp> = { en: /\bInbox\b/, zh: /收件箱/, ar: /الوارد/ };
    for (const l of LOCALES) {
      const hits = entries(l).filter(([, s]) => retired[l].test(s)).map(([k, s]) => `${l}/${k}: ${s}`);
      expect(hits, hits.join('\n')).toEqual([]);
    }
  });

  it('no number is presented as a judgment of how well she works', () => {
    const judgment = [/the better she/i, /the less you correct/i, /\bscore\b/i, /\brating\b/i,
      /\baccuracy\b/i, /\bperformance\b/i, /成功率/, /评分/, /准确率/, /نسبة النجاح/];
    const hits: string[] = [];
    for (const l of LOCALES)
      for (const [key, s] of entries(l))
        for (const re of judgment) if (re.test(s)) hits.push(`${l}/${key}: "${s}"`);
    expect(hits, hits.join('\n')).toEqual([]);
  });

  /**
   * A platform's NAME is the same word in every language, and three prefixes
   * hold nothing else: WhatsApp is WhatsApp in Chinese. Named once here rather
   * than as a growing list of exemptions inside the assertion, so the next
   * surface that has to label a channel does not need a fourth.
   */
  const isPlatformName = (k: string): boolean =>
    k.startsWith('channel.platform.') || k.startsWith('conv.channel.')
    || k.startsWith('contacts.channel.') || k.startsWith('reach.channel.');

  it('every key exists in every locale, and nothing is left untranslated', () => {
    const en = new Set(Object.keys(messages.en));
    for (const l of LOCALES) {
      expect(new Set(Object.keys(messages[l])), l).toEqual(en);
      if (l === 'en') continue;
      const untranslated = entries(l)
        .filter(([k, s]) => messages.en[k] === s && /[a-zA-Z]{4}/.test(s))
        .filter(([k, v]) => !k.startsWith('claim.') && !k.startsWith('country.')
          && !k.includes('unit') && !isOperator(k) && !isPlatformName(k) && k !== 'nav.channels')
        .map(([k, s]) => `${l}/${k}: ${s}`);
      expect(untranslated, untranslated.join('\n')).toEqual([]);
    }
  });
});
