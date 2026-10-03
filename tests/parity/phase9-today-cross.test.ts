import { describe, it, expect } from 'vitest';
import * as show from '../../src/api/web/values.js';
import { withWorkspace, type RequestScope } from '../../src/api/web/say.js';
import { formatMoney } from '../../src/core/owner/i18n/format.js';
import { setupFrom } from '../../src/db/setup.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { messages, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { shell, notFoundInside, esc, BACK_TO } from '../../src/api/web/layout.js';
import { linkedCss } from './linked-css.js';
import { renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { NOTHING_TODAY, type TodayData } from '../../src/api/web/today.js';
import { renderInsights } from '../../src/api/web/insights.js';
import type { ConversationSummary } from '../../src/api/web/inbox.js';
import { renderGuide } from '../../src/api/web/guide.js';
import { STEP_LINK } from '../../src/api/web/onboarding.js';
import { renderPilotReadiness, renderPilotRunbook, renderPilotScreen, renderPilotTechnical, type PilotReadiness, type PilotRunbook } from '../../src/api/web/pilot.js';
import { renderReady } from '../../src/api/web/ready.js';
import { renderSetup, renderSettingsHome } from '../../src/api/web/settings.js';
import { checklistFor } from '../../src/db/practiceChecklist.js';
import { SETUP_STEPS } from '../../src/db/setup.js';
import { readFileSync } from 'node:fs';
import type { MetaReadiness } from '../../src/core/channel/metaReadiness.js';

/**
 * PHASE 9 — the whole product, Today, Getting started, Before going live,
 * Ready, the machine room and Setup: the today-cross list, each finding
 * checked again on the page it was seen on.
 */

const strip = (s: string): string => s.replace(/[\u2066-\u2069]/g, '');
export const scopeOf = (over: Partial<RequestScope> = {}): RequestScope => ({
  name: null, several: false, outreach: false,
  setup: setupFrom({ profile: false, products: true, name: false, channels: true, first_success: true }),
  business: '义乌宏发日用品厂 (demo)', needsYou: 2, zone: 'Asia/Shanghai', country: 'CN', ...over,
});
const inCountry = <T>(country: string | null, fn: () => T): T => withWorkspace(scopeOf({ country }), fn);

describe('Phase 9 · an amount is written the reader\'s way in the workspace\'s country (V1-009, V1-404)', () => {
  const usd = { amount: 1.05, currency: 'USD' as const };
  const big = { amount: 1234.05, currency: 'USD' as const };
  it('Spanish in Mexico writes 1.05, in Spain 1,05 — the sign stays the product\'s own', () => {
    expect(inCountry('MX', () => show.money('es', usd))).toBe('$1.05');
    expect(inCountry('ES', () => show.money('es', usd))).toBe('1,05\u00a0$');
    expect(inCountry('AR', () => show.money('es', big))).toBe('$1.234,05');
  });
  it('French writes the comma and the sign after; English and Chinese as before; Arabic as the native reader confirmed', () => {
    expect(inCountry('FR', () => show.money('fr', big)).replace(/\u202f/g, ' ')).toBe('1 234,05\u00a0$');
    expect(inCountry('CA', () => show.money('fr', usd))).toBe('1,05\u00a0$');
    for (const c of ['US', 'CN', 'GB', 'AE', 'MX']) {
      expect(inCountry(c, () => show.money('en', big)), c).toBe('$1,234.05');
      expect(inCountry(c, () => show.money('zh', big)), c).toBe('$1,234.05');
      expect(strip(inCountry(c, () => show.money('ar', big))), c).toBe(strip(show.money('ar', big)));
    }
    expect(inCountry('CN', () => show.money('zh', { amount: 12, currency: 'CNY' }))).toBe('￥12.00');
  });
  it('the products list\'s figures (V1-009) and My business\'s range (V1-404) go through it', () => {
    const range = inCountry('ES', () => t('es', 'factory.promise.floorRange',
      { low: show.money('es', { amount: 0.3, currency: 'USD' }), high: show.money('es', { amount: 2.4, currency: 'USD' }), name: 'Lily' }));
    expect(range).toContain('0,30\u00a0$');
    expect(range).toContain('2,40\u00a0$');
    expect(range).not.toMatch(/\$\d/);
  });
  it('outside a workspace, or with no country on record, an amount is written as it always was; the send path\'s formatter never changes', () => {
    for (const l of LOCALES) expect(inCountry(null, () => show.money(l, usd)), l).toBe(show.money(l, usd));
    expect(show.money('es', usd)).toBe('$1.05');
    expect(inCountry('ES', () => formatMoney(usd))).toBe('$1.05');
  });
});

// ── fixtures ────────────────────────────────────────────────────────────────
const inScope = <T>(fn: () => T, over: Partial<RequestScope> = {}): T => withWorkspace(scopeOf(over), fn);
const page = (l: Locale, path: string, body: string): string =>
  inScope(() => shell({ title: 'T', active: 'home', locale: l, path, bodyHtml: body }));
const css = linkedCss(page('en', '/app', ''));
const bare = (h: string): string => h.replace(/[\u2066-\u2069]/g, '');
const navOf = (h: string): string => h.slice(h.indexOf('<nav class="side"'), h.indexOf('</nav>'));
const NOW = new Date('2026-10-02T10:00:00Z');
const person = (o: Partial<ConversationSummary> & { conversationId: string; buyer: string }): ConversationSummary => ({
  country: null, status: 'awaiting', needsAction: true, ownership: 'AI', heldBy: null, awaitingReview: false,
  handoffReason: null, latestMessage: null, latestAt: new Date('2026-10-02T09:18:00Z'),
  product: { name: null, nameZh: null }, quantity: null, unitPrice: null, ...o,
});
const today: TodayData = {
  ...NOTHING_TODAY(NOW),
  needs: { total: 2, rows: [
    person({ conversationId: 'c-1', buyer: 'Aisha Bello', awaitingReview: true,
      latestMessage: 'Hello, what is your price for 5,000 pcs of the ZX-300 thermos, delivered to Lagos by the end of the month?' }),
    person({ conversationId: 'c-2', buyer: 'Omar Haddad', ownership: 'OWNER_CONTROLLED', heldBy: 'owner',
      latestMessage: 'Yes — one-colour logo print, $2.05/pc for 3,000 pcs, lead time 20 days. Shall I send a proforma?' }),
  ] },
};
const snap: OperationsSnapshot = {
  range: 'today',
  attention: { pendingApprovals: 1, handoffs: 0, ownerHandling: 1, blockedMessages: 0, deletionAsks: 0, ordersWaiting: 0 },
  activity: { handled: 0, draftsCreated: 1, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'not_connected', provider: 'disabled', live: false }, budget: null, hasAttention: true,
};
const todayHtml = (l: Locale): string => inScope(() => renderOperationsHome(snap, l, today));
const pr = (over: Partial<PilotReadiness> = {}): PilotReadiness => ({
  detected: { profile: false, products: true, priceRules: true, knowledge: false, claims: false, sandbox: false, channel: true },
  attest: { backupTestedAt: null, secretsRotatedAt: null, ownerReadyAt: null, assistantNamedAt: null },
  assistantName: 'Lily', validation: { at: null, pass: null, total: null }, backupVerifiedAt: null, readyToLaunch: false, ...over,
});
const rb = (over: Partial<PilotRunbook> = {}): PilotRunbook => ({
  readiness: pr(), operations: snap,
  rehearsal: { available: true, done: { takeover: true, ownerReply: true, resume: true, knowledgeCorrection: false, validationPassed: false }, completed: 3, total: 5 },
  reliability: { stuckOutbound: 0, oldestQueuedAt: null, sent: 0 }, ...over,
});
const readyView = (named: boolean, connected: boolean, earned: boolean) =>
  ({ items: checklistFor('catalogue'), seen: new Set(['quoted'] as const), named, connected, earned });
const setupHtml = (l: Locale, over: Partial<RequestScope> = {}): string => inScope(() => renderSetup({
  people: 2, alerts: { available: false, phones: 0 },
  signIn: { email: 'owner@example.com' }, billing: { configured: false, exempt: false, status: 'none' }, dataWaiting: 0,
}, l, null), over);

// ── the whole product ───────────────────────────────────────────────────────
describe('Phase 9 · the shell', () => {
  it('V1-014, V1-098 · on a phone "Customers" carries the count the rail\'s list carries, said in words to a screen reader', () => {
    for (const l of LOCALES) {
      const nav = navOf(page(l, '/app', ''));
      const entry = nav.slice(nav.indexOf('href="/app/inbox" class="navlink'), nav.indexOf('</a>', nav.indexOf('href="/app/inbox" class="navlink')));
      expect(entry, l).toContain('<span class="navcount" aria-hidden="true">');
      expect(bare(entry), l).toContain(`aria-label="${esc(t(l, 'nav.inbox'))}, ${esc(bare(t(l, `nav.needsYou.${new Intl.PluralRules(l).select(2)}` as MessageKey, { n: 2 })))}"`);
    }
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*nav\.side \{ gap:0; \}/);
  });
  it('V1-099 · a Chinese business name breaks at its space in the rail, not inside a word', () => {
    expect(css).toContain('.brand .brandname bdi { word-break:keep-all; }');
    expect(css).toContain('.brand .brandname { flex:1 1 0; max-width:100%; overflow-wrap:break-word; }');
    expect(css).toContain('.brand { flex-wrap:wrap; }');
  });
  it('V1-105 · on a phone every page says whose workspace it is', () => {
    for (const path of ['/app', '/app/settings', '/app/guide', '/app/onboarding', '/app/onboarding/technical', '/app/ready'])
      expect(page('zh', path, '<h1 class="page">x</h1>'), path).toContain('<p class="business-name"><bdi>义乌宏发日用品厂 (demo)</bdi></p>');
  });
  // THE WARMTH RUN (2026-10-03) — on a phone the five entries are five tiles,
  // icon over word, a fifth of the screen each: an entry whose word does not
  // fit a fifth (Arabic's, Spanish's and French's Inbox) has its phone form;
  // every other entry keeps one name at every width.
  it('cross-new-02, today-onboarding-new-06 · an entry has one name at every width, unless its word cannot fit a fifth of a phone', () => {
    for (const l of ['en', 'zh', 'ar', 'es'] as const) {
      const nav = navOf(page(l, '/app', ''));
      // (a figure is the waiting count's phone form, not a name)
      const shorts = [...nav.matchAll(/<span class="nl-short">([^<]*)<\/span>/g)].map((m) => m[1]).filter((s) => !/\d/.test(s ?? ''));
      expect(shorts, l).toEqual(t(l, 'nav.short.inbox') === t(l, 'nav.inbox') ? [] : [t(l, 'nav.short.inbox')]);
      expect(nav, l).toContain(`>${t(l, 'nav.settings')}<`);
    }
  });
  it('V1-012, V1-110, V1-151 · a page reached from a hub that drew no way back gets one, to its hub; one that drew its own keeps it alone', () => {
    // THE WARMTH RUN — Setup is a row of Settings (phase 1); phase 7: How you
    // sell's pages lead back to its menu, the products and the channels to the
    // rows of My business that open them.
    const cases: [string, string, MessageKey][] = [
      ['/app/settings/closures', '/app/business/how-you-sell', 'factory.sellhow.title'], ['/app/settings/rate', '/app/business/how-you-sell', 'factory.sellhow.title'],
      ['/app/settings/samples', '/app/business/how-you-sell', 'factory.sellhow.title'], ['/app/settings/terms', '/app/business/how-you-sell', 'factory.sellhow.title'],
      ['/app/products', '/app/business', 'nav.factory'], ['/app/channels', '/app/business/channels', 'factory.reach.title'],
      ['/app/settings/forbidden', '/app/employee', 'nav.employee'], ['/app/settings/people', '/app/settings/setup', 'nav.setup'],
      ['/app/guide', '/app/settings/setup', 'nav.setup'], ['/app/onboarding', '/app/settings/setup', 'nav.setup'], ['/app/ready', '/app/onboarding', 'nav.onboarding'],
      // The warmth run, phase 9 — the checklist's two screens and the machine room lead back to the checklist.
      ['/app/onboarding/practice', '/app/onboarding', 'nav.onboarding'], ['/app/onboarding/activity', '/app/onboarding', 'nav.onboarding'],
      ['/app/onboarding/technical', '/app/onboarding', 'nav.onboarding'],
      ['/app/settings/setup', '/app/settings', 'nav.settings'], ['/app/business', '/app/settings', 'nav.settings'],
      // Phase 7b: knowledge is a row of the assistant's menu, and leads back to it.
      ['/app/knowledge', '/app/employee', 'nav.employee'],
    ];
    for (const l of LOCALES) for (const [path, href, key] of cases) {
      const main = (h: string) => h.slice(h.indexOf('<main'), h.indexOf('</main>'));
      const m = main(page(l, path, '<h1 class="page">x</h1>'));
      expect(m, `${l} ${path}`).toContain(`<a class="back" href="${href}"><span class="go" aria-hidden="true">‹</span>${esc(inScope(() => t(l, key)))}</a><h1 class="page">`);
      expect(main(page(l, path, `<a class="back" href="/x">x</a><h1 class="page">x</h1>`)).match(/class="back"/g), path).toHaveLength(1);
    }
    expect(Object.keys(BACK_TO)).toHaveLength(cases.length);
    // a product's own page draws its way back to the list; a page reached from no hub gets none
    expect(page('en', '/app/products/abc', '<h1 class="page">x</h1>')).not.toContain('class="back"');
  });
  it('V1-012 · Today\'s lines end in the product\'s one chevron, not "→"', () => {
    // The warmth run — the last-24-hours lines are gone; the band's people and doors carry the chevron now.
    const h = todayHtml('en');
    expect(h).toContain('<span class="go" aria-hidden="true">›</span>');
    expect(h).not.toContain('→');
  });
  it('missed-19, missed-21 · a heading that wraps leaves no word alone; nor does a paragraph or a list line', () => {
    expect(css).toContain('h1.page, main h2, main h3 { text-wrap:balance; }');
    expect(css).toContain('main p, main li { text-wrap:pretty; }');
  });
  it('cross-new-03 · a field sent back is marked by its edge on every form — the calendar\'s add form too', () => {
    expect(css).toContain('main input[aria-invalid="true"], main textarea[aria-invalid="true"], main select[aria-invalid="true"] { border-color:var(--color-warn); }');
    const cal = readFileSync(new URL('../../src/api/web/calendar.ts', import.meta.url), 'utf8');
    for (const f of ['title', 'day', 'from', 'to']) expect(cal).toContain(`keptInvalid(kept, '${f}'`);
  });
  it('cross-new-04 · the ask-first dialog keeps Cancel on the going-ahead button\'s row; a long word wraps inside its button', () => {
    expect(css).toContain('.ask-acts { display:flex; gap:var(--space-8); flex-wrap:nowrap; align-items:stretch; }');
    expect(css).toContain('.ask-acts [data-ask-yes] { flex:1 1 auto; }');
    expect(css).toContain('.ask-acts [data-ask-no] { flex:none; }');
  });
  it('V1-158–V1-162 · a mistyped /app address, signed in: the workspace\'s shell and tab, a door with its chevron, no door-page tagline or footer', () => {
    for (const l of LOCALES) {
      const h = page(l, '/app/nope', notFoundInside(l));
      expect(h, l).toContain('<nav class="side"');
      expect(h, l).toContain(`<title>${esc(t(l, 'error.notfound.title'))} · 义乌宏发日用品厂 (demo)</title>`);
      expect(h, l).toContain(`<a class="deeper" href="/app">${esc(t(l, 'error.home'))}<span class="go" aria-hidden="true">›</span></a>`);
      expect(h, l).not.toContain(esc(t(l, 'login.brandTagline')));
      expect(h, l).not.toContain('<nav class="foot" aria-label="Nomi">');   // the door's foot (since the public batch, three doors)
      expect(h, l).not.toContain('class="langsw"');
    }
    expect(readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8')).toContain('bodyHtml: notFoundInside(locale),');
  });
});

// ── Today ───────────────────────────────────────────────────────────────────
describe('Phase 9 · Today', () => {
  it('today-onboarding-new-04 · the conversation the owner holds says so in words; no word is said twice to a screen reader', () => {
    for (const l of LOCALES) {
      const h = todayHtml(l);
      // The warmth run — the band's own line of why (was the Inbox row's .cr-why).
      expect(h, l).toContain(`<span class="tw-why"><bdi>${esc(t(l, 'buyers.group.yours'))}</bdi></span>`);
      expect(h, l).not.toContain(`<span class="sr">${esc(t(l, 'buyers.group.yours'))}</span>`);
    }
  });
  it('today-onboarding-new-02, new-03, new-05 · the short reason; the message itself is the Inbox\'s, not the band\'s', () => {
    const h = todayHtml('es');
    expect(h).toContain(`<bdi>${t('es', 'buyers.badge.reviewShort')}</bdi>`);
    // The warmth run (the owner: "each item: face, name, one line of why") — the
    // band shows no preview of the last message; the Inbox still cuts its
    // preview where a word ends and keeps a Latin one at the Arabic line's end.
    expect(h).not.toContain('class="cr-text"');
    expect(h).not.toContain('Lagos');
    expect(css).toContain('[dir="rtl"] .cr-text:dir(ltr) { text-align:end; }');
  });
  it('V1-093 → phase 8 · Today offers no browser notice of its own: how anyone hears outside Nomi is chosen on Notifications', () => {
    // The button V1-093 drew as a button is retired with the notice it asked for (the warmth run, phase 8).
    expect(todayHtml('en')).not.toContain('data-notify');
  });
  it('V1-100, V1-102 · the setup line is the guide\'s count, named as the guide is; its door says what it shows', () => {
    for (const l of LOCALES) {
      expect(t(l, 'today.setup.line', { done: 3, total: 5 }).startsWith(t(l, 'guide.title')), l).toBe(true);
      expect(t(l, 'today.setup.line', { done: 3, total: 5 }), l).not.toContain(t(l, 'nav.settings'));
      const h = todayHtml(l);
      expect(h, l).toContain(`<div class="today-next"><a class="deeper" href="${STEP_LINK.profile}">`);
      expect(h, l).toContain(esc(t(l, 'guide.watch')));
    }
    expect(t('en', 'guide.watch')).not.toBe('Watch how');
  });
  it('V1-091 · the door to Results is named as the page is', () => {
    for (const l of LOCALES) expect(t(l, 'today.results.link'), l).toBe(t(l, 'analytics.title'));
  });
  it('V1-092 · Chinese calls the calendar 日程 on Today as the rail and the page do', () => {
    expect(t('zh', 'nav.calendar')).toBe('日程');
    // The warmth run — "Coming up" left Today, and with it the two lines that named the calendar there.
    expect(todayHtml('zh')).not.toContain('日历');
  });
  it('V1-094, V1-101 · on a phone a line\'s door goes under its sentence; the sentence avoids a lone last word', () => {
    expect(css).toMatch(/@media \(max-width: 560px\) \{\s*\.today-worth \.row \{ flex-direction:column; align-items:flex-start; gap:0; \}/);
    expect(css).toMatch(/\.today-worth \.grow \{ text-wrap:pretty;[^}]*\}/);
    // V1-101 — the Arabic month line (rewritten in #206) no longer ends on "هذا الشهر".
    expect(t('ar', 'insight.monthChange.inquiries.down')).not.toMatch(/الشهر\.$/);
  });
  it('V1-096 · a figure and its measure word stay on one line in Chinese', () => {
    const line = t('zh', 'insight.monthChange.inquiries.down', { days: 9, from: 82, to: 38 });
    expect(line).toContain('82\u00a0个');
    expect(line).toContain('38\u00a0个');
    expect(line).not.toMatch(/\d [个次单天]/);
  });
  it('V1-103 · a Latin name is set off with spaces in Chinese, a Chinese one runs on', () => {
    expect(t('zh', 'insight.quotedNoReply', { buyer: 'Omar Haddad' })).toBe('告诉 Omar Haddad 价格之后，对方就没再回话了。');
    expect(t('zh', 'insight.quotedNoReply', { buyer: '陈莉' })).toBe('告诉陈莉价格之后，对方就没再回话了。');
    const h = inScope(() => renderInsights({ insights: [{ key: 'insight.quotedNoReply', params: { buyer: 'Omar Haddad' }, action: { kind: 'follow_up', href: '/app/inbox/c-2', buyer: 'Omar Haddad' } }], monthChange: null }, 'zh', { bare: true }));
    expect(h).toContain('告诉 Omar Haddad 价格之后');
  });
  it('today-onboarding-new-07 · Arabic "follow up" is not the dialog\'s "continue"', () => {
    expect(t('ar', 'insight.action.follow_up')).not.toBe(t('ar', 'common.goAhead'));
  });
  // The warmth run: "Inbox (rename from 'Customer list')", under Customers, with its shape.
  it('V1-097 · the rail\'s list entry is the Inbox, under Customers, the page it opens', () => {
    expect(t('en', 'nav.conversations')).toBe('Inbox');
    for (const l of LOCALES) {
      const nav = navOf(page(l, '/app/inbox', ''));
      expect(nav, l).toMatch(new RegExp(`<span class="navhead" id="nav-customers"><svg[^>]*>[\\s\\S]*?</svg><span>${esc(t(l, 'nav.customers'))}</span></span>`));
      expect(nav, l).toContain(`>${esc(t(l, 'nav.conversations'))}<`);
      expect(t(l, 'nav.conversations'), l).not.toBe(t(l, 'pane.label'));
    }
  });
});

// ── Getting started ────────────────────────────────────────────────────────
describe('Phase 9 · Getting started', () => {
  const half = { steps: SETUP_STEPS.map((step, i) => ({ step, done: i === 1 || i > 2 })), next: 'profile' as const };
  const guide = (l: Locale, videos = true) => inScope(() => renderGuide(half, l, t(l, 'guide.title'), () => videos));
  it('V1-108 · each step has one name: the task on the guide and Today, the item in the checklists, and the two say the same thing', () => {
    // Per step and language, the words the task and the checklist's item share.
    const SHARED: Record<Locale, Record<'profile' | 'products' | 'name' | 'channels', string>> = {
      en: { profile: 'business profile', products: 'products', name: 'the name customers see', channels: 'where customers reach you' },
      zh: { profile: '商家资料', products: '产品和价格', name: '客户看到的名字', channels: '找你' },
      ar: { profile: 'ملف النشاط', products: 'المنتجات والأسعار', name: 'الاسم الذي يراه العملاء', channels: 'يصل إليك' },
      es: { profile: 'perfil del negocio', products: 'productos y precios', name: 'el nombre que ven tus clientes', channels: 'te escriben tus clientes' },
      fr: { profile: 'profil de l’activité', products: 'produits et prix', name: 'le nom que voient vos clients', channels: 'où vos clients vous écrivent' },
    };
    const ITEM = { profile: 'pilot.item.profile', products: 'pilot.item.products', name: 'pilot.attest.assistant_named', channels: 'pilot.item.channel' } as const;
    for (const l of LOCALES) for (const step of ['profile', 'products', 'name', 'channels'] as const) {
      const shared = SHARED[l][step].toLocaleLowerCase();
      expect(t(l, `factory.next.${step}` as MessageKey).toLocaleLowerCase(), `${l} ${step} task`).toContain(shared);
      expect(t(l, ITEM[step]).toLocaleLowerCase(), `${l} ${step} item`).toContain(shared);
    }
    for (const l of LOCALES) {
      // Ready names them as the checklists do; Setup's row is the page Where customers reach you.
      const ready = renderReady(readyView(false, false, false), l);
      expect(ready, l).toContain(esc(t(l, 'pilot.attest.assistant_named')));
      expect(ready, l).toContain(esc(t(l, 'nav.channels')));
      expect(t(l, 'pilot.item.channel'), l).toBe(t(l, 'nav.channels').replace(/^./, (c) => c));
    }
  });
  it('V1-111 · the captions name the way there from the nav', () => {
    for (const l of LOCALES) {
      expect(t(l, 'guide.products.cap.1'), l).toContain(t(l, 'nav.factory'));
      expect(t(l, 'guide.name.cap.1'), l).toContain(t(l, 'nav.settings'));
      expect(t(l, 'guide.channels.cap.1'), l).toContain(t(l, 'nav.settings'));
      expect(t(l, 'guide.profile.cap.1'), l).toContain(t(l, 'nav.settings'));
    }
  });
  it('V1-112 · "Do it now" for the name opens at the name\'s own field', () => {
    expect(STEP_LINK.name).toBe('/app/onboarding#name');
    expect(guide('en')).toContain(`href="${STEP_LINK.name}"`);
    expect(renderPilotReadiness(pr(), 'en', null)).toContain('id="name"');
    expect(renderPilotReadiness(pr({ attest: { backupTestedAt: null, secretsRotatedAt: null, ownerReadyAt: null, assistantNamedAt: NOW } }), 'en', null)).toContain('id="name"');
  });
  it('V1-113 · until the name is confirmed every reply waits — nothing is promised after', () => {
    expect(t('en', 'guide.name.cap.3')).toBe('Confirm it. Until you do, every reply waits for your OK.');
    for (const l of LOCALES) expect(t(l, 'guide.name.cap.3'), l).not.toMatch(/Nothing is sent without|没有你的同意什么都不会发出|no se envía nada sin/);
  });
  it('V1-114 · the number stays beside a heading\'s first line; the state ends its words', () => {
    const h = guide('es');
    expect(h).toContain(`<h2 class="gs-h"><span class="gs-n muted">1.</span><span class="gs-t">${esc(t('es', 'factory.next.profile'))}`);
    expect(css).toContain('.gs-n { flex:none; }');
    // Phase 9 of the warmth run (w4-today-setup-13) — balanced, so no last word is left alone beside the state.
    expect(css).toContain('.gs-t { flex:1 1 auto; min-width:0; text-wrap:balance; }');
  });
  it('V1-115, V1-116, extra-guide-css · one .guide rule — the cards start at the heading\'s edge — and a gap before what follows the steps', () => {
    const rules = [...css.matchAll(/(?<![\w-])\.guide \{([^}]*)\}/g)].map((m) => m[1]!);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain('padding:0;');
    expect(rules[0]).toContain('margin:var(--space-16) 0 var(--space-32);');
    expect(css).not.toContain('line-height:2;');
    expect(css).not.toMatch(/\.guide li \{/);
  });
  it('V1-117, V1-118 · the words are under each video, as the page says — nothing to open, no "Read instead"', () => {
    for (const l of LOCALES) {
      const h = guide(l);
      expect(h, l).not.toContain('<details');
      expect(h, l).toContain(`<ol class="gs-words"><li>${esc(t(l, 'guide.profile.cap.1'))}</li>`);
    }
    expect('guide.read' in messages.en).toBe(false);
  });
  it('today-onboarding-new-10 · Spanish writes vídeo one way on the page', () => {
    expect(t('es', 'guide.lede')).toContain('vídeo');
    expect(t('es', 'guide.lede')).not.toMatch(/\bvideo\b/);
    expect(t('es', 'guide.length', { length: '20 s' })).toMatch(/^Vídeo/);
  });
});

// ── Before going live ───────────────────────────────────────────────────────
describe('Phase 9 · Before going live', () => {
  const runbook = (l: Locale, over: Partial<PilotRunbook> = {}) => inScope(() => renderPilotRunbook(rb(over), l, null));
  // The warmth run, phase 9 (w4-today-setup-15) — what followed the checklist is two screens a tap under it.
  const screens = (l: Locale, over: Partial<PilotRunbook> = {}) =>
    inScope(() => renderPilotScreen('practice', rb(over), l) + renderPilotScreen('activity', rb(over), l));
  it('V1-123 · the practice check is listed once, where its button is', () => {
    for (const l of LOCALES) {
      const h = renderPilotReadiness(pr(), l, null);
      expect(h.split(`<span class="lbl">${esc(t(l, 'pilot.item.sandbox'))}</span>`).length - 1, l).toBe(1);
      expect(h, l).not.toContain(esc(t(l, 'pilot.blocker.sandbox')));
      expect(h, l).toContain('action="/app/onboarding/validate"');
    }
  });
  it('V1-124, V1-146 · no second count beside the nav\'s; what to try in Practice is one list, every item with its mark', () => {
    for (const l of LOCALES) {
      const h = inScope(() => renderPilotScreen('practice', rb(), l));
      expect(h, l).toContain(`<h1 class="page">${esc(t(l, 'runbook.practice.title'))}</h1>`);
      expect(bare(h), l).not.toContain('3/5');
      expect(h, l).not.toContain('<ol');
      expect(h.match(/<div class="pr (done|todo)"><span class="mk[^"]*">[✓○]<\/span> <span class="lbl">/g), l).toHaveLength(5);
    }
  });
  it('V1-125 · nothing sent yet is said as that, with no tick', () => {
    for (const l of LOCALES) {
      const none = screens(l);
      expect(none, l).toContain(esc(inScope(() => t(l, 'ops.health.none'))));
      expect(none, l).not.toContain(esc(inScope(() => t(l, 'ops.health.ok'))));
      expect(screens(l, { reliability: { stuckOutbound: 0, oldestQueuedAt: null, sent: 4 } }), l).toContain(`✓ ${esc(inScope(() => t(l, 'ops.health.ok')))}`);
    }
  });
  it('V1-126 · the two counts of corrections say what each counts', () => {
    for (const l of LOCALES) expect(t(l, 'ops.activity.corrections'), l).not.toBe(t(l, 'knowledge.report.corrected'));
    expect(t('en', 'ops.activity.corrections')).toBe('Drafts you changed before sending');
  });
  it('V1-127, V1-128 · a count follows its label; every door is "Open ›" at the row\'s end', () => {
    const h = screens('en');
    expect(h).toMatch(/<span class="lbl">[^<]+<\/span><b class="n">\d+<\/b><a class="deeper rbgo" href="[^"]+">Open<span class="go" aria-hidden="true">›<\/span><\/a>/);
    expect(h).toMatch(/<span class="lbl">[^<]+<\/span><b class="n">\d+<\/b><\/div>/);
    expect(h).not.toContain('class="rblink"');
    expect(css).toContain('.rbrow .rbgo, .rbrow .rbwhen { margin-inline-start:auto; }');
  });
  it('V1-129 · "We have none" is a button that looks like one', () => {
    expect(renderPilotReadiness(pr(), 'en', null)).toContain(`<button class="btn" type="submit">${t('en', 'pilot.claims.none')}</button>`);
  });
  it('V1-130, today-onboarding-missed-17 · where the page stands is a state line with its mark, not a box that looks pressable', () => {
    // The warmth run's re-audit (w4-whole-06): a page not ready yet is a chore, drawn with the to-do ○ — magenta's is a customer waiting.
    expect(renderPilotReadiness(pr(), 'en', null)).toContain(`<p class="verdict"><span class="dot todo" aria-hidden="true">○</span> ${t('en', 'pilot.notReady')}</p>`);
    const meta: MetaReadiness = { credentials: [], allCredentialsOk: false, provider: 'disabled', channelStatus: 'not_connected', live: false, blockers: [] };
    expect(inScope(() => renderPilotTechnical('en', { meta, templateState: 'none' }))).toContain(`<p class="verdict"><span class="dot todo" aria-hidden="true">○</span> ${esc(t('en', 'meta.notLive'))}</p>`);
    const v = /\.verdict \{([^}]*)\}/.exec(css)![1]!;
    for (const boxy of ['border:', 'background', 'text-align:center', 'padding:']) expect(v, boxy).not.toContain(boxy);
  });
  it('V1-131 · the business profile row opens the profile', () => {
    expect(renderPilotReadiness(pr(), 'en', null)).toContain('<a class="deeper" href="/app/settings/profile">');
  });
  it('V1-132, V1-137 · the name in the box is a suggestion; the page to change it later is named as it is', () => {
    for (const l of LOCALES) {
      expect(t(l, 'pilot.assistant.hint'), l).toContain(t(l, 'people.title'));
      expect(t(l, 'pilot.assistant.hint'), l).not.toMatch(/team page|团队页面|صفحة الفريق|página del equipo|page de l’équipe/);
    }
    expect(t('en', 'pilot.assistant.hint')).toContain('Keep the one in the box or write your own');
  });
  it('V1-133, V1-134, V1-135, V1-142, today-onboarding-missed-15 · a row is a grid: its mark in one column, the label, then what it says or offers — under the label on a phone; the name row the same in every language, Confirm beside its field', () => {
    for (const l of LOCALES) {
      const h = renderPilotReadiness(pr(), l, null);
      expect(h, l).toContain('<div class="pr todo under" id="name">');
      expect(h, l).toContain('<form method="post" action="/app/onboarding/assistant-name" class="pr-nameform">');
    }
    expect(css).toContain('.pr { display:grid; grid-template-columns:1.5em minmax(10em, 1fr) minmax(0, auto);');
    expect(css).toContain('.pr > .mk { grid-column:1; justify-self:center;');
    // Phase 9 (V1-134) — the form's own class (the price list's .pr-name, later in the sheet, wrapped Confirm under
    // the field), and the name row in two columns so its label keeps its line.
    expect(css).toContain('.pr-nameform { display:flex; flex-wrap:nowrap;');
    expect(css).toContain('.pr.under { grid-template-columns:1.5em minmax(0, 1fr); }');
    expect(css).toMatch(/@media \(max-width: 560px\) \{\s*\.pr \{ grid-template-columns:1\.5em minmax\(0, 1fr\); \}\s*\.pr > :not\(\.mk\):not\(\.lbl\):not\(\.pr-note\) \{ grid-column:2; justify-self:start; \}/);
    expect(css).toContain('.checks.rd .chk { grid-template-columns:1.25em minmax(0, 1fr); }');
  });
  it('V1-136 · Arabic joins لـ to the assistant\'s Arabic name', () => {
    const s = inScope(() => t('ar', 'runbook.after.promotion'));
    expect(s).toContain('لمساعدك');
    expect(s).not.toContain('لـ مساعدك');
  });
  it('V1-138 · Chinese says 开启 (turn on), not 打开 (open)', () => {
    expect(t('zh', 'pilot.blocker.claims')).toContain('开启');
    expect(t('zh', 'pilot.blocker.claims')).not.toContain('打开');
  });
  it('today-onboarding-new-11, w4-today-setup-06 · an open mark is the to-do ○, one colour on every page — never the waiting signal\'s magenta', () => {
    const h = renderPilotReadiness(pr(), 'en', null);
    expect(h).toContain('<span class="mk dot todo">○</span>');
    expect(h).not.toContain('<span class="mk dot warn">○</span>');
    expect(h).not.toContain('<span class="mk">○</span>');
    expect(css).toContain('.pr.todo .mk:not(.dot) { color:var(--color-ink-secondary); }');
    expect(renderReady(readyView(false, false, false), 'en')).toContain('<span class="mk dot todo" aria-hidden="true">○</span>');
    expect(renderReady(readyView(false, false, false), 'en')).not.toContain('dot warn');
  });
  it('today-onboarding-missed-12, missed-13, missed-14 · Spanish, English and Arabic words', () => {
    expect(t('es', 'ops.health.title')).not.toBe('Estado de las entregas');
    expect(t('es', 'pilot.blocker.sandbox')).not.toContain('de abajo');
    for (const h of [runbook('en') + screens('en'), renderReady(readyView(false, false, false), 'en')]) expect(h).not.toMatch(/Practise/);
    const ar = runbook('ar') + screens('ar') + renderReady(readyView(false, false, false), 'ar');
    expect(ar).not.toMatch(/الإطلاق|الانطلاق|التمرّن/);
  });
});

// ── The machine room ────────────────────────────────────────────────────────
describe('Phase 9 · Technical details', () => {
  it('V1-141 · the tab is named by the page\'s heading', () => {
    const h = page('en', '/app/onboarding/technical', inScope(() => renderPilotTechnical('en')));
    expect(h).toContain(`<title>${t('en', 'pilot.technical.title')} · 义乌宏发日用品厂 (demo)</title>`);
  });
  it('V1-143 · an Arabic value is in the page\'s face, at its labels\' size', () => {
    expect(css).toContain(':lang(ar) .rbrow .mono { font-family:inherit; font-size:var(--font-size-small); line-height:inherit; }');
  });
  it('V1-144 · the safety checks say what was checked', () => {
    expect(t('en', 'runbook.engine.ok', { n: 13 })).toContain('lowest price you set');
    for (const l of LOCALES) expect(t(l, 'runbook.engine.ok', { n: 13 }).length, l).toBeGreaterThan(60);
  });
  it('today-onboarding-missed-18 · the re-opening limit in plain words, and whose it is to ask for', () => {
    for (const l of LOCALES) expect(t(l, 'meta.template.none'), l).toContain('Nomi');
    expect(t('en', 'meta.template.none')).not.toContain('cannot be re-opened');
  });
});

// ── Ready for customers ─────────────────────────────────────────────────────
describe('Phase 9 · Ready for customers', () => {
  it('V1-147 · each thing that must be in place is named positively, its state in words beside the mark', () => {
    for (const l of LOCALES) {
      const h = bare(renderReady(readyView(false, true, false), l));
      expect(h, l).toContain(`<span class="lbl">${esc(t(l, 'pilot.attest.assistant_named'))}</span>\n      <span class="rd-state">${esc(t(l, 'ready.name.todo'))}</span>`);
      expect(h, l).toContain(`<span class="rd-state">${esc(t(l, 'ready.channel.done'))}</span>`);
    }
    expect(t('en', 'ready.name.todo')).toBe('Not confirmed yet');
  });
  it('V1-148 · the intro says plainly that a thing seen once stays ticked', () => {
    expect(t('en', 'ready.intro')).toContain('it stays ticked');
    for (const l of LOCALES) expect(t(l, 'ready.intro'), l).not.toMatch(/Seen once is seen|Lo visto una vez cuenta como visto|يبقى مشاهدًا|看过一次就算看过|c’est vu/);
  });
  it('V1-150 · each open item has its own door — the step\'s own words', () => {
    const h = renderReady(readyView(false, false, false), 'en');
    expect(h).toContain(`<a class="deeper" href="${STEP_LINK.name}">${esc(t('en', 'factory.next.name'))}`);
    expect(h).toContain(`<a class="deeper" href="${STEP_LINK.channels}">${esc(t('en', 'factory.next.channels'))}`);
    expect(h).toContain(`<a class="deeper" href="/app/employee">${esc(t('en', 'ready.alone.go'))}`);
    expect(h).toContain('href="/app/sandbox"');
    expect(renderReady(readyView(true, true, true), 'en')).not.toContain(`href="${STEP_LINK.name}"`);
  });
  it('today-onboarding-missed-20 · the Spanish lines read as Spanish', () => {
    for (const k of ['handed_over', 'discount_held', 'stop_handoff', 'person_handoff', 'price_handed'])
      expect(t('es', `practice.check.${k}` as MessageKey), k).not.toMatch(/pasada a ti|retenido para ti|pasado a ti/);
  });
});

// ── Setup ───────────────────────────────────────────────────────────────────
describe('Phase 9 · Setup', () => {
  it('V1-155 · phase 7 · while setting up is unfinished, Setup says how far it has come, and the five steps are one tap down', () => {
    // The landing is a menu: its Getting started row carries the count; the
    // steps, each with its door, are on the guide it opens (renderGuide).
    for (const l of LOCALES) {
      const h = setupHtml(l).replace(/[\u2066-\u2069]/g, '');
      expect(h, l).not.toContain('sr-step');
      expect(h, l).toMatch(new RegExp(`href="/app/guide">[^]*?<span class="sr-value warn"><bdi>${esc(t(l, 'nav.setup.progress', { done: '\\d', total: '5' }))}</bdi>`));
      const guide = renderGuide({ steps: SETUP_STEPS.map((step) => ({ step, done: false })), next: 'profile' }, l, 'Lily', () => false);
      for (const step of SETUP_STEPS) expect(guide, `${l} ${step}`).toContain(`href="${STEP_LINK[step]}"`);
    }
    expect(setupHtml('en', { setup: { steps: SETUP_STEPS.map((step) => ({ step, done: true })), done: 5, total: 5, next: null } }))
      .toContain(`<span class="sr-value ok"><bdi>${t('en', 'setup.state.done')}</bdi></span>`);
  });
  it('today-onboarding-new-22 · a row\'s line does not repeat its label', () => {
    for (const l of LOCALES) expect(t(l, 'setup.desc.kind').toLocaleLowerCase(), l).not.toContain(t(l, 'business.kind.label').toLocaleLowerCase());
  });
  it('today-onboarding-new-23 · every row not answered yet waits for the owner the same way', () => {
    // Phase 7 — the kind of business and How you sell are My business's rows
    // now (factory.test.ts, warmth-settings-business.test.ts); Setup's own
    // unfinished rows wait the same way.
    const h = setupHtml('en');
    expect(h).toContain(`<span class="sr-value warn"><bdi>${t('en', 'setup.value.nameNotConfirmed')}</bdi></span>`);
    expect(h).not.toContain('href="/app/settings/business"');
    expect(h).not.toContain('href="/app/business/selling"');
  });
  it('today-onboarding-new-24 · alerts not on here say so as the alerts page does — no unexplained "here"', () => {
    expect(t('en', 'setup.value.unavailable')).toBe('Not switched on yet');
    for (const l of LOCALES) expect(t(l, 'setup.value.unavailable'), l).not.toMatch(/\bhere\b|这里|هنا|aquí|ici/);
  });
  it('today-onboarding-new-25 · phase 7 · Setup is eight rows in two cards: read, not searched', () => {
    // The search was for six groups and a dozen rows; it went with the length.
    for (const l of LOCALES) {
      const h = setupHtml(l);
      expect(h, l).not.toContain('role="search"');
      expect(h.match(/<a class="srow sr-menu/g), l).toHaveLength(8);
      expect(h.match(/<ul class="scard">/g), l).toHaveLength(2);
    }
  });
  // The warmth run: Log out left the rail and Setup; it is the foot of Settings,
  // a button drawn as Settings' last row, in its own card.
  it('V1-154 · Log out is a button, the last thing on Settings', () => {
    const home = inScope(() => renderSettingsHome('en', null));
    expect(home).toMatch(new RegExp(`<form class="scard sr-foot" method="post" action="/logout">\\s*<button class="srow sr-menu sr-out" type="submit">[\\s\\S]*${t('en', 'header.logout')}`));
    expect(home.lastIndexOf('/logout')).toBeGreaterThan(home.lastIndexOf('href="/app/settings/setup"'));
    expect(setupHtml('en')).not.toContain('/logout');
  });
  it('V1-157 · Chinese names the people page and the billing group for what they are', () => {
    expect(t('zh', 'people.title')).not.toBe('这里有谁');
    expect(t('zh', 'setup.group.account')).not.toContain('付款');
  });
  it('the language switch wraps inside Setup\'s card on a phone (five languages; it ran past the card)', () => {
    expect(css).toContain('.scard .langsw { flex-wrap:wrap; }');
  });
});
