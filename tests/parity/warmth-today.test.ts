import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { NOTHING_TODAY, greetingFor, renderGreeting, type TodayData, type HandledFace, type HandledWord } from '../../src/api/web/today.js';
import type { ConversationSummary } from '../../src/api/web/inbox.js';
import type { CalendarEntry } from '../../src/db/calendar.js';
import { withWorkspace, t, tn, type RequestScope } from '../../src/api/web/say.js';
import { withZone } from '../../src/api/web/zone.js';
import { shell, esc } from '../../src/api/web/layout.js';
import { cardHref } from '../../src/api/web/faces.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { ASSISTANT_FALLBACK, messages as MESSAGES } from '../../src/core/owner/i18n/messages.js';
import { dayKey, addDays } from '../../src/core/owner/i18n/format.js';
import { setupFrom } from '../../src/db/setup.js';
import { linkedCss } from './linked-css.js';
import { unisolatedFigures } from './isolates.js';
import { agentMark } from '../../src/api/web/agentMark.js';
import { renderInsights, type InsightsData } from '../../src/api/web/insights.js';
import * as show from '../../src/api/web/values.js';

/**
 * THE HOME RUN (2026-10-05) — Today became HOME. The owner: "Rename 'Today' to 'Home' … Home is the RESUME
 * of the whole app: one glance tells the owner where everything stands, and every zone taps through to its
 * full page. Calm by default, work in one tap. It must NEVER look empty … ZONES, top to bottom: 1. Greeting —
 * OPEN on the sand, no card … 2. Quiet divider. 3. What needs you — a CARD with presence … If nothing: a calm
 * one-line reassurance … 4. A TWO-UP GRID on desktop, STACKED on phone: Today's schedule … Recent wins …
 * Lighter cards than zone 3." The tile's weight was the owner's choice (A): warm white on the hairline, no lift.
 *
 * What the warmth run's three zones held still holds inside them (phase 2: who waits, what the assistant
 * handled, the day's figures): every face the profile card's door, the waiting signal's magenta with its
 * mark, the name rule, ink figures, tokens only. Rendered in all five languages.
 */

const NOW = new Date('2026-10-03T09:30:00Z');
const ZONE = 'Asia/Dubai';
const TODAY = dayKey(NOW, ZONE);
const uuid = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

const live: OperationsSnapshot = {
  range: 'today',
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0, deletionAsks: 0, ordersWaiting: 0 },
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'connected', provider: 'meta', live: true }, budget: null, hasAttention: false,
};
const notLive: OperationsSnapshot = { ...live, channel: { status: 'not_configured', provider: 'disabled', live: false } };

const waiting = (i: number, o: Partial<ConversationSummary> = {}): ConversationSummary => ({
  conversationId: uuid(1000 + i), buyer: `Customer ${i}`, country: null, status: 'awaiting', needsAction: true,
  ownership: 'WAITING_HUMAN', heldBy: null, awaitingReview: false, handoffReason: 'human_requested',
  latestMessage: 'Can I speak to someone?', latestAt: new Date('2026-10-03T09:00:00Z'),
  product: { name: null, nameZh: null }, quantity: null, unitPrice: null, ...o,
});
const WORDS: readonly HandledWord[] = ['confirmed', 'quoted', 'answered', 'handed'];
const handledFace = (i: number): HandledFace => ({
  conversationId: uuid(2000 + i), clientId: uuid(3000 + i), name: i % 7 === 0 ? null : `Buyer ${i}`,
  photo: i % 3 === 0 ? `v${i}` : null, word: WORDS[i % WORDS.length]!,
});
const handled = (n: number): NonNullable<TodayData['handled']> =>
  ({ total: n, people: Array.from({ length: Math.min(n, 60) }, (_, i) => handledFace(i + 1)) });

/** Several waiting: seven in all, the card names the first five (the Inbox's order). */
const SEVERAL: TodayData['needs'] = {
  total: 7,
  rows: [1, 2, 3, 4, 5].map((i) => waiting(i, i === 2 ? { ownership: 'AI', awaitingReview: true, handoffReason: null } : {})),
  faces: Object.fromEntries([1, 2, 3, 4, 5].map((i) => [uuid(1000 + i), { clientId: uuid(4000 + i), name: `Customer ${i}`, photo: null }])),
};
const AHMED = { id: '11111111-1111-4111-8111-111111111111', name: 'Ahmed', country: 'AE' };
const at = (day: string, hm: string): Date => new Date(`${day}T${hm}:00+04:00`);
const date = (x: Partial<CalendarEntry> & Pick<CalendarEntry, 'category' | 'kind' | 'at' | 'source'>): CalendarEntry => ({
  day: dayKey(x.at, ZONE), allDay: false, conversationId: uuid(5000), orderId: null, buyer: AHMED, identity: null, detail: {}, ...x,
});
const REPLY_TODAY = date({ category: 'negotiation', kind: 'reply_due', at: at(TODAY, '16:00'), source: { table: 'handoffs', id: 'h1', column: 'sla_deadline_at' } });
const OWN_LATER = date({ category: 'yours', kind: 'own', at: at(addDays(TODAY, 2), '10:00'), conversationId: null, buyer: null,
  detail: { title: 'Trade fair', entryId: '99999999-9999-4999-8999-999999999999' }, source: { table: 'calendar_entries', id: 'o1', column: 'starts_at' } });

const day = (n: number, needs: TodayData['needs'] = { total: 0, rows: [] }, o: Partial<TodayData> = {}): TodayData => ({
  ...NOTHING_TODAY(NOW), needs, handled: handled(n), tally: { orders: 3, quotes: 5, afterHours: 4 }, sending: ['instagram'],
  hour: 9, schedule: { today: TODAY, entries: [REPLY_TODAY, OWN_LATER] }, ...o,
});

const scope = (name: string | null): RequestScope => ({ name, several: false, outreach: false, setup: null, zone: ZONE });
const render = (l: Locale, d: TodayData, name: string | null = 'Lily', s: OperationsSnapshot = live): string =>
  withZone(ZONE, () => withWorkspace(scope(name), () => renderOperationsHome(s, l, d)));
/** A zone: from its section's label to the section's end. */
const zone = (html: string, id: 'home-hi' | 'today-now' | 'home-schedule' | 'today-done'): string => {
  const at0 = html.indexOf(`aria-labelledby="${id}"`);
  return at0 < 0 ? '' : html.slice(at0, html.indexOf('</section>', at0));
};
/** The figures, inside the wins' tile. */
const figures = (html: string): string => {
  const at0 = html.indexOf('<h2 id="today-tally"');
  return at0 < 0 ? '' : html.slice(at0, html.indexOf('</div>', at0));
};
const bare = (s: string): string => s.replace(/[\u2066-\u2069\u200e\u200f]/g, '');
const css = linkedCss(withWorkspace(scope(null), () => shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' })));
const ruleOf = (sel: string): string => css.match(new RegExp(`(^|\\n)\\s*${sel.replace(/[.>+()*]/g, (c) => `\\${c}`)} \\{[^}]*\\}`))?.[0] ?? '';

describe('the home run · the rename: Today is Home, the home base, in every language', () => {
  const HOME: Readonly<Record<Locale, string>> = { en: 'Home', zh: '首页', ar: 'الرئيسية', es: 'Inicio', fr: 'Accueil' };

  it('the nav, the page\'s name and the way back say it — never the building (家, منزل, بيت)', () => {
    for (const l of LOCALES) {
      expect(t(l, 'nav.home'), l).toBe(HOME[l]);
      expect(t(l, 'ops.title'), l).toBe(HOME[l]);
      expect(t(l, 'error.home'), l).toContain(HOME[l]);
    }
    expect(MESSAGES.zh['nav.home']).not.toMatch(/家/);
    expect(MESSAGES.ar['nav.home']).not.toMatch(/منزل|بيت/);
  });

  it('no message names the page by its old name; "today" the time stays where it means the day', () => {
    const page: Readonly<Record<Locale, RegExp>> = {
      en: /\b(on|to|at) Today\b|Today says|Back to Today/, zh: /「今天」/, ar: /«اليوم»(?! أيضاً)/, es: /\b(en|a) Hoy\b/, fr: /(dans|à|page) Aujourd’hui/,
    };
    for (const l of LOCALES) {
      const said = Object.values(MESSAGES[l] as Record<string, string>).filter((v) => page[l].test(v));
      expect(said, l).toEqual([]);
    }
    // the day itself keeps its word: the calendar's "Today", the handled headline
    expect(t('en', 'calendar.this.day')).toBe('Today');
    expect(MESSAGES.en['today.handled.title.other']).toMatch(/^Today /);
  });

  it('the page keeps its address; the live line asks at Home\'s, and the old one still answers', () => {
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(app).toContain("app.get('/app', authed('home'");
    expect(app).toContain("app.get('/app/live/home', quiet, liveAsk('today'));");
    expect(app).toContain("app.get('/app/live/today', quiet, liveAsk('today'));");
  });

  it('the tab says Home, not the greeting', () => {
    const html = withWorkspace(scope('Lily'), () => shell({ title: t('en', 'nav.home'), active: 'home', locale: 'en', path: '/app',
      bodyHtml: render('en', day(2)) }));
    expect(html).toMatch(/<title>Home · /);
    expect(html).not.toMatch(/<title>Good /);
  });
});

describe('the home run · the zones, top to bottom, in every language', () => {
  for (const l of LOCALES) {
    for (const n of [0, 2, 200]) {
      for (const who of ['nobody', 'several'] as const) {
        it(`${l} · ${n} handled · ${who} waiting: the greeting, what needs you, the schedule, the wins — in that order`, () => {
          const html = render(l, day(n, who === 'several' ? SEVERAL : { total: 0, rows: [] }));
          const order = ['<h1 class="page" id="home-hi"', '<h2 id="today-now"', '<h2 id="home-schedule"', '<h2 id="today-done"'].map((x) => html.indexOf(x));
          expect(order.every((x) => x >= 0), `${order}`).toBe(true);
          expect([...order].sort((a, b) => a - b)).toEqual(order);
          // four zones: the greeting and what needs you down the page, the schedule and the wins two up
          expect(html.match(/<section /g)).toHaveLength(4);
          expect(html).toMatch(/<div class="home-grid"><section class="home-tile home-schedule"[\s\S]*<section class="home-tile home-wins td"/);
          if (l === 'ar') expect(unisolatedFigures(html)).toEqual([]);
        });
      }
    }
  }

  it('the greeting is open on the page, then the section\'s own hairline, then the raised card', () => {
    const html = render('en', day(2));
    expect(html).toMatch(/^<div class="home">\s*<section class="block home-hello"/);
    expect(html).toContain('<section class="block home-now" aria-labelledby="today-now">\n    <div class="home-card');
    expect(ruleOf('.block')).toContain('border-top:1px solid var(--color-border)');
    expect(ruleOf('.block:first-of-type')).toContain('border-top:0');
  });
});

describe('1 · the greeting', () => {
  it('good morning, afternoon or evening by the workspace\'s own hour', () => {
    expect([4, 5, 11, 12, 17, 18, 23].map(greetingFor)).toEqual(['evening', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening']);
    for (const l of LOCALES) {
      expect(zone(render(l, day(2, undefined, { hour: 14 })), 'home-hi'), l).toContain(esc(t(l, 'home.greet.afternoon')));
    }
  });

  it('the date, and the assistant by name — ready for the day only when it is; before then, when it starts; held, nothing', () => {
    for (const l of LOCALES) {
      const ready = zone(render(l, day(2)), 'home-hi');
      expect(ready, l).toContain(withZone(ZONE, () => esc(new Intl.DateTimeFormat(l === 'zh' ? 'zh-CN' : l, { weekday: 'long' }).format(NOW))).slice(0, 2));
      expect(bare(ready), l).toContain(`${agentMark(16, 'am as')} ${bare(esc(t(l, 'home.ready', { name: 'Lily' })))}`);
      expect(bare(zone(render(l, day(2), 'Lily', notLive), 'home-hi')), l).toContain(bare(esc(t(l, 'home.notYet.live', { name: 'Lily' }))));
      expect(bare(zone(render(l, { ...day(2), sending: [] }), 'home-hi')), l).toContain(bare(esc(t(l, 'home.notYet.channel', { name: 'Lily' }))));
      const held = zone(render(l, day(2), 'Lily', { ...live, assistantStoppedAt: NOW }), 'home-hi');
      expect(held, l).not.toContain('home-ready');
    }
    // it is the page's first words, not its name
    expect(renderGreeting(day(2), 'en', { state: 'ready' })).toContain('<h1 class="page" id="home-hi" data-greeting>');
  });

  it('never a pronoun for the assistant, and in Arabic, Spanish and French no word that takes its gender', () => {
    for (const k of ['home.ready', 'home.notYet.live', 'home.notYet.channel'] as const) {
      expect(MESSAGES.en[k]).not.toMatch(/\b(she|her|he|him|his|it)\b/i);
      // "Todo listo" agrees with todo; an adjective after the name would agree with the assistant
      expect(MESSAGES.es[k]).not.toMatch(/\{name\}[^.]*\b(list[ao]s?|preparad[ao]s?)\b/);
      expect(MESSAGES.fr[k]).not.toMatch(/\{name\}[^.]*\b(prête?s?)\b/);
      expect(MESSAGES.ar[k]).not.toMatch(/جاهزة|تبدأ {name}|يبدأ {name}/);
    }
  });
});

describe('2 · what needs you — the raised card', () => {
  it('several: the count in the owner\'s words, the deep shade with its solid mark; five faces that open the card; the name and why a door', () => {
    for (const l of LOCALES) {
      const card = zone(render(l, day(2, SEVERAL)), 'today-now');
      expect(card, l).toContain(`<span class="tw-need"><span class="dot warn shape s-waiting" aria-hidden="true"></span> ${esc(tn(l, 'today.waiting', 7))}</span>`);
      const faces = [...card.matchAll(/<a class="face-link tw-face" href="([^"]+)" data-card aria-label="([^"]+)">/g)];
      expect(faces.map((m) => m[1]), l).toEqual([1, 2, 3, 4, 5].map((i) => cardHref(uuid(4000 + i))));
      expect(faces.map((m) => m[2]), l).toEqual([1, 2, 3, 4, 5].map((i) => `Customer ${i}`));
      for (const i of [1, 2, 3, 4, 5]) expect(card, l).toContain(`<a class="tw-go" href="/app/inbox/${uuid(1000 + i)}#latest">`);
      expect(card, l).toContain(`<span class="tw-why"><bdi>${esc(t(l, 'takeover.reason.human_requested'))}</bdi></span>`);
      expect(card, l).toContain(`<span class="tw-why"><bdi>${esc(t(l, 'buyers.badge.reviewShort'))}</bdi></span>`);
      expect(card, l).toContain(`href="/app/inbox?filter=pending">${esc(tn(l, 'today.needs.all', 7))}`);
      expect(card, l).not.toContain('Can I speak to someone?');
      expect(card, l).toContain('<div class="home-card">');
    }
  });

  it('nobody: ONE calm line — the fact, and the assistant\'s care by name — at the body\'s size, never a headline', () => {
    for (const l of LOCALES) {
      const card = zone(render(l, day(2)), 'today-now');
      expect(card, l).toContain('<div class="home-card is-calm">');
      expect(bare(card), l).toContain(bare(`<h2 id="today-now" class="tw-head home-calm">${esc(t(l, 'today.calm.title'))} <span class="home-care">${agentMark(16, 'am as')} ${esc(t(l, 'today.calm.care', { name: 'Lily' }))}</span></h2>`));
      expect(card, l).not.toContain(esc(t(l, 'today.needs.none')));
      expect(card, l).not.toContain('class="empty"');
      expect(card, l).not.toContain('tw-need');
    }
    expect(ruleOf('main h2.home-calm')).toContain('font-size:var(--font-size-base)');
    expect(ruleOf('.home-card')).toContain('box-shadow:var(--shadow-lift1)');
  });

  it('what Home must still say lives in the card: stopped, a reply that never arrived, a deletion request — and Setup unfinished under it, never inside', () => {
    const s: OperationsSnapshot = { ...live, assistantStoppedAt: NOW, attention: { ...live.attention, blockedMessages: 2, deletionAsks: 1 } };
    const setup = setupFrom({ profile: false, products: true, name: true, channels: true, first_success: false });
    const html = withZone(ZONE, () => withWorkspace({ ...scope('Lily'), setup }, () => renderOperationsHome(s, 'en', day(0))));
    const card = zone(html, 'today-now');
    expect(card).toContain(esc(t('en', 'today.stopped.title', { name: 'Lily' })));
    expect(card).toContain(`href="/app/inbox?filter=blocked">${esc(tn('en', 'today.blocked', 2))}`);
    expect(card).toContain(`href="/app/inbox?filter=deletion">${esc(tn('en', 'today.deletion', 1))}`);
    expect(card).not.toContain('class="today-foot setup"');
    expect(html.indexOf('class="today-foot setup"')).toBeGreaterThan(html.indexOf('</section>', html.indexOf('aria-labelledby="today-now"')));
    expect(card).not.toContain(esc(t('en', 'today.calm.title')));
    expect(html).not.toContain(esc(t('en', 'today.calm.care', { name: 'Lily' })));
    expect(zone(html, 'today-done')).not.toContain(`${agentMark(16, 'am as')} ${esc(t('en', 'home.wins.ahead', { name: 'Lily' }))}`);
    expect(html).not.toContain(esc(t('en', 'home.ready', { name: 'Lily' })));
  });
});

describe('3 · the day\'s schedule — the calendar\'s own rows, every one a door', () => {
  it('today\'s first, drawn as the calendar draws them, under "Today\'s schedule"; a later first says "Coming up"', () => {
    for (const l of LOCALES) {
      const tile = zone(render(l, day(2)), 'home-schedule');
      expect(tile, l).toContain(`<h2 id="home-schedule" class="home-h">${esc(t(l, 'home.schedule.today'))}</h2>`);
      expect(tile.match(/<li class="dl-row /g), l).toHaveLength(2);
      expect(tile, l).toContain('data-src="handoffs:h1"');
      // a door each: the conversation, or — a date with nothing behind it — its day on the calendar; never a remove form
      expect(tile, l).toContain(`<a class="dl-go" href="/app/inbox/${uuid(5000)}#latest">`);
      expect(tile, l).toContain(`<a class="dl-go" href="/app/calendar?month=${addDays(TODAY, 2).slice(0, 7)}&day=${addDays(TODAY, 2)}">`);
      expect(tile, l).not.toContain('<form');
      expect(tile, l).toContain(`href="/app/calendar">${esc(t(l, 'nav.calendar'))}`);
      const later = zone(render(l, day(2, undefined, { schedule: { today: TODAY, entries: [OWN_LATER] } })), 'home-schedule');
      expect(later, l).toContain(esc(t(l, 'home.schedule.next')));
    }
  });

  it('nothing dated ahead: the tile\'s name, ONE small line of what will appear here — never "nothing" — and the door', () => {
    for (const l of LOCALES) {
      const tile = zone(render(l, day(2, undefined, { schedule: { today: TODAY, entries: [] } })), 'home-schedule');
      expect(tile, l).toContain(`<h2 id="home-schedule" class="home-h">${esc(t(l, 'home.schedule.title'))}</h2>`);
      expect(tile, l).toContain(`<p class="home-how">${esc(t(l, 'home.schedule.how'))}</p>`);
      expect(tile.match(/<p /g), l).toHaveLength(1);
      expect(tile, l).toContain(`href="/app/calendar">`);
    }
    // Chinese calls the calendar 日程, here as on the rail and the page
    expect(MESSAGES.zh['home.schedule.title']).not.toContain('日历');
  });
});

describe('4 · the wins — what the assistant handled, then the figures', () => {
  it('two: the headline, two faces — each a faceLink to the card, the word under it, the name and the word said to a screen reader', () => {
    for (const l of LOCALES) {
      const wins = zone(render(l, day(2)), 'today-done');
      expect(wins, l).toContain(`<h2 id="today-done" class="td-head">${agentMark(28, 'am as')} ${esc(tn(l, 'today.handled.title', 2, { name: 'Lily' }))}</h2>`);
      const faces = [...wins.matchAll(/<a class="face-link td-face" href="([^"]+)" data-card aria-label="([^"]+)">(.*?)<\/a>/g)];
      expect(faces, l).toHaveLength(2);
      faces.forEach((m, i) => {
        const p = handledFace(i + 1);
        expect(m[1], l).toBe(cardHref(p.clientId));
        expect(m[2], l).toContain(esc(t(l, `today.word.${p.word}`)));
        expect(m[3], l).toContain('class="face face-l');
        expect(m[3], l).toContain(`<span class="td-word">${esc(t(l, `today.word.${p.word}`))}</span>`);
      });
      expect(wins, l).not.toContain('class="td-more"');
    }
  });

  it('a quiet day is not an empty one: nothing handled today, the week\'s wins, said as the week\'s', () => {
    for (const l of LOCALES) {
      const html = render(l, day(5, undefined, { winsScope: 'week' }));
      expect(bare(zone(html, 'today-done')), l).toContain(bare(esc(tn(l, 'home.wins.week', 5, { name: 'Lily' }))));
      expect(figures(html), l).toContain(esc(t(l, 'home.tally.week')));
    }
  });

  it('two hundred: sixty faces drawn, then one tile "+140 more" — the row never draws 200', () => {
    for (const l of LOCALES) {
      const wins = zone(render(l, day(200)), 'today-done');
      expect(wins.match(/<a class="face-link td-face" href="\/app\/customers\/[0-9a-f-]{36}" data-card /g), l).toHaveLength(60);
      expect(bare(wins), l).toContain('<span class="td-more"><span class="td-plus"><bdi>+140</bdi></span>');
      expect(wins, l).toContain(`<span class="td-word">${esc(t(l, 'today.handled.more'))}</span></span></li></ul>`);
      expect(wins, l).toContain('loading="lazy"');
    }
  });

  it('never one handled: the tile\'s name, and what will appear here (with the assistant\'s mark while it can answer) — no hollow row, no row of zeros', () => {
    const zeros = { orders: 0, quotes: 0, afterHours: 0 };
    for (const l of LOCALES) {
      const html = render(l, { ...day(0), tally: zeros });
      const wins = zone(html, 'today-done');
      expect(bare(wins), l).toContain(bare(`<h2 id="today-done" class="td-head is-plain">${esc(t(l, 'home.wins.title', { name: 'Lily' }))}</h2><p class="td-ready">${agentMark(16, 'am as')} ${esc(t(l, 'home.wins.ahead', { name: 'Lily' }))}</p>`));
      expect(wins, l).not.toContain('td-row');
      expect(figures(html), l).toBe('');
      expect(wins, l).toContain('href="/app/analytics"');
      // nobody able to write yet: the way there, and the setup step's door
      const off = zone(render(l, { ...day(0), tally: zeros, sending: [] }), 'today-done');
      expect(bare(off), l).toContain(bare(`<p class="td-ready">${esc(t(l, 'home.wins.connect', { name: 'Lily' }))}</p>`));
      expect(off, l).toContain('href="/app/business/channels"');
    }
  });

  it('older than the week: everything since the last day one was handled, said with its date — the figures too', () => {
    const SINCE = new Date('2026-09-20T00:00:00+04:00');
    for (const l of LOCALES) {
      const html = render(l, day(4, undefined, { winsScope: 'since', winsSince: SINCE }));
      const date = withZone(ZONE, () => show.date(l, SINCE));
      expect(bare(zone(html, 'today-done')), l).toContain(bare(esc(tn(l, 'home.wins.since', 4, { name: 'Lily', date }))));
      expect(bare(figures(html)), l).toContain(bare(esc(t(l, 'home.tally.since', { date }))));
      expect(zone(html, 'today-done').match(/<a class="face-link td-face"/g), l).toHaveLength(4);
    }
  });

  it('the figures: orders confirmed, quotes sent, answered after hours — a figure and its word each, in ink', () => {
    for (const l of LOCALES) {
      const f = figures(render(l, day(2)));
      const items = [...f.matchAll(/<li><span class="tt-n">([^<]*)<\/span><span class="tt-l">([^<]*)<\/span><\/li>/g)];
      expect(items.map((m) => bare(m[1]!)), l).toEqual(['3', '5', '4']);
      expect(items.map((m) => m[2]), l).toEqual([
        esc(tn(l, 'today.tally.orders', 3)), esc(tn(l, 'today.tally.quotes', 5)), esc(tn(l, 'today.tally.late', 4)),
      ]);
      expect(f, l).not.toContain('%');
    }
    for (const sel of ['.tt-n', '.tt-l', '.tt-row > li']) expect(ruleOf(sel), sel).not.toMatch(/--color-(ok|waiting|warn|assistant)/);
  });

  it('the name rule: the chosen name in the headline; "your assistant" until one is chosen; never a pronoun', () => {
    for (const l of LOCALES) {
      expect(zone(render(l, day(2), 'Lily'), 'today-done'), l).toContain('Lily');
      const unnamed = zone(render(l, day(2), null), 'today-done');
      expect(unnamed, l).not.toContain('Lily');
      expect(unnamed.toLowerCase(), l).toContain(ASSISTANT_FALLBACK[l].toLowerCase());
    }
    expect(zone(render('en', day(2), 'Lily'), 'today-done').replace(/<[^>]+>/g, ' ')).not.toMatch(/\b(she|her|he|him|his|it)\b/i);
  });

  it('the row scrolls sideways and snaps, fades at its end — from the right in Arabic', () => {
    const rule = css.match(/\.td-row \{ list-style[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('overflow-x:auto');
    expect(rule).toContain('scroll-snap-type:inline proximity');
    expect(rule).toContain('mask-image:linear-gradient(to right, var(--color-ink) calc(100% - var(--space-48)), transparent)');
    expect(css).toMatch(/\[dir="rtl"\] \.td-row \{[^}]*mask-image:linear-gradient\(to left,/);
  });
});

describe('the home run · never empty: a brand-new workspace still has a page', () => {
  it('nothing yet anywhere: the greeting, one calm line, how dates come, and the way forward — each zone with words and a door', () => {
    for (const l of LOCALES) {
      const html = render(l, { ...NOTHING_TODAY(NOW), hour: 9, schedule: { today: TODAY, entries: [] }, sending: [] }, null, notLive);
      for (const id of ['home-hi', 'today-now', 'home-schedule', 'today-done'] as const) {
        expect(zone(html, id).replace(/<[^>]+>/g, '').trim().length, `${l} ${id}`).toBeGreaterThan(10);
      }
      expect(zone(html, 'home-schedule'), l).toContain('href="/app/calendar"');
      expect(zone(html, 'today-done'), l).toContain('<p class="td-ready">');
      expect(zone(html, 'today-done'), l).toContain('href="/app/business/channels"');
    }
  });
});

/**
 * THE QUIET-DAY RUN (2026-10-05) — the owner: "A tile's HEADLINE must never be a negative sentence. Never
 * 'X has not happened', 'Nothing yet', 'No conversations'. A headline states what IS." And: "if anything is
 * waiting, it is NOT caught up. 'All caught up' appears only when the count is genuinely zero."
 */
const NEGATIVE: Readonly<Record<Locale, RegExp>> = {
  en: /(?<!\p{L})(no|not|nothing|none|never|nobody|yet|without)(?!\p{L})|n['’]t(?!\p{L})/iu,
  zh: /[没不无未尚]/u,
  ar: /(?<!\p{L})(لا|لم|لن|ليس|ليست|بعد|بلا|دون|أي|أيّ)(?!\p{L})/u,
  es: /(?<!\p{L})(no|nada|nunca|ningún|ninguna|ninguno|nadie|todavía|aún|sin)(?!\p{L})/iu,
  fr: /(?<!\p{L})(ne|pas|rien|jamais|aucun|aucune|personne|encore|sans)(?!\p{L})|(?<!\p{L})n['’](?=\p{L})/iu,
};
const FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
/** Every string Home draws as a tile's headline: the schedule's, the wins', and the figures'. */
const TILE_HEADLINES = [
  'home.schedule.today', 'home.schedule.next', 'home.schedule.title', 'home.wins.title',
  'today.tally.title', 'home.tally.week', 'home.tally.since',
  ...['today.handled.title', 'home.wins.week', 'home.wins.since'].flatMap((b) => FORMS.map((f) => `${b}.${f}`)),
] as const;
/** Every headline inside Home's two tiles, as read. */
const tileHeadlines = (html: string): string[] =>
  [...html.matchAll(/<section class="home-tile[\s\S]*?<\/section>/g)]
    .flatMap((m) => [...m[0].matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/g)].map((h) => bare(h[1]!.replace(/<[^>]+>/g, '')).trim()));

describe('the quiet-day run · a tile\'s headline states what IS, never an absence', () => {
  it('the check catches the headlines it replaced, in every language (the known bad ones)', () => {
    const OLD: Readonly<Record<Locale, readonly string[]>> = {
      en: ['Today Lily has not handled a conversation yet.', 'Nothing on the calendar yet.', 'No customer can reach Lily yet'],
      zh: ['今天Lily还没有处理过对话。', '日程上还没有安排。', '客户现在还找不到Lily'],
      ar: ['لا ردود من Lily اليوم بعد.', 'لا شيء في التقويم بعد.', 'لا يستطيع أي عميل الوصول إلى Lily بعد'],
      es: ['Hoy Lily todavía no ha atendido ninguna conversación.', 'Todavía no hay nada en el calendario.', 'Todavía nadie puede escribir a Lily'],
      fr: ['Aujourd’hui, Lily n’a encore pris en charge aucune conversation.', 'Rien dans le calendrier pour l’instant.', 'Aucun client ne peut encore écrire à Lily'],
    };
    for (const l of LOCALES) for (const o of OLD[l]) expect(NEGATIVE[l].test(o), `${l}: ${o}`).toBe(true);
  });

  it('no string Home draws as a tile headline is a negative construction, in any language', () => {
    for (const l of LOCALES) {
      for (const k of TILE_HEADLINES) {
        const v = (MESSAGES[l] as Record<string, string>)[k];
        expect(v, `${l} ${k}`).toBeDefined();
        expect(NEGATIVE[l].test(v!), `${l} ${k}: ${v}`).toBe(false);
      }
    }
  });

  const zeros = { orders: 0, quotes: 0, afterHours: 0 };
  const STATES: ReadonlyArray<readonly [string, TodayData, OperationsSnapshot?]> = [
    ['busy', day(2, SEVERAL)],
    ['the week\'s wins', day(3, undefined, { winsScope: 'week' })],
    ['older wins, with their date', day(1, undefined, { winsScope: 'since', winsSince: new Date('2026-09-20T00:00:00+04:00') })],
    ['never one, answering', { ...day(0), tally: zeros }],
    ['never one, held', { ...day(0), tally: zeros }, { ...live, assistantStoppedAt: NOW }],
    ['never one, nobody can write', { ...day(0), tally: zeros, sending: [] }, notLive],
    ['a later date only', day(2, undefined, { schedule: { today: TODAY, entries: [OWN_LATER] } })],
    ['nothing dated', day(2, undefined, { schedule: { today: TODAY, entries: [] } })],
    ['brand new', { ...NOTHING_TODAY(NOW), hour: 9, schedule: { today: TODAY, entries: [] }, sending: [] }, notLive],
  ];
  for (const l of LOCALES) {
    for (const [what, d, s] of STATES) {
      it(`${l} · ${what}: every tile headline drawn states what is`, () => {
        for (const name of ['Lily', null]) {
          const heads = tileHeadlines(render(l, d, name, s ?? live));
          expect(heads.length, `${l} ${what}`).toBeGreaterThanOrEqual(2);
          for (const h of heads) expect(NEGATIVE[l].test(h), `${l} ${what}: "${h}"`).toBe(false);
        }
      });
    }
  }
});

describe('the quiet-day run · the card never says "caught up" over its own contents', () => {
  const FOLLOW_UP: InsightsData = { insights: [{
    key: 'insight.quotedNoReply', params: { buyer: 'Nadia' }, action: { kind: 'follow_up', href: '/app/inbox/x#latest', buyer: 'Nadia' },
  }], monthChange: null };
  const ONLY_DRAFTS: InsightsData = { insights: [{
    key: 'insight.draftsWaiting', params: { count: 2 }, action: { kind: 'review_drafts', href: '/app/inbox' },
  }], monthChange: null };
  const LEAD = renderInsights(FOLLOW_UP, 'en', { bare: true });
  type Case = readonly [string, (s: OperationsSnapshot, d: TodayData) => readonly [OperationsSnapshot, TodayData, string], 'work' | 'worth'];
  const ITEMS: readonly Case[] = [
    ['a customer waiting', (s, d) => [s, { ...d, needs: SEVERAL }, ''], 'work'],
    ['a reply that never arrived', (s, d) => [{ ...s, attention: { ...s.attention, blockedMessages: 1 } }, d, ''], 'work'],
    ['a deletion request', (s, d) => [{ ...s, attention: { ...s.attention, deletionAsks: 1 } }, d, ''], 'work'],
    ['a question the assistant could not answer', (s, d) => [{ ...s, knowledge: { ...s.knowledge, openGaps: 1 } }, d, ''], 'work'],
    ['a reply sent alone, to check', (s, d) => [{ ...s, supervision: { spotChecks: 1, demoted: [] } }, d, ''], 'work'],
    ['a capability it stepped back from', (s, d) => [{ ...s, supervision: { spotChecks: 0, demoted: ['quote'] } }, d, ''], 'work'],
    ['a line worth the owner\'s attention', (s, d) => [s, d, LEAD], 'worth'],
  ];
  const head = (html: string): string => /<h2 id="today-now"[\s\S]*?<\/h2>/.exec(html)?.[0] ?? '';
  const quiet = day(0);
  const CALM = (l: Locale): readonly string[] => [esc(t(l, 'today.calm.title')), esc(t(l, 'today.needs.none'))];
  const draw = (l: Locale, s: OperationsSnapshot, d: TodayData, lead: string): string =>
    withZone(ZONE, () => withWorkspace(scope('Lily'), () => renderOperationsHome(s, l, d, lead)));

  it('the lead the cases use is a real line (the control): a bare list with nothing in it is nothing', () => {
    expect(LEAD).toContain('class="row');
    // Home's card names everyone whose reply waits for a review, so this line is left out — and nothing is left.
    expect(renderInsights(ONLY_DRAFTS, 'en', { bare: true })).toBe('');
  });

  for (const l of LOCALES) {
    for (const [base, s0] of [['answering', live], ['messaging off', notLive]] as const) {
      it(`${l} · ${base} · nothing at all: the calm line — and only then`, () => {
        const card = zone(draw(l, s0, quiet, ''), 'today-now');
        expect(card, l).toContain('home-card is-calm');
        expect(CALM(l).some((c) => head(card).includes(c)), l).toBe(true);
      });
      for (const [what, put, kind] of ITEMS) {
        it(`${l} · ${base} · ${what}: never "caught up", never "no one is waiting" — the heading says what is`, () => {
          const [s, d, lead] = put(s0, quiet);
          const card = zone(draw(l, s, d, lead), 'today-now');
          for (const c of CALM(l)) expect(head(card), `${l} ${what}`).not.toContain(c);
          expect(card, l).not.toContain('is-calm');
          if (kind === 'work') expect(head(card), l).toContain('<span class="tw-need"><span class="dot warn shape s-waiting" aria-hidden="true"></span>');
          else expect(head(card), l).toBe(`<h2 id="today-now" class="tw-head">${esc(t(l, 'insight.title'))}</h2>`);
        });
      }
    }
  }

  it('production on 2026-10-05: one reply to check, nothing dated, nothing handled for two weeks — the card says it needs you, and the tiles say what is', () => {
    for (const l of LOCALES) {
      const s: OperationsSnapshot = { ...live, supervision: { spotChecks: 1, demoted: [] } };
      const d: TodayData = { ...day(2, undefined, { winsScope: 'since', winsSince: new Date('2026-09-20T00:00:00+04:00') }), schedule: { today: TODAY, entries: [] } };
      const html = draw(l, s, d, '');
      const card = zone(html, 'today-now');
      expect(head(card), l).toBe(`<h2 id="today-now" class="tw-head"><span class="tw-need"><span class="dot warn shape s-waiting" aria-hidden="true"></span> ${esc(t(l, 'ops.attention.title'))}</span></h2>`);
      expect(card, l).toContain(`href="/app/employee#spot-checks">${esc(tn(l, 'today.spotChecks', 1))}`);
      for (const h of tileHeadlines(html)) expect(NEGATIVE[l].test(h), `${l}: "${h}"`).toBe(false);
    }
  });
});

describe('the home run · composed from the system: the card raised, the tiles lighter, two up then stacked', () => {
  it('the tiles: the same warm white and radius as the card, resting flat on the hairline — no lift (the owner\'s A)', () => {
    const tile = ruleOf('.home-tile');
    expect(tile).toContain('background:var(--color-surface)');
    expect(tile).toContain('border:1px solid var(--color-border)');
    expect(tile).toContain('border-radius:var(--radius-card)');
    expect(tile).not.toContain('box-shadow');
    expect(ruleOf('.home-card')).toContain('border-radius:var(--radius-card)');
  });

  it('two up on a wide screen, stacked on a phone', () => {
    expect(ruleOf('.home-grid')).toContain('grid-template-columns:repeat(2, minmax(0, 1fr))');
    expect(css).toMatch(/@media \(max-width: 720px\) \{\s*\.home-grid \{ grid-template-columns:minmax\(0, 1fr\);/);
  });

  it('nothing new: every Home rule draws from the tokens — no raw colour, no new shadow, no literal size, logical sides', () => {
    const ours = css.split('\n').filter((line) => /\.(tw|td|tt|home)[-.\s{,]/.test(line)).join('\n');
    expect(ours.length).toBeGreaterThan(0);
    expect(ours).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(ours).not.toMatch(/rgba?\(|hsla?\(/);
    expect(ours).not.toMatch(/box-shadow:(?!var\(--shadow-lift1\)|none)/);
    expect(ours).not.toMatch(/font-size:(?!var\(--font-size-)/);
    expect(ours).not.toMatch(/(margin|padding|border)-(left|right)|(^|[^-])\b(left|right)\s*:/);
  });

  it('the card and the schedule rise into place, the wins a beat later — only for a reader who has not asked for less motion', () => {
    const blocks: string[] = [];
    for (let at0 = css.indexOf('@media (prefers-reduced-motion: no-preference)'); at0 >= 0;
      at0 = css.indexOf('@media (prefers-reduced-motion: no-preference)', at0 + 1)) {
      let depth = 0; let j = css.indexOf('{', at0);
      for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}' && --depth === 0) break; }
      blocks.push(css.slice(at0, j));
    }
    expect(blocks.some((b) => b.includes('.flash, #approve, .working, .home-card, .td, .sgroup { animation:nomi-rise var(--motion-normal) var(--motion-ease) both; }'))).toBe(true);
    expect(blocks.some((b) => b.includes('.home-schedule { animation:nomi-rise var(--motion-normal) var(--motion-ease) both; animation-delay:var(--motion-fast); }'))).toBe(true);
    expect(blocks.some((b) => b.includes('#approve, .td { animation-delay:var(--motion-fast); }'))).toBe(true);
    expect(css.match(/\.home-card, \.td, \.sgroup \{ animation/g)).toHaveLength(1);
  });

  it('no rendered Home carries a colour of its own', () => {
    for (const l of LOCALES) {
      const html = render(l, day(200, SEVERAL));
      expect(html, l).not.toMatch(/style="/);
      expect(html, l).not.toMatch(/#[0-9a-f]{6}\b/i);
    }
  });
});
