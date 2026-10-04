import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import {
  renderInboxList, renderConversationDetail,
  type InboxList, type ConversationDetail, type HumanActionType,
} from '../../src/api/web/inbox.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import type { Locale } from '../../src/core/owner/i18n/locale.js';
import { t as say, assistantName, withAssistantName } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import type { ConversationOwnership } from '../../src/core/conversation/ownership.js';

const NOW = new Date('2026-07-27T10:00:00Z');

/** A catalogue sentence as the page prints it: the page's own `t`, escaped the same way. */
const shown = (l: Locale, key: MessageKey, params?: Record<string, string | number>): string => esc(say(l, key, params));

const listWithWork: InboxList = {
  filter: 'pending', waitingCount: 1, blockedCount: 0,
  conversations: [{
    conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE',
    status: 'awaiting', needsAction: true, ownership: 'AI', heldBy: null, awaitingReview: true, handoffReason: null,
    latestMessage: 'Can you do 5000 pcs?', latestAt: NOW,
    product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: 5000, unitPrice: usd(0.92),
  }],
};

const detailWithDraft: ConversationDetail = {
  conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
  product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: 5000,
  quote: { unitPrice: usd(0.92), total: usd(4600), quantity: 5000 },
  order: null,
  messages: [
    { direction: 'inbound', text: 'Price for 5000?', at: new Date('2026-07-27T09:00:00Z') },
    { direction: 'outbound', text: 'Checking for you.', at: new Date('2026-07-27T09:01:00Z') },
  ],
  pendingDraft: { draftId: 'd-1', draftText: 'For 5,000 pcs: $0.92/pc FOB Ningbo.', capability: 'quote' },
  ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null, lastHumanAction: null, knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
};

// M16.2c — a conversation detail in a given ownership state (draft omitted for
// owner-controlled, which hides the draft card by design).
const detailIn = (ownership: ConversationOwnership, over: Partial<ConversationDetail> = {}): ConversationDetail => ({
  ...detailWithDraft, ownership, pendingDraft: ownership === 'OWNER_CONTROLLED' ? null : detailWithDraft.pendingDraft, ...over,
});

describe('M9.3 · inbox list (localized)', () => {
  it('zh: buyer, country, status, product, deep link', () => {
    const html = renderInboxList(listWithWork, 'zh', NOW);
    expect(html).toContain('客户'); expect(html).toContain('Ahmed');
    // the country is the customer panel's; the row is the state, who, the time and the message
    expect(html).not.toContain('🇦🇪');
    expect(html).toContain(shown('zh', 'buyers.badge.reviewShort'));
    // The warmth run, phase 4 — the row is the customer's: what they asked about and its
    // figures left it (the conversation and the card carry them); what they spent is its number.
    expect(html).not.toContain('5000个'); expect(html).not.toContain('$0.92');
    // CC-25 — a buyer opens on the newest message, with the reply waiting under it.
    expect(html).toContain('href="/app/inbox/conv-1#latest"');
  });

  // The warmth run (phase 4): a row is the customer — face, name, spent, last contact; the
  // product and its quantity left the row (the conversation's strip and the card carry them).
  it('en: localized chrome', () => {
    const html = renderInboxList(listWithWork, 'en', NOW);
    expect(html).toContain('Inbox'); expect(html).toContain(shown('en', 'buyers.badge.reviewShort'));
    expect(html).toContain('Needs you');
    expect(html).not.toContain('保温杯');
  });

  it('empty pending → all-good per locale, not "no data"', () => {
    expect(renderInboxList({ filter: 'pending', waitingCount: 0, blockedCount: 0, conversations: [] }, 'zh', NOW)).toContain('现在没有客户需要你');
    const en = renderInboxList({ filter: 'pending', waitingCount: 0, blockedCount: 0, conversations: [] }, 'en', NOW);
    expect(en).toContain('No customer needs you right now');
    expect(en.toLowerCase()).not.toContain('no data');
  });

  it('empty all → explains the next action', () => {
    expect(renderInboxList({ filter: 'all', waitingCount: 0, blockedCount: 0, conversations: [] }, 'en', NOW)).toContain('No conversations yet');
  });

  // The warmth run, phase 4 — there is no default filter any more: the Inbox opens on the whole
  // list in "waiting now", where everyone who needs the owner already leads
  // (tests/parity/warmth-inbox.test.ts). `defaultFilter` is gone with the "open on Needs you" rule.
});

describe('M9.3 · conversation detail (localized)', () => {
  it('chronological, sender-distinguished timeline (buyer / employee per locale)', () => {
    const html = renderConversationDetail(detailWithDraft, 'zh', NOW, null);
    const inbound = html.indexOf('Price for 5000?');
    const outbound = html.indexOf('Checking for you.');
    expect(outbound).toBeGreaterThan(inbound);
    expect(html).toContain('msg inbound'); expect(html).toContain('msg outbound');
    expect(html).toContain('客户'); expect(html).toContain(esc(assistantName('zh')));
    expect(renderConversationDetail(detailWithDraft, 'en', NOW, null)).toContain(esc(assistantName('en')));
    // a named assistant's lines carry the name the owner chose
    expect(withAssistantName('Lily', () => renderConversationDetail(detailWithDraft, 'en', NOW, null))).toContain('Lily');
  });

  it('pending draft: one form, one Send, the reply once in its box, and the acts in a row (the design pass)', () => {
    const html = renderConversationDetail(detailWithDraft, 'en', NOW, null);
    expect(html).toContain(shown('en', 'buyers.review.title'));       // the card's heading, for a screen reader
    // the reply ONCE — in the box, which is the reply
    expect(html.split('For 5,000 pcs: $0.92/pc FOB Ningbo.')).toHaveLength(2);
    expect(html).toMatch(/<textarea id="reply" name="edit"[^>]*>For 5,000 pcs: \$0\.92\/pc FOB Ningbo\.<\/textarea>/);
    expect(html).toContain('action="/app/inbox/conv-1/act"');
    expect(html).toContain('name="draftId" value="d-1"');
    expect(html.match(/name="command" value="send"/g)).toHaveLength(1);        // one Send
    expect(html).toContain('name="command" value="不回"');                    // No reply needed: the wire's skip
    expect(html).toContain('formaction="/app/inbox/conv-1/takeover"');        // Hand to me
    expect(html).not.toContain('<label class="btn" for="reply">');               // Phase 2 — Edit went: the box is always editable
    expect(html).not.toContain('value="收回"');                               // on the assistant's page now
    for (const k of ['inbox.action.send', 'card.handToMe', 'card.noReply'] as const) expect(html).toContain(shown('en', k));
    expect(html.match(/class="btn send needs"/g)).toHaveLength(1);           // one filled button (the warmth pass: deep, it answers a waiting reply), the rest outlined alike
    expect(html).not.toContain('class="btn send"');
  });

  it('quote/order context localized, omitted cleanly when absent', () => {
    const en = renderConversationDetail(detailWithDraft, 'en', NOW, null);
    expect(en).toContain('Quote'); expect(en).toContain('total $4,600.00');
    expect(renderConversationDetail(detailWithDraft, 'zh', NOW, null)).toContain('报价');
    const noCtx = renderConversationDetail({ ...detailWithDraft, quote: null, order: null }, 'en', NOW, null);
    expect(noCtx).not.toContain('class="ctx"');
  });

  it('no pending draft → honest "nothing to confirm" state', () => {
    const html = renderConversationDetail({ ...detailWithDraft, pendingDraft: null }, 'en', NOW, null);
    expect(html).toContain('No reply is waiting');
    expect(html).not.toContain(shown('en', 'buyers.review.title'));
  });

  it('flash shown when present', () => {
    expect(renderConversationDetail(detailWithDraft, 'zh', NOW, { text: '已发送。', bad: false })).toContain('已发送。');
  });
});

describe('M9.3 · owner language + security (every locale)', () => {
  it('no technical / AI vocabulary', () => {
    for (const l of LOCALES) {
      const all = (renderInboxList(listWithWork, l, NOW) + renderConversationDetail(detailWithDraft, l, NOW, null)).toLowerCase();
      for (const banned of ['ai', 'llm', 'model', 'token', 'database', 'webhook', 'confidence', '模型', '人工智能', '数据库', 'draft_pending', 'autonomy']) {
        const hit = /^[a-z_ ]+$/.test(banned) ? new RegExp(`\\b${banned}\\b`).test(all) : all.includes(banned);
        expect(hit, `${l}:"${banned}"`).toBe(false);
      }
    }
  });

  it('no tables', () => { expect(renderInboxList(listWithWork, 'en', NOW)).not.toContain('<table'); });

  it('escapes buyer-controlled text', () => {
    const evil = renderConversationDetail({
      ...detailWithDraft, buyer: '<script>alert(1)</script>',
      messages: [{ direction: 'inbound', text: '<img src=x onerror=alert(1)>', at: NOW }],
      pendingDraft: { draftId: 'd', draftText: '</textarea><script>bad()</script>', capability: 'quote' },
    }, 'en', NOW, null);
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).not.toContain('<img src=x onerror');
    expect(evil).not.toContain('<script>bad()</script>');
    expect(evil).toContain('&lt;script&gt;');
  });
});

describe('M16.2c · inbox human control surface (localized)', () => {
  const at = new Date('2026-07-27T08:00:00Z');
  const withLast = (o: ConversationDetail['ownership'], type: HumanActionType, actor = 'owner') =>
    detailIn(o, { lastHumanAction: { type, actor, at } });

  it('AI state: employee-handling status + ONE take-over control; no reply/return', () => {
    // A reply waits: the card's "Hand to me" is the take-over, and nothing else offers it.
    const html = renderConversationDetail(detailIn('AI'), 'en', NOW, null);
    // The fix wave (w4-conversation-03) — with a reply waiting, the draft card is the whole story:
    // no second card under it repeating that the reply waits, nor a "Hand to" a colleague (-04).
    expect(html).not.toContain(shown('en', 'takeover.status.aiDraft'));
    expect(html).not.toContain('class="card takeover');
    expect(html).not.toContain('/handto');
    expect(html).toContain('formaction="/app/inbox/conv-1/takeover"');
    expect(html).not.toMatch(/ action="\/app\/inbox\/conv-1\/takeover"/);
    expect(html).toContain(shown('en', 'card.handToMe'));
    expect(html).not.toContain('action="/app/inbox/conv-1/reply"');
    expect(html).not.toContain('action="/app/inbox/conv-1/resume"');
    // Nothing waits: the take-over is the ownership card's own button.
    const quiet = renderConversationDetail({ ...detailIn('AI'), pendingDraft: null }, 'en', NOW, null);
    expect(quiet).toContain(shown('en', 'takeover.status.ai'));
    expect(quiet).toContain(' action="/app/inbox/conv-1/takeover"');
    expect(quiet).toContain(shown('en', 'takeover.action.take'));
    expect(t('en', 'takeover.action.take')).toBe(t('en', 'card.handToMe'));
  });

  it('WAITING_HUMAN state: waiting status + stored handoff reasons + take-over', () => {
    const html = renderConversationDetail(
      detailIn('WAITING_HUMAN', { handoffReasons: ['human_requested', 'complaint'] }), 'en', NOW, null);
    expect(html).toContain('Needs you');
    expect(html).toContain('Handed to you because');
    expect(html).toContain('the customer asked for a person');   // stored reason, not a summary
    expect(html).toContain('a complaint');
    expect(html).toContain('action="/app/inbox/conv-1/takeover"');
    expect(html).not.toContain('action="/app/inbox/conv-1/reply"');
  });

  it('OWNER_CONTROLLED state: reply box + return-to-employee; draft card hidden', () => {
    const html = renderConversationDetail(detailIn('OWNER_CONTROLLED'), 'en', NOW, null);
    expect(html).toContain("You're handling this");
    expect(html).toContain('action="/app/inbox/conv-1/reply"');
    expect(html).toContain('name="text"');                     // the owner reply textarea
    expect(html).toContain('action="/app/inbox/conv-1/resume"');
    expect(html).toContain(shown('en', 'takeover.action.resume'));
    expect(html).not.toContain(shown('en', 'buyers.review.title'));   // no draft card while owner-controlled
  });

  it('last human action: kind + who + when, per type, and never a message body', () => {
    // Extract just the last-action line's text — so unrelated page content
    // (the quote context, the transcript) can't satisfy these by accident.
    const line = (type: HumanActionType) => {
      const html = renderConversationDetail(withLast('OWNER_CONTROLLED', type), 'en', NOW, null);
      return html.match(/class="lastact[^"]*">([^<]+)</)?.[1] ?? '';
    };
    expect(line('takeover')).toContain('Last action');
    expect(line('takeover')).toContain('Taken over by you');
    expect(line('owner_reply')).toContain('you replied');
    expect(line('resume_ai')).toContain(shown('en', 'takeover.last.resume_ai'));   // the assistant, never "AI"
    expect(line('resume_ai')).not.toMatch(/\bAI\b/);
    expect(line('draft_resolved')).toContain('you reviewed a reply');
    expect(line('owner_reply')).not.toContain('$');                   // the action line carries no price/body
  });

  it('a team member is NAMED, escaped — and an id nobody holds is never shown raw (G9b)', () => {
    const named = renderConversationDetail({
      ...withLast('AI', 'takeover', 'p-7'), pendingDraft: null, people: [{ id: 'p-7', name: '<b>Xiao Chen</b>', isOwner: false }],
    }, 'en', NOW, null);
    expect(named).toContain('Taken over by &lt;b&gt;Xiao Chen&lt;/b&gt;');
    expect(named).not.toContain('<b>Xiao Chen</b>');
    const unknown = renderConversationDetail({ ...withLast('AI', 'takeover', '<b>agent-7</b>'), pendingDraft: null }, 'en', NOW, null);
    expect(unknown).not.toContain('agent-7');
    expect(unknown).toContain(t('en', 'people.held.gone'));
  });

  it('localized states + last action in zh and ar', () => {
    const zh = renderConversationDetail(withLast('OWNER_CONTROLLED', 'takeover'), 'zh', NOW, null);
    expect(zh).toContain('你正在处理'); expect(zh).toContain('由你接手'); expect(zh).toContain('最近操作');
    const ar = renderConversationDetail(detailIn('WAITING_HUMAN'), 'ar', NOW, null);
    expect(ar).toContain('بحاجة إليك'); expect(ar).toContain(shown('ar', 'card.handToMe'));
  });

  it('invents no metric on the control surface — any locale', () => {
    for (const l of LOCALES) {
      const html = (
        renderConversationDetail(withLast('AI', 'resume_ai'), l, NOW, null) +
        renderConversationDetail(withLast('OWNER_CONTROLLED', 'owner_reply'), l, NOW, null)
      ).toLowerCase();
      for (const banned of ['confidence', 'score', 'ranking', 'rating']) {
        expect(html.includes(banned), `${l}:${banned}`).toBe(false);
      }
    }
  });
});

// ── Phase D · Buyers ────────────────────────────────────────────────────────
// The list answers ONE question — "who is speaking now?" — through the single
// ownership model. Nothing here is a score, a rate, or a ranking.
describe('Phase D · buyers list grouped by who is speaking', () => {
  const conv = (id: string, over: Partial<InboxList['conversations'][number]> = {}) => ({
    conversationId: id, buyer: `B-${id}`, country: 'AE' as string | null,
    status: 'awaiting' as const, needsAction: false, ownership: 'AI' as ConversationOwnership,
    awaitingReview: false, handoffReason: null as string | null, latestMessage: 'hi', latestAt: NOW,
    product: { name: null, nameZh: null }, quantity: null, unitPrice: null,
    heldBy: null as string | null, ...over,
  });
  const list = (cs: InboxList['conversations']): InboxList =>
    ({ filter: 'all', waitingCount: 0, blockedCount: 0, conversations: cs });

  const mixed = list([
    conv('c-ai'),
    conv('c-wait', { ownership: 'WAITING_HUMAN', heldBy: null, handoffReason: 'human_requested' }),
    conv('c-owner', { ownership: 'OWNER_CONTROLLED' }),
    conv('c-review', { awaitingReview: true }),
  ]);

  it('three groups, each conversation in exactly one, in owner-priority order', () => {
    const html = renderInboxList(mixed, 'en', NOW);
    const needs = html.indexOf('Needs you');
    const yours = html.indexOf('You are handling');
    const hers  = html.indexOf(shown('en', 'buyers.group.hers'));
    expect(needs).toBeGreaterThan(-1);
    expect(yours).toBeGreaterThan(needs);
    expect(hers).toBeGreaterThan(yours);
    for (const id of ['c-ai', 'c-wait', 'c-owner', 'c-review']) {
      expect(html.split(`href="/app/inbox/${id}#latest"`).length - 1, id).toBe(1);   // exactly once (CC-25: on the newest message)
    }
    // the two that need the owner are above the two that do not
    expect(html.indexOf('c-wait')).toBeLessThan(html.indexOf('c-owner'));
    expect(html.indexOf('c-review')).toBeLessThan(html.indexOf('c-ai'));
  });

  it('badges name the human action, never an internal state', () => {
    const html = renderInboxList(mixed, 'en', NOW);
    expect(html).toContain('the customer asked for a person');   // the STORED reason
    expect(html).toContain(shown('en', 'buyers.badge.reviewShort'));     // awaiting the owner's OK
    expect(html).toContain('You are handling');     // OWNER_CONTROLLED: its mark, said in words
    expect(html).not.toContain('unclaimed');
    expect(html).not.toContain('draft_pending');
    expect(html).not.toContain('Pending draft');
  });

  it('a group with no conversations is absent, not an empty shell', () => {
    const heads = (html: string) => [...html.matchAll(/class="bgroup-h">([^<]+)</g)].map((m) => m[1]);
    expect(heads(renderInboxList(list([conv('c-ai')]), 'en', NOW))).toEqual([shown('en', 'buyers.group.hers')]);
    expect(heads(renderInboxList(list([conv('c-w', { ownership: 'WAITING_HUMAN' })]), 'en', NOW))).toEqual(['Needs you']);
    // in the "needs you" view the tab already says it — no heading stutter
    expect(heads(renderInboxList({ ...mixed, filter: 'pending' }, 'en', NOW))).toEqual([]);
  });

  it('calm empty state is about the buyers, not about missing data', () => {
    const en = renderInboxList({ filter: 'pending', waitingCount: 0, blockedCount: 0, conversations: [] }, 'en', NOW);
    expect(en).toContain('No customer needs you right now');
    expect(en.toLowerCase()).not.toContain('no data');
    expect(en.toLowerCase()).not.toContain('0 conversations');
  });

  it('renders in all locales; ar keeps its own words (nothing falls back to English)', () => {
    for (const l of LOCALES) expect(renderInboxList(mixed, l, NOW).length).toBeGreaterThan(200);
    const ar = renderInboxList(mixed, 'ar', NOW);
    // V1 close-out — the heading is the tab's own noun phrase ("بحاجة إليك"): the
    // verb it had ("يحتاجون") agreed with the buyers, which Arabic copy never does.
    expect(ar).toContain('بحاجة إليك'); expect(ar).not.toContain('يحتاجون'); expect(ar).toContain(shown('ar', 'buyers.badge.reviewShort'));
    expect(ar).not.toContain('Needs you'); expect(ar).not.toContain(shown('en', 'buyers.badge.reviewShort'));
    const zh = renderInboxList(mixed, 'zh', NOW);
    expect(zh).toContain('等你处理'); expect(zh).toContain(shown('zh', 'buyers.badge.reviewShort'));   // Phase 9 (V1-175) — the group says what its tab says
  });

  it('invents no metric: no rate, percentage, score or ranking — any locale', () => {
    for (const l of LOCALES) {
      const html = renderInboxList(mixed, l, NOW).replace(/<style>[\s\S]*?<\/style>/g, '');
      expect(html).not.toMatch(/\d+\s*%/);
      for (const banned of ['score', 'rate', 'ranking', 'rating', 'accuracy', 'confidence', '成功率', '评分'])
        expect(html.toLowerCase().includes(banned), `${l}:${banned}`).toBe(false);
    }
  });
});

describe('Phase D · the reply is a colleague’s work, not a queue item', () => {
  it('review card marks the reply as the assistant\'s; who asked is the transcript\'s, just above', () => {
    const html = renderConversationDetail(detailWithDraft, 'en', NOW, null);
    expect(html).toContain(shown('en', 'buyers.review.title'));
    const top = html.slice(html.indexOf('<div class="top">'), html.indexOf('</div>', html.indexOf('<div class="top">')));
    expect(top).not.toContain('<b><bdi>Ahmed</bdi></b>');
    expect(top).toContain(`<span class="as"><span class="shape s-assistant" aria-hidden="true"></span> ${shown('en', 'card.drafted')}</span>`);
    expect(html).toContain('For 5,000 pcs: $0.92/pc FOB Ningbo.');
    expect(html).not.toContain('Pending draft');
    expect(html).not.toContain('⚠️');                       // reviewing a colleague is not an alarm
  });

  /**
   * CC-25 reversed the ORDER this test used to hold (the ownership card above
   * the transcript), deliberately: the owner approved replies with the buyer's
   * question off the screen. What it protected is still held — who speaks is
   * stated ABOVE the transcript, in the header, so nobody scrolls to find out —
   * and the card that acts on it now sits UNDER the transcript, with the
   * approval directly beneath the newest message.
   */
  it('who speaks is stated above the transcript; the approval and the ownership card sit under it', () => {
    const says: Record<ConversationOwnership, string> = {
      AI: shown('en', 'inbox.status.awaiting'),
      WAITING_HUMAN: shown('en', 'takeover.status.waiting'),
      OWNER_CONTROLLED: shown('en', 'takeover.status.owner'),
    };
    for (const o of ['AI', 'WAITING_HUMAN', 'OWNER_CONTROLLED'] as const) {
      const html = renderConversationDetail(detailIn(o), 'en', NOW, null);
      const msg = html.indexOf('class="msg');      // the buyer transcript
      const newest = html.indexOf('id="latest"');  // its newest message
      const own = html.indexOf('card takeover');   // the ownership card
      expect(msg, `${o}: transcript must render`).toBeGreaterThan(-1);
      // the fix wave (w4-conversation-03) — under a reply the assistant holds, the draft card is the ownership card too
      if (o === 'AI') {
        expect(own, 'AI with a reply waiting: no second card').toBe(-1);
        expect(html.indexOf('card draft')).toBeGreaterThan(html.indexOf('id="latest"'));
        continue;
      }
      expect(own, `${o}: ownership card must render`).toBeGreaterThan(-1);
      // the header: everything above the transcript's own section
      const head = html.slice(html.indexOf('<div class="dhead">'), html.indexOf('<div class="block">'));
      expect(head, `${o}: who speaks, stated in the header`).toContain(says[o]);
      expect(newest, o).toBeGreaterThan(msg);
      expect(own, o).toBeGreaterThan(newest);
      if (o !== 'OWNER_CONTROLLED') {
        const draft = html.indexOf('card draft');
        expect(draft, `${o}: the approval directly under the newest message`).toBeGreaterThan(newest);
        expect(draft, o).toBeLessThan(own);
        // nothing between the newest message's bubble and the approval but the end of the transcript
        expect(html.slice(newest, draft)).not.toMatch(/class="card/);
      } else {
        // the owner's own reply box is what sits under the newest message
        expect(html.slice(newest, own)).not.toMatch(/class="card/);
        expect(html.indexOf('action="/app/inbox/conv-1/reply"')).toBeGreaterThan(newest);
      }
    }
  });

  it('no contradictory status: a human-held conversation states ownership only', () => {
    // `statusOf` calls every assigned conversation "Paused" — printing that above
    // "Waiting for you" told the owner two different things at once.
    const wait = renderConversationDetail(detailIn('WAITING_HUMAN'), 'en', NOW, null);
    expect(wait).toContain('Needs you');
    expect(wait).not.toContain('Paused');
    const owned = renderConversationDetail(detailIn('OWNER_CONTROLLED'), 'en', NOW, null);
    expect(owned).not.toContain('Paused');
    // while the assistant holds it, the conversation's own state is still worth stating
    expect(renderConversationDetail(detailIn('AI'), 'en', NOW, null)).toContain('<span class="pill warn">Needs you</span>');
  });

  it('what the assistant used to answer: a reason on the card while a reply waits, its own section once one went, hidden once a human holds the pen', () => {
    const used = { knowledgeUsed: ['MOQ is 500 pcs', 'Lead time 20 days'] };
    // a reply waits: each taught fact is one of the card's reasons, and there is no second list
    const ai = renderConversationDetail(detailIn('AI', used), 'en', NOW, null);
    const reasons = ai.slice(ai.indexOf('<ul class="reasons">'), ai.indexOf('</ul>', ai.indexOf('<ul class="reasons">')));
    expect(reasons).toContain('MOQ is 500 pcs'); expect(reasons).toContain('Lead time 20 days');
    expect(reasons).toContain(shown('en', 'card.source.taught'));
    expect(ai).not.toContain(shown('en', 'buyers.knew.title'));
    // nothing waits (it answered alone): the section says what it leaned on
    const sent = renderConversationDetail({ ...detailIn('AI', used), pendingDraft: null }, 'en', NOW, null);
    expect(sent).toContain(shown('en', 'buyers.knew.title'));
    expect(sent).toContain('MOQ is 500 pcs');
    expect(renderConversationDetail(detailIn('OWNER_CONTROLLED', used), 'en', NOW, null)).not.toContain('MOQ is 500 pcs');
  });

  it('nothing used → the section is absent, never an empty box or a zero', () => {
    const html = renderConversationDetail(detailIn('AI', { knowledgeUsed: [] }), 'en', NOW, null);
    expect(html).not.toContain(shown('en', 'buyers.knew.title'));
    expect(html).not.toContain('class="knewlist"');
  });

  it('knowledge labels are owner-supplied text and are escaped', () => {
    const html = renderConversationDetail(
      detailIn('AI', { knowledgeUsed: ['<img src=x onerror=alert(1)>'] }), 'en', NOW, null);
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;img');
  });

  it('review + knowledge language localizes, and stays free of technical vocabulary', () => {
    const zh = renderConversationDetail(detailIn('AI', { knowledgeUsed: ['保温杯起订量500个'] }), 'zh', NOW, null);
    expect(zh).toContain(shown('zh', 'buyers.review.title')); expect(zh).toContain(shown('zh', 'card.source.taught')); expect(zh).toContain('保温杯起订量500个');
    const ar = renderConversationDetail(detailIn('AI', { knowledgeUsed: ['أقل كمية 500'] }), 'ar', NOW, null);
    expect(ar).toContain(shown('ar', 'buyers.review.title')); expect(ar).toContain(shown('ar', 'card.source.taught'));
    for (const l of LOCALES) {
      const all = renderConversationDetail(detailIn('AI', { knowledgeUsed: ['x'] }), l, NOW, null).toLowerCase();
      for (const banned of ['knowledge base', 'retrieval', 'context', 'prompt', 'embedding', '知识库'])
        expect(all.includes(banned), `${l}:${banned}`).toBe(false);
    }
  });
});

// ── Release hardening · a message is "sent" only when it has been sent ───────
describe('Release hardening · the product never claims a delivery it has not made', () => {
  it('approving queues a reply — the owner is told it is waiting, not that it went', () => {
    for (const l of LOCALES) {
      const queued = t(l, 'inbox.flash.sent') + t(l, 'inbox.flash.edited_sent') + t(l, 'takeover.flash.sent');
      // approving enqueues a row; the outbound worker and then the provider are
      // what actually deliver, so past-tense delivery here is a false promise
      for (const claim of ['Sent.', 'Reply sent', '已发送', 'أُرسل الرد', 'تم الإرسال'])
        expect(queued.includes(claim), `${l}: "${claim}"`).toBe(false);
    }
    expect(t('en', 'inbox.flash.sent')).toBe('Waiting to send.');
    expect(t('zh', 'inbox.flash.sent')).toContain('等着发出去');
    expect(t('ar', 'inbox.flash.sent')).toContain('بانتظار الإرسال');
  });

  it('with no messaging provider it says so outright, in every locale', () => {
    for (const l of LOCALES) {
      const s = t(l, 'inbox.flash.sentNotLive');
      expect(s.length).toBeGreaterThan(10);
      expect(s).not.toBe(t(l, 'inbox.flash.sent'));
    }
    expect(t('en', 'inbox.flash.sentNotLive')).toContain('nothing went to the customer');
  });

  it('skipping is unambiguous about the buyer seeing nothing', () => {
    expect(t('en', 'inbox.flash.skipped')).toContain('nothing goes to the customer');
  });
});

describe('Release hardening · the handoff badge states the stored reason', () => {
  const waiting = (handoffReason: string | null) => renderInboxList({
    filter: 'all', waitingCount: 1, blockedCount: 0,
    conversations: [{
      conversationId: 'c1', buyer: 'B', country: 'AE', status: 'awaiting', needsAction: false,
      ownership: 'WAITING_HUMAN', heldBy: null, awaitingReview: false, handoffReason,
      latestMessage: null, latestAt: NOW, product: { name: null, nameZh: null },
      quantity: null, unitPrice: null,
    }],
  }, 'en', NOW);

  it('every stored reason renders as itself — none is reported as “asked for a person”', () => {
    expect(waiting('human_requested')).toContain('the customer asked for a person');
    expect(waiting('complaint')).toContain('a complaint');
    expect(waiting('complaint')).not.toContain('asked for a person');
    expect(waiting('repeated_ambiguity')).toContain("the customer's need stayed unclear");
    expect(waiting('repeated_ambiguity')).not.toContain('asked for a person');
    expect(waiting('low_confidence_image')).toContain('an unclear photo');
    expect(waiting('low_confidence_image')).not.toContain('asked for a person');
  });

  it('no stored reason → it says only that you are needed, and invents nothing', () => {
    const html = waiting(null);
    expect(html).toContain('Waiting for you');
    expect(html).not.toContain('asked for a person');
    expect(html).not.toContain('complaint');
  });

  it('localizes the reason in zh and ar', () => {
    const zh = renderInboxList({ filter: 'all', waitingCount: 1, blockedCount: 0, conversations: [{
      conversationId: 'c1', buyer: 'B', country: null, status: 'awaiting', needsAction: false,
      ownership: 'WAITING_HUMAN', heldBy: null, awaitingReview: false, handoffReason: 'complaint',
      latestMessage: null, latestAt: NOW, product: { name: null, nameZh: null },
      quantity: null, unitPrice: null }] }, 'zh', NOW);
    expect(zh).toContain('有投诉');
    expect(zh).not.toContain('complaint');
  });
});

describe('Release hardening · a permanent change asks first', () => {
  const withDraft = renderConversationDetail(detailWithDraft, 'en', NOW, null);

  /**
   * The design pass (2026-09-29): "Stop doing this alone" rejected the draft
   * AND demoted the capability business-wide, forever — beside "Send". It moved
   * to the assistant's page, where how much it sends alone is set (T1's levels);
   * every act left on the card is about this one reply, and none needs asking.
   */
  it('the card carries no permanent change — stopping it sending alone is set on the assistant\'s page', () => {
    expect(withDraft).not.toContain('value="收回"');
    expect(withDraft).not.toContain(shown('en', 'inbox.action.revoke'));
    for (const l of ['zh', 'ar'] as const) {
      expect(renderConversationDetail(detailWithDraft, l, NOW, null)).not.toContain('value="收回"');
    }
  });

  /**
   * Phase 9 (V1-237, the owner's call given to the builder, 2026-10-03) — one
   * act on the card puts the reply away for good: "No reply needed". Phase 5's
   * rule keeps asking for what erases, so it asks; Send and "I'll reply" never do.
   */
  it('only "No reply needed" asks first: it puts this reply away for good; Send and I\'ll reply never ask', () => {
    const start = withDraft.indexOf('id="approve"');
    const card = withDraft.slice(start, withDraft.indexOf('</section>', start));
    expect(card).toContain('value="send"');
    expect(card.split('onclick="return confirm').length - 1).toBe(1);
    const asking = card.slice(card.lastIndexOf('<button', card.indexOf('onclick="return confirm')));
    expect(asking.slice(0, asking.indexOf('</button>'))).toContain('value="不回"');
  });
});
