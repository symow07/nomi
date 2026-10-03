import { describe, it, expect } from 'vitest';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { usd } from '../../src/core/types/money.js';
import { DESIGN_TOKENS } from '../../src/core/owner/tokens.js';
import { esc, shell } from '../../src/api/web/layout.js';
import { withAssistantName, assistantName } from '../../src/api/web/say.js';
import { renderConversationDetail, needsWhy, type ConversationDetail } from '../../src/api/web/inbox.js';
import { paneRowOf, renderCustomerPanel } from '../../src/api/web/panes.js';
import { renderSandbox, type SandboxView } from '../../src/api/web/sandbox.js';
import * as show from '../../src/api/web/values.js';
import {
  stateOfPlay, ORDER_JUST_DAYS, QUIET_DAYS, TALKING_MINUTES, type PlayFacts,
} from '../../src/core/conversation/stateOfPlay.js';
import type { CatchUp } from '../../src/db/catchUp.js';
import type { CustomerPanel } from '../../src/db/customerPanel.js';
import { conversationDetail } from './fixtures.js';
import { linkedCss } from './linked-css.js';

/**
 * THE WARMTH RUN (2026-10-03), phase 5 — THE CONVERSATION. Whoever opens a
 * thread may never have seen it: the catch-up strip above the messages says
 * who this is, where they write, what they bought and spent, and where things
 * stand; in the thread, what the assistant said sits on its wash with "✦ name"
 * in magenta under it, and a person's reply keeps the plain bubble. Practice
 * draws the same transcript. Checked in every language the owner reads.
 */

const NOW = new Date('2026-10-03T10:00:00Z');
const MIN = 60_000;
const DAY = 86_400_000;
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const CLIENT = 'c1c1c1c1-0000-4000-8000-000000000001';
/** The page with its bidi isolates taken out, so a sentence compares as the catalogue writes it. */
const plain = (s: string): string => s.replace(/[\u2066-\u2069]/g, '');
const MAGENTA = DESIGN_TOKENS.color.assistant.toUpperCase();

const catchUp = (over: Partial<CatchUp> = {}): CatchUp => ({
  clientId: CLIENT, channel: 'whatsapp', address: '2348035550101', photo: null,
  value: { clientId: CLIENT, spent: usd(1240), orders: 3, lastOrderAt: ago(40 * DAY), regular: true, quietSince: null },
  bought: [{ name: 'Canvas tote', nameZh: '帆布袋', orders: 2 }, { name: 'Apron', nameZh: '围裙', orders: 1 }],
  boughtMore: 0, askedAbout: { name: 'Canvas tote', nameZh: '帆布袋' },
  lastOrder: { reference: 'ZX-1042', confirmedAt: ago(40 * DAY) },
  quoteSentAt: null, lastFromThemAt: ago(3 * 60 * MIN), lastMessage: { from: 'buyer', at: ago(3 * 60 * MIN) },
  ...over,
});

/** A conversation the assistant holds and has answered, with its catch-up rows. */
const detail = (over: Partial<ConversationDetail> = {}, rows: Partial<CatchUp> = {}): ConversationDetail => conversationDetail({
  buyer: 'Aisha Bello', country: 'NG', channel: 'whatsapp', status: 'handled', pendingDraft: null, ownership: 'AI',
  catchUp: catchUp(rows), ...over,
});

const page = (d: ConversationDetail, l: Locale, name: string | null = 'Mira'): string =>
  plain(withAssistantName(name, () => renderConversationDetail(d, l, NOW, null)));
const strip = (html: string): string => /<header class="catchup[^"]*">[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
const stateLine = (html: string): string => /<p class="cu-state">[\s\S]*?<\/p>/.exec(strip(html))?.[0] ?? '';
/** A sentence of the catalogue with a piece drawn into it: the words on either side of the piece. */
const sides = (l: Locale, key: MessageKey, param: string): string[] =>
  esc(t(l, key, { [param]: '\u0000' })).split('\u0000').map((x) => x.trim()).filter(Boolean);

const facts = (over: Partial<PlayFacts> = {}): PlayFacts => ({
  orderWaiting: false, deletionWaiting: false, handedOver: false, handoffReason: null, replyToReview: false,
  lastOrder: null, quoteSentAt: null, lastFromThemAt: null, lastMessage: null, ...over,
});

describe('the state of play — one pure function, its precedence in one place', () => {
  it('needs you comes first, and says why in the Buyers row\'s order: an order, a deletion, a hand-over, a reply', () => {
    const all = facts({
      orderWaiting: true, deletionWaiting: true, handedOver: true, handoffReason: 'human_requested', replyToReview: true,
      lastOrder: { reference: 'R', confirmedAt: ago(DAY) }, quoteSentAt: ago(DAY), lastMessage: { from: 'buyer', at: ago(MIN) },
    });
    expect(stateOfPlay(all, NOW)).toEqual({ kind: 'needs', why: 'order', reason: null });
    expect(stateOfPlay({ ...all, orderWaiting: false }, NOW)).toEqual({ kind: 'needs', why: 'deletion', reason: null });
    expect(stateOfPlay({ ...all, orderWaiting: false, deletionWaiting: false }, NOW))
      .toEqual({ kind: 'needs', why: 'handed', reason: 'human_requested' });
    expect(stateOfPlay({ ...all, orderWaiting: false, deletionWaiting: false, handedOver: false }, NOW))
      .toEqual({ kind: 'needs', why: 'review', reason: null });
  });

  it('then an order just confirmed — within the week, not after it', () => {
    const at = (ms: number, quote = ago(30 * DAY)) => facts({ lastOrder: { reference: 'ZX-1042', confirmedAt: ago(ms) }, quoteSentAt: quote });
    expect(stateOfPlay(at(2 * DAY), NOW)).toEqual({ kind: 'ordered', reference: 'ZX-1042', at: ago(2 * DAY) });
    expect(stateOfPlay(at(ORDER_JUST_DAYS * DAY), NOW).kind).toBe('ordered');
    // past the week: a quote given after that order still waits; the order answered the one before it
    expect(stateOfPlay(at(ORDER_JUST_DAYS * DAY + MIN, ago(3 * DAY)), NOW).kind).toBe('quoted');
    expect(stateOfPlay(at(ORDER_JUST_DAYS * DAY + MIN), NOW).kind).toBe('none');
    // a confirmation stamped a moment ahead of the clock is still "just"
    expect(stateOfPlay(at(-MIN), NOW).kind).toBe('ordered');
  });

  it('then a quote they were given and have not answered with an order — a question after it does not end the wait (w4-conversation-13)', () => {
    const sent = ago(3 * DAY);
    expect(stateOfPlay(facts({ quoteSentAt: sent, lastFromThemAt: ago(4 * DAY) }), NOW)).toEqual({ kind: 'quoted', at: sent });
    expect(stateOfPlay(facts({ quoteSentAt: sent, lastFromThemAt: null }), NOW)).toEqual({ kind: 'quoted', at: sent });
    // Carlos: quoted, then "What plug type?", then answered — the quote still waits on him
    expect(stateOfPlay(facts({ quoteSentAt: sent, lastFromThemAt: ago(2 * DAY), lastMessage: { from: 'assistant', at: ago(2 * DAY - MIN) } }), NOW))
      .toEqual({ kind: 'quoted', at: sent });
    // an order of theirs from then on is their answer
    const answered = facts({ quoteSentAt: sent, lastOrder: { reference: 'R', confirmedAt: ago(2 * DAY) }, lastMessage: { from: 'buyer', at: ago(DAY) } });
    expect(stateOfPlay({ ...answered, lastOrder: { reference: 'R', confirmedAt: ago(10 * DAY) } }, NOW).kind).toBe('quoted');
    expect(stateOfPlay({ ...answered, lastOrder: { reference: 'R', confirmedAt: ago(2 * DAY) } }, NOW).kind).toBe('ordered');
    expect(stateOfPlay({ ...answered, quoteSentAt: ago(12 * DAY), lastOrder: { reference: 'R', confirmedAt: ago(10 * DAY) } }, NOW).kind).toBe('last');
    // a long-unanswered quote is still what they owe an answer to, before "gone quiet"
    expect(stateOfPlay(facts({ quoteSentAt: ago(40 * DAY), lastFromThemAt: ago(41 * DAY) }), NOW).kind).toBe('quoted');
  });

  it('then gone quiet — two weeks without a word from them; somebody who never wrote has not gone quiet', () => {
    const msg = (ms: number) => ({ from: 'assistant' as const, at: ago(ms) });
    expect(stateOfPlay(facts({ lastFromThemAt: ago(QUIET_DAYS * DAY), lastMessage: msg(DAY) }), NOW))
      .toEqual({ kind: 'quiet', since: ago(QUIET_DAYS * DAY) });
    expect(stateOfPlay(facts({ lastFromThemAt: ago(QUIET_DAYS * DAY - MIN), lastMessage: msg(DAY) }), NOW).kind).toBe('last');
    expect(stateOfPlay(facts({ lastFromThemAt: null, lastMessage: msg(30 * DAY) }), NOW).kind).toBe('last');
  });

  it('otherwise talking now, or the last message — who and when — or nothing yet', () => {
    expect(stateOfPlay(facts({ lastFromThemAt: ago(MIN), lastMessage: { from: 'person', at: ago(MIN) } }), NOW))
      .toEqual({ kind: 'talking', from: 'person', at: ago(MIN) });
    expect(stateOfPlay(facts({ lastMessage: { from: 'assistant', at: ago(TALKING_MINUTES * MIN) } }), NOW))
      .toEqual({ kind: 'last', from: 'assistant', at: ago(TALKING_MINUTES * MIN) });
    expect(stateOfPlay(facts(), NOW)).toEqual({ kind: 'none' });
  });
});

describe('the catch-up strip — above the messages, in the first screen', () => {
  it('holds the face that opens the card, the name, where they write, what they bought, what they spent, and Regular', () => {
    for (const l of LOCALES) {
      const html = page(detail(), l);
      const s = strip(html);
      expect(s, l).not.toBe('');
      // above the messages, right under the row of doors, and the page's one heading
      expect(html.indexOf('<header class="catchup">'), l).toBeLessThan(html.indexOf('class="timeline'));
      expect(html.indexOf('<div class="dhead">'), l).toBeLessThan(html.indexOf('<header class="catchup">'));
      expect(html.match(/<h1[\s>]/g), l).toHaveLength(1);
      // the face: a link to the card, at the strip's size, drawn from what the page knew
      expect(s, l).toContain(`<a class="face-link" href="/app/customers/${CLIENT}" data-card aria-label="${esc(t(l, 'catchup.card', { who: 'Aisha Bello' }))}">`);
      expect(s, l).toMatch(/<span class="face face-l t\d" aria-hidden="true"><span class="face-i">A<\/span><\/span><\/a>/);
      expect(s, l).not.toContain('<img');
      // the name, as the header always drew it
      expect(s, l).toContain('<h1 class="who">🇳🇬 <b><bdi>Aisha Bello</bdi></b>');
      // where they write: the channel's word and the number as it is dialled
      expect(s, l).toContain(`${esc(t(l, 'conv.channel.whatsapp'))} <bdi dir="ltr">+2348035550101</bdi>`);
      // what they bought: the products of their orders that stand, with how many
      const [tote, apron] = l === 'zh' ? ['帆布袋', '围裙'] : ['Canvas tote', 'Apron'];
      expect(s, l).toContain(`<bdi>${tote}</bdi>&nbsp;<bdi dir="ltr">×2</bdi>`);
      expect(s, l).toContain(`<bdi>${apron}</bdi>`);
      expect(s, l).not.toContain(`<bdi>${apron}</bdi>&nbsp;<bdi dir="ltr">`);
      for (const side of sides(l, 'catchup.bought', 'items')) expect(s, l).toContain(side);
      // what they spent, and the Regular mark
      expect(s, l).toContain(`<span class="fig">`);
      expect(s, l).toContain(`<bdi>${plain(show.money(l, usd(1240)))}</bdi>`);
      for (const side of sides(l, 'catchup.spent', 'money')) expect(s, l).toContain(side);
      expect(s, l).toContain(`<span class="cu-regular">${esc(t(l, 'catchup.regular'))}</span>`);
    }
  });

  it('a customer who has bought nothing: what they asked about, "nothing bought yet", no spend, no Regular; their photo when one is kept', () => {
    const none = { bought: [], value: { clientId: CLIENT, spent: null, orders: 0, lastOrderAt: null, regular: false, quietSince: null }, lastOrder: null };
    for (const l of LOCALES) {
      // the conversation's own product and quantity, labelled (w4-conversation-05): not an unlabelled line under the strip
      const html = page(detail({}, { ...none, photo: 'abc123def456' }), l);
      const s = strip(html);
      expect(s, l).toContain(esc(t(l, 'catchup.askedQty', { product: '\u0000', qty: '\u0001' }))
        .replace('\u0000', '<bdi>Vacuum cup</bdi>').replace('\u0001', `<bdi class="fig">${plain(show.quantityOf(l, 5000, t(l, 'product.unit.pcs')))}</bdi>`));
      expect(s, l).toContain(esc(t(l, 'catchup.none')));
      expect(html, l).not.toContain('class="muted subline"');
      // no product of its own: the panel's reading, else the newest price worked out for them (the loader)
      const bare = strip(page(detail({ product: { name: null, nameZh: null }, quantity: null }, none), l));
      for (const side of sides(l, 'catchup.asked', 'product')) expect(bare, l).toContain(side);
      expect(bare, l).toContain(`<bdi>${l === 'zh' ? '帆布袋' : 'Canvas tote'}</bdi>`);
      expect(bare, l).toContain(esc(t(l, 'catchup.none')));
      // nothing asked and nothing bought still says so
      expect(strip(page(detail({ product: { name: null, nameZh: null }, quantity: null }, { ...none, askedAbout: null }), l)), l)
        .toContain(`<p class="cu-facts"><span class="fig">${esc(t(l, 'catchup.none'))}</span></p>`);
      for (const side of sides(l, 'catchup.bought', 'items')) expect(s, l).not.toContain(side);
      expect(s, l).not.toContain('cu-regular');
      expect(s, l).not.toContain(esc(t(l, 'catchup.regular')));
      expect(s, l).toContain(`<img class="face-p" src="/app/faces/${CLIENT}?v=abc123def456" alt="" width="56" height="56" loading="lazy" decoding="async">`);
    }
  });

  it('more products than it names says how many more', () => {
    const s = strip(page(detail({}, {
      bought: [{ name: 'A', nameZh: null, orders: 1 }, { name: 'B', nameZh: null, orders: 1 }, { name: 'C', nameZh: null, orders: 4 }], boughtMore: 2,
    }), 'en'));
    expect(s).toContain('<bdi>A</bdi>, <bdi>B</bdi>, <bdi>C</bdi>&nbsp;<bdi dir="ltr">×4</bdi> and 2 more');
  });

  it('right to left, the face sits at the start and every Latin name keeps its own order', () => {
    const s = strip(page(detail(), 'ar'));
    expect(s.indexOf('class="face-link"')).toBeGreaterThan(-1);
    expect(s.indexOf('class="face-link"')).toBeLessThan(s.indexOf('<h1 class="who">'));
    expect(s).toContain('<bdi>Aisha Bello</bdi>');
    expect(s).toContain('<bdi>Canvas tote</bdi>');
    // the strip's own rules use the logical sides only, so they mirror with the page
    const css = linkedCss(shell({ title: 'T', active: 'inbox', locale: 'ar', path: '/app/inbox', bodyHtml: '' }));
    const own = [...css.matchAll(/([^{}]*\.(?:catchup|cu-[a-z]+)[^{}]*)\{([^{}]*)\}/g)];
    expect(own.length).toBeGreaterThan(3);
    for (const m of own) expect(m[2], m[1]).not.toMatch(/\b(left|right)\b/);
  });

  it('with no customer rows (a fixture, no customer on record) it is the name and who holds it, as the header was', () => {
    const html = page(detail({ catchUp: null, ownership: 'OWNER_CONTROLLED' }), 'en');
    const s = strip(html);
    expect(s).toContain('<h1 class="who">🇳🇬 <b><bdi>Aisha Bello</bdi></b>');
    expect(s).toContain('<header class="catchup bare">');
    expect(s).not.toContain('face-link');
    expect(s).not.toContain('cu-where');
    expect(s).not.toContain('cu-facts');
    expect(stateLine(html)).toContain(`<span class="pill owner">${esc(t('en', 'takeover.status.owner'))}</span>`);
  });
});

describe('the state of play, drawn — one line, from the rows', () => {
  const needsPill = (l: Locale) => `<span class="pill warn">${esc(t(l, 'inbox.filter.pending'))}</span>`;

  it('needs you: the Buyers list\'s pill, then why in the Buyers row\'s own words', () => {
    const cases: [string, ConversationDetail][] = [
      ['review', detail({ pendingDraft: conversationDetail().pendingDraft, status: 'awaiting' })],
      ['handed', detail({ ownership: 'WAITING_HUMAN', handoffReasons: ['human_requested'] })],
      ['deletion', detail({ deletionAsk: { askedAt: ago(DAY) } })],
      ['order', detail({ ownership: 'OWNER_CONTROLLED', orderProposal: {
        id: 'op-1', conversationId: 'c', productId: 'p', productName: 'Canvas tote', quantity: 500, unit: 'pcs',
        unitPrice: usd(1.2), total: usd(600), email: 'buyer@example.com', paymentTerms: null, incoterm: null, createdAt: ago(MIN),
      } })],
    ];
    for (const l of LOCALES) {
      for (const [why, d] of cases) {
        const line = stateLine(page(d, l));
        expect(line, `${l} ${why}`).toContain(needsPill(l));
        expect(line, `${l} ${why}`).toContain(`<b><bdi>${esc(plain(needsWhy(l, paneRowOf(d))))}</bdi></b>`);
      }
    }
  });

  it('an order just confirmed, a quote waiting on them, gone quiet, talking now, the last message, nothing yet', () => {
    for (const l of LOCALES) {
      const head = (k: MessageKey) => `<b>${esc(t(l, k))}</b>`;
      const ordered = stateLine(page(detail({}, { lastOrder: { reference: 'ZX-1042', confirmedAt: ago(2 * DAY) } }), l));
      // w4-conversation-14 — a break only after a separator, and never inside a reference, a name or a time
      expect(ordered, l).toContain(`${head('catchup.state.ordered')}&nbsp;· <bdi class="fig">ZX-1042</bdi>&nbsp;· <span class="fig">`);
      const quoted = stateLine(page(detail({}, { quoteSentAt: ago(3 * DAY), lastFromThemAt: ago(4 * DAY) }), l));
      expect(quoted, l).toContain(head('catchup.state.quoted'));
      const quiet = stateLine(page(detail({}, { lastFromThemAt: ago(20 * DAY), lastMessage: { from: 'assistant', at: ago(19 * DAY) } }), l));
      expect(quiet, l).toContain(`${head('catchup.state.quiet')}&nbsp;· ${esc(t(l, 'catchup.state.quietSince', { date: plain(show.date(l, ago(20 * DAY))) }))}`);
      const talking = stateLine(page(detail({}, { lastMessage: { from: 'assistant', at: ago(5 * MIN) } }), l));
      expect(talking, l).toContain(`${head('catchup.state.talking')}&nbsp;· <span class="fig"><span class="as"><span aria-hidden="true">✦</span> Mira</span></span>&nbsp;· <span class="fig">`);
      const last = stateLine(page(detail(), l));
      expect(last, l).toContain(`${head('catchup.state.last')}&nbsp;· <span class="fig"><bdi>Aisha Bello</bdi></span>`);
      const mine = stateLine(page(detail({}, { lastMessage: { from: 'person', at: ago(DAY) } }), l));
      expect(mine, l).toContain(`${head('catchup.state.last')}&nbsp;· <span class="fig">${esc(t(l, 'conv.by.you'))}</span>`);
      const none = stateLine(page(detail({}, { lastMessage: null, lastFromThemAt: null }), l));
      expect(none, l).toContain(head('catchup.state.none'));
      // away from "needs you", the pill says who holds the conversation, as the header did
      expect(last, l).toContain(`<span class="pill ok">${esc(t(l, 'inbox.status.handled'))}</span>`);
      expect(last, l).not.toContain(needsPill(l));
    }
  });
});

describe('the assistant\'s words are marked as the assistant\'s; a person\'s are not', () => {
  const thread = (over: Partial<ConversationDetail> = {}): ConversationDetail => detail({
    messages: [
      { direction: 'inbound', text: 'CUSTOMER-WORDS', at: ago(30 * MIN) },
      { direction: 'outbound', text: 'ASSISTANT-WORDS', at: ago(29 * MIN) },
      { direction: 'outbound', text: 'PERSON-WORDS', at: ago(20 * MIN), by: 'owner' },
      { direction: 'outbound', text: 'FIRST-WORDS', at: ago(10 * MIN), by: 'outreach' },
    ],
    ...over,
  });
  /** One message of the transcript: the assistant's label over it (w4-conversation-17), its bubble and its caption. */
  const msg = (html: string, words: string): string =>
    new RegExp(`<div(?: id="latest")? class="msg [a-z]+">\\s*(?:<div class="msg-by">.*?</div>\\s*)?<div dir="auto" class="[^"]+"><bdi>${words}</bdi></div>\\s*<div class="ts muted">[\\s\\S]*?</div>`).exec(html)?.[0] ?? '';

  it('the assistant\'s bubble is on its wash with "✦ name" over it; the customer\'s and a person\'s keep the plain bubble', () => {
    for (const l of LOCALES) {
      const html = page(thread(), l);
      for (const w of ['ASSISTANT-WORDS', 'FIRST-WORDS']) {
        expect(msg(html, w), `${l} ${w}`).toContain(`class="bubble by-as"><bdi>${w}`);
        expect(msg(html, w), `${l} ${w}`).toContain('<span class="as"><span aria-hidden="true">✦</span> Mira</span>');
      }
      expect(msg(html, 'PERSON-WORDS'), l).toContain('class="bubble"><bdi>PERSON-WORDS');
      expect(msg(html, 'PERSON-WORDS'), l).toContain(esc(t(l, 'conv.by.you')));
      expect(msg(html, 'CUSTOMER-WORDS'), l).toContain('class="bubble"><bdi>CUSTOMER-WORDS');
      expect(msg(html, 'CUSTOMER-WORDS'), l).toContain('<bdi>Aisha Bello</bdi>');
      for (const w of ['PERSON-WORDS', 'CUSTOMER-WORDS']) expect(msg(html, w), `${l} ${w}`).not.toMatch(/by-as|class="as"|✦/);
      expect(html.match(/class="bubble by-as"/g), l).toHaveLength(2);
    }
  });

  it('before a name is chosen, the label is the assistant\'s fallback (rule 7)', () => {
    for (const l of LOCALES) {
      const html = page(thread(), l, null);
      expect(msg(html, 'ASSISTANT-WORDS'), l).toContain(`<span class="as"><span aria-hidden="true">✦</span> ${esc(assistantName(l))}</span>`);
    }
  });

  it('Practice draws its transcript the same way', () => {
    const view: SandboxView = {
      hasConversation: true, conversationId: 'p-1', lastTurn: null, ownership: 'AI',
      messages: [
        { direction: 'inbound', text: 'CUSTOMER-WORDS', isImage: false },
        { direction: 'outbound', text: 'ASSISTANT-WORDS', isImage: false },
        { direction: 'outbound', text: 'PERSON-WORDS', isImage: false, by: 'owner' },
      ],
    };
    for (const l of LOCALES) {
      const html = plain(withAssistantName('Mira', () => renderSandbox(view, l, { flash: null, now: NOW })));
      expect(msg(html, 'ASSISTANT-WORDS'), l).toContain('class="bubble by-as"><bdi>ASSISTANT-WORDS');
      expect(msg(html, 'ASSISTANT-WORDS'), l).toContain('<span class="as"><span aria-hidden="true">✦</span> Mira</span>');
      expect(msg(html, 'PERSON-WORDS'), l).toContain('class="bubble"><bdi>PERSON-WORDS');
      expect(msg(html, 'PERSON-WORDS'), l).toContain(esc(t(l, 'conv.by.you')));
      expect(msg(html, 'CUSTOMER-WORDS'), l).toContain('class="bubble"><bdi>CUSTOMER-WORDS');
      expect(html.match(/class="bubble by-as"/g), l).toHaveLength(1);
    }
  });

  it('the customer panel says where they write in the same words as the strip', () => {
    const panel: CustomerPanel = {
      clientId: CLIENT, name: 'Aisha Bello', country: 'NG', channel: 'whatsapp', address: '2348035550101', language: null,
      firstWrote: null, conversations: 1, askedAbout: [], prices: [], samples: [], promised: [], orders: [], activity: [],
    };
    for (const l of LOCALES) {
      const line = `${esc(t(l, 'conv.channel.whatsapp'))} <bdi dir="ltr">+2348035550101</bdi>`;
      expect(plain(renderCustomerPanel(panel, [], l, NOW, 'c')), l).toContain(line);
      expect(strip(page(detail(), l)), l).toContain(line);
    }
  });
});

describe('the stylesheet — a wash and a label, never a magenta frame', () => {
  const css = linkedCss(shell({ title: 'T', active: 'inbox', locale: 'en', path: '/app/inbox', bodyHtml: '' }));
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
  const C = DESIGN_TOKENS.color as Record<string, string>;
  const camel = (k: string) => k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const colourOf = (value: string): string[] => [
    ...[...value.matchAll(/var\(--color-([a-z-]+)\)/g)].map((m) => (C[camel(m[1]!)] ?? '').toUpperCase()),
    ...[...value.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toUpperCase()),
  ];

  it('the assistant\'s bubble: its wash for a ground, the hairline taken off — no frame', () => {
    expect(css).toContain('.msg.outbound .bubble.by-as { background:var(--color-assistant-wash); border-color:transparent; }');
    expect(css).toContain('.as { color:var(--color-assistant); }');
  });

  it('no border, outline or shadow anywhere in the stylesheet is drawn in magenta', () => {
    const framed: string[] = [];
    for (const r of rules) {
      const magentaText = /(?:^|[;\s])color\s*:\s*([^;]+)/.exec(r.body)?.[1];
      for (const d of r.body.split(';')) {
        const m = /^\s*([a-z-]+)\s*:\s*([\s\S]+)$/.exec(d);
        if (!m || !/^(border|outline|box-shadow|column-rule)/.test(m[1]!)) continue;
        if (colourOf(m[2]!).includes(MAGENTA)) framed.push(`${r.sel} { ${d.trim()} }`);
        if (/currentcolor/i.test(m[2]!) && magentaText && colourOf(magentaText).includes(MAGENTA)) framed.push(`${r.sel} { ${d.trim()} } in magenta text`);
      }
    }
    expect(framed).toEqual([]);
  });

  it('contrast: ink on the wash, and the magenta label on paper and on white, all clear 4.5:1', () => {
    const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };
    expect(ratio(C['ink']!, C['assistantWash']!)).toBeGreaterThanOrEqual(12);
    expect(ratio(C['assistant']!, C['surface']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(C['assistant']!, C['paper']!)).toBeGreaterThanOrEqual(4.5);
    // the captions under a bubble, and the strip's quieter words
    expect(ratio(C['inkSecondary']!, C['paper']!)).toBeGreaterThanOrEqual(4.5);
  });

  it('the draft card rises in once, over the normal duration, and only for a reader who did not ask for less motion', () => {
    const animated = rules.filter((r) => /#approve\b/.test(r.sel) && /animation/.test(r.body));
    expect(animated).toHaveLength(1);
    expect(animated[0]!.body).toContain('nomi-rise var(--motion-normal) var(--motion-ease)');
    const noPref = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? '';
    expect(noPref).toMatch(/#approve[^{]*\{ animation:nomi-rise var\(--motion-normal\) var\(--motion-ease\) both; \}/);
    expect(css).toContain('@keyframes nomi-rise { from { opacity:0; transform:translateY(8px); } }');
    // and the conversation's and Practice's draft are the one card
    const d = page(detail({ pendingDraft: conversationDetail().pendingDraft }), 'en');
    expect(d).toContain('<section class="card draft" id="approve"');
  });
});
