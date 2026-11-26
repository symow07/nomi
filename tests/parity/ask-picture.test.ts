import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
import { renderAdvisor } from '../../src/api/web/advisor.js';
import { pictureHtml } from '../../src/api/web/askPicture.js';
import { ASK_PICTURE_SCRIPT } from '../../src/api/web/askPictureScript.js';
import { ASK_PICTURE_CSS } from '../../src/api/web/askPictureStyle.js';
import { ASK_PICTURE_JS, assetAt } from '../../src/api/web/layout.js';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import type { FlowPicture, PeoplePicture, Picture, TrendPicture, WeekPicture } from '../../src/advisor/picture.js';

/**
 * THE PICTURE OF AN ANSWER (the owner, 2026-11-26). Ask Nomi answers some questions with a picture drawn from the
 * same read as its lines: where things stand (a flow), who waits (people round "You"), the week, this month against
 * last (a trend). What is held here:
 *
 *   · The picture is the page's own markup: every figure, name and entry is text in it, with no script.
 *   · "Words" is always there: the answer's lines, behind a choice made of two radios the stylesheet reads.
 *   · A figure that is not on record says so, and is never drawn as 0; it is no door either.
 *   · An answer with no picture is drawn exactly as before.
 *   · The picture's file is its own, asked for only by a page that has a picture; all the motion is in it, and none
 *     of it runs for a reader who asked for less. The stylesheet moves nothing.
 *
 * That each read's picture says only what its lines say is held on a real database
 * (tests/integration/advisor-subjects.test.ts).
 */
const FLOW: FlowPicture = { kind: 'flow', nodes: [
  { id: 'inTouch', label: 'In conversation', value: '24', col: 0, row: 'mid', href: '/app/inbox' },
  { id: 'prices', label: 'Prices sent', value: null, col: 1, row: 'mid', href: '/app/results' },
  { id: 'waitingOk', label: 'Orders waiting for your OK', value: '1', col: 2, row: 0, tone: 'waits', href: '/app/orders' },
  { id: 'quiet', label: 'Quiet since a price', value: '2', col: 2, row: 1 },
  { id: 'orders', label: 'Confirmed orders', value: '3', col: 3, row: 0 },
], links: [{ from: 'inTouch', to: 'prices' }, { from: 'prices', to: 'waitingOk', tone: 'waits' }, { from: 'prices', to: 'quiet' }, { from: 'waitingOk', to: 'orders' }] };
const PEOPLE: PeoplePicture = { kind: 'people', people: [
  { name: 'Wanda <Okafor>', what: 'an order waits for your OK', waits: true, href: '/app/customers/1' },
  { name: 'Hana Sato', what: 'waiting for a person', waits: false },
  { name: 'Delia Fontaine', what: 'a deletion request', waits: false },
], more: '…and 10 more' };
const WEEK: WeekPicture = { kind: 'week', days: [
  { label: 'Thu Nov 26', today: true, items: [{ text: 'Tue, Nov 24: sample asked for by Sami', late: true }] },
  { label: 'Fri Nov 27', today: false, items: [{ text: 'promised follow-up with Petra', late: false }] },
  ...['Sat Nov 28', 'Sun Nov 29', 'Mon Nov 30', 'Tue Dec 1', 'Wed Dec 2'].map((label) => ({ label, today: false, items: [] })),
] };
const TREND: TrendPicture = { kind: 'trend', now: [0, 120, 120, 400], then: [0, 90, 300, 310], nowLabel: '$400.00', thenLabel: '$310.00', from: 'Sun, Nov 1', to: 'Wed, Nov 4' };
const ALL: readonly Picture[] = [FLOW, PEOPLE, WEEK, TREND];
const LINES = '<ul class="adv-facts"><li>Count: 5</li></ul>';
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the picture of an answer · drawn by the page, readable with no script', () => {
  it('every figure, name and entry of each picture is text in the markup, in all five languages', () => {
    for (const l of LOCALES) {
      const flow = text(pictureHtml(l, FLOW, LINES));
      for (const n of FLOW.nodes) { expect(flow, l).toContain(n.label); if (n.value !== null) expect(flow, l).toContain(n.value); }
      const people = pictureHtml(l, PEOPLE, LINES);
      expect(people, l).toContain('Wanda &lt;Okafor&gt;');          // a customer's name is text, never markup
      expect(people, l).not.toContain('<Okafor>');
      for (const p of PEOPLE.people.slice(1)) { expect(people, l).toContain(p.name); expect(people, l).toContain(p.what); }
      expect(people, l).toContain('…and 10 more');
      const week = text(pictureHtml(l, WEEK, LINES));
      for (const d of WEEK.days) { expect(week, l).toContain(d.label); for (const i of d.items) expect(week, l).toContain(i.text); }
      const trend = text(pictureHtml(l, TREND, LINES));
      for (const w of ['$400.00', '$310.00', 'Sun, Nov 1', 'Wed, Nov 4']) expect(trend, l).toContain(w);
    }
  });

  it('a figure that is not on record says so: never 0, and no door', () => {
    for (const l of LOCALES) {
      const html = pictureHtml(l, FLOW, LINES);
      const box = /<div class="ap-n [^"]*ap-none[^"]*" data-ap-k="prices">([\s\S]*?)<\/div>/.exec(html);
      expect(box, l).not.toBeNull();
      expect(text(box![1]!), l).toContain(messages[l]['askPicture.notOnRecord']);
      expect(text(box![1]!), l).not.toMatch(/\b0\b/);
      expect(html, l).not.toContain('href="/app/results"');
      expect(html, l).toContain('<a class="ap-n ap-c0 ap-rmid" data-ap-k="inTouch" href="/app/inbox">');
    }
  });

  it('"Words" is always there: the answer\'s lines, and two radios the stylesheet reads', () => {
    for (const l of LOCALES) for (const p of ALL) {
      const html = pictureHtml(l, p, LINES);
      expect(html, l).toContain(`<div class="ap-lines">${LINES}</div>`);
      expect(html.match(/<input type="radio" name="ask-pic-show"/g), l).toHaveLength(2);
      expect(html, l).toMatch(/class="ap-as-pic" checked>/);
      expect(html, l).toContain(messages[l]['askPicture.picture']);
      expect(html, l).toContain(messages[l]['askPicture.words']);
      expect(html, l).toContain(`aria-label="${messages[l][`askPicture.kind.${p.kind}`]}"`);
    }
    expect(ASK_PICTURE_CSS).toContain('.ask-pic:has(.ap-as-words:checked) .ap-fig{display:none;}');
    expect(ASK_PICTURE_CSS).toContain('.ask-pic:has(.ap-as-words:checked) .ap-lines{display:block;}');
    expect(ASK_PICTURE_CSS).toMatch(/\.ap-show span\{[^}]*min-height:44px/);   // a thumb's size
  });

  it('the links the ribbons join name boxes the picture drew, and the one that ends in something waiting is marked', () => {
    const flow = pictureHtml('en', FLOW, LINES);
    expect(flow).toContain('data-ap-links="inTouch&gt;prices,prices&gt;waitingOk!,prices&gt;quiet,waitingOk&gt;orders"');
    const people = pictureHtml('en', PEOPLE, LINES);
    expect(people).toContain('data-ap-links="p0&gt;you!,p1&gt;you,p2&gt;you"');
    for (const k of ['you', 'p0', 'p1', 'p2']) expect(people).toContain(`data-ap-k="${k}"`);
  });
});

describe('the picture of an answer · on Ask Nomi\'s page', () => {
  const fact = { kind: 'fact' as const, text: 'Five customers wait.', lines: ['Count: 5'], phrased: true };
  it('an answer with a picture shows its sentence, the picture, and its lines under Words', () => {
    for (const l of LOCALES) {
      const html = renderAdvisor(l, { asked: 'Who waits?', answer: { ...fact, picture: PEOPLE } });
      expect(html, l).toContain('Five customers wait.');
      expect(html, l).toContain('data-ask-pic="people"');
      expect(html, l).toContain('Count: 5');
      expect(html.match(/class="ask-pic"/g), l).toHaveLength(1);
    }
  });
  it('an answer with no picture is drawn as before: no picture, no radios, no file asked for', () => {
    for (const l of LOCALES) {
      const html = renderAdvisor(l, { asked: 'How many?', answer: fact });
      expect(html, l).not.toMatch(/ask-pic|data-ap-|ap-show/);
      expect(html, l).toContain('Count: 5');
    }
    expect(renderAdvisor('en')).not.toMatch(/ask-pic|data-ap-/);
  });
});

describe('the picture of an answer · its own file, and its motion', () => {
  it('the picture names its file, Nomi\'s own, and the one script asks for it only where a picture is', () => {
    expect(ASK_PICTURE_JS).toMatch(/^\/assets\/picture\.[0-9a-f]{16}\.js$/);
    const served = assetAt(ASK_PICTURE_JS.slice('/assets/'.length));
    expect(served?.current).toBe(true);
    expect(String(served!.body)).toBe(ASK_PICTURE_SCRIPT);
    expect(pictureHtml('en', FLOW, LINES)).toContain(`data-ap-src="${ASK_PICTURE_JS}"`);
    expect(LIVE_SCRIPT).toContain("var p=document.querySelector('[data-ap-src]');p&&import(p.getAttribute('data-ap-src'));");
    expect(LIVE_SCRIPT).not.toContain('ap-ribbon');
  });

  it('the file parses, asks for nothing and writes no address', () => {
    expect(() => new vm.Script(ASK_PICTURE_SCRIPT)).not.toThrow();
    expect(ASK_PICTURE_SCRIPT).not.toMatch(/\b(fetch|import|XMLHttpRequest|sendBeacon|WebSocket|EventSource|localStorage|sessionStorage|cookie)\b/);
    expect(ASK_PICTURE_SCRIPT).not.toMatch(/https?:|\/\/[a-z]/);
    expect(ASK_PICTURE_SCRIPT).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write|eval\(/);
  });

  it('nothing moves for a reader who asked for less: every motion is behind the one check, and the stylesheet has none', () => {
    expect(ASK_PICTURE_CSS).not.toMatch(/animation|transition|@keyframes/);
    // run it with and without the preference: ribbons are drawn both times, and animate() is called only without it
    const run = (reduce: boolean): { ribbons: number; streaks: number; moved: number } => {
      let moved = 0; const made: string[] = [];
      const node = (cls: string, x: number, y: number): Record<string, unknown> => ({
        offsetLeft: x, offsetTop: y, offsetWidth: 120, offsetHeight: 60, getAttribute: (n: string) => (n === 'class' ? cls : n === 'data-ap-k' ? cls.split(' ').pop() : null),
        animate: () => { moved++; return { cancel() {} }; },
      });
      const a = node('ap-n a', 0, 0); const b = node('ap-n b', 300, 0);
      const el = (): Record<string, unknown> => ({ children: [] as unknown[], firstChild: null, setAttribute(k: string, v: string) { if (k === 'class') made.push(v); },
        appendChild(c: unknown) { (this['children'] as unknown[]).push(c); return c; }, removeChild() {}, animate: () => { moved++; return { cancel() {} }; } });
      const svg = { ...el(), namespaceURI: 'svg' };
      const fig = { offsetWidth: 600, getAttribute: (n: string) => (n === 'data-ap-links' ? 'a>b' : 'ap-flow'),
        querySelector: (s: string) => (s === 'svg.ap-wires' ? svg : null), querySelectorAll: (s: string) => (s === '[data-ap-k]' ? [a, b] : []) };
      const frame = { querySelectorAll: () => [a, b], querySelector: () => null, appendChild() {} };
      const pic = { querySelector: (s: string) => (s === '[data-ap-links]' ? fig : s === '.ap-fig' ? frame : null), addEventListener() {} };
      const document = { querySelectorAll: (s: string) => (s === '.ask-pic' ? [pic] : []), createElementNS: () => el(), createElement: () => el(), body: { animate() {} }, fonts: null };
      const window = { matchMedia: () => ({ matches: reduce }), addEventListener() {}, setTimeout: () => 1 };
      vm.runInNewContext(ASK_PICTURE_SCRIPT, { document, window, Math, String, Array });
      return { ribbons: made.filter((c) => c === 'ap-ribbon').length, streaks: made.filter((c) => c.startsWith('ap-streak')).length, moved };
    };
    expect(run(true)).toEqual({ ribbons: 1, streaks: 0, moved: 0 });
    const free = run(false);
    expect(free.ribbons).toBe(1);
    expect(free.streaks).toBe(2);
    expect(free.moved).toBeGreaterThan(4);
  });
});
