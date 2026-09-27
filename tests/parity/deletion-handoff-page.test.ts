import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PROBLEM_SIGNAL_KINDS, SIGNAL_SAMPLES, TRIGGER_REASONS, computeScores, isProblemSignal, needsHandoff, toTriggerReason,
} from '../../src/core/scoring/signals.js';
import { detectSignals } from '../../src/core/scoring/detect.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { renderCustomerFile, type CustomerFile } from '../../src/api/web/conversations.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { OWNER_VIEW } from '../../src/core/conversation/people.js';
import { REQUIRED_SCHEMA_VERSION } from '../../src/db/schemaVersion.js';
import { emptyState } from './fixtures.js';

/**
 * 0075 — a deletion request in chat goes to a person, and the owner is told
 * what happened and what to do.
 *
 * The turn itself is proved in tests/pipeline/deletion-handoff.test.ts and over
 * Postgres in tests/integration/deletion-handoff.test.ts. This holds the rest:
 * the signal is a problem that hands off; the database admits it; and the
 * conversation page says, in all three languages, that nothing was sent, why,
 * and where the request is recorded — the owner gets a door to the buyer
 * page's deletion section, staff are told whose it is.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (f: string) => readFileSync(`${ROOT}${f}`, 'utf8');
const NOW = new Date('2026-09-27T10:00:00Z');
const STAFF = { isOwner: false };

const detail = (over: Partial<ConversationDetail> = {}): ConversationDetail => ({
  conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
  product: { name: 'Canvas tote', nameZh: '帆布袋' }, quantity: null, quote: null, order: null, messages: [], pendingDraft: null,
  ownership: 'WAITING_HUMAN', refusals: [], uncertainSends: [], handoffReasons: ['deletion_requested'],
  unheardReason: null, unreadable: null, lastHumanAction: null, knowledgeUsed: [],
  rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
  ...over,
});

describe('0075 · the signal', () => {
  it('is a problem that hands the conversation to a person, before any model', () => {
    expect(PROBLEM_SIGNAL_KINDS).toContain('deletion_requested');
    expect(isProblemSignal(SIGNAL_SAMPLES.deletion_requested)).toBe(true);
    expect(toTriggerReason(SIGNAL_SAMPLES.deletion_requested)).toBe('deletion_requested');
    expect(TRIGGER_REASONS).toContain('deletion_requested');
    expect(needsHandoff(computeScores([SIGNAL_SAMPLES.deletion_requested]))).toBe(true);
    // Detected from the text alone — the call computeTurn makes BEFORE the analyser.
    const kinds = (text: string) => detectSignals({ text, state: emptyState(), analysis: null, unitPrice: null }).map((s) => s.kind);
    expect(kinds('Please delete my data')).toContain('deletion_requested');
    expect(kinds('delete that line from the quote')).not.toContain('deletion_requested');
  });

  it('migration 0075 admits it in both CHECKs, and the build requires 75', () => {
    const newest = readdirSync(`${ROOT}migrations`).filter((f) => f.endsWith('.sql')).sort()
      .filter((f) => read(`migrations/${f}`).includes('add constraint conversation_signals_kind_check')).pop();
    // 0075 first admitted it; any later migration that restates the CHECKs keeps it.
    expect(Number(newest!.slice(0, 4))).toBeGreaterThanOrEqual(75);
    // The statements, not the comment that explains them.
    const sql = read(`migrations/${newest}`).split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
    expect(sql.match(/'deletion_requested'/g)).toHaveLength(2);
    expect(sql).toMatch(/insert into _migrations \(version, name\) values \(75, 'deletion_handoff'\)/);
    expect(REQUIRED_SCHEMA_VERSION).toBeGreaterThanOrEqual(75);
  });
});

describe('0075 · the conversation page', () => {
  it('names the reason, says nothing was sent, and why — in every language', () => {
    for (const l of LOCALES) {
      const html = renderConversationDetail(detail(), l, NOW, null, OWNER_VIEW);
      expect(html, l).toContain(esc(t(l, 'takeover.reason.deletion_requested' as MessageKey)));
      expect(html, l).toContain(esc(t(l, 'deletionAsked.title' as MessageKey)));
      expect(html, l).toContain(esc(t(l, 'deletionAsked.what' as MessageKey)));
      expect(html, l).toContain(esc(t(l, 'deletionAsked.why' as MessageKey)));
      expect(t(l, 'deletionAsked.what' as MessageKey), l).not.toMatch(/\{name\}/);
    }
  });

  it('the owner gets a door to the deletion section of the buyer page; staff are told whose it is', () => {
    for (const l of LOCALES) {
      const owner = renderConversationDetail(detail(), l, NOW, null, OWNER_VIEW);
      expect(owner, l).toContain(`<a href="/app/conversations/conv-1#deletion">${esc(t(l, 'deletionAsked.do' as MessageKey))}</a>`);
      const staff = renderConversationDetail(detail(), l, NOW, null, STAFF);
      expect(staff, l).not.toContain('#deletion"');
      expect(staff, l).toContain(esc(t(l, 'staff.deletionAsked' as MessageKey)));
    }
  });

  it('no card for any other reason', () => {
    const html = renderConversationDetail(detail({ handoffReasons: ['human_requested'] }), 'en', NOW, null, OWNER_VIEW);
    expect(html).not.toContain(esc(t('en', 'deletionAsked.title' as MessageKey)));
  });

  it('the buyer page\'s deletion section is where the door lands, in every state', () => {
    const file: CustomerFile = {
      conversationId: 'c1', buyer: 'Ahmed', country: 'AE', channel: 'whatsapp',
      status: { t: 'talking' }, statusTone: 'ok', needsOwner: false,
      profile: { firstContact: null, products: [], quoteCount: 0, orderCount: 0 },
      timeline: [],
      context: { products: [], latestQuote: null, order: null, corrections: [] },
    };
    const at = new Date('2026-09-20T02:00:00Z');
    for (const deletion of [undefined,
      { state: 'open' as const, askedAt: at, closedAt: null, closedNote: null },
      { state: 'done' as const, askedAt: at, closedAt: NOW, closedNote: null }]) {
      const html = renderCustomerFile({ ...file, ...(deletion ? { deletion } : {}) }, 'en', NOW, null, OWNER_VIEW);
      expect(html.match(/id="deletion"/g), deletion?.state ?? 'never').toHaveLength(1);
    }
  });

  it('the Buyers list shows the deletion request as THE reason when it came with others', () => {
    expect(read('src/api/web/inbox.ts')).toMatch(/order by \(cs\.kind = 'deletion_requested'\) desc, cs\.created_at desc limit 1/);
  });
});
