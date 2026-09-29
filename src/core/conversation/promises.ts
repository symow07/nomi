import { asciiDigits } from '../safety/numerals.js';

/**
 * WHAT A REPLY PROMISED, AND FOR WHEN (the design pass, decided 2026-09-29:
 * the calendar's dates from conversations — "a follow-up that was promised,
 * the day a price ends, an agreed delivery date", the promised follow-up
 * first).
 *
 * Read from the words of a reply THAT WAS SENT, by rules, not by a model: the
 * sentence is the promise, and what reached the customer is what was said.
 * One date per sentence, and only a DAY the words name — today, tomorrow, a
 * weekday, a date, "in 3 days". A span ("next week", "soon", "in a while") is
 * not a day, and nothing here guesses one. A question is not a promise; a
 * sentence that says it cannot is not one either.
 *
 *   follow_up — the seller will get back: reply, confirm, check, send word;
 *   price_end — a price holds until a day;
 *   delivery  — goods ship or arrive by a day.
 *
 * Every rule is held both ways in `tests/parity/promised-dates.test.ts` — what
 * it must find and the ordinary sentences it must leave alone. A new phrasing
 * goes there with its reason, never into these patterns alone.
 *
 * Pure per ADR-0002: the text and the day it was sent (the business's day,
 * 'YYYY-MM-DD') in, the promises out.
 */

export type PromiseKind = 'follow_up' | 'price_end' | 'delivery';
export type PromisedDate = { readonly kind: PromiseKind; readonly day: string; readonly said: string };

/* ── days ─────────────────────────────────────────────────────────────────── */

/** The instant a 'YYYY-MM-DD' day starts, in UTC — days are counted, never read from a clock. */
const utc = (ymd: string): number => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
const addDays = (ymd: string, n: number): string => new Date(utc(ymd) + n * 86_400_000).toISOString().slice(0, 10);
/** 0 = Sunday … 6 = Saturday. */
const dow = (ymd: string): number => new Date(utc(ymd)).getUTCDay();
/** The next day that is this weekday, strictly after `from` (a promise for "Friday" said on a Friday is next week's). */
const nextWeekday = (from: string, target: number): string => addDays(from, ((target - dow(from) + 7) % 7) || 7);
/** N working days on (Monday to Friday). */
const addWorkingDays = (from: string, n: number): string => {
  let d = from;
  for (let left = n; left > 0;) {
    d = addDays(d, 1);
    if (dow(d) !== 0 && dow(d) !== 6) left--;
  }
  return d;
};
/** A month and a day, in the year that puts it on or after the day it was said. */
const onDate = (from: string, month: number, day: number): string | null => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = Number(from.slice(0, 4));
  for (const y of [year, year + 1]) {
    const ymd = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (addDays(ymd, 0) !== ymd) return null;   // 30 February
    if (ymd >= from) return ymd;
  }
  return null;
};
/** The day-of-month in this month, or in the next when it has passed. */
const onMonthDay = (from: string, day: number): string | null => {
  const y = Number(from.slice(0, 4));
  const m = Number(from.slice(5, 7));
  for (const [yy, mm] of [[y, m], m === 12 ? [y + 1, 1] : [y, m + 1]] as const) {
    const ymd = `${yy}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (addDays(ymd, 0) === ymd && ymd >= from) return ymd;
  }
  return null;
};

/** A word boundary that knows accented letters (JavaScript's \b does not). */
const W = 'a-zà-ÿñ';

const WEEKDAYS: readonly (readonly [RegExp, number])[] = [
  [/\bmonday\b|周一|星期一|礼拜一|الاثنين|الإثنين|\blunes\b|\blundi\b/, 1],
  [/\btuesday\b|周二|星期二|礼拜二|الثلاثاء|\bmartes\b|\bmardi\b/, 2],
  [/\bwednesday\b|周三|星期三|礼拜三|الأربعاء|الاربعاء|\bmi[ée]rcoles\b|\bmercredi\b/, 3],
  [/\bthursday\b|周四|星期四|礼拜四|الخميس|\bjueves\b|\bjeudi\b/, 4],
  [/\bfriday\b|周五|星期五|礼拜五|الجمعة|\bviernes\b|\bvendredi\b/, 5],
  [/\bsaturday\b|周六|星期六|礼拜六|السبت|\bs[áa]bado\b|\bsamedi\b/, 6],
  [/\bsunday\b|周日|周天|星期日|星期天|礼拜天|الأحد|الاحد|\bdomingo\b|\bdimanche\b/, 0],
];
const MONTHS: readonly (readonly [RegExp, number])[] = [
  [/\bjan(?:uary)?\b|يناير|كانون الثاني|\benero\b|\bjanvier\b/, 1], [/\bfeb(?:ruary)?\b|فبراير|شباط|\bfebrero\b|\bf[ée]vrier\b/, 2],
  [/\bmar(?:ch)?\b|مارس|آذار|\bmarzo\b|\bmars\b/, 3], [/\bapr(?:il)?\b|أبريل|ابريل|نيسان|\babril\b|\bavril\b/, 4],
  [/\bmay\b|مايو|أيار|\bmayo\b|\bmai\b/, 5], [/\bjun(?:e)?\b|يونيو|حزيران|\bjunio\b|\bjuin\b/, 6],
  [/\bjul(?:y)?\b|يوليو|تموز|\bjulio\b|\bjuillet\b/, 7], [/\baug(?:ust)?\b|أغسطس|اغسطس|آب|\bagosto\b|\bao[uû]t\b/, 8],
  [/\bsep(?:t|tember)?\b|سبتمبر|أيلول|\bse?ptiembre\b|\bseptembre\b/, 9], [/\boct(?:ober)?\b|أكتوبر|اكتوبر|تشرين الأول|\boctubre\b|\boctobre\b/, 10],
  [/\bnov(?:ember)?\b|نوفمبر|تشرين الثاني|\bnoviembre\b|\bnovembre\b/, 11], [/\bdec(?:ember)?\b|ديسمبر|كانون الأول|\bdiciembre\b|\bd[ée]cembre\b/, 12],
];
const ZH_WEEKDAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

/** The one day a sentence names, or null. `s` is lower-cased, NFKC, with ASCII digits. */
function dayIn(s: string, from: string): string | null {
  // A span is not a day: "next week", "soon", "in a few days" name none, and are left alone.
  let m: RegExpExecArray | null;
  if (/\bday after tomorrow\b|后天|بعد غد|pasado mañana|apr[èe]s-demain/.test(s)) return addDays(from, 2);
  if (/\btomorrow\b|明天|明日|明早|明晚|غد[اًٌ]?|بكرة|(?<!la |por la |esta |de la )\bmañana\b|\bdemain\b/.test(s)) return addDays(from, 1);
  if (/\btoday\b|\btonight\b|\bthis (?:afternoon|evening)\b|\blater today\b|今天|今晚|今日|اليوم|الليلة|\bhoy\b|esta (?:tarde|noche)|aujourd'?hui|aujourd’hui|\bce soir\b|\bcet après-midi\b/.test(s)) return from;
  if ((m = /(?:in|within) (\d{1,2}) (?:working|business) days?|(\d{1,2}) (?:个)?工作日|خلال (\d{1,2}) أيام عمل|en (\d{1,2}) d[ií]as h[áa]biles|(?:dans|sous) (\d{1,2}) jours ouvr[ée]s/.exec(s))) {
    const n = Number(m.slice(1).find(Boolean));
    return n >= 1 && n <= 30 ? addWorkingDays(from, n) : null;
  }
  if ((m = /(?:in|within) (\d{1,2}) days?\b|(\d{1,2}) ?天(?:内|后|之内|以内)|(?:خلال|بعد) (\d{1,2}) (?:أيام|يوم|يومًا|يوما)|en (\d{1,2}) d[ií]as|(?:dans|sous) (\d{1,2}) jours/.exec(s))) {
    const n = Number(m.slice(1).find(Boolean));
    return n >= 1 && n <= 60 ? addDays(from, n) : null;
  }
  if ((m = /(\d{1,2}) ?月 ?(\d{1,2}) ?[日号]/.exec(s))) return onDate(from, Number(m[1]), Number(m[2]));
  if ((m = /(?:下|下个)(?:周|星期|礼拜)([一二三四五六日天])/.exec(s))) {
    const target = ZH_WEEKDAY[m[1]!]!;
    const monday = addDays(from, -((dow(from) + 6) % 7));
    return addDays(monday, 7 + ((target + 6) % 7));
  }
  if ((m = /(?:这|本|这个)?(?:周|星期|礼拜)([一二三四五六日天])/.exec(s))) return nextWeekday(from, ZH_WEEKDAY[m[1]!]!);
  for (const [re, month] of MONTHS) {
    const at = re.exec(s);
    if (!at) continue;
    const before = s.slice(Math.max(0, at.index - 12), at.index);
    const after = s.slice(at.index + at[0].length, at.index + at[0].length + 12);
    const d = /(\d{1,2})(?:st|nd|rd|th|er)?(?: de)?\s*$/.exec(before)?.[1] ?? /^\s*(?:the )?(\d{1,2})(?:st|nd|rd|th)?\b/.exec(after)?.[1];
    if (d) return onDate(from, month, Number(d));
  }
  if ((m = /\bby the (\d{1,2})(?:st|nd|rd|th)\b|\bon the (\d{1,2})(?:st|nd|rd|th)\b/.exec(s))) return onMonthDay(from, Number(m[1] ?? m[2]));
  for (const [re, weekday] of WEEKDAYS) if (re.test(s)) return nextWeekday(from, weekday);
  return null;
}

/* ── what the sentence commits to ─────────────────────────────────────────── */

const QUESTION = /[?？؟]\s*$|^¿/;
const NEGATED = /\b(?:can't|cannot|can not|won't|will not|not able|unable|don't|do not|no longer)\b|不能|无法|没法|不会|暂时不|لن |لا أستطيع|لا يمكن|\bno (?:puedo|podemos|podr[ée]|vamos|voy|te|le)\b|\bne (?:peux|pourrai|pourrons|vais|allons)\b|\bpas possible\b/;

const PRICE_END = /\b(?:valid|good|holds?|stands?|available)\b[^.]{0,40}\b(?:until|till|through|to|by)\b|\bvalid for\b|\bexpires?\b|\boffer ends\b|有效期|有效至|有效到|截止到|截至|صالح(?:ة)? حتى|سار(?:ٍ|ي)(?:ة)? حتى|ينتهي العرض|\bv[áa]lid[oa]s? hasta\b|\bvigente hasta\b|\bvence\b|\bvalable jusqu|\bvalide jusqu|\bexpire\b/;
const DELIVERY = /\b(?:ship|ships|shipped|shipping|deliver|delivers|delivered|delivery|dispatch|dispatched|arrive|arrives|reach you)\b|发货|发出|交货|到货|送到|出货|寄出|الشحن|نشحن|سنشحن|التسليم|سنسلم|سيصل|توصيل|\benv[ií]o\b|\benviamos\b|\benviaremos\b|\bentrega\b|\bentregamos\b|\bllegar[áa]\b|\bdespach|\blivr|\bexp[ée]di|\barriver/;
/** The seller commits to something — first person, going to do it. */
const AR_VERBS = '(?:رد|ؤكد|رسل|بلغ|تواصل|خبر|عود|تحقق|شحن|سلم)';
const ES_FUTURE = '(?:confirmar|escribir|responder|avisar|enviar|mandar|llamar|contestar|revisar|volver|entregar|despachar)(?:é|emos)|dir(?:é|emos)';
const FR_FUTURE = '(?:confirmer|répondr|écrir|enverr|rappeller|reviendr|recontacter|vérifier|tiendr|livrer|expédier)(?:ai|ons)';
const COMMIT = new RegExp([
  "\\b(?:i|we)(?:'ll|’ll| will| shall| am going to| are going to| can| should)\\b", '\\blet me\\b', "\\bwe'?re (?:shipping|sending)\\b",
  // "We … <a day> …" is how a Chinese seller commits: 我们下周三发货, 我明天回复.
  '我们?(?:会|将|再|就|可以|明天|今天|后天|下周|下星期|这周|本周|周|星期|\\d)', '(?:给您|给你|跟您|跟你|向您)',
  `(?:سأ|سن)${AR_VERBS}`, 'سوف',
  `(?<![${W}])(?:voy|vamos) a(?![${W}])`, `(?<![${W}])(?:te|le|les|os) (?:confirmo|escribo|respondo|aviso|env[ií]o|mando|llamo|contesto|digo)(?![${W}])`,
  `(?<![${W}])(?:${ES_FUTURE})(?![${W}])`,
  `(?<![${W}])(?:je|nous) (?:vous |te )?(?:confirme|réponds|écris|recontacte|envoie|rappelle|reviens|tiens)(?![${W}])`,
  `(?<![${W}])(?:je vais|nous allons)(?![${W}])`, `(?<![${W}])(?:${FR_FUTURE})(?![${W}])`,
].join('|'));
/** …to get back: reply, confirm, check, send word. */
const GET_BACK = new RegExp([
  '\\b(?:get back|reply|respond|answer|write|confirm|check|let you know|update you|send|call|follow up|revert|come back|message|contact|share|tell you)\\b',
  '回复|答复|确认|告诉|告知|联系|跟进|发给|发您|发你|回您|回你|通知|查一下|查好',
  `(?:أ|ن|سأ|سن)${AR_VERBS}`,
  `(?<![${W}])(?:confirm|escrib|respond|avis|env[ií]|mand|llam|contest|revis|volv|dig|comunic)[${W}]*`,
  `(?<![${W}])(?:confirm|r[ée]pond|[ée]cri|recontact|envo|enver|rappel|reviend|revien|v[ée]rifi|tien)[${W}]*`,
].join('|'));

function kindOf(s: string): PromiseKind | null {
  if (PRICE_END.test(s)) return 'price_end';
  if (DELIVERY.test(s) && COMMIT.test(s)) return 'delivery';
  if (/\b(?:delivery|ship(?:ping)?|dispatch)\s+(?:on|by|date)\b|交货期|发货日期|موعد التسليم|fecha de entrega|date de livraison/.test(s)) return 'delivery';
  if (COMMIT.test(s) && GET_BACK.test(s)) return 'follow_up';
  return null;
}

/** Every promise in a reply, with the sentence it was said in (as sent). */
export function readPromises(text: string, sentDay: string): readonly PromisedDate[] {
  const out: PromisedDate[] = [];
  const sentences = text.split(/(?<=[.!?。！？؟])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  for (const said of sentences) {
    const s = asciiDigits(said.normalize('NFKC')).toLowerCase().replace(/[ً-ْ]/g, '');
    if (QUESTION.test(s) || NEGATED.test(s)) continue;
    const kind = kindOf(s);
    if (!kind) continue;
    const day = dayIn(s, sentDay);
    if (!day || day < sentDay) continue;
    if (!out.some((p) => p.kind === kind && p.day === day)) out.push({ kind, day, said: Array.from(said).slice(0, 300).join('') });
  }
  return out;
}
