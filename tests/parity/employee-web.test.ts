import { describe, it, expect } from 'vitest';
import { renderEmployee, type EmployeeProfile } from '../../src/api/web/employee.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, withAssistantName, assistantName } from '../../src/api/web/say.js';

const base: EmployeeProfile = {
  knows: 14,
  assistantNamed: true,
  spotChecks: [],
  hireDate: new Date('2026-07-09T00:00:00Z'),
  stage: 'partial',
  canDo: ['greet'], needConfirm: ['quote', 'negotiate', 'follow_up'],
  capabilities: [
    { capability: 'greet', mode: 'auto', promotable: false },
    { capability: 'quote', mode: 'draft', promotable: true },
    { capability: 'negotiate', mode: 'draft', promotable: false },
  ],
  growth: [
    { kind: 'promote', capability: 'greet', at: new Date('2026-07-15T00:00:00Z') },
    { kind: 'spotcheck_pass', capability: null, at: new Date('2026-07-14T00:00:00Z') },
    { kind: 'learned_edit', capability: 'quote', at: new Date('2026-07-10T00:00:00Z') },
  ],
  promoted: true, conditions: [],
};

const probation: EmployeeProfile = {
  ...base, stage: 'probation', canDo: [], promoted: false,
  capabilities: [{ capability: 'greet', mode: 'draft', promotable: false }],
  growth: [], conditions: [{ cond: 'passed_spotcheck', met: true }, { cond: 'learned_correction', met: false }],
};

/**
 * The ban applies to what the owner READS. A `<style>` block is not read, and
 * a raw '%' scan over it fails on `width:100%` — layout, not a metric. The
 * refined check further down already draws this line for `%20` in a URL; this
 * one drew it more crudely and tripped the first time the page grew a
 * textarea. Stripping style and markup makes it MORE precise, not weaker: a
 * percentage anywhere in the copy still fails, and now does so for the right
 * reason.
 */
const ownerReads = (html: string): string =>
  html.replace(/<style[\s\S]*?<\/style>/g, ' ').toLowerCase();


describe('M9.6 · employee profile (localized)', () => {
  it('card: headlined by the name in force (else "your assistant"); stage/role localized', () => {
    const zh = renderEmployee(base, 'zh', null);
    expect(zh).toContain('<h1 class="page">你的助手</h1>');   // no name chosen: the fallback, never an invented name
    expect(zh).toContain('正式接待'); expect(zh).toContain('客户接待'); expect(zh).toContain('入职');
    const en = withAssistantName('Lily', () => renderEmployee(base, 'en', null));
    expect(en).toContain('<h1 class="page">Lily</h1>');      // the headline IS the chosen name
    expect(en).toContain('Customer reception');
    expect(renderEmployee(base, 'ar', null)).toContain('<h1 class="page">مساعدك</h1>');
  });

  it('duties: canDo / needConfirm / cannotDo from capability codes', () => {
    const zh = renderEmployee(base, 'zh', null);
    expect(zh).toContain(t('zh', 'her.handles.alone')); expect(zh).toContain('接待问候');   // Phase C: permission language
    expect(zh).toContain('要等你确认'); expect(zh).toContain('报价');     // quote — permission, not skill
    expect(zh).toContain('始终要等你确认'); expect(zh).toContain('确认订单'); // confirm_order: always
    const en = renderEmployee(base, 'en', null);
    expect(en).toContain(t('en', 'her.handles.alone')); expect(en).toContain('Greeting');
    expect(en).toContain('Waits for you'); expect(en).toContain('Quoting');
    expect(en).toContain('Always waits for you'); expect(en).toContain('Confirming orders');
  });

  it('growth: neutral event kinds render localized (with capability name)', () => {
    const zh = renderEmployee(base, 'zh', null);
    expect(zh).toContain('成长记录');
    expect(zh).toContain('「接待问候」晋升');
    expect(zh).toContain('抽查通过');
    expect(zh).toContain('学会一次修正（报价）');
    const en = renderEmployee(base, 'en', null);
    expect(en).toContain('Promoted: Greeting');
    expect(en).toContain('Spot-check passed');
    expect(en).toContain('Learned a correction (Quoting)');
    expect(renderEmployee({ ...base, growth: [] }, 'en', null)).toContain('Just getting started');
    expect(renderEmployee({ ...base, growth: [] }, 'zh', null)).toContain('还在起步');
  });

  it('promotion: stage, next step, real conditions — no invented score', () => {
    const zh = renderEmployee(probation, 'zh', null);
    expect(zh).toContain('晋升状态'); expect(zh).toContain('试用期'); expect(zh).toContain('正式接待');
    expect(zh).toContain('✓ 通过一次抽查'); expect(zh).toContain('○ 学会一次修正');
    const en = renderEmployee(probation, 'en', null);
    expect(en).toContain('Promotion'); expect(en).toContain('Probation');
    expect(en).toContain(t('en', 'employee.stage.partial'));
    expect(en).toContain('✓ Pass one spot-check'); expect(en).toContain('○ Learn one correction');
  });

  it('actions: revoke on granted, promote only where eligible, confirm_order note', () => {
    const en = renderEmployee(base, 'en', null);
    expect(en).toContain('action="/app/employee/capability/greet/revoke"');
    expect(en).toContain('action="/app/employee/capability/quote/promote"');
    expect(en).not.toContain('capability/negotiate/promote');
    expect(en).toContain('Confirming orders always waits for you');
    expect(renderEmployee(base, 'zh', null)).toContain('确认订单永远等你');
  });

  it('never shows a confidence score or technical vocabulary — every locale', () => {
    for (const l of LOCALES) {
      const html = ownerReads(renderEmployee(base, l, null) + renderEmployee(probation, l, null));
      for (const banned of ['ai', 'llm', 'model', 'confidence', 'accuracy', 'automation', 'api',
        '置信度', '准确率', '模型', '人工智能', '%']) {
        const hit = /^[a-z ]+$/.test(banned) ? new RegExp(`\\b${banned}\\b`).test(html) : html.includes(banned);
        expect(hit, `${l}:"${banned}"`).toBe(false);
      }
    }
  });

  it('mobile: no tables', () => {
    expect(renderEmployee(base, 'en', null)).not.toContain('<table');
  });
});

/**
 * Nomi Phase C — 小雅 answers "who is she today?", not "what settings do I
 * manage?". The four questions are: what she knows · what she handles on her
 * own · what she did recently · what she still needs from you.
 */
describe('Nomi Phase C · 小雅 (render)', () => {
  const ctx = {
    taughtRecently: 3, corrected: 1, handled: 12, draftsPrepared: 8, neededYou: 2,
    gaps: [
      { question: 'Do you ship to Dubai?', count: 4 },
      { question: 'Is the fabric food-safe?', count: 2 },
    ],
  };

  it('the page is the assistant — headlined by the chosen name in every locale', () => {
    for (const l of LOCALES) {
      // A chosen name is stored once and shown as-is, whatever the language.
      expect(withAssistantName('Lily', () => renderEmployee(base, l, null, ctx)))
        .toContain('<h1 class="page">Lily</h1>');
      // No name chosen yet: the capitalised "your assistant" label.
      expect(renderEmployee(base, l, null, ctx)).toContain(`<h1 class="page">${assistantName(l)}</h1>`);
    }
  });

  it('what the assistant knows: the learning, with a real lifetime count', () => {
    const html = renderEmployee(base, 'en', null, ctx);
    expect(html).toContain(t('en', 'her.knows.title'));
    expect(html).toContain(t('en', 'her.knows.count'));
    expect(html).toContain('>14<');            // base.knows
    expect(html).toContain('Added recently');
    expect(html).toContain('You corrected');
    expect(html).toContain('href="/app/knowledge"');
  });

  it('never taught anything: says so, and offers the one next action', () => {
    const html = renderEmployee({ ...base, knows: 0 }, 'en', null,
      { ...ctx, taughtRecently: 0, corrected: 0 });
    expect(html).toContain(t('en', 'her.knows.none'));
    expect(html).toContain('Teach');                    // the existing teach flow
    expect(html).not.toContain(t('en', 'her.knows.count'));
  });

  it('what the assistant handles: permission language, never a measure of ability', () => {
    const html = renderEmployee(base, 'en', null, ctx);
    expect(html).toContain(t('en', 'her.handles.title'));
    expect(html).toContain(t('en', 'her.handles.alone'));
    expect(html).toContain('Waits for you');
    expect(html).toContain('Always waits for you');     // confirm_order, by design
    for (const w of ['accuracy', 'confidence', 'quality', 'performance', 'score', 'rating', 'capability matrix']) {
      expect(html.toLowerCase().includes(w), w).toBe(false);
    }
  });

  it('nothing granted yet reads as a sensible starting point, not a failure', () => {
    const html = renderEmployee({ ...base, canDo: [], needConfirm: [] }, 'en', null, ctx);
    expect(html).toContain('Everything still waits for you. That is the right place to start.');
  });

  it('recently: real counts including how often you were needed', () => {
    const html = renderEmployee(base, 'en', null, ctx);
    expect(html).toContain('Recently');
    expect(html).toContain('>12<'); expect(html).toContain(t('en', 'ops.activity.handled'));
    expect(html).toContain('>8<');  expect(html).toContain('Replies prepared');
    expect(html).toContain('>2<');  expect(html).toContain('Needed your help');
  });

  it('a quiet employee reads calm, not broken', () => {
    const html = renderEmployee(base, 'en', null,
      { ...ctx, handled: 0, draftsPrepared: 0, neededYou: 0 });
    expect(html).toContain('No conversations yet.');
  });

  it('what the assistant needs: every gap leads to the EXISTING teach flow', () => {
    const html = renderEmployee(base, 'en', null, ctx);
    expect(html).toContain(t('en', 'her.teach.title'));
    expect(html).toContain('Do you ship to Dubai?');
    expect(html).toContain('asked 4×');
    expect(html).toContain('href="/app/knowledge?teach=Do%20you%20ship%20to%20Dubai%3F');
    expect(html).toContain(t('en', 'her.teach.go'));
    expect(html).not.toContain('<textarea');           // no second knowledge editor
  });

  it('nothing to teach is a success state', () => {
    const html = renderEmployee(base, 'en', null, { ...ctx, gaps: [] });
    expect(html).toContain(t('en', 'her.teach.none'));
  });

  it('the new sections are omitted entirely without context', () => {
    const html = renderEmployee(base, 'en', null);
    expect(html).not.toContain('Recently');
    expect(html).not.toContain(t('en', 'her.teach.title'));
  });

  it('renders in zh + ar, with the RTL chevron handled', () => {
    const zh = renderEmployee(base, 'zh', null, ctx);
    expect(zh).toContain(t('zh', 'her.knows.title')); expect(zh).toContain(t('zh', 'her.handles.title'));
    expect(zh).toContain(t('zh', 'her.teach.title'));
    const ar = renderEmployee(base, 'ar', null, ctx);
    expect(ar).toContain(t('ar', 'her.knows.title')); expect(ar).toContain(t('ar', 'her.handles.title'));
    expect(ar).toContain('<span class="go" aria-hidden="true">');   // the shell mirrors it
  });

  it('no score, percentage or technical vocabulary — any locale', () => {
    const LATIN = ['ai', 'llm', 'model', 'token', 'api', 'webhook', 'database', 'confidence', 'automation', 'prompt'];
    const CJK = ['模型', '人工智能', '数据库', '置信度', '接口'];
    for (const l of LOCALES) {
      const html = ownerReads(renderEmployee(base, l, null, ctx));
      for (const w of LATIN) expect(new RegExp(`\\b${w}\\b`).test(html), `${l}:${w}`).toBe(false);
      for (const w of CJK) expect(html.includes(w), `${l}:${w}`).toBe(false);
      for (const w of ['score', 'percent', 'rating', 'accuracy']) {
        expect(html.includes(w), `${l}:${w}`).toBe(false);
      }
      // No percentage in what the owner READS. (A raw '%' check would trip on
      // the URL-encoding in a teach link — %20 is not a metric.)
      const visible = html.replace(/<[^>]*>/g, ' ');
      expect(/\d\s*%/.test(visible), `${l}: percentage in visible copy`).toBe(false);
    }
  });

  it('mobile-first: no tables, gap rows collapse on a phone', () => {
    const html = renderEmployee(base, 'en', null, ctx);
    expect(html).not.toContain('<table');
    expect(html).toContain('@media (max-width:560px)');
  });
});

/* ── 抽查, ported from the deleted M5 text card ──────────────────────────── */

describe('M34.8 · a spot check shows the owner the work itself', () => {
  /**
   * PORTED CHECK, not a ported module. `core/owner/trustCards.ts` rendered a
   * 抽查 card asserting it showed the capability, both messages and the words
   * to reply with. That card is deleted; the live section is on this page. The
   * rule survives because it is a product rule: asking the owner to judge a
   * reply she cannot see would be asking her to guess.
   */
  const withCheck: EmployeeProfile = {
    ...base,
    spotChecks: [{
      id: 's1', capability: 'quote', conversationId: 'c1',
      askedAt: new Date('2026-08-12T02:00:00Z'),
      buyerMessage: 'Can you do 20000 pcs FOB Ningbo?',
      reply: 'Yes — for 20,000 pcs the unit price is $0.38 FOB Ningbo.',
    }],
  };

  it('renders the buyer message and her reply, not a reference to them', () => {
    const html = renderEmployee(withCheck, 'en', null);
    expect(html).toContain('Can you do 20000 pcs FOB Ningbo?');
    expect(html).toContain('$0.38 FOB Ningbo');
    // The id belongs in the form action; it must not appear in anything the
    // owner READS. (The first version of this asserted against the whole
    // document and failed on its own action URL.)
    const visible = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]*>/g, ' ');
    expect(visible).not.toContain('s1');
  });

  it('offers a way to answer in every locale, and posts to the one action', () => {
    for (const l of LOCALES) {
      const html = renderEmployee(withCheck, l, null);
      expect(html).toContain('/app/employee/spot-check/s1');
      expect(html).toContain('value="好"');       // the wire word parseSpotCheckReply reads
      expect(html).toContain('value="有问题"');
    }
  });

  it('renders nothing at all when there is nothing to check', () => {
    const html = renderEmployee(base, 'en', null);
    expect(html).not.toContain('/app/employee/spot-check/');
  });
});
