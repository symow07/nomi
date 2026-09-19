/**
 * N2a — HER OWN UNDERSTANDING of a buyer's message, by rules.
 *
 * The rules that decide a turn (`decideTurn`) use only four things from a
 * model's analysis: which product, what quantity, which stage the conversation
 * is at, and whether the message is a complaint — plus the language to answer
 * in. None of those needs a model most of the time: the product search already
 * ranks her catalogue, a quantity is a number beside a unit, a stage follows
 * from what is known, and a complaint has words.
 *
 * THIS RUNS IN SHADOW. It is computed beside the model's analysis and the two
 * are compared on the turn's row; it decides nothing. Whether any part of it
 * may replace a model call is a question for the numbers that comparison
 * produces, per field, not for anybody's confidence in a regular expression.
 *
 * `null` means "I cannot tell", and is never a guess: a wrong answer from her
 * own understanding is worse than a slow one from a model.
 *
 * Pure. No I/O, no clock, no model.
 */
import type { ConversationState, Phase } from '../types/conversation.js';
import type { Analysis } from './decide.js';
import { advance } from './phase.js';

export type OwnUnderstanding = {
  readonly language: string | null;
  readonly quantity: { readonly value: number; readonly unit: string } | null;
  readonly productId: string | null;
  /** 0..1. The rules treat 0.9 and above as "the buyer need not be asked to confirm". */
  readonly productConfidence: number;
  readonly complaint: boolean;
  readonly phase: Phase;
};

/** Just enough of a retrieved candidate: an id, how strongly it matched (0..1), and its code. */
export type Candidate = { readonly productId: string; readonly relevance: number; readonly sku?: string };

/* ── language ───────────────────────────────────────────────────────────── */

const SCRIPTS: readonly (readonly [RegExp, string])[] = [
  [/[؀-ۿ]/g, 'ar'], [/[一-鿿]/g, 'zh'], [/[Ѐ-ӿ]/g, 'ru'],
  [/[가-힯]/g, 'ko'], [/[぀-ヿ]/g, 'ja'], [/[฀-๿]/g, 'th'],
  [/[֐-׿]/g, 'he'], [/[ऀ-ॿ]/g, 'hi'],
];

/** The commonest small words of each Latin-script language a buyer here writes in. */
const STOPWORDS: Readonly<Record<string, readonly string[]>> = {
  en: ['the', 'and', 'you', 'for', 'is', 'what', 'your', 'please', 'can', 'do', 'how', 'we', 'price', 'need', 'hello', 'hi'],
  fr: ['le', 'la', 'les', 'de', 'des', 'et', 'vous', 'pour', 'est', 'bonjour', 'prix', 'combien', 'merci', 'je', 'nous', 'une'],
  es: ['el', 'los', 'las', 'de', 'y', 'para', 'es', 'hola', 'precio', 'cuanto', 'cuánto', 'gracias', 'por', 'una', 'necesito', 'que'],
  pt: ['o', 'os', 'as', 'de', 'e', 'para', 'é', 'olá', 'preço', 'quanto', 'obrigado', 'por', 'uma', 'preciso', 'você', 'não'],
  de: ['der', 'die', 'das', 'und', 'für', 'ist', 'hallo', 'preis', 'wie', 'viel', 'danke', 'ich', 'wir', 'eine', 'bitte', 'sie'],
  it: ['il', 'lo', 'gli', 'di', 'e', 'per', 'è', 'ciao', 'prezzo', 'quanto', 'grazie', 'una', 'sono', 'vorrei', 'che', 'buongiorno'],
  tr: ['ve', 'bir', 'için', 'fiyat', 'merhaba', 'kaç', 'teşekkürler', 'ne', 'bu', 'var', 'mı', 'adet'],
  id: ['dan', 'yang', 'untuk', 'harga', 'berapa', 'halo', 'terima', 'kasih', 'saya', 'ini', 'ada', 'bisa'],
};

export function detectLanguage(text: string): string | null {
  const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (letters.length === 0) return null;
  for (const [re, lang] of SCRIPTS) {
    const n = text.match(re)?.length ?? 0;
    // A third of what she wrote is in this script: that is the language, even
    // with a product code or a brand name in Latin letters beside it.
    if (n / letters.length >= 0.34) return lang;
  }
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length === 0) return null;
  let best: string | null = null, top = 0, second = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const hits = words.filter((w) => list.includes(w)).length;
    if (hits > top) { second = top; top = hits; best = lang; } else if (hits > second) second = hits;
  }
  // No small word at all, or two languages tied: she cannot tell, and says so.
  return top === 0 || top === second ? null : best;
}

/* ── quantity ───────────────────────────────────────────────────────────── */

const UNITS: readonly (readonly [RegExp, string])[] = [
  [/^(pcs?|pieces?|piece|units?|items?|pzs?|piezas?|unidades|pièces?|stück|adet|buah|个|件|只|条|قطعة|قطع|حبة|حبات|وحدة)$/i, 'pcs'],
  [/^(sets?|套|طقم)$/i, 'sets'], [/^(cartons?|ctns?|boxes|box|cajas?|箱|كرتون|كراتين|صندوق)$/i, 'cartons'],
  [/^(dozens?|dz|打|دزينة)$/i, 'dozen'], [/^(pairs?|双|زوج)$/i, 'pairs'],
  [/^(rolls?|卷)$/i, 'rolls'], [/^(meters?|metres?|m|米|متر)$/i, 'm'], [/^(kgs?|kilos?|公斤|كيلو)$/i, 'kg'],
];
/** Words that make the number beside them something other than a quantity. */
const NOT_A_QUANTITY = /^(usd|dollars?|eur|euros?|rmb|cny|yuan|元|块|aed|sar|dirhams?|mad|%|percent|cm|mm|inch(es)?|in|oz|ml|l|g|gsm|days?|weeks?|months?|年|月|天|يوم|أيام)$/i;
const CUE = /\b(qty|quantity|order|need|want|buy|purchase|looking for|require|commit|take|for)\b|需要|要|订|采购|أحتاج|أريد|نحتاج|طلب|كمية|besoin|commander|necesito|quiero|preciso/i;

/** Words that make a weight or a length a description of the goods, not an order. */
const DESCRIBES = /\b(weighs?|weight|each|per|size|long|wide|tall|thick|dimensions?)\b|重|每|尺寸|وزن|لكل|حجم|pèse|chaque|pesa|cada/i;

const toNumber = (raw: string, suffix: string | undefined): number => {
  const n = Number(raw.replace(/[,\s ]/g, ''));
  const s = (suffix ?? '').toLowerCase();
  return s === 'k' ? n * 1_000 : s === 'm' && /\d/.test(raw) && raw.length <= 3 ? n * 1_000_000 : s === '万' ? n * 10_000 : s === '千' ? n * 1_000 : n;
};

export function extractQuantity(text: string): { value: number; unit: string } | null {
  // A number, an optional k/万 multiplier, and the word after it. `k` multiplies
  // only when it stands alone: the k of "kg" and "kilos" does not.
  const re = /(?<![\w.$€¥£])(\d{1,3}(?:[,\s ]\d{3})+|\d+(?:\.\d+)?)\s*(k(?!\p{L})|万|千)?\s*([\p{L}%]+)?/giu;
  const plain: number[] = [];
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 2), m.index ?? 0);
    if (/[$€¥£]\s?$/.test(before)) continue;                 // a price
    const word = m[3] ?? '';
    if (word && NOT_A_QUANTITY.test(word)) continue;          // a price, a size, a duration
    if (/^x$/i.test(word) || /x\s*$/i.test(before)) continue; // 38 x 40: a dimension
    const value = toNumber(m[1]!, m[2]);
    if (!Number.isFinite(value) || value < 1 || !Number.isInteger(value)) continue;
    // Chinese writes no space after the counter ("5000个袋子"), so its first character is tried too.
    const unit = (UNITS.find(([u]) => u.test(word))
      ?? (/^[\u4e00-\u9fff]/.test(word) ? UNITS.find(([u]) => u.test(word[0]!)) : undefined))?.[1];
    // A weight or a length is a quantity only when she is ASKING for it: "I need
    // 5 kilos" orders, "each one weighs 5 kg" describes.
    if (unit && (unit === 'kg' || unit === 'm') && (!CUE.test(text) || DESCRIBES.test(text))) continue;
    if (unit) return { value, unit };                         // a number beside a unit is a quantity
    plain.push(value);
  }
  // No unit anywhere: only a single bare number, and only when she said she
  // wants something. "Room 12" and "model 300" are not orders.
  return plain.length === 1 && plain[0]! >= 2 && CUE.test(text) ? { value: plain[0]!, unit: 'pcs' } : null;
}

/* ── complaint ──────────────────────────────────────────────────────────── */

const COMPLAINT = new RegExp([
  'complain', 'refund', 'damaged', 'broken', 'defect', 'faulty', 'wrong (item|product|order|colou?r|size)',
  'never (arrived|received|came)', 'not (arrived|received|working)', 'poor quality', 'bad quality', 'terrible', 'scam',
  'unacceptable', 'disappointed', 'where is my money', 'money back',
  '投诉', '退款', '退货', '坏了', '破损', '质量问题', '质量太差', '发错', '没收到', '骗',
  'شكوى', 'استرجاع', 'استرداد', 'تالف', 'مكسور', 'معيب', 'لم يصل', 'لم تصل', 'جودة سيئة', 'نصب',
  'remboursement', 'cassé', 'endommagé', 'défectueux', 'jamais reçu', 'plainte', 'arnaque',
  'reembolso', 'dañado', 'roto', 'defectuoso', 'nunca llegó', 'queja', 'estafa',
].join('|'), 'i');

/**
 * "What happens IF the goods arrive damaged?" asks about a policy; it is not a
 * complaint, and treating it as one would hand a good lead to a person for
 * nothing. A question about a case that has not happened is not a grievance.
 */
const HYPOTHETICAL = /\b(if|in case|what happens|what if|suppose|would you|do you|policy|guarantee|warranty)\b|如果|万一|要是|إذا|لو |في حال|\bsi\b|au cas où|en caso/i;

export const soundsLikeComplaint = (text: string): boolean => COMPLAINT.test(text) && !HYPOTHETICAL.test(text);

/* ── product and stage ──────────────────────────────────────────────────── */

/** How strongly the best match must lead before she calls it the product. */
export const PRODUCT_MIN_RELEVANCE = 0.45;
export const PRODUCT_MIN_LEAD = 0.1;

/** "I think", "maybe", "something like": she names a product and is not sure of it. */
const HEDGE = /\b(i think|maybe|perhaps|not sure|something like|similar to|kind of|probably|i guess)\b|好像|大概|可能|也许|ربما|أظن|تقريبا|peut-être|je crois|quizás|creo que/i;
/** Sure enough that the buyer need not be asked — the rules' own threshold. */
export const SURE = 0.9;

export function pickProduct(
  text: string, candidates: readonly Candidate[], state: ConversationState,
): { readonly productId: string | null; readonly confidence: number } {
  const sorted = [...candidates].sort((a, b) => b.relevance - a.relevance);
  const [first, second] = sorted;
  if (first && first.relevance >= PRODUCT_MIN_RELEVANCE && first.relevance - (second?.relevance ?? 0) >= PRODUCT_MIN_LEAD) {
    // Her own product code, typed out, is as sure as a buyer gets. Otherwise a
    // search score is never "sure" on its own: a buyer is asked to confirm.
    const namedByCode = first.sku !== undefined && first.sku.length >= 3
      && text.toLowerCase().includes(first.sku.toLowerCase());
    const confidence = namedByCode ? 0.97 : Math.min(first.relevance, 0.85) - (HEDGE.test(text) ? 0.25 : 0);
    return { productId: first.productId, confidence: Math.max(0, confidence) };
  }
  // Nothing in this message names a product clearly: the conversation's own
  // product stands, which is what a buyer saying "and for 5,000?" means.
  return state.product
    ? { productId: state.product.productId, confidence: state.product.confidence }
    : { productId: null, confidence: 0 };
}

const GREETING_ONLY = /^\s*(hi+|hello+|hey+|good (morning|afternoon|evening)|salam|السلام عليكم|مرحبا|اهلا|أهلا|你好|您好|在吗|bonjour|salut|hola|buenas|olá|ciao|hallo|merhaba)[\s!.,?؟。！]*$/i;

/**
 * The stage that follows from what is known — the ladder the model is told to
 * use. A bare greeting is the only thing that leaves a conversation at the
 * door; anything else she said is something to clarify.
 */
export function stageFor(known: {
  readonly greetingOnly: boolean; readonly product: boolean; readonly sure: boolean; readonly quantity: boolean;
}): Phase {
  if (!known.product) return known.greetingOnly ? 'warm_intake' : 'clarification';
  if (!known.sure) return 'clarification';
  return known.quantity ? 'commercial_discussion' : 'qualification';
}

export function understand(input: {
  readonly text: string; readonly state: ConversationState; readonly candidates: readonly Candidate[];
}): OwnUnderstanding {
  const picked = pickProduct(input.text, input.candidates, input.state);
  const quantity = extractQuantity(input.text) ?? null;
  const confirmedBefore = input.state.product?.confirmedByClient === true
    && input.state.product.productId === picked.productId;
  return {
    language: detectLanguage(input.text),
    quantity,
    productId: picked.productId,
    productConfidence: picked.confidence,
    complaint: soundsLikeComplaint(input.text),
    phase: stageFor({
      greetingOnly: GREETING_ONLY.test(input.text),
      product: picked.productId !== null,
      sure: confirmedBefore || picked.confidence >= SURE,
      quantity: quantity !== null || input.state.quantity !== null,
    }),
  };
}

/* ── the comparison ─────────────────────────────────────────────────────── */

export type Agreement = {
  /** `null`: she could not tell, which is not a disagreement. */
  readonly language: boolean | null;
  readonly quantity: boolean; readonly product: boolean; readonly complaint: boolean; readonly phase: boolean;
};

export function compareWithModel(own: OwnUnderstanding, model: Analysis, state: ConversationState): Agreement {
  const base = (l: string) => l.toLowerCase().split(/[-_]/)[0]!;
  return {
    language: own.language === null ? null : base(own.language) === base(model.language.detected),
    // As the rules use it: what was said now, else what the conversation already holds.
    quantity: (own.quantity?.value ?? state.quantity?.value ?? null)
      === (model.intent.quantityMentioned?.value ?? state.quantity?.value ?? null),
    product: own.productId === (model.intent.productCandidate?.productId ?? state.product?.productId ?? null),
    complaint: own.complaint === (model.intent.primary === 'complaint'),
    // Compared as the rules would apply them: a stage only ever moves forward.
    phase: advance(state.phase, own.phase) === advance(state.phase, model.recommendedPhase),
  };
}

export const agreesOnEverything = (a: Agreement): boolean =>
  a.language !== false && a.quantity && a.product && a.complaint && a.phase;
