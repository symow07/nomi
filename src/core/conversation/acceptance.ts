import { normalizeForDeletion } from '../safety/deletion.js';

/**
 * A "YES" THE LIST DID NOT KNOW GOES TO THE OWNER (the owner, 2026-10-14, the language sweep's finding 1).
 *
 * The fast path (`fastpath.ts`) confirms an order only on a word it has: English "yes" did, Chinese «好的» and
 * Arabic «تمام» did not, and a buyer who had just said yes was quoted the price AGAIN, alone. The owner: "A word list
 * can never be complete across five languages… make the list stop being load-bearing. Fail toward me, not toward a
 * wrong reply." So, after a price was given, a reply that could be a yes and is not on the list is handed to the
 * owner as "this may be a confirmation" (`maybe_confirmation`, src/pipeline/turn.ts) — never answered with the price.
 *
 * Two readings, both deliberately wide:
 *  · `soundsLikeYes` — the words people accept with, anywhere in a short message, in the five languages the product
 *    writes and the dialects its buyers use («好的», «就这么定了», «تمام كذا», "sounds great", «vale», «ça marche»);
 *  · `asksOrHolds` — what makes it NOT a yes yet: a question, a no, a hesitation or a condition ("too expensive",
 *    «太贵», «لكن», «mais»). Those are answered as before: a buyer asking something gets an answer.
 *
 * Wide on purpose, and safe to be: what it catches is shown to the owner, who confirms or answers; nothing it says
 * yes to is sent. tests/parity/order-yes.test.ts holds both lists, each language.
 *
 * Pure.
 */

/** Lower case, NFKC, Arabic diacritics and alef forms folded (the deletion check's reading), «ى ی» as «ي». */
const read = (text: string): string => normalizeForDeletion(text).replace(/[یى]/g, 'ي').replace(/ک/g, 'ك');

/** Latin and Arabic words need their edges; Chinese has none to need. */
const LATIN = String.raw`a-z0-9à-ÿ`;
const AR = String.raw`\u0621-\u064A`;
const words = (xs: readonly string[], letters: string): RegExp =>
  new RegExp(`(?<![${letters}])(?:${xs.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, String.raw`\s+`)).join('|')})(?![${letters}])`, 'u');

const YES_LATIN = words([
  // English
  'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'sure', 'fine', 'good', 'great', 'perfect', 'deal', 'agreed', 'agree',
  'confirm', 'confirmed', 'go ahead', 'proceed', 'sounds good', "let's do it", 'lets do it', "let's go", 'lets go',
  'go with', 'book it', 'done', 'alright', 'all right', 'works for me',
  // Spanish, French, Portuguese
  'sí', 'si', 'vale', 'de acuerdo', 'perfecto', 'listo', 'adelante', 'confirmo',
  'oui', "d'accord", 'parfait', 'ça marche', 'ca marche', 'je confirme', 'allez-y',
  'sim', 'combinado', 'fechado', 'perfeito', 'pode ser',
], LATIN);
const YES_AR = words(['نعم', 'ايوه', 'ايوا', 'تمام', 'موافق', 'موافقه', 'موافقة', 'اكيد', 'طيب', 'ماشي', 'حسنا', 'اتفقنا',
  'خلاص', 'اكد', 'اكدوا', 'يلا', 'اوكي', 'اوك'], AR);
const YES_ZH = /好|行|可以|是的|对|确认|没问题|就这样|定了|成交|同意|嗯|下单|就要|要了/u;
const YES_EMOJI = /\u{1F44D}|\u{1F44C}|\u{2705}|\u{1F91D}/u;   // thumbs up, OK hand, check mark, handshake

/** A greeting is not a yes: «你好» has «好» in it. */
const GREETING_ZH = /你好|您好|大家好/gu;
/** Ways of saying yes that hold a "no": "no problem", «没问题», «لا مشكلة», «pas de souci». Read before the noes. */
const NO_PROBLEM = new RegExp([
  'no problem', 'no worries', 'not bad', 'no hay problema', 'sin problema', 'pas de probl[eè]me', 'pas de souci',
  'sem problema', 'n[aã]o tem problema', 'لا مشكله', 'لا مشكلة', 'ولا يهمك', '没问题', '不错',
].join('|'), 'gu');

const NOT_YET_LATIN = words([
  'no', 'nope', 'not', "don't", 'dont', "won't", 'wont', "can't", 'cant', 'but', 'however', 'though', 'expensive',
  'cheaper', 'discount', 'lower', 'wait', 'hold on', 'later', 'think', 'maybe', 'if', 'unless', 'instead', 'cancel',
  'stop',
  'pero', 'caro', 'descuento', 'espera', 'después', 'despues', 'cancelar',
  'non', 'pas', 'mais', 'cher', 'remise', 'attendez', 'plus tard', 'annuler',
  'não', 'nao', 'mas', 'desconto', 'depois', 'cancelar',
], LATIN);
const NOT_YET_AR = words(['لا', 'ليس', 'مش', 'مو', 'لكن', 'غالي', 'غاليه', 'غالية', 'خصم', 'ارخص', 'انتظر', 'لاحقا', 'بعدين',
  'افكر', 'اذا', 'الغاء', 'الغي'], AR);
const NOT_YET_ZH = /不|没|别|但|不过|贵|便宜|等等|再说|考虑|想想|取消|吗|呢/u;   // not «么»: «这么», «那么» are no question
/** Every way a message asks. */
const QUESTION = /[?？؟¿]/u;

/** Asks, refuses, hesitates or sets a condition: answered as before, never handed over as a yes. */
export function asksOrHolds(text: string): boolean {
  const t = read(text);
  if (QUESTION.test(t)) return true;
  const rest = t.replace(NO_PROBLEM, ' ');
  return NOT_YET_LATIN.test(rest) || NOT_YET_AR.test(rest) || NOT_YET_ZH.test(rest.replace(GREETING_ZH, ''));
}

/** The longest message read as a yes: a long one is about something else (the analysis still reads it). */
const MAX_WORDS = 15;
const MAX_HAN = 40;

/** The words that sound like a yes, or null. Never a message that asks or holds (`asksOrHolds`). */
export function soundsLikeYes(text: string): string | null {
  if (asksOrHolds(text)) return null;
  const t = read(text);
  const han = (t.match(/\p{Script=Han}/gu) ?? []).length;
  if (han > MAX_HAN || t.split(/\s+/).filter(Boolean).length > MAX_WORDS) return null;
  const zh = t.replace(GREETING_ZH, '');
  return (t.match(NO_PROBLEM) ?? t.match(YES_LATIN) ?? t.match(YES_AR) ?? zh.match(YES_ZH) ?? t.match(YES_EMOJI))?.[0] ?? null;
}

/**
 * The whole numbers a message says ("ok, 5000 again please" → [5000]; «好的，5,000个» → [5000]; «٥٠٠٠» → [5000]),
 * for the owner's card: a maybe-yes that names another quantity than the price on record is shown as a mismatch.
 * Decimals are prices, not quantities, and are left out.
 */
export function quantitiesSaid(text: string): number[] {
  const t = text.normalize('NFKC').replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/(\d)[,，](?=\d{3}\b)/g, '$1');
  return [...t.matchAll(/(?<![\d.])\d+(?![\d.])/g)].map((m) => Number(m[0])).filter((n) => n >= 2);
}
