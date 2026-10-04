import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { renderFactory, renderBusinessScreen, BUSINESS_SCREEN_PATH, type BusinessScreen, type FactoryView } from '../../src/api/web/factory.js';
import type { Viewer } from '../../src/core/conversation/people.js';
import type { ChannelView } from '../../src/api/web/channels.js';
import type { ActivationRefusal } from '../../src/channels/activation.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import type { MessageKey } from '../../src/core/owner/i18n/messages.js';
import { t as say } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import { readFileSync } from 'node:fs';
import { withoutIsolates } from './isolates.js';
import { GO } from '../../src/api/web/icons.js';

/** V1 step four — My business's rules, as they sit in the shell's stylesheet. */
const factorySectionOfShell = (): string => {
  const src = readFileSync(new URL('../../src/api/web/layout.ts', import.meta.url), 'utf8');
  const start = src.indexOf('/* ── factory.ts');
  const end = src.indexOf('/* ──', start + 10);
  return start > 0 ? src.slice(start, end > start ? end : undefined) : '';
};


/**
 * THE WARMTH RUN, phase 7 — My business is a menu, and each of its old
 * sections a screen a level down. `screen` draws one; `everything` draws the
 * menu and every screen together, for what must hold wherever she reads it
 * (no unfilled placeholder, no software word, nothing she typed unescaped).
 */
const SCREENS = Object.keys(BUSINESS_SCREEN_PATH) as BusinessScreen[];
const screen = (s: BusinessScreen, v: FactoryView, l: Locale = 'en', viewer?: Viewer): string =>
  withoutIsolates(renderBusinessScreen(s, v, l, null, viewer));
const menu = (v: FactoryView, l: Locale = 'en', viewer?: Viewer): string => withoutIsolates(renderFactory(v, l, null, viewer));
const everything = (v: FactoryView, l: Locale = 'en', viewer?: Viewer): string =>
  [menu(v, l, viewer), ...SCREENS.map((x) => screen(x, v, l, viewer))].join('\n');

/** A catalogue sentence as the page prints it: the page's own `t`, escaped the same way. */
const shown = (l: Locale, key: MessageKey, params?: Record<string, string | number>): string => esc(say(l, key, params));

const channel = (connected: boolean) => ({
  kind: 'whatsapp' as const, connected,
  status: (connected ? 'connected' : 'not_connected') as ChannelView['status'],
  healthOk: connected, displayId: connected ? '+971 50 ••• 4444' : null,
  lastActivityAt: null, problem: null, activated: false,
});

/** A factory the owner has finished setting up. */
const complete: FactoryView = {
  profile: {
    name: 'Yiwu Sunrise Housewares', description: 'Vacuum cups and kitchen goods since 2011.',
    location: 'Yiwu, Zhejiang', workingHours: 'Mon–Sat 9:00–18:00',
    contactEmail: 'sales@sunrise.example', contactPhone: null,
    languagesServed: ['en', 'zh'],
  },
  products: { total: 12, needPrice: 0, names: [
    { name: 'Vacuum cup', nameZh: '保温杯' }, { name: 'Lunch box', nameZh: '饭盒' },
    { name: 'Thermos', nameZh: '热水瓶' }, { name: 'Kettle', nameZh: '水壶' }] },
  promises: { certs: ['food_grade', 'BPA_free'], floorLow: usd(0.75), floorHigh: usd(0.75), ceilingPct: 8, ceilingVaries: false,
    askPct: 5, askVaries: false },
  connection: { channel: channel(true), ownerPhone: '971500001111' },
  nextStep: null,
  readiness: { canActivate: true, blockers: [], lifecycle: 'ready', live: false, activatedAt: null, activatedBy: null,
    recipients: [{ phone: '971500001111', label: 'my phone' }, { phone: '971500002222', label: null }] },
  rehearsal: { findings: [], violations: [], probesRun: 26, productsChecked: 12, productsTotal: 12 },
  // A discount she wrote: without one, nothing ever comes off and the ceiling
  // and ask line limit nothing (phase 9 — see the no-discount test below).
  prices: { currency: 'USD', businessDefault: { floor: usd(0.35), maxDiscountPct: 10, askAbovePct: 7 },
    products: [], unanswered: 0,
    volume: [{ id: 'v1', productId: null, productLabel: null, minQty: 10000, discountPct: 4, asksFirst: false }] },
};

/** A factory on its first day. */
const fresh: FactoryView = {
  profile: {
    name: '', description: null, location: null, workingHours: null,
    contactEmail: null, contactPhone: null, languagesServed: [],
  },
  products: { total: 0, needPrice: 0, names: [] },
  promises: { certs: [], floorLow: null, floorHigh: null, ceilingPct: null, ceilingVaries: false },
  connection: { channel: channel(false), ownerPhone: null },
  nextStep: 'profile',
  readiness: { canActivate: false, blockers: ['no_channel', 'no_allowlist'], recipients: [], lifecycle: 'not_connected',
    live: false, activatedAt: null, activatedBy: null },
  // Nothing to rehearse on day one — no products means no probes, so the whole
  // block is absent rather than reporting an empty success.
  rehearsal: { findings: [], violations: [], probesRun: 0, productsChecked: 0, productsTotal: 0 },
  prices: { businessDefault: null, products: [], unanswered: 0, volume: [], currency: 'USD' },
};

describe('Phase E · My factory answers the owner’s four questions', () => {
  it('phase 7 · the landing is a menu: every former section a row, in the order an owner thinks about them', () => {
    const html = menu(complete);
    const rows = [...html.matchAll(/<a class="srow sr-menu[^"]*" href="([^"]+)">[\s\S]*?<span class="sr-label">([^<]+)<\/span>/g)].map((m) => [m[1], m[2]]);
    expect(rows).toEqual([
      ['/app/settings/profile', shown('en', 'settings.profile.title')],
      // w4-whole-14 — a short form of the page's own name ("What you do, your country and your website").
      ['/app/settings/business', shown('en', 'business.row.kind')],
      [BUSINESS_SCREEN_PATH.channels, shown('en', 'factory.reach.title')],
      [BUSINESS_SCREEN_PATH.ready, shown('en', 'business.row.live')],
      ['/app/products', shown('en', 'nav.products')],
      ['/app/business/prices', shown('en', 'factory.prices.title')],
      [BUSINESS_SCREEN_PATH.promises, shown('en', 'factory.promise.title')],
      [BUSINESS_SCREEN_PATH.how, shown('en', 'factory.sellhow.title')],
    ]);
    // Phase 9 (V1-390) — no grey question restating each heading in another voice.
    for (const q of ['Who are we?', 'What do we sell?', 'Where can customers reach us?', 'class="fq"'])
      expect(html).not.toContain(q);
  });

  it('the profile row says where the profile stands: done once setting up has what it asks of it', () => {
    // The business's name heads every page already (the shell); the row says
    // whether the profile holds a description, a place and a way to be reached.
    expect(menu(complete)).toContain(`<span class="sr-value ok"><bdi>${shown('en', 'setup.state.done')}</bdi></span>`);
    // the facts themselves have ONE home, the profile page the row opens (two doors, one data)
    expect(menu(complete)).not.toContain('Vacuum cups and kitchen goods since 2011.');
    const noPlace = menu({ ...complete, profile: { ...complete.profile, location: null } });
    // w4-business-assistant-02 — a setting not finished is said in words; the waiting colour is for customers who wait.
    expect(noPlace).toContain(`<span class="sr-value"><bdi>${shown('en', 'setup.state.toDo')}</bdi></span>`);
  });

  it('products are a real count with the honest pricing state', () => {
    expect(menu(complete)).toContain('<span class="sr-value"><bdi>12 products</bdi></span>');
    expect(menu(complete)).toContain(shown('en', 'factory.sell.allPriced'));
    const some = menu({ ...complete, products: { ...complete.products, needPrice: 3 } });
    expect(some).toContain('3 still need a price');
  });

  it('promises are the guard’s allowlist, named in the owner’s words not the guard’s keys', () => {
    const html = screen('promises', complete);
    expect(html).toContain('Food-safe materials'); expect(html).toContain('BPA free');
    expect(html).not.toContain('>food_grade<');      // never an internal key on the page (the form's own value is not read)
    // The warmth run, phase 9 (w4-products-knowledge-02) — the one place they are switched: each on, in words.
    expect(html).toMatch(/<b><bdi>Food-safe materials<\/bdi><\/b> <span class="pill ok">On<\/span>/);
    expect(html).toContain('action="/app/knowledge/cert"');
    expect(html).toContain(shown('en', 'factory.promise.never'));      // default-deny, in owner language — true of this page now
    // meaning arrives before the tokens it explains
    expect(html.indexOf(shown('en', 'knowledge.cert.scopeAll', { n: complete.products.total }))).toBeLessThan(html.indexOf('Food-safe materials'));
    // what may be promised about returns and delivery is said to be answered in How you sell, with its door
    expect(html).toContain(shown('en', 'factory.promise.elsewhere'));
    expect(html).toContain(`href="${BUSINESS_SCREEN_PATH.how}"`);
    // and the menu's row names them too, never by key
    expect(menu(complete)).toContain('<bdi>Food-safe materials · BPA free</bdi>');
  });

  it('states the three rules the guard actually enforces', () => {
    // quote.ts clamps the price at the floor and the discount at the ceiling,
    // and since G7a a discount past her ask-first line holds the reply for her
    // (core/conversation/hold.ts). Before G7a that line decided nothing, so the
    // page did not state it; now it is a gate, so it is a promise.
    const rules = screen('promises', complete).match(/<ul class="frules">[\s\S]*?<\/ul>/)![0];
    expect(rules).toContain('never quotes below $0.75');
    expect(rules).toContain('never discounts more than 8%');
    expect(rules).toContain(shown('en', 'factory.promise.ask', { ask: 5 }));
  });

  it('G9a · a sales assistant sees whether messaging is live — not the switch, and not a link to the floor', () => {
    expect(screen('ready', complete)).toContain('action="/app/business/activate"');
    expect(menu(complete)).toContain('href="/app/business/prices"');
    const staff = { isOwner: false };
    expect(everything(complete, 'en', staff)).not.toMatch(/action="\/app\/business\/(activate|deactivate)"/);
    expect(everything(complete, 'en', staff)).not.toContain('href="/app/business/prices"');
    expect(screen('ready', complete, 'en', staff)).toContain('The owner decides this.');
    // the price limits' row still says where they stand, with no door to a refusal
    expect(menu(complete, 'en', staff)).toMatch(/<div class="srow sr-menu">[^]*?<span class="sr-label">Your price limits<\/span>/);
  });

  it('an ask line at the ceiling is never stated — the clamp means the owner is never asked', () => {
    // the part of the ask sentence that does not depend on the number
    const askTail = esc(say('en', 'factory.promise.ask', { ask: '§' }).split('§')[1]!);
    const askVariesTail = esc(say('en', 'factory.promise.askVaries', { ask: '§' }).split('§')[1]!);
    for (const askPct of [8, 9, null]) {
      const rules = screen('promises', { ...complete, promises: { ...complete.promises, askPct } })
        .match(/<ul class="frules">[\s\S]*?<\/ul>/)![0];
      expect(rules, String(askPct)).not.toContain(askTail);
      expect(rules, String(askPct)).not.toContain(askVariesTail);
    }
  });

  it('a catalogue with different floors reports the range, never one product’s number', () => {
    // The guard reads the PER-PRODUCT policy; quoting a single business-wide
    // floor described numbers no quote had ever used.
    const html = screen('promises', { ...complete, promises: {
      ...complete.promises, floorLow: usd(0.30), floorHigh: usd(2.40), ceilingVaries: true } });
    expect(html).toContain('$0.30');
    expect(html).toContain('$2.40');
    expect(html).toContain('less on some products');
    expect(html).not.toMatch(/never quotes below \$0\.30\./);   // not stated as THE floor
  });

  it('price rules appear only when the owner actually has them', () => {
    const none = screen('promises', { ...complete, promises: { certs: [], floorLow: null, floorHigh: null, ceilingPct: null, ceilingVaries: false } });
    expect(none).not.toContain('never quotes below');
    expect(none).not.toContain('never discounts more than');
    expect(none).not.toContain('class="pill ok"');                    // every certification says Off
    expect(none).toContain(shown('en', 'factory.promise.never'));       // the rule holds even with nothing allowed
  });

  it('phase 9 · with no discount written, it says nothing comes off — never a ceiling that limits nothing', () => {
    // computeQuote takes a discount only from a rule she wrote; the price page
    // says the same, so the two pages can no longer disagree.
    for (const l of LOCALES) {
      const rules = screen('promises', { ...complete, prices: { ...complete.prices, volume: [] } }, l)
        .match(/<ul class="frules">[\s\S]*?<\/ul>/)![0];
      expect(rules, l).toContain(shown(l, 'factory.promise.noDiscount'));
      expect(rules, l).not.toContain(shown(l, 'factory.promise.ask', { ask: 5 }));
    }
    const en = screen('promises', { ...complete, prices: { ...complete.prices, volume: [] } });
    expect(en).toContain('offers no discount: you have not written one.');
    expect(en).not.toContain('never discounts more than');
  });

  it('connection says which of the four states it is in, and what that means', () => {
    const on = screen('channels', complete);
    expect(on).toContain('Connected');
    expect(on).toContain(shown('en', 'channel.state.ready.hint'));
    expect(on).toContain('+971 50 ••• 4444');
    const off = screen('channels', fresh);
    expect(off).toContain('Not connected');
    expect(off).toContain('Customers who write to your WhatsApp are not answered until it is connected.');
  });

  it('a finished factory shows no next step; a new one shows exactly one', () => {
    // V1 review fix: the next step is a door like the others, marked `next` so it can be counted.
    expect(menu(complete)).not.toContain('class="deeper next"');
    // w4-business-assistant-03 — never a second door to a row of this menu: the
    // profile, the products and where customers reach you are rows already.
    for (const step of ['profile', 'products', 'channels'] as const) {
      expect(menu({ ...fresh, nextStep: step }), step).not.toContain('class="deeper next"');
    }
    for (const [step, href] of [['name', '/app/onboarding#name'], ['first_success', '/app/inbox']] as const) {
      const html = menu({ ...fresh, nextStep: step });
      expect(html.split('class="deeper next"').length - 1, step).toBe(1);
      expect(html).toContain(`class="deeper next" href="${href}"`);
    }
  });

  it('an empty factory is honest about being empty, never a wall of zeros', () => {
    const html = menu(fresh);
    expect(html).toContain('nothing to tell customers about you yet');
    expect(html).toContain('nothing to quote yet');
    expect(html).not.toContain('>0<');
    expect(html.toLowerCase()).not.toContain('no data');
  });

  it('every section offers a way through to the surface that owns it', () => {
    // P5 — Practice is every workspace's own: its door is always drawn.
    const all = everything(complete);
    for (const href of ['/app/settings/profile', '/app/settings/business', '/app/products', '/app/business/prices', '/app/knowledge',
      '/app/channels/whatsapp', '/app/channels/meta', '/app/channels/email', '/app/channels/alerts', '/app/onboarding', '/app/sandbox',
      ...Object.values(BUSINESS_SCREEN_PATH)])
      expect(all, href).toContain(`href="${href}"`);
  });

  it('is a page, not a settings panel — it collects only go-live decisions', () => {
    // The menu collects nothing. Its screens collect only what they always did:
    // M20.3 activate/deactivate; M20.4 the allowlist, because the blocker
    // pointed there and had nowhere to send her; 0070 the owner's Stop / Start
    // on every channel; WA (0120) who gets replies. Every other edit happens
    // on the page that owns it. The warmth run, phase 9 (w4-products-knowledge-02):
    // the certifications, whose one place is What you promise customers.
    expect(menu(complete)).not.toContain('<form');
    const live = { ...complete, readiness: { ...complete.readiness, lifecycle: 'active' as const, live: true } };
    const forms = [...everything(complete).matchAll(/<form[^>]*action="([^"]*)"/g), ...everything(live).matchAll(/<form[^>]*action="([^"]*)"/g)];
    expect(forms.length).toBeGreaterThan(0);
    for (const f of forms)
      expect(f[1]).toMatch(/^\/app\/business\/(activate|deactivate|stop-assistant|start-assistant|allowlist\/(add|remove)|pilot\/(end|resume))$|^\/app\/knowledge\/cert$/);
    expect(everything(complete)).not.toContain('<textarea');
    expect(everything(complete)).not.toContain('<table');
  });
});

describe('Phase E · language (all locales, RTL-safe)', () => {
  it('renders fully in every locale and each keeps its own words', () => {
    for (const l of LOCALES) expect(everything(complete, l).length).toBeGreaterThan(800);
    const zh = everything(complete, 'zh');
    expect(zh).toContain('我的生意'); expect(zh).toContain(shown('zh', 'settings.profile.title')); expect(zh).toContain('你对客户的承诺');
    expect(zh).not.toContain('Business profile');
    const ar = everything(complete, 'ar');
    expect(ar).toContain('نشاطي التجاري'); expect(ar).toContain(shown('ar', 'factory.reach.title')); expect(ar).toContain(shown('ar', 'factory.promise.title'));
    expect(ar).not.toContain('Business profile');
  });

  it('the empty and next-step states are localized too — no English leaks', () => {
    for (const l of ['zh', 'ar'] as const) {
      const html = everything(fresh, l).replace(/<style>[\s\S]*?<\/style>/g, '');
      expect(html).not.toMatch(/nothing to (tell|quote)/);
      expect(html).not.toContain('Not connected');
      expect(html).not.toContain(shown('en', 'factory.next.profile'));
    }
  });

  it('uses the shell’s one “go deeper” link and the menu’s one row, rather than page-local variants', () => {
    expect(screen('promises', complete)).toContain('<a class="deeper" href="/app/knowledge">');
    expect(menu(complete)).toContain('<a class="srow sr-menu" href="/app/settings/profile">');
    expect(menu(complete)).toContain(GO);
    expect(everything(complete)).not.toContain('class="fmore"');
  });

  it('Latin runs are isolated so an Arabic reader gets them in source order', () => {
    // a connected number and a value she typed are Latin inside an Arabic page;
    // a value's cell takes the page's direction and its <bdi> isolates the words (w4-whole-08)
    expect(screen('channels', complete, 'ar')).toContain('<bdi>+971 50 ••• 4444</bdi>');
    expect(menu({ ...complete, promises: { ...complete.promises, certs: [] }, menu: { kind: null, howYouSell: null, terms: null,
      samples: { price: null, waiting: 0 }, closure: null, rate: null } }, 'ar')).toMatch(/<span class="sr-value[^"]*"><bdi>/);
  });

  it('a channel that cannot carry a message is its own remedy — the row opens the fix', () => {
    // Phase 9 (new-01) — a paused number waits for the owner (○); one never
    // connected waits on nothing, so it carries no state colour.
    const wa = (lc: FactoryView['readiness']['lifecycle'], l: Locale = 'ar') => screen('channels', { ...complete, readiness: { ...complete.readiness, lifecycle: lc } } as FactoryView, l)
      .match(new RegExp(`<a class="srow sr-menu sr-two" href="/app/channels/whatsapp">[^]*?<span class="sr-label">${shown(l, 'reach.channel.whatsapp')}</span>[^]*?</a>`))![0];
    expect(wa('paused')).toContain(`<span class="sr-value warn"><bdi>${shown('ar', 'channel.state.paused')}</bdi></span>`);
    expect(wa('not_connected')).toContain(`<span class="sr-value"><bdi>${shown('ar', 'channel.state.not_connected')}</bdi></span>`);
    for (const lc of ['ready', 'active'] as const) expect(wa(lc, 'en'), lc).toContain('<span class="sr-value ok">');
  });

  it('RTL-safe layout: no physical left/right in the page’s styles, which live in the shell now', () => {
    // V1 step four: My business carries no stylesheet; its rules are the shell's
    // "factory.ts" section. The page must be bare, and that section logical.
    expect(everything(complete, 'ar')).not.toContain('<style');
    const style = factorySectionOfShell();
    expect(style.length).toBeGreaterThan(200);
    expect(style).not.toMatch(/\bmargin-left\b|\bmargin-right\b|\bpadding-left\b|\bpadding-right\b/);
    expect(style).not.toMatch(/\bborder-left\b|\bborder-right\b|\btext-align:\s*(left|right)\b/);
  });

  it('no message is left half-written: every placeholder is filled, every locale', () => {
    for (const l of LOCALES) {
      for (const view of [complete, fresh]) {
        const html = everything(view, l).replace(/<style>[\s\S]*?<\/style>/g, '');
        expect(html.match(/\{[a-zA-Z]+\}/g) ?? [], `${l}: unsubstituted placeholder`).toEqual([]);
      }
    }
  });

  it('escapes everything the owner typed', () => {
    const evil = everything({
      ...complete,
      profile: { ...complete.profile, name: '<script>alert(1)</script>', description: '<img src=x onerror=alert(1)>' },
      connection: { ...complete.connection, channel: { ...complete.connection.channel, displayId: '<img src=x onerror=alert(2)>' } },
      readiness: { ...complete.readiness, recipients: [{ phone: '971500001111', label: '</li><script>bad()</script>' }] },
    });
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).not.toContain('<img src=x onerror');
    expect(evil).not.toContain('<script>bad()</script>');
    expect(evil).toContain('&lt;script&gt;');
  });

  it('speaks about a business, never about software — any locale', () => {
    for (const l of LOCALES) {
      const all = (everything(complete, l) + everything(fresh, l)).toLowerCase();
      for (const banned of [
        'ai', 'llm', 'model', 'token', 'api', 'webhook', 'database', 'confidence', 'automation', 'prompt',
        'configure', 'configuration', 'settings panel', 'policy engine', 'validation', 'constraint',
        'provider', 'adapter', 'credential', 'tenant', 'claims_policy', 'pricing policy',
        '模型', '人工智能', '数据库', '置信度', '接口', '配置',
      ]) {
        const hit = /^[a-z_ ]+$/.test(banned) ? new RegExp(`\\b${banned}\\b`).test(all) : all.includes(banned);
        expect(hit, `${l}:"${banned}"`).toBe(false);
      }
    }
  });

  it('invents no metric: no score, no rating, no performance percentage', () => {
    for (const l of LOCALES) {
      const html = everything(complete, l).replace(/<style>[\s\S]*?<\/style>/g, '')
          // Excised BY PROVENANCE, not by value. `.frules` holds the numbers
          // the OWNER wrote (her floor, her ceiling, her ask line); everything
          // left must contain no percentage at all. A whitelist of literals
          // ('8%','10%') would pass a computed metric that happened to render as 10%.
          .replace(/<ul class="frules">[\s\S]*?<\/ul>/, '');
      for (const banned of ['score', 'rating', 'ranking', 'accuracy', 'performance', '评分', '成功率'])
        expect(html.toLowerCase().includes(banned), `${l}:${banned}`).toBe(false);
      // A number she wrote down is not a metric; a number we computed about her
      // would be. With the owner's region removed, NO percentage may survive.
      expect(html).not.toMatch(/\d+\s*%/);
    }
  });
});

/**
 * Release hardening — the wording on My factory must come from the SAME policy
 * the quote engine obeys. The Phase E defect was a second interpretation: the
 * page read `pricingPolicy(null)` while `turn.ts` reads `pricingPolicy(productId)`
 * and a per-product row wins, so the page described numbers no quote had used.
 */
describe('Release hardening · My factory quotes the guard, not a second reading', () => {
  it('what the page promises is what computeQuote actually enforces', async () => {
    const { computeQuote } = await import('../../src/core/commerce/quote.js');
    const { product, tiers, policy } = await import('./fixtures.js');

    // A catalogue with two products on DIFFERENT rules — the shape that broke it.
    // (Floors sit under the fixture's $0.38 tier price so both quotes are real.)
    const policies = [
      policy({ floorPrice: usd(0.30), maxDiscountPct: 8, humanRequiredAbovePct: 5 }),
      policy({ floorPrice: usd(0.36), maxDiscountPct: 12, humanRequiredAbovePct: 5 }),
    ];
    const floors = policies.map((p) => p.floorPrice.amount);
    const view: FactoryView = {
      ...complete,
      promises: {
        certs: [], floorLow: usd(Math.min(...floors)), floorHigh: usd(Math.max(...floors)),
        ceilingPct: Math.max(...policies.map((p) => p.maxDiscountPct)), ceilingVaries: true,
        askPct: Math.max(...policies.map((p) => p.humanRequiredAbovePct)), askVaries: false,
      },
    };
    const html = screen('promises', view);

    // 1. Every floor the page states must bound every real quote.
    // (Typing this fixture surfaced the assumption: floorLow is nullable,
    // and comparing a price against `null` would have compared against 0.)
    const stated = view.promises.floorLow;
    expect(stated, 'the page states no floor at all').not.toBeNull();
    for (const policy of policies) {
      const r = computeQuote({ product: product(), tiers: tiers(), policy, rules: [], quantity: 20000 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.unitPrice.amount).toBeGreaterThanOrEqual(stated!.amount);
    }

    // 2. The page must show the RANGE, never one product's number as "the" floor.
    expect(html).toContain('$0.30');
    expect(html).toContain('$0.36');
    expect(html).not.toMatch(/never quotes below \$0\.36\./);

    // 3. "Never more than X% — less on some products" is true on EVERY product
    //    only if X is the LARGEST ceiling. It used to be the smallest, which
    //    promised 8% while the 12% product was given 12%. Proven against the
    //    engine: every real discount sits at or under the stated figure.
    const stateCeil = view.promises.ceilingPct!;
    for (const policy of policies) {
      const r = computeQuote({
        product: product(), tiers: tiers(), policy, quantity: 20000,
        rules: [{ businessId: policy.businessId, priority: 1, condition: {}, action: { kind: 'discount_pct', value: 50 } }],
      });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.discountPct).toBeLessThanOrEqual(stateCeil);
    }
    expect(html).toContain('never discounts more than 12% — less on some products');
  });

  it('G7a · states the ask line, because it is a gate now — in every locale', async () => {
    // This test used to assert the opposite: `requiresHuman` was stored and
    // never read, so promising "she asks you first" described nothing. The
    // chain it now describes, end to end: her line → requiresHuman on the
    // discount actually given → a hold reason → the pipeline forces a draft.
    const { computeQuote } = await import('../../src/core/commerce/quote.js');
    const { holdReasonOf } = await import('../../src/core/conversation/hold.js');
    const { product, tiers, policy } = await import('./fixtures.js');
    const p = policy({ floorPrice: usd(0.10), maxDiscountPct: 8, humanRequiredAbovePct: 5 });
    const q = computeQuote({
      product: product(), tiers: tiers(), policy: p, quantity: 20000,
      rules: [{ businessId: p.businessId, priority: 1, condition: {}, action: { kind: 'discount_pct', value: 6 } }],
    });
    expect(q.ok).toBe(true);
    if (q.ok) expect(holdReasonOf({ provenance: 'typed', quote: q.value, turnText: '' })).toBe('discount_needs_owner');
    const { readFile } = await import('node:fs/promises');
    const turn = await readFile(new URL('../../src/pipeline/turn.ts', import.meta.url), 'utf8');
    expect(turn).toMatch(/\(r\.hold \|\| !mayDisclose\) \? 'draft' : policyMode/);

    const { t } = await import('../../src/core/owner/i18n/messages.js');
    const { esc } = await import('../../src/api/web/layout.js');
    for (const l of LOCALES) {
      const rules = screen('promises', complete, l).match(/<ul class="frules">[\s\S]*?<\/ul>/)?.[0] ?? '';
      expect(rules, l).toContain(esc(t(l, 'factory.promise.ask', { ask: 5, name: '' })));
    }
  });
});

describe('Release hardening · the catalogue speaks the owner’s language', () => {
  // Phase 7 — the menu shows a count, not a handful of names; the names are
  // read where a gap lists them, on going live (the products page lists all).
  const gaps: FactoryView = { ...complete,
    products: { ...complete.products, namesZh: { 'Vacuum cup': '保温杯' } },
    rehearsal: { findings: [{ reason: 'nothing_taught', productName: 'Vacuum cup', probeId: null }, { reason: 'nothing_taught', productName: 'Only English', probeId: null }],
      violations: [], probesRun: 4, productsChecked: 2, productsTotal: 2 } };
  const names = (l: 'en' | 'zh') => screen('ready', gaps, l).match(/<p class="fnames">.*?<\/p>/s)![0];

  it('a Chinese owner sees the Chinese product names her catalogue already holds', () => {
    expect(names('zh')).toContain('保温杯');
    expect(names('zh')).not.toContain('Vacuum cup');
    expect(names('en')).toContain('Vacuum cup');
    expect(names('en')).not.toContain('保温杯');
  });

  it('falls back to whichever name exists, never to a blank', () => {
    expect(names('zh')).toContain('<bdi>Only English</bdi>');
  });
});

/**
 * M20.2 — "Can messaging be activated now?" answered by the gate itself. The page may
 * never say more than the preconditions say, and never less.
 */
describe('M20.2 · the activation readiness surface', () => {
  // Phase 7 — the answer, the blockers and the switch are the going-live screen's.
  const withReadiness = (r: Partial<FactoryView['readiness']>, l: 'en' | 'zh' | 'ar' | 'es' | 'fr' = 'en') =>
    screen('ready', { ...complete, readiness: { ...complete.readiness, ...r } } as FactoryView, l);

  it('ready: says so, and names exactly who can receive a message', () => {
    const html = withReadiness({ canActivate: true, blockers: [], live: false });
    expect(html).toContain('can start talking to real customers whenever you say so');
    expect(html).toContain(shown('en', 'activation.recipients.title'));
    expect(html).toContain('my phone');
    expect(html).toContain('971500002222');          // no label → the number itself
  });

  it('ready: still says the owner decides — activation is not autonomy', () => {
    expect(withReadiness({ canActivate: true, blockers: [] }))
      .toContain(shown('en', 'activation.stillDrafts'));
  });

  it('not ready: states each blocker the gate reported, and nothing else', () => {
    const html = withReadiness({ canActivate: false, blockers: ['no_channel', 'secrets_not_rotated'] });
    expect(html).toContain('Connect WhatsApp.');
    expect(html).toContain(shown('en', 'activation.blocker.secrets_not_rotated'));
    expect(html).not.toContain(shown('en', 'activation.blocker.not_ready'));        // not a reported blocker
    expect(html).not.toContain('whenever you say so');
  });

  it('not ready: each blocker links to the place that fixes it', () => {
    expect(withReadiness({ canActivate: false, blockers: ['no_channel'] }))
      .toContain('<a class="blink" href="/app/channels/whatsapp">');
    expect(withReadiness({ canActivate: false, blockers: ['assistant_not_named'] }))
      .toContain('<a class="blink" href="/app/onboarding">');
    // Phase 9 — the keys are the operator's: nothing for the owner to open.
    expect(withReadiness({ canActivate: false, blockers: ['secrets_not_rotated'] }))
      .not.toContain('<a class="blink" href="/app/onboarding">');
  });

  it('phase 7 · the list of who may be messaged is a screen of its own, so its blocker opens it', () => {
    // M20.4 put the list on this page, so the blocker had no link; since phase
    // 7 the list is a level under where customers reach you, and the line opens it.
    const html = withReadiness({ canActivate: false, blockers: ['no_allowlist'] });
    expect(html).toContain('start with your own');
    expect(html).toMatch(new RegExp(`<a class="blink" href="${BUSINESS_SCREEN_PATH.allowlist}">[^<]*start with your own`));
  });

  it('live: reports that the assistant is talking to real buyers, and to whom', () => {
    const html = withReadiness({ live: true, canActivate: true, blockers: [] });
    expect(html).toContain('is talking to real customers');
    expect(html).toContain('my phone');
    expect(html).not.toContain('whenever you say so');   // already started
  });

  it('invents no grade: no score, no percentage, no “n of m ready”', () => {
    for (const l of LOCALES) {
      const cases: readonly { canActivate: boolean; blockers: readonly ActivationRefusal[] }[] = [
        { canActivate: true, blockers: [] },
        { canActivate: false, blockers: ['not_ready', 'no_allowlist'] },
      ];
      for (const r of cases) {
        const html = withReadiness(r, l).replace(/<style>[\s\S]*?<\/style>/g, '')
          .replace(/<ul class="frules">[\s\S]*?<\/ul>/, '')
          // M29 — same carve-out, same reason: the owner's own stated limits.
          // See the note on the sibling strip above about the non-greedy match:
          // it holds only while `.fprices` has no nested <div>.
          .replace(/<div class="fprices">[\s\S]*?<\/div>/, '');
        expect(html).not.toMatch(/\d+\s*%/);
        expect(html).not.toMatch(/\d+\s*(of|\/)\s*\d+/);
        for (const banned of ['score', 'grade', 'rating', '评分', '得分'])
          expect(html.toLowerCase().includes(banned), `${l}:${banned}`).toBe(false);
      }
    }
  });

  it('speaks owner language in every locale — no leaked blocker codes', () => {
    for (const l of LOCALES) {
      const html = withReadiness({ canActivate: false,
        blockers: ['schema_stale', 'not_ready', 'no_allowlist', 'secrets_not_rotated', 'no_channel'] satisfies readonly ActivationRefusal[] }, l);
      for (const code of ['schema_stale', 'not_ready', 'no_allowlist', 'secrets_not_rotated', 'no_channel'])
        expect(html.includes(code), `${l} leaks ${code}`).toBe(false);
    }
    expect(withReadiness({ canActivate: false, blockers: ['no_channel'] }, 'zh')).toContain('连接WhatsApp');
    expect(withReadiness({ canActivate: false, blockers: ['no_channel'] }, 'ar')).toContain(shown('ar', 'activation.blocker.no_channel'));
  });
});

/** M20.3 — going live is an owner decision, made here, and reversible here. */
describe('M20.3 · activate and deactivate as owner actions', () => {
  const view = (r: Partial<FactoryView['readiness']>, l: 'en' | 'zh' | 'ar' | 'es' | 'fr' = 'en') =>
    screen('ready', { ...complete, readiness: { ...complete.readiness, ...r } } as FactoryView, l);

  it('ready: offers the decision, and says what it does before it is taken', () => {
    const html = view({ canActivate: true, blockers: [], live: false });
    expect(html).toContain('action="/app/business/activate"');
    expect(html).toContain(shown('en', 'activation.action.activate'));
    expect(html).toContain(`data-confirm="${shown('en', 'activation.action.confirm')}"`);
    expect(html).toMatch(/data-confirm="[^"]*waits for your OK[^"]*"/);   // draft-first, in the question itself
    expect(html).toMatch(/data-confirm="[^"]*stop at any time[^"]*"/);   // and reversible
    expect(html).toContain(shown('en', 'activation.stillDrafts'));   // draft-first, stated
    expect(html).toContain('Only these people can receive a message');
  });

  it('not ready: no way to activate — the decision is not offered at all', () => {
    const html = view({ canActivate: false, blockers: ['no_channel'], live: false });
    expect(html).not.toContain('action="/app/business/activate"');
    expect(html).toContain('Connect WhatsApp.');
  });

  it('live: the stop control is there, and explains what stopping does', () => {
    const html = view({ live: true, canActivate: true, blockers: [] });
    expect(html).toContain('action="/app/business/deactivate"');
    // 2026-09-27 — Stop stops WhatsApp only (activation is WhatsApp's), and says so.
    expect(html).toContain(shown('en', 'activation.action.deactivate'));
    expect(shown('en', 'activation.action.deactivate')).toContain('WhatsApp');
    expect(html).toContain(shown('en', 'activation.stop.what'));
    expect(html).toContain('stay exactly as they are');          // nothing is deleted
    expect(html).toContain('start again whenever you want');     // rollback is possible
    expect(html).not.toContain('action="/app/business/activate"');
  });

  it('live: says when it started and who started it — from the stored row, as a NAME', () => {
    // G9b — the column holds whoever did it; the page says it in words. It
    // used to print the column: "by owner", and after M47 it would have
    // printed a uuid.
    const html = view({ live: true, activatedAt: new Date('2026-08-03T09:00:00Z'), activatedBy: 'owner' });
    expect(html).toMatch(/Started .* by you\./);
    const byChen = screen('ready', {
      ...complete, readiness: { ...complete.readiness, live: true, activatedAt: new Date('2026-08-03T09:00:00Z'), activatedBy: 'p-chen' },
      people: [{ id: 'p-chen', name: 'Xiao Chen', isOwner: false }],
    });
    expect(byChen).toMatch(/Started .* by Xiao Chen\./);
    expect(byChen).not.toContain('p-chen');
  });

  it('both decisions confirm first — neither fires on a stray tap', () => {
    expect(view({ canActivate: true, blockers: [] })).toContain('onclick="return confirm(this.dataset.confirm)"');
    expect(view({ live: true })).toContain('onclick="return confirm(this.dataset.confirm)"');
  });

  it('the controls and their warnings are localized', () => {
    expect(view({ canActivate: true, blockers: [] }, 'zh')).toContain(shown('zh', 'activation.action.activate'));
    expect(view({ live: true }, 'zh')).toContain(shown('zh', 'activation.action.deactivate'));
    expect(shown('zh', 'activation.action.deactivate')).toContain('WhatsApp');
    expect(view({ live: true }, 'zh')).toContain('什么都不会删掉');
    expect(view({ canActivate: true, blockers: [] }, 'ar')).toContain(shown('ar', 'activation.action.activate'));
    expect(view({ live: true }, 'ar')).toContain(shown('ar', 'activation.action.deactivate'));
  });

  it('activation is never described as autonomy', () => {
    for (const l of LOCALES) {
      const html = (view({ canActivate: true, blockers: [] }, l) + view({ live: true }, l)).toLowerCase();
      for (const banned of ['automatic', 'automatically', 'on its own', '自动', 'تلقائي'])
        expect(html.includes(banned), `${l}:${banned}`).toBe(false);
    }
  });
});

/** M20.3.1 — the page states one channel truth, in every language. */
describe('M20.3.1 · activation truth, localized', () => {
  // Phase 7 — one truth on two screens: the channel's state where customers
  // reach her, and what it means for going live. Both are read together.
  const at = (lifecycle: FactoryView['readiness']['lifecycle'], l: 'en' | 'zh' | 'ar' | 'es' | 'fr',
              over: Partial<FactoryView['readiness']> = {}) => {
    const v = { ...complete, readiness: {
      ...complete.readiness, lifecycle, live: lifecycle === 'active',
      canActivate: lifecycle === 'ready',
      blockers: lifecycle === 'ready' || lifecycle === 'active' ? [] : ['no_channel'],
      ...over } } as FactoryView;
    // the stylesheet carries English comments; the owner reads the markup
    return (screen('channels', v, l) + screen('ready', v, l)).replace(/<style>[\s\S]*?<\/style>/g, '');
  };

  it('each state reads as itself, and says what it means for the owner’s day', () => {
    expect(at('not_connected', 'en')).toContain('Not connected');
    expect(at('not_connected', 'en')).toContain('are not answered until it is connected');
    expect(at('ready', 'en')).toContain(shown('en', 'channel.state.ready.hint'));
    expect(at('active', 'en')).toContain(shown('en', 'channel.state.active.hint'));
    expect(at('paused', 'en')).toContain('Paused');
    expect(at('paused', 'en')).toContain('Reconnect to continue. Nothing was deleted');
  });

  it('THE BUG: a paused channel never offers to start, and never claims to be ready', () => {
    const html = at('paused', 'en');
    expect(html).toContain('Paused');
    expect(html).not.toContain('whenever you say so');
    expect(html).not.toContain('action="/app/business/activate"');
    expect(html).toContain('Connect WhatsApp.');            // the blocker, stated
  });

  it('a paused channel is not described as never-connected', () => {
    expect(at('paused', 'en')).not.toContain('Not connected');
    expect(at('not_connected', 'en')).not.toContain('Paused');
  });

  it('only READY offers the decision — the other three do not', () => {
    expect(at('ready', 'en')).toContain('action="/app/business/activate"');
    for (const lc of ['not_connected', 'paused', 'active'] as const)
      expect(at(lc, 'en'), lc).not.toContain('action="/app/business/activate"');
  });

  it('all four states, all three locales, with nothing falling back to English', () => {
    for (const lc of ['not_connected', 'ready', 'active', 'paused'] as const) {
      for (const l of ['zh', 'ar'] as const) {
        const html = at(lc, l);
        expect(html.length, `${l}/${lc}`).toBeGreaterThan(500);
        for (const en of ['Not connected', 'Paused', 'Ready —', 'is handling conversations'])
          expect(html.includes(en), `${l}/${lc} leaked "${en}"`).toBe(false);
      }
    }
    expect(at('paused', 'zh')).toContain('已暂停');
    expect(at('paused', 'zh')).toContain('重新连接就能继续');
    expect(at('paused', 'ar')).toContain('متوقف');
    expect(at('ready', 'zh')).toContain('准备好了');
    expect(at('active', 'ar')).toContain('يعمل');
  });

  it('RTL: the Arabic page still mirrors, and the state block stays logical', () => {
    const ar = at('paused', 'ar');
    expect(ar).toContain('class="go"');                       // mirrored by the shell
    const style = factorySectionOfShell();                     // V1 step four: the page's rules live there
    for (const physical of ['margin-left', 'margin-right', 'padding-left', 'padding-right',
                            'border-left', 'border-right', 'text-align:left', 'text-align:right'])
      expect(style.includes(physical), physical).toBe(false);
  });
});

/**
 * M20.4 (F-06) — in the M21 rehearsal the owner was told to add her own number
 * and there was nowhere to do it: one mention across every surface, no link,
 * no route. She could not finish setup without an engineer.
 */
describe('M20.4 · F-06 · the owner manages who may be messaged', () => {
  // Phase 7 — the list is a screen of its own, a level under where customers reach you.
  const view = (recipients: FactoryView['readiness']['recipients'], l: 'en' | 'zh' | 'ar' | 'es' | 'fr' = 'en') =>
    screen('allowlist', { ...complete, readiness: { ...complete.readiness, recipients } } as FactoryView, l);

  it('phase 7 · it is reached from where customers reach you, with how many are on it, and leads back there', () => {
    const reach = screen('channels', complete);
    expect(reach).toContain(`href="${BUSINESS_SCREEN_PATH.allowlist}"`);
    expect(reach).toContain(`<bdi>${shown('en', 'business.value.numbers.other', { n: 2 })}</bdi>`);
    expect(view([])).toMatch(new RegExp(`^<a class="back" href="${BUSINESS_SCREEN_PATH.channels}">`));
    // WhatsApp's alone: under a WhatsApp never connected and with nobody on it, there is no such row
    expect(screen('channels', fresh)).not.toContain(BUSINESS_SCREEN_PATH.allowlist);
  });

  it('THE M21 REPRODUCTION: there is now a way to add a number', () => {
    const html = view([]);
    expect(html).toContain('action="/app/business/allowlist/add"');
    expect(html).toContain('name="phone"');
  });

  it('empty list says so, and says to start with your own number', () => {
    expect(view([])).toContain('Add your own number first');
    expect(view([])).not.toContain('class="fsteps"><li class="done">');
  });

  it('each number can be removed, and removal confirms first', () => {
    const html = view([{ phone: '8613900001111', label: '老板本人' }]);
    expect(html).toContain('action="/app/business/allowlist/remove"');
    expect(html).toContain('value="8613900001111"');
    expect(html).toMatch(/data-confirm="[^"]*will stop answering them[^"]*"/);
  });

  it('states the consequence for everyone NOT on the list', () => {
    expect(view([])).toContain(shown('en', 'allowlist.note'));
    expect(view([])).toContain('still reaches you');
  });

  it('localized, and the number itself is bidi-isolated', () => {
    expect(view([], 'zh')).toContain(shown('zh', 'allowlist.title'));
    expect(view([], 'ar')).toContain(shown('ar', 'allowlist.title'));
    expect(view([{ phone: '8613900001111', label: null }], 'ar')).toContain('<bdi>8613900001111</bdi>');
  });

  it('no bulk import, no team management — one number at a time', () => {
    const html = view([]);
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('<textarea');
  });
});

/* ── Phase 9 · B5 — My business, as the re-audit read it ─────────────────── */

describe('Phase 9 · B5 · My business', () => {
  const NAMES = ['Canvas Tote Bag 38x40cm', 'Stainless Steel Thermos 500ml', 'Ceramic Coffee Mug 350ml', 'LED String Lights 10m',
    'Foldable Storage Box 40L', 'Kids Water Bottle with Straw'];
  // The audit's workspace: twelve products, no WhatsApp, nothing taught, no number for alerts.
  const audit: FactoryView = {
    ...complete,
    products: { total: 12, needPrice: 0, names: NAMES.slice(0, 4).map((n, i) => ({ name: n, nameZh: ['帆布袋', '保温杯', '陶瓷杯', 'LED灯串'][i]! })),
      namesZh: { 'Canvas Tote Bag 38x40cm': '帆布袋', 'Stainless Steel Thermos 500ml': '保温杯' } },
    connection: { channel: channel(false), ownerPhone: null, channelsUsed: [] },
    nextStep: 'channels',
    readiness: { canActivate: false, blockers: ['no_channel', 'no_allowlist'], recipients: [], lifecycle: 'not_connected',
      live: false, activatedAt: null, activatedBy: null, allowance: { pctUsed: null, used: false, renewsAt: new Date('2026-10-03T00:00:00Z') } },
    rehearsal: { findings: [...NAMES.map((n) => ({ reason: 'nothing_taught' as const, productName: n, probeId: null })),
      { reason: 'claim_not_authorised' as const, productName: null, probeId: null }], violations: [], probesRun: 30, productsChecked: 12, productsTotal: 12 },
  };
  // Phase 7 — "the page" is the menu and its screens; each test reads the screen it is about.
  const page = (l: Locale, v: FactoryView = audit) => everything(v, l);
  const text = (html: string) => html.replace(/<[^>]*>/g, ' ');
  const css = readFileSync(new URL('../../src/api/web/layout.ts', import.meta.url), 'utf8');

  it('V1-386 · V1-401 · a name and its "·" are one unit: no line breaks inside a name or starts with "·"', () => {
    for (const l of LOCALES) {
      const html = screen('ready', audit, l);
      const lists = html.match(/<p class="fnames">[\s\S]*?<\/p>/g) ?? [];
      // phase 7 — one list: the gaps' names (the menu shows a count, not names)
      expect(lists.length, l).toBe(1);
      for (const list of lists) {
        expect(list, l).not.toMatch(/<\/span>\s*·/);                       // no separator outside a unit
        expect(list, l).toMatch(/^<p class="fnames">(<span class="fitem"><bdi>[^<]+<\/bdi>( ·| …)?<\/span> ?)+<\/p>$/);
      }
    }
    expect(css).toMatch(/\.fitem \{ display:inline-block; \}/);
    expect(say('zh', 'factory.rehearsal.claim_not_authorised')).not.toContain('——');
  });

  it('V1-388 · the heading’s question is answered, from the same facts as the list under it', () => {
    for (const l of LOCALES) {
      const ready = (v: FactoryView) => screen('ready', v, l);
      expect(ready(audit), l).toContain(esc(say(l, 'factory.ready.answer.nothing')));
      const wa = ready({ ...audit, connection: { ...audit.connection, channelsUsed: ['whatsapp'] } });
      expect(wa, l).toContain(esc(say(l, 'factory.ready.answer.notYet.two').replace('{n}', '2')));
      const can = ready({ ...audit, readiness: { ...audit.readiness, canActivate: true, blockers: [], lifecycle: 'ready' }, connection: { ...audit.connection, channel: channel(true) } });
      expect(can, l).toContain(esc(say(l, 'factory.ready.answer.ready')));
      const live = ready({ ...audit, readiness: { ...audit.readiness, canActivate: true, blockers: [], lifecycle: 'active', live: true } });
      expect(live, l).toContain(esc(say(l, 'factory.ready.answer.live')));
      const stopped = ready({ ...audit, readiness: { ...audit.readiness, assistantStop: { stoppedAt: new Date(), stoppedBy: null } } });
      expect(stopped, l).toContain(esc(say(l, 'factory.ready.answer.held')));
    }
  });

  it('phase 7 · the menu’s Going live row says the same answer in a word, with its signal', () => {
    const value = (v: FactoryView) => menu(v).match(new RegExp(`href="${BUSINESS_SCREEN_PATH.ready}">[^]*?<span class="sr-value([^"]*)"><bdi>([^<]+)</bdi>`))!.slice(1, 3);
    expect(value(audit)).toEqual(['', shown('en', 'setup.state.notConnected')]);
    // w4-business-assistant-02 — not ready yet is a state of the settings, not a customer waiting: no waiting colour.
    expect(value({ ...audit, connection: { ...audit.connection, channelsUsed: ['whatsapp'] } })).toEqual(['', shown('en', 'business.live.notYet')]);
    expect(value({ ...audit, readiness: { ...audit.readiness, canActivate: true, blockers: [], lifecycle: 'ready' } })).toEqual([' ok', shown('en', 'business.live.ready')]);
    expect(value({ ...audit, readiness: { ...audit.readiness, lifecycle: 'active', live: true } })).toEqual([' ok', shown('en', 'business.live.on')]);
    expect(value({ ...audit, readiness: { ...audit.readiness, assistantStop: { stoppedAt: new Date(), stoppedBy: null } } })).toEqual([' warn', shown('en', 'business.live.stopped')]);
    expect(value({ ...audit, readiness: { ...audit.readiness, opsSilenced: true } })).toEqual([' warn', shown('en', 'business.live.paused')]);
  });

  it('V1-389 · the allowance says what it limits, with no "workspace" and no money word', () => {
    for (const l of LOCALES) expect(screen('ready', audit, l), l).toContain(esc(say(l, 'business.allowance.none')));
    expect(say('en', 'business.allowance.none')).toMatch(/messages/);
    expect(say('en', 'business.allowance.title') + say('en', 'business.allowance.none')).not.toMatch(/workspace|allowance/i);
    expect(say('ar', 'business.allowance.title')).not.toContain('رصيد');
    expect(say('zh', 'business.allowance.none')).not.toContain('工作台');
    expect(say('es', 'business.allowance.none')).not.toContain('espacio de trabajo');
  });

  it('V1-390 · V1-399 · no grey sub-question in any voice, in any language', () => {
    for (const l of LOCALES) expect(page(l), l).not.toContain('class="fq"');
    expect(page('es')).not.toContain('¿tu asistente');
  });

  it('V1-391 · V1-402 · missed-04 · the price row is named like the page it opens; "floor" is not a word here', () => {
    for (const l of LOCALES) expect(say(l, 'factory.prices.title'), l).toBe(say(l, 'prices.title'));
    expect(say('zh', 'factory.prices.title')).toBe('你的价格底线');
    expect(say('ar', 'factory.prices.title')).toBe('حدود أسعارك');
    expect(text(page('en'))).not.toMatch(/\bfloor\b/);
    expect(say('zh', 'factory.sellhow.title')).toBe(say('zh', 'hs.title'));
  });

  it('V1-392 · the first door is the questions, not the heading again; the rest say they are the same facts', () => {
    for (const l of LOCALES) {
      const html = screen('how', audit, l);
      // w4-business-assistant-24 — the row is the list's name and where it stands; no line repeating it.
      expect(html, l).toMatch(new RegExp(`href="/app/business/selling">[^]*?<span class="sr-label">${esc(say(l, 'hs.questions.title'))}</span></span>`));
      expect(say(l, 'hs.questions.title'), l).not.toBe(say(l, 'factory.sellhow.title'));
      expect(html, l).toContain(esc(say(l, 'factory.sellhow.direct')));
      for (const href of ['/app/settings/terms', '/app/settings/samples', '/app/settings/closures']) expect(html, `${l} ${href}`).toContain(`href="${href}"`);
    }
    expect(page('en')).not.toContain('exchange rate</p>');
    // the questions are the owner's (rule 11): a sales assistant sees the facts, never a door that refuses
    const staff = screen('how', audit, 'en', { isOwner: false });
    expect(staff).not.toContain('href="/app/business/selling"');
    expect(staff).not.toContain(esc(say('en', 'factory.sellhow.direct')));
    expect(staff).toContain('href="/app/settings/closures"');
  });

  it('V1-393 · one door per place: the details open the profile; each channel row opens Channels, with no second door', () => {
    expect(menu(audit)).toContain('<a class="srow sr-menu" href="/app/settings/profile">');
    expect(page('en')).not.toContain('href="/app/settings">');
    // Phase 9 (w4-business-assistant-05) — each channel row opens its own screen, once.
    const reach = screen('channels', audit);
    for (const s of ['whatsapp', 'meta', 'email', 'alerts']) expect(reach.split(`href="/app/channels/${s}"`).length - 1, s).toBe(1);
    expect(reach).not.toContain('href="/app/channels"');
    expect(reach).not.toContain(esc(say('en', 'factory.reach.more')));
    const ready = screen('ready', { ...audit, connection: { ...audit.connection, channelsUsed: [] } });
    expect(ready).not.toContain(`href="/app/channels">${esc(say('en', 'nav.channels'))}`);
    // nothing connected: the way to where customers reach her, by its name
    expect(ready).toContain(`href="${BUSINESS_SCREEN_PATH.channels}">${esc(say('en', 'factory.reach.title'))}`);
  });

  it('V1-394 · w4-business-assistant-06 · the alert number is a row of its own, its value as it stands; nothing says where alerts go', () => {
    const html = screen('channels', audit);
    expect(html).toMatch(new RegExp(`href="/app/channels/alerts">[^]*?<span class="sr-label">${esc(say('en', 'channels.alerts.title'))}</span>`));
    expect(html).not.toContain('You are alerted on');
    expect(html).not.toContain('You are not alerted yet');
  });

  it('V1-395 · a gap is a sentence and a door, not an underlined heading; no "checked all 12" under a list', () => {
    const html = screen('ready', audit);
    expect(html).not.toContain('class="blink" href="/app/knowledge"');
    expect(html).toContain(`<p class="fgap-s">${esc(say('en', 'factory.rehearsal.nothing_taught'))}</p>`);
    expect(html).toContain(`href="/app/knowledge">${esc(say('en', 'factory.rehearsal.fix.teach'))}`);
    expect(html).not.toContain('Checked all 12 of your products');
    expect(css).toMatch(/\.fgap-s \{[^}]*font-size:var\(--font-size-small\)/);
  });

  it('V1-396 · the door names the list it opens', () => {
    // w4-business-assistant-04 — the door says the name of the page it opens.
    for (const l of LOCALES) expect(screen('ready', audit, l), l).toContain(`href="/app/onboarding">${esc(say(l, 'pilot.title'))}`);
  });

  it('V1-397 · one language for the names on a Chinese page', () => {
    const zh = screen('ready', audit, 'zh');
    const gaps = zh.slice(zh.indexOf(esc(say('zh', 'factory.rehearsal.title'))));
    expect(gaps).toContain('<bdi>帆布袋</bdi>');
    expect(gaps).toContain('<bdi>保温杯</bdi>');
    expect(gaps).not.toContain('Canvas Tote Bag');
  });

  it('V1-398 · Arabic: no detached «لـ» before a name on this page', () => {
    const ar = text(page('ar'));
    expect(ar).not.toMatch(/لـ /);
  });

  it('V1-400 · the next step stands apart from the first heading; doors in a column keep its gap', () => {
    expect(css).toMatch(/\.lede \+ \.deeper\.next \{ margin-bottom:var\(--space-16\); \}/);
    expect(css).toMatch(/\.fblock \.doors \.deeper \{ margin-top:0; \}/);
  });

  it('new-01 · missed-02 · a WhatsApp never connected is a plain door, and speaks of WhatsApp only', () => {
    const html = screen('channels', audit);
    expect(html).toMatch(new RegExp(`<a class="srow sr-menu sr-two" href="/app/channels/whatsapp"><svg[^]*?</svg><span class="sr-main"><span class="sr-label">WhatsApp</span><span class="sr-desc">Customers who write to your WhatsApp are not answered until it is connected.</span></span><span class="sr-value"><bdi>`));
    expect(html).not.toContain('cannot receive or answer a customer');
    // phase 7 — the cards' rules went with the cards
    expect(css).not.toMatch(/\.fconn\.todo \{/);
  });

  it('missed-03 · the count’s noun agrees with the count in Arabic', () => {
    expect(menu(audit, 'ar')).toContain('<bdi>12 منتجًا</bdi>');
    expect(menu({ ...audit, products: { ...audit.products, total: 3 } }, 'ar')).toContain('<bdi>3 منتجات</bdi>');
    expect(menu({ ...audit, products: { ...audit.products, total: 1 } }, 'en')).toContain('<bdi>1 product</bdi>');
    expect(menu({ ...audit, products: { ...audit.products, total: 12 } }, 'zh')).toContain('<bdi>12个产品</bdi>');
  });

  it('V1-403 · no pictures for the channels', () => {
    for (const l of LOCALES) expect(page(l), l).not.toMatch(/📱|📷|💬|✉️/u);
  });

  it('V1-428 · the door to Practice says what the page is called, here and on the assistant’s page', () => {
    for (const l of LOCALES) expect(say(l, 'factory.ready.practice'), l).toBe(say(l, 'nav.sandbox'));
  });
});
