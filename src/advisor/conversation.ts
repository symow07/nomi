import type { Product, PriceTier, PricingPolicy, NegotiationRule, PriorQuote } from '../core/types/commerce.js';
import type { Money } from '../core/types/money.js';
import type { AdvisorModel } from '../llm/ports.js';
import type { AdvisorSpent } from './answer.js';
import type { Locale } from '../core/owner/i18n/locale.js';
import { computeQuote, selectTier } from '../core/commerce/quote.js';
import { t } from '../api/web/say.js';
import { orderStatusName, type MessageKey } from '../core/owner/i18n/messages.js';
import * as show from '../api/web/values.js';
import { conversationUrl } from '../core/owner/addresses.js';
import { ownershipOf } from '../core/conversation/ownership.js';

export type ConversationIntent = 'last_order' | 'summarise_chat' | 'draft_reply';
export type ConversationSource = { readonly label: string; readonly href: string };
export type ConversationFact = { readonly id: string; readonly label: string; readonly value: string; readonly sources: readonly ConversationSource[]; readonly calculation?: string };
export type ConversationAnswer = {
  readonly kind: 'fact' | 'none' | 'unknown' | 'failed' | 'refused';
  readonly text: string;
  readonly facts: readonly ConversationFact[];
  readonly reply: { readonly text: string; readonly revision: string } | null;
};
export type ConversationContext = {
  readonly businessId: string; readonly conversationId: string; readonly customerId: string; readonly customerName: string | null;
  readonly revision: string;
  readonly assistantName: string | null;
  readonly pendingDraftId: string | null; readonly assignedTo: string | null; readonly closed: boolean;
  readonly messages: readonly { readonly id: string; readonly direction: string; readonly text: string | null; readonly at: string }[];
  readonly earlier: boolean;
  readonly lastOrder: { readonly id: string; readonly reference: string; readonly status: string; readonly productName: string | null;
    readonly quantity: number; readonly unit: string; readonly unitPrice: Money | null; readonly total: Money | null; readonly at: string } | null;
  readonly pricing: { readonly product: Product; readonly quantity: number; readonly tiers: readonly PriceTier[];
    readonly policy: PricingPolicy | null; readonly policyId: string | null; readonly rules: readonly NegotiationRule[];
    readonly ruleIds: readonly string[]; readonly priorQuotes: readonly PriorQuote[] } | null;
};
export type ConversationAnswered = { readonly answer: ConversationAnswer; readonly intent: ConversationIntent | null; readonly subjects: readonly string[]; readonly spent: AdvisorSpent };

const say = (locale: Locale, key: string, p: Record<string, string | number> = {}) => t(locale, key as MessageKey, p);
const plain = (kind: ConversationAnswer['kind'], text: string): ConversationAnswer => ({ kind, text, facts: [], reply: null });
const chatSource = (c: ConversationContext, locale: Locale): ConversationSource => ({ label: say(locale, 'copilot.chat'), href: conversationUrl(c.conversationId) });

/** Owner-requested percentage is data, not a model decision. No inferred or ambiguous percentage. */
function requestedPercent(question: string): number | null {
  const matches = [...question.matchAll(/(\S+)\s*(?:%|percent\b|per cent\b)/gi)];
  if (matches.length !== 1 || !/^\d{1,3}(?:\.\d{1,2})?$/.test(matches[0]![1]!)) return null;
  const pct = Number(matches[0]![1]);
  return Number.isFinite(pct) && pct > 0 && pct <= 100 ? pct : null;
}

/** No model-written customer text. The requested rule still passes every authoritative quote clamp/hold. */
export function replyForConversation(c: ConversationContext, question: string, locale: Locale): ConversationAnswer {
  if (c.closed) return plain('refused', say(locale, 'copilot.closed'));
  const pct = requestedPercent(question);
  if (pct === null) return plain('refused', say(locale, 'copilot.percentMissing'));
  const p = c.pricing;
  if (!p || !p.policy || !Number.isSafeInteger(p.quantity) || p.quantity <= 0) return plain('refused', say(locale, 'copilot.quoteMissing'));
  const tier = selectTier(p.tiers, p.quantity);
  if (!tier || tier.unitPrice.currency !== p.policy.floorPrice.currency) return plain('refused', say(locale, 'copilot.quoteMissing'));
  const proposed: NegotiationRule = { businessId: p.product.businessId, priority: 0, condition: { productId: p.product.id }, action: { kind: 'discount_pct', value: pct } };
  let made: ReturnType<typeof computeQuote>;
  try { made = computeQuote({ product: p.product, tiers: p.tiers, policy: p.policy, rules: [...p.rules, proposed], quantity: p.quantity, priorQuotes: p.priorQuotes }); }
  catch { return plain('refused', say(locale, 'copilot.quoteRefused')); }
  if (!made.ok || made.value.discountPct !== pct) return plain('refused', say(locale, 'copilot.quoteRefused'));
  const quote = made.value;
  if (quote.requiresHuman || quote.contradicts) return plain('refused', say(locale, 'copilot.quoteApproval'));
  const product: ConversationSource = { label: p.product.name, href: `/app/products/${p.product.id}` };
  const rules: ConversationSource = { label: say(locale, 'copilot.priceRules'), href: `/app/products/price-limits#${p.policy.productId ? `p-${p.policy.productId}` : 'everything'}` };
  const request: ConversationSource = { label: say(locale, 'copilot.ownerRequest'), href: `/app/inbox/${c.conversationId}/copilot#copilot-question` };
  const fact = (id: string, value: string, sources: readonly ConversationSource[], calculation?: string): ConversationFact =>
    ({ id, label: say(locale, `copilot.${id}`), value, sources, ...(calculation ? { calculation } : {}) });
  const facts = [
    fact('product', p.product.name, [product]), fact('quantity', `${p.quantity} ${p.product.unit}`, [chatSource(c, locale), product]),
    fact('base', show.money(locale, tier.unitPrice), [product]), fact('discount', `${pct}%`, [request, rules]),
    fact('unitPrice', show.money(locale, quote.unitPrice), [product, rules, request], say(locale, 'copilot.unitCalculation', { price: tier.unitPrice.amount, discount: pct })),
    fact('total', show.money(locale, quote.total), [product, chatSource(c, locale)], `${quote.unitPrice.amount} × ${p.quantity}`),
  ];
  // New customer copy is explicitly English. No guessed customer language or generated promises.
  const text = say('en', 'copilot.replyText', { quantity: String(p.quantity), unit: p.product.unit, product: p.product.name,
    discount: String(pct), price: show.money('en', quote.unitPrice), total: show.money('en', quote.total) });
  return { kind: 'fact', text: say(locale, 'copilot.quoteReady'), facts, reply: { text, revision: c.revision } };
}

export const CONVERSATION_INTENTS: readonly ConversationIntent[] = ['last_order', 'summarise_chat', 'draft_reply'];
const catalogue = [
  { id: 'last_order', ask: "What is this customer's last recorded order?" },
  { id: 'summarise_chat', ask: 'Summarise or recap this chat' },
  { id: 'draft_reply', ask: 'Draft a reply offering an explicitly stated percentage discount' },
];

/** Exact records and an extractive recap cannot turn untrusted chat instructions into business facts. */
export async function answerConversation(c: ConversationContext, question: string, locale: Locale, model: AdvisorModel,
  selected: ConversationIntent | null = null): Promise<ConversationAnswered> {
  const spent = { llmCalls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  let intent = selected;
  const done = (answer: ConversationAnswer): ConversationAnswered => ({ answer, intent, subjects: [c.customerId], spent: { ...spent } });
  if (!intent) {
    try {
      const r = await model.recognise({ question, entries: catalogue });
      spent.llmCalls++; spent.inputTokens += r.usage.inputTokens; spent.outputTokens += r.usage.outputTokens; spent.cachedInputTokens += r.usage.cachedInputTokens ?? 0;
      intent = CONVERSATION_INTENTS.find((i) => i === r.pick?.id) ?? null;
    } catch { return done(plain('failed', t(locale, 'advisor.failed'))); }
  }
  if (intent === 'draft_reply') return done(replyForConversation(c, question, locale));
  if (intent === 'last_order') {
    const o = c.lastOrder;
    if (!o) return done(plain('none', say(locale, 'copilot.noOrder')));
    const sources = [{ label: o.reference, href: `/app/orders/${o.id}` }];
    const entries = [['order', o.reference], ['status', orderStatusName(locale, o.status)], ['product', o.productName ?? '—'], ['quantity', `${o.quantity} ${o.unit}`],
      ['unitPrice', o.unitPrice ? show.money(locale, o.unitPrice) : '—'], ['total', o.total ? show.money(locale, o.total) : '—'], ['date', show.date(locale, new Date(o.at))]];
    return done({ kind: 'fact', text: say(locale, 'copilot.lastOrder'), facts: entries.map(([id, value]) => ({ id: id!, label: say(locale, `copilot.${id}`), value: value!, sources })), reply: null });
  }
  if (intent === 'summarise_chat') {
    if (!c.messages.length) return done(plain('none', say(locale, 'copilot.noChat')));
    const sources = [chatSource(c, locale)];
    const facts: ConversationFact[] = [{ id: 'window', label: say(locale, 'copilot.window'), value: String(c.messages.length), sources }];
    if (c.pricing) facts.push({ id: 'topic', label: say(locale, 'copilot.currentTopic'), value: `${c.pricing.product.name} · ${c.pricing.quantity} ${c.pricing.product.unit}`,
      sources: [...sources, { label: c.pricing.product.name, href: `/app/products/${c.pricing.product.id}` }] });
    facts.push({ id: 'next', label: say(locale, 'copilot.currentState'), value: say(locale, c.closed ? 'copilot.closed' : c.pendingDraftId ? 'copilot.pending'
      : ownershipOf(c.assignedTo) === 'WAITING_HUMAN' ? 'copilot.waitingHuman' : c.assignedTo ? 'copilot.withPerson' : 'copilot.withAssistant'), sources });
    if (c.lastOrder) facts.push({ id: 'lastOrder', label: say(locale, 'copilot.order'), value: `${c.lastOrder.reference} · ${orderStatusName(locale, c.lastOrder.status)}`,
      sources: [{ label: c.lastOrder.reference, href: `/app/orders/${c.lastOrder.id}` }] });
    const recent = c.messages.slice(-6);
    for (const m of recent) {
      facts.push({ id: m.id, label: `${say(locale, m.direction === 'inbound' ? 'copilot.customerWords' : 'copilot.teamWords')} · ${show.date(locale, new Date(m.at))}`,
        value: m.text === null ? say(locale, 'copilot.unreadableMessage') : m.text.length > 600 ? `${m.text.slice(0, 600)}…` : m.text, sources });
    }
    return done({ kind: 'fact', text: `${say(locale, 'copilot.summary', { n: recent.length })}${c.earlier || c.messages.length > recent.length ? ` ${say(locale, 'copilot.earlier')}` : ''}`, facts, reply: null });
  }
  return done(plain('unknown', say(locale, 'copilot.unknown')));
}
