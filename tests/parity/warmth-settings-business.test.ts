import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  renderFactory, renderBusinessScreen, BUSINESS_SCREEN_PATH, BUSINESS_FACTS_PATH, BUSINESS_PRODUCTS_PATH,
  type BusinessScreen, type FactoryView,
} from '../../src/api/web/factory.js';
import {
  renderSetup, renderLanguage, renderProfile, renderTerms, renderSamples, renderClosures, renderRate, type SetupView,
} from '../../src/api/web/settings.js';
import { renderBusinessKind } from '../../src/api/web/businessKind.js';
import { renderPriceRules } from '../../src/api/web/priceRules.js';
import { shell, esc, CONTEXTUAL_ROUTES_BY_HUB, BACK_TO, hubFor } from '../../src/api/web/layout.js';
import { renderChannelScreen, CHANNEL_SCREENS } from '../../src/api/web/channels.js';
import { STEP_LINK } from '../../src/api/web/onboarding.js';
import { withWorkspace, t, type RequestScope } from '../../src/api/web/say.js';
import { setupFrom } from '../../src/db/setup.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { usd } from '../../src/core/types/money.js';
import { SET_UP, FIRST_DAY } from './business-view.js';
import { withoutIsolates } from './isolates.js';

/**
 * THE WARMTH RUN (2026-10-03), phase 7 — THE SETTINGS MODEL, for My business
 * and Setup. The owner: "My business and the agent are currently one long
 * scroll of eight to ten sections of prose each. Setup has the right vibe but
 * the same problem. Convert all three to the iPhone/Instagram settings
 * pattern: a short, calm menu of rows, each showing its current value, that
 * you tap into … Pick one home for channels and remove the other."
 *
 * Held here, in every language: each landing screen is a menu, not an essay;
 * every former section is one tap from it; the channels live on My business
 * and nowhere on Setup; every screen a level down starts with its way back;
 * the facts and the products have one door each, which the assistant's page
 * shares; and the map the walk reads is true of what the pages draw.
 */

const SCOPE: RequestScope = {
  name: 'Lily', several: false, outreach: false, business: 'Yiwu Sunrise Housewares',
  setup: setupFrom({ profile: true, products: true, name: false, channels: true, first_success: false }),
};
const inScope = <T>(fn: () => T): T => withWorkspace(SCOPE, fn);
const SETUP: SetupView = {
  people: 2, alerts: { available: true, phones: 1 }, signIn: { email: 'owner@example.test' },
  billing: { configured: true, exempt: false, status: 'trial' }, dataWaiting: 0,
};

const business = (l: Locale, v: FactoryView = SET_UP, viewer = { isOwner: true }) => inScope(() => withoutIsolates(renderFactory(v, l, null, viewer)));
const screen = (s: BusinessScreen, l: Locale, v: FactoryView = SET_UP, viewer = { isOwner: true }) =>
  inScope(() => withoutIsolates(renderBusinessScreen(s, v, l, null, viewer)));
const setup = (l: Locale, v: SetupView = SETUP) => inScope(() => withoutIsolates(renderSetup(v, l, null)));

/** The menu's rows, as the eye reads them: where each goes, its name, and what it says it is set to now. */
const rowsOf = (html: string) => [...html.matchAll(
  /<(a|div) class="srow sr-menu([^"]*)"(?: href="([^"]+)")?>([^]*?)<\/\1><\/li>/g,
)].map((m) => ({
  href: m[3] ?? null, two: m[2]!.includes('sr-two'),
  label: /<span class="sr-label">([^<]+)<\/span>/.exec(m[4]!)?.[1] ?? '',
  value: /<span class="sr-value[^"]*" dir="auto"><bdi>([^<]+)<\/bdi><\/span>/.exec(m[4]!)?.[1] ?? null,
  icon: m[4]!.includes('<svg class="ni'),
}));

/**
 * Sentences in a paragraph: a full stop, a question or exclamation mark —
 * Latin, Chinese or Arabic — ending a run of words. A number's decimal point
 * is not one.
 */
const sentences = (p: string): number =>
  (p.replace(/<[^>]*>/g, '').trim().match(/[.!?。！？؟](?=\s|$)/g) ?? []).length;

describe('phase 7 · each landing screen is a menu, not an essay', () => {
  for (const l of LOCALES) {
    it(`${l} · My business: two cards of rows, each with its shape and where it stands; no paragraph longer than a sentence`, () => {
      const html = business(l);
      const rows = rowsOf(html);
      expect(rows).toHaveLength(8);
      expect(html.match(/<ul class="scard">/g), l).toHaveLength(2);
      expect(html.match(/<h2 class="sgroup-h"/g), l).toHaveLength(2);
      for (const r of rows) {
        expect(r.icon, `${l} ${r.label}`).toBe(true);
        expect(r.value, `${l} ${r.label}`).not.toBeNull();
      }
      for (const p of html.match(/<p\b[^>]*>[^]*?<\/p>/g) ?? []) expect(sentences(p), `${l}: ${p}`).toBeLessThanOrEqual(1);
      // nothing of the old scroll: no section of prose, no sub-heading, no form
      for (const gone of ['class="fblock"', '<h3', '<form', 'class="fnever"', 'class="frules"']) expect(html, `${l} ${gone}`).not.toContain(gone);
    });

    it(`${l} · Setup: two cards of rows, values and no lines under them; no search, no switch, no log out`, () => {
      const html = setup(l);
      const rows = rowsOf(html);
      expect(rows).toHaveLength(8);
      expect(html.match(/<ul class="scard">/g), l).toHaveLength(2);
      for (const r of rows) {
        expect(r.icon, `${l} ${r.label}`).toBe(true);
        expect(r.two, `${l} ${r.label}: a line under a row its value already says`).toBe(false);
        expect(r.value, `${l} ${r.label}`).not.toBeNull();
      }
      expect(html).not.toMatch(/<p\b/);
      for (const gone of ['role="search"', 'class="langsw"', 'action="/logout"']) expect(html, `${l} ${gone}`).not.toContain(gone);
    });
  }

  it('a row is 56 px, 64 px with a line under its name; the value stays on its line on a phone', () => {
    const css = readFileSync(new URL('../../src/api/web/layout.ts', import.meta.url), 'utf8');
    expect(css).toMatch(/\.srow \{ display:flex; align-items:center; gap:var\(--space-12\); min-height:56px;/);
    expect(css).toContain('.srow.sr-two { min-height:64px; }');
    // a row with a line carries the class; one without does not
    const rows = rowsOf(business('en', FIRST_DAY));
    expect(rows.find((r) => r.href === BUSINESS_PRODUCTS_PATH)?.two).toBe(true);
    expect(rows.find((r) => r.href === BUSINESS_SCREEN_PATH.how)?.two).toBe(false);
  });
});

describe('phase 7 · every former section is one tap from the landing', () => {
  // My business's eight sections (and the profile's, products' and price
  // limits' pages, which were its doors): each is a row's destination now.
  const FORMER_BUSINESS: readonly [string, string][] = [
    ['factory.about.title', BUSINESS_FACTS_PATH], ['business.kind.label', '/app/settings/business'],
    ['factory.sell.title', BUSINESS_PRODUCTS_PATH], ['factory.promise.title', BUSINESS_SCREEN_PATH.promises],
    ['factory.prices.title', '/app/business/prices'], ['factory.sellhow.title', BUSINESS_SCREEN_PATH.how],
    ['factory.reach.title', BUSINESS_SCREEN_PATH.channels], ['business.row.live', BUSINESS_SCREEN_PATH.ready],
  ];
  const FORMER_SETUP = ['/app/guide', '/app/onboarding', '/app/settings/alerts', '/app/settings/language',
    '/app/settings/people', '/app/settings/account', '/app/settings/billing', '/app/settings/data'];

  for (const l of LOCALES) {
    it(`${l} · My business and Setup`, () => {
      const b = rowsOf(business(l)).map((r) => r.href);
      for (const [section, href] of FORMER_BUSINESS) expect(b, `${l} ${section}`).toContain(href);
      const s = rowsOf(setup(l)).map((r) => r.href);
      for (const href of FORMER_SETUP) expect(s, `${l} ${href}`).toContain(href);
    });
  }

  it('the prose and the controls moved a level down, unchanged in substance', () => {
    for (const l of LOCALES) {
      const say = (k: Parameters<typeof t>[1], p?: Record<string, string | number>) => inScope(() => esc(withoutIsolates(t(l, k, p))));
      // promises: the guard's allowlist and the rule that holds without it
      expect(screen('promises', l), l).toContain(say('factory.promise.never'));
      // going live: the answer (Instagram answers already), the Stop on every
      // channel, WhatsApp's switch, what answers elsewhere, the checks
      const ready = screen('ready', l);
      for (const k of ['factory.ready.answer.live', 'assistant.stop.running', 'activation.stillDrafts', 'golive.other.stopHow', 'pilot.title'] as const)
        expect(ready, `${l} ${k}`).toContain(say(k));
      expect(ready).toContain('action="/app/business/stop-assistant"');
      expect(ready).toContain('action="/app/business/activate"');
      // the channels: each place, its state, the alerts
      const reach = screen('channels', l);
      expect(reach, l).toContain(say('channel.state.ready.hint'));
      // the alert number, as it stands (its own screen holds the form)
      expect(reach, l).toContain('971500001111');
      expect(reach, l).toContain('href="/app/channels/alerts"');
      // who may be messaged: the note, the list, the form
      const list = screen('allowlist', l);
      expect(list, l).toContain(say('allowlist.note'));
      expect(list).toContain('action="/app/business/allowlist/add"');
      // how you sell: the questions, then the same facts directly
      expect(screen('how', l), l).toContain(say('factory.sellhow.direct'));
    }
  });

  it('rule 13 · the Stop is one tap from the landing, which says when it is pulled', () => {
    const stopped: FactoryView = { ...SET_UP, readiness: { ...SET_UP.readiness, assistantStop: { stoppedAt: new Date('2026-10-01T09:00:00Z'), stoppedBy: 'owner' } } };
    for (const l of LOCALES) {
      const row = rowsOf(business(l, stopped)).find((r) => r.href === BUSINESS_SCREEN_PATH.ready)!;
      expect(row.value, l).toBe(inScope(() => t(l, 'business.live.stopped')));
      const ready = screen('ready', l, stopped);
      expect(ready).toContain('action="/app/business/start-assistant"');
      expect(ready, l).toContain(inScope(() => esc(withoutIsolates(t(l, 'assistant.stop.stopped')))));
    }
  });

  it('rule 11 · a sales assistant reads every value, and is offered no form that refuses them', () => {
    const staff = { isOwner: false };
    for (const l of LOCALES) {
      const rows = rowsOf(business(l, SET_UP, staff));
      expect(rows, l).toHaveLength(8);
      const prices = rows.find((r) => r.label === inScope(() => esc(t(l, 'factory.prices.title'))))!;
      expect(prices.href, l).toBeNull();
      expect(prices.value, l).not.toBeNull();
      const all = [business(l, SET_UP, staff), ...(['channels', 'allowlist', 'ready', 'promises', 'how'] as const).map((s) => screen(s, l, SET_UP, staff))].join('');
      expect(all, l).not.toMatch(/action="\/app\/business\/(activate|deactivate|stop-assistant|start-assistant|allowlist\/add|allowlist\/remove|pilot\/end|pilot\/resume)"/);
      expect(all, l).not.toContain('href="/app/business/prices"');
      expect(all, l).not.toContain('href="/app/business/selling"');
      expect(all, l).toContain(inScope(() => esc(t(l, 'staff.ownerDecides'))));
    }
  });
});

describe('phase 7 · the channels have ONE home: My business', () => {
  for (const l of LOCALES) {
    it(`${l} · on My business, a row with the places that answer, opening their screen; on Setup, nothing`, () => {
      const row = rowsOf(business(l)).find((r) => r.href === BUSINESS_SCREEN_PATH.channels)!;
      expect(row.label).toBe(inScope(() => esc(t(l, 'factory.reach.title'))));
      expect(row.value).toBe(`${inScope(() => t(l, 'reach.channel.whatsapp'))} · ${inScope(() => t(l, 'reach.channel.instagram'))}`);
      // Phase 9 (w4-business-assistant-05) — a row per channel, each opening its own screen once.
      for (const s of CHANNEL_SCREENS) expect(screen('channels', l).split(`href="/app/channels/${s}"`).length - 1, `${l} ${s}`).toBe(1);
      const s = setup(l);
      for (const gone of ['href="/app/channels"', `href="${BUSINESS_SCREEN_PATH.channels}"`, `>${inScope(() => esc(t(l, 'nav.channels')))}<`])
        expect(s, `${l} ${gone}`).not.toContain(gone);
    });
  }

  it('Setup’s channels step, Getting started’s and Today’s open the same screen', () => {
    expect(STEP_LINK.channels).toBe(BUSINESS_SCREEN_PATH.channels);
    // w4-business-assistant-03 — on My business itself the step is its row, never a second door above it.
    expect(business('en', { ...FIRST_DAY, nextStep: 'channels' })).not.toContain('class="deeper next"');
    expect(business('en', { ...FIRST_DAY, nextStep: 'channels' })).toContain(`href="${BUSINESS_SCREEN_PATH.channels}"`);
  });
});

describe('phase 7 · every screen a level down starts with its way back', () => {
  const backs: Record<BusinessScreen, string> = {
    channels: '/app/business', allowlist: BUSINESS_SCREEN_PATH.channels, ready: '/app/business', promises: '/app/business', how: '/app/business',
  };
  for (const l of LOCALES) {
    it(`${l} · My business's screens, and the pages its rows open`, () => {
      for (const [s, href] of Object.entries(backs) as [BusinessScreen, string][]) {
        const html = screen(s, l).trimStart();
        expect(html.startsWith(`<a class="back" href="${href}">`), `${l} ${s}`).toBe(true);
        expect(html.indexOf('<h1 class="page">'), `${l} ${s}: the heading under it`).toBeGreaterThan(0);
        expect(html.match(/<h1 /g), `${l} ${s}: one heading`).toHaveLength(1);
      }
      const from = (html: string, href: string) => expect(withoutIsolates(html).trimStart().startsWith(`<a class="back" href="${href}">`), `${l} → ${href}`).toBe(true);
      inScope(() => {
        from(renderProfile(SET_UP.profile, l, null), '/app/business');
        from(renderBusinessKind({ kind: 'manufacturer', country: 'CN', website: null }, l, null, t(l, 'nav.factory')), '/app/business');
        from(renderPriceRules(SET_UP.prices, l), '/app/business');
        from(renderTerms({ terms: null }, l, null), BUSINESS_SCREEN_PATH.how);
        from(renderSamples({ policy: null, waiting: [] }, l, null, new Date()), BUSINESS_SCREEN_PATH.how);
        from(renderClosures({ closures: [] }, l, null), BUSINESS_SCREEN_PATH.how);
        from(renderRate({ current: null, previous: [], pair: { from: 'USD', to: 'CNY' }, currency: 'USD' }, l, null), BUSINESS_SCREEN_PATH.how);
        from(renderLanguage(l), '/app/settings/setup');
      });
    });
  }

  it('the products list, which draws none, gets its own from the shell; each channel’s screen draws its own, to the channels’ home', () => {
    expect(BACK_TO['/app/products']).toEqual({ href: '/app/business', label: 'nav.factory' });
    const html = inScope(() => shell({ title: 'x', active: 'settings', locale: 'en', path: '/app/products', bodyHtml: '<h1 class="page">x</h1>' }));
    expect(html).toContain('<a class="back" href="/app/business">');
    // Phase 9 (w4-business-assistant-07) — no screen is named like the one above it.
    expect(BACK_TO['/app/channels']).toBeUndefined();
    for (const s of CHANNEL_SCREENS) {
      const page = inScope(() => renderChannelScreen(s, { whatsapp: { kind: 'whatsapp', connected: false, status: 'not_connected', healthOk: false,
        displayId: null, lastActivityAt: null, problem: null, activated: false }, ownerPhone: null, templateState: 'none', outreach: new Map(), domain: null }, 'en', null));
      expect(page.startsWith(`<a class="back" href="${BUSINESS_SCREEN_PATH.channels}">`), s).toBe(true);
      expect(page, s).not.toContain(`<h1 class="page">${esc(t('en', 'factory.reach.title'))}</h1>`);
    }
  });
});

describe('phase 7 · two doors, one data', () => {
  it('the business’s facts and its products are edited in ONE place each, which the assistant’s page links to', () => {
    expect(BUSINESS_FACTS_PATH).toBe('/app/settings/profile');
    expect(BUSINESS_PRODUCTS_PATH).toBe('/app/products');
    const rows = rowsOf(business('en'));
    expect(rows[0]!.href).toBe(BUSINESS_FACTS_PATH);
    expect(rows.find((r) => r.label === 'Products')!.href).toBe(BUSINESS_PRODUCTS_PATH);
    // the profile page is the only form for the facts: no screen of My business repeats a field of it
    for (const s of ['channels', 'allowlist', 'ready', 'promises', 'how'] as const)
      expect(screen(s, 'en'), s).not.toMatch(/name="(description|location|working_hours|contact_email|contact_phone)"/);
    // and both light My business's place in the rail, wherever they are opened from
    for (const path of [BUSINESS_FACTS_PATH, BUSINESS_PRODUCTS_PATH, '/app/products/abc', ...Object.values(BUSINESS_SCREEN_PATH)])
      expect(hubFor(path, 'none'), path).toBe('settings');
  });
});

describe('phase 7 · the map the walk reads is true of what the pages draw', () => {
  // The integration walk (boot.test.ts) opens each hub and asserts it links to
  // every route the map names under it. The same, for the hubs this phase drew,
  // without a database: the owner's view of a business that sells in dollars
  // from China (so the rate has something to convert, as the walk's tenant).
  const drawn: Record<string, string> = {
    '/app/business': business('en'),
    [BUSINESS_SCREEN_PATH.how]: screen('how', 'en'),
    [BUSINESS_SCREEN_PATH.channels]: screen('channels', 'en'),
    '/app/settings/setup': setup('en'),
  };
  for (const [hub, html] of Object.entries(drawn)) {
    it(`${hub} links to every route the map names under it`, () => {
      const routes = CONTEXTUAL_ROUTES_BY_HUB.find((g) => g.hub === hub)?.routes ?? [];
      expect(routes.length, hub).toBeGreaterThan(0);
      for (const r of routes) expect(html, `${r} must stay linked from ${hub}`).toContain(`href="${r}"`);
    });
  }

  it('the rate row is there only where something converts, as before', () => {
    expect(screen('how', 'en', { ...SET_UP, connection: { ...SET_UP.connection, country: 'US' } })).not.toContain('href="/app/settings/rate"');
    expect(screen('how', 'en', { ...SET_UP, prices: { ...SET_UP.prices, currency: 'CNY' } })).not.toContain('href="/app/settings/rate"');
  });

  it('How you sell says what each of its rows is set to now', () => {
    const rows = rowsOf(screen('how', 'en'));
    expect(rows.map((r) => r.value)).toEqual([
      '3 of 8 answered', 'FOB · 30% deposit, balance before shipping', 'Free',
      `Spring Festival · ${inScope(() => t('en', 'closures.range', { from: 'Mon, Feb 1', to: 'Wed, Feb 10' }))}`, '1 USD = 7.1 CNY',
    ]);
    const empty = rowsOf(screen('how', 'en', FIRST_DAY, { isOwner: true }));
    expect(empty.map((r) => r.value)).toEqual(['0 of 9 answered', 'Not set up', 'Not set up', 'None planned']);
    const waiting = rowsOf(screen('how', 'en', { ...SET_UP, menu: { ...SET_UP.menu!, samples: { price: usd(5), waiting: 2 } } }));
    expect(waiting.find((r) => r.href === '/app/settings/samples')!.value).toBe('2 requests waiting');
  });
});
