import { describe, it, expect } from 'vitest';
import { usd } from '../../src/core/types/money.js';
import { closureNote, withheldOf, type LeadTimeBlocked } from '../../src/core/commerce/closures.js';
import { extractNumerals } from '../../src/core/safety/numerals.js';
import { computeTurn, commitTurn } from '../../src/pipeline/turn.js';
import { renderProof, type ProofView } from '../../src/api/web/proof.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import type { ReplyWriter } from '../../src/llm/ports.js';
import type { AuditRepo } from '../../src/db/ports.js';
import { emptyState, CONVERSATION, PRODUCT } from './fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from '../pipeline/fakes.js';

/**
 * G5 — the proof page states only what the quote said, and the buyer hears why.
 *
 * M44 made a date unstateable during one of her closures. But the quote row
 * kept no lead time, so the buyer's proof page read the PRODUCT's lead time and
 * printed it — the exact number M44 refused, attributed to her catalogue, on
 * the page a buyer forwards to his boss. And the buyer himself was never told
 * why no date came: the reply writer was handed a null and nothing else.
 */

const NOW = new Date('2026-07-14T12:00:00Z');
const cny: LeadTimeBlocked = {
  kind: 'factory_closed',
  closure: { label: 'Spring Festival 2027', from: new Date('2026-07-20'), to: new Date('2026-08-30') },
  wouldShipOn: new Date('2026-08-08'),
};

describe('G5 · what is kept with a quote, and what is not', () => {
  it('her closure is kept — the date a lead time WOULD have promised is not', () => {
    const w = withheldOf(cny);
    expect(w).toEqual({ label: 'Spring Festival 2027', from: cny.closure.from, to: cny.closure.to });
    expect(Object.keys(w)).not.toContain('wouldShipOn');
  });

  it('the note names her closure and carries no digit that is not hers', () => {
    const note = closureNote(cny);
    expect(note).toContain('Spring Festival 2027');
    const labelDigits = extractNumerals(cny.closure.label).map((n) => n.value);
    for (const n of extractNumerals(note)) expect(labelDigits).toContain(n.value);
  });
});

type WriteInput = Parameters<ReplyWriter['write']>[0];
type RecordedQuote = Parameters<AuditRepo['recordQuote']>[0];

/** The real reply-writer contract, remembering what it was handed. */
class CapturingWriter implements ReplyWriter {
  inputs: WriteInput[] = [];
  private readonly inner = new FakeReplyWriter();
  set replies(r: string[]) { this.inner.replies = r; }
  async write(input: WriteInput) {
    this.inputs.push(input);
    return this.inner.write();
  }
}

describe('G5 · a turn inside her closure', () => {
  const analysis: Analysis = {
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: { value: 20000, unit: 'pcs' }, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'commercial_discussion',
  };

  const run = async () => {
    const tenant = new FakeTenant();
    tenant.closures = [cny.closure];
    tenant.seed(CONVERSATION, emptyState({
      phase: 'commercial_discussion',
      product: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' },
      quantity: { value: 20000, unit: 'pcs' },
    }));
    const analyzer = new FakeAnalyzer(); analyzer.next = analysis;
    const replyWriter = new CapturingWriter();
    replyWriter.replies = ['We are closed for Spring Festival 2027, so I cannot promise a date yet.'];
    const ports = { tenant, retriever: new FakeRetriever(), analyzer, replyWriter, now: () => NOW };
    const req = { conversationId: CONVERSATION, messageId: 'm-g5', text: 'price for 20000 and when can you ship?' };
    const r = await computeTurn(ports, req);
    await commitTurn(ports, req, r, Date.now());
    return { r, tenant, replyWriter };
  };

  it('the reply writer is told WHY no date can be given', async () => {
    const { r, replyWriter } = await run();
    expect(r.quote?.leadTimeDays).toBeNull();
    expect(replyWriter.inputs[0]?.closureNote).toContain('Spring Festival 2027');
  });

  it('and a reply that names her closure — digits included — passes the guards', async () => {
    const { r } = await run();
    expect(r.reply).toContain('Spring Festival 2027');
  });

  it('the recorded quote says it stated no date, and why', async () => {
    const { tenant } = await run();
    const q = tenant.quotesRecorded[0] as RecordedQuote;
    expect(q.leadTimeDays).toBeNull();
    expect(q.leadTimeWithheld?.label).toBe('Spring Festival 2027');
  });
});

const view = (over: Partial<ProofView> = {}): ProofView => ({
  seller: 'Yiwu Hongfa', productName: 'Canvas tote bag', sku: 'ZX-100',
  quantity: 20000, unit: 'pcs', unitPrice: usd(0.85), total: usd(17000),
  tier: { minQty: 10000, maxQty: null }, moq: 500, leadTimeDays: null,
  leadTimeWithheld: { label: '春节', from: '2027-02-05', to: '2027-02-21' },
  certifications: [], taught: [], issuedAt: new Date('2027-01-20'), locale: 'en', ...over,
});

describe('G5 · the buyer’s page, when her closure withheld the date', () => {
  for (const locale of LOCALES) {
    it(`${locale}: it says the date cannot be given yet, and why — never a number of days`, () => {
      const html = renderProof(view({ locale }));
      expect(html).toContain('春节');
      expect(html).toContain('2027-02-05');
      expect(html).not.toContain(t(locale, 'proof.days', { n: 25 }));
    });
  }

  it('a quote that stated a lead time shows it, and a quote that stated nothing shows nothing', () => {
    expect(renderProof(view({ leadTimeDays: 25, leadTimeWithheld: null }))).toContain(t('en', 'proof.days', { n: 25 }));
    const silent = renderProof(view({ leadTimeDays: null, leadTimeWithheld: null }));
    expect(silent).not.toContain(t('en', 'proof.fact.leadTime'));
  });
});
