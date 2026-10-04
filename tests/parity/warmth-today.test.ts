import { describe, it, expect } from 'vitest';
import { renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { NOTHING_TODAY, type TodayData, type HandledFace, type HandledWord } from '../../src/api/web/today.js';
import type { ConversationSummary } from '../../src/api/web/inbox.js';
import { withWorkspace, t, tn, type RequestScope } from '../../src/api/web/say.js';
import { shell, esc } from '../../src/api/web/layout.js';
import { cardHref } from '../../src/api/web/faces.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { ASSISTANT_FALLBACK } from '../../src/core/owner/i18n/messages.js';
import { setupFrom } from '../../src/db/setup.js';
import { linkedCss } from './linked-css.js';
import { unisolatedFigures } from './isolates.js';

/**
 * THE WARMTH RUN, PHASE 2 (2026-10-03) — TODAY IN THREE ZONES. The owner's
 * verdict: "the Today page does not make it obvious what Nomi actually does."
 *
 *   1. a thin "N waiting for you" band, in the waiting signal's magenta with
 *      its ○ — face, name, one line of why; calm and warm when empty;
 *   2. the hero: "Today {name} handled N conversations for you", then a row of
 *      faces, a word under each — 2 customers or 200 without breaking;
 *   3. the day's three figures: orders confirmed, quotes sent, answered after
 *      hours. Small, calm, ink.
 *
 * Every face is the profile card's door (`faceLink`). Rendered in all five
 * languages, at 0, 2 and 200 customers handled and with nobody or several
 * waiting.
 */

const NOW = new Date('2026-10-03T09:30:00Z');
const uuid = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

const live: OperationsSnapshot = {
  range: 'today',
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0, deletionAsks: 0, ordersWaiting: 0 },
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'connected', provider: 'meta', live: true }, budget: null, hasAttention: false,
};

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

/** Several waiting: seven in all, the band names the first five (the Inbox's order). */
const SEVERAL: TodayData['needs'] = {
  total: 7,
  rows: [1, 2, 3, 4, 5].map((i) => waiting(i, i === 2 ? { ownership: 'AI', awaitingReview: true, handoffReason: null } : {})),
  faces: Object.fromEntries([1, 2, 3, 4, 5].map((i) => [uuid(1000 + i), { clientId: uuid(4000 + i), name: `Customer ${i}`, photo: null }])),
};
const day = (n: number, needs: TodayData['needs'] = { total: 0, rows: [] }): TodayData => ({
  ...NOTHING_TODAY(NOW), needs, handled: handled(n), tally: { orders: 3, quotes: 5, afterHours: 4 }, sending: ['instagram'],
});

const scope = (name: string | null): RequestScope => ({ name, several: false, outreach: false, setup: null, zone: 'Asia/Dubai' });
const render = (l: Locale, d: TodayData, name: string | null = 'Lily', s: OperationsSnapshot = live): string =>
  withWorkspace(scope(name), () => renderOperationsHome(s, l, d));
const zone = (html: string, id: 'today-now' | 'today-done' | 'today-tally'): string => {
  const at = html.indexOf(`aria-labelledby="${id}"`);
  return at < 0 ? '' : html.slice(at, html.indexOf('</section>', at));
};
const bare = (s: string): string => s.replace(/[\u2066-\u2069\u200e\u200f]/g, '');

describe('the warmth run · Today in three zones, in every language', () => {
  for (const l of LOCALES) {
    for (const n of [0, 2, 200]) {
      for (const who of ['nobody', 'several'] as const) {
        it(`${l} · ${n} handled · ${who} waiting: the band, the hero, the figures — in that order`, () => {
          const html = render(l, day(n, who === 'several' ? SEVERAL : { total: 0, rows: [] }));
          const at = ['today-now', 'today-done', 'today-tally'].map((id) => html.indexOf(`<h2 id="${id}"`));
          expect(at.every((x) => x > 0), `${at}`).toBe(true);
          expect([...at].sort((a, b) => a - b)).toEqual(at);
          // Nothing else stands between them: the band, the hero, the figures — and the hidden notify helper after.
          expect(html.match(/<section /g)).toHaveLength(3);
          // RTL: every figure is isolated, whatever the counts.
          if (l === 'ar') expect(unisolatedFigures(html)).toEqual([]);
        });
      }
    }
  }
});

describe('1 · who waits for you', () => {
  it('several: the count in the owner\'s words, magenta with ○; five faces that open the card; the name and why a door to the newest message', () => {
    for (const l of LOCALES) {
      const band = zone(render(l, day(2, SEVERAL)), 'today-now');
      expect(band, l).toContain(`<span class="tw-need"><span class="dot warn shape s-waiting" aria-hidden="true"></span> ${esc(tn(l, 'today.waiting', 7))}</span>`);
      const faces = [...band.matchAll(/<a class="face-link tw-face" href="([^"]+)" data-card aria-label="([^"]+)">/g)];
      expect(faces.map((m) => m[1]), l).toEqual([1, 2, 3, 4, 5].map((i) => cardHref(uuid(4000 + i))));
      expect(faces.map((m) => m[2]), l).toEqual([1, 2, 3, 4, 5].map((i) => `Customer ${i}`));
      for (const i of [1, 2, 3, 4, 5]) expect(band, l).toContain(`<a class="tw-go" href="/app/inbox/${uuid(1000 + i)}#latest">`);
      // one line of why, the Inbox's own words
      expect(band, l).toContain(`<span class="tw-why"><bdi>${esc(t(l, 'takeover.reason.human_requested'))}</bdi></span>`);
      expect(band, l).toContain(`<span class="tw-why"><bdi>${esc(t(l, 'buyers.badge.reviewShort'))}</bdi></span>`);
      // past five: the rest are in the Inbox
      expect(band, l).toContain(`href="/app/inbox?filter=pending">${esc(tn(l, 'today.needs.all', 7))}`);
      // no preview of the message: face, name, why
      expect(band, l).not.toContain('Can I speak to someone?');
    }
  });

  it('nobody: calm and warm — "you\'re all caught up", the fact, and the assistant\'s care by name — never a dashed empty box', () => {
    for (const l of LOCALES) {
      const html = render(l, day(2));
      const band = zone(html, 'today-now');
      expect(html, l).toContain('class="block today-now tw is-calm"');
      expect(band, l).toContain(`<h2 id="today-now" class="tw-head">${esc(t(l, 'today.calm.title'))}</h2>`);
      // Phase 9 (w4-today-setup-09) — the calm state is said once: the title, then the assistant's care.
      expect(band, l).not.toContain(esc(t(l, 'today.needs.none')));
      expect(bare(band), l).toContain(bare(esc(t(l, 'today.calm.care', { name: 'Lily' }))));
      expect(band, l).not.toContain('class="empty"');
      expect(band, l).not.toContain('tw-need');
    }
    // The calm card is white and rounded, not the dashed panel of an empty state.
    const css = linkedCss(withWorkspace(scope(null), () => shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' })));
    expect(css).toContain('.tw.is-calm { background:var(--color-surface); border-radius:var(--radius-card);');
  });

  it('what Today must still say lives in the band: stopped, a reply that never arrived, a deletion request — and Setup unfinished just under it', () => {
    const s: OperationsSnapshot = { ...live, assistantStoppedAt: NOW, attention: { ...live.attention, blockedMessages: 2, deletionAsks: 1 } };
    const setup = setupFrom({ profile: false, products: true, name: true, channels: true, first_success: false });
    const html = withWorkspace({ ...scope('Lily'), setup }, () => renderOperationsHome(s, 'en', day(0)));
    const band = zone(html, 'today-now');
    expect(band).toContain(esc(t('en', 'today.stopped.title', { name: 'Lily' })));
    expect(band).toContain(`href="/app/inbox?filter=blocked">${esc(tn('en', 'today.blocked', 2))}`);
    expect(band).toContain(`href="/app/inbox?filter=deletion">${esc(tn('en', 'today.deletion', 1))}`);
    // Phase 9 (w4-today-setup-07) — setting up is its own block under the band, never inside it.
    expect(band).not.toContain('class="today-foot setup"');
    expect(html.indexOf('class="today-foot setup"')).toBeGreaterThan(html.indexOf('</section>', html.indexOf('aria-labelledby="today-now"')));
    // One reply that never arrived is enough to break "all caught up"; stopped, nothing says the assistant is looking after anyone.
    expect(band).not.toContain(esc(t('en', 'today.calm.title')));
    expect(html).not.toContain(esc(t('en', 'today.calm.care', { name: 'Lily' })));
    expect(html).not.toContain(esc(t('en', 'today.handled.ready')));
  });
});

describe('2 · what the assistant handled', () => {
  it('two: the headline, two faces — each a faceLink to the card, the word under it, the name and the word said to a screen reader', () => {
    for (const l of LOCALES) {
      const hero = zone(render(l, day(2)), 'today-done');
      expect(hero, l).toContain(`<h2 id="today-done" class="td-head"><span class="shape s-assistant as" aria-hidden="true"></span> ${esc(tn(l, 'today.handled.title', 2, { name: 'Lily' }))}</h2>`);
      const faces = [...hero.matchAll(/<a class="face-link td-face" href="([^"]+)" data-card aria-label="([^"]+)">(.*?)<\/a>/g)];
      expect(faces, l).toHaveLength(2);
      faces.forEach((m, i) => {
        const p = handledFace(i + 1);
        expect(m[1], l).toBe(cardHref(p.clientId));
        expect(m[2], l).toContain(esc(t(l, `today.word.${p.word}`)));
        expect(m[3], l).toContain('class="face face-l');           // the 56 px face, drawn by face()
        expect(m[3], l).toContain(`<span class="td-word">${esc(t(l, `today.word.${p.word}`))}</span>`);
      });
      expect(hero, l).not.toContain('class="td-more"');
    }
  });

  it('two hundred: sixty faces drawn, then one tile "+140 more" — the row never draws 200', () => {
    for (const l of LOCALES) {
      const hero = zone(render(l, day(200)), 'today-done');
      expect(hero.match(/<a class="face-link td-face" href="\/app\/customers\/[0-9a-f-]{36}" data-card /g), l).toHaveLength(60);
      expect(hero.match(/data-card/g), l).toHaveLength(60);
      // Phase 9 (w4-today-setup-04) — the tile says how many more and opens nothing: no list singles them out.
      expect(bare(hero), l).toContain('<span class="td-more"><span class="td-plus"><bdi>+140</bdi></span>');
      expect(hero, l).toContain(`<span class="td-word">${esc(t(l, 'today.handled.more'))}</span></span></li></ul>`);
      expect(hero, l).not.toContain('href="/app/inbox?filter=all"');
      expect(bare(hero), l).toContain(bare(esc(tn(l, 'today.handled.title', 200, { name: 'Lily' }))));
      // photos load lazily, as face() draws them
      expect(hero, l).toContain('loading="lazy"');
    }
    // Even handed more than sixty, the renderer stops at sixty.
    const many = { ...day(200), handled: { total: 200, people: Array.from({ length: 200 }, (_, i) => handledFace(i + 1)) } };
    expect(zone(render('en', many), 'today-done').match(/class="face-link td-face"/g)).toHaveLength(60);
  });

  it('none: an honest sentence, warm while the assistant can answer — and no hollow row', () => {
    for (const l of LOCALES) {
      const hero = zone(render(l, day(0)), 'today-done');
      expect(hero, l).toContain(`<h2 id="today-done" class="td-head">${esc(t(l, 'today.handled.none', { name: 'Lily' }))}</h2>`);
      expect(hero, l).toContain(esc(t(l, 'today.handled.ready')));
      expect(hero, l).not.toContain('td-row');
    }
  });

  it('the name rule: the chosen name in the headline; "your assistant" until one is chosen; never a pronoun', () => {
    for (const l of LOCALES) {
      const named = zone(render(l, day(2), 'Lily'), 'today-done');
      expect(named, l).toContain('Lily');
      const unnamed = zone(render(l, day(2), null), 'today-done');
      expect(unnamed, l).not.toContain('Lily');
      expect(unnamed.toLowerCase(), l).toContain(ASSISTANT_FALLBACK[l].toLowerCase());
      expect(zone(render(l, day(0), null), 'today-done').toLowerCase(), l).toContain(ASSISTANT_FALLBACK[l].toLowerCase());
    }
    for (const l of ['en'] as const) {
      const words = zone(render(l, day(2), 'Lily'), 'today-done').replace(/<[^>]+>/g, ' ');
      expect(words).not.toMatch(/\b(she|her|he|him|his|it)\b/i);
    }
  });

  it('the row scrolls sideways and snaps, shows its scrollbar on a desktop, fades at its end — from the right in Arabic', () => {
    const css = linkedCss(withWorkspace(scope(null), () => shell({ title: 'T', active: 'home', locale: 'ar', path: '/app', bodyHtml: '' })));
    const rule = css.match(/\.td-row \{ list-style[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('overflow-x:auto');
    expect(rule).toContain('scroll-snap-type:inline proximity');
    expect(rule).toContain('scrollbar-width:thin');
    expect(rule).toContain('mask-image:linear-gradient(to right, var(--color-ink) calc(100% - var(--space-48)), transparent)');
    expect(css).toMatch(/\[dir="rtl"\] \.td-row \{[^}]*mask-image:linear-gradient\(to left,/);
    expect(css).toContain('.td-row > li { flex:none; scroll-snap-align:start; }');
  });
});

describe('3 · the day\'s three figures', () => {
  it('orders confirmed, quotes sent, answered after hours: a figure and its word each, in ink — no percentage, no trend', () => {
    for (const l of LOCALES) {
      const tally = zone(render(l, day(2)), 'today-tally');
      const items = [...tally.matchAll(/<li><span class="tt-n">([^<]*)<\/span><span class="tt-l">([^<]*)<\/span><\/li>/g)];
      expect(items.map((m) => bare(m[1]!)), l).toEqual(['3', '5', '4']);
      expect(items.map((m) => m[2]), l).toEqual([
        esc(tn(l, 'today.tally.orders', 3)), esc(tn(l, 'today.tally.quotes', 5)), esc(tn(l, 'today.tally.late', 4)),
      ]);
      expect(tally, l).not.toContain('%');
      expect(tally, l).toContain('href="/app/analytics"');   // CC-05: the history is Results'
    }
    const css = linkedCss(withWorkspace(scope(null), () => shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' })));
    for (const sel of ['.tt-n', '.tt-l', '.tt-row > li']) {
      const rule = css.match(new RegExp(`${sel.replace(/[.>]/g, (c) => `\\${c}`)} \\{[^}]*\\}`))?.[0] ?? '';
      expect(rule, sel).not.toMatch(/--color-(ok|waiting|warn|assistant)/);
    }
  });
});

describe('the zones\' own rules', () => {
  const css = linkedCss(withWorkspace(scope(null), () => shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' })));
  const ours = css.split('\n').filter((line) => /\.(tw|td|tt)[-.\s{,]/.test(line)).join('\n');

  it('are there, and use tokens only: no raw colour anywhere in them', () => {
    expect(ours.length).toBeGreaterThan(0);
    expect(ours).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(ours).not.toMatch(/rgba?\(|hsla?\(/);
    // logical sides only
    expect(ours).not.toMatch(/(margin|padding|border)-(left|right)|(^|[^-])\b(left|right)\s*:/);
  });

  it('the band and the hero rise into place — only for a reader who has not asked for less motion', () => {
    // Each no-preference block, brace-matched; the rule sits inside one of them (the shell's motion section).
    const blocks: string[] = [];
    for (let at = css.indexOf('@media (prefers-reduced-motion: no-preference)'); at >= 0;
      at = css.indexOf('@media (prefers-reduced-motion: no-preference)', at + 1)) {
      let depth = 0; let j = css.indexOf('{', at);
      for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}' && --depth === 0) break; }
      blocks.push(css.slice(at, j));
    }
    expect(blocks.some((b) => b.includes('.flash, #approve, .working, .tw, .td, .sgroup { animation:nomi-rise var(--motion-normal) var(--motion-ease) both; }'))).toBe(true);
    expect(blocks.some((b) => b.includes('#approve, .td { animation-delay:var(--motion-fast); }'))).toBe(true);
    // the motion pass: the faces come in one after another
    expect(blocks.some((b) => b.includes('.td-row > li:nth-child(2) { animation-delay:calc(var(--motion-fast) + 1 * var(--motion-step)); }'))).toBe(true);
    // and nowhere else: one rule moves them
    expect(css.match(/\.tw, \.td, \.sgroup \{ animation/g)).toHaveLength(1);
  });

  it('no rendered Today carries a colour of its own', () => {
    for (const l of LOCALES) {
      const html = render(l, day(200, SEVERAL));
      expect(html, l).not.toMatch(/style="/);
      expect(html, l).not.toMatch(/#[0-9a-f]{6}\b/i);
    }
  });
});
