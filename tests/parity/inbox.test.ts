import { describe, it, expect } from 'vitest';
import {
  renderInboxList, renderConversationDetail, defaultFilter,
  type InboxList, type ConversationDetail, type HumanActionType,
} from '../../src/api/web/inbox.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import type { ConversationOwnership } from '../../src/core/conversation/ownership.js';

const NOW = new Date('2026-07-27T10:00:00Z');

const listWithWork: InboxList = {
  filter: 'pending', waitingCount: 1,
  conversations: [{
    conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE',
    status: 'awaiting', needsAction: true, ownership: 'AI', awaitingReview: true,
    latestMessage: 'Can you do 5000 pcs?', latestAt: NOW,
    product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: 5000, unitPriceUsd: 0.92,
  }],
};

const detailWithDraft: ConversationDetail = {
  conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
  product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: 5000,
  quote: { unitPriceUsd: 0.92, totalUsd: 4600, quantity: 5000 },
  order: null,
  messages: [
    { direction: 'inbound', text: 'Price for 5000?', at: new Date('2026-07-27T09:00:00Z') },
    { direction: 'outbound', text: 'Checking for you.', at: new Date('2026-07-27T09:01:00Z') },
  ],
  pendingDraft: { draftId: 'd-1', draftText: 'For 5,000 pcs: $0.92/pc FOB Ningbo.' },
  ownership: 'AI', handoffReasons: [], lastHumanAction: null, knowledgeUsed: [],
};

// M16.2c — a conversation detail in a given ownership state (draft omitted for
// owner-controlled, which hides the draft card by design).
const detailIn = (ownership: ConversationOwnership, over: Partial<ConversationDetail> = {}): ConversationDetail => ({
  ...detailWithDraft, ownership, pendingDraft: ownership === 'OWNER_CONTROLLED' ? null : detailWithDraft.pendingDraft, ...over,
});

describe('M9.3 · inbox list (localized)', () => {
  it('zh: buyer, country, status, product, deep link', () => {
    const html = renderInboxList(listWithWork, 'zh', NOW);
    expect(html).toContain('收件箱'); expect(html).toContain('Ahmed'); expect(html).toContain('🇦🇪');
    expect(html).toContain('看看她的回复');
    expect(html).toContain('保温杯'); expect(html).toContain('5000个'); expect(html).toContain('$0.92');
    expect(html).toContain('href="/app/inbox/conv-1"');
  });

  it('en: localized chrome, latin product name', () => {
    const html = renderInboxList(listWithWork, 'en', NOW);
    expect(html).toContain('Inbox'); expect(html).toContain('Review her reply');
    expect(html).toContain('Needs you'); expect(html).toContain('Vacuum cup');
    expect(html).toContain('5,000pcs');
    expect(html).not.toContain('保温杯');
  });

  it('empty pending → all-good per locale, not "no data"', () => {
    expect(renderInboxList({ filter: 'pending', waitingCount: 0, conversations: [] }, 'zh', NOW)).toContain('现在没有买家需要你');
    const en = renderInboxList({ filter: 'pending', waitingCount: 0, conversations: [] }, 'en', NOW);
    expect(en).toContain('No buyer needs you right now');
    expect(en.toLowerCase()).not.toContain('no data');
  });

  it('empty all → explains the next action', () => {
    expect(renderInboxList({ filter: 'all', waitingCount: 0, conversations: [] }, 'en', NOW)).toContain('No conversations yet');
  });

  it('default filter opens pending only when work is waiting', () => {
    expect(defaultFilter(2)).toBe('pending');
    expect(defaultFilter(0)).toBe('all');
  });
});

describe('M9.3 · conversation detail (localized)', () => {
  it('chronological, sender-distinguished timeline (buyer / employee per locale)', () => {
    const html = renderConversationDetail(detailWithDraft, 'zh', NOW, null);
    const inbound = html.indexOf('Price for 5000?');
    const outbound = html.indexOf('Checking for you.');
    expect(outbound).toBeGreaterThan(inbound);
    expect(html).toContain('msg inbound'); expect(html).toContain('msg outbound');
    expect(html).toContain('买家'); expect(html).toContain('小雅');
    expect(renderConversationDetail(detailWithDraft, 'en', NOW, null)).toContain('Lily');
  });

  it('pending draft: four actions, wire-command VALUES preserved, labels localized', () => {
    const html = renderConversationDetail(detailWithDraft, 'en', NOW, null);
    expect(html).toContain('Review her reply');
    expect(html).toContain('For 5,000 pcs: $0.92/pc FOB Ningbo.');
    expect(html).toContain('action="/app/inbox/conv-1/act"');
    for (const v of ['发送', '不回', '收回', '改']) expect(html).toContain(`value="${v}"`);  // wire protocol
    expect(html).toContain('Send'); expect(html).toContain('Skip');   // localized labels
    expect(html).toContain('name="draftId" value="d-1"');
    expect(html).toContain('<textarea');
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
    expect(html).not.toContain('Review her reply');
  });

  it('flash shown when present', () => {
    expect(renderConversationDetail(detailWithDraft, 'zh', NOW, '已发送。')).toContain('已发送。');
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
      pendingDraft: { draftId: 'd', draftText: '</textarea><script>bad()</script>' },
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

  it('AI state: employee-handling status + take-over control; no reply/return', () => {
    const html = renderConversationDetail(detailIn('AI'), 'en', NOW, null);
    expect(html).toContain('Your employee is handling this');
    expect(html).toContain('action="/app/inbox/conv-1/takeover"');
    expect(html).toContain('Take over');
    expect(html).not.toContain('action="/app/inbox/conv-1/reply"');
    expect(html).not.toContain('action="/app/inbox/conv-1/resume"');
  });

  it('WAITING_HUMAN state: waiting status + stored handoff reasons + take-over', () => {
    const html = renderConversationDetail(
      detailIn('WAITING_HUMAN', { handoffReasons: ['human_requested', 'complaint'] }), 'en', NOW, null);
    expect(html).toContain('Waiting for you');
    expect(html).toContain('Handed to you because');
    expect(html).toContain('the buyer asked for a person');   // stored reason, not a summary
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
    expect(html).toContain('Hand back to your employee');
    expect(html).not.toContain('Review her reply');             // no draft card while owner-controlled
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
    expect(line('resume_ai')).toContain('Handed back to Lily');       // employee name, never "AI"
    expect(line('draft_resolved')).toContain('you reviewed a reply');
    expect(line('owner_reply')).not.toContain('$');                   // the action line carries no price/body
  });

  it('a non-owner actor is shown as-is and escaped (future team member)', () => {
    const html = renderConversationDetail(withLast('AI', 'takeover', '<b>agent-7</b>'), 'en', NOW, null);
    expect(html).toContain('&lt;b&gt;agent-7&lt;/b&gt;');
    expect(html).not.toContain('<b>agent-7</b>');
  });

  it('localized states + last action in zh and ar', () => {
    const zh = renderConversationDetail(withLast('OWNER_CONTROLLED', 'takeover'), 'zh', NOW, null);
    expect(zh).toContain('你正在处理'); expect(zh).toContain('由你接手'); expect(zh).toContain('最近操作');
    const ar = renderConversationDetail(detailIn('WAITING_HUMAN'), 'ar', NOW, null);
    expect(ar).toContain('بانتظارك'); expect(ar).toContain('أتولّى بنفسي');
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
    awaitingReview: false, latestMessage: 'hi', latestAt: NOW,
    product: { name: null, nameZh: null }, quantity: null, unitPriceUsd: null, ...over,
  });
  const list = (cs: InboxList['conversations']): InboxList =>
    ({ filter: 'all', waitingCount: 0, conversations: cs });

  const mixed = list([
    conv('c-ai'),
    conv('c-wait', { ownership: 'WAITING_HUMAN' }),
    conv('c-owner', { ownership: 'OWNER_CONTROLLED' }),
    conv('c-review', { awaitingReview: true }),
  ]);

  it('three groups, each conversation in exactly one, in owner-priority order', () => {
    const html = renderInboxList(mixed, 'en', NOW);
    const needs = html.indexOf('Needs you');
    const yours = html.indexOf('You are handling');
    const hers  = html.indexOf('Lily is handling');
    expect(needs).toBeGreaterThan(-1);
    expect(yours).toBeGreaterThan(needs);
    expect(hers).toBeGreaterThan(yours);
    for (const id of ['c-ai', 'c-wait', 'c-owner', 'c-review']) {
      expect(html.split(`href="/app/inbox/${id}"`).length - 1, id).toBe(1);   // exactly once
    }
    // the two that need the owner are above the two that do not
    expect(html.indexOf('c-wait')).toBeLessThan(html.indexOf('c-owner'));
    expect(html.indexOf('c-review')).toBeLessThan(html.indexOf('c-ai'));
  });

  it('badges name the human action, never an internal state', () => {
    const html = renderInboxList(mixed, 'en', NOW);
    expect(html).toContain('Asked for a person');   // WAITING_HUMAN
    expect(html).toContain('Review her reply');     // awaiting the owner's OK
    expect(html).toContain('You are replying');     // OWNER_CONTROLLED
    expect(html).not.toContain('unclaimed');
    expect(html).not.toContain('draft_pending');
    expect(html).not.toContain('Pending draft');
  });

  it('a group with no conversations is absent, not an empty shell', () => {
    const heads = (html: string) => [...html.matchAll(/class="bgroup-h">([^<]+)</g)].map((m) => m[1]);
    expect(heads(renderInboxList(list([conv('c-ai')]), 'en', NOW))).toEqual(['Lily is handling']);
    expect(heads(renderInboxList(list([conv('c-w', { ownership: 'WAITING_HUMAN' })]), 'en', NOW))).toEqual(['Needs you']);
    // in the "needs you" view the tab already says it — no heading stutter
    expect(heads(renderInboxList({ ...mixed, filter: 'pending' }, 'en', NOW))).toEqual([]);
  });

  it('calm empty state is about the buyers, not about missing data', () => {
    const en = renderInboxList({ filter: 'pending', waitingCount: 0, conversations: [] }, 'en', NOW);
    expect(en).toContain('No buyer needs you right now');
    expect(en.toLowerCase()).not.toContain('no data');
    expect(en.toLowerCase()).not.toContain('0 conversations');
  });

  it('renders in all locales; ar keeps its own words (nothing falls back to English)', () => {
    for (const l of LOCALES) expect(renderInboxList(mixed, l, NOW).length).toBeGreaterThan(200);
    const ar = renderInboxList(mixed, 'ar', NOW);
    expect(ar).toContain('يحتاجون إليك'); expect(ar).toContain('راجِع ردّها');
    expect(ar).not.toContain('Needs you'); expect(ar).not.toContain('Review her reply');
    const zh = renderInboxList(mixed, 'zh', NOW);
    expect(zh).toContain('需要你处理'); expect(zh).toContain('看看她的回复');
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
  it('review card asks the owner to review HER reply, naming the buyer', () => {
    const html = renderConversationDetail(detailWithDraft, 'en', NOW, null);
    expect(html).toContain('Review her reply');
    expect(html).toContain('She wrote this for Ahmed');
    expect(html).toContain('For 5,000 pcs: $0.92/pc FOB Ningbo.');
    expect(html).not.toContain('Pending draft');
    expect(html).not.toContain('⚠️');                       // reviewing a colleague is not an alarm
  });

  it('ownership is above the buyer transcript — the owner never has to scroll to find who speaks', () => {
    for (const o of ['AI', 'WAITING_HUMAN', 'OWNER_CONTROLLED'] as const) {
      const html = renderConversationDetail(detailIn(o), 'en', NOW, null);
      const own = html.indexOf('card takeover');   // the ownership card
      const msg = html.indexOf('class="msg');      // the buyer transcript
      expect(own, `${o}: ownership card must render`).toBeGreaterThan(-1);
      expect(msg, `${o}: transcript must render`).toBeGreaterThan(-1);
      expect(own, o).toBeLessThan(msg);
    }
  });

  it('no contradictory status: a human-held conversation states ownership only', () => {
    // `statusOf` calls every assigned conversation "Paused" — printing that above
    // "Waiting for you" told the owner two different things at once.
    const wait = renderConversationDetail(detailIn('WAITING_HUMAN'), 'en', NOW, null);
    expect(wait).toContain('Waiting for you');
    expect(wait).not.toContain('Paused');
    const owned = renderConversationDetail(detailIn('OWNER_CONTROLLED'), 'en', NOW, null);
    expect(owned).not.toContain('Paused');
    // while she holds it, the conversation's own state is still worth stating
    expect(renderConversationDetail(detailIn('AI'), 'en', NOW, null)).toContain('Awaiting you');
  });

  it('what she used to answer: shown while SHE speaks, hidden once a human holds the pen', () => {
    const used = { knowledgeUsed: ['MOQ is 500 pcs', 'Lead time 20 days'] };
    const ai = renderConversationDetail(detailIn('AI', used), 'en', NOW, null);
    expect(ai).toContain('What she used to answer');
    expect(ai).toContain('MOQ is 500 pcs'); expect(ai).toContain('Lead time 20 days');
    for (const o of ['WAITING_HUMAN', 'OWNER_CONTROLLED'] as const)
      expect(renderConversationDetail(detailIn(o, used), o === 'OWNER_CONTROLLED' ? 'en' : 'en', NOW, null))
        .not.toContain('What she used to answer');
  });

  it('nothing used → the section is absent, never an empty box or a zero', () => {
    const html = renderConversationDetail(detailIn('AI', { knowledgeUsed: [] }), 'en', NOW, null);
    expect(html).not.toContain('What she used to answer');
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
    expect(zh).toContain('看看她的回复'); expect(zh).toContain('她用到的内容'); expect(zh).toContain('保温杯起订量500个');
    const ar = renderConversationDetail(detailIn('AI', { knowledgeUsed: ['أقل كمية 500'] }), 'ar', NOW, null);
    expect(ar).toContain('راجِع ردّها'); expect(ar).toContain('ما استندت إليه');
    for (const l of LOCALES) {
      const all = renderConversationDetail(detailIn('AI', { knowledgeUsed: ['x'] }), l, NOW, null).toLowerCase();
      for (const banned of ['knowledge base', 'retrieval', 'context', 'prompt', 'embedding', '知识库'])
        expect(all.includes(banned), `${l}:${banned}`).toBe(false);
    }
  });
});
