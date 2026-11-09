import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { computeTurn, type TurnPorts } from '../../src/pipeline/turn.js';
import { anthropicReplyWriter } from '../../src/llm/anthropic.js';
import type { Analysis } from '../../src/core/conversation/decide.js';
import { CAPABILITIES } from '../../src/core/conversation/autonomy.js';
import { modesFor } from '../../src/core/conversation/autonomyLevel.js';
import { usd } from '../../src/core/types/money.js';
import { emptyState, CONVERSATION, PRODUCT, product } from './fixtures.js';
import { FakeAnalyzer, FakeRetriever, FakeTenant } from '../pipeline/fakes.js';

/**
 * BLOCK 5.5, CONDITION 3 — WITH NO VERIFIED ORDER, THE WRITER IS ASKED BYTE FOR BYTE WHAT IT WAS ASKED BEFORE.
 *
 * Each scenario runs the real turn (`computeTurn`) with the real reply writer (`anthropicReplyWriter`) over a client
 * that only records the request, and hashes the system prompt and the user message (CONTEXT + the customer's words).
 * `BASE` was recorded by running this same file, unchanged but for `PRINT=1`, on the base commit 789972e7 (#453,
 * before 5.5), which knows no `orderLookup` port: it ignores it, so its hash is what every prompt was. HEAD must
 * produce the same bytes with no port, with the switch off ('off'), and with an order number asked about while off.
 * A refused lookup asks no writer at all; that, and a verified order's own section, are in tests/pipeline/order-lookup.
 */

const NOW = new Date('2026-11-10T04:00:00Z');

type Captured = { system: string; user: string };
function recordingClient(captured: Captured[]) {
  return {
    messages: {
      create: async (params: { system: string; messages: { content: string }[] }) => {
        captured.push({ system: params.system, user: params.messages[0]!.content });
        return { content: [{ type: 'text', text: JSON.stringify({ reply_text: 'Happy to help with that.' }) }], stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 }, model: 'recorder' };
      },
    },
  } as never;
}

function ports(captured: Captured[], primary: 'price_request' | 'other') {
  const tenant = new FakeTenant();
  tenant.selling = { pricesToOwner: false, kind: 'online_shop', quantityFirst: false };
  tenant.products.set(PRODUCT, product({ name: 'Rose lip oil', moq: null, unit: 'item' }));
  tenant.tiers.set(PRODUCT, [{ productId: PRODUCT, minQty: 1, maxQty: null, unitPrice: usd('12') }]);
  const modes = modesFor('waits');
  tenant.grantRows = CAPABILITIES.map((capability) => ({ capability, mode: modes[capability], timeWindow: null }));
  tenant.seed(CONVERSATION, emptyState({ phase: 'clarification' }));
  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'en', replyIn: 'en' },
    intent: primary === 'price_request'
      ? { primary, productCandidate: { productId: PRODUCT, confidence: 0.95, confirmedByClient: true, matchMethod: 'text' }, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] }
      : { primary, productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: primary === 'price_request' ? 'commercial_discussion' : 'clarification', wantsPerson: false,
  } satisfies Analysis;
  return { tenant, retriever: new FakeRetriever(), analyzer, replyWriter: anthropicReplyWriter(recordingClient(captured), 'recorder-model'), now: () => NOW };
}

const off = { look: async () => ({ kind: 'off' as const }) };
const SCENARIOS: Record<string, { text: string; primary: 'price_request' | 'other'; port: typeof off | null }> = {
  price_no_port: { text: 'How much is the rose lip oil?', primary: 'price_request', port: null },
  price_switch_off: { text: 'How much is the rose lip oil?', primary: 'price_request', port: off },
  order_no_port: { text: 'Where is my order #1001? My email is ana@example.test', primary: 'other', port: null },
  order_switch_off: { text: 'Where is my order #1001? My email is ana@example.test', primary: 'other', port: off },
};

/** sha256 of the system prompt and of the user message, per scenario, on 789972e7. */
const BASE: Record<string, { system: string; user: string }> = {
  price_no_port: { system: '4332c75f1f5de9e1874ac0b12d1d5a4ae07da301a18c1da71a741f94458e1365', user: '6e693fbf8cfbd61dac6efdea1805525a50dc0e23fc1997c177f860510b76c685' },
  order_no_port: { system: '4332c75f1f5de9e1874ac0b12d1d5a4ae07da301a18c1da71a741f94458e1365', user: '704baad8d56605eb08b04548b9cab02b7896ac14df93555d7f6f82895e3cbdff' },
};
const BASE_OF: Record<string, string> = {
  price_no_port: 'price_no_port', price_switch_off: 'price_no_port',
  order_no_port: 'order_no_port', order_switch_off: 'order_no_port',
};
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('5.5 · condition 3 — no verified order, the same prompt as before', () => {
  it('the control: a verified order does change both — so the hashes above can tell', async () => {
    const captured: Captured[] = [];
    const verified = { look: async () => ({ kind: 'verified' as const, order: { name: '#1001', placed_on: '2026-11-01', fulfillment: 'Unfulfilled', shipments: [] } }) };
    const p = { ...ports(captured, 'other'), orderLookup: verified } as TurnPorts;
    await computeTurn(p, { conversationId: CONVERSATION, messageId: 'm-1', text: SCENARIOS['order_switch_off']!.text });
    expect(sha(captured[0]!.system)).not.toBe(BASE['order_no_port']!.system);
    expect(sha(captured[0]!.user)).not.toBe(BASE['order_no_port']!.user);
    expect(captured[0]!.user).toContain('"order"');
  });
  for (const [name, sc] of Object.entries(SCENARIOS)) {
    it(`${name}: system and CONTEXT hash as on 789972e7`, async () => {
      const captured: Captured[] = [];
      const p = { ...ports(captured, sc.primary), ...(sc.port ? { orderLookup: sc.port } : {}) } as TurnPorts;
      await computeTurn(p, { conversationId: CONVERSATION, messageId: 'm-1', text: sc.text });
      expect(captured.length).toBeGreaterThan(0);
      const got = { system: sha(captured[0]!.system), user: sha(captured[0]!.user) };
      if (process.env['PRINT'] === '1') console.log(`PIN ${name} ${JSON.stringify(got)}`);
      else expect(got).toEqual(BASE[BASE_OF[name]!]);
      expect(captured[0]!.user).not.toContain('"order"');
    });
  }
});
