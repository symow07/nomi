import type { AdvisorModel, AdvisorCallUsage } from '../llm/ports.js';
import type { Locale } from '../core/owner/i18n/locale.js';
import type { MessageKey } from '../core/owner/i18n/messages.js';
import type { Money } from '../core/types/money.js';
import type { AdvisorSpent } from './answer.js';
import { LANGUAGE } from './answer.js';
import { checkPhrasing } from './check.js';
import { t } from '../api/web/say.js';
import * as show from '../api/web/values.js';
import { conversationUrl } from '../core/owner/addresses.js';
import { figuresIn } from '../core/conversation/figures.js';
import { ownershipOf } from '../core/conversation/ownership.js';
import { PROBLEM_SIGNAL_KINDS } from '../core/scoring/signals.js';

/**
 * THE HAND-OFF THAT CARRIES CONTEXT (Block 3 PR 4). When a conversation goes to a person, three lines say where it
 * stands: what the customer wants, what was already said (each figure with its source), and what waits on the owner.
 *
 *   · "said" and "waiting" are RECORDS, read and written out by rules: the quotes that reached the customer (0224's
 *     `messages.quote_id`), the figures of every other message the seller's side sent, the hand-off's reasons, a reply
 *     to approve, an order to confirm, a deletion request. No model touches them.
 *   · "wants" is the one line the advisor's model words, from the customer's own messages and the hand-off's reason,
 *     and it is checked like every advisor sentence (check.ts): a figure, a name, a month or a currency the facts do
 *     not carry throws it away, and the customer's last words stand in its place. A false alarm costs a plainer line.
 *
 * The phrased line is kept in this process per conversation and language, and asked again only when a newer message
 * is on the conversation: opening the panel twice costs one call. A deploy forgets it, which costs one more call;
 * a table would have needed its own erasure path for a sentence about a customer, and this needs none.
 * It is never customer-facing: nothing here reaches a sender, a draft or the conversation.
 */

export type HandoffFacts = {
  readonly conversationId: string;
  /** The newest message on the conversation, either side: the cache's key. */
  readonly latestMessageId: string | null;
  readonly lastWasInbound: boolean;
  readonly customerName: string | null;
  readonly assignedTo: string | null;
  /** The customer's newest messages, oldest first (at most six); a voice note by its transcript. */
  readonly inbound: readonly { readonly id: string; readonly text: string | null; readonly at: string }[];
  readonly topic: { readonly productId: string; readonly name: string; readonly unit: string; readonly quantity: number | null } | null;
  /** Quotes a message carried to the customer, newest first (at most three). */
  readonly told: readonly {
    readonly productId: string; readonly productName: string; readonly unit: string; readonly quantity: number;
    readonly unitPrice: Money; readonly total: Money; readonly at: string; readonly byPerson: boolean;
  }[];
  /** The seller's side's other messages, newest first (at most ten): their figures have no price on record. */
  readonly saidElse: readonly { readonly text: string; readonly at: string; readonly byPerson: boolean }[];
  /** Unresolved signal kinds, newest first. */
  readonly reasons: readonly string[];
  readonly pendingDraft: boolean;
  /** The product of an order waiting for the owner's tap, if one waits. */
  readonly orderWaiting: string | null;
  readonly deletionWaiting: boolean;
  readonly unsentReply: boolean;
};

export type HandoffSource = { readonly label: string; readonly href: string };
export type SaidFigure = {
  readonly what: 'quantity' | 'unit_price' | 'total' | 'figure';
  /** As the owner reads it. */
  readonly value: string;
  readonly amount: string | null; readonly currency: string | null;
  readonly by: 'assistant' | 'person';
  readonly at: string;
  /** The record the figure came from; null: no price on record says where it came from. */
  readonly source: HandoffSource | null;
  /** Where it was said. */
  readonly said: HandoffSource;
};
export type WaitingItem = { readonly kind: 'deletion' | 'order' | 'draft' | 'handoff' | 'reply' | 'unsent'; readonly text: string; readonly href: string };
export type HandoffSummary = {
  readonly asOf: string | null;
  readonly wants: { readonly text: string; readonly phrased: boolean };
  readonly said: { readonly text: string; readonly figures: readonly SaidFigure[] };
  readonly waiting: { readonly text: string; readonly items: readonly WaitingItem[] };
};

const PROBLEM: ReadonlySet<string> = new Set(PROBLEM_SIGNAL_KINDS);
/** At most this many conversations' lines are kept; the oldest kept goes first. */
export const HANDOFF_KEPT = 500;
const kept = new Map<string, { readonly asOf: string | null; readonly text: string; readonly phrased: boolean }>();
const keyOf = (businessId: string, conversationId: string, locale: Locale): string => `${businessId}:${conversationId}:${locale}`;

/** A conversation that is gone (erased, or never this business's): nothing of it stays kept. */
export function forgetHandoff(businessId: string, conversationId: string): void {
  for (const k of [...kept.keys()]) if (k.startsWith(`${businessId}:${conversationId}:`)) kept.delete(k);
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
const list = (locale: Locale, items: readonly string[]): string => new Intl.ListFormat(locale, { type: 'conjunction' }).format(items);

export async function handoffSummary(f: HandoffFacts, o: {
  readonly businessId: string; readonly locale: Locale; readonly model: AdvisorModel | null;
  /** Every customer's and product's name in the workspace, for the check. */
  readonly known: () => Promise<readonly string[]>;
}): Promise<{ readonly summary: HandoffSummary; readonly cached: boolean; readonly spent: AdvisorSpent }> {
  const { locale } = o;
  const say = (key: string, p: Record<string, string | number> = {}): string => t(locale, key as MessageKey, p);
  const spent = { llmCalls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const counted = (u: AdvisorCallUsage): void => { spent.llmCalls += 1; spent.inputTokens += u.inputTokens; spent.outputTokens += u.outputTokens; spent.cachedInputTokens += u.cachedInputTokens ?? 0; };
  const name = f.customerName ?? say('common.buyer');
  const reasons = f.reasons.filter((k) => PROBLEM.has(k) && !(k === 'deletion_requested' && f.deletionWaiting));
  const reasonWords = [...new Set(reasons)].map((k) => say(`takeover.reason.${k}`));

  // ── what the customer wants: the one worded line ───────────────────────────────────────────────────────────
  const words = f.inbound.map((m) => m.text?.trim() ?? '').filter((x) => x.length > 0);
  const last = words.at(-1) ?? null;
  const theirWords = last ? { text: say('copilot.handoff.wantsWords', { words: clip(last, 200) }), phrased: false } : null;
  let wants: { text: string; phrased: boolean };
  let cached = false;
  if (!theirWords) wants = { text: say('copilot.handoff.wantsNone'), phrased: false };
  else {
    const key = keyOf(o.businessId, f.conversationId, locale);
    const hit = kept.get(key);
    if (hit && hit.asOf === f.latestMessageId) { wants = { text: hit.text, phrased: hit.phrased }; cached = true; }
    else if (!o.model) wants = theirWords;              // not kept: worded when the model can be asked
    else {
      const facts = [
        say('copilot.handoff.fact.customer', { customer: name }),
        ...words.map((w) => say('copilot.handoff.fact.wrote', { words: clip(w, 300) })),
        ...(f.topic ? [say('copilot.handoff.fact.topic', { product: f.topic.name })] : []),
        ...(reasonWords.length ? [say('copilot.handoff.fact.reason', { reasons: list(locale, reasonWords) })] : []),
      ];
      const names = [f.customerName, f.topic?.name].filter((x): x is string => !!x && x.trim().length >= 2);
      let text: string | null = null;
      try {
        const r = await o.model.phrase({ question: say('copilot.handoff.ask'), language: LANGUAGE[locale], facts, opinion: false });
        counted(r.usage);
        text = r.text?.trim() || null;
      } catch { text = null; }
      let ok = false;
      if (text && text.length <= 400) {
        const known = await o.known().catch(() => null);
        ok = known !== null && checkPhrasing(text, { facts, names, known, must: [], locale }).ok;
      }
      wants = ok && text ? { text, phrased: true } : theirWords;
      // Kept once the model was asked: asking again before a new message would only cost again.
      if (spent.llmCalls > 0) {
        kept.delete(key);
        kept.set(key, { asOf: f.latestMessageId, ...wants });
        while (kept.size > HANDOFF_KEPT) kept.delete(kept.keys().next().value!);
      }
    }
  }

  // ── what was already said: records only ──────────────────────────────────────────────────────────────────
  const here = conversationUrl(f.conversationId);
  const by = (person: boolean): 'assistant' | 'person' => (person ? 'person' : 'assistant');
  const saidAt = (person: boolean, at: string): HandoffSource =>
    ({ label: say(person ? 'copilot.handoff.saidByPerson' : 'copilot.handoff.saidByAssistant', { date: show.date(locale, new Date(at)) }), href: here });
  const figures: SaidFigure[] = [];
  for (const q of f.told) {
    const source = { label: q.productName, href: `/app/products/${encodeURIComponent(q.productId)}` };
    const common = { by: by(q.byPerson), at: q.at, source, said: saidAt(q.byPerson, q.at) };
    figures.push({ what: 'quantity', value: show.quantityOf(locale, q.quantity, q.unit), amount: String(q.quantity), currency: null, ...common });
    figures.push({ what: 'unit_price', value: show.money(locale, q.unitPrice), amount: q.unitPrice.amount, currency: q.unitPrice.currency, ...common });
    figures.push({ what: 'total', value: show.money(locale, q.total), amount: q.total.amount, currency: q.total.currency, ...common });
  }
  const other: string[] = [];
  for (const m of f.saidElse) {
    for (const fig of figuresIn(m.text)) {
      if (figures.length >= 24) break;
      figures.push({ what: 'figure', value: fig, amount: null, currency: null, by: by(m.byPerson), at: m.at, source: null, said: saidAt(m.byPerson, m.at) });
      if (!other.includes(fig)) other.push(fig);
    }
  }
  const toldLines = f.told.slice(0, 2).map((q) => say('copilot.handoff.told', {
    who: say(q.byPerson ? 'copilot.handoff.whoPerson' : 'copilot.handoff.whoAssistant'), product: q.productName,
    quantity: show.quantityOf(locale, q.quantity, q.unit), price: show.money(locale, q.unitPrice), total: show.money(locale, q.total),
  }));
  const saidText = [
    ...(toldLines.length ? toldLines : [say('copilot.handoff.toldNone')]),
    ...(other.length ? [say('copilot.handoff.otherFigures', { figures: list(locale, other.slice(0, 5)) })] : []),
  ].join(' ');

  // ── what waits on the owner: records only ─────────────────────────────────────────────────────────────────
  const items: WaitingItem[] = [];
  if (f.deletionWaiting) items.push({ kind: 'deletion', text: say('copilot.handoff.wait.deletion'), href: `/app/conversations/${encodeURIComponent(f.conversationId)}#deletion` });
  if (f.orderWaiting) items.push({ kind: 'order', text: say('copilot.handoff.wait.order', { product: f.orderWaiting }), href: here });
  if (f.pendingDraft) items.push({ kind: 'draft', text: say('copilot.handoff.wait.draft'), href: here });
  if (reasonWords.length) items.push({ kind: 'handoff', text: say('copilot.handoff.wait.handoff', { reasons: list(locale, reasonWords) }), href: here });
  else if (ownershipOf(f.assignedTo) !== 'AI' && f.lastWasInbound) items.push({ kind: 'reply', text: say('copilot.handoff.wait.reply', { customer: name }), href: here });
  if (f.unsentReply) items.push({ kind: 'unsent', text: say('copilot.handoff.wait.unsent'), href: here });
  const waitingText = items.length ? items.map((i) => i.text).join(' ') : say('copilot.handoff.wait.none');

  return {
    summary: { asOf: f.latestMessageId, wants, said: { text: saidText, figures }, waiting: { text: waitingText, items } },
    cached, spent: { ...spent },
  };
}
