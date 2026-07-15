import type { ConversationState, PendingQuestion, Phase } from '../types/conversation.js';

/**
 * The zero-AI-call fast path.
 *
 * When we have asked the client a yes/no question (pendingQuestion is set) and
 * they answer with a bare yes or no, no model needs to run: the reply is a
 * template and the state change is mechanical. This is both a latency win
 * (<1s target for TC-class inputs) and a cost win (0 tokens).
 *
 * HISTORY: in the n8n system this path existed but was UNREACHABLE — nothing
 * ever wrote pending_question, so the detector never fired, so
 * product_confirmed_by_client could never become true, so no order could ever
 * be confirmed. See docs/adr/0003. The reply engine now records what it asked
 * (pendingQuestion) and this module consumes it.
 */

const YES = new Set([
  'yes', 'yeah', 'yep', 'correct', 'right', 'exactly', 'sure', 'ok', 'okay',
  'confirm', 'confirmed', 'agreed',
  'نعم', 'صح',            // Arabic
  '是', '对', '好',        // Chinese
  'sí', 'si',              // Spanish
  'oui',                   // French
  'да',                    // Russian
]);

const NO = new Set([
  'no', 'nope', 'not', 'wrong', 'incorrect', 'different', 'other',
  'لا',                    // Arabic
  '不是',                  // Chinese
  'non',                   // French
  'нет',                   // Russian
]);

export type FastPathType =
  | 'product_confirmed_yes'
  | 'product_confirmed_no'
  | 'order_confirm_yes';

export type FastPathResult =
  | { readonly matched: false }
  | {
      readonly matched: true;
      readonly type: FastPathType;
      readonly reply: string;
      readonly phaseTarget: Phase | null;
      readonly stateChanges: {
        readonly productConfirmedByClient?: boolean;
        readonly clearIdentifiedProduct?: boolean;
        readonly pendingQuestion: PendingQuestion | null; // always resolved
      };
      readonly triggerOrderConfirmation: boolean;
    };

/** Language-keyed reply templates. Deterministic data, not generation. */
const REPLIES: Record<FastPathType, Record<string, string>> = {
  product_confirmed_yes: {
    en: "Great — glad we're on the same page. Now, roughly how many pieces are you looking at?",
    ar: 'ممتاز، نعم هذا هو المنتج. كم قطعة تقريباً تحتاج؟',
    zh: '好的，就是这个产品。您大概需要多少件？',
    es: 'Perfecto. ¿Aproximadamente cuántas piezas necesitas?',
  },
  product_confirmed_no: {
    en: "No problem — could you describe what you're looking for in more detail, or send another photo?",
    ar: 'لا مشكلة، هل يمكنك وصف المنتج بشكل أدق أو إرسال صورة أخرى؟',
    zh: '没关系，能再描述一下您需要的产品，或者发一张其他的图片吗？',
    es: 'Sin problema — ¿puedes describir lo que buscas con más detalle o enviar otra foto?',
  },
  order_confirm_yes: {
    en: "Perfect — I'll get your confirmation sent right away.",
    ar: 'ممتاز، سأرسل لك تأكيد الطلب فوراً.',
    zh: '好的，我马上发送确认信息给您。',
    es: 'Perfecto — te envío la confirmación ahora mismo.',
  },
};

function replyFor(type: FastPathType, language: string | null): string {
  const map = REPLIES[type];
  return map[language ?? 'en'] ?? map['en'] ?? 'Got it — thank you.';
}

export function detectFastPath(text: string, state: ConversationState): FastPathResult {
  const t = (text ?? '').toLowerCase().trim();
  const pending = state.pendingQuestion;
  const lang = state.preferredLanguage;

  // Only single-token answers qualify. "yes I want 500 of them" carries new
  // information and must go through full analysis.
  if (pending === 'product_confirmation') {
    if (YES.has(t)) {
      return {
        matched: true,
        type: 'product_confirmed_yes',
        reply: replyFor('product_confirmed_yes', lang),
        phaseTarget: 'qualification',
        stateChanges: { productConfirmedByClient: true, pendingQuestion: null },
        triggerOrderConfirmation: false,
      };
    }
    if (NO.has(t)) {
      return {
        matched: true,
        type: 'product_confirmed_no',
        reply: replyFor('product_confirmed_no', lang),
        phaseTarget: null,
        stateChanges: {
          productConfirmedByClient: false,
          clearIdentifiedProduct: true,
          pendingQuestion: null,
        },
        triggerOrderConfirmation: false,
      };
    }
  }

  if (pending === 'order_confirmation' && YES.has(t)) {
    return {
      matched: true,
      type: 'order_confirm_yes',
      reply: replyFor('order_confirm_yes', lang),
      phaseTarget: 'confirmation',
      stateChanges: { pendingQuestion: null },
      triggerOrderConfirmation: true,
    };
  }

  return { matched: false };
}
