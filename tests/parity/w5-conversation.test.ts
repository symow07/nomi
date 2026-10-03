import { describe, it, expect } from 'vitest';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { formatList } from '../../src/core/owner/i18n/format.js';
import { usd } from '../../src/core/types/money.js';
import { esc, shell } from '../../src/api/web/layout.js';
import { linkedCss } from './linked-css.js';
import { readFileSync } from 'node:fs';
import { withAssistantName } from '../../src/api/web/say.js';
import { renderConversationDetail, type ConversationDetail, type ConversationSummary, type InboxList } from '../../src/api/web/inbox.js';
import { renderCustomerPanel, renderListPane, PANE_ROWS_IN_VIEW } from '../../src/api/web/panes.js';
import { renderCustomerFile, type CustomerFile } from '../../src/api/web/conversations.js';
import type { CustomerPanel } from '../../src/db/customerPanel.js';
import * as show from '../../src/api/web/values.js';
import type { CatchUp } from '../../src/db/catchUp.js';
import { conversationDetail } from './fixtures.js';

/**
 * THE WARMTH RUN, phase 9 — the fix wave for a conversation, the draft card,
 * the customer's file and Practice (`docs/UI-AUDIT.md` §5). Each block names
 * the finding it holds; each fails without its fix.
 */

const NOW = new Date('2026-10-03T19:50:00Z');
const MIN = 60_000;
const DAY = 86_400_000;
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const CLIENT = 'c1c1c1c1-0000-4000-8000-000000000002';
const plain = (s: string): string => s.replace(/[\u2066-\u2069]/g, '');

const rows = (over: Partial<CatchUp> = {}): CatchUp => ({
  clientId: CLIENT, channel: 'whatsapp', address: '5511900000001', photo: null,
  value: { clientId: CLIENT, spent: null, orders: 0, lastOrderAt: null, regular: false, quietSince: null },
  bought: [], boughtMore: 0, askedAbout: null, lastOrder: null,
  quoteSentAt: null, lastFromThemAt: null, lastMessage: null, ...over,
});
const detail = (over: Partial<ConversationDetail> = {}, catchUp: Partial<CatchUp> = {}): ConversationDetail => conversationDetail({
  buyer: 'Carlos Mendes', country: 'BR', channel: 'whatsapp', status: 'handled', pendingDraft: null, ownership: 'AI',
  product: { name: 'LED String Lights 10m', nameZh: 'LED灯串' }, quantity: 2000,
  catchUp: rows(catchUp), ...over,
});
const page = (d: ConversationDetail, l: Locale): string =>
  plain(withAssistantName('Mira', () => renderConversationDetail(d, l, NOW, null)));
const strip = (html: string): string => /<header class="catchup[^"]*">[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
const facts = (html: string): string => /<p class="cu-facts">[\s\S]*?<\/p>/.exec(strip(html))?.[0] ?? '';
const stateLine = (html: string): string => /<p class="cu-state">[\s\S]*?<\/p>/.exec(strip(html))?.[0] ?? '';

describe('w4-conversation-05, -13 · the strip says what they asked about, that nothing was bought, and that a quote waits', () => {
  it('Carlos: quoted at 15:21, asked "What plug type?" at 15:56, answered at 16:31 — the quote still waits on him', () => {
    const carlos = detail({}, {
      quoteSentAt: ago(4 * 60 * MIN + 29 * MIN), lastFromThemAt: ago(3 * 60 * MIN + 54 * MIN),
      lastMessage: { from: 'assistant', at: ago(3 * 60 * MIN + 19 * MIN) },
    });
    for (const l of LOCALES) {
      const html = page(carlos, l);
      expect(stateLine(html), l).toContain(`<b>${esc(t(l, 'catchup.state.quoted'))}</b>`);
      expect(stateLine(html), l).not.toContain(esc(t(l, 'catchup.state.last')));
      const f = facts(html);
      expect(f, l).toContain('<bdi>' + (l === 'zh' ? 'LED灯串' : 'LED String Lights 10m') + '</bdi>');
      expect(f, l).toContain(`<bdi class="fig">${plain(show.quantityOf(l, 2000, t(l, 'product.unit.pcs')))}</bdi>`);
      expect(f, l).toContain(esc(t(l, 'catchup.none')));
    }
  });

  it('an order after the quote answers it: the state moves on, and the strip says what they bought and spent', () => {
    const bought = detail({ product: { name: 'Stainless Steel Thermos 500ml', nameZh: '保温杯' }, quantity: 5000 }, {
      quoteSentAt: ago(9 * DAY), lastOrder: { reference: 'USAB-de300000-0001', confirmedAt: ago(2 * DAY) },
      bought: [{ name: 'Stainless Steel Thermos 500ml', nameZh: '保温杯', orders: 1 }],
      value: { clientId: CLIENT, spent: usd(11750), orders: 1, lastOrderAt: ago(2 * DAY), regular: false, quietSince: null },
    });
    for (const l of LOCALES) {
      const html = page(bought, l);
      expect(stateLine(html), l).toContain(`<b>${esc(t(l, 'catchup.state.ordered'))}</b>`);
      expect(stateLine(html), l).toContain('<bdi class="fig">USAB-de300000-0001</bdi>');
      // w4-conversation-15 — the product they bought is said once: no "asked about" for it, no line under the strip
      const name = l === 'zh' ? '保温杯' : 'Stainless Steel Thermos 500ml';
      expect(strip(html).split(`<bdi>${name}</bdi>`).length - 1, l).toBe(1);
      expect(html, l).not.toContain('class="muted subline"');
      expect(facts(html), l).not.toContain(esc(t(l, 'catchup.none')));
    }
  });

  it('bought one thing and now asking about another: both, each labelled', () => {
    const html = page(detail({}, {
      bought: [{ name: 'Stainless Steel Thermos 500ml', nameZh: '保温杯', orders: 2 }],
      value: { clientId: CLIENT, spent: usd(23500), orders: 2, lastOrderAt: ago(40 * DAY), regular: false, quietSince: null },
    }), 'en');
    const f = facts(html);
    expect(f.indexOf('Bought')).toBeLessThan(f.indexOf('Asked about'));
    expect(f).toContain('<bdi>LED String Lights 10m</bdi>');
    expect(f).toContain('spent');
  });
});

describe('the owner\'s deletion form names the profile photo, as the privacy page does', () => {
  it('in five languages, beside who they are on every channel', () => {
    const words: Record<Locale, RegExp> = {
      en: /their profile photo as Instagram or Messenger showed it to the business/,
      zh: /Instagram 或 Messenger 上的头像/,
      ar: /صورة الملف الشخصي كما ظهرت للشركة على إنستغرام أو ماسنجر/,
      es: /su foto de perfil tal como Instagram o Messenger se la mostraba al negocio/,
      fr: /sa photo de profil telle qu’Instagram ou Messenger la montrait à l’entreprise/,
    };
    for (const l of LOCALES) {
      expect(t(l, 'conv.deletion.erased'), l).toMatch(words[l]);
      expect(t(l, 'conv.deletion.erased'), l).not.toMatch(/WhatsApp/);
    }
  });
});

describe('w4-conversation-20, -25 · "… is writing a reply"', () => {
  it('a line somebody already answered does not count: a person\'s reply, one from the phone, or a hand-over after it (live.ts)', () => {
    const src = readFileSync(new URL('../../src/api/web/live.ts', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export async function assistantWorking'), src.indexOf('export type LiveAnswer'));
    expect(fn.match(/nobodyAnsweredSince\(sql\.ref\('(f\.received_at|j\.created_on)'\)\)/g)).toHaveLength(2);
    const rule = src.slice(src.indexOf('const nobodyAnsweredSince'), src.indexOf('export async function assistantWorking'));
    expect(rule).toContain("o.origin = 'owner'");
    expect(rule).toContain("o.status not in ('failed', 'canceled')");
    expect(rule).toContain("m.external_id like 'echo:%'");
    expect(rule).toContain("e.type = 'handoff'");
    // the integration case walks it against the database
    expect(readFileSync(new URL('../integration/phase5-undo-working.test.ts', import.meta.url), 'utf8')).toContain('w4-conversation-20');
  });

  it('the dots follow the last word when the line wraps, in every language', () => {
    const css = linkedCss(shell({ title: 'T', active: 'inbox', locale: 'es', path: '/app/inbox', bodyHtml: '' }));
    expect(css).toMatch(/\.working \{ display:block;/);
    expect(css).not.toMatch(/\.working \{ display:flex/);
    expect(css).toMatch(/\.working \.dots \{ display:inline-flex;[^}]*margin-inline-start:var\(--space-8\)/);
  });
});

describe('the draft card\'s fold (V1-220, w4-conversation-01, -02, -07, -08, -09)', () => {
  const reply = 'Hello Aisha — for 5,000 pcs of LED String Lights 10m (ZX-300): $1.45/pc FOB Ningbo, lead time 25 days, CE certified.';
  const drafted = (sku: string | null): ConversationDetail => detail({
    pendingDraft: { draftId: 'd-1', capability: 'quote', draftText: reply }, status: 'awaiting',
    product: { name: 'LED String Lights 10m', nameZh: 'LED灯串', sku }, quantity: 5000,
    quote: { unitPrice: usd(1.45), total: usd(7250), quantity: 5000 }, claimsAllowed: [],
  });
  const card = (html: string): string => html.slice(html.indexOf('id="approve"'), html.indexOf('</section>', html.indexOf('id="approve"')));
  const summary = (c: string): string => c.slice(c.indexOf('<summary>'), c.indexOf('</summary>'));

  it('the demo\'s draft: "ZX-300" is the product\'s code, 25 has no source, and "CE certified" is unconfirmed — both on the line', () => {
    const marks: Record<Locale, string> = { en: '?', zh: '？', ar: '؟', es: '?', fr: '?' };
    const quote: Record<Locale, (x: string) => string> = {
      en: (x) => `“${x}”`, zh: (x) => `“${x}”`, ar: (x) => `«${x}»`, es: (x) => `«${x}»`, fr: (x) => `«\u00a0${x}\u00a0»`,
    };
    for (const l of LOCALES) {
      const c = card(page(drafted('ZX-300'), l));
      const s = summary(c);
      expect(s, l).not.toMatch(/300/);
      expect(s, l).toContain(`<span class="c check"><span aria-hidden="true">${marks[l]}</span> ${esc(t(l, 'card.unsourcedWhich', { figures: '25' }))}</span>`);
      expect(s, l).toContain(`<span class="c check"><span aria-hidden="true">${marks[l]}</span> ${esc(t(l, 'card.unconfirmedWhich', { claims: formatList(l, [quote[l]('CE certified'), quote[l]('FOB')]) }))}</span>`);
      expect(c, l).toContain(`<span><bdi>ZX-300</bdi></span><span>${esc(t(l, 'card.source.code'))}</span>`);
      // never the waiting signal's ○ for "check this"
      expect(c, l).not.toMatch(/class="(?:mk|c) (?:warn|check)"[^>]*>(?:<span[^>]*>)?○/);
      // every part of a row in a span of the page's own direction: in Arabic the figure sits by its mark
      expect(c, l).toMatch(/<li><span class="mk check" aria-hidden="true">[^<]+<\/span><span><bdi>25<\/bdi><\/span><span>/);
    }
  });

  it('a code in the pointer is never broken at its hyphen', () => {
    const c = card(page(drafted(null), 'en'));
    expect(c).toMatch(/no source found <bdi class="muted">[^<]*<span class="fig">\(ZX-300\):<\/span>/);
  });

  it('the stylesheet: what to check is ink, never the waiting colour', () => {
    const css = linkedCss(shell({ title: 'T', active: 'inbox', locale: 'ar', path: '/app/inbox', bodyHtml: '' }));
    expect(css).toContain('#approve summary .c.check { color:var(--color-ink); font-weight:600; }');
    expect(css).toContain('.reasons .mk.check { color:var(--color-ink); }');
    expect(css).not.toMatch(/\.reasons [^{]*\{[^}]*--color-waiting/);
    expect(css).not.toMatch(/#approve summary [^{]*\{[^}]*--color-waiting/);
  });
});

describe('the take-over card (w4-conversation-03, -04)', () => {
  const OWNER = { id: 'p-owner', name: 'Owner', isOwner: true };
  const CHEN = { id: 'p-chen', name: '陈莉', isOwner: false };
  it('under a reply the assistant drafted there is no second card; the assistant\'s conversations offer no "Hand to"', () => {
    for (const l of LOCALES) {
      const drafted = page(detail({ status: 'awaiting', people: [OWNER, CHEN], pendingDraft: { draftId: 'd', capability: 'quote', draftText: 'Hello' } }), l);
      expect(drafted, l).not.toContain(esc(t(l, 'takeover.status.aiDraft')));
      expect(drafted, l).not.toContain('class="card takeover');
      expect(drafted, l).not.toContain('/handto');
      const answered = page(detail({ people: [OWNER, CHEN] }), l);
      expect(answered, l).toContain('class="card takeover');
      expect(answered, l).not.toContain('/handto');
    }
  });
  it('where a person must answer, a colleague can still be handed it — never the reader', () => {
    const waiting = plain(renderConversationDetail(detail({ ownership: 'WAITING_HUMAN', people: [OWNER, CHEN] }), 'en', NOW, null, { id: OWNER.id, isOwner: true }));
    expect(waiting).toContain(`<option value="${CHEN.id}">`);
    expect(waiting).not.toContain(`<option value="${OWNER.id}">`);
  });
});

describe('w4-whole-13, w4-conversation-16 · one customer, two things to open, each named for what it opens', () => {
  it('one door to "About this customer", in one place: the page on a phone, the panel where it folds away; the panel says it is that', () => {
    for (const l of LOCALES) {
      const html = page(detail(), l);
      const about = esc(t(l, 'conv.file.title'));
      expect(html, l).toContain(`<a class="deeper file-door" href="/app/conversations/${detail().conversationId}">${about}<span class="go"`);
      expect(html, l).toContain(`<a class="deeper panel-open" href="#customer">${about}<span class="go"`);
      // side by side in the page, not one in the header row and one under the strip
      expect(html.indexOf('panel-open') - html.indexOf('file-door'), l).toBeLessThan(400);
      expect(html.slice(html.indexOf('<div class="dhead">'), html.indexOf('</div>', html.indexOf('<div class="dhead">'))), l).not.toContain('panel-open');
      expect(t(l, 'panel.open'), l).toBe(t(l, 'conv.file.title'));
      expect(t(l, 'panel.label'), l).toBe(t(l, 'conv.file.title'));
      // the face says it opens the card, a different thing with a different name
      expect(t(l, 'catchup.card', { who: 'X' }), l).not.toContain(t(l, 'conv.file.title'));
    }
    const css = linkedCss(shell({ title: 'T', active: 'inbox', locale: 'en', path: '/app/inbox', bodyHtml: '' }));
    const at1100 = css.slice(css.indexOf('@media (min-width: 1100px)'), css.indexOf('@media (min-width: 1440px)'));
    expect(at1100).toContain('.conv .panel-open { display:flex; }');
    expect(at1100).toContain('.conv .file-door { display:none; }');
    const at1440 = css.slice(css.indexOf('@media (min-width: 1440px)'));
    expect(at1440).toMatch(/\.conv \.panel-open, [^{]*\.conv \.file-door \{ display:none; \}/);
  });

  it('the panel\'s door onward names the full page; an order\'s way back names the conversation it opens', () => {
    const panel: CustomerPanel = {
      clientId: CLIENT, name: 'Aisha Bello', country: 'NG', channel: 'whatsapp', address: null, language: null,
      firstWrote: ago(3 * 60 * MIN), conversations: 1, askedAbout: [], prices: [], samples: [], promised: [], orders: [], activity: [],
    };
    const words: Record<Locale, string> = { en: 'Back to the conversation', zh: '回到对话', ar: 'العودة إلى المحادثة', es: 'Volver a la conversación', fr: 'Retour à la conversation' };
    for (const l of LOCALES) {
      const html = plain(renderCustomerPanel(panel, [], l, NOW, 'c-1'));
      expect(html, l).toContain(`>${esc(t(l, 'panel.fileDoor'))}<span class="go"`);
      // w4-conversation-06 — "Today", as the divider and the file say it, in the file's words
      expect(html, l).toContain(esc(`${t(l, 'conv.file.firstContact')}${l === 'zh' ? '：' : l === 'fr' ? '\u00a0: ' : ': '}${plain(show.day(l, ago(3 * 60 * MIN), NOW))}`));
      expect(t(l, 'order.back'), l).toBe(words[l]);
    }
  });
});

describe('w4-conversation-19 · the customer\'s file has their face, what they spent and how many orders stand', () => {
  const file = (over: Partial<CustomerFile> = {}): CustomerFile => ({
    conversationId: 'conv-1', buyer: 'Aisha Bello', country: 'NG', channel: 'whatsapp',
    status: { t: 'awaiting' }, statusTone: 'warn', needsOwner: false,
    profile: { firstContact: ago(DAY), products: [], quoteCount: 1, orderCount: 0 },
    timeline: [], context: { products: [], latestQuote: null, order: null, corrections: [] },
    customer: { clientId: CLIENT, photo: null, value: { clientId: CLIENT, spent: null, orders: 0, lastOrderAt: null, regular: false, quietSince: null } },
    ...over,
  });
  it('the face opens their card; spent and orders in the card\'s words', () => {
    for (const l of LOCALES) {
      const none = plain(renderCustomerFile(file(), l, NOW));
      const head = none.slice(none.indexOf('<div class="dhead">'), none.indexOf('</h1>'));
      expect(head, l).toContain(`<a class="face-link" href="/app/customers/${CLIENT}" data-card aria-label="${esc(t(l, 'catchup.card', { who: 'Aisha Bello' }))}">`);
      expect(none, l).toContain(`<span class="muted">${esc(t(l, 'pcard.spent'))}</span><b>${esc(t(l, 'pcard.nothingSpent'))}</b>`);
      expect(none, l).toContain(`<span class="muted">${esc(t(l, 'pcard.orders'))}</span><b>${esc(plain(show.count(l, 0)))}</b>`);
      const spent = plain(renderCustomerFile(file({ customer: { clientId: CLIENT, photo: 'v1', value: { clientId: CLIENT, spent: usd(11750), orders: 3, lastOrderAt: ago(DAY), regular: true, quietSince: null } } }), l, NOW));
      expect(spent, l).toContain(`<b><bdi>${plain(show.money(l, usd(11750)))}</bdi></b>`);
      expect(spent, l).toContain(`<img class="face-p" src="/app/faces/${CLIENT}?v=v1"`);
    }
  });
});

describe('V1-257 · the list beside a conversation says where the owner is, however far down the open one sits', () => {
  const row = (id: string, over: Partial<ConversationSummary> = {}): ConversationSummary => ({
    conversationId: id, buyer: `Buyer ${id}`, country: null, status: 'handled', needsAction: false, ownership: 'AI', heldBy: null,
    awaitingReview: false, handoffReason: null, latestMessage: 'hi', latestAt: ago(DAY), product: { name: null, nameZh: null },
    quantity: null, unitPrice: null, ...over,
  });
  const list = (n: number): InboxList => ({
    filter: 'all', waitingCount: 0, blockedCount: 0, deletionCount: 0, mineCount: 0,
    conversations: Array.from({ length: n }, (_, i) => row(`c-${i}`)),
  });
  it('pinned first, under its heading, when it is past the rows the pane shows; not when it is in view', () => {
    for (const l of LOCALES) {
      const far = renderListPane(list(30), l, NOW, 'c-25', [], row('c-25'));
      expect(far, l).toContain('lp-current');
      expect(far.indexOf('lp-current'), l).toBeLessThan(far.indexOf('href="/app/inbox/c-0'));
      const near = renderListPane(list(30), l, NOW, `c-${PANE_ROWS_IN_VIEW - 1}`, [], row(`c-${PANE_ROWS_IN_VIEW - 1}`));
      expect(near, l).not.toContain('lp-current');
    }
  });
});
