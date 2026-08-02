import { describe, it, expect } from 'vitest';
import { renderEmployee, type EmployeeProfile } from '../../src/api/web/employee.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

const base: EmployeeProfile = {
  knows: 14,
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

describe('M9.6 · employee profile (localized)', () => {
  it('card: name is a per-locale constant; stage/role localized', () => {
    const zh = renderEmployee(base, 'zh', null);
    expect(zh).toContain('小雅');                       // Phase C: the page IS her, not a file
    expect(zh).toContain('正式接待'); expect(zh).toContain('客户接待'); expect(zh).toContain('入职');
    const en = renderEmployee(base, 'en', null);
    expect(en).toContain('Lily');                       // the headline IS her name
    expect(en).toContain('Customer reception');
    expect(renderEmployee(base, 'ar', null)).toContain('ياسمين');
  });

  it('duties: canDo / needConfirm / cannotDo from capability codes', () => {
    const zh = renderEmployee(base, 'zh', null);
    expect(zh).toContain('她自己处理'); expect(zh).toContain('接待问候');   // Phase C: permission language
    expect(zh).toContain('要等你确认'); expect(zh).toContain('报价');     // quote — permission, not skill
    expect(zh).toContain('始终要等你确认'); expect(zh).toContain('确认订单'); // confirm_order: always
    const en = renderEmployee(base, 'en', null);
    expect(en).toContain('She handles this herself'); expect(en).toContain('Greeting');
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
    expect(en).toContain('Handling some on her own');
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
      const html = (renderEmployee(base, l, null) + renderEmployee(probation, l, null)).toLowerCase();
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

  it('the page is HER — headlined by her name in every locale', () => {
    for (const [l, n] of [['en', 'Lily'], ['zh', '小雅'], ['ar', 'ياسمين']] as const) {
      expect(renderEmployee(base, l, null, ctx)).toContain(`<h1 class="page">${n}</h1>`);
    }
  });

  it('what she knows: her learning, with a real lifetime count', () => {
    const html = renderEmployee(base, 'en', null, ctx);
    expect(html).toContain('What she knows');
    expect(html).toContain('Things she learned from you');
    expect(html).toContain('>14<');            // base.knows
    expect(html).toContain('Added recently');
    expect(html).toContain('You corrected');
    expect(html).toContain('href="/app/knowledge"');
  });

  it('never taught anything: says so, and offers the one next action', () => {
    const html = renderEmployee({ ...base, knows: 0 }, 'en', null,
      { ...ctx, taughtRecently: 0, corrected: 0 });
    expect(html).toContain('She has not been taught anything yet');
    expect(html).toContain('Teach');                    // the existing teach flow
    expect(html).not.toContain('Things she learned from you');
  });

  it('what she handles: permission language, never a measure of ability', () => {
    const html = renderEmployee(base, 'en', null, ctx);
    expect(html).toContain('What she handles on her own');
    expect(html).toContain('She handles this herself');
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
    expect(html).toContain('>12<'); expect(html).toContain('Buyers she talked to');
    expect(html).toContain('>8<');  expect(html).toContain('Replies prepared');
    expect(html).toContain('>2<');  expect(html).toContain('Needed your help');
  });

  it('a quiet employee reads calm, not broken', () => {
    const html = renderEmployee(base, 'en', null,
      { ...ctx, handled: 0, draftsPrepared: 0, neededYou: 0 });
    expect(html).toContain('No conversations yet.');
  });

  it('what she needs: every gap leads to the EXISTING teach flow', () => {
    const html = renderEmployee(base, 'en', null, ctx);
    expect(html).toContain('What she still needs from you');
    expect(html).toContain('Do you ship to Dubai?');
    expect(html).toContain('asked 4×');
    expect(html).toContain('href="/app/knowledge?teach=Do%20you%20ship%20to%20Dubai%3F');
    expect(html).toContain('Teach her');
    expect(html).not.toContain('<textarea');           // no second knowledge editor
  });

  it('nothing to teach is a success state', () => {
    const html = renderEmployee(base, 'en', null, { ...ctx, gaps: [] });
    expect(html).toContain('she answered everything from what you taught');
  });

  it('the new sections are omitted entirely without context', () => {
    const html = renderEmployee(base, 'en', null);
    expect(html).not.toContain('Recently');
    expect(html).not.toContain('What she still needs from you');
  });

  it('renders in zh + ar, with the RTL chevron handled', () => {
    const zh = renderEmployee(base, 'zh', null, ctx);
    expect(zh).toContain('她知道什么'); expect(zh).toContain('她可以自己处理的');
    expect(zh).toContain('她还需要你教的');
    const ar = renderEmployee(base, 'ar', null, ctx);
    expect(ar).toContain('ما تعرفه'); expect(ar).toContain('ما تتولّاه بنفسها');
    expect(ar).toContain('<span class="go" aria-hidden="true">');   // the shell mirrors it
  });

  it('no score, percentage or technical vocabulary — any locale', () => {
    const LATIN = ['ai', 'llm', 'model', 'token', 'api', 'webhook', 'database', 'confidence', 'automation', 'prompt'];
    const CJK = ['模型', '人工智能', '数据库', '置信度', '接口'];
    for (const l of LOCALES) {
      const html = renderEmployee(base, l, null, ctx).toLowerCase();
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
