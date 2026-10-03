import { describe, it, expect } from 'vitest';
import { renderEmployee, type EmployeeProfile } from '../../src/api/web/employee.js';
import { everyScreen, screen } from './employee-screens.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, withAssistantName, assistantName } from '../../src/api/web/say.js';
import { readFileSync } from 'node:fs';
import { disclosureAwaitingReview, disclosureReviewed } from '../../src/core/conversation/disclosure.js';
import { languageName } from '../../src/api/web/inbox.js';
import { formatList } from '../../src/core/owner/i18n/format.js';

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
    const zh = everyScreen(base, 'zh', null);
    expect(zh).toContain('<h1 class="page">你的助手</h1>');   // no name chosen: the fallback, never an invented name
    expect(zh).toContain(t('zh', 'employee.stage.partial')); expect(zh).toContain(t('zh', 'employee.role.reception')); expect(zh).toContain('入职');
    const en = withAssistantName('Lily', () => everyScreen(base, 'en', null));
    expect(en).toContain('<h1 class="page">Lily</h1>');      // the headline IS the chosen name
    expect(en).toContain('Answers your customers');
    expect(everyScreen(base, 'ar', null)).toContain('<h1 class="page">مساعدك</h1>');
  });

  it('duties: canDo / needConfirm / cannotDo from capability codes', () => {
    const zh = everyScreen(base, 'zh', null);
    expect(zh).toContain(t('zh', 'her.handles.alone')); expect(zh).toContain('接待问候');   // Phase C: permission language
    expect(zh).toContain('要等你确认'); expect(zh).toContain('报价');     // quote — permission, not skill
    expect(zh).toContain('始终要等你确认'); expect(zh).toContain('确认订单'); // confirm_order: always
    const en = everyScreen(base, 'en', null);
    expect(en).toContain(t('en', 'her.handles.alone')); expect(en).toContain('Greeting');
    expect(en).toContain('Waits for you'); expect(en).toContain('Quoting');
    expect(en).toContain('Always waits for you'); expect(en).toContain('Confirming orders');
  });

  it('growth: neutral event kinds render localized (with capability name)', () => {
    const zh = everyScreen(base, 'zh', null);
    expect(zh).toContain(t('zh', 'employee.growth.title'));
    expect(zh).toContain('「接待问候」开始不等你就发出');
    expect(zh).toContain('你检查了你的助手的一条回复：没问题');
    expect(zh).toContain('你在发出前改了一条回复（报价）');
    const en = everyScreen(base, 'en', null);
    expect(en).toContain('Greeting now goes out without you');
    expect(en).toContain('You checked one of your assistant’s replies: it was right');
    expect(en).toContain('You corrected a reply before it went out (Quoting)');
    expect(everyScreen({ ...base, growth: [] }, 'en', null)).toContain('Nothing has changed yet.');
    expect(everyScreen({ ...base, growth: [] }, 'zh', null)).toContain('还没有变化');
  });

  it('promotion: stage, next step, real conditions — no invented score', () => {
    const zh = everyScreen(probation, 'zh', null);
    expect(zh).toContain(t('zh', 'employee.promo.title')); expect(zh).toContain('当前：每条回复都先等你');
    expect(zh).toContain('下一步：部分回复不等你就发出');
    expect(zh).toContain('<span class="dot ok" aria-hidden="true">✓</span> 你检查你的助手的一条回复，没问题');
    expect(zh).toContain('<span class="dot warn" aria-hidden="true">○</span> 你改过你的助手的一条回复');
    const en = everyScreen(probation, 'en', null);
    expect(en).toContain('What comes next'); expect(en).toContain('Now: Every reply waits for you');
    expect(en).toContain(`Next: ${t('en', 'employee.stage.partial')}`);
    expect(en).toContain('✓</span> You check one of your assistant’s replies and it is right');
    expect(en).toContain('○</span> You correct one of your assistant’s replies');
  });

  it('actions: revoke on granted, promote only where eligible, confirm_order note', () => {
    const en = everyScreen(base, 'en', null);
    expect(en).toContain('action="/app/employee/capability/greet/revoke"');
    expect(en).toContain('action="/app/employee/capability/quote/promote"');
    expect(en).not.toContain('capability/negotiate/promote');
    expect(en).toContain('Confirming orders always waits for you');
    expect(everyScreen(base, 'zh', null)).toContain('确认订单永远等你');
  });

  it('never shows a confidence score or technical vocabulary — every locale', () => {
    for (const l of LOCALES) {
      const html = ownerReads(everyScreen(base, l, null) + everyScreen(probation, l, null));
      for (const banned of ['ai', 'llm', 'model', 'confidence', 'accuracy', 'automation', 'api',
        '置信度', '准确率', '模型', '人工智能', '%']) {
        const hit = /^[a-z ]+$/.test(banned) ? new RegExp(`\\b${banned}\\b`).test(html) : html.includes(banned);
        expect(hit, `${l}:"${banned}"`).toBe(false);
      }
    }
  });

  it('mobile: no tables', () => {
    expect(everyScreen(base, 'en', null)).not.toContain('<table');
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
      expect(withAssistantName('Lily', () => everyScreen(base, l, null, ctx)))
        .toContain('<h1 class="page">Lily</h1>');
      // No name chosen yet: the capitalised "your assistant" label.
      expect(everyScreen(base, l, null, ctx)).toContain(`<h1 class="page">${assistantName(l)}</h1>`);
    }
  });

  it('what the assistant knows: the learning, with a real lifetime count', () => {
    const html = everyScreen(base, 'en', null, ctx);
    expect(html).toContain(t('en', 'her.knows.title'));
    expect(html).toContain(t('en', 'her.knows.count'));
    expect(html).toContain('>14<');            // base.knows
    expect(html).toContain('Added recently');
    expect(html).toContain('You corrected');
    expect(html).toContain('href="/app/knowledge"');
  });

  it('never taught anything: says so, and offers the one next action', () => {
    const html = everyScreen({ ...base, knows: 0 }, 'en', null,
      { ...ctx, taughtRecently: 0, corrected: 0 });
    expect(html).toContain(t('en', 'her.knows.none'));
    expect(html).toContain('Teach');                    // the existing teach flow
    expect(html).not.toContain(t('en', 'her.knows.count'));
  });

  it('what the assistant handles: permission language, never a measure of ability', () => {
    const html = everyScreen(base, 'en', null, ctx);
    expect(html).toContain(t('en', 'her.handles.title'));
    expect(html).toContain(t('en', 'her.handles.alone'));
    expect(html).toContain('Waits for you');
    expect(html).toContain('Always waits for you');     // confirm_order, by design
    for (const w of ['accuracy', 'confidence', 'quality', 'performance', 'score', 'rating', 'capability matrix']) {
      expect(html.toLowerCase().includes(w), w).toBe(false);
    }
  });

  it('nothing granted yet reads as a sensible starting point, not a failure', () => {
    const html = everyScreen({ ...base, canDo: [], needConfirm: [] }, 'en', null, ctx);
    expect(html).toContain('Everything still waits for you. That is the right place to start.');
  });

  it('recently: real counts including how often you were needed', () => {
    const html = everyScreen(base, 'en', null, ctx);
    expect(html).toContain(t('en', 'her.recent.title'));
    expect(html).toContain('<b class="hnum">12</b> customers answered');
    expect(html).toContain('<b class="hnum">8</b> replies prepared');
    expect(html).toContain('<b class="hnum">2</b> conversations needed your help');
  });

  it('a quiet employee reads calm, not broken', () => {
    const html = everyScreen(base, 'en', null,
      { ...ctx, handled: 0, draftsPrepared: 0, neededYou: 0 });
    expect(html).toContain('Nothing yet this month.'); expect(html).not.toContain('No conversations yet');
  });

  it('what the assistant needs: every gap leads to the EXISTING teach flow', () => {
    const html = everyScreen(base, 'en', null, ctx);
    expect(html).toContain(t('en', 'her.teach.title'));
    expect(html).toContain('Do you ship to Dubai?');
    expect(html).toContain('asked 4×');
    expect(html).toContain('href="/app/knowledge?teach=Do%20you%20ship%20to%20Dubai%3F');
    expect(html).toContain(t('en', 'her.teach.go'));
    expect(html).not.toContain('<textarea');           // no second knowledge editor
  });

  it('nothing to teach is a success state', () => {
    const html = everyScreen(base, 'en', null, { ...ctx, gaps: [] });
    expect(html).toContain(t('en', 'her.teach.none'));
  });

  it('without the month\'s counts, the month and the questions say nothing they do not know', () => {
    // Phase 7 — the rows are doors and stay; what they open holds no count.
    expect(screen('month', base, 'en')).not.toContain('class="hrow"');
    const learning = screen('learning', base, 'en');
    expect(learning).not.toContain(t('en', 'her.teach.none'));
    expect(learning).not.toContain(t('en', 'her.teach.unasked'));
    const landing = renderEmployee(base, 'en', null);
    const row = (href: string) => landing.slice(landing.indexOf(`href="${href}"`), landing.indexOf('</a>', landing.indexOf(`href="${href}"`)));
    expect(row('/app/employee/month')).not.toContain('sr-value');
    expect(row('/app/employee/learning')).not.toContain('sr-value');
  });

  it('renders in zh + ar, with the RTL chevron handled', () => {
    const zh = everyScreen(base, 'zh', null, ctx);
    expect(zh).toContain(t('zh', 'her.knows.title')); expect(zh).toContain(t('zh', 'her.handles.title'));
    expect(zh).toContain(t('zh', 'her.teach.title'));
    const ar = everyScreen(base, 'ar', null, ctx);
    expect(ar).toContain(t('ar', 'her.knows.title')); expect(ar).toContain(t('ar', 'her.handles.title'));
    expect(ar).toContain('<span class="go" aria-hidden="true">');   // the shell mirrors it
  });

  it('no score, percentage or technical vocabulary — any locale', () => {
    const LATIN = ['ai', 'llm', 'model', 'token', 'api', 'webhook', 'database', 'confidence', 'automation', 'prompt'];
    const CJK = ['模型', '人工智能', '数据库', '置信度', '接口'];
    for (const l of LOCALES) {
      const html = ownerReads(everyScreen(base, l, null, ctx));
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

  it('mobile-first: no tables, and no breakpoint of its own — the shell holds the one', () => {
    const html = everyScreen(base, 'en', null, ctx);
    expect(html).not.toContain('<table');
    // V1 step four: the page carries no stylesheet; its phone rules live in the shell.
    expect(html).not.toContain('<style');
    expect(html).not.toContain('@media');
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
    const html = everyScreen(withCheck, 'en', null);
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
      const html = everyScreen(withCheck, l, null);
      expect(html).toContain('/app/employee/spot-check/s1');
      expect(html).toContain('value="好"');       // the wire word parseSpotCheckReply reads
      expect(html).toContain('value="有问题"');
    }
  });

  it('renders nothing at all when there is nothing to check', () => {
    const html = everyScreen(base, 'en', null);
    expect(html).not.toContain('/app/employee/spot-check/');
  });
});

describe('Phase 9 · "Handled without you" lists only what goes out alone today', () => {
  // commitTurn drafts a capability set to auto while the name is unconfirmed
  // or the rung is not earned; the page used to list it as handled anyway,
  // beside a line saying every reply waits.
  const between = (html: string, from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));
  it('name unconfirmed: greet is set, still waiting, with the reason; nothing is handled', () => {
    for (const l of LOCALES) {
      const html = everyScreen({ ...base, assistantNamed: false }, l, null);
      const alone = between(html, t(l, 'her.handles.alone'), '</div></div>');
      expect(alone, l).toContain(t(l, 'employee.duties.none'));
      expect(html, l).toContain(t(l, 'her.handles.held'));
      expect(html, l).toContain(t(l, 'her.handles.held.why.name', { ready: t(l, 'pilot.title') }));
      expect(html, l).not.toContain(t(l, 'employee.promo.done'));
      expect(html, l).toContain(t(l, 'employee.stage.probation'));
    }
  });
  it('a rung not earned holds it the same way', () => {
    const html = everyScreen({ ...base, earned: false }, 'en', null);
    expect(html).toContain(t('en', 'her.handles.held'));
    expect(html).toContain(t('en', 'her.handles.held.why.ramp'));
    expect(html).not.toContain(t('en', 'employee.promo.done'));
  });
  it('named and earned: greet is handled, and nothing is listed as held', () => {
    const html = everyScreen(base, 'en', null);
    expect(html).not.toContain(t('en', 'her.handles.held'));
    expect(html).toContain(t('en', 'employee.promo.done'));
  });
});

/* ── Phase 9 · B5 — the page says what holds it, in plain words ─────────── */

describe('Phase 9 · B5 · Your assistant: what is in force, what holds it, in plain words', () => {
  const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]*>/g, ' ');
  // The audit's workspace: greet and qualify set to go alone, the rest waiting, no level matching, name unconfirmed.
  const mix: EmployeeProfile = {
    ...base, assistantNamed: false, canDo: ['greet', 'qualify'], needConfirm: ['recommend', 'quote', 'negotiate', 'follow_up'],
    capabilities: [
      { capability: 'greet', mode: 'auto', promotable: false }, { capability: 'qualify', mode: 'auto', promotable: false },
      { capability: 'recommend', mode: 'draft', promotable: false }, { capability: 'quote', mode: 'draft', promotable: false },
      { capability: 'negotiate', mode: 'draft', promotable: false }, { capability: 'follow_up', mode: 'draft', promotable: false },
    ],
    growth: [
      { kind: 'revoke', capability: 'quote', at: new Date('2026-09-30T00:00:00Z') },
      { kind: 'spotcheck_improve', capability: null, at: new Date('2026-09-29T00:00:00Z') },
    ],
  };
  const quiet = { taughtRecently: 0, corrected: 0, handled: 0, draftsPrepared: 2, neededYou: 0, gaps: [] };

  it('V1-418 · no level matches: the page says which kinds are set to go alone, above the choices', () => {
    for (const l of LOCALES) {
      const html = renderEmployee(mix, l, null, quiet);
      const said = t(l, 'autonomy.mixed', { list: new Intl.ListFormat(l, { type: 'conjunction' }).format([t(l, 'capability.greet'), t(l, 'capability.qualify')]) });
      expect(html, l).toContain(said.replace(/&/g, '&amp;'));
      expect(html.indexOf(said), l).toBeLessThan(html.indexOf('name="level"'));
      expect(html, l).not.toContain('class="muted lnote">' + t(l, 'autonomy.mixed'));
    }
  });

  it('V1-419 · V1-420 · what holds the levels sits above them, with its own door, and names no page', () => {
    for (const l of LOCALES) {
      const html = renderEmployee(mix, l, null, quiet);
      const hold = html.indexOf(t(l, 'autonomy.needsName'));
      expect(hold, l).toBeGreaterThan(-1);
      expect(hold, l).toBeLessThan(html.indexOf('name="level"'));
      expect(html, l).toContain(`href="/app/onboarding">${t(l, 'autonomy.confirmName')}`);
      expect(html.split('href="/app/onboarding"').length - 1, `${l}: one door to confirm the name`).toBe(1);
      expect(html, l).not.toContain(`>${t(l, 'pilot.open')}</a>`);           // the bare "Open"
      expect(visible(html), `${l}: no page called by a name the nav does not use`).not.toContain(t(l, 'pilot.title'));
      // The card is not a second name under the h1. Phase 7 — the card is the
      // Name row's screen; the row says the name is not confirmed, and so does
      // the screen, with its one door to confirm it.
      expect(html, l).not.toContain('emp-name');
      expect(html, l).toContain(t(l, 'her.menu.name.unconfirmed'));
      const named = screen('name', mix, l, quiet);
      expect(named, l).toContain(t(l, 'employee.name.unconfirmed'));
      expect(named.split('href="/app/onboarding"').length - 1, `${l}: one door on the name's screen`).toBe(1);
      expect(named, l).not.toContain('emp-name');
    }
  });

  it('V1-421 · the middle level promises what it sends; the one-kind block says why nothing can be granted yet', () => {
    expect(t('en', 'autonomy.level.talks.note')).toContain('Greetings, questions and recommendations');
    for (const l of LOCALES) {
      const html = screen('one-kind', mix, l, quiet);
      expect(html, l).toContain(t(l, 'employee.actions.more'));
    }
    // With something to grant, the line is not needed.
    expect(screen('one-kind', base, 'en')).not.toContain(t('en', 'employee.actions.more'));
  });

  it('V1-422 · no promotion, probation, grant or spot-check words on the page', () => {
    const OLD: Record<string, readonly string[]> = {
      en: ['Promoted', 'Pulled back', 'Spot-check', 'Promotion', 'Grant &amp; revoke', 'Customer reception', 'Growth', 'Probation', 'is granted'],
      zh: ['晋升', '放权', '成长记录', '正式接待', '试用期', '抽查通过'],
      ar: ['الترقية', 'منح وسحب', 'سجل التطوّر', 'استقبال جزئي', 'فترة تجربة'],
      es: ['Ascenso', 'Conceder y retirar', 'Progreso', 'Periodo de prueba', 'Se concedió'],
      fr: ['Promotion', 'Accorder et retirer', 'Progression', 'Période d’essai'],
    };
    for (const l of LOCALES) {
      const html = everyScreen(mix, l, null, quiet) + everyScreen(probation, l, null) + everyScreen(base, l, null);
      for (const w of OLD[l] ?? []) expect(html.includes(w), `${l}: "${w}"`).toBe(false);
    }
  });

  it('V1-423 · new-10 · replies were prepared, so nobody says no customer asked; the advice to teach is said once', () => {
    for (const l of LOCALES) {
      const html = screen('learning', { ...mix, knows: 0 }, l, quiet);
      expect(html, l).not.toContain(t(l, 'her.teach.unasked'));
      expect(html, l).toContain(t(l, 'her.teach.none'));
      // V1-427 — one door to Knowledge, in the section that is about it.
      // Phase 7 — on the landing that door is its row; here, the Teach door.
      expect(html.split('href="/app/knowledge"').length - 1, l).toBe(1);
      expect(renderEmployee({ ...mix, knows: 0 }, l, null, quiet).split('href="/app/knowledge"').length - 1, l).toBe(1);
      // Nothing came in at all: then it says so.
      const empty = screen('learning', { ...mix, knows: 0 }, l, { ...quiet, draftsPrepared: 0 });
      expect(empty, l).toContain(t(l, 'her.teach.unasked'));
      expect(empty.split('href="/app/knowledge"').length - 1, l).toBe(1);
    }
  });

  it('V1-424 · new-09 · a task is a list line; "always" carries no mark; the history carries none', () => {
    const html = everyScreen(mix, 'en', null, quiet);
    const always = html.slice(html.indexOf(t('en', 'her.handles.always')), html.indexOf('</div>', html.indexOf(t('en', 'her.handles.always')) + 40));
    expect(always).toContain('Confirming orders');
    expect(always).not.toMatch(/[○✓✕]/);
    const growth = html.slice(html.indexOf('<ul class="growth">'), html.indexOf('</ul>', html.indexOf('<ul class="growth">')));
    expect(growth).toContain('Quoting waits for you again');
    expect(growth).not.toMatch(/[○✓✕]/);
    const css = readFileSync(new URL('../../src/api/web/layout.ts', import.meta.url), 'utf8');
    const ditem = css.match(/\n {2}\.ditem \{[^}]*\}/)?.[0] ?? '';
    expect(ditem).not.toContain('border');
    expect(ditem).not.toContain('background');
    // new-10 — the task list keeps the prose measure, like the panels around it.
    expect(css).toMatch(/\n {2}\.dgroup \{[^}]*max-width:var\(--measure-prose\)/);
  });

  it('V1-425 · the rules and the disclosure are at the size of the text around them, in plain words', () => {
    const html = renderEmployee(mix, 'en', null, quiet);
    expect(html).toContain(`<p class="muted small">${t('en', 'autonomy.intro')}</p>`);
    expect(html).toContain(`<p class="muted small disclose">`);
    expect(t('en', 'autonomy.intro')).not.toMatch(/price rules|your rules hold/);
    expect(t('en', 'autonomy.level.sells.note')).not.toMatch(/floor/);
  });

  it('V1-426 · one grammar in the list; the heading is not the first group’s label', () => {
    for (const k of ['neverAllowed.promise_stock', 'neverAllowed.change_payment', 'neverAllowed.promise_leadtime'] as const) {
      expect(t('en', k)).toMatch(/^[A-Z][a-z]+ing\b/);
    }
    for (const l of LOCALES) expect(t(l, 'her.handles.alone'), l).not.toBe(t(l, 'her.handles.title'));
    expect(t('ar', 'her.handles.title')).not.toContain(t('ar', 'her.handles.alone'));
  });

  it('missed-11 · the languages that always wait are said above the levels', () => {
    expect(disclosureAwaitingReview().length).toBeGreaterThan(0);
    for (const l of LOCALES) {
      const html = renderEmployee({ ...mix, assistantNamed: true }, l, null, quiet);
      const said = t(l, 'autonomy.languages', {
        ready: formatList(l, disclosureReviewed().map((x) => languageName(l, x))),
        waiting: formatList(l, disclosureAwaitingReview().map((x) => languageName(l, x))),
      });
      const at = html.indexOf(said);
      expect(at, l).toBeGreaterThan(-1);
      expect(at, l).toBeLessThan(html.indexOf('name="level"'));
    }
  });

  it('missed-12 · V1-432 · each count in the form its language gives the number', () => {
    const ar = everyScreen(mix, 'ar', null, quiet);
    expect(ar).toContain('ردّان جاهزان');
    expect(ar).toContain('لم يُرَدّ على أي عميل');
    expect(ar).not.toContain('عملاء تمّ الردّ عليهم');
    const es = everyScreen(mix, 'es', null, { ...quiet, neededYou: 2 });
    expect(es).toContain('<b class="hnum">2</b> conversaciones necesitaron tu ayuda');
    expect(everyScreen(mix, 'es', null, { ...quiet, neededYou: 1 })).toContain('<b class="hnum">1</b> conversación necesitó tu ayuda');
    // V1-429 — the counts say their span.
    for (const l of LOCALES) expect(t(l, 'her.recent.title'), l).not.toMatch(/Recently|最近|مؤخر|Reciente|Récemment/);
  });

  it('the history never speaks as the assistant ("I went back…"): a step back it made itself says so', () => {
    for (const l of LOCALES) {
      const html = everyScreen({ ...mix, growth: [{ kind: 'self_demote', capability: 'quote', at: new Date('2026-09-30T00:00:00Z'), why: 'repeated_corrections' }] }, l, null, quiet);
      expect(visible(html), l).not.toMatch(/\bI went\b|我退回|عدتُ|volví a preguntarte|je repasse/);
    }
  });

  it('V1-431 · new-13 · missed-14 · the undo is not red; "Now:" takes the colon; no straight quotes', () => {
    for (const l of LOCALES) {
      const html = everyScreen(mix, l, null, quiet);
      expect(html, l).toContain('/revoke" class="actrow">');
      expect(html, l).not.toMatch(/\/revoke" class="actrow">\s*<span>[^<]*<\/span><button class="btn danger"/);
      expect(visible(html), l).not.toMatch(/"|&quot;/);
    }
    expect(everyScreen(probation, 'en', null)).toContain('Now: Every reply waits for you');
    expect(everyScreen(probation, 'es', null)).toContain('Ahora: Cada respuesta te espera');
  });
});
