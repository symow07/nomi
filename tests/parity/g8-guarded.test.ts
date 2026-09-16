import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { usd } from '../../src/core/types/money.js';
import { SAFE_REPLY } from '../../src/core/conversation/templates.js';
import { holdReasonOf } from '../../src/core/conversation/hold.js';
import { guardNumerals } from '../../src/core/safety/numerals.js';
import { guardClaims } from '../../src/core/safety/claims.js';
import { guardForbidden, FORBIDDEN_FLOOR } from '../../src/core/safety/forbiddenWords.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { renderForbidden } from '../../src/api/web/settings.js';
import { esc } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { emptyState } from './fixtures.js';

/**
 * G8 — nothing unguarded reaches a buyer. The pipeline proof is
 * tests/pipeline/guarded.test.ts; this is the rule's pieces and the owner's
 * view of them.
 */

const src = (rel: string) => readFile(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const NOW = new Date('2026-09-11T08:00:00Z');

describe('G8 · the one fixed sentence needs no guard', () => {
  it('passes every guard with nothing allowed: no figure, no claim, no forbidden word', () => {
    expect(guardNumerals({ reply: SAFE_REPLY, quote: null, state: emptyState(), clientText: '', allow: [] }).ok).toBe(true);
    expect(guardClaims({ reply: SAFE_REPLY, policy: [] }).ok).toBe(true);
    expect(guardForbidden({ reply: SAFE_REPLY, ownerTerms: [] }).ok).toBe(true);
    for (const floor of FORBIDDEN_FLOOR) expect(SAFE_REPLY.toLowerCase()).not.toContain(floor);
  });

  it('the stand-in is chosen from the analyser’s question only — the refusal note stays with the writer', async () => {
    const turn = await src('src/pipeline/turn.ts');
    expect(turn).toContain('guardFallbackReply(quote, analysis?.intent.nextLogicalQuestion ?? null)');
    expect(turn).not.toContain('guardFallbackReply(quote, nextQuestion)');
    expect(turn).toContain('reply = passes ? standIn : SAFE_REPLY;');
  });
});

describe('G8 · two failed attempts hold the turn', () => {
  it('a hold reason of its own, named last — the price reasons say what she is deciding', () => {
    expect(holdReasonOf({ provenance: 'typed', quote: null, turnText: '', guardsFailedTwice: true })).toBe('guards_failed_twice');
    expect(holdReasonOf({ provenance: 'typed', quote: null, turnText: '' })).toBeNull();
  });
});

describe('G8 · kept out of the employee’s record', () => {
  it('her-text hits are their own event type, and evidence counts only guard violations', async () => {
    const turn = await src('src/pipeline/turn.ts');
    expect(turn).toContain("'forbidden_in_her_text'");
    const capability = await src('src/pipeline/capability.ts');
    expect(capability).toContain("where type = 'guard_violation'");
    expect(capability).not.toContain('forbidden_in_her_text');
  });
});

describe('G8 · the owner sees them', () => {
  const detail = (over: Partial<ConversationDetail> = {}): ConversationDetail => ({
    conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE', status: 'handled',
    product: { name: 'Vacuum cup', nameZh: '保温杯' }, quantity: null, quote: null,
    order: null, messages: [], pendingDraft: null,
    ownership: 'AI', refusals: [], uncertainSends: [], handoffReasons: [], unheardReason: null, lastHumanAction: null,
    knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null, proof: { quoteId: null, token: null },
    ...over,
  });

  it('a word in her saved answer: what happened, and where she fixes it — in every locale', () => {
    for (const l of LOCALES) {
      const html = renderConversationDetail(detail({ herWords: [{ path: 'taught_answer', terms: ['Guangzhou Textile'] }] }), l, NOW, null);
      expect(html, l).toContain(esc(t(l, 'herwords.title')));
      expect(html, l).toContain('Guangzhou Textile');
      expect(html, l).toContain('href="/app/knowledge"');
      expect(t(l, 'herwords.taught_answer' as MessageKey, { terms: 'x', name: EMPLOYEE_NAME[l] }), l).not.toContain('{');
    }
    const order = renderConversationDetail(detail({ herWords: [{ path: 'order_status', terms: ['DHL'] }] }), 'en', NOW, null);
    expect(order).toContain('href="/app/settings/forbidden"');
  });

  it('nothing to say, no card', () => {
    const html = renderConversationDetail(detail({ herWords: [] }), 'en', NOW, null);
    expect(html).not.toContain(esc(t('en', 'herwords.title')));
  });

  it('a stand-in draft names the words that kept stopping her', () => {
    const html = renderConversationDetail(detail({
      status: 'awaiting',
      pendingDraft: {
        draftId: 'd-1', draftText: 'For 5,000 pcs, the unit price is $0.45 USD.', capability: 'quote',
        heldBecause: 'guards_failed_twice', forbidden: ['Guangzhou Textile'],
      },
      quote: { unitPrice: usd(0.45), total: usd(2250), quantity: 5000 },
    }), 'en', NOW, null);
    expect(html).toContain(esc(t('en', 'inbox.draft.held.guards_failed_twice', { name: EMPLOYEE_NAME.en })));
    expect(html).toContain('Guangzhou Textile');
  });
});

describe('G8 · her note on a forbidden word', () => {
  it('is shown to her beside the term, and the form asks for it', () => {
    const html = renderForbidden({
      own: [{ id: 'a1', term: 'Guangzhou Textile', note: 'they copied our catalogue' }],
      floor: [...FORBIDDEN_FLOOR],
    }, 'en', null);
    expect(html).toContain('they copied our catalogue');
    expect(html).toMatch(/<input name="note"/);
    for (const l of LOCALES) {
      expect(t(l, 'forbidden.add.note'), l).not.toBe('forbidden.add.note');
      expect(t(l, 'forbidden.add.notePlaceholder'), l).not.toBe('forbidden.add.notePlaceholder');
    }
  });

  it('the settings page promises what now happens — rewritten, or it comes to her', () => {
    expect(t('en', 'forbidden.intro', { name: 'Lily' })).toContain('comes to you instead');
    expect(t('en', 'forbidden.intro', { name: 'Lily' })).toContain('writes it again');
  });
});
