/**
 * M46 — after the order.
 *
 * `confirmable.ts` and `invoice.ts` exist, and the trail stops dead at
 * confirmation. Three weeks later a buyer writes "where is my order?" and there
 * is nothing in this product that can answer him — not because the answer is
 * hard, but because nobody wrote it down. For a Yiwu supplier that silence is
 * the half that produces repeat business, and it is also the half that produces
 * the phone call at 11pm.
 *
 * ── SHE SETS IT. NOTHING IS INFERRED ──────────────────────────────────────
 *
 * There is no rule here that advances an order because time passed, because an
 * invoice was issued, or because a lead time elapsed. An order is in production
 * when she says it is. The alternative — deriving a state from a schedule — is
 * a promise made by arithmetic, and the buyer holding it is holding HER to it.
 *
 * ── AND NOMI NEVER ESTIMATES A DATE FROM A STATE ──────────────────────────
 *
 * This is the whole safety rule of the milestone, and it is one sentence: the
 * reply says WHICH state and WHEN SHE SET IT, and stops. "In production since
 * the 3rd" is a fact she wrote. "Should ship around the 20th" is a delivery
 * promise assembled out of a state and a lead time by something that has never
 * seen her factory floor — and M44 already established that she does not
 * promise dates her factory cannot hit.
 *
 * So the buyer-facing sentence is built HERE, deterministically, from two
 * fields. No model writes it, which is the only way to be sure no model
 * embellishes it.
 *
 * Pure per ADR-0002.
 */

/**
 * The states an order can be in.
 *
 * These four are the ones the schema has carried since 0004, and they are the
 * words a Yiwu supplier actually uses to a buyer. There is no owner-defined
 * vocabulary: a state that only she understands cannot be reported to a buyer
 * in his language, and inventing a vocabulary system before watching a real
 * factory use these would be guessing. What she calls it in her own words goes
 * in the note, which is hers and is never sent.
 */
export const ORDER_STATES = ['confirmed', 'in_production', 'shipped', 'cancelled'] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const isOrderState = (s: string): s is OrderState =>
  (ORDER_STATES as readonly string[]).includes(s);

/** One thing she recorded about an order. Append-only: history, not state. */
export type OrderUpdate = {
  readonly state: OrderState;
  /** When SHE recorded it — not when anything happened downstream. */
  readonly at: Date;
  /** Hers. Never sent to a buyer: it is a note to herself. */
  readonly note: string | null;
  /** A courier's reference, pasted. This product does not call a courier. */
  readonly trackingReference: string | null;
  readonly by: string;
};

/**
 * Did this buyer ask where his order is?
 *
 * Deterministic, for the same reason M45's matcher is: it decides whether a
 * REPLY is produced from a row rather than by a model, and that decision must
 * not vary between two identical messages.
 */
const STATUS_PHRASES: readonly string[] = [
  // English
  'where is my order', 'order status', 'status of my order', 'any update on my order',
  'when will it ship', 'has it shipped', 'shipping update', 'tracking number', 'tracking no',
  // 中文
  '我的订单', '订单进度', '发货了吗', '什么时候发货', '快递单号', '物流单号', '到哪了',
  // العربية
  'أين طلبي', 'حالة الطلب', 'هل تم الشحن', 'رقم التتبع',
];

export function asksOrderStatus(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  return STATUS_PHRASES.some((p) => t.includes(p.toLowerCase()));
}

/**
 * What a buyer may be told: the state, the date she set it, and a tracking
 * reference if she pasted one. Nothing else.
 *
 * NO ESTIMATE APPEARS HERE and none can be added by the caller: this returns a
 * finished sentence rather than a context for a model to write around. The
 * numerals it contains are the date's own, and `guardNumerals` sees them
 * through the `allow` list the caller passes — which is exactly the digits of
 * this sentence and nothing more.
 */
export function orderStatusReply(input: {
  readonly reference: string;
  readonly update: OrderUpdate;
  readonly formatDate: (d: Date) => string;
}): { reply: string; allow: readonly number[] } {
  const { reference, update } = input;
  const when = input.formatDate(update.at);
  const WORDS: Record<OrderState, string> = {
    confirmed: 'confirmed',
    in_production: 'in production',
    shipped: 'shipped',
    cancelled: 'cancelled',
  };

  const tracking = update.trackingReference
    ? ` The tracking reference is ${update.trackingReference}.`
    : '';
  const reply = `Order ${reference} is ${WORDS[update.state]} as of ${when}.${tracking}`;

  // Every digit in the sentence, sourced. The reference and the tracking
  // reference are strings she wrote; the date is the one she set. Nothing here
  // is arithmetic, which is the point.
  const digits = (s: string): number[] =>
    [...s.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
      .map((m) => Number(m[0].replace(/,/g, '')))
      .filter((n) => Number.isFinite(n));

  return { reply, allow: digits(reply) };
}
