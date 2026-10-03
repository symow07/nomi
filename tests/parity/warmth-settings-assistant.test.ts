import { describe, it, expect, vi, afterEach } from 'vitest';
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
import { screen } from './employee-screens.js';

/**
 * THE WARMTH RUN (2026-10-03), phase 7 — THE SETTINGS MODEL, the assistant's
 * page. The owner: "it reads like a Word document … Convert to the
 * iPhone/Instagram settings pattern: a short, calm menu of rows, each showing
 * its current value, that you tap into … One exception: the control for how
 * much Nomi does alone stays visible on the landing screen."
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
  business: 'Atlas Trading', given: ['description', 'location', 'workingHours'],
  selling: { answered: 3, total: 8 }, products: { total: 24, names: ['Canvas tote', 'Steel mug', 'Cap'] },
};
const STAFF = { isOwner: false } as const;

const landing = (e: EmployeeProfile, l: (typeof LOCALES)[number], viewer?: { isOwner: boolean }) =>
  withAssistantName('Lily', () => renderEmployee(e, l, null, ctx, viewer));

/** The control, whole: the one section that is not a menu. */
const control = (html: string): string => {
  const at = html.indexOf('<section class="block level-control"');
  expect(at, 'the control is on the landing').toBeGreaterThan(-1);
  return html.slice(at, html.indexOf('</section>', at) + '</section>'.length);
};
const outside = (html: string): string => html.replace(control(html), '');
const rows = (html: string): string[] => [...outside(html).matchAll(/<li(?: id="[^"]*")?>([\s\S]*?)<\/li>/g)].map((m) => m[1]!);
const text = (html: string): string => withoutIsolates(html.replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
/** Sentences, by their end marks in the five languages. */
const sentences = (s: string): number => s.split(/(?<=[.!?。！？؟])\s*/u).filter((x) => /\p{L}/u.test(x)).length;

describe('phase 7 · the landing: the name, the control, the menu', () => {
  for (const l of LOCALES) {
    it(`${l} · the control is whole on the landing: the three levels, the one in force checked, the form posting where it did`, () => {
      const c = control(landing(base, l));
      expect(c).toContain('id="on-her-own"');                        // Today's and the alerts' anchor
      expect(c).toContain('<form method="post" action="/app/employee/autonomy" class="levels">');
      for (const level of ['waits', 'talks', 'sells']) {
        expect(c, `${l}/${level}`).toMatch(new RegExp(`<input type="radio" name="level" value="${level}"`));
        expect(c, `${l}/${level}`).toContain(esc(withAssistantName('Lily', () => t(l, `autonomy.level.${level}` as never))));
        expect(c, `${l}/${level}`).toContain(esc(withAssistantName('Lily', () => t(l, `autonomy.level.${level}.note` as never))));
      }
      expect(c).toContain(`<button class="btn send" type="submit">${esc(t(l, 'autonomy.save'))}</button>`);
      expect(control(landing(talks, l))).toMatch(/name="level" value="talks" checked/);
      // …and it comes before the menu, right under the name.
      const html = landing(base, l);
      expect(html.trimStart().startsWith('<h1 class="page">Lily</h1>'), l).toBe(true);
      expect(html.indexOf('level-control')).toBeLessThan(html.indexOf('class="sgroup"'));
    });

    it(`${l} · the rest is a menu: rows in labelled groups, each its shape, its name, where it stands, and the door`, () => {
      const html = landing({ ...base, spotChecks: [check] }, l);
      expect(outside(html).match(/<section class="sgroup"/g)).toHaveLength(3);
      const all = rows(html);
      expect(all.length, l).toBeGreaterThanOrEqual(11);
      for (const r of all) {
        expect(r, `${l}: ${text(r)}`).toMatch(/^<a class="srow sr-menu" href="\/app\/[^"]+"><svg class="ni[^"]*"[^>]*aria-hidden="true"/);
        expect(r).toContain('<span class="sr-label">');
        expect(r).toMatch(/<span class="go" aria-hidden="true">›<\/span><\/a>$/);
        // every row says where it stands — a value, or (Practice) the line under its name
        expect(r.includes('<span class="sr-value') || r.includes('<span class="sr-desc">'), `${l}: ${text(r)}`).toBe(true);
      }
      // a short value at the row's end; where it stands as a sentence, the line under the name (never a value cut short)
      const row = (href: string) => all.find((r) => r.startsWith(`<a class="srow sr-menu" href="${href}"`)) ?? '';
      for (const href of ['/app/employee/talk', '/app/knowledge', '/app/employee/learning', '/app/settings/forbidden',
        '/app/employee/name', '/app/employee/checks', '/app/employee/history']) expect(row(href), `${l}: ${href}`).toContain('<span class="sr-value');
      for (const href of ['/app/employee/replies', '/app/employee/one-kind', '/app/sandbox', '/app/employee/month', '/app/employee/next'])
        expect(row(href), `${l}: ${href}`).toContain('<span class="sr-desc">');
      // a waiting thing is said in the waiting colour, with its shape (the stylesheet draws ○ before .sr-value.warn)
      expect(html).toMatch(/href="\/app\/employee\/checks">[\s\S]*?<span class="sr-value warn">/);
      expect(html).toMatch(/href="\/app\/employee\/learning">[\s\S]*?<span class="sr-value warn">/);
    });

    it(`${l} · no essay on the landing: no paragraph outside the control, and each row one line`, () => {
      const html = landing({ ...base, spotChecks: [check] }, l);
      expect(outside(html), l).not.toMatch(/<p[\s>]/);
      for (const r of rows(html)) {
        const words = [...r.matchAll(/<span class="sr-(?:label|desc)">([\s\S]*?)<\/span>/g)].map((m) => text(m[1]!));
        for (const w of words) expect(sentences(w), `${l}: "${w}"`).toBeLessThanOrEqual(1);
      }
      for (const h of outside(html).matchAll(/<h2 class="sgroup-h"[^>]*>([\s\S]*?)<\/h2>/g)) expect(sentences(text(h[1]!))).toBe(1);
    });
  }

  it('the rows are 56 high, 64 with a line under the name — the owner\'s numbers', () => {
    const css = linkedCss(shell({ title: 'T', active: 'employee', locale: 'en', path: '/app/employee', bodyHtml: '' }));
    expect(css).toMatch(/\.srow \{[^}]*min-height:56px/);
    expect(css).toMatch(/a\.srow\.sr-menu:has\(\.sr-desc\)[^{]*\{ min-height:64px; \}/);
  });
});

describe('phase 7 · every former section, one tap away, its words and controls intact', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const e: EmployeeProfile = { ...base, spotChecks: [check], conditions: [{ cond: 'passed_spotcheck', met: true }, { cond: 'learned_correction', met: false }] };
      const html = landing(e, l);
      const on = (s: Parameters<typeof screen>[0]) => {
        expect(html, `${l}: the landing opens ${s}`).toContain(`href="${screenHref(s)}"`);
        return withAssistantName('Lily', () => screen(s, e, l, ctx, undefined, { talk }));
      };
      // who it is: the card — stage, role, since when
      expect(on('name')).toContain(esc(t(l, 'employee.role.reception')));
      // what it knows, and what it still needs (each question to the teach flow)
      expect(on('learning')).toContain(esc(withAssistantName('Lily', () => t(l, 'her.knows.title'))));
      expect(on('learning')).toContain('href="/app/knowledge?teach=Do%20you%20ship%20to%20Dubai%3F"');
      // what it handles
      expect(on('replies')).toContain(esc(t(l, 'her.handles.always')));
      // one kind at a time — the grant and the undo, each asking first
      expect(on('one-kind')).toContain('action="/app/employee/capability/quote/promote"');
      expect(on('one-kind')).toContain('action="/app/employee/capability/greet/revoke"');
      // its work to check, and the words to answer with
      expect(on('checks')).toContain('action="/app/employee/spot-check/s1"');
      // the month, what comes next, what changed
      expect(withoutIsolates(on('month'))).toContain('<b class="hnum">12</b>');
      expect(on('next')).toContain(esc(t(l, 'employee.promo.current')));
      expect(on('history')).toContain('<ul class="growth">');
      // and the pages it always opened, each a row of its own
      for (const page of ['/app/knowledge', '/app/settings/forbidden', '/app/sandbox']) expect(html, `${l}: ${page}`).toContain(`href="${page}"`);
    });
  }

  it('"check its work" is a row only while something waits; the screen says so when nothing does', () => {
    expect(landing(base, 'en')).not.toContain('href="/app/employee/checks"');
    expect(screen('checks', base, 'en')).toContain(esc(t('en', 'spotcheck.none')));
  });

  it('the map the integration walk reads is true: the hub links every screen it lists, and each lights the assistant', () => {
    const routes = CONTEXTUAL_ROUTES_BY_HUB.find((g) => g.hub === '/app/employee')!.routes;
    const html = landing(base, 'en');
    for (const r of routes) expect(html, r).toContain(`href="${r}"`);
    for (const s of EMPLOYEE_SCREENS) expect(hubFor(screenHref(s), 'x'), s).toBe('employee');
  });
});

describe('phase 7 · two doors, one data: what the assistant can talk about', () => {
  for (const l of LOCALES) {
    it(`${l} · read from My business, opened there, edited nowhere here`, () => {
      const html = withAssistantName('Lily', () => screen('talk', base, l, ctx, undefined, { talk }));
      for (const page of ['/app/settings/profile', '/app/business/selling', '/app/products']) expect(html, `${l}: ${page}`).toContain(`href="${page}"`);
      for (const tag of ['<form', '<input', '<textarea', '<select', 'method="post"']) expect(html, `${l}: ${tag}`).not.toContain(tag);
      // summarised: counts and a few names, not the lists themselves
      expect(withoutIsolates(html)).toContain(withoutIsolates(esc(tn(l, 'her.talk.products', 24))));
      expect(html).toContain('Canvas tote · Steel mug · Cap …');
      expect(html).toContain('<bdi>Atlas Trading</bdi>');
      expect(withoutIsolates(html)).toContain(withoutIsolates(esc(t(l, 'hs.progress', { done: 3, total: 8 }))));
    });
  }
  it('in Arabic a product\'s figures ("38x40cm", "500ml") are isolated, so the words around them cannot reorder them', () => {
    const withFigures: TalkAbout = { ...talk, products: { total: 2, names: ['Canvas Tote Bag 38x40cm', 'Thermos 500ml'] } };
    const html = withAssistantName('Lily', () => screen('talk', base, 'ar', ctx, undefined, { talk: withFigures }));
    expect(html).toContain('Canvas Tote Bag \u206838\u2069x\u206840\u2069cm · Thermos \u2068500\u2069ml');
  });
  it('a member of staff reads How you sell, and is not sent to a page that would refuse them', () => {
    const html = screen('talk', base, 'en', ctx, STAFF, { talk });
    expect(html).not.toContain('href="/app/business/selling"');
    expect(html).toContain(esc(t('en', 'hs.title')));
    expect(html).toContain(esc(t('en', 'hs.progress', { done: 3, total: 8 })));
  });
});

describe('phase 7 · every screen starts with its way back', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      for (const s of EMPLOYEE_SCREENS) {
        const html = withAssistantName('Lily', () => screen(s, { ...base, spotChecks: [check] }, l, ctx, undefined, { talk }));
        expect(html.trimStart().startsWith('<a class="back" href="/app/employee"><span class="go" aria-hidden="true">‹</span>Lily</a><h1 class="page">'), `${l}/${s}`).toBe(true);
        expect(html.match(/<h1 /g), `${l}/${s}: one heading`).toHaveLength(1);
      }
      // the pages that were always their own: the shell adds the way back where a page draws none
      const main = (path: string) => { const h = shell({ title: 'x', active: 'employee', locale: l, path, bodyHtml: '<h1 class="page">x</h1>' }); return h.slice(h.indexOf('<main'), h.indexOf('</main>')); };
      expect(main('/app/knowledge'), l).toContain('<a class="back" href="/app/employee">');
      expect(BACK_TO['/app/settings/forbidden']?.href).toBe('/app/employee');
    });
  }
  it('Practice draws its own, first — its transcript\'s "earlier" link is drawn the same way and would hide the shell\'s', () => {
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(app).toContain("bodyHtml: `${back('/app/employee', t(locale, 'nav.employee'))}<h1 class=\"page\">${esc(t(locale, 'nav.sandbox'))}</h1>`");
  });
});

describe('phase 7 · what holds the control is said beside it (rules 1, 2 and 13)', () => {
  for (const l of LOCALES) {
    it(`${l} · rule 1 — the native read: which languages wait, or that nothing goes out alone yet`, () => {
      expect(disclosureAwaitingReview().length).toBeGreaterThan(0);
      const said = withAssistantName('Lily', () => t(l, 'autonomy.languages', {
        ready: formatList(l, disclosureReviewed().map((x) => languageName(l, x))),
        waiting: formatList(l, disclosureAwaitingReview().map((x) => languageName(l, x))),
      }));
      expect(withoutIsolates(control(landing(base, l)))).toContain(withoutIsolates(esc(said)));
      gate.released = false;
      expect(control(landing(base, l))).toContain(esc(t(l, 'autonomy.notReleased')));
    });

    it(`${l} · rule 2 — the name: until it is confirmed, the hold and its one door, and the Name row waits`, () => {
      const html = renderEmployee({ ...base, assistantNamed: false }, l, null, ctx);
      const c = control(html);
      expect(c).toContain(esc(t(l, 'autonomy.needsName')));
      expect(c).toContain(`href="/app/onboarding">${esc(t(l, 'autonomy.confirmName'))}`);
      expect(html).toMatch(new RegExp(`href="/app/employee/name">[\\s\\S]*?<span class="sr-value warn"><bdi>${esc(t(l, 'her.menu.name.unconfirmed'))}</bdi>`));
      expect(control(landing(base, l))).not.toContain(esc(t(l, 'autonomy.needsName')));
    });

    it(`${l} · rule 13 — stopped, or paused by the operator: said first in the control, Start's door the owner's`, () => {
      const stopped = control(landing({ ...base, stopped: true }, l));
      expect(stopped).toContain(esc(withAssistantName('Lily', () => t(l, 'today.stopped.title'))));
      expect(stopped).toContain(esc(withAssistantName('Lily', () => t(l, 'today.stopped.body'))));
      expect(stopped).toContain('href="/app/business"');
      expect(stopped.indexOf('held-all')).toBeLessThan(stopped.indexOf(esc(t(l, 'autonomy.intro'))));
      expect(stopped.indexOf('held-all')).toBeLessThan(stopped.indexOf('name="level"'));
      const staff = control(landing({ ...base, stopped: true }, l, STAFF));
      expect(staff).toContain(esc(withAssistantName('Lily', () => t(l, 'today.stopped.title'))));
      expect(staff).not.toContain('href="/app/business"');
      expect(control(landing({ ...base, silenced: true }, l))).toContain(esc(withAssistantName('Lily', () => t(l, 'today.silenced.title'))));
      expect(control(landing(base, l))).not.toContain('held-all');
    });
  }
});

describe('phase 7 · staff read where things stand; no form that would refuse them', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = landing(base, l, STAFF);
      const c = control(html);
      expect(c).not.toContain('<form');
      expect(c).not.toContain('id="on-her-own"');
      expect(c).toContain(esc(t(l, 'staff.ownerDecides')));
      expect(withoutIsolates(c)).toContain(withoutIsolates(esc(withAssistantName('Lily', () => t(l, 'autonomy.inForce.mixed')))));
      expect(html).not.toContain('<form');
      expect(withAssistantName('Lily', () => screen('one-kind', base, l, ctx, STAFF))).not.toContain('<form');
      const named = withAssistantName('Lily', () => screen('name', base, l, ctx, STAFF));
      expect(named).not.toContain('href="/app/settings/people');
      expect(named).not.toContain('href="/app/onboarding"');
    });
  }
  it('a business with several assistants keeps the same page; the owner changes names where they all are (A5)', () => {
    const named = screen('name', base, 'en', ctx);
    expect(named).toContain(`href="/app/settings/people#assistants">${esc(t('en', 'people.title'))}`);
  });
});
