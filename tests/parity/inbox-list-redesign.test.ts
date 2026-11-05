import { describe, it, expect } from 'vitest';
import { renderSplitInbox, renderInboxViews, renderInboxRows, inboxReturnHref } from '../../src/api/web/splitInbox.js';
import { renderSavedReplies, renderSavedReply } from '../../src/api/web/savedReplies.js';
import type { InboxList, ConversationSummary } from '../../src/api/web/inbox.js';
import { withWorkspace } from '../../src/api/web/say.js';

const NOW = new Date('2026-11-06T08:00:00Z');
const CID = '11111111-1111-4111-8111-111111111111';
const data = (over: Partial<InboxList> = {}): InboxList => ({
  filter: 'all', waitingCount: 2, blockedCount: 0, conversations: [], query: '', lens: 'waiting',
  views: { quiet: 3, assistant: 4, team: 0, everyone: 9 }, labels: [], ...over,
});
const scoped = <T>(fn: () => T): T => withWorkspace({ name: null, several: false, outreach: false, setup: null, zone: 'UTC' }, fn);
const row: ConversationSummary = {
  conversationId: CID, buyer: 'Aisha', country: null, status: 'awaiting', needsAction: true,
  ownership: 'AI', heldBy: null, awaitingReview: true, handoffReason: null, latestMessage: 'Can you help?',
  latestAt: NOW, product: { name: null, nameZh: null }, quantity: null, unitPrice: null,
};

describe('Inbox list navigation and recovery', () => {
  it('offers every view on a phone without horizontal tab discovery and retains its scope', () => {
    const html = scoped(() => renderInboxViews(data({ filter: 'quiet', query: 'rose', stage: 'price', lens: 'value', label: { id: 'label-1', name: 'VIP' }, blockedCount: 2, deletionCount: 1 }), 'en', { compact: true }));
    expect(html).toContain('method="get" action="/app/inbox"');
    expect(html).toContain('<select name="filter"');
    expect(html).toContain('value="quiet" selected');
    for (const [name, value] of [['q', 'rose'], ['stage', 'price'], ['lens', 'value'], ['label', 'label-1']]) expect(html).toContain(`name="${name}" value="${value}"`);
    expect(html).toContain('value="all"');
    expect(html).toContain('value="blocked"');
    expect(html).toContain('value="deletion"');
    expect(html).not.toContain('value="team"');
  });

  it('omits unavailable view counts instead of inventing zeros for a partial reader', () => {
    const { views: _views, ...partial } = data();
    const html = scoped(() => renderInboxViews(partial, 'en', { compact: true }));
    expect(html).toContain('>Everyone</option>');
    expect(html).toContain('>Gone quiet</option>');
    expect(html).not.toContain('Everyone · 0');
  });

  it('keeps a zero-count active team/deletion view reachable', () => {
    for (const filter of ['team', 'deletion'] as const) {
      const html = scoped(() => renderInboxViews(data({ filter }), 'en', { compact: true }));
      expect(html).toContain(`value="${filter}" selected`);
    }
  });

  it('carries the complete validated view scope into a conversation return destination', () => {
    const scope = data({ filter: 'quiet', query: 'rose serum', stage: 'price', lens: 'value', label: { id: 'label-1', name: 'VIP' }, conversations: [row] });
    const expected = '/app/inbox?filter=quiet&stage=price&lens=value&q=rose+serum&label=label-1';
    expect(inboxReturnHref(scope)).toBe(expected);
    const html = scoped(() => renderInboxRows(scope, 'en', NOW, []));
    expect(html).toContain(`href="/app/inbox/${CID}?from=${encodeURIComponent(expected + '#inbox-' + CID)}#latest"`);
  });

  it('returns to the exact requested page and clicked row when safe presentation context is available', () => {
    const cursor = '0_n_' + CID;
    const scope = data({ filter: 'quiet', returnHref: '/app/inbox?filter=quiet&after=' + cursor, conversations: [row] });
    expect(new URL(inboxReturnHref(scope), 'http://local.test').searchParams.get('after')).toBe(cursor);
    const html = scoped(() => renderInboxRows(scope, 'en', NOW, []));
    expect(html).toContain(`id="inbox-${CID}"`);
    const expected = inboxReturnHref(scope) + '#inbox-' + CID;
    expect(html).toContain(`?from=${encodeURIComponent(expected)}#latest"`);
  });

  it('rejects forged external return context and falls back to the current Inbox scope', () => {
    for (const returnHref of ['https://outside.example/app/inbox', '//outside.example/app/inbox', '/app/settings']) {
      const scope = data({ filter: 'quiet', returnHref });
      expect(inboxReturnHref(scope)).toBe('/app/inbox?filter=quiet');
    }
  });

  it('marks the selected conversation without changing unread/opened state or its destination', () => {
    const html = scoped(() => renderInboxRows(data({ conversations: [{ ...row, unopened: true }] }), 'en', NOW, [], { selectedId: CID }));
    expect(html).toContain('is-needs is-new is-selected');
    expect(html).toContain(`href="/app/inbox/${CID}?from=${encodeURIComponent('/app/inbox?filter=all#inbox-' + CID)}#latest" aria-current="page"`);
    expect(html).toContain('class="row-dot"');
    expect(html).toContain('Can you help?');
  });

  it('clears only the searched words when no match is found, leaving stage and ranking intact', () => {
    const html = scoped(() => renderSplitInbox(data({ query: 'missing', stage: 'price', lens: 'value' }), 'en', NOW, []));
    const empty = html.slice(html.indexOf('class="il-empty"'));
    expect(empty).toContain('href="/app/inbox?filter=all&amp;stage=price&amp;lens=value"');
    expect(empty).not.toContain('q=missing');
  });
});

describe('Saved replies layout keeps the actual edit contract', () => {
  const reply = { id: CID, title: 'Prices', texts: { en: 'Prices attached.', ar: 'الأسعار مرفقة.' }, archived: false, updatedAt: '2026-11-06T08:00:00Z' };
  it('lists canonical edit doors and keeps creation on the existing authorised POST', () => {
    const html = renderSavedReplies('en', [reply]);
    expect(html).toContain(`href="/app/inbox/replies/${CID}"`);
    expect(html).toContain('action="/app/replies"');
    expect(html).toContain('id="new-reply"');
    expect(html).toContain('href="#new-reply"');
  });
  it('keeps archived replies editable and offers only the existing restore action', () => {
    const html = renderSavedReply('en', { ...reply, archived: true });
    expect(html).toContain(`action="/app/replies/${CID}/restore"`);
    expect(html).not.toContain(`action="/app/replies/${CID}/archive"`);
    expect(html).toContain('>Prices attached.</textarea>');
    expect(html).toContain('action="/app/replies/' + CID + '"');
  });
  it('preserves saved words, language fields and archive confirmation; it never sends', () => {
    const html = renderSavedReply('en', reply);
    expect(html).toContain(`action="/app/replies/${CID}"`);
    expect(html).toContain(`action="/app/replies/${CID}/archive"`);
    expect(html).toContain('onclick="return confirm(this.dataset.confirm)"');
    expect(html).toContain('name="text_ar" rows="3" maxlength="2000" lang="ar" dir="rtl"');
    expect(html).toContain('>الأسعار مرفقة.</textarea>');
    expect(html).not.toContain('/app/inbox/' + CID + '/reply');
  });
});
