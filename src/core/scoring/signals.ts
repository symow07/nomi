import type { Scores } from '../types/conversation.js';
import { type Money, type Currency, usd, isAbove } from '../types/money.js';

/**
 * Observations about a conversation. Scores are DERIVED from these, never
 * accumulated into a running total.
 *
 * The n8n system seeded `score` from the stored value and only ever added, so
 * the score was monotonic — it could never come down, even after the problem was
 * resolved. Combined with a close gate at `score >= 70`, and `high_value` worth
 * +60, this meant large orders permanently blocked their own confirmation.
 *
 * Storing signals and recomputing means a resolved problem simply stops being
 * in the set, and the score falls. See docs/adr/0003 §4.
 */
export type Signal =
  // --- problem signals: something is going wrong. These GATE the close. ---
  | { readonly kind: 'human_requested' }
  | { readonly kind: 'complaint' }
  | { readonly kind: 'repeated_ambiguity'; readonly turns: number }
  | { readonly kind: 'low_confidence_image' }
  /**
   * M34 — a voice note that could not be heard. A PROBLEM signal by the same
   * reasoning as low_confidence_image: the machine does not know what the buyer
   * said, so the employee must not answer and the owner must be told. The
   * reason travels in the payload so the owner surface can say what to do about
   * it; the signal itself only says "something was said and not heard".
   */
  | { readonly kind: 'audio_unheard'; readonly reason: string }
  /**
   * G2c — the buyer sent something she cannot read: a document, a video, a
   * location. Before this, each arrived as EMPTY TEXT and she answered it — a
   * reply to a PDF nobody opened. `received` says what arrived, so the owner
   * knows what to go and look at.
   */
  | { readonly kind: 'media_unreadable'; readonly received: string; readonly ref?: string }
  /**
   * G10c — she is live in pilot and this number is not on the owner's list.
   * The gate could never let a reply out, so she does not write one: the
   * message is recorded and a PERSON is told. Scores nothing — it is not a
   * problem with the buyer, only with who may be written to.
   */
  | { readonly kind: 'unlisted_number' }
  /**
   * C4.c — he answered an e-mail she wrote first. A person answers him: no model
   * runs on a stranger's first reply to a cold mail, and the follow-ups stop
   * (C4.b's `replied`). Not a problem with him — the best thing that can happen —
   * but it needs a person, which is what this list is for.
   */
  | { readonly kind: 'email_reply' }
  /**
   * 0070 — the owner stopped the assistant on every channel. It writes nothing
   * while stopped, so a person answers — and this signal is what hands the
   * conversation over, which is what keeps the buyer on "Needs you". Not a
   * problem with the buyer; only with who is answering.
   */
  | { readonly kind: 'assistant_stopped' }
  /**
   * 0071 — the ops kill switch (`global_silence`) is on. The assistant writes
   * nothing, so a person answers, and this hands the conversation over — the
   * same way the owner's Stop does, under its own name, because the owner did
   * not press anything.
   */
  | { readonly kind: 'ops_silenced' }
  /**
   * 0075 — the buyer asked for THEIR data to be deleted (core/safety/deletion.ts:
   * "delete my data", not "delete that line from the quote"). A person answers,
   * and the assistant says NOTHING — no reply, no receipt: the owner's decision
   * of 2026-09-27. Scored like a request for a person, so the turn is gated
   * before any model call; the turn then sends nothing (pipeline/turn.ts).
   */
  | { readonly kind: 'deletion_requested' }
  /**
   * 0077 — nobody could tell what this message asked, so a person answers it.
   * Two ways in: the analyser was asked whether the buyer wants a person and
   * its answer could not be read (`Analysis.wantsPerson === null`), or the
   * turn failed until the queue gave up on it (the worker's dead letter).
   * "Ambiguous means hand off": a missed request for a person loses a buyer,
   * a needless hand-off costs the owner a minute. Scored like a request for a
   * person, and the buyer is told nothing (pipeline/turn.ts) — nothing was
   * understood, so there is nothing true to say yet.
   */
  | { readonly kind: 'not_answered' }
  /**
   * K5 (0094) — "prices go to me": the business states no price, and the
   * customer asked one. The owner answers it; the assistant's hand-off says
   * only that someone will reply. Scored like a request for a person, so the
   * conversation stays with the owner until handed back.
   */
  | { readonly kind: 'price_to_owner' }
  /**
   * VAR (decision 31) — a question about stock: nothing on record knows what
   * is on the shelf, so the owner answers it; the hand-off says only that
   * someone will reply. Scored like a price that goes to the owner.
   */
  | { readonly kind: 'stock_asked' }
  /**
   * G3 (0101) — the day's allowance is used: no model is asked, so a person
   * answers, and the customer is told nothing. The path Stop takes, under its
   * own name; the allowance renews at midnight UTC.
   */
  | { readonly kind: 'allowance_used' }
  /**
   * BILL (0117) — the payment lapsed: the hold the allowance takes, under its
   * own name, until a payment goes through.
   */
  | { readonly kind: 'billing_lapsed' }
  /**
   * BILL (0117) — a new customer this month, and the plan's month already holds
   * as many as it allows: a person answers; customers already answered this
   * month are answered as before.
   */
  | { readonly kind: 'plan_limit' }
  /**
   * 0128 — the model provider refused for billing: Nomi's own account with it
   * ran out of credit. No reply could be written, so a person answers, and the
   * customer is told nothing — the path `not_answered` takes (rule 19), under
   * its own name so the owner reads the real reason. Not the owner's to pay:
   * the operator is told (src/pipeline/providerWatch.ts).
   */
  | { readonly kind: 'provider_billing' }
  // --- lead signals: the client is BUYING. These never gate anything. ---
  | { readonly kind: 'high_value'; readonly total: Money }
  | { readonly kind: 'customization_requested' }
  | { readonly kind: 'logistics_discussed' }
  | { readonly kind: 'moq_accepted' }
  | { readonly kind: 'price_acknowledged' };

export type SignalKind = Signal['kind'];

/**
 * The PROBLEM kinds, once. G2c — the inbox and Today each kept their own copy
 * of this list, and Today's had never learned 'audio_unheard': an unheard
 * voice note gated the close and was invisible on the owner's summary of why
 * she was needed. Both now read this.
 */
export const PROBLEM_SIGNAL_KINDS = [
  'human_requested',
  'complaint',
  'repeated_ambiguity',
  'low_confidence_image',
  // M34 — the machine does not know what the buyer said. Gating the close on
  // this is the whole point: an unheard question must not be answered.
  'audio_unheard',
  // G2c — nor what the buyer sent.
  'media_unreadable',
  // G10c — nor may she write to him: he is not on the owner's pilot list.
  'unlisted_number',
  // C4.c — he answered her cold e-mail, and a person answers him.
  'email_reply',
  // 0070 — the owner stopped the assistant, so a person answers.
  'assistant_stopped',
  // 0071 — sending is paused by ops, so a person answers.
  'ops_silenced',
  // 0075 — the buyer asked for their data to be deleted; a person answers.
  'deletion_requested',
  // 0077 — nobody could tell what the message asked; a person answers.
  'not_answered',
  // K5 (0094) — a price question, where prices go to the owner.
  'price_to_owner',
  // VAR (0111) — a question about stock; the owner answers it.
  'stock_asked',
  // G3 (0101) — the day's allowance is used; a person answers.
  'allowance_used',
  // BILL (0117) — the payment lapsed; a plan's month used for a new customer.
  'billing_lapsed',
  'plan_limit',
  // 0128 — the model provider refused for billing; a person answers.
  'provider_billing',
] as const satisfies readonly SignalKind[];

const PROBLEM_KINDS = new Set<SignalKind>(PROBLEM_SIGNAL_KINDS);

/**
 * One representative Signal per kind, so tests can cover the union without
 * transcribing a list that drifts. Typed as a full map, so adding a kind to
 * `Signal` without adding a sample here fails the compiler rather than
 * silently shrinking every test that iterates it.
 */
export const SIGNAL_SAMPLES: { readonly [K in SignalKind]: Extract<Signal, { kind: K }> } = {
  human_requested: { kind: 'human_requested' },
  complaint: { kind: 'complaint' },
  repeated_ambiguity: { kind: 'repeated_ambiguity', turns: 2 },
  low_confidence_image: { kind: 'low_confidence_image' },
  audio_unheard: { kind: 'audio_unheard', reason: 'transcription_failed' },
  media_unreadable: { kind: 'media_unreadable', received: 'document' },
  unlisted_number: { kind: 'unlisted_number' },
  email_reply: { kind: 'email_reply' },
  assistant_stopped: { kind: 'assistant_stopped' },
  ops_silenced: { kind: 'ops_silenced' },
  deletion_requested: { kind: 'deletion_requested' },
  not_answered: { kind: 'not_answered' },
  price_to_owner: { kind: 'price_to_owner' },
  stock_asked: { kind: 'stock_asked' },
  allowance_used: { kind: 'allowance_used' },
  billing_lapsed: { kind: 'billing_lapsed' },
  plan_limit: { kind: 'plan_limit' },
  provider_billing: { kind: 'provider_billing' },
  high_value: { kind: 'high_value', total: usd(1) },
  customization_requested: { kind: 'customization_requested' },
  logistics_discussed: { kind: 'logistics_discussed' },
  moq_accepted: { kind: 'moq_accepted' },
  price_acknowledged: { kind: 'price_acknowledged' },
};

export const isProblemSignal = (s: Signal): boolean => PROBLEM_KINDS.has(s.kind);
export const isLeadSignal = (s: Signal): boolean => !isProblemSignal(s);

/**
 * Mirrors the DB CHECK constraint on escalation_events.trigger_reason.
 *
 * A const array with the type derived FROM it, rather than a type with the
 * values transcribed into a test: a test that needs the legal set imports this
 * one, and adding a reason cannot leave a stale copy behind.
 */
export const TRIGGER_REASONS = [
  'high_value',
  'unclear_product',
  'customization',
  'complex_negotiation',
  'repeated_ambiguity',
  'client_request',
  'logistics_payment',
  'manual',
  'low_confidence_image',
  'audio_unheard',
  'media_unreadable',
  'unlisted_number',
  'email_reply',
  'assistant_stopped',
  'ops_silenced',
  'deletion_requested',
  'not_answered',
  'price_to_owner',
  'allowance_used',
  'stock_asked',
  'billing_lapsed',
  'plan_limit',
  'provider_billing',
] as const;

export type TriggerReason = typeof TRIGGER_REASONS[number];

export function toTriggerReason(s: Signal): TriggerReason {
  switch (s.kind) {
    case 'human_requested':
      return 'client_request';
    case 'complaint':
      return 'complex_negotiation';
    case 'repeated_ambiguity':
      return 'repeated_ambiguity';
    case 'low_confidence_image':
      return 'low_confidence_image';
    case 'audio_unheard':
      return 'audio_unheard';
    case 'media_unreadable':
      return 'media_unreadable';
    case 'unlisted_number':
      return 'unlisted_number';
    case 'email_reply':
      return 'email_reply';
    case 'assistant_stopped':
      return 'assistant_stopped';
    case 'ops_silenced':
      return 'ops_silenced';
    case 'deletion_requested':
      return 'deletion_requested';
    case 'not_answered':
      return 'not_answered';
    case 'price_to_owner':
      return 'price_to_owner';
    case 'stock_asked':
      return 'stock_asked';
    case 'allowance_used':
      return 'allowance_used';
    case 'billing_lapsed':
      return 'billing_lapsed';
    case 'plan_limit':
      return 'plan_limit';
    case 'provider_billing':
      return 'provider_billing';
    case 'high_value':
      return 'high_value';
    case 'customization_requested':
      return 'customization';
    case 'logistics_discussed':
      return 'logistics_payment';
    case 'moq_accepted':
    case 'price_acknowledged':
      return 'manual';
  }
}

const clamp = (n: number): number => Math.max(0, Math.min(100, n));

/**
 * CUR — what counts as a large order, written in each currency's own figures.
 * NOT a conversion: no price is ever worked out from these, and they move no
 * customer's money; they only say when an order is big enough to mark (3,000
 * dollars was the one line, and every order in rupiah would have crossed it).
 * Round figures of the same order of size, in the money a shop there counts in.
 */
export const HIGH_VALUE: Readonly<Record<Currency, { readonly large: number; readonly veryLarge: number }>> = {
  USD: { large: 3_000, veryLarge: 10_000 },
  CNY: { large: 20_000, veryLarge: 70_000 },
  AED: { large: 10_000, veryLarge: 35_000 },
  SAR: { large: 10_000, veryLarge: 35_000 },
  BRL: { large: 15_000, veryLarge: 50_000 },
  MXN: { large: 50_000, veryLarge: 175_000 },
  INR: { large: 250_000, veryLarge: 800_000 },
  IDR: { large: 50_000_000, veryLarge: 150_000_000 },
};

/**
 * Pure, total, and the ONLY place scores are produced.
 *
 * Note what does NOT appear here: any notion of "previous score". The score is a
 * function of the signals currently believed true, and nothing else.
 */
export function computeScores(signals: readonly Signal[]): Scores {
  let problem = 0;
  let lead = 0;

  for (const s of signals) {
    switch (s.kind) {
      // --- problem ---
      case 'human_requested':
        problem = 100; // absolute. Stop the AI.
        break;
      case 'deletion_requested':
        problem = 100; // absolute: only a person answers a deletion request.
        break;
      case 'not_answered':
        problem = 100; // absolute: nobody knows what it asked, so a person answers.
        break;
      case 'provider_billing':
        problem = 100; // absolute: no reply can be written, so a person answers.
        break;
      case 'price_to_owner':
        problem = 100; // absolute: her prices are hers to give.
        break;
      case 'stock_asked':
        problem = 100; // absolute: only she knows what is on the shelf.
        break;
      case 'complaint':
        problem += 40;
        break;
      case 'repeated_ambiguity':
        problem += s.turns >= 3 ? 45 : 35;
        break;
      case 'low_confidence_image':
        problem += 15;
        break;

      // --- lead: the client is buying. NEVER add these to `problem`. ---
      case 'high_value':
        lead += isAbove(s.total, { amount: HIGH_VALUE[s.total.currency].veryLarge, currency: s.total.currency }) ? 60 : 40;
        break;
      case 'customization_requested':
        lead += 30;
        break;
      case 'logistics_discussed':
        lead += 25;
        break;
      case 'moq_accepted':
        lead += 20;
        break;
      case 'price_acknowledged':
        lead += 20;
        break;
    }
  }

  return { problem: clamp(problem), lead: clamp(lead) };
}

/** Threshold at which a human must own the conversation. */
export const PROBLEM_HANDOFF_THRESHOLD = 70;

/** Threshold at which the sales team is told a deal is hot. Notifies; never gates. */
export const LEAD_HOT_THRESHOLD = 60;

export const needsHandoff = (s: Scores): boolean => s.problem >= PROBLEM_HANDOFF_THRESHOLD;
export const isHotLead = (s: Scores): boolean => s.lead >= LEAD_HOT_THRESHOLD;
