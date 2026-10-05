import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { shell, atWork } from '../../src/api/web/layout.js';
import * as TOKENS from '../../src/core/owner/tokens.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { mintFlash, readFlash, flashBanner, liveRegion, UNDO_ACTION } from '../../src/api/web/flash.js';
import { conversationWatch, practiceWatch } from '../../src/api/web/live.js';
import { workingLine, renderConversationDetail, renderInboxList, type ConversationDetail, type ConversationSummary, type InboxList } from '../../src/api/web/inbox.js';
import { renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { NOTHING_TODAY, type TodayData } from '../../src/api/web/today.js';
import { renderSetup, renderSettingsHome } from '../../src/api/web/settings.js';
import { renderEmployee, type EmployeeProfile } from '../../src/api/web/employee.js';
import { renderCalendar, parseCalendarQuery } from '../../src/api/web/calendar.js';
import { withWorkspace, type RequestScope } from '../../src/api/web/say.js';
import { withZone } from '../../src/api/web/zone.js';
import { setupFrom } from '../../src/db/setup.js';
import { dayKey } from '../../src/core/owner/i18n/format.js';
import { moneyFromRow } from '../../src/core/types/money.js';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { linkedCss } from './linked-css.js';
import { parse, select, type El } from './dom-lite.js';

/**
 * PHASE 5 OF THE UI REBUILD (2026-10-02) — MOTION; THE MOTION PASS (2026-10-04).
 *
 * The owner: "Motion is wired but unfeelable … the test is whether a person
 * can see it, not whether it exists in the code." This file used to pass when
 * the stylesheet's TEXT held the rules (docs/MOTION-TRUTH.md: it "never
 * renders a page"). Now it holds three things:
 *
 *   1. every rule that moves something names an element the product really
 *      draws — read from real pages (Today with its faces, a conversation with
 *      its draft, Setup's menu, the Inbox's lenses, the calendar's month, the
 *      shell's dialogs) or made by the one script (the toast, a busy button);
 *   2. the timings and distances are ones a person can see: about 220 ms on a
 *      curve that is not front-loaded, at least 10 px of travel;
 *   3. all of it, the page transitions too, only for a reader who has not
 *      asked for less motion.
 *
 * The frames themselves were looked at, by eye, in recordings of each motion
 * firing (docs/design/motion/).
 * Undo where taking something away only sets it aside. The assistant at work,
 * shown where its reply will be, and the reply drawn into the page without a
 * reload.
 */

const css = linkedCss(shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }))
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of every `@media (…)` block whose condition contains `cond`, braces matched. */
const mediaBlocks = (text: string, cond: string): string[] => {
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const i = text.indexOf(`@media (${cond})`, at);
    if (i < 0) return out;
    const open = text.indexOf('{', i);
    let depth = 0; let j = open;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    out.push(text.slice(open + 1, j));
    at = j + 1;
  }
};
const without = (text: string, blocks: readonly string[]): string => blocks.reduce((s, b) => s.replace(b, ''), text);

/** Every rule inside a block, looked through @media, @supports and @starting-style; @keyframes and @view-transition left out. */
const rulesIn = (text: string): { sel: string; body: string }[] => {
  const out: { sel: string; body: string }[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    let depth = 0; let j = open;
    for (; j < text.length; j++) { if (text[j] === '{') depth++; else if (text[j] === '}' && --depth === 0) break; }
    const inner = text.slice(open + 1, j);
    if (/^@(media|supports|starting-style)/.test(head)) out.push(...rulesIn(inner));
    else if (!/^@(keyframes|view-transition)/.test(head)) out.push({ sel: head, body: inner });
    i = j + 1;
  }
  return out;
};

/* ── The product's real pages, drawn by their own renderers ─────────────── */

const NOW = new Date('2026-10-03T04:00:00Z');
const uuid = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const scope = (o: Partial<RequestScope> = {}): RequestScope => ({
  name: 'Lily', several: false, outreach: false, needsYou: 2, needsYouAt: 1, zone: 'Asia/Shanghai',
  setup: setupFrom({ profile: false, products: true, name: false, channels: true, first_success: false }), ...o,
});
const inShell = (path: string, body: string, locale: 'en' | 'ar' = 'en'): string =>
  withWorkspace(scope(), () => shell({ title: 'T', active: 'home', locale, path, bodyHtml: body }));

const live: OperationsSnapshot = {
  range: 'today',
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0, deletionAsks: 0, ordersWaiting: 0 },
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'connected', provider: 'meta', live: true }, budget: null, hasAttention: false,
};
const today: TodayData = {
  ...NOTHING_TODAY(NOW), tally: { orders: 3, quotes: 5, afterHours: 4 }, sending: ['instagram'],
  handled: { total: 12, people: Array.from({ length: 12 }, (_, i) => ({ conversationId: uuid(2000 + i), clientId: uuid(3000 + i), name: `Buyer ${i}`, photo: null, word: 'answered' as const })) },
};
const usd = (n: number) => moneyFromRow(n, 'USD')!;
const conversation: ConversationDetail = {
  conversationId: 'c-1', buyer: 'Maya Rahman', country: 'GB', status: 'awaiting',
  product: { name: 'Rose Face Serum', nameZh: null }, quantity: 10,
  quote: { unitPrice: usd(34.9), total: usd(349), quantity: 10 }, order: null,
  messages: [{ direction: 'inbound', text: 'how much for 10?', at: new Date('2026-10-03T03:58:00Z') }],
  pendingDraft: { draftId: 'd-1', draftText: 'The Rose Face Serum is $34.90 each, $349 for 10.', capability: 'quote' },
  ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null, lastHumanAction: null,
  knowledgeUsed: ['Ships from Leeds'], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
  channel: 'instagram',
  reading: { intent: 'price_request', quantity: { value: 10, unit: 'bottles' }, language: 'en', differsOn: [], quote: { unitPrice: 34.9, total: 349, quantity: 10, discountPct: 0, leadTimeDays: 5, moq: null } },
};
const row = (id: string, o: Partial<ConversationSummary> = {}): ConversationSummary => ({
  conversationId: id, buyer: `Buyer ${id}`, country: 'AE', status: 'handled', needsAction: false,
  ownership: 'AI', heldBy: null, awaitingReview: false, handoffReason: null, deletionWaiting: false,
  latestMessage: 'last words', latestAt: new Date('2026-10-03T03:00:00Z'),
  product: { name: 'Vacuum cup', nameZh: null }, quantity: 500, unitPrice: usd(2.4),
  channel: 'whatsapp', unanswered: false, lastFrom: 'assistant', ...o,
});
const inbox: InboxList = {
  filter: 'all', waitingCount: 1, blockedCount: 0, mineCount: 0, deletionCount: 0, channels: 2,
  conversations: [row('c-wait', { ownership: 'WAITING_HUMAN', heldBy: 'unclaimed', handoffReason: 'complaint', lastFrom: 'buyer', unanswered: true }), row('c-hers')],
  query: '', page: { from: 1, to: 2, total: 2, next: null, prev: null },
};
const TODAY = dayKey(NOW, 'Asia/Shanghai');
const month = withZone('Asia/Shanghai', () => {
  const ask = parseCalendarQuery({ day: TODAY }, NOW);
  return renderCalendar({ from: ask.from, to: ask.to, today: TODAY, category: null, buyer: null, buyers: [], categories: [], entries: [] }, 'en', { ask, now: NOW });
});
const assistant: EmployeeProfile = {
  knows: 14, assistantNamed: true, spotChecks: [], hireDate: new Date('2026-07-09T00:00:00Z'), stage: 'partial',
  canDo: ['greet'], needConfirm: ['quote'], capabilities: [{ capability: 'greet', mode: 'auto', promotable: false }, { capability: 'quote', mode: 'draft', promotable: true }],
  growth: [], promoted: true, conditions: [],
};
const SECRET = 's'.repeat(32);
const notice = flashBanner(readFlash(SECRET, mintFlash(SECRET, [{ key: 'forbidden.flash.removed' }], NOW.getTime()), 'en', NOW.getTime()));

const PAGES: Readonly<Record<string, string>> = {
  today: inShell('/app', withWorkspace(scope(), () => renderOperationsHome(live, 'en', today))),
  conversation: inShell('/app/inbox/c-1', `${notice}${atWork('Lily is writing a reply', true)}${withZone('Asia/Shanghai', () => renderConversationDetail(conversation, 'en', NOW, null))}`),
  setup: inShell('/app/settings/setup', withWorkspace(scope(), () => renderSetup({
    people: 2, alerts: { available: true, phones: 1 }, signIn: { email: 'owner@example.test' },
    billing: { configured: true, exempt: false, status: 'active' }, dataWaiting: 0,
  }, 'en', null))),
  settings: inShell('/app/settings', renderSettingsHome('en', null)),
  assistant: inShell('/app/employee', withWorkspace(scope(), () => renderEmployee(assistant, 'en', null))),
  inbox: inShell('/app/inbox', withZone('Asia/Shanghai', () => renderInboxList(inbox, 'en', NOW))),
  month: inShell('/app/calendar', month),
  arabic: inShell('/app', '<p>x</p>', 'ar'),
};
const TREES: readonly El[] = Object.values(PAGES).map(parse);

/**
 * What the one script makes, so no page drawn by the server holds it: the
 * toast and its way out, a button or a face marked busy, a page drawn again
 * in place. Each must really be made by the script.
 */
const SCRIPT_MADE: readonly [RegExp, RegExp][] = [
  [/\.toast(?![\w-])/g, /c\.className = 'toast';/],
  [/\.out(?![\w-])/g, /c\.className = 'toast out';/],
  [/\[aria-busy="true"\]/g, /setAttribute\('aria-busy', 'true'\)/],
  [/\[data-drawn-again\]/g, /setAttribute\('data-drawn-again', '1'\)/],
];
/** States a reader or the script brings to an element the page already holds. */
const STATE = /::?(before|after|backdrop|details-content)\b|:(hover|active|focus-visible|focus-within|focus)\b|:not\(\[open\]\)|\[open\]/g;

/** Every rule that moves anything: those in the no-preference blocks. */
const calm = mediaBlocks(css, 'prefers-reduced-motion: no-preference');
const still = mediaBlocks(css, 'prefers-reduced-motion: reduce');
const MOVING = calm.flatMap(rulesIn);

/** The share of the way a cubic-bezier curve has gone at time `t` (0–1). */
const along = (curve: string, time: number): number => {
  const [x1, y1, x2, y2] = /cubic-bezier\(([^)]+)\)/.exec(curve)![1]!.split(',').map(Number) as [number, number, number, number];
  const at = (a: number, b: number, s: number) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s ** 2 * b + s ** 3;
  let lo = 0; let hi = 1;
  for (let k = 0; k < 60; k++) { const s = (lo + hi) / 2; if (at(x1, x2, s) < time) lo = s; else hi = s; }
  return at(y1, y2, (lo + hi) / 2);
};

describe('the motion pass · every rule that moves names something the product really draws', () => {
  it('the pages it is read against are real: Today\'s faces, the draft, a menu, the lenses, the month, the dialogs', () => {
    const one = (sel: string) => TREES.flatMap((tr) => select(tr, sel)).length;
    expect(one('.td-row > li')).toBeGreaterThanOrEqual(8);
    expect(one('#approve')).toBe(1);
    expect(one('.sgroup + .sgroup + .sgroup')).toBeGreaterThanOrEqual(1);
    expect(one('button.srow')).toBe(1);
    expect(one('.tabs.lens .tab.on')).toBe(1);
    expect(one('.mo td.sel .mo-d')).toBe(1);
    expect(one('dialog.ask')).toBe(PAGES_COUNT());
    expect(one('dialog.sheet')).toBe(PAGES_COUNT());
    expect(one('nav.side a.navlink.active')).toBe(PAGES_COUNT());
    expect(one('details > summary')).toBeGreaterThan(0);
    expect(MOVING.length).toBeGreaterThan(30);
  });

  it('each selector of each moving rule matches an element on those pages, or one the script makes', () => {
    const unmatched: string[] = [];
    for (const { sel } of MOVING) {
      for (const one of sel.split(',').map((s) => s.trim())) {
        if (one.startsWith('::view-transition')) continue;          // the browser's own, held below
        let left = one.replace(STATE, '');
        for (const [made, by] of SCRIPT_MADE) {
          if (made.test(left)) { expect(LIVE_SCRIPT, `${one}: the script makes it`).toMatch(by); left = left.replace(made, ''); }
          made.lastIndex = 0;
        }
        left = left.replace(/\s+/g, ' ').replace(/[>+~]\s*$/, '').trim();
        if (!left) continue;
        if (TREES.every((tr) => select(tr, left).length === 0)) unmatched.push(`${one} (as ${left})`);
      }
    }
    expect(unmatched, 'a moving rule whose element no page draws: it moves nothing').toEqual([]);
  });

  it('every animation it names is defined, and the dialogs it opens are opened by the script', () => {
    const named = new Set(MOVING.flatMap((r) => [...r.body.matchAll(/animation(?:-name)?:\s*([a-z][\w-]*)/g)].map((m) => m[1]!)).filter((n) => n !== 'none'));
    const defined = new Set([...css.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]!));
    expect([...named].filter((n) => !defined.has(n))).toEqual([]);
    expect(named.size).toBeGreaterThanOrEqual(8);
    expect(LIVE_SCRIPT).toMatch(/box\.showModal\(\)/);
    expect(LIVE_SCRIPT).toMatch(/sheet\.showModal\(\)/);
  });
});

describe('the motion pass · timings and distances a person can see', () => {
  const { motionMs, motionEase, motionEaseIn, motionSpring, motionTravelPx, motionScale } = DESIGN_TOKENS;

  it('what arrives lands in 200–250 ms; what leaves is quicker; nothing is longer than 250', () => {
    expect(motionMs).toEqual({ fast: 160, normal: 220, max: 250, step: 40 });
    expect(motionMs.normal).toBeGreaterThanOrEqual(200);
    expect(motionMs.max).toBeLessThanOrEqual(250);
    expect(motionMs.fast).toBeLessThan(motionMs.normal);
    for (const k of ['fast', 'normal', 'max', 'step'] as const) expect(css).toContain(`--motion-${k}: ${motionMs[k]}ms;`);
  });

  it('the curve settles gently: under half the way at a quarter of the time, never over the mark — the old one did 60 per cent', () => {
    expect(along(motionEase, 0.25)).toBeGreaterThan(0.35);
    expect(along(motionEase, 0.25)).toBeLessThan(0.5);
    expect(along(motionEase, 0.5)).toBeLessThan(0.8);
    expect(along('cubic-bezier(0.2, 0, 0, 1)', 0.25)).toBeGreaterThan(0.6);   // the curve it replaced, measured the same way
    const [, y1, , y2] = /cubic-bezier\(([^)]+)\)/.exec(motionEase)![1]!.split(',').map(Number);
    expect(Math.max(y1!, y2!)).toBeLessThanOrEqual(1);
    // what leaves accelerates away: slow at first
    expect(along(motionEaseIn, 0.25)).toBeLessThan(0.15);
    for (const [k, v] of [['ease', motionEase], ['ease-in', motionEaseIn], ['spring', motionSpring]] as const) expect(css).toContain(`--motion-${k}: ${v};`);
  });

  it('far enough to be seen: 10 px or more for every rise, slide and spring; a fold 8 px with its fade; a dialog grows from 0.96', () => {
    for (const k of ['page', 'rise', 'toast', 'sheet'] as const) expect(motionTravelPx[k], k).toBeGreaterThanOrEqual(10);
    expect(motionTravelPx.fold).toBe(8);
    expect(motionScale).toEqual({ press: 0.97, enter: 0.96 });
    for (const [k, v] of Object.entries(motionTravelPx)) expect(css).toContain(`--travel-${k}: ${v}px;`);
    expect(css).toMatch(/@keyframes nomi-rise \{ from \{ opacity:0; transform:translateY\(var\(--travel-rise\)\); \} \}/);
    expect(css).toMatch(/@keyframes nomi-toast-in \{ from \{ opacity:0; transform:translateX\(var\(--travel-toast\)\); \} \}/);
  });

  it('only the profile card springs; the old specs nobody executed are retired', () => {
    const springs = MOVING.filter((r) => r.body.includes('var(--motion-spring)')).map((r) => r.sel);
    expect(springs).toEqual(['dialog.sheet[open]']);
    expect('MOTION_SPECS' in TOKENS).toBe(false);
  });
});

describe('the motion pass · each moment, as the stylesheet draws it', () => {
  const ruleOf = (sel: string) => MOVING.find((r) => r.sel.split(',').map((s) => s.trim()).includes(sel))?.body ?? '';

  it('arriving: the notice, the draft (a beat after the page), the at-work line, Today, a menu group by group, each face in turn', () => {
    expect(ruleOf('#approve')).toContain('animation:nomi-rise var(--motion-normal) var(--motion-ease) both');
    expect(MOVING.find((r) => r.sel === '#approve, .td')?.body).toContain('animation-delay:var(--motion-fast)');
    expect(ruleOf('.sgroup + .sgroup')).toContain('animation-delay:var(--motion-step)');
    expect(ruleOf('.td-row > li')).toContain('animation:nomi-rise');
    expect(ruleOf('.td-row > li:nth-child(4)')).toContain('animation-delay:calc(var(--motion-fast) + 3 * var(--motion-step))');
    expect(ruleOf('details[open] > :not(summary)')).toContain('animation:nomi-arrive var(--motion-normal) var(--motion-ease) both');
    expect(ruleOf('details:not([open])::details-content')).toContain('opacity:0');
  });

  it('dialogs come and go: they grow in from 0.96 and sink away, with their dimming; the card springs', () => {
    expect(ruleOf('dialog.ask:not([open])')).toContain('transform:translateY(var(--travel-rise)) scale(var(--motion-scale-enter))');
    expect(ruleOf('dialog.ask')).toMatch(/overlay var\(--motion-fast\) allow-discrete, display var\(--motion-fast\) allow-discrete/);
    expect(ruleOf('dialog.sheet[open]')).toContain('transition-timing-function:var(--motion-spring)');
    expect(css).toContain('dialog.sheet[open] { opacity:0; transform:translateY(var(--travel-sheet)) scale(var(--motion-scale-enter)); }');
  });

  it('the toast slides in from its own edge and out again; on a phone, up from the foot', () => {
    expect(ruleOf('.toast')).toContain('animation:nomi-toast-in var(--motion-normal) var(--motion-ease) both');
    expect(ruleOf('.toast.out')).toContain('animation:nomi-toast-out var(--motion-fast) var(--motion-ease-in) both');
    expect(ruleOf('[dir="rtl"] .toast')).toContain('animation-name:nomi-toast-in-rtl');
    expect(MOVING.some((r) => r.sel === '.toast, [dir="rtl"] .toast' && r.body.includes('nomi-toast-up'))).toBe(true);
  });

  it('pages: the content fades out and rises in, and the rail\'s tile, the lens and the chosen day slide to their place', () => {
    const vt = calm.join('\n');
    expect(vt).toContain('@view-transition { navigation:auto; }');
    expect(ruleOf('main')).toContain('view-transition-name:page');
    expect(ruleOf('nav.side a.navlink.active')).toContain('view-transition-name:rail-on');
    expect(ruleOf('.tabs.lens .tab.on')).toContain('view-transition-name:lens-on');
    expect(ruleOf('.mo td.sel .mo-d')).toContain('view-transition-name:day-on');
    expect(ruleOf('::view-transition-new(page)')).toContain('animation:nomi-page-in var(--motion-max) var(--motion-ease) both');
    expect(ruleOf('::view-transition-old(page)')).toContain('animation:nomi-fade-out var(--motion-fast) var(--motion-ease-in) both');
  });

  it('the hand: a press settles to 0.97 and comes back; a rail icon lifts under the pointer; colour is left to the rail\'s own rules', () => {
    expect(ruleOf('.btn:active')).toContain('transform:scale(var(--motion-scale-press))');
    expect(ruleOf('nav.side a.navlink:active')).toContain('transform:scale(var(--motion-scale-press))');
    expect(ruleOf('.btn')).toContain('transform var(--motion-fast) var(--motion-ease)');   // the release animates too
    expect(ruleOf('nav.side a.navlink:hover .ni')).toBe(' transform:translateY(calc(-1 * var(--travel-nudge))); ');
  });
});

describe('the motion pass · nothing moves for a reader who asked for less', () => {
  it('every rule that moves something sits inside prefers-reduced-motion: no-preference — the page transitions too', () => {
    const rest = without(without(css, calm), still);
    // Outside those blocks: no transition and no animation (keyframes are only names).
    const loose = [...rest.matchAll(/(?:^|[;{\s])(transition|animation)(?:-[a-z-]+)?\s*:[^;}]*/g)]
      .map((m) => m[0].trim()).filter((d) => !/^@keyframes/.test(d));
    expect(loose).toEqual([]);
    expect(rest).not.toContain('@view-transition');
    expect(rest).not.toContain('view-transition-name');
    expect(rest).not.toContain('@starting-style');
  });

  it('no duration is written as a number: the moving rules name a token, and only the reduce block may say 1ms', () => {
    const moving = calm.join('\n');
    expect(moving.match(/\b\d+(?:\.\d+)?m?s\b/g) ?? []).toEqual([]);
    expect(still).toHaveLength(1);
    expect(still[0]).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation-duration:1ms !important;[^}]*transition-duration:1ms !important;/);
  });
});

function PAGES_COUNT(): number { return Object.keys(PAGES).length; }

describe('phase 5 · undo over confirm', () => {
  const SECRET = 's'.repeat(32);
  const ID = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
  const now = Date.UTC(2026, 9, 2, 12);

  it('a notice can carry the way back — only to a thing\'s own restore, by its id', () => {
    expect(UNDO_ACTION.test(`/app/settings/forbidden/${ID}/restore`)).toBe(true);
    expect(UNDO_ACTION.test(`/app/settings/closures/${ID}/restore`)).toBe(true);
    expect(UNDO_ACTION.test(`/app/knowledge/${ID}/restore`)).toBe(true);
    expect(UNDO_ACTION.test(`/app/calendar/entries/${ID}/restore`)).toBe(true);
    for (const bad of [`/app/settings/people/${ID}/remove`, `/app/settings/forbidden/${ID}/restore?x=1`, 'https://evil.test/app/knowledge/x/restore',
      `/app/settings/forbidden/not-an-id/restore`, `/app/channels/whatsapp/disconnect`]) expect(UNDO_ACTION.test(bad), bad).toBe(false);
  });

  it('read back in the reader\'s language, the notice draws one Undo that posts there', () => {
    for (const l of LOCALES) {
      const f = readFlash(SECRET, mintFlash(SECRET, [{ key: 'forbidden.flash.removed' }], now, `/app/settings/forbidden/${ID}/restore`), l, now);
      expect(f?.undo, l).toEqual({ action: `/app/settings/forbidden/${ID}/restore`, label: t(l, 'common.undo') });
      const html = flashBanner(f);
      expect(html, l).toContain(`<form method="post" action="/app/settings/forbidden/${ID}/restore" class="undo"><button class="btn" type="submit">${t(l, 'common.undo')}</button></form>`);
      expect(html, l).toContain('class="flash has-undo" role="status"');
    }
  });

  it('an address of any other shape is dropped when the notice is made, and a refusal never offers one', () => {
    const odd = readFlash(SECRET, mintFlash(SECRET, [{ key: 'forbidden.flash.removed' }], now, '/app/settings/people/x/remove'), 'en', now);
    expect(odd?.undo).toBeUndefined();
    const refused = readFlash(SECRET, mintFlash(SECRET, [{ key: 'forbidden.flash.failed' }], now, `/app/settings/forbidden/${ID}/restore`), 'en', now);
    expect(refused?.bad).toBe(true);
    expect(refused?.undo).toBeUndefined();
    expect(flashBanner(refused)).not.toContain('class="undo"');
  });
});

describe('phase 5 · the assistant at work, in place', () => {
  it('the line: its ✦, what it is doing in each language, three dots, said once to a screen reader', () => {
    for (const l of LOCALES) {
      const line = workingLine(l);
      expect(line, l).toMatch(/^<div class="block working" role="status"><svg class="am as sl" data-mark="agent"[^>]*>[\s\S]*?<\/svg> /);
      expect(line, l).toContain('<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>');
    }
    expect(t('en', 'conv.working', { name: 'Lily' })).toBe('Lily is writing a reply');
  });

  it('a page drawn while the assistant is at work says so to its script; one drawn otherwise does not', () => {
    const CONV = '11111111-2222-4333-8444-555555555555';
    expect(liveRegion('en', conversationWatch(CONV, '1.0.aaaaaaaa', true))).toContain('data-live-working="1"');
    expect(liveRegion('en', conversationWatch(CONV, '1.0.aaaaaaaa'))).not.toContain('data-live-working');
    expect(liveRegion('en', practiceWatch('1.0.aaaaaaaa', true))).toContain('data-live-working="1"');
  });
});

/* ── The script's redraw, run against a small page ─────────────────────────── */

type Listener = (e: Record<string, unknown>) => void;
class Nd {
  readonly listeners = new Map<string, Listener[]>();
  children: Nd[] = [];
  parent: Nd | null = null;
  value = ''; selectionStart = 0; selectionEnd = 0; textContent = '';
  scrolled: unknown = undefined;
  open = false;
  showModal?: () => void;
  close(): void { this.open = false; }
  submitted: Nd[] = [];
  requestSubmit?: (b: Nd) => void;
  form: Nd | null = null;
  get className(): string { return this.attrs['class'] ?? ''; }
  set className(v: string) { this.attrs['class'] = v; }
  closest(sel: string): Nd | null { for (let x: Nd | null = this; x; x = x.parent) if (matches(sel)(x)) return x; return null; }
  fire(type: string, target: Nd) {
    const ev: Record<string, unknown> = { type, target, defaultPrevented: false, stopped: false };
    ev['preventDefault'] = () => { ev['defaultPrevented'] = true; };
    ev['stopPropagation'] = () => { ev['stopped'] = true; };
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
    return ev;
  }
  content: { cloneNode: () => Nd } | undefined;
  constructor(readonly tagName: string, readonly attrs: Record<string, string> = {}) {}
  addEventListener(type: string, fn: Listener): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  getAttribute(n: string): string | null { return n in this.attrs ? this.attrs[n]! : null; }
  get id(): string { return this.attrs['id'] ?? ''; }
  get firstChild(): Nd | null { return this.children[0] ?? null; }
  appendChild(n: Nd): Nd {
    if (n.tagName === '#fragment') { for (const c of [...n.children]) this.appendChild(c); return n; }
    if (n.parent) n.parent.removeChild(n);
    n.parent = this; this.children.push(n); return n;
  }
  removeChild(n: Nd): Nd { this.children = this.children.filter((c) => c !== n); n.parent = null; return n; }
  contains(n: Nd | null): boolean { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  all(): Nd[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector(sel: string): Nd | null { return this.all().find(matches(sel)) ?? null; }
  querySelectorAll(sel: string): Nd[] { return this.all().filter(matches(sel)); }
  getBoundingClientRect() { return { top: 300, bottom: 340 }; }
  scrollIntoView(o: unknown) { this.scrolled = o; }
}
const matches = (sel: string) => (e: Nd): boolean => {
  const m = /^([a-z]*)(?:\.([a-z-]+))?(?:\[([a-z-]+)(?:="([^"]*)")?\])?$/.exec(sel);
  if (!m) return false;
  return (!m[1] || e.tagName.toLowerCase() === m[1])
    && (!m[2] || (e.attrs['class'] ?? '').split(' ').includes(m[2]))
    && (!m[3] || (e.getAttribute(m[3]) !== null && (m[4] === undefined || e.getAttribute(m[3]) === m[4])));
};

function page(answers: ((u: string, init: Record<string, unknown>) => Promise<unknown>)[], calmReader = false) {
  const root = new Nd('HTML');
  const main = root.appendChild(new Nd('MAIN'));
  const region = main.appendChild(new Nd('DIV', { class: 'live', 'data-live': '/app/live/conversation/c?since=1.0.aaaaaaaa', 'data-live-working': '1' }));
  main.appendChild(new Nd('DIV', { class: 'block working', role: 'status' }));
  const tpl = root.appendChild(new Nd('TEMPLATE', { 'data-live-news': 'reply' }));
  tpl.content = { cloneNode: () => { const f = new Nd('#fragment'); f.appendChild(new Nd('DIV', { class: 'flash live-line', said: 'reply' })); return f; } };
  // What the same address answers now: the reply waiting, and a page that no longer watches for work.
  const fresh = new Nd('MAIN');
  fresh.appendChild(new Nd('DIV', { class: 'live', 'data-live': '/app/live/conversation/c?since=1.d.aaaaaaaa' }));
  const approve = fresh.appendChild(new Nd('SECTION', { id: 'approve' }));
  const doc = Object.assign(new Nd('#document'), {
    visibilityState: 'visible', title: 'Before', activeElement: null as Nd | null,
    querySelector: (s: string) => root.querySelector(s), querySelectorAll: (s: string) => root.querySelectorAll(s),
    getElementById: (id: string) => root.all().find((e) => e.id === id) ?? null,
    adoptNode: (n: Nd) => n,
  });
  let now = 0; let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const asked: { url: string; init: Record<string, unknown> }[] = [];
  const queue = [...answers];
  const location = { pathname: '/app/inbox/c', search: '', href: 'https://nomi.test/app/inbox/c', reloads: 0, reload() { this.reloads += 1; } };
  const win = Object.assign(new Nd('#window'), {
    innerHeight: 800,
    matchMedia: (q: string) => ({ matches: calmReader && q.includes('reduce') }),
    sessionStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, key: () => null, length: 0 },
    fetch: (u: string, init: Record<string, unknown>) => { asked.push({ url: u, init }); const n = queue.shift(); return n ? n(u, init) : Promise.resolve(json({ news: false, working: true })); },
  });
  const context = vm.createContext({
    window: win, document: doc, location, history: { scrollRestoration: 'auto', state: null, replaceState: () => undefined }, URL,
    fetch: win.fetch,
    DOMParser: class { parseFromString() { return { title: 'After', querySelector: (s: string) => (s === 'main' ? fresh : null) }; } },
    setTimeout: (fn: () => void, ms: number) => { seq += 1; due.set(seq, { at: now + (ms || 0), fn }); return seq; },
    clearTimeout: (id: number) => { due.delete(id); },
  });
  const flush = () => new Promise<void>((r) => setImmediate(r));
  return {
    doc, main, region, approve, asked, location,
    run: () => new vm.Script(LIVE_SCRIPT).runInContext(context),
    waits: () => [...due.values()].map((d) => d.at - now).sort((a, b) => a - b),
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > until) break;
        due.delete(next[0]); now = next[1].at; next[1].fn();
        for (let i = 0; i < 5; i++) await flush();
      }
      now = until; for (let i = 0; i < 5; i++) await flush();
    },
  };
}
const json = (body: unknown) => ({ type: 'basic', status: 200, ok: true, json: () => Promise.resolve(body) });
const htmlOf = (ok = true) => ({ type: 'basic', status: ok ? 200 : 500, ok, text: () => Promise.resolve('<html>') });

describe('phase 5 · the script draws the reply into the page, without a reload', () => {
  it('while the assistant is at work it asks every four seconds, not twenty', async () => {
    const p = page([]);
    p.run();
    expect(p.waits()).toEqual([4_000]);
    await p.advance(4_000);
    expect(p.asked).toHaveLength(1);
    expect(p.waits()).toEqual([4_000]);
  });

  it('when the work is done it fetches its own address as a page and draws that page\'s main in place', async () => {
    const p = page([
      () => Promise.resolve(json({ news: true, what: 'reply' })),
      () => Promise.resolve(htmlOf()),
    ]);
    p.run();
    await p.advance(4_000);
    expect(p.asked[1]).toMatchObject({ url: '/app/inbox/c', init: { credentials: 'same-origin', redirect: 'manual', cache: 'no-store', headers: { Accept: 'text/html' } } });
    expect(p.main.children.map((c) => c.attrs['id'] ?? c.attrs['class'])).toEqual(['live', 'approve']);
    expect(p.doc.title).toBe('After');
    expect(p.location.reloads).toBe(0);
    // the reply's card brought into view, smoothly — the at-work line had been in view
    expect(p.approve.scrolled).toEqual({ block: 'nearest', behavior: 'smooth' });
    // and the new page watches as a page does when nothing is at work
    expect(p.waits()).toEqual([20_000]);
  });

  it('for a reader who asked for less motion the card is brought into view at once', async () => {
    const p = page([() => Promise.resolve(json({ news: false })), () => Promise.resolve(htmlOf())], true);
    p.run();
    await p.advance(4_000);
    expect(p.approve.scrolled).toEqual({ block: 'nearest', behavior: 'auto' });
  });

  it('if the page cannot be had, the line is shown instead, and nothing reloads', async () => {
    const p = page([() => Promise.resolve(json({ news: true, what: 'reply' })), () => Promise.resolve(htmlOf(false))]);
    p.run();
    await p.advance(4_000);
    expect(p.region.children.map((c) => c.attrs['said'])).toEqual(['reply']);
    expect(p.main.querySelector('.working')).not.toBeNull();
    expect(p.location.reloads).toBe(0);
  });
});

/* ── Asking first, in the product's own dialog ─────────────────────────────── */

function asks(o: { dialogs: boolean; filled?: boolean }) {
  const root = new Nd('HTML');
  const form = root.appendChild(new Nd('FORM', { action: '/app/channels/whatsapp/disconnect' }));
  form.requestSubmit = (b: Nd) => { form.submitted.push(b); };
  const told: string[] = [];
  Object.assign(form, { checkValidity: () => o.filled !== false, reportValidity: () => { told.push('reported'); return o.filled !== false; } });
  const button = form.appendChild(new Nd('BUTTON', { class: 'btn danger', 'data-confirm': 'Disconnect WhatsApp? Customers stop reaching you there.' }));
  button.textContent = '  Disconnect ';
  button.form = form;
  const box = root.appendChild(new Nd('DIALOG', { class: 'ask', 'data-ask': '' }));
  if (o.dialogs) box.showModal = () => { box.open = true; };
  const q = box.appendChild(new Nd('P', { 'data-ask-q': '' }));
  const yes = box.appendChild(new Nd('BUTTON', { class: 'btn send', 'data-ask-yes': '' }));
  const no = box.appendChild(new Nd('BUTTON', { class: 'btn', 'data-ask-no': '' }));
  const doc = Object.assign(new Nd('#document'), {
    visibilityState: 'visible', querySelector: (s: string) => root.querySelector(s), querySelectorAll: (s: string) => root.querySelectorAll(s),
  });
  const win = Object.assign(new Nd('#window'), {
    sessionStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, key: () => null, length: 0 },
  });
  vm.runInContext(LIVE_SCRIPT, vm.createContext({
    window: win, document: doc, location: { pathname: '/app/channels', search: '' }, history: {}, URL,
    setTimeout: () => 0, clearTimeout: () => undefined,
  }));
  return { doc, form, button, box, q, yes, no, told };
}

describe('phase 5 · asking first in the product\'s own dialog, not the browser\'s grey box', () => {
  it('a click on a button that asks opens the dialog with its question, and that button\'s own word to go ahead', () => {
    const p = asks({ dialogs: true });
    const ev = p.doc.fire('click', p.button);
    expect(ev['defaultPrevented']).toBe(true);
    expect(ev['stopped']).toBe(true);             // the button's own handler — the browser's box — never runs
    expect(p.box.open).toBe(true);
    expect(p.q.textContent).toBe('Disconnect WhatsApp? Customers stop reaching you there.');
    expect(p.yes.textContent).toBe('Disconnect');
    expect(p.yes.className).toBe('btn danger');   // red takes something away, as on the button itself
  });

  // The warmth run's re-audit (w4-settings-a-15): a form with a field left empty is said so by the browser,
  // under the field, and nothing is asked — the dialog never stands between the owner and the missing field.
  it('a form not filled in: the browser says so under its field, and the dialog does not open', () => {
    const p = asks({ dialogs: true, filled: false });
    const ev = p.doc.fire('click', p.button);
    expect(ev['defaultPrevented']).toBe(true);
    expect(p.box.open).toBeFalsy();
    expect(p.told).toEqual(['reported']);
    expect(p.form.submitted).toEqual([]);
  });

  it('going ahead submits the form as that button would; Cancel, or a click beside it, does nothing', () => {
    const p = asks({ dialogs: true });
    p.doc.fire('click', p.button);
    for (const fn of p.no.listeners.get('click') ?? []) fn({});
    expect(p.box.open).toBe(false);
    expect(p.form.submitted).toEqual([]);
    p.doc.fire('click', p.button);
    for (const fn of p.box.listeners.get('click') ?? []) fn({ target: p.box });
    expect(p.form.submitted).toEqual([]);
    p.doc.fire('click', p.button);
    for (const fn of p.yes.listeners.get('click') ?? []) fn({});
    expect(p.box.open).toBe(false);
    expect(p.form.submitted).toEqual([p.button]);
  });

  // 0126 — a form that erases carries asked=0; the dialog's yes turns it to 1, so the route knows it asked.
  // With no script it arrives as 0, and the route answers with a page that asks.
  it('a form that erases goes with asked=1 only when the dialog said yes', () => {
    const p = asks({ dialogs: true });
    const asked = p.form.appendChild(new Nd('INPUT', { name: 'asked', type: 'hidden' }));
    asked.value = '0';
    p.doc.fire('click', p.button);
    for (const fn of p.no.listeners.get('click') ?? []) fn({});
    expect(asked.value).toBe('0');
    p.doc.fire('click', p.button);
    for (const fn of p.yes.listeners.get('click') ?? []) fn({});
    expect(asked.value).toBe('1');
    expect(p.form.submitted).toEqual([p.button]);
  });

  it('in a browser without dialogs the click goes through, and the button asks the old way', () => {
    const p = asks({ dialogs: false });
    const ev = p.doc.fire('click', p.button);
    expect(ev['defaultPrevented']).toBe(false);
    expect(ev['stopped']).toBe(false);
  });

  it('every owner page carries the dialog, closed, its going-ahead and Cancel in the page\'s language', () => {
    for (const l of LOCALES) {
      const html = shell({ title: 'T', active: 'home', locale: l, path: '/app', bodyHtml: '' });
      expect(html, l).toContain(`<dialog class="ask" aria-labelledby="ask-q" data-ask><p class="ask-q" id="ask-q" data-ask-q></p>`);
      expect(html, l).toContain(`data-ask-no autofocus>${t(l, 'common.cancel')}</button>`);
      expect(html, l).not.toMatch(/<dialog[^>]* open/);
    }
  });
});
