import { readFileSync } from 'node:fs';
import { usd } from '../../src/core/types/money.js';
import { unsafeBrand } from '../../src/core/types/brand.js';
import type {
  BusinessId,
  ClientId,
  ConversationId,
  ProductId,
} from '../../src/core/types/ids.js';
import type { ConversationState } from '../../src/core/types/conversation.js';
import type { PriceTier, PricingPolicy, Product } from '../../src/core/types/commerce.js';

const id = <T>(s: string): T => unsafeBrand<never>()(s) as unknown as T;

export const BUSINESS = id<BusinessId>('a0000000-0000-0000-0000-000000000001');
export const CLIENT = id<ClientId>('c0000000-0000-0000-0000-000000000001');
export const CONVERSATION = id<ConversationId>('d0000000-0000-0000-0000-000000000001');
export const PRODUCT = id<ProductId>('b0000000-0000-0000-0000-000000000001');

/** The 18 payloads the n8n system is tested against. Same inputs, same expectations. */
type TestCase = { _id: string; _description: string; payload: Record<string, unknown> };
const raw = JSON.parse(readFileSync('samples/payloads.json', 'utf8')) as {
  test_cases: TestCase[];
};

export function payload(tcId: string): Record<string, unknown> {
  const c = raw.test_cases.find((t) => t._id === tcId);
  if (!c) throw new Error(`no such test case: ${tcId}`);
  return c.payload;
}

export const text = (tcId: string): string => String(payload(tcId)['text'] ?? '');

export const emptyState = (over: Partial<ConversationState> = {}): ConversationState => ({
  aiDisclosedAt: null,
  conversationId: CONVERSATION,
  businessId: BUSINESS,
  clientId: CLIENT,
  phase: 'warm_intake',
  turnCount: 0,
  scores: { problem: 0, lead: 0 },
  product: null,
  quantity: null,
  contact: { email: null },
  pendingQuestion: null,
  assignedTo: null,
  preferredLanguage: null,
  contextSummary: null,
  ...over,
});

export const product = (over: Partial<Product> = {}): Product => ({
  id: PRODUCT,
  businessId: BUSINESS,
  sku: 'BAG-NW-001',
  name: 'Non-woven shopping bag',
  moq: 1000,
  unit: 'pcs',
  leadTimeDays: 25,
  customizable: true,
  ...over,
});

export const tiers = (): PriceTier[] => [
  { productId: PRODUCT, minQty: 1000, maxQty: 4999, unitPrice: usd(0.5) },
  { productId: PRODUCT, minQty: 5000, maxQty: 19999, unitPrice: usd(0.45) },
  { productId: PRODUCT, minQty: 20000, maxQty: null, unitPrice: usd(0.38) },
];

export const policy = (over: Partial<PricingPolicy> = {}): PricingPolicy => ({
  businessId: BUSINESS,
  productId: PRODUCT,
  floorPrice: usd(0.35),
  maxDiscountPct: 10,
  humanRequiredAbovePct: 7,
  ...over,
});
