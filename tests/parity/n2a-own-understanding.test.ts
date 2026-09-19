import { describe, it, expect } from 'vitest';
import {
  agreesOnEverything, compareWithModel, detectLanguage, extractQuantity, pickProduct,
  soundsLikeComplaint, stageFor, understand, SURE,
} from '../../src/core/conversation/understand.js';
import { SCENARIOS } from '../../src/trust/scenarios.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { emptyState, PRODUCT, CONVERSATION } from './fixtures.js';
import { FakeAnalyzer, FakeReplyWriter, FakeRetriever, FakeTenant } from '../pipeline/fakes.js';

/**
 * N2a — her own understanding of a message, by rules, in shadow.
 *
 * The rules that decide a turn use four things from a model's analysis —
 * product, quantity, stage, complaint — and the language to answer in. These
 * are the rules that find them without a model, and the scoreboard against the
 * hand-labelled scenarios. `null` always means "I cannot tell": a wrong answer
 * from her own understanding is worse than a slow one from a model.
 */

describe('N2a · which language', () => {
  it('knows a script when it sees one, even beside a product code', () => {
    expect(detectLanguage('كم سعر 5000 قطعة من BAG-01؟')).toBe('ar');
    expect(detectLanguage('这个袋子多少钱？要5000个')).toBe('zh');
    expect(detectLanguage('Сколько стоит 5000 штук?')).toBe('ru');
  });

  it('tells Latin-script languages apart by their small words', () => {
    expect(detectLanguage('Hello, what is the price for 5000 bags please?')).toBe('en');
    expect(detectLanguage('Bonjour, combien pour 500 sacs ? Merci')).toBe('fr');
    expect(detectLanguage('Hola, necesito 2000 bolsas, cuánto es el precio?')).toBe('es');
  });

  it('says it cannot tell rather than guess', () => {
    expect(detectLanguage('BAG-01 5000')).toBeNull();
    expect(detectLanguage('👍')).toBeNull();
    expect(detectLanguage('')).toBeNull();
  });
});

describe('N2a · how many', () => {
  it('a number beside a unit, in the ways buyers write it', () => {
    expect(extractQuantity('We can commit to 5000 units.')).toEqual({ value: 5000, unit: 'pcs' });
    expect(extractQuantity('5k pcs to start')).toEqual({ value: 5000, unit: 'pcs' });
    expect(extractQuantity('10 000 pièces svp')).toEqual({ value: 10000, unit: 'pcs' });
    expect(extractQuantity('1,200 cartons')).toEqual({ value: 1200, unit: 'cartons' });
    expect(extractQuantity('需要5000个袋子')).toEqual({ value: 5000, unit: 'pcs' });
    expect(extractQuantity('先订5万个')).toEqual({ value: 50000, unit: 'pcs' });
    expect(extractQuantity('أحتاج 3000 قطعة')).toEqual({ value: 3000, unit: 'pcs' });
  });

  it('a price, a size, a weight or a duration is not a quantity', () => {
    expect(extractQuantity('Is $0.45 your best price?')).toBeNull();
    expect(extractQuantity('size 38 x 40 cm, 90 gsm')).toBeNull();
    expect(extractQuantity('each one weighs 5 kg')).toBeNull();
    expect(extractQuantity('5 kilos each')).toBeNull();
    // …but asked for, a weight IS the order — and the k of "kilos" is not a thousand.
    expect(extractQuantity('I need 5 kilos')).toEqual({ value: 5, unit: 'kg' });
    expect(extractQuantity('can you ship in 30 days?')).toBeNull();
    expect(extractQuantity('12% discount?')).toBeNull();
  });

  it('a bare number counts only when it is the only one and she said she wants something', () => {
    expect(extractQuantity('I need 5000')).toEqual({ value: 5000, unit: 'pcs' });
    expect(extractQuantity('model 300 looks nice')).toBeNull();
    expect(extractQuantity('I need 2 samples then 5000 pcs')).toEqual({ value: 5000, unit: 'pcs' });
    expect(extractQuantity('order 300 or 500?')).toBeNull();   // two candidates: she cannot tell
  });
});

describe('N2a · is it a complaint', () => {
  it('a grievance, in the languages it arrives in', () => {
    for (const t of ['The goods arrived damaged and I want a refund', '收到的货坏了，我要退款', 'البضاعة وصلت تالفة وأريد استرجاع المبلغ', 'Colis jamais reçu, je veux un remboursement']) {
      expect(soundsLikeComplaint(t), t).toBe(true);
    }
  });

  it('a question about a case that has not happened is not one', () => {
    for (const t of ['What happens if the goods arrive damaged?', 'Do you refund defective items?', '如果货坏了怎么办？', 'إذا وصلت البضاعة تالفة ماذا يحدث؟']) {
      expect(soundsLikeComplaint(t), t).toBe(false);
    }
  });
});

describe('N2a · which product, and how sure', () => {
  const bags = { productId: PRODUCT as string, relevance: 0.8, sku: 'BAG-01' };
  const other = { productId: 'other', relevance: 0.75, sku: 'CUP-02' };

  it('a clear leader is the product; a near tie is nobody', () => {
    expect(pickProduct('non-woven bags', [bags], emptyState()).productId).toBe(PRODUCT);
    expect(pickProduct('bags or cups', [bags, other], emptyState()).productId).toBeNull();
  });

  it('a search score alone is never "sure": the buyer is asked — unless she typed the code', () => {
    expect(pickProduct('non-woven bags', [bags], emptyState()).confidence).toBeLessThan(SURE);
    expect(pickProduct('price for BAG-01?', [bags], emptyState()).confidence).toBeGreaterThanOrEqual(SURE);
    expect(pickProduct('I think those bags, maybe', [bags], emptyState()).confidence)
      .toBeLessThan(pickProduct('those bags', [bags], emptyState()).confidence);
  });

  it('nothing named now: the conversation\'s own product stands', () => {
    const state = { ...emptyState(), product: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' as const } };
    expect(pickProduct('and for 5,000?', [], state)).toEqual({ productId: PRODUCT, confidence: 0.95 });
  });
});

describe('N2a · which stage', () => {
  it('follows from what is known, on the ladder the model is told to use', () => {
    const k = { greetingOnly: false, product: false, sure: false, quantity: false };
    expect(stageFor({ ...k, greetingOnly: true })).toBe('warm_intake');
    expect(stageFor(k)).toBe('clarification');
    expect(stageFor({ ...k, product: true })).toBe('clarification');
    expect(stageFor({ ...k, product: true, quantity: true })).toBe('clarification'); // not sure which product: ask first
    expect(stageFor({ ...k, product: true, sure: true })).toBe('qualification');
    expect(stageFor({ ...k, product: true, sure: true, quantity: true })).toBe('commercial_discussion');
  });
});

describe('N2a · the scoreboard against the hand-labelled scenarios', () => {
  const labelled = SCENARIOS.filter((s) => s.analysis && s.buyer.kind !== 'image');
  const scored = labelled.map((s) => {
    const state = { ...emptyState(), ...(s.state ?? {}) };
    const own = understand({ text: s.buyer.text, state, candidates: s.candidates === 'none' ? [] : (s.candidates ?? []) });
    return { id: s.id, a: compareWithModel(own, s.analysis!, state) };
  });

  it('there is a set to score against', () => {
    expect(labelled.length).toBeGreaterThanOrEqual(20);
  });

  it('language, product, complaint and stage agree with the labels on every one', () => {
    for (const field of ['language', 'product', 'complaint', 'phase'] as const) {
      const wrong = scored.filter((x) => x.a[field] === false).map((x) => x.id);
      expect(wrong, `${field} disagrees on: ${wrong.join(', ')}`).toEqual([]);
    }
  });

  it('quantity misses only where the message does not say it — "the same volume again" needs MEMORY, not rules', () => {
    // A floor that may rise and never fall. These three carry a quantity in the
    // label that is neither in the message nor in the conversation's state.
    const wrong = scored.filter((x) => !x.a.quantity).map((x) => x.id).sort();
    expect(wrong).toEqual([
      'higher-price-than-already-given-waits-for-owner',
      'unsupported-ce-fda-claim-is-blocked',
      'unsupported-refund-guarantee-is-blocked',
    ]);
    expect(scored.filter((x) => agreesOnEverything(x.a)).length).toBe(labelled.length - 3);
  });
});

describe('N2a · in the turn it is a shadow, and only a shadow', () => {
  const ports = (): TurnPorts & { tenant: FakeTenant; retriever: FakeRetriever; analyzer: FakeAnalyzer; replyWriter: FakeReplyWriter } => ({
    tenant: new FakeTenant(), retriever: new FakeRetriever(), analyzer: new FakeAnalyzer(), replyWriter: new FakeReplyWriter(),
    now: () => new Date('2026-07-14T12:00:00Z'),
  });
  const said = (over: Partial<Analysis['intent']> = {}): Analysis => ({
    language: { detected: 'en', replyIn: 'en' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [], ...over },
    recommendedPhase: 'clarification',
  });

  it('when a model analysed the message, her own reading is recorded beside it', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    p.retriever.results = [];                       // nothing in her catalogue matches
    p.analyzer.next = said();
    const r = await computeTurn(p, { conversationId: CONVERSATION, messageId: 'm-n2a-1', text: 'Hello, do you sell tote bags?' });
    expect(r.ownUnderstanding?.own.language).toBe('en');
    expect(r.ownUnderstanding?.agrees).toEqual({ language: true, quantity: true, product: true, complaint: true, phase: true });
    expect(r.ownUnderstanding?.onEverything).toBe(true);
  });

  it('a disagreement is recorded as one, and changes nothing the model decided', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, emptyState());
    p.retriever.results = [];
    p.analyzer.next = said({ quantityMentioned: { value: 7000, unit: 'pcs' } }); // the model "heard" a number that is not there
    const r = await computeTurn(p, { conversationId: CONVERSATION, messageId: 'm-n2a-2', text: 'Hello, do you sell tote bags?' });
    expect(r.ownUnderstanding?.agrees.quantity).toBe(false);
    expect(r.ownUnderstanding?.onEverything).toBe(false);
    expect(r.decision.quantity?.value).toBe(7000);   // the turn still runs on the model's reading
  });

  it('no model, nothing to compare with: a bare yes to her own question records no shadow', async () => {
    const p = ports();
    p.tenant.seed(CONVERSATION, { ...emptyState(), pendingQuestion: 'product_confirmation',
      product: { productId: PRODUCT, confidence: 0.7, confirmedByClient: false, matchMethod: 'text' } });
    const r = await computeTurn(p, { conversationId: CONVERSATION, messageId: 'm-n2a-3', text: 'yes' });
    expect(r.analysis).toBeNull();
    expect(r.ownUnderstanding).toBeNull();
  });

  it('nothing reads it to decide a turn', () => {
    const turn = readFileSync(fileURLToPath(new URL('../../src/pipeline/turn.ts', import.meta.url)), 'utf8');
    const uses = turn.split('\n').filter((l) => /ownUnderstanding/.test(l) && !/^\s*(\*|\/\/)/.test(l));
    // Declared, assigned once, returned, recorded — and that is all.
    expect(uses.length).toBe(5);
    const decide = readFileSync(fileURLToPath(new URL('../../src/core/conversation/decide.ts', import.meta.url)), 'utf8');
    expect(decide).not.toMatch(/understand/);
  });
});
