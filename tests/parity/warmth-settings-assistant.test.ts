import {settingsPageLinks} from '../../src/api/web/settingsArea.js';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sectionSidebar } from '../../src/api/web/sections.js';
import { readFileSync } from 'node:fs';
import {
  renderEmployee, EMPLOYEE_SCREENS, screenHref,
  type EmployeeProfile, type HerContext, type TalkAbout,
} from '../../src/api/web/employee.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, tn, withAssistantName } from '../../src/api/web/say.js';
import { formatList } from '../../src/core/owner/i18n/format.js';
import { languageName } from '../../src/api/web/inbox.js';
import { shell, esc, hubFor, BACK_TO, CONTEXTUAL_ROUTES_BY_HUB } from '../../src/api/web/layout.js';
import { modesFor } from '../../src/core/conversation/autonomyLevel.js';
import { disclosureAwaitingReview, disclosureReviewed } from '../../src/core/conversation/disclosure.js';
import { withoutIsolates } from './isolates.js';
import { linkedCss } from './linked-css.js';
import { screen, namePage } from './employee-screens.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { PERMISSIONS_SAVE } from '../../src/api/web/employee.js';
import { capabilityName } from '../../src/core/owner/i18n/messages.js';
import { BACK } from '../../src/api/web/icons.js';

/**
 * THE WARMTH RUN (2026-10-03), phase 7 — THE SETTINGS MODEL, the assistant's
 * page. The owner: "it reads like a Word document … Convert to the
 * iPhone/Instagram settings pattern: a short, calm menu of rows, each showing
 * its current value, that you tap into … One exception: the control for how
 * much Nomi does alone stays visible on the landing screen."
 *
 * THE SETTINGS OVERHAUL (2026-11-27, rule 104) — the landing is a settings page on the one template now, "Reply
 * permissions": the menu of rows became the Settings menu (the Assistant group) and the Assistant area; the control
 * is still on the page, whole, with the kinds of reply and follow-ups under it and ONE Save. Points 1, 3, 4 and 7
 * below are held for that page; 2 (a menu of rows) is the Settings menu's, held in settings-navigation tests.
 *
 * What this holds, in every language:
 *   1. the control — the three levels and the form that saves them — is on
 *      the landing, whole;
 *   2. everything else on the landing is a menu of rows, each with its value;
 *   3. the landing is no essay: no paragraph outside the control;
 *   4. every former section is one tap away, its words and controls intact;
 *   5. "What {name} can talk about" opens My business's pages and edits
 *      nothing itself (two doors, one data);
 *   6. every screen starts with its way back;
 *   7. rule 1 (the native read), rule 2 (the name) and rule 13 (Stop, and the
 *      operator's pause) are said beside the control whenever they hold.
 */

// Rule 1 can only be shown "not released" with the gate closed: the flag is a
// constant, so the gate is stood in for here — read, never changed, by the page.
const gate = vi.hoisted(() => ({ released: null as boolean | null }));
vi.mock('../../src/core/conversation/disclosure.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/core/conversation/disclosure.js')>();
  return { ...real, autonomyReleased: () => gate.released ?? real.autonomyReleased() };
});
afterEach(() => { gate.released = null; });

const base: EmployeeProfile = {
  knows: 14, assistantNamed: true, spotChecks: [], hireDate: new Date('2026-07-09T00:00:00Z'), stage: 'partial',
  canDo: ['greet'], needConfirm: ['quote', 'negotiate'],
  capabilities: [
    { capability: 'greet', mode: 'auto', promotable: false },
    { capability: 'quote', mode: 'draft', promotable: true },
    { capability: 'negotiate', mode: 'draft', promotable: false },
  ],
  growth: [{ kind: 'promote', capability: 'greet', at: new Date('2026-07-15T00:00:00Z') }],
  promoted: true, conditions: [], products: 24, words: 3,
};
const talks: EmployeeProfile = {
  ...base, capabilities: Object.entries(modesFor('talks')).map(([capability, mode]) => ({ capability, mode, promotable: false })),
};
const check = {
  id: 's1', capability: 'quote', conversationId: 'c1', askedAt: new Date('2026-08-12T02:00:00Z'),
  buyerMessage: 'Can you do 20000 pcs?', reply: 'Yes, 0.38 each.', wasAuto: true,
};
const ctx: HerContext = {
  taughtRecently: 3, corrected: 1, handled: 12, draftsPrepared: 8, neededYou: 2,
  gaps: [{ question: 'Do you ship to Dubai?', count: 4 }],
};
const talk: TalkAbout = {
  finished: false, selling: { answered: 3, total: 8 }, products: { total: 24, names: ['Canvas tote', 'Steel mug', 'Cap'] },
  taught: 5, certs: ['CE', 'food_grade'],
};
const STAFF = { isOwner: false } as const;

const landing = (e: EmployeeProfile, l: (typeof LOCALES)[number], viewer: { isOwner: boolean } = OWNER_VIEW) =>
  withAssistantName('Lily', () => renderEmployee(e, l, null, viewer));

/** The control, whole: the section of the three levels. */
const control = (html: string): string => {
  const at = html.indexOf('<section class="set-sec" id="on-her-own">');
  expect(at, 'the control is on the page').toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</section>', at) + '</section>'.length);
};
/** What stands above the first section: the heading, its one line, and what holds the control (the notices). */
const top = (html: string): string => html.slice(0, html.indexOf('<section class="set-sec"'));
/** A kind's row in the table: from its name to the row's end. */
const kindRow = (html: string, name: string): string => {
  const at = html.indexOf(`<th scope="row"><bdi>${esc(name)}</bdi></th>`);
  expect(at, name).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</tr>', at));
};
const text = (html: string): string => withoutIsolates(html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
/** Sentences, by their end marks in the five languages. */
const sentences = (s: string): number => s.split(/(?<=[.!?。！？؟])\s*/u).filter((x) => /\p{L}/u.test(x)).length;

describe('rule 104 · Reply permissions: the heading, the control, the kinds of reply, follow-ups — and one Save', () => {
  for (const l of LOCALES) {
    it(`${l} · the control is whole on the page: the three levels, the one in force checked, fields of the page's one form`, () => {
      const html = landing(base, l);
      const c = control(html);                                       // id="on-her-own": Today's and the alerts' anchor
      for (const level of ['waits', 'talks', 'sells']) {
        expect(c, `${l}/${level}`).toMatch(new RegExp(`<input type="radio" name="level" value="${level}" form="reply-permissions"`));
        expect(c, `${l}/${level}`).toContain(esc(withAssistantName('Lily', () => t(l, `autonomy.level.${level}` as never))));
        expect(c, `${l}/${level}`).toContain(esc(withAssistantName('Lily', () => t(l, `autonomy.level.${level}.note` as never))));
      }
      // The form the levels belong to is the page's one form; its Save is the page's one Save, at its end.
      expect(html).toContain(`<form method="post" action="${PERMISSIONS_SAVE}" class="set-form" data-save id="reply-permissions">`);
      expect(html.split(`<button class="btn send" type="submit">${esc(t(l, 'autonomy.save'))}</button>`).length - 1, l).toBe(1);
      expect(html.trimEnd().endsWith(`<button class="btn" type="reset">${esc(t(l, 'common.cancel'))}</button></div></form>`), l).toBe(true);
      expect(control(landing(talks, l))).toMatch(/name="level" value="talks" form="reply-permissions" checked/);
      // The level the page was drawn with travels with the form: a Save that leaves it alone does not choose it again.
      expect(control(landing(talks, l))).toContain('<input type="hidden" name="level_was" value="talks" form="reply-permissions" />');
      expect(c).toContain('<input type="hidden" name="level_was" value="" form="reply-permissions" />');
      expect(c).not.toMatch(/name="level" value="[a-z]+" form="reply-permissions" checked/);   // none of the three applies: none is ticked
      // …and it comes first, right under the heading and its line.
      expect(html.trimStart().startsWith(`<h1 class="page">${esc(t(l, 'settingsArea.permissions'))}</h1><p class="lede set-lede">`), l).toBe(true);
      expect(html.indexOf('id="on-her-own"')).toBeLessThan(html.indexOf('id="reply-types"'));
    });

    it(`${l} · every part is in view, in order; each kind of reply is a row with where it stands and its one act`, () => {
      const html = landing({ ...base, spotChecks: [check] }, l);
      expect([...html.matchAll(/<section class="set-sec" id="([^"]+)">/g)].map((m) => m[1])).toEqual(['on-her-own', 'reply-types', 'follow-ups']);
      expect(html, l).not.toContain('<details');
      const cap = (c: string) => capabilityName(l, c);
      // goes out alone: says so, and can be made to wait, asking first
      const greet = kindRow(html, cap('greet'));
      expect(greet, l).toContain(`<span class="pill long ok">${esc(t(l, 'her.handles.alone'))}</span>`);
      expect(greet, l).toContain('<form method="post" action="/app/settings/assistant/capability/greet/revoke" class="set-act">');
      expect(greet, l).toContain(`data-confirm="${esc(t(l, 'employee.actions.revokeConfirm', { cap: cap('greet') }))}"`);
      // waits, and has earned going alone: says so, and the owner may grant it, asking first
      const quote = kindRow(html, cap('quote'));
      expect(quote, l).toContain(`<span class="pill long">${esc(t(l, 'her.handles.waits'))}</span>`);
      expect(withoutIsolates(quote), l).toContain(withoutIsolates(esc(t(l, 'employee.actions.eligible', { cap: cap('quote') }))));
      expect(quote, l).toContain('<form method="post" action="/app/settings/assistant/capability/quote/promote" class="set-act">');
      expect(quote, l).toContain(`data-confirm="${esc(t(l, 'employee.actions.grantConfirm', { cap: cap('quote') }))}"`);
      // waits, not earned: no button, and why
      const negotiate = kindRow(html, cap('negotiate'));
      expect(negotiate, l).not.toContain('<form');
      expect(negotiate, l).toContain(`<span class="as-lock">${esc(t(l, 'as.perm.earned'))}</span>`);
      // the four that always wait: rows too, locked
      for (const kind of [cap('confirm_order'), t(l, 'neverAllowed.promise_stock'), t(l, 'neverAllowed.change_payment'), t(l, 'neverAllowed.promise_leadtime')]) {
        const row = kindRow(html, kind);
        expect(row, `${l}: ${kind}`).toContain(`<span class="pill long stop">${esc(t(l, 'her.handles.always'))}</span>`);
        expect(row, `${l}: ${kind}`).toContain(`<span class="as-lock">${esc(t(l, 'as.perm.locked'))}</span>`);
        expect(row, `${l}: ${kind}`).not.toContain('<form');
      }
      // a setting is never said in the waiting colour (that is for a customer who waits)
      expect(html, l).not.toMatch(/class="(?:pill|sr-value)[^"]*\bwarn\b/);
      // settings only: the work to check is the Assistant area's, not a row here
      expect(html, l).not.toContain('/app/assistant/review');
    });

    it(`${l} · no essay: one line under the heading, short lines of help, and the long explanation is not on the page`, () => {
      const html = landing({ ...base, spotChecks: [check] }, l);
      const lede = /<p class="lede set-lede">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '';
      expect(sentences(text(lede)), l).toBe(1);
      const paragraphs = [...html.matchAll(/<p class="set-help"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => text(m[1]!));
      expect(paragraphs.length, l).toBeGreaterThan(2);
      for (const para of paragraphs) expect(sentences(para), `${l}: "${para}"`).toBeLessThanOrEqual(4);
      for (const k of ['autonomy.intro', 'autonomy.needsName', 'autonomy.disclosure'] as const)
        expect(html, `${l} ${k}`).not.toContain(esc(withAssistantName('Lily', () => t(l, k))));
      for (const h of html.matchAll(/<h2 class="set-h"[^>]*>([\s\S]*?)<\/h2>/g)) expect(sentences(text(h[1]!))).toBe(1);
    });
  }

  it('the rows are 56 high, 64 with a line under the name — the owner\'s numbers', () => {
    const css = linkedCss(shell({ title: 'T', active: 'settings', locale: 'en', path: '/app/settings/assistant', bodyHtml: '' }));
    expect(css).toMatch(/\.srow \{[^}]*min-height:56px/);
    expect(css).toMatch(/a\.srow\.sr-menu:has\(\.sr-desc\)[^{]*\{ min-height:64px; \}/);
  });
});

describe('phase 7 · every former section is still there, its words and controls intact', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const e: EmployeeProfile = { ...base, spotChecks: [check], conditions: [{ cond: 'passed_spotcheck', met: true }, { cond: 'learned_correction', met: false }] };
      const html = landing(e, l);
      const on = (s: Parameters<typeof screen>[0]) => withAssistantName('Lily', () => screen(s, e, l, ctx, undefined, { talk }));
      const menu = sectionSidebar(l, 'settings', '/app/settings/assistant');
      // who it is: the Name and identity page, a row of the Settings menu (staff read the role; the owner its fields)
      expect(menu, l).toContain('href="/app/settings/assistant/name"');
      expect(withAssistantName('Lily', () => namePage(e, l, STAFF))).toContain(esc(t(l, 'employee.role.reception')));
      expect(withAssistantName('Lily', () => namePage(e, l))).toContain('id="identity"');
      // what it knows, and what it still needs (each question to the teach flow)
      expect(on('learning')).toContain(`href="/app/assistant/knowledge">${esc(withAssistantName('Lily', () => t(l, 'knowledge.teach')))}`);
      expect(on('learning')).toContain('href="/app/assistant/knowledge?view=facts&amp;teach=Do%20you%20ship%20to%20Dubai%3F"');
      // what it handles, and one kind at a time — the grant and the undo, each asking first: sections of this page
      expect(html).toContain(esc(t(l, 'her.handles.always')));
      expect(html).toContain('action="/app/settings/assistant/capability/quote/promote"');
      expect(html).toContain('action="/app/settings/assistant/capability/greet/revoke"');
      // its work to check, and the words to answer with
      expect(on('checks')).toContain('action="/app/settings/assistant/spot-check/s1"');
      // the month, what comes next (a line of this page, with what earns it), what changed
      expect(withoutIsolates(on('month'))).toContain('<b class="hnum">12</b>');
      const next = html.slice(html.indexOf('id="progress"'), html.indexOf('</ul>', html.indexOf('id="progress"')));
      expect(next).toContain(esc(t(l, 'employee.promo.current')));
      for (const c of ['passed_spotcheck', 'learned_correction'] as const) expect(next, c).toContain(esc(withAssistantName('Lily', () => t(l, `employee.promo.cond.${c}`))));
      expect(on('history')).toContain('<ul class="growth">');
      // and the pages it always opened: the words to avoid, a section of Promises and words
      expect(menu, l).toContain('href="/app/settings/assistant/promises"');
    });
  }

  it('"check its work" is the Assistant area\'s page; the screen says so when nothing waits', () => {
    expect(landing(base, 'en')).not.toContain('href="/app/assistant/review"');
    expect(screenHref('checks')).toBe('/app/assistant/review');
    expect(screen('checks', base, 'en')).toContain(esc(t('en', 'spotcheck.none')));
  });

  it('the hub links every screen it lists, with daily tools and monthly results in their approved areas', () => {
    // The settings overhaul (2026-11-27, rule 104): the assistant's settings are a group of the ONE Settings area, whose
    // menu page is their hub; the Settings sidebar lists them. Its daily tools stay in the assistant's area; the
    // month is a report.
    const routes = CONTEXTUAL_ROUTES_BY_HUB.find((g) => g.hub === '/app/settings')!.routes.filter((r) => r.startsWith('/app/settings/assistant'));
    expect(routes).toEqual(['/app/settings/assistant', '/app/settings/assistant/name', '/app/settings/assistant/promises']);
    const html = landing(base, 'en') + sectionSidebar('en','settings','/app/settings/assistant');
    for (const r of routes) expect(html, r).toContain(`href="${r}"`);
    const area = (s: (typeof EMPLOYEE_SCREENS)[number]) => s === 'month' ? 'reports' : screenHref(s).startsWith('/app/assistant') ? 'assistant' : 'settings';
    for (const s of EMPLOYEE_SCREENS) expect(hubFor(screenHref(s), 'x'), s).toBe(area(s));
    expect(EMPLOYEE_SCREENS.filter((s) => area(s) === 'assistant')).toEqual(['talk', 'learning', 'checks', 'history']);
  });
});

describe('phase 7 · two doors, one data: what the assistant can talk about', () => {
  for (const l of LOCALES) {
    it(`${l} · read from My business, opened there, edited nowhere here`, () => {
      const html = withAssistantName('Lily', () => screen('talk', base, l, ctx, undefined, { talk }));
      for (const page of ['/app/settings/business/profile', '/app/settings/business/selling', '/app/products', '/app/assistant/knowledge', '/app/settings/assistant/promises']) {
        expect(html, `${l}: ${page}`).toContain(`href="${page}"`);
      }
      expect(html, l).not.toContain('href="/app/settings/business/selling/price"');
      for (const tag of ['<form', '<input', '<textarea', '<select', 'method="post"']) expect(html, `${l}: ${tag}`).not.toContain(tag);
      // summarised: counts and a few names, not the lists themselves
      expect(withoutIsolates(html)).toContain(withoutIsolates(esc(tn(l, 'her.talk.products', 24))));
      expect(html).toContain('Canvas tote · Steel mug · Cap …');
      expect(withoutIsolates(html)).toContain(withoutIsolates(esc(t(l, 'hs.progress', { done: 3, total: 8 }))));
    });
    // The warmth run, phase 9 (w4-products-knowledge-01, -03, -04).
    it(`${l} · everything it answers from: what was taught and what may be claimed too; each row named as its page, the profile's as My business says it`, () => {
      const html = withAssistantName('Lily', () => screen('talk', base, l, ctx, undefined, { talk }));
      const row = (href: string) => [...html.matchAll(/<li(?: id="[^"]*")?>([\s\S]*?)<\/li>/g)].map((m) => m[1]!).find((r) => r.includes(`href="${href}"`)) ?? '';
      expect(row('/app/assistant/knowledge'), l).toContain(esc(withAssistantName('Lily', () => t(l, 'nav.knowledge'))));
      expect(withoutIsolates(row('/app/assistant/knowledge')), l).toContain(withoutIsolates(esc(tn(l, 'knowledge.product.facts', 5))));
      expect(row('/app/settings/assistant/promises'), l).toContain(esc(t(l, 'factory.promise.title')));
      // The names on the line under the row's name, which wraps; never a long value a phone cuts short.
      expect(row('/app/settings/assistant/promises'), l).toContain(`<span class="sr-desc">${esc(t(l, 'claim.CE'))} · ${esc(t(l, 'claim.food_grade'))}</span>`);
      expect(row('/app/settings/assistant/promises'), l).not.toContain('sr-value');
      // The profile says where it stands as My business does — in words, no tone for a setting (w4-business-assistant-02) —
      // and not the business's name again.
      expect(row('/app/settings/business/profile'), l).toContain(`<span class="sr-value"><bdi>${esc(t(l, 'setup.state.toDo'))}</bdi></span>`);
      expect(row('/app/settings/business/profile'), l).not.toContain('sr-desc');
      // Products are called Products, How you sell opens its own menu, as My business's rows do.
      expect(row('/app/products'), l).toContain(`<span class="sr-label">${esc(t(l, 'nav.products'))}</span>`);
      expect(row('/app/settings/business/selling'), l).toContain(`<span class="sr-label">${esc(t(l, 'factory.sellhow.title'))}</span>`);
      // The lede names all five, and never says "only My business".
      expect(t(l, 'her.talk.lede')).not.toMatch(/My business|我的生意|نشاطي التجاري|Mi negocio|Mon activité/);
    });
    it(`${l} · on a phone a value wraps in its column, never cut short`, () => {
      const css = linkedCss(shell({ title: 'T', active: 'settings', locale: l, path: '/app/assistant/knowledge#sources', bodyHtml: '' }));
      expect(css).toContain('@media (max-width: 560px) { .asst-menu.talk .sr-menu .sr-value { white-space:normal; overflow:visible; text-overflow:clip; } }');
      expect(withAssistantName('Lily', () => screen('talk', base, l, ctx, undefined, { talk }))).toContain('<ul class="scard asst-menu talk">');
    });
    it(`${l} · nothing taught and nothing claimed is said as that`, () => {
      const empty = withAssistantName('Lily', () => screen('talk', base, l, ctx, undefined, { talk: { ...talk, taught: 0, certs: [], finished: true } }));
      expect(empty).toContain(esc(t(l, 'knowledge.product.none')));
      expect(empty).toContain(esc(t(l, 'business.value.noneConfirmed')));
      expect(empty).toContain(`<span class="sr-value ok"><bdi>${esc(t(l, 'setup.state.done'))}</bdi></span>`);
    });
  }
  it('in Arabic a product\'s figures ("38x40cm", "500ml") are isolated, so the words around them cannot reorder them', () => {
    const withFigures: TalkAbout = { ...talk, products: { total: 2, names: ['Canvas Tote Bag 38x40cm', 'Thermos 500ml'] } };
    const html = withAssistantName('Lily', () => screen('talk', base, 'ar', ctx, undefined, { talk: withFigures }));
    expect(html).toContain('Canvas Tote Bag \u206838\u2069x\u206840\u2069cm · Thermos \u2068500\u2069ml');
  });
  it('a member of staff reads How you sell, and is sent only where staff may look (its menu), never to the questions', () => {
    const html = screen('talk', base, 'en', ctx, STAFF, { talk });
    expect(html).not.toContain('href="/app/settings/business/selling/price"');
    // How you sell's own menu, which staff may open (the questions on it stay the owner's).
    expect(html).toContain('href="/app/settings/business/selling"');
    expect(html).toContain(esc(t('en', 'factory.sellhow.title')));
    expect(html).toContain(esc(t('en', 'hs.progress', { done: 3, total: 8 })));
  });
});

describe('phase 7 · every screen starts with its way back', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      for (const s of EMPLOYEE_SCREENS) {
        const html = withAssistantName('Lily', () => screen(s, { ...base, spotChecks: [check] }, l, ctx, undefined, { talk }));
        const destination = s === 'month' ? '/app' : ['checks','history','talk','learning'].includes(s) ? '/app/assistant' : '/app/settings/assistant';
        const label = s === 'month' ? t(l, 'split.title') : ['checks','history','talk','learning'].includes(s) ? t(l, 'nav.assistant') : 'Lily';
        expect(html.trimStart().startsWith(`<a class="back" href="${destination}">` + BACK + esc(label) + '</a><h1 class="page">'), `${l}/${s}`).toBe(true);
        expect(html.match(/<h1 /g), `${l}/${s}: one heading`).toHaveLength(1);
      }
      // the pages that were always their own: the shell adds the way back where a page draws none
      const main = (path: string) => { const h = shell({ title: 'x', active: 'settings', locale: l, path, bodyHtml: '<h1 class="page">x</h1>' }); return h.slice(h.indexOf('<main'), h.indexOf('</main>')); };
      expect(main('/app/assistant/knowledge'), l).not.toContain('class="back"');
      // The navigation block (2026-11-25): Words is an entry of the assistant's sidebar, which is its way back.
      expect(BACK_TO['/app/settings/assistant/words']).toBeUndefined();
      expect(main('/app/settings/assistant/words'), l).not.toContain('class="back"');
    });
  }
  it('Practice draws its own, first — its transcript\'s "earlier" link is drawn the same way and would hide the shell\'s', () => {
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(app).toContain('bodyHtml: `<div class="assistant-practice"><h1 class="page">');
  });
});

describe('phase 7 · what holds the control is said on the page, before it (rules 1, 2 and 13)', () => {
  for (const l of LOCALES) {
    it(`${l} · rule 1 — the native read: which languages wait, or that nothing goes out alone yet`, () => {
      expect(disclosureAwaitingReview().length).toBeGreaterThan(0);
      const said = withAssistantName('Lily', () => t(l, 'autonomy.languages', {
        ready: formatList(l, disclosureReviewed().map((x) => languageName(l, x))),
        waiting: formatList(l, disclosureAwaitingReview().map((x) => languageName(l, x))),
      }));
      expect(withoutIsolates(control(landing(base, l)))).toContain(withoutIsolates(esc(said)));
      // The disclosure itself, in one line, is the control's own line of help: on the page, never only in help.
      expect(control(landing(base, l))).toContain(`<p class="set-help">${esc(t(l, 'as.perm.disclosure'))}</p>`);
      gate.released = false;
      expect(top(landing(base, l))).toContain(esc(t(l, 'autonomy.notReleased')));
      expect(withoutIsolates(control(landing(base, l)))).not.toContain(withoutIsolates(esc(said)));
    });

    it(`${l} · rule 2 — the name: until it is confirmed, the hold and its one door`, () => {
      const html = withAssistantName('Lily', () => renderEmployee({ ...base, assistantNamed: false }, l, null));
      const held = top(html);
      expect(held).toContain(esc(t(l, 'her.handles.held.why.name')));
      // V1-420 — the door opens the Name page, where the name is confirmed.
      expect(held).toContain(`<a href="/app/settings/assistant/name">${esc(t(l, 'autonomy.confirmName'))}</a>`);
      // w4-business-assistant-02 — a name not confirmed yet is a setting to finish, not a customer waiting: no waiting colour.
      expect(html).not.toMatch(/class="(?:pill|sr-value)[^"]*\bwarn\b/);
      // Nothing is said to go out alone while it holds.
      expect(html).not.toContain(`>${esc(t(l, 'her.handles.alone'))}</span>`);
      expect(top(landing(base, l))).not.toContain(esc(t(l, 'her.handles.held.why.name')));
    });

    it(`${l} · rule 13 — stopped, or paused by the operator: said first, before the control; Start's door the owner's`, () => {
      const stopped = top(landing({ ...base, stopped: true }, l));
      expect(stopped).toContain(esc(withAssistantName('Lily', () => t(l, 'today.stopped.title'))));
      expect(stopped).toContain(esc(withAssistantName('Lily', () => t(l, 'today.stopped.body'))));
      expect(stopped).toContain('href="/app/settings/assistant/ready#stop"');
      const staff = top(landing({ ...base, stopped: true }, l, STAFF));
      expect(staff).toContain(esc(withAssistantName('Lily', () => t(l, 'today.stopped.title'))));
      expect(staff).not.toContain('href="/app/settings/assistant/ready');
      expect(top(landing({ ...base, silenced: true }, l))).toContain(esc(withAssistantName('Lily', () => t(l, 'today.silenced.title'))));
      // Both at once: the operator's pause is said first.
      const both = top(landing({ ...base, stopped: true, silenced: true }, l));
      expect(both.indexOf(esc(withAssistantName('Lily', () => t(l, 'today.silenced.title'))))).toBeLessThan(both.indexOf(esc(withAssistantName('Lily', () => t(l, 'today.stopped.title')))));
      expect(top(landing(base, l))).not.toContain(esc(withAssistantName('Lily', () => t(l, 'today.stopped.title'))));
    });
  }
});

describe('phase 7 · staff read where things stand; no form that would refuse them', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = landing(base, l, STAFF);
      const c = control(html);
      expect(c).not.toContain('<input');
      expect(c).toContain(esc(t(l, 'staff.ownerDecides')));
      expect(withoutIsolates(c)).toContain(withoutIsolates(esc(withAssistantName('Lily', () => t(l, 'autonomy.inForce.mixed')))));
      // No form, no button, no field anywhere on the page: the kinds and the follow-up rule are read.
      for (const tag of ['<form', '<button', '<input', '<textarea', '<select']) expect(html, `${l} ${tag}`).not.toContain(tag);
      expect(html).toContain(esc(t(l, 'her.handles.always')));
      const named = withAssistantName('Lily', () => namePage(base, l, STAFF));
      for (const tag of ['<form', '<button', '<input']) expect(named, `${l} ${tag}`).not.toContain(tag);
      expect(named).not.toContain('href="/app/settings/people');
      expect(named).not.toContain('href="/app/onboarding"');
    });
  }
  it('a business with several assistants keeps the same page; the owner changes names where they all are (A5)', () => {
    const named = namePage(base, 'en');
    // The text cleanup (2026-11-26, the owner's approval): the list is on this page under one heading, with no link to itself above it.
    expect(named).not.toContain('href="/app/settings/assistant/name#assistants"');
    expect(named).toContain('<section class="set-sec" id="assistants">');
  });
});
