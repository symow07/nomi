import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { usd } from '../../src/core/types/money.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { messages, t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { formatQtyUnit, withUnit, labelled } from '../../src/core/owner/i18n/format.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { generatedSku, isGeneratedSku, ownSku } from '../../src/core/owner/sku.js';
import { shell, loginPage, signupPage, verifyPage, errorPage, esc, stylesheetAt } from '../../src/api/web/layout.js';
import { withWorkspace, withAssistantName, type RequestScope } from '../../src/api/web/say.js';
import { flashBanner } from '../../src/api/web/flash.js';
import type { EmployeeProfile } from '../../src/api/web/employee.js';
import { everyScreen } from './employee-screens.js';
import {
  renderProductList, renderProductDetail, type ProductListItem, type ProductDetail, type ProductEditField, type ProductEditError,
} from '../../src/api/web/products.js';
import { renderContacts, type ContactsView } from '../../src/api/web/contacts.js';
import type { ContactRow } from '../../src/db/contacts.js';
import { renderOrder, type OrderView } from '../../src/api/web/orders.js';
import { renderSandbox, type SandboxView } from '../../src/api/web/sandbox.js';
import type { PracticeTrust } from '../../src/trust/practiceChecks.js';
import { renderInboxList, renderConversationDetail, type InboxList, type ConversationDetail } from '../../src/api/web/inbox.js';
import { renderCustomerFile, type CustomerFile } from '../../src/api/web/conversations.js';
import { renderKnowledgeIndex, renderProductKnowledge, type ProductKnowledge } from '../../src/api/web/knowledge.js';
import { renderKnowledgeOps, renderKnowledgePeriod, type KnowledgeOps } from '../../src/api/web/knowledge-insights.js';
import { renderAnalytics, type AnalyticsData } from '../../src/api/web/analytics.js';
import { renderDataRights } from '../../src/api/web/dataRights.js';
import { renderSite, SITE_CSS } from '../../src/api/web/site.js';
import { signupModeFrom } from '../../src/core/owner/signup.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { linkedCss } from './linked-css.js';
import { withoutIsolates } from './isolates.js';

/**
 * The audit of 2026-09-20 (`docs/AUDIT-2026-09-20.md`), its last open rows,
 * closed on 2026-09-28: one `describe` per row, named by its number. Each
 * holds what was measured on the rendered pages that day and what closes it,
 * in the three languages wherever there is copy.
 */

const root = (rel: string) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(root(rel), 'utf8');
const WEB = 'src/api/web';
const webFiles = readdirSync(root(WEB)).filter((f) => f.endsWith('.ts')).map((f) => `${WEB}/${f}`);

const NOW = new Date('2026-07-27T10:00:00Z');
const NBSP = '\u00a0';
const scope = (over: Partial<RequestScope> = {}): RequestScope =>
  ({ name: null, several: false, outreach: false, setup: null, ...over });

/* ── fixtures, the smallest each page draws from ─────────────────────────── */

const employee: EmployeeProfile = {
  knows: 3, assistantNamed: true, spotChecks: [], hireDate: new Date('2026-07-09T00:00:00Z'),
  stage: 'partial', canDo: ['greet'], needConfirm: ['quote'],
  capabilities: [
    { capability: 'greet', mode: 'auto', promotable: false },
    { capability: 'quote', mode: 'draft', promotable: true },
  ],
  growth: [], promoted: true, conditions: [],
};

const item = (over: Partial<ProductListItem> = {}): ProductListItem => ({
  id: 'p1', name: 'Canvas bag', nameZh: '帆布袋', sku: 'ZX-100', moq: 1000, unit: 'pcs',
  entryQty: 5000, entryPrice: usd(0.92), learned: true, status: 'learned', imageMatchable: true, isActive: true, ...over,
});

const detail = (over: Partial<ProductDetail> = {}): ProductDetail => ({
  currency: 'USD',
  id: 'p1', name: 'Canvas Tote Bag', nameZh: '帆布袋', sku: 'ZX-100', category: 'bags',
  unit: 'pcs', moq: 1000, leadTimeDays: 15, customizable: false, learned: true, status: 'learned', isActive: true, imageMatchable: false,
  tiers: [{ minQty: 500, maxQty: 2000, unitPrice: usd(1.05) }, { minQty: 2000, maxQty: null, unitPrice: usd(0.92) }],
  aliases: [], images: [], recentQuotes: [{ quantity: 5000, unitPrice: usd(0.92), total: usd(4600) }], ...over,
});

const contact = (over: Partial<ContactRow> = {}): ContactRow => ({
  id: 'k1', channel: 'email', identity: 'ahmed@example.com', displayName: 'Ahmed',
  company: 'Gulf Trading', source: 'manual', firstSeen: NOW, archivedAt: null,
  consent: null, suppression: null, ...over,
});
const contacts = (rows: readonly ContactRow[]): ContactsView => ({ contacts: rows, outreach: new Map(), satisfied: new Set() });

const order = (over: Partial<OrderView> = {}): OrderView => ({
  orderId: 'o1', reference: 'PI-HF-20260803-0301', conversationId: 'c1',
  buyer: 'Ahmed', productName: 'Vacuum cup', productSku: 'ZX-200',
  quantity: 5000, unit: 'pcs', unitPriceAmount: 0.92, totalAmount: 4600,
  currency: 'USD', email: 'a@example.com', paymentTerms: '30% with order', incoterm: 'FOB',
  sellerName: 'Atlas Trading', confirmedAt: new Date('2026-08-01T00:00:00Z'),
  history: [{ state: 'shipped', at: new Date('2026-08-05T00:00:00Z'), trackingReference: 'MAEU123', note: null, by: 'owner' }],
  ...over,
});

const practice = (trust: Partial<PracticeTrust> = {}): SandboxView => ({
  hasConversation: true, messages: [], ownership: 'AI',
  lastTurn: {
    scenarioId: null, scenarioTitle: null, capability: 'quote', appliedMode: 'draft',
    guardViolations: 0, handoff: false, quote: { unitPrice: usd(0.85), total: usd(17000) },
    checks: [{ invariant: 'priceFloorRespected', pass: true, detail: 'ok' }], ...trust,
  },
});

const list: InboxList = {
  filter: 'all', waitingCount: 0, blockedCount: 0,
  conversations: [{
    conversationId: 'conv-1', buyer: 'Aisha Bello', country: 'NG',
    status: 'awaiting', needsAction: false, ownership: 'AI', heldBy: null, awaitingReview: false, handoffReason: null,
    latestMessage: 'Price for 5,000 pcs?', latestAt: NOW,
    product: { name: 'LED String Lights 10m', nameZh: 'LED灯串' }, quantity: 5000, unitPrice: usd(1.45),
  }],
};

const conversation: ConversationDetail = {
  conversationId: 'conv-1', buyer: 'Aisha Bello', country: 'NG', status: 'awaiting',
  product: { name: 'LED String Lights 10m', nameZh: 'LED灯串' }, quantity: 5000,
  quote: { unitPrice: usd(1.45), total: usd(7250), quantity: 5000 }, order: null,
  messages: [{ direction: 'inbound', text: 'Price for 5,000 pcs?', at: NOW }],
  pendingDraft: null, ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null,
  lastHumanAction: null, knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
};

const buyerFile = (products: CustomerFile['context']['products'] = [{ sku: 'ZX-100', name: 'Canvas bag', nameZh: '帆布袋' }]): CustomerFile => ({
  conversationId: 'c1', buyer: 'Ahmed', country: 'AE', channel: 'whatsapp',
  status: { t: 'awaiting' }, statusTone: 'warn', needsOwner: false,
  profile: { firstContact: NOW, products: [], quoteCount: 1, orderCount: 0 },
  timeline: [{ kind: 'quote', at: NOW, text: null, qty: 5000, unitPrice: usd(0.92), orderStatus: null }],
  context: { products, latestQuote: { qty: 5000, unitPrice: usd(0.92), total: usd(4600) }, order: null, corrections: [] },
});

const knowledge: ProductKnowledge = {
  productId: 'p1', productName: 'Canvas bag',
  items: [{ id: 'k1', kind: 'specification', label: 'Dimensions', content: '38 x 40 cm', source: 'owner_confirmed' }],
  certs: [], appliesToProducts: 3,
};

const ops = (over: Partial<KnowledgeOps> = {}): KnowledgeOps => ({
  range: 'week', hasActivity: false,
  report: { factsAdded: 0, answersCorrected: 0, certsAuthorized: 0, archived: 0, commonRequests: [] },
  gaps: [], activity: [], ...over,
});

/** Page text as a reader has it: no stylesheet, no markup. */
const said = (html: string): string => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');

/* ── CC-13 ───────────────────────────────────────────────────────────────── */

describe('CC-13 · each language its own punctuation, and a figure spaced from its unit', () => {
  const CHINESE_MARKS = /[：　、，。；！？（）「」【】《》]/;

  it('the catalogue: no Chinese punctuation in any English or Arabic sentence', () => {
    for (const l of ['en', 'ar'] as const) {
      const bad = Object.entries(messages[l]).filter(([, v]) => CHINESE_MARKS.test(v));
      expect(bad.map(([k, v]) => `${l} ${k}: ${v}`)).toEqual([]);
    }
  });

  it('the page templates: no full-width colon or space written into a page, except on a Chinese-only branch', () => {
    // The two lines that carry one for another reason are named, not waved
    // through by pattern: the owner's edit command in chat (改：…), which is
    // parsed and never drawn.
    const INTERNAL = /rawReply = (?:body|b)\.command === '改' \? `改：/;
    const bad: string[] = [];
    for (const f of webFiles) {
      read(f).split('\n').forEach((line, i) => {
        if (!/[：　]/.test(line)) return;
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;   // a comment is not drawn
        if (INTERNAL.test(line) || line.includes("'zh'")) return;
        bad.push(`${f}:${i + 1}: ${code}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('a label and its value: the colon each language uses', () => {
    expect(labelled('en', 'Hired', 'Jul 9')).toBe('Hired: Jul 9');
    expect(labelled('ar', 'التوظيف', '9 يوليو')).toBe('التوظيف: 9 يوليو');
    expect(labelled('zh', '入职', '7月9日')).toBe('入职：7月9日');
    expect(labelled('fr', 'Embauche', '9 juil.')).toBe('Embauche\u00a0: 9 juil.');   // phase 9 — the French colon
  });

  it('a figure and its unit: a no-break space in English and Arabic, nothing in Chinese — decided once', () => {
    expect(formatQtyUnit('en', 5000, 'pcs')).toBe(`5,000${NBSP}pcs`);
    expect(formatQtyUnit('ar', 5000, 'قطعة')).toBe(`5,000${NBSP}قطعة`);
    expect(formatQtyUnit('zh', 5000, '个')).toBe('5000个');
    expect(formatQtyUnit('zh', 12000, '个')).toBe('1.2万个');
    expect(withUnit('en', '1,000–4,999', 'pcs')).toBe(`1,000–4,999${NBSP}pcs`);
    expect(withUnit('zh', '2000+', '个')).toBe('2000+个');
  });

  it("the assistant's page: \"Hired: …\" in each language's own colon", () => {
    for (const l of LOCALES) {
      const html = withoutIsolates(everyScreen(employee, l, null));   // phase 7 — the Name row's screen
      const hired = `${esc(t(l, 'employee.hired'))}${l === 'zh' ? '：' : l === 'fr' ? '\u00a0: ' : ': '}`;
      expect(html, l).toContain(hired);
      if (l !== 'zh') { expect(html, l).not.toContain('：'); expect(html, l).not.toContain('　'); }
    }
  });

  it('products: the colon and the gap per language, every figure spaced from its unit', () => {
    const en = withoutIsolates(renderProductList([item()], 'en'));
    // Phase 9 (V1-299) — the price of one unit; the quantity it starts from only where that is above the minimum.
    expect(en).toContain(`From 5,000${NBSP}pcs: <bdi>$0.92/pc</bdi> · Min. order: <bdi>1,000${NBSP}pcs</bdi>`);
    const ar = withoutIsolates(renderProductList([item()], 'ar'));
    // The design pass §9: Arabic money is the locale's own form, read as one unit.
    expect(ar).toContain(`ابتداءً من 5,000${NBSP}قطعة: <bdi>\u200F0.92${NBSP}US$ لكل قطعة</bdi> · `);
    const zh = withoutIsolates(renderProductList([item()], 'zh'));
    expect(zh).toContain('5000个起：<bdi>$0.92/个</bdi>　最低起订：<bdi>1000个</bdi>');
    for (const [l, html] of [['en', en], ['ar', ar]] as const) {
      expect(html, l).not.toMatch(/[：　]/);
    }
    const page = withoutIsolates(renderProductDetail(detail(), 'ar'));
    expect(page).toContain(`500–2,000${NBSP}قطعة`);
    // Phase 9 (missed-02) — "2,000 and up" in words: a bare "2,000+" is drawn "+2,000" in Arabic.
    expect(page).toContain(`2,000${NBSP}قطعة فأكثر`);
    expect(page).not.toContain('2,000+');
    expect(page).toContain(`<bdi>5,000${NBSP}قطعة</bdi> · <bdi>\u200F0.92${NBSP}US$ لكل قطعة</bdi>`);   // recent quotes, each figure isolated
    expect(withoutIsolates(renderProductDetail(detail(), 'zh'))).toContain('2000个起');
  });

  it('contacts: the gap between the facts is " · " in every language (phase 9, V1-553: the full-width gaps read as a hole in Chinese)', () => {
    const row = contact({ title: 'Buyer' });
    for (const l of ['en', 'ar'] as const) {
      const html = withoutIsolates(renderContacts(contacts([row]), l, null));
      expect(html, l).not.toMatch(/[：　]/);
      expect(html, l).toContain(`${esc(t(l, 'contacts.channel.email'))} · ${esc(t(l, 'contacts.source.manual'))}`);
    }
    expect(withoutIsolates(renderContacts(contacts([row]), 'zh', null))).toContain(`${t('zh', 'contacts.channel.email')} · ${t('zh', 'contacts.source.manual')}`);
  });

  it('an order: the quantity in the page\'s own unit word, and the tracking line\'s colon', () => {
    const en = withoutIsolates(renderOrder(order(), 'en', null));
    expect(en).toContain(`5,000${NBSP}pcs`);
    expect(en).toContain(`${esc(t('en', 'order.field.tracking'))}: MAEU123`);
    const zh = withoutIsolates(renderOrder(order(), 'zh', null));
    expect(zh).toContain('5000个');
    expect(zh).toContain(`${t('zh', 'order.field.tracking')}：MAEU123`);
    expect(withoutIsolates(renderOrder(order(), 'ar', null))).toContain(`5,000${NBSP}قطعة`);
  });

  // Phase 9 (V1-258) — per ONE piece, still in the page's language: "/pc", "/个", "/قطعة", "/ud.".
  it('practice: each chip\'s colon, and the price per unit in the page\'s language (it said "/pc" everywhere)', () => {
    for (const l of LOCALES) {
      const html = withoutIsolates(renderSandbox(practice(), l, { flash: null }));
      expect(html, l).toContain(esc(labelled(l, t(l, 'sandbox.xray.skill'), t(l, 'capability.quote' as MessageKey))));
      expect(html, l).toContain(`${l === 'ar' ? `\u200F0.85${NBSP}US$` : '$0.85'}/${esc(t(l, 'product.unit.pc'))}`);
      if (l !== 'en') expect(html, l).not.toContain('/pc<');
    }
  });

  it('no figure runs into its unit on the pages that print one, in English or Arabic', () => {
    const glued = /\d(?:pcs|قطعة)/;
    for (const l of ['en', 'ar'] as const) {
      const pages = [
        withoutIsolates(renderInboxList(list, l, NOW)), withoutIsolates(renderConversationDetail(conversation, l, NOW, null)),
        withoutIsolates(renderCustomerFile(buyerFile(), l, NOW)), withoutIsolates(renderProductList([item()], l)), withoutIsolates(renderProductDetail(detail(), l)),
        withoutIsolates(renderOrder(order(), l, null)),
      ];
      for (const html of pages) expect(said(html), l).not.toMatch(glued);
    }
    // Chinese sets them together, as it always did.
    expect(withoutIsolates(renderInboxList(list, 'zh', NOW))).toContain('<bdi>5000个</bdi>');
  });
});

/* ── CC-14 ───────────────────────────────────────────────────────────────── */

describe("CC-14 · the shell leads with the business's own name; the product's is the line under it", () => {
  const page = (l: Locale, path = '/app/inbox', business: string | null = 'Westlake Canvas Co.') =>
    withWorkspace(scope({ business }), () => shell({ title: 'T', active: 'inbox', locale: l, path, bodyHtml: '<h1 class="page">T</h1>' }));
  const brand = (html: string) => html.slice(html.indexOf('<div class="brand">'), html.indexOf('</nav>'));

  it('in every language: the name as the owner typed it, isolated, and "Nomi" beneath — not "{name}\'s workspace"', () => {
    for (const l of LOCALES) {
      const b = brand(page(l));
      expect(b, l).toContain('<span class="brandname"><bdi>Westlake Canvas Co.</bdi><small>Nomi</small></span>');
      expect(b, l).not.toContain(esc(t(l, 'app.tagline')));
    }
    // A Chinese or an Arabic name reads the same way in an English shell.
    expect(brand(page('en', '/app', '义乌宏发日用品厂 (demo)'))).toContain('<bdi>义乌宏发日用品厂 (demo)</bdi><small>Nomi</small>');
  });

  it('what the owner typed is escaped', () => {
    const html = page('en', '/app', 'A&B <b>Trading</b>');
    expect(html).toContain('<bdi>A&amp;B &lt;b&gt;Trading&lt;/b&gt;</bdi>');
    expect(html).not.toContain('<b>Trading</b>');
  });

  it('outside a workspace, or with no name, the block says what it always said', () => {
    for (const l of LOCALES) {
      expect(brand(page(l, '/app', null)), l).toContain(`Nomi<small>${esc(t(l, 'app.tagline'))}</small>`);
      expect(brand(page(l, '/app', '   ')), l).toContain(`Nomi<small>${esc(t(l, 'app.tagline'))}</small>`);
    }
    const named = withAssistantName('Lily', () => shell({ title: 'T', active: 'home', locale: 'en', path: '/app', bodyHtml: '' }));
    expect(named).toContain("Lily's workspace");
  });

  it('a page about one conversation keeps the business when it narrows to that conversation\'s assistant', () => {
    const html = withWorkspace(scope({ business: 'Westlake Canvas Co.' }), () =>
      withAssistantName('Noor', () => shell({ title: 'T', active: 'inbox', locale: 'en', path: '/app/inbox/c1', bodyHtml: '' })));
    expect(html).toContain('<bdi>Westlake Canvas Co.</bdi><small>Nomi</small>');
  });

  it('the phone chrome is option A as built: the rail row holds the mark alone; the name heads every page on a phone (phase 9, V1-105)', () => {
    const css = linkedCss(page('en'));
    const phone = css.slice(css.indexOf('@media (max-width: 720px)'));
    expect(phone).toContain('nav.side .brand .brandname { display:none; }');   // the rail row unchanged
    expect(phone).toContain('.business-name { display:block; }');
    expect(css.slice(0, css.indexOf('@media (max-width: 720px)'))).toMatch(/\.business-name \{ display:none;/);
    for (const l of LOCALES) {
      const today = page(l, '/app');
      const main = today.slice(today.indexOf('<main'), today.indexOf('</main>'));
      expect(main, l).toMatch(/^<main id="main"><p class="business-name"><bdi>Westlake Canvas Co\.<\/bdi><\/p><h1 class="page">/);
      const nav = today.slice(today.indexOf('<nav class="side">'), today.indexOf('</nav>'));
      expect(nav, l).not.toContain('business-name');
      // Phase 9 (V1-105) — Setup, Getting started, Before going live and the rest named no workspace on a phone.
      for (const other of ['/app/inbox', '/app/settings', '/app/employee', '/app/business', '/app/inbox/c1'])
        expect(page(l, other), `${l} ${other}`).toContain('<p class="business-name"><bdi>Westlake Canvas Co.</bdi></p>');
    }
    expect(page('en', '/app', null)).not.toContain('class="business-name"');
  });
});

/* ── CC-20 ───────────────────────────────────────────────────────────────── */

describe('CC-20 · a keyboard and a screen reader find their way', () => {
  const shelled = (l: Locale, path = '/app') =>
    shell({ title: 'T', active: 'home', locale: l, path, bodyHtml: '<h1 class="page">T</h1>' });

  it('a skip link is the first thing on every owner page, to the page itself, in each language', () => {
    for (const l of LOCALES) {
      const html = shelled(l);
      expect(html, l).toContain(`<body><a class="skip" href="#main">${esc(t(l, 'shell.skip'))}</a><div class="layout">`);
      expect(html, l).toContain('<main id="main">');
      expect(t(l, 'shell.skip').length, l).toBeGreaterThan(3);
    }
    const css = linkedCss(shelled('en'));
    // Out of sight until it has focus (above the page, by the spacing scale), then over
    // the rail; logical sides, so it mirrors. No percentage: the owner surface has none.
    expect(css).toMatch(/\.skip \{ position:absolute; top:calc\(-2 \* var\(--space-48\)\); inset-inline-start:var\(--space-8\); z-index:3;/);
    expect(css).toContain('.skip:focus, .skip:focus-visible { top:var(--space-8); }');
    expect(css.slice(css.indexOf('.skip {'), css.indexOf('.skip:focus'))).not.toContain('%');
    expect(css).toContain('#latest, #compose, #main { scroll-margin-top:25vh; }');
  });

  it('where you are is said, not only shown: the nav, and every row of tabs', () => {
    for (const l of LOCALES) {
      // The warmth run: products are My business's, a row of Settings — Settings is lit.
      expect(shelled(l, '/app/products'), l).toMatch(/href="\/app\/settings" class="navlink active" data-nav="settings" aria-current="page"/);
      // Phase 9 (V1-358) — the period's tabs sit with its counts at the foot of the page, and keep it there.
      expect(withoutIsolates(renderKnowledgePeriod(ops(), l, NOW)), l).toContain('class="tab on" aria-current="page" href="/app/knowledge?range=week#period"');
    }
    const results: AnalyticsData = {
      range: 'month', hasActivity: false,
      summary: { newClients: 0, activeConvos: 0, quotes: 0, orders: 0 },
      activity: { inbound: 0, replied: 0, waiting: 0 },
      commerce: { quotes: 0, orders: 0, deals: [], totals: [] },
      employee: { handled: 0, waiting: 0, edits: 0 },
    };
    const analytics = withoutIsolates(renderAnalytics(results, 'en'));
    expect(analytics).toContain('class="tab on" aria-current="page" href="/app/analytics?range=month"');
    expect(analytics.match(/aria-current=/g)).toHaveLength(1);
  });

  it('the conversation, the buyer and the product each have one heading of their own: the name in the header', () => {
    for (const l of LOCALES) {
      const pages = {
        conversation: withoutIsolates(renderConversationDetail(conversation, l, NOW, null)),
        buyer: withoutIsolates(renderCustomerFile(buyerFile(), l, NOW)),
        product: withoutIsolates(renderProductDetail(detail(), l)),
      };
      for (const [what, html] of Object.entries(pages)) {
        expect(html.match(/<h1[\s>]/g), `${l} ${what}`).toHaveLength(1);
      }
      expect(pages.conversation, l).toContain('<h1 class="who">🇳🇬 <b><bdi>Aisha Bello</bdi></b>');
      expect(pages.buyer, l).toContain('<h1 class="who">🇦🇪 <b><bdi>Ahmed</bdi></b>');
      // Phase 9 (V1-310) — the product's name is the page's title, drawn like every page's.
      expect(pages.product, l).toMatch(/<h1 class="page"><bdi>(Canvas Tote Bag|帆布袋)<\/bdi><\/h1>/);
    }
    // Drawn the size it always was: the header's own rule, the heading's margins taken off.
    const css = linkedCss(shelled('en'));
    expect(css).toContain('.dhead .who { font-size:var(--font-size-small); }');
    expect(css).toContain('.dhead h1.who { margin:0; font-weight:400; }');
  });

  it('the door pages have one heading each, the task they ask (Phase 9, V1-032: the sign-in page\'s was its brand line)', () => {
    for (const l of LOCALES) {
      const doors = {
        login: loginPage({ locale: l, path: '/login' }),
        signup: signupPage({ locale: l, path: '/signup', mode: 'invite', passwordMin: 10 }),
        verify: verifyPage({ locale: l, path: '/verify', maskedEmail: 'm***@example.com', purpose: 'signup' }),
        notfound: errorPage({ locale: l, path: '/nope', kind: 'notfound' }),
      };
      for (const [what, html] of Object.entries(doors)) expect(html.match(/<h1[\s>]/g), `${l} ${what}`).toHaveLength(1);
      expect(doors.login, l).toContain(`<h1>${esc(t(l, 'login.title'))}</h1>`);
      expect(loginPage({ locale: l, path: '/login', withCode: true }), l).toContain(`<h1>${esc(t(l, 'login.code.title'))}</h1>`);
      // The brand is the site's mark and name, on every door, and no longer a heading.
      for (const html of Object.values(doors)) {
        expect(html, l).toMatch(new RegExp(`<div class="brand"><svg class="mark"[^>]*aria-hidden="true"[\\s\\S]*?</svg><span>Nomi</span><small class="muted">${esc(t(l, 'login.brandTagline'))}</small></div>`));
      }
    }
    const door = linkedCss(loginPage({ locale: 'en', path: '/login' }));
    expect(door).toContain('.login .brand { flex-direction:column; justify-content:center; gap:var(--space-4); text-align:center;');
  });

  it('the knowledge page says its title once (it printed it twice), with its lede under it', () => {
    for (const l of LOCALES) {
      const composed = withoutIsolates(renderKnowledgeOps(ops(), l, NOW)) + withoutIsolates(renderKnowledgeIndex({ products: [], business: [] }, l));
      expect(composed.match(/<h1[\s>]/g), l).toHaveLength(1);
      expect(composed, l).toContain(`<p class="lede">${esc(t(l, 'knowledge.intro'))}</p>`);
    }
  });

  it('a refusal is announced as one: the notice, field errors, and no page paints a refusal as a passing status', () => {
    expect(flashBanner({ text: 'No.', bad: true })).toBe('<div class="flash bad" role="alert">No.</div>');
    expect(flashBanner({ text: 'Sent.', bad: false })).toBe('<div class="flash" role="status">Sent.</div>');
    const errors: Partial<Record<ProductEditField, ProductEditError>> = { price: 'below_floor' };
    const refused = withoutIsolates(renderProductDetail(detail(), 'en', null, errors, {}));
    expect(refused).toMatch(/<p class="perr" role="alert">/);
    for (const f of webFiles) {
      const src = read(f);
      expect(src, `${f} paints its own refusal as a status`).not.toMatch(/class="[^"]*\bbad\b[^"]*" role="status"/);
      expect(src.match(/class="perr"(?! role="alert")/g) ?? [], `${f}: a field error with no alert`).toEqual(
        f.endsWith('components.ts') ? ['class="perr"'] : []);   // the components page shows the style, not an error
    }
    // The workspace's pending deletion is a standing state: a pill and a sentence, not a notice.
    const pending = withoutIsolates(renderDataRights({
      businessName: 'Atlas Trading',
      requests: [{ id: 'r1', scope: 'workspace', subjectNote: null, askedBy: 'owner', askedAt: NOW, state: 'open', closedAt: null, closedNote: null }],
    }, 'en', null, OWNER_VIEW, 'x'));
    expect(pending).toContain(`<p><span class="pill warn">${esc(t('en', 'data.deletion.state.open'))}</span>`);
    expect(pending).not.toContain('class="flash');
  });

  describe('contrast, computed from the values the pages are drawn with', () => {
    const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };
    const C = DESIGN_TOKENS.color as Record<string, string>;
    const camel = (k: string) => k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

    it('every state reads at 4.5:1 or better as text on its own wash (waiting sat at 4.15)', () => {
      for (const s of ['ok', 'waiting', 'warn']) {
        expect(ratio(C[s]!, C[`${s}Wash`]!), s).toBeGreaterThanOrEqual(4.5);
      }
      // The assistant's magenta is text on either ground (6.7 and 6.1).
      for (const bg of ['surface', 'paper']) expect(ratio(C['assistant']!, C[bg]!), `magenta on ${bg}`).toBeGreaterThanOrEqual(4.5);
      for (const bg of ['surface', 'paper']) {
        expect(ratio(C['inkSecondary']!, C[bg]!), `ink secondary on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('every rule that sets a text colour on its own background, in every sheet the pages link, clears 4.5:1', () => {
      // The owner's sheet, the door's (sign-in, sign-up), and the site's own rules.
      // The type sheets (font faces, no colour) are linked too, and skipped here.
      const sheets = [shelled('en'), loginPage({ locale: 'en', path: '/login' })].flatMap((html) =>
        [...html.matchAll(/<link rel="stylesheet" href="\/assets\/((?!type)[^"]+)">/g)].map((m) => stylesheetAt(m[1]!)!.css));
      expect(sheets).toHaveLength(2);
      const low: string[] = [];
      for (const css of [...sheets, SITE_CSS]) {
        for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
          const fg = /(?:^|[;\s])color\s*:\s*var\(--color-([a-z-]+)\)/.exec(m[2]!)?.[1];
          const bg = /background(?:-color)?\s*:\s*var\(--color-([a-z-]+)\)/.exec(m[2]!)?.[1];
          if (!fg || !bg) continue;
          const r = ratio(C[camel(fg)]!, C[camel(bg)]!);
          if (r < 4.5) low.push(`${m[1]!.trim()}: ${fg} on ${bg} = ${r.toFixed(2)}`);
        }
      }
      expect(low).toEqual([]);
    });
  });
});

/* ── CC-29 ───────────────────────────────────────────────────────────────── */

describe('CC-29 · everything that takes something away asks first, the one way the product asks', () => {
  const ASK = 'onclick="return confirm(this.dataset.confirm)"';
  /** The button asks, and asks this question. */
  const asks = (html: string, question: string): boolean =>
    new RegExp(`${ASK.replace(/[()[\].]/g, '\\$&')}\\s+data-confirm="${esc(question).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(html);
  const forms = webFiles.flatMap((f) =>
    [...read(f).matchAll(/<form\b[^>]*\baction="([^"]+)"[\s\S]*?<\/form>/g)].map((m) => ({ file: f, action: m[1]!, text: m[0] })));

  /**
   * Every one-tap action that removes, archives, disconnects, stops, revokes,
   * withdraws or sets aside — and the two that widen what goes out alone
   * (granting a capability, writing first). The audit counted eight; the walk
   * on 2026-09-28 found nineteen, seven of which already asked.
   */
  const MUST_ASK: readonly [file: string, action: RegExp][] = [
    ['employee.ts', /\/capability\/\$\{[^}]+\}\/revoke$/],
    ['employee.ts', /\/capability\/\$\{[^}]+\}\/promote$/],
    ['knowledge.ts', /^\/app\/knowledge\/cert$/],
    ['channels.ts', /^\/app\/connect\/meta\/disconnect$/],
    ['channels.ts', /^\/app\/channels\/outreach$/],
    ['channels.ts', /^\/app\/channels\/whatsapp\/disconnect$/],
    ['connect.ts', /^\/app\/connect\/mail\/disconnect$/],
    ['sequences.ts', /\/enrollments\/\$\{[^}]+\}\/stop$/],
    ['sequences.ts', /^\/app\/sequences\/\$\{id\}\/archive$/],
    ['contacts.ts', /^\/app\/contacts\/\$\{[^}]+\}\/archive$/],
    ['prospects.ts', /^\/app\/prospects\/key\/remove$/],
    ['priceRules.ts', /\/prices\/volume\/\$\{[^}]+\}\/archive$/],
    ['dataRights.ts', /^\/app\/settings\/data\/withdraw$/],
    ['dataRights.ts', /^\/app\/settings\/data\/delete$/],
    ['conversations.ts', /\/deletion\/dismiss$/],
    ['inbox.ts', /\/proof\/revoke$/],
    ['people.ts', /\/people\/\$\{[^}]+\}\/remove$/],
    ['assistants.ts', /\/assistants\/\$\{[^}]+\}\/archive$/],
    // P6 — Practice's Start over erases (0089).
    ['sandbox.ts', /^\/app\/sandbox\/reset$/],
    ['factory.ts', /^\/app\/business\/allowlist\/remove$/],
    ['factory.ts', /^\/app\/business\/\$\{action\}$/],
  ];

  it('each of them carries the confirm on its button, with a question from the catalogue in all three languages', () => {
    for (const [file, action] of MUST_ASK) {
      const found = forms.filter((f) => f.file === `${WEB}/${file}` && action.test(f.action));
      expect(found.length, `${file} ${action}`).toBeGreaterThan(0);
      for (const f of found) {
        expect(f.text, `${file} ${f.action}`).toContain(ASK);
        const q = /data-confirm="\$\{([^"]+)\}"/.exec(f.text)?.[1] ?? '';
        expect(q, `${file} ${f.action} has no question`).not.toBe('');
        for (const key of [...q.matchAll(/'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)'/g)].map((m) => m[1]!)) {
          for (const l of LOCALES) expect(messages[l][key as MessageKey], `${l} ${key}`).toBeTruthy();
        }
      }
    }
  });

  /**
   * PHASE 5 OF THE UI REBUILD (2026-10-02) — UNDO OVER CONFIRM. Where taking
   * something away only sets it aside, it happens at once and the notice that
   * follows carries Undo (its own `…/restore`, flash.ts `UNDO_ACTION`): a
   * forbidden word, a closure, a taught fact, an owner's date on the calendar.
   * Everything else on MUST_ASK still asks: it disconnects, stops sending,
   * widens what goes out alone, erases, or takes away someone's access.
   */
  const UNDONE: readonly [file: string, action: RegExp, restore: string][] = [
    ['settings.ts', /\/forbidden\/\$\{[^}]+\}\/remove$/, '/app/settings/forbidden/${id}/restore'],
    ['settings.ts', /\/closures\/\$\{[^}]+\}\/remove$/, '/app/settings/closures/${id}/restore'],
    ['knowledge.ts', /^\/app\/knowledge\/archive$/, '/app/knowledge/${id}/restore'],
    ['calendar.ts', /\/calendar\/entries\/\$\{[^}]+\}\/remove$/, '/app/calendar/entries/${id}/restore'],
  ];

  it('and nothing that takes something away slips past: any form whose address says so asks — or offers Undo', () => {
    const TAKES = /\/(remove|archive|disconnect|revoke|promote|withdraw|dismiss|delete|stop)$|^\/app\/channels\/outreach$/;
    const undone = (f: { file: string; action: string }) => UNDONE.some(([file, a]) => f.file === `${WEB}/${file}` && a.test(f.action));
    const silent = forms.filter((f) => TAKES.test(f.action) && !f.text.includes(ASK) && !undone(f)).map((f) => `${f.file} ${f.action}`);
    expect(silent).toEqual([]);
  });

  it('phase 5 · those set aside at once do not ask, and the route offers the way back on its notice', () => {
    const app = read(`${WEB}/app.ts`);
    for (const [file, action, restore] of UNDONE) {
      const found = forms.filter((f) => f.file === `${WEB}/${file}` && action.test(f.action));
      expect(found.length, `${file} ${action}`).toBeGreaterThan(0);
      for (const f of found) expect(f.text, `${file} ${f.action}`).not.toContain(ASK);
      expect(app, restore).toContain(`\`${restore}\``);                       // the notice carries it
      expect(app, restore).toContain(`app.post('${restore.replace('${id}', ':id')}'`);   // and it is a route
    }
  });

  it('one idiom: every confirm is this one — no form-level handler, no question written into the script', () => {
    for (const f of webFiles) {
      const src = read(f);
      expect(src, f).not.toMatch(/\bonsubmit=/);
      const calls = src.match(/confirm\(/g)?.length ?? 0;
      const idiom = src.split(ASK).length - 1;
      expect(calls, `${f}: a confirm( that is not the idiom`).toBe(idiom);
    }
  });

  it('left one tap on purpose: they take nothing away (an answer, a hand-back)', () => {
    // Considered on 2026-09-28 and kept as they are. A spot-check answer is
    // the owner answering the page's question; handing back and "leave it" are
    // decisions about one conversation; recording a deletion request can be
    // taken back on Your data. Practice's Start over left this list with P6: it
    // ERASES now (0089), so it asks first.
    const oneTap = ['/app/inbox/${cid}/resume', '/app/outbound/${esc(u.outboundId)}/leave', '${here}/deletion'];
    for (const a of oneTap) {
      const f = forms.find((x) => x.action === a);
      expect(f, a).toBeDefined();
      expect(f!.text, a).not.toContain(ASK);
    }
  });

  it('rendered, in each language: the question names what goes', () => {
    for (const l of LOCALES) {
      const emp = withoutIsolates(everyScreen(employee, l, null));     // phase 7 — "One kind at a time" 
      expect(emp, l).toContain(`data-confirm="${esc(t(l, 'employee.actions.grantConfirm', { cap: t(l, 'capability.quote' as MessageKey) }))}"`);
      expect(emp, l).toContain(`data-confirm="${esc(t(l, 'employee.actions.revokeConfirm', { cap: t(l, 'capability.greet' as MessageKey) }))}"`);
      const c = withoutIsolates(renderContacts(contacts([contact()]), l, null));
      expect(c, l).toContain(`data-confirm="${esc(t(l, 'contacts.archive.confirm', { who: 'Ahmed' }))}"`);
      const data = withoutIsolates(renderDataRights({ businessName: 'Atlas Trading', requests: [] }, l, null, OWNER_VIEW, 'x'));
      expect(asks(data, t(l, 'data.deletion.confirm')), l).toBe(true);
      for (const key of ['employee.actions.grantConfirm', 'employee.actions.revokeConfirm', 'reach.inbound.disconnectConfirm',
        'outreach.turnOnConfirm', 'outreach.turnOffConfirm', 'seq.enrolment.stopConfirm', 'seq.archive.confirm',
        'contacts.archive.confirm', 'prospects.key.removeConfirm', 'channel.action.disconnectConfirm',
        'connect.action.disconnectConfirm',
        'prices.volume.removeConfirm', 'data.deletion.withdrawConfirm', 'data.buyers.withdrawConfirm',
        'conv.deletion.dismissConfirm'] as const) {
        expect(t(l, key), `${l} ${key}`).toMatch(l === 'zh' ? /？/ : /\?|؟/);   // each is a question
      }
    }
  });
});

/* ── CC-31 ───────────────────────────────────────────────────────────────── */

describe('CC-31 · an article number the owner never typed is not shown as theirs', () => {
  it('the generator and the test agree, and nothing an owner would type is taken for one', () => {
    const made = generatedSku(Date.UTC(2026, 8, 28, 4, 0, 0), 3);
    expect(made).toMatch(/^NEW-[a-z][0-9a-z]{7}-3$/);
    expect(isGeneratedSku(made)).toBe(true);
    expect(isGeneratedSku(generatedSku(Date.UTC(2040, 0, 1), 12))).toBe(true);
    for (const own of ['ZX-100', 'NEW-1', 'NEW-2024-01', 'NEW-20240101-1', 'NEW-ABCDEFGH-1', 'new-mukam3k2-0', 'NEW-mukam3k2', 'SKU NEW-mukam3k2-0']) {
      expect(isGeneratedSku(own), own).toBe(false);
      expect(ownSku(own), own).toBe(own);
    }
    expect(ownSku(made)).toBeNull();
    expect(ownSku('')).toBeNull();
    expect(ownSku(null)).toBeNull();
  });

  it('the import is the only thing that makes one, and makes it with the generator', () => {
    const products = read(`${WEB}/products.ts`);
    expect(products).toContain('const sku = p.sku ?? generatedSku(Date.now(), i);');
    for (const f of webFiles) expect(read(f), f).not.toMatch(/`NEW-\$\{/);
  });

  it('no page prints a SKU without asking whose it is', () => {
    for (const f of webFiles) {
      expect(read(f), f).not.toMatch(/esc\((?:[a-z]+\.)?(?:sku|productSku)\)/);
    }
  });

  it('products, a product, the buyer\'s page and the proforma: hers is shown, a made-up one is not', () => {
    const made = generatedSku(Date.UTC(2026, 8, 28), 0);
    for (const l of LOCALES) {
      const listed = withoutIsolates(renderProductList([item({ sku: made }), item({ id: 'p2', sku: 'ZX-200' })], l));
      expect(listed, l).not.toContain(made);
      expect(listed, l).toContain('<span class="muted"><bdi>ZX-200</bdi></span>');
      const one = withoutIsolates(renderProductDetail(detail({ sku: made }), l));
      expect(one, l).not.toContain(made);
      expect(withoutIsolates(renderProductDetail(detail(), l)), l).toContain('<bdi>ZX-100</bdi>');
      const buyer = withoutIsolates(renderCustomerFile(buyerFile([{ sku: made, name: 'Canvas bag', nameZh: '帆布袋' }]), l, NOW));
      expect(buyer, l).not.toContain(made);
    }
    const proforma = withoutIsolates(renderOrder(order({ productSku: made }), 'en', null));
    expect(proforma).toContain('PROFORMA INVOICE');
    expect(proforma).not.toContain(made);
    expect(proforma).toMatch(/\nVacuum cup\nQty:/);
    expect(withoutIsolates(renderOrder(order(), 'en', null))).toContain('Vacuum cup (ZX-200)');
  });
});

/* ── CC-09 ───────────────────────────────────────────────────────────────── */

describe('CC-09 · the public site exists (#80); what is left is the owner\'s', () => {
  it('the page a stranger reads, in every language, asks for an invitation — the sign-up default is still invite-only (CC-28)', () => {
    expect(signupModeFrom(undefined)).toBe('invite');
    for (const l of LOCALES) {
      const html = withoutIsolates(renderSite({ locale: l, path: '/', contact: 'hello@example.test', signIn: 'https://app.example.test/login', noindex: false }));
      expect(html, l).toContain('data-surface="site"');
      // Phase 9 (public-missed-02) — the mail opens with a subject and the questions to answer.
      expect(html, l).toContain('href="mailto:hello@example.test?subject=');
      expect(html, l).not.toContain('/signup');
    }
    // How the domain goes live is written down for the owner, step by step.
    const dns = read('docs/SITE-DNS.md');
    for (const step of ['SITE_HOSTS=nomidoes.com,www.nomidoes.com', 'www.nomidoes.com', 'Forwarding', 'What must NOT change']) {
      expect(dns).toContain(step);
    }
  });
});

describe('Phase 9 · the order page (V1-184–V1-187)', () => {
  it('says it is an order, keeps the proforma readable on a phone, and says outside English that it is English', async () => {
    const { LOCALES } = await import('../../src/core/owner/i18n/locale.js');
    for (const l of LOCALES) {
      const html = withoutIsolates(renderOrder(order(), l, null));
      expect(html, l).toMatch(/<h1 class="page">[^<]*<bdi>/);
      expect(html, l).toContain(t(l, 'order.heading', { ref: '' }).trim().slice(0, 4));
      expect(html, l).toContain('<pre class="doc" dir="ltr">');
      expect(html.includes(t(l, 'order.invoice.english')), l).toBe(l !== 'en');
    }
  });
});
