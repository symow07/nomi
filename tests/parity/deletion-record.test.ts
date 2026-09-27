import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { alertKindFor, renderOwnerAlert, OPERATOR_ALERT_KINDS, goesByMail } from '../../src/pipeline/notify.js';
import { renderConversationDetail, renderInboxList, type ConversationDetail, type ConversationSummary } from '../../src/api/web/inbox.js';
import { renderCustomerFile, type CustomerFile } from '../../src/api/web/conversations.js';
import { renderDataRights } from '../../src/api/web/dataRights.js';
import { renderOperationsHome, ATTENTION_PRIORITY, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { deletionDueBy } from '../../src/core/ops/deletions.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { formatDate } from '../../src/core/owner/i18n/format.js';
import { esc } from '../../src/api/web/layout.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { REQUIRED_SCHEMA_VERSION } from '../../src/db/schemaVersion.js';
// @ts-expect-error — the operator tool, plain JS on purpose (tools/ is not type-checked).
import { RULES } from '../../tools/erase-buyer.mjs';

/**
 * 0076 — the deletion hand-off has its own alert, and the request is written
 * down when it arrives, not when the owner remembers.
 *
 * Over Postgres and the real worker in tests/integration/deletion-handoff.test.ts;
 * the turn in tests/pipeline/deletion-handoff.test.ts. This holds the words and
 * the pages: the alert says plainly what happened and that it needs an answer,
 * with no deadline the product does not keep; it travels by e-mail as well as
 * WhatsApp; and wherever hand-offs are listed, a deletion request is its own
 * thing — on the conversation page after hand-back, on the buyer's page (which
 * asks only for the decision, never to create what is already there), on Your
 * data, on Today and in the Buyers list.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f: string) => readFileSync(`${ROOT}${f}`, 'utf8');
const NOW = new Date('2026-09-27T10:00:00Z');
const ASKED = new Date('2026-09-25T08:00:00Z');
const STAFF = { isOwner: false };
const k = (key: string) => key as MessageKey;

describe('0076 · its own alert', () => {
  it('is chosen over the ordinary hand-off alert, and only when the effects say so', () => {
    expect(alertKindFor({ hotLeadAlert: false, handoffAlert: true, deletionAlert: true })).toBe('deletion_requested');
    expect(alertKindFor({ hotLeadAlert: true, handoffAlert: false, deletionAlert: true })).toBe('deletion_requested');
    expect(alertKindFor({ hotLeadAlert: false, handoffAlert: true, deletionAlert: false })).toBe('handoff');
    expect(alertKindFor({ hotLeadAlert: false, handoffAlert: true })).toBe('handoff');
  });

  it('says what happened and that it needs an answer, in all three languages — and no date', () => {
    for (const l of LOCALES) {
      const text = renderOwnerAlert(l, 'deletion_requested');
      expect(text, l).toBe(t(l, k('notify.deletion_requested')));
      expect(text, l).not.toMatch(/\{|\}/);
      // The legal deadline depends on where the buyer is, and nothing stores
      // one: the alert names none. (Nomi's own 30 days start only once the
      // owner records the request, and are shown there.)
      expect(text, l).not.toMatch(/\d/);
      expect(t(l, k('notify.deletion_requested.subject')), l).not.toBe('notify.deletion_requested.subject');
      expect(text, l).not.toBe(t(l, k('notify.handoff')));
    }
    const en = renderOwnerAlert('en', 'deletion_requested');
    expect(en).toContain('asked for their data to be deleted');
    expect(en).toContain('needs an answer from you');
  });

  it('never depends on WhatsApp: it goes the operator alerts’ way, e-mail always', () => {
    for (const kind of OPERATOR_ALERT_KINDS) expect(goesByMail(kind), kind).toBe(true);
    expect(goesByMail('deletion_requested')).toBe(true);
    expect(goesByMail('handoff')).toBe(false);
  });
});

const detail = (over: Partial<ConversationDetail> = {}): ConversationDetail => ({
  conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
  product: { name: 'Canvas tote', nameZh: '帆布袋' }, quantity: null, quote: null, order: null, messages: [], pendingDraft: null,
  ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [],
  unheardReason: null, unreadable: null, lastHumanAction: null, knowledgeUsed: [],
  rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
  ...over,
});

describe('0076 · the conversation page keeps the request after the hand-off is gone', () => {
  it('handed back — no hand-off reason left — the card stays, saying when it was noted', () => {
    for (const l of LOCALES) {
      const html = renderConversationDetail(detail({ deletionAsk: { askedAt: ASKED } }), l, NOW, null, OWNER_VIEW);
      expect(html, l).toContain(esc(t(l, k('deletionAsked.title'))));
      expect(html, l).toContain(esc(t(l, k('deletionAsked.noted'), { date: formatDate(l, ASKED) })));
      expect(html, l).toContain('href="/app/conversations/conv-1#deletion"');
      // "sent nothing" belongs to the turn that handed over, not to later ones.
      expect(html, l).not.toContain(esc(t(l, k('deletionAsked.what'))));
    }
  });

  it('asked again after the owner recorded it: the card says it is recorded, and by when it is done', () => {
    const html = renderConversationDetail(detail({
      handoffReasons: ['deletion_requested'], ownership: 'WAITING_HUMAN', deletionRecorded: { askedAt: ASKED },
    }), 'en', NOW, null, OWNER_VIEW);
    expect(html).toContain(esc(t('en', k('deletionAsked.recorded'), { due: formatDate('en', deletionDueBy(ASKED)) })));
  });

  it('nothing noted and nothing handed over: no card', () => {
    expect(renderConversationDetail(detail(), 'en', NOW, null, OWNER_VIEW)).not.toContain(esc(t('en', k('deletionAsked.title'))));
  });
});

const file = (over: Partial<CustomerFile> = {}): CustomerFile => ({
  conversationId: 'c1', buyer: 'Ahmed', country: 'AE', channel: 'whatsapp',
  status: { t: 'talking' }, statusTone: 'ok', needsOwner: false,
  profile: { firstContact: null, products: [], quoteCount: 0, orderCount: 0 },
  timeline: [],
  context: { products: [], latestQuote: null, order: null, corrections: [] },
  ...over,
});
const ask = { id: 'a1', askedAt: ASKED, asks: 1, conversationId: 'c1', words: 'Please delete my data', buyer: 'Ahmed' };

describe('0076 · the buyer’s page asks only for the decision', () => {
  it('a noted request: when, what they wrote, record it (no note) or not — never "create a request"', () => {
    for (const l of LOCALES) {
      const html = renderCustomerFile(file({ deletionAsk: ask }), l, NOW, null, OWNER_VIEW);
      const section = html.slice(html.indexOf('id="deletion"'));
      expect(section, l).toContain(esc(t(l, k('conv.deletion.waiting'), { date: formatDate(l, ASKED) })));
      expect(section, l).toContain('<p class="voice"><bdi dir="auto">Please delete my data</bdi></p>');
      expect(section, l).toContain('action="/app/conversations/c1/deletion"');
      expect(section, l).toContain('action="/app/conversations/c1/deletion/dismiss"');
      expect(section, l).toContain(esc(t(l, k('conv.deletion.record'))));
      expect(section, l).toContain(esc(t(l, k('conv.deletion.dismiss'))));
      // What goes and what stays is still said before the decision.
      expect(section, l).toContain(esc(t(l, 'conv.deletion.erased')));
      // …and it does not ask how and when they asked: the message says so.
      expect(section, l).not.toContain('name="note"');
      expect(section, l).not.toContain(esc(t(l, 'conv.deletion.ask')));
    }
  });

  it('staff see that it waits, and whose decision it is — no form', () => {
    const html = renderCustomerFile(file({ deletionAsk: ask }), 'en', NOW, null, STAFF);
    const section = html.slice(html.indexOf('id="deletion"'));
    expect(section).toContain(esc(t('en', k('conv.deletion.waiting'), { date: formatDate('en', ASKED) })));
    expect(section).toContain(esc(t('en', 'staff.ownerDecides')));
    expect(section).not.toContain('<form');
  });

  it('nothing noted: the form is as it was, the note still required', () => {
    const html = renderCustomerFile(file(), 'en', NOW, null, OWNER_VIEW);
    expect(html).toMatch(/name="note" rows="2" required/);
    expect(html).not.toContain('/deletion/dismiss');
  });

  it('recorded already: the recorded state, not the decision', () => {
    const html = renderCustomerFile(file({
      deletionAsk: null, deletion: { state: 'open', askedAt: ASKED, closedAt: null, closedNote: null },
    }), 'en', NOW, null, OWNER_VIEW);
    expect(html).toContain(esc(t('en', 'conv.deletion.open', { asked: formatDate('en', ASKED), due: formatDate('en', deletionDueBy(ASKED)) })));
    expect(html).not.toContain('/deletion/dismiss');
  });
});

describe('0076 · Your data lists it the moment it is noted', () => {
  it('first, with the door to the buyer’s decision', () => {
    for (const l of LOCALES) {
      const html = renderDataRights({ requests: [], buyers: [], asks: [ask], businessName: 'B' }, l, null, OWNER_VIEW, 'Setup');
      expect(html, l).toContain('id="buyers"');
      expect(html, l).toContain('href="/app/conversations/c1#deletion"');
      expect(html, l).toContain(esc(t(l, k('data.buyers.waiting'), { asked: formatDate(l, ASKED) })));
      expect(html, l).toContain(esc(t(l, k('data.ask.state.waiting'))));
      expect(html, l).toContain(esc(t(l, k('data.buyers.fromChat'))));
      expect(html, l).not.toContain(esc(t(l, 'data.buyers.none')));
    }
  });
});

const today: OperationsSnapshot = {
  range: 'today',
  attention: { pendingApprovals: 0, handoffs: 1, ownerHandling: 0, blockedMessages: 1, deletionAsks: 2 },
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'connected', provider: 'meta' }, budget: null,
  hasAttention: true,
};

describe('0076 · Today shows it as its own row', () => {
  it('under the message that never arrived, above every ordinary hand-off, to its own list', () => {
    expect(ATTENTION_PRIORITY.indexOf('deletionAsks')).toBe(ATTENTION_PRIORITY.indexOf('blockedMessages') + 1);
    expect(ATTENTION_PRIORITY.indexOf('deletionAsks')).toBeLessThan(ATTENTION_PRIORITY.indexOf('handoffs'));
    for (const l of LOCALES) {
      const html = renderOperationsHome(today, l);
      const hrefs = [...html.matchAll(/class="stat need" href="([^"]+)"/g)].map((m) => m[1]);
      expect(hrefs, l).toEqual(['/app/inbox?filter=blocked', '/app/inbox?filter=deletion', '/app/inbox']);
      expect(html, l).toContain(esc(t(l, k('ops.card.deletionAsks'))));
    }
  });

  it('none waiting: no row', () => {
    const html = renderOperationsHome({ ...today, attention: { ...today.attention, deletionAsks: 0 } }, 'en');
    expect(html).not.toContain('filter=deletion');
  });
});

const summary = (over: Partial<ConversationSummary>): ConversationSummary => ({
  conversationId: 'c', buyer: 'B', country: 'AE', status: 'handled', needsAction: false,
  ownership: 'AI', heldBy: null, awaitingReview: false, handoffReason: null,
  latestMessage: null, latestAt: NOW, product: { name: null, nameZh: null }, quantity: null, unitPrice: null,
  ...over,
});

describe('0076 · the Buyers list: its own group and its own tab', () => {
  const list = renderInboxList({
    filter: 'pending', waitingCount: 2, blockedCount: 0, deletionCount: 1,
    conversations: [
      summary({ conversationId: 'asked', buyer: 'Asker', deletionWaiting: true }),
      summary({ conversationId: 'waiting', buyer: 'Waiter', ownership: 'WAITING_HUMAN', handoffReason: 'human_requested' }),
    ],
  }, 'en', NOW);

  it('first, and headed even on the tab that heads nothing else', () => {
    const head = list.indexOf(esc(t('en', k('buyers.group.deletion'))));
    expect(head).toBeGreaterThan(-1);
    expect(list.indexOf('/app/inbox/asked')).toBeGreaterThan(head);
    expect(list.indexOf('/app/inbox/asked')).toBeLessThan(list.indexOf('/app/inbox/waiting'));
    // Not also in the generic pile.
    expect(list.match(/\/app\/inbox\/asked/g)).toHaveLength(1);
  });

  it('a tab of its own while one waits, with the count', () => {
    expect(list).toContain(`href="/app/inbox?filter=deletion">${esc(t('en', k('inbox.filter.deletion')))} (1)</a>`);
    const none = renderInboxList({ filter: 'pending', waitingCount: 0, blockedCount: 0, deletionCount: 0, conversations: [] }, 'en', NOW);
    expect(none).not.toContain('filter=deletion');
    const empty = renderInboxList({ filter: 'deletion', waitingCount: 0, blockedCount: 0, deletionCount: 0, conversations: [] }, 'en', NOW);
    expect(empty).toContain(esc(t('en', k('inbox.empty.deletion'))));
  });
});

describe('0076 · the table, its guard rails, and erasure', () => {
  const sql = read('migrations/0076_deletion_asks.sql').split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');

  it('one waiting per buyer; row security; the app may never delete; one new audit verb', () => {
    expect(sql).toMatch(/create table if not exists deletion_asks/);
    expect(sql).toMatch(/client_id uuid not null references clients\(id\)/);
    expect(sql).toMatch(/conversation_id uuid not null references conversations\(id\)/);
    expect(sql).toMatch(/message_id uuid references messages\(id\)/);
    expect(sql).toMatch(/create unique index if not exists deletion_asks_one_waiting\s+on deletion_asks \(client_id\) where state = 'waiting'/);
    expect(sql).toMatch(/alter table deletion_asks enable row level security/);
    expect(sql).toMatch(/grant select, insert, update on deletion_asks to nomi_app/);
    expect(sql).toMatch(/revoke delete, truncate on deletion_asks from nomi_app/);
    expect(sql).toContain("'deletion_dismissed'");
    // Every verb 0070 knew is still there.
    for (const verb of ['connect', 'export_data', 'deletion_requested', 'deletion_withdrawn', 'assistant_stop', 'assistant_start']) {
      expect(sql, verb).toContain(`'${verb}'`);
    }
    expect(sql).toMatch(/values \(76, 'deletion_asks'\)/);
    expect(REQUIRED_SCHEMA_VERSION).toBe(76);
  });

  it('erased with the buyer: it holds their conversation and their message', () => {
    expect((RULES as Record<string, { do: string }>)['deletion_asks']?.do).toBe('erase');
  });
});
