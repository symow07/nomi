import { normalizeForDeletion } from './deletion.js';

/**
 * RULE 6 ON THE SEND PATH — A REPLY ADDRESSES THE BUYER IN NEITHER GENDER
 * (2026-10-14, the owner: "fix it before Arabic sends anything to a real
 * buyer, not after").
 *
 * Nomi does not know whether the buyer is a man or a woman, so its Arabic must
 * not decide. The fixed sentences already say nothing of it; the writer did,
 * live: «هل تبحث عن مقاس معين؟» ("are you [a man] looking for a size?").
 * `prompts/response.txt` tells the writer how to write instead (a noun phrase,
 * the passive, «يمكن / يُرجى»); this is the same rule where it cannot be talked
 * out of. A reply it catches is written again, and a second miss goes to a
 * person, like every other guard in the writer's chain (`src/pipeline/turn.ts`).
 *
 * WHAT IS CAUGHT — the singular second person, either gender:
 *  · a verb whose subject, in a reply, can only be the buyer: «تريد / تريدين»,
 *    «تبحث», «تود», «ترغب», «تقصد», «تنوي», «تخطط», «تفكر», «تتردد», «تقلق»;
 *  · a verb a thing can also be the subject of («تحتاج» — an order may need a
 *    week), only where the buyer is: after «هل», «كم», «ماذا», «إذا كنت», «أنت»,
 *    after «يمكنك أن» (any verb), and «التي تحتاجها» with no subject after it;
 *  · "you tell me", "you send us": «تخبرني», «تزودنا», «ترسل لي»;
 *  · imperatives: «أخبرني / أخبريني», «اختر / اختاري», «دعني», «تواصل معنا»,
 *    «تفضل» opening a sentence; "tell us" («أخبرنا») only with what to tell —
 *    alone it is also "we told";
 *  · words of address: «عزيزي / عزيزتي», «سيدي / سيدتي», «أخي», «أستاذ»;
 *  · an adjective after «أنت» / «كنت»: «هل أنت مهتم», «إذا كنت مستعدًا»;
 *  · «أنتَ / أنتِ», «كنتَ / كنتِ» and «ـكَ / ـكِ» written WITH their vowel. The
 *    unvowelled «ـك» is how the house rule addresses anybody, and stays;
 *  · DIALECT (seen live 2026-10-14: the writer answers a dialect in kind, and
 *    there almost every way of addressing someone has a gender): «تحب تشوف»,
 *    «كنت بتفكر», «تبي», «تقولي», «محتاج», the feminine «ـكي»;
 *  · the assistant's own gender: «حابة أعرف», «تمام، سعيد…» — it has none (rule 6).
 *
 * WHAT IS NOT — on purpose:
 *  · a thing's verb: «لن تصل أي رسائل», «هل تناسب هذه الكمية؟», «تتوفر بثلاثة ألوان»;
 *  · a passive that folds to the same letters: «لا تُطلب دفعة مقدمة»,
 *    «لا تُرسل العينات», «حُدد السعر», «لا تُستخدم للأغذية»;
 *  · "we told / we shared": «أخبرنا الفريق», «شاركنا في المعرض»;
 *  · the plural «تحتاجون / أنتم» — business Arabic's polite address. It
 *    misgenders nobody; the prompt asks for neither, and the guard holds only
 *    the singular, which does;
 *  · the buyer's own words, and the owner's taught answers: theirs.
 *
 * Precision is the point, as with the deletion check: a false catch costs a
 * second writing and, twice, a person's time. tests/parity/arabic-address.test.ts
 * holds both lists; a new phrasing goes into that file with its reason, never
 * into the patterns alone.
 *
 * Pure per ADR-0002. Returns the words that addressed the buyer, or null.
 */

/** Arabic letters, for word edges: `\b` knows only ASCII. */
const AR = String.raw`\u0621-\u064A\u066E-\u06D3`;
const L = `(?<![${AR}])`;
const R = `(?![${AR}])`;

/**
 * The text as the patterns read it: the deletion check's folding (diacritics
 * and tatweel gone, «أ إ آ» as «ا»), and «ى» as «ي». Every pattern below is
 * written in that folded form («متى» is «متي», «أخبرني» is «اخبرني»).
 */
const folded = (text: string): string =>
  normalizeForDeletion(text).replace(/[یى]/g, 'ي').replace(/ک/g, 'ك');

const alt = (xs: readonly string[]): string => xs.map((x) => x.replace(/ /g, String.raw`\s+`)).join('|');

/**
 * Optional «و / ف», then a question «أ», a future «س», or the dialects' present
 * «بـ» and future «حـ / هـ» («بتفكر», «هتحب»), before a verb.
 */
const PRE = '(?:[وف])?(?:[اسبحه])?';
/** After a verb: the feminine «ين / ي», then an object pronoun. Never «ون»: the plural is not caught. */
const POST = '(?:ين|ي)?(?:ه|ها|هم|هما|ني|نا)?';

/** Verbs whose subject, in a reply, can only be a person — so, here, the buyer. */
const PERSON_ONLY = ['ريد', 'رغب', 'ود', 'بحث', 'قصد', 'نو', 'خطط', 'فكر', 'تردد', 'قلق',
  // and the dialects' (seen live 2026-10-14): «تحب تشوف», «كنت تدور», «تقولي»
  'حب', 'شوف', 'دور', 'قول'];
/** Verbs a thing can be the subject of: caught only in BUYER_FRAME. */
const EITHER = ['حتاج', 'ستطيع', 'عرف', 'ملك', 'هتم', 'فضل', 'ختار', 'شتري', 'توقع', 'جد', 'تحدث', 'تكلم'];
/** …right after these, whose next verb is the buyer's. Not «لا»: «الحقيبة لا تحتاج إلى كي» is the bag's. */
const BUYER_FRAME = String.raw`(?:هل|كم|ماذا|لماذا|متي|انت|اذا\s+كنت|ان\s+كنت|لو\s+كنت|كنت)`;

/** Imperatives with no other reading. */
const IMPERATIVES = [
  'اخبرني', 'اعلمني', 'ابلغني', 'زودني', 'شاركني', 'راسلني', 'اختر', 'دعني', 'دعنا', 'قل لي', 'ابشر',
  'تواصل معنا', 'تواصل معي', 'اتصل بنا', 'اتصل بي', 'ارسل لي', 'ارسل لنا', 'ارسل الينا', 'ارسل الي',
  'اخبريني', 'اخبرينا', 'اعلميني', 'اعلمينا', 'ابلغيني', 'ابلغينا', 'زوديني', 'زودينا', 'شاركيني', 'شاركينا',
  'اختاري', 'حددي', 'دعيني', 'راسليني', 'راسلينا', 'قولي لي', 'ابشري', 'تفضلي', 'تواصلي', 'اتصلي', 'ارسلي',
];
/** "Tell us …" — also "we told …" alone, so only with what is to be told after it. */
const TELL_US = ['اخبرنا', 'اعلمنا', 'ابلغنا', 'زودنا', 'شاركنا', 'راسلنا'];
const WHAT_TO_TELL = String.raw`(?:ب[${AR}]+|عن|ما|ماذا|كم|اذا|هل|اي|متي|من\s+فضلك|رجاء)`;

/**
 * Dialect words that say a gender wherever they stand: "want" (Gulf), "tell
 * me", "you need" / "I need", "I'd like" (Levantine, either person), and the
 * feminine «ـكي» of Egypt and the Levant.
 */
const DIALECT = ['تبي', 'تبيه', 'تبيها', 'تبغي', 'تبغين', 'تبغيه', 'تبغيها', 'تقوللي',
  'محتاج', 'محتاجة', 'محتاجه', 'حاب', 'حابب', 'حابة', 'حابه',
  'انتي', 'معاكي', 'ليكي', 'عليكي', 'عندكي', 'منكي', 'ارسله لي', 'ارسلها لي'];

/** How the assistant may NOT describe itself: an adjective with a gender, opening a sentence or after «أنا». */
const SELF_ADJ = ['سعيد', 'سعيدة', 'سعيده', 'مسرور', 'مسرورة', 'متحمس', 'متحمسة'];

const WORDS_OF_ADDRESS = ['عزيزي', 'عزيزتي', 'سيدي', 'سيدتي', 'اخي', 'اختي', 'صديقي', 'صديقتي', 'استاذ', 'استاذة'];

/** What may follow «أنت» / «كنت» and say a gender. */
const ADJ = ['مهتم', 'متاكد', 'مستعد', 'راض', 'راضي', 'محق', 'جاهز', 'سعيد', 'مسرور'];

const PATTERNS: readonly RegExp[] = [
  new RegExp(`${L}${PRE}ت(?:${alt(PERSON_ONLY)})${POST}${R}`, 'u'),
  new RegExp(`${L}${BUYER_FRAME}\\s+${PRE}ت(?:${alt(EITHER)})${POST}${R}`, 'u'),
  // The feminine «تحتاجين» can only be "you".
  new RegExp(`${L}${PRE}ت(?:${alt(EITHER)})ين(?:ه|ها|هم|ني|نا)?${R}`, 'u'),
  // "how many pieces do you need?", "which colour do you prefer?" — not «كم يومًا تحتاج الطلبية».
  new RegExp(`${L}(?:كم|اي)(?:\\s+[${AR}]+){1,2}\\s+ت(?:${alt(EITHER)})${POST}${R}(?!\\s+ال)`, 'u'),
  // "the quantity you need?" — and not «المدة التي تحتاجها الطلبية», whose subject follows.
  new RegExp(`${L}(?:الذي|التي|ما)\\s+ت(?:${alt(EITHER)})(?:ين)?(?:ه|ها)${R}(?!\\s+ال)`, 'u'),
  // "you can … / you have to …": the verb after «أن» is the buyer's, whatever it is.
  new RegExp(`${L}(?:يمكنك|بامكانك|باستطاعتك|عليك|منك)\\s+ان\\s+ت[${AR}]+${R}`, 'u'),
  // "you tell me", "you send us": the listener does it to us.
  new RegExp(`${L}${PRE}ت(?:خبر|زود|شارك|بلغ)(?:ين|ي)?(?:ني|نا)${R}`, 'u'),
  new RegExp(`${L}${PRE}ت(?:رسل|وضح|ذكر|كتب)(?:ين|ي)?\\s+(?:لي|لنا|الي|الينا)${R}`, 'u'),
  new RegExp(`${L}[وف]?(?:${alt(IMPERATIVES)})${R}`, 'u'),
  new RegExp(`${L}[وف]?(?:${alt(TELL_US)})\\s+${WHAT_TO_TELL}`, 'u'),
  // «تفضل» opening a sentence is "here you are" / "please"; mid-sentence it may be «الشركة تفضل».
  new RegExp(`(?:^|[.!؟?،,:;\\n—-]\\s*)[وف]?تفضل${R}`, 'u'),
  new RegExp(`${L}(?:يا\\s+)?(?:${alt(WORDS_OF_ADDRESS)})${R}`, 'u'),
  new RegExp(`${L}[وف]?(?:${alt(DIALECT)})${R}`, 'u'),
  new RegExp(`(?:^|[.!؟?،,:;\\n—-]\\s*|${L}انا\\s+|${L}(?:تمام|اكيد|طبعا)\\s*،?\\s*)(?:${alt(SELF_ADJ)})${R}`, 'u'),
  new RegExp(`${L}(?:انت|كنت)\\s+(?:${alt(ADJ)})(?:ة|ه|ا)?${R}`, 'u'),
];

/** Words ending in «ـكَ» that are not "you": "that", "there", "those". */
const NOT_YOU = new Set(['ذلك', 'تلك', 'كذلك', 'لذلك', 'بذلك', 'هناك', 'هنالك', 'اولئك', 'ذاك', 'كذاك']);
const HARAKAT = /[\u064B-\u065F\u0670\u0640]/g;
/** "You were", "you wanted"…: «كنتَ / كنتِ» say it by the vowel on «ت», as «أنتَ» does. */
const YOU_DID = new Set(['كنت', 'اردت', 'قلت', 'طلبت', 'سالت', 'ذكرت', 'اخترت', 'ارسلت', 'وصلت']);

/** «أنتَ / أنتِ», «ـكَ / ـكِ»: read before folding, because folding removes the vowel that says it. */
function vowelled(raw: string): string | null {
  for (const [word] of raw.matchAll(/[\u0621-\u064A\u064B-\u065F\u0670\u0640]+/gu)) {
    const w = word.replace(/\u0651/g, '');                 // shadda changes nothing here
    const vowel = w.at(-1);
    if (vowel !== '\u064E' && vowel !== '\u0650') continue;   // fatha, kasra
    const bare = w.replace(HARAKAT, '').replace(/[أإآٱ]/g, 'ا');
    if (bare === 'انت' || YOU_DID.has(bare.replace(/^[وف]/, ''))) return word;
    if (w.at(-2) === 'ك' && !NOT_YOU.has(bare) && !NOT_YOU.has(bare.replace(/^[وف]/, ''))) return word;
  }
  return null;
}

export function addressesInGender(reply: string): string | null {
  if (!/[\u0621-\u064A]/.test(reply)) return null;
  const v = vowelled(reply.normalize('NFKC'));
  if (v !== null) return v;
  const text = folded(reply);
  for (const p of PATTERNS) {
    const m = text.match(p);
    if (m) return m[0].replace(/^[.!؟?،,:;\n—-]\s*/u, '');
  }
  return null;
}
