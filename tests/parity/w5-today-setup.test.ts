import { describe, it, expect } from 'vitest';
import { withWorkspace, type RequestScope } from '../../src/api/web/say.js';
import { setupFrom } from '../../src/db/setup.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { shell } from '../../src/api/web/layout.js';
import { linkedCss } from './linked-css.js';
import { menuRow, renderSetup, renderSettingsHome } from '../../src/api/web/settings.js';
import { renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { NOTHING_TODAY, shortName, type TodayData } from '../../src/api/web/today.js';
import { renderInsights } from '../../src/api/web/insights.js';
import { STEP_LINK } from '../../src/api/web/onboarding.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import type { Locale } from '../../src/core/owner/i18n/locale.js';
import { readFileSync } from 'node:fs';

/**
 * THE WARMTH RUN, PHASE 9 — the fix wave for Today, setting up, Settings and
 * Setup (docs/UI-AUDIT.md §3), and the whole-product items handed to this area.
 * Each block names the findings it holds; each would fail without its fix.
 */

const scopeOf = (over: Partial<RequestScope> = {}): RequestScope => ({
  name: null, several: false, outreach: false,
  setup: setupFrom({ profile: true, products: true, name: false, channels: true, first_success: false }),
  business: '义乌宏发日用品厂 (demo)', needsYou: 1, zone: 'Asia/Shanghai', country: 'CN', ...over,
});
const inScope = <T>(fn: () => T, over: Partial<RequestScope> = {}): T => withWorkspace(scopeOf(over), fn);
const SETUP_VIEW = { people: 2, alerts: { available: true, phones: 0, way: 'email' as const }, signIn: { email: null }, billing: { configured: false, exempt: false, status: 'none' }, dataWaiting: 0 };
const css = (): string => linkedCss(inScope(() => shell({ title: 'x', active: 'settings', locale: 'en', path: '/app/settings', bodyHtml: '' })));
/** The declarations of every rule whose selector list contains `sel` exactly. */
const rulesFor = (sheet: string, sel: string): string[] =>
  [...sheet.replace(/\/\*[^]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1]!.split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]!);

describe('w4-today-setup-24 · w4-whole-08 · a menu value takes the page\'s direction; its words are isolated', () => {
  it('the value\'s cell carries no direction of its own: in Arabic it is right to left, its mark where reading starts', () => {
    const row = menuRow({ href: '/x', label: 'البدء', value: 'اكتملت 3 من 5 خطوات', tone: 'warn' });
    expect(row).toContain('<span class="sr-value warn"><bdi>اكتملت 3 من 5 خطوات</bdi></span>');
    expect(row).not.toMatch(/class="sr-value[^"]*"[^>]*dir=/);
  });
  for (const l of LOCALES) {
    it(`${l} · Settings and Setup draw every value that way`, () => {
      const html = inScope(() => renderSettingsHome(l, null) + renderSetup(SETUP_VIEW, l, null));
      expect(html).toContain('class="sr-value');
      expect(html).not.toMatch(/class="sr-value[^"]*" dir=/);
    });
  }
});

describe('w4-today-setup-23 · w4-whole-08 · a menu value is never cut; the name and the value share the row', () => {
  it('no menu rule cuts a value short or keeps it to one line', () => {
    const sheet = css();
    for (const sel of ['.sr-menu .sr-value', '.srow.sr-menu > .sr-value']) {
      for (const body of rulesFor(sheet, sel)) {
        expect(body, sel).not.toMatch(/text-overflow|white-space:\s*nowrap|overflow:\s*hidden/);
        expect(body, sel).not.toMatch(/max-width:\s*(?!100%)\d/);
      }
    }
  });
  it('the row is a grid of four, so the shorter of name and value stays whole and the longer wraps', () => {
    const grid = rulesFor(css(), '.srow.sr-menu').join(';');
    expect(grid).toMatch(/display:grid/);
    expect(grid).toMatch(/grid-template-columns:min-content minmax\(0, auto\) minmax\(0, max-content\) min-content/);
    expect(rulesFor(css(), '.srow.sr-menu > .sr-value').join(';')).toMatch(/overflow-wrap:break-word/);
  });
});

describe('w4-whole-16 · keyboard focus on a menu row is drawn inside the row, where the card cannot clip it', () => {
  it('the card still clips its rows to its corners, and a focused row\'s ring sits inside, rounded like the card', () => {
    const sheet = css();
    expect(rulesFor(sheet, '.scard').join(';')).toMatch(/overflow:hidden/);
    const focus = rulesFor(sheet, '.scard .srow:focus-visible').join(';');
    expect(focus).toMatch(/outline-offset:-2px/);
    expect(focus).toMatch(/border-radius:calc\(var\(--radius-card\) - 1px\)/);
  });
});


// ── Today ───────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-03T08:00:00Z');
const SNAP = (liveHere: boolean): OperationsSnapshot => ({
  range: 'today',
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0, deletionAsks: 0, ordersWaiting: 0 },
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'connected', provider: liveHere ? 'meta' : 'disabled', live: liveHere }, budget: null, hasAttention: false,
});
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const handledFaces = (names: readonly string[]): NonNullable<TodayData['handled']> => ({
  total: names.length,
  people: names.map((name, i) => ({ conversationId: uuid(100 + i), clientId: uuid(200 + i), name, photo: null, word: (['confirmed', 'quoted', 'handed', 'answered'] as const)[i % 4]! })),
});
const day = (over: Partial<TodayData> = {}): TodayData => ({ ...NOTHING_TODAY(NOW), sending: ['whatsapp'], ...over });
const today = (l: Locale, s: OperationsSnapshot, d: TodayData, over: Partial<RequestScope> = {}): string =>
  inScope(() => renderOperationsHome(s, l, d), { name: 'Lily', ...over });

describe('w4-whole-11 · w4-today-setup-21 · today-onboarding-missed-01 · Today answers "is anything connected?" as every page does', () => {
  for (const l of LOCALES) {
    it(`${l} · a channel connected where this installation sends nothing: never "nobody can reach", the day's faces, the installation's line quiet`, () => {
      const html = today(l, SNAP(false), day({ handled: handledFaces(['Carlos Mendes', 'Layla Mansour']) }));
      expect(html).not.toContain(esc(t(l, 'today.calm.notLive.title', { name: 'Lily' })));
      expect(html).toContain('class="face-link td-face"');
      expect(html).toContain(`<p class="muted notlive"><span class="dot todo" aria-hidden="true">○</span> ${esc(t(l, 'ops.system.notLive'))}</p>`);
      expect(html).not.toContain(`<span class="dot warn" aria-hidden="true">○</span> ${esc(t(l, 'ops.system.notLive'))}`);
    });
    it(`${l} · nothing connected: said once, at a heading's size, with the setup step's own door`, () => {
      const html = today(l, SNAP(true), day({ sending: [] }));
      expect(html).toContain(`<h2 id="today-done" class="td-head is-plain">${esc(t(l, 'today.calm.notLive.title', { name: 'Lily' }))}</h2>`);
      expect(html).toContain(`href="${STEP_LINK.channels}"`);
      expect(html).not.toContain('href="/app/business/ready"');
      // and it is never "all caught up"
      expect(html).not.toContain(esc(t(l, 'today.calm.title')));
    });
  }
  it('the one definition: Setup\'s step, Before going live and Ready read `connectedChannels`, and so does Today (through `loadToday`)', () => {
    const read = (f: string) => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8');
    for (const f of ['db/setup.ts', 'api/web/pilot.ts', 'api/web/ready.ts', 'api/web/today.ts']) expect(read(f), f).toContain('connectedChannels(tx,');
    expect(read('api/web/operations.ts')).toContain('const reachable = today.sending.length > 0;');
  });
});

describe('w4-today-setup-03 · -08 · -02 · under each face the customer\'s name, then one word of what happened', () => {
  for (const l of LOCALES) {
    it(`${l} · the first word of the name, in its own direction, then the word`, () => {
      const html = today(l, SNAP(true), day({ handled: handledFaces(['Aisha Bello', 'Amina Diallo', '王芳', 'محمد علي']) }));
      for (const n of ['Aisha', 'Amina', '王芳', 'محمد']) expect(html, n).toContain(`<span class="td-name" dir="auto">${n}</span>`);
      expect(html).toContain(`<span class="td-word">${esc(t(l, 'today.word.confirmed'))}</span>`);
      // two customers drawn as the same initial "A" are told apart by name
      expect(html).toContain('aria-label="Aisha Bello');
    });
    it(`${l} · each word is one word, the same kind of word as in every other language`, () => {
      for (const w of ['answered', 'quoted', 'confirmed', 'handed'] as const) expect(t(l, `today.word.${w}`), w).not.toMatch(/\s/);
    });
  }
  it('zh says an order the way the figures below say it', () => {
    expect(t('zh', 'today.tally.orders.other')).toContain(t('zh', 'today.word.confirmed'));
  });
  it('neither line under a face breaks inside a word', () => {
    const sheet = css();
    const rules = rulesFor(sheet, '.td-word').concat(rulesFor(sheet, '.td-name')).join(';');
    expect(rules).toMatch(/white-space:nowrap/);
    expect(rules).not.toMatch(/overflow-wrap:anywhere/);
    expect(shortName('  Carlos   Mendes ')).toBe('Carlos');
  });
});

describe('w4-today-setup-04 · past sixty faces, the last tile says how many more and opens nothing', () => {
  it('no door to a list where the others are not singled out', () => {
    const names = Array.from({ length: 60 }, (_, i) => `Customer ${i + 1}`);
    const html = today('en', SNAP(true), day({ handled: { ...handledFaces(names), total: 200 } }));
    expect(html).toContain('<span class="td-more"><span class="td-plus"><bdi>+140</bdi></span>');
    expect(html).not.toMatch(/<a class="td-more"/);
  });
});

describe('w4-today-setup-05 · a line about one customer leads with their face, at the band\'s size', () => {
  const insight = { insights: [{ key: 'insight.quotedNoReply' as const, params: { buyer: 'Omar Haddad' }, action: { kind: 'follow_up' as const, href: '/app/inbox/c1#latest', buyer: 'Omar Haddad' }, who: { clientId: uuid(9), name: 'Omar Haddad', photo: null } }], monthChange: null };
  for (const l of LOCALES) {
    it(`${l} · the face opens the card; the door opens the conversation`, () => {
      const html = inScope(() => renderInsights(insight, l, { bare: true }));
      expect(html).toContain('<div class="row has-face"><a class="face-link tw-face" href="/app/customers/');
      expect(html).toContain('href="/app/inbox/c1#latest"');
    });
  }
  it('off Today the line has no face; on Today it is said at the size of the band\'s own lines', () => {
    expect(inScope(() => renderInsights(insight, 'en'))).not.toContain('tw-face');
    expect(rulesFor(css(), '.today-worth .grow').join(';')).toMatch(/font-size:var\(--font-size-small\)/);
  });
});

describe('w4-today-setup-06 · -07 · -09 · -27 · setting up is a chore under the band, said one way; the calm state said once', () => {
  const setup = setupFrom({ profile: true, products: true, name: false, channels: true, first_success: false });
  for (const l of LOCALES) {
    it(`${l} · a calm day with setting up left: the calm panel holds no chore; the chore carries the to-do ○`, () => {
      const html = today(l, SNAP(true), day(), { setup });
      const band = html.slice(html.indexOf('aria-labelledby="today-now"'), html.indexOf('</section>', html.indexOf('aria-labelledby="today-now"')));
      expect(band).toContain(esc(t(l, 'today.calm.title')));
      expect(band).not.toContain('today-foot setup');
      expect(band).not.toContain(esc(t(l, 'today.needs.none')));
      expect(html).toContain(`<div class="today-foot setup"><p><span class="dot todo" aria-hidden="true">○</span>`);
      expect(html).not.toContain(`<span class="dot warn" aria-hidden="true">○</span> <span class="muted">${esc(t(l, 'today.setup.line', { done: 3, total: 5 }))}`);
    });
    it(`${l} · Today's line and Setup's row phrase the count the same way`, () => {
      expect(t(l, 'today.setup.line', { done: 3, total: 5 })).toContain(t(l, 'nav.setup.progress', { done: 3, total: 5 }));
    });
  }
});

describe('w4-today-setup-28 · Settings\' My business row does not repeat the name printed above it', () => {
  for (const l of LOCALES) {
    it(`${l}`, () => {
      const html = inScope(() => renderSettingsHome(l, null));
      const row = /<a class="srow sr-menu" href="\/app\/business">[^]*?<\/a>/.exec(html)![0];
      expect(row).not.toContain('sr-value');
      expect(row).not.toContain('义乌宏发日用品厂');
    });
  }
});

describe('V1-011 · V1-109 · "customers answered" and the fifth step count replies that went out', () => {
  const read = (f: string) => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8');
  it('the assistant\'s "customers answered" reads the sent rows Today\'s hero reads, not processed turns', () => {
    const ops = read('api/web/operations.ts');
    const handled = ops.slice(ops.indexOf('select count(distinct o.conversation_id)::int from outbound_messages o'), ops.indexOf('as handled,'));
    expect(handled).toMatch(/o\.origin = 'employee'/);
    expect(handled).toMatch(/o\.status in \('sent', 'delivered', 'read'\)/);
    expect(ops).not.toMatch(/from turns where business_id = \$\{B\} and created_at >= \$\{cutoff\}/);
  });
  it('Getting started\'s fifth step is done when the assistant\'s reply went out, not when a draft was approved', () => {
    const setupSql = read('db/setup.ts');
    const step = setupSql.slice(setupSql.indexOf('exists(select 1 from outbound_messages o'), setupSql.indexOf('as first_success_done'));
    expect(step).toMatch(/o\.origin = 'employee'/);
    expect(step).toMatch(/o\.status in \('sent', 'delivered', 'read'\)/);
    expect(setupSql).not.toMatch(/d\.status in \('approved','edited'\)/);
  });
});
