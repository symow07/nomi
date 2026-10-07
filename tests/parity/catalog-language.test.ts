import { describe, it, expect } from 'vitest';
import { messages, t, ASSISTANT_FALLBACK, type MessageKey } from '../../src/core/owner/i18n/messages.js';
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

  it('t() fills {name} even when a caller forgets to pass it — with "your assistant"', () => {
    for (const l of LOCALES) {
      const s = t(l, 'takeover.status.ai');
      expect(s).not.toContain('{name}');
      expect(s.toLocaleLowerCase()).toContain(ASSISTANT_FALLBACK[l]);
    }
  });

  it('a placeholder is spelled identically in all three locales', () => {
    // A misspelled {nmae} in one locale renders literally to that owner and to
    // nobody else — the failure that is invisible until a customer sees it.
    // `{name}` is the one placeholder a language may use or leave out: `t()`
    // fills it in any string, passed or not, and since the assistant has no
    // pronouns (2026-09-23) one language names her where another drops the
    // subject. A misspelling of it is still caught — `{nmae}` is not `{name}`.
    // And `{n}` in a counted sentence's form (`tn`, 2026-09-29): a language may
    // spell a small count as a word — Arabic «سبب واحد», «سببان» — so a form
    // may leave the figure out. Any other placeholder there is still held.
    const PLURAL_FORM = /\.(?:zero|one|two|few|many|other)$/;
    const of = (s: string, key: string) => [...new Set(s.match(/\{[a-zA-Z]+\}/g) ?? [])]
      .filter((p) => p !== '{name}' && !(p === '{n}' && PLURAL_FORM.test(key))).sort().join(',');
    for (const [key, en] of entries('en'))
      for (const l of LOCALES)
        expect(of(messages[l][key], key), `${l}/${key}`).toBe(of(en, key));
  });

  it('the zh catalog speaks TO the owner, never about her in the third person', () => {
    // `staff.*` is the one exception with a reason: those lines are said TO a
    // sales assistant (M47), ABOUT the owner — the one reader for whom she is
    // 老板. Addressing a refusal to staff as "only you can do this" (G9a found
    // it) is the error this rule exists to prevent, pointed the other way.
    const hits = entries('zh')
      .filter(([k, s]) => !k.startsWith('login.') && !k.startsWith('staff.') && /老板/.test(s))
      .map(([k, s]) => `${k}: ${s}`);
    expect(hits, hits.join('\n')).toEqual([]);
  });

  // THE WARMTH RUN (2026-10-03) — the owner named the list "Inbox" again
  // ("rename from 'Customer list'"); the name retired now is "Customer list".
  it('the retired surface names are gone', () => {
    const retired: Record<Locale, RegExp> = { en: /\bCustomer list\b/i, zh: /客户列表/, ar: /قائمة العملاء/, es: /lista de clientes/i, fr: /liste des clients/i };
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
  /**
   * A literal EXAMPLE shown inside a field — an address of the shape she should
   * type. Domains are ASCII in every language, and a translated one would be an
   * example that does not exist.
   */
  const isExample = (k: string): boolean => k === 'domain.field.placeholder';

  const isPlatformName = (k: string): boolean =>
    k.startsWith('channel.platform.') || k.startsWith('conv.channel.')
    || k.startsWith('contacts.channel.') || k.startsWith('reach.channel.')
    // A2 — "WhatsApp", "Instagram", "TikTok" on the sign-up form are the same names.
    || k.startsWith('business.channel.')
    // The warmth run, phase 9 — the way out on Notifications (Arabic writes it «واتساب» there).
    || k === 'alerts.way.whatsapp';

  /**
   * Phase 9 (0121) — French shares these words with English: they ARE the
   * French words (Conversations, Photos, Total, Description…), not leftovers.
   * Listed by key, so a new untranslated string still fails; a listed key whose
   * French changes is dropped from the list by the check below.
   */
  const SAME_WORD: Partial<Record<Locale, ReadonlySet<string>>> = {
    fr: new Set(['pane.label', 'panel.conversations.one', 'panel.conversations.two', 'panel.conversations.few',
      'panel.conversations.many', 'panel.conversations.other', 'login.emailLabel', 'data.export.subject.messages',
      'buyers.page.nav', 'analytics.summary.conversations', 'product.detail.imagesTitle', 'proof.fact.total', 'proof.certs.title',
      'inbox.detail.log', 'order.card.email', 'billing.plan.assistants', 'settings.field.description',
      'product.detail.total', 'order.field.total', 'sandbox.scenario.badge', 'knowledge.teach.kind', 'knowledge.cert.title',
      'knowledge.kind.restriction', 'product.edit.options', 'received.photo', 'received.document', 'nav.contacts',
      'calendar.cat.conversations', 'calendar.add.day', 'site.channels.email', 'components.state.focus',
      'product.detail.fromPhoto', 'import.photoLabel', 'import.columns.option', 'seq.step.label',
      // The warmth run, phase 8 — Notifications and E-mail are French words too.
      'alerts.title', 'alerts.way.email',
      // The warmth run's re-audit — the rail's name for an assistant not yet named: Assistant is French too.
      'nav.short.employee',
      // Phase 9 — the channels' number screen names the page its door opens (w4-settings-a-06).
      'meta.phoneAlerts',
      // The advisor's history (2026-10-07) — the privacy page's section on cookies: "Cookies" is the French word.
      'legal.privacy.cookies.title']),
    // The advisor's history (2026-10-07) — and the Spanish one (§9.4 of docs/ADVISOR-MEMORY.md).
    es: new Set(['legal.privacy.cookies.title']),
  };
  it('the words French shares with English are still shared (else the list is stale)', () => {
    for (const [l, keys] of Object.entries(SAME_WORD) as [Locale, ReadonlySet<string>][])
      for (const k of keys) expect(messages[l][k as MessageKey], `${l}/${k}`).toBe(messages.en[k as MessageKey]);
  });

  it('every key exists in every locale, and nothing is left untranslated', () => {
    const en = new Set(Object.keys(messages.en));
    for (const l of LOCALES) {
      expect(new Set(Object.keys(messages[l])), l).toEqual(en);
      if (l === 'en') continue;
      const untranslated = entries(l)
        // A5.2 — a placeholder is not English: `{name}` alone is her name, in
        // whatever language it was given, and there is nothing to translate.
        .filter(([k, s]) => messages.en[k] === s && /[a-zA-Z]{4}/.test(s.replace(/\{\w+\}/g, '')))
        .filter(([k, v]) => !k.startsWith('claim.') && !k.startsWith('country.')
          && !k.includes('unit') && !isOperator(k) && !isPlatformName(k) && !isExample(k) && k !== 'nav.channels'
          && !SAME_WORD[l]?.has(k))
        .map(([k, s]) => `${l}/${k}: ${s}`);
      expect(untranslated, untranslated.join('\n')).toEqual([]);
    }
  });
});
