import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { addressesInGender } from '../../src/core/safety/address.js';
import { OPT_OUT_REPLIES } from '../../src/core/safety/optOut.js';

/**
 * Rule 6 on the send path: a reply addresses the buyer in neither gender
 * (src/core/safety/address.ts; the owner, 2026-10-14: "fix it before Arabic
 * sends anything to a real buyer, not after").
 *
 * The NOT list is the point, as in the deletion corpus: each is Arabic a reply
 * really writes that says nothing of the buyer's gender — a thing's verb, a
 * passive, "we told", the plural — and must leave as written. A new phrasing
 * goes in here with its reason, never into the patterns alone.
 */

/** Addressed a man or a woman: caught. */
const GENDERED: readonly (readonly [string, string])[] = [
  ['هل تبحث عن مقاس معين؟', 'the live reply that opened this (Practice, 2026-10-13)'],
  ['هل تريد معرفة السعر؟', 'want — only a person wants'],
  ['فهل تريده باللون الأسود؟', 'with «ف» before and the object after'],
  ['ما الكمية التي تحتاجها؟', '"the quantity you need", nothing after it'],
  ['هل تحتاج إلى عينة قبل الطلب؟', 'need, after «هل»'],
  ['كم قطعة تحتاج تقريبًا؟', 'how many pieces do you need'],
  ['أي لون تفضل؟', 'which colour do you prefer'],
  ['إذا كنت تبحث عن جودة عالية، فهذا المنتج مناسب.', 'if you are looking'],
  ['لا تتردد في التواصل معنا.', 'the stock closing line'],
  ['لا تترددي في السؤال.', 'the same, feminine'],
  ['لا تقلق، سيصلك الرد قريبًا.', "don't worry"],
  ['أخبرني بالكمية المطلوبة.', 'tell me'],
  ['أخبريني باللون المفضل.', 'tell me, feminine'],
  ['أخبرنا بالكمية المطلوبة.', 'tell us — with what to tell'],
  ['دعني أتحقق من ذلك.', '"let me check": an imperative to the buyer'],
  ['هل يمكنك أن ترسل لنا صورة؟', 'can you send — the verb after «يمكنك أن»'],
  ['يمكنك أن تختار من ثلاثة ألوان.', 'you can choose'],
  ['هل يمكن أن تخبرني بعنوان التوصيل؟', 'that you tell me'],
  ['هل ترغب في رؤية الكتالوج؟', 'would you like'],
  ['هل تودين معرفة المزيد؟', 'would you like, feminine'],
  ['هل تفضلين التوصيل أم الاستلام؟', 'do you prefer, feminine'],
  ['وتحتاجين كم قطعة؟', 'the feminine «تحتاجين» can only be "you"'],
  ['هل تقصد الحقيبة الكبيرة؟', 'do you mean'],
  ['هل تخطط لطلب كمية أكبر؟', 'are you planning'],
  ['هل تستطيع إرسال صورة؟', 'can you'],
  ['هل تعرف المقاس المطلوب؟', 'do you know'],
  ['اختر اللون الذي يناسبك.', 'choose'],
  ['تواصل معنا في أي وقت.', 'contact us'],
  ['تفضل، هذه تفاصيل المنتج.', '"here you are", opening the sentence'],
  ['ابشر، سنرسل العرض اليوم.', 'Gulf "good news", masculine'],
  ['عزيزي العميل، شكرًا لتواصلك.', 'dear (m.) customer'],
  ['سيدتي، الطلب جاهز.', 'madam'],
  ['أهلًا بك يا أخي، كيف أساعدك؟', 'brother'],
  ['شكرًا لكَ على رسالتك.', '«ـكَ» written with its vowel'],
  ['هل أنتِ مهتمة بهذا اللون؟', '«أنتِ» written with its vowel'],
  ['هل أنت مهتم بالطلب بالجملة؟', 'an adjective after «أنت»'],
  ['إذا كنت مستعدًا، يمكننا البدء.', 'an adjective after «كنت»'],
  ['أنت تتحدث مع مساعد آلي.', 'the identity answer, gendered'],
  // Seen live, 2026-10-14 (deepseek-flash, before the prompt's ADDRESS rule): the
  // writer answered a dialect in kind, and almost every dialect address has a gender.
  ['إيش كنت تدور بالضبط — مقاس معين أو لون؟', 'live, Gulf: "what were you [m.] looking for"'],
  ['إيش كنتِ تدورين عليه بالضبط؟', 'live: the same, feminine'],
  ['تحب تشوف الموديلات المتوفرة عندنا؟', 'live: "would you [m.] like to see"'],
  ['تحب تكون الهدية لعدد كبير من الموظفين؟', 'live: «تحب» with no «هل»'],
  ['تقريبًا بتفكر في كمية قد إيه؟', 'live, Egyptian: «بتفكر», the present «بـ»'],
  ['ممكن تقولي تقريبًا كام حقيبة محتاج؟', 'live: "tell me", "you [m.] need"'],
  ['قبل ما أتكلم عن السعر، حابة أعرف الكمية اللي بتفكري فيها', 'live: the assistant feminine, the buyer feminine'],
  ['تمام، سعيد إنها الحقيبة الصح.', 'live: the assistant masculine'],
  ['وإذا عندك بريد إلكتروني أرسله لي.', 'live: "send it to me"'],
  ['وإذا تحب أرسل لك ملخص على الإيميل.', 'live: "if you [m.] like"'],
  ['هل كنتَ تقصد المقاس الكبير؟', '«كنتَ» written with its vowel'],
  ['نعم، أنا مساعد آلي. ويسعدني مساعدتك في أي شيء تحتاجه الآن.', 'live through the turn, 2026-10-14: a REWRITE that was sent — "anything you [m.] need now"'],
  ['هذا الموديل ستجده في الكتالوج المرفق.', '"you will find it" — the verb with its object, no subject after it'],
  ['مرحبًا، أنا ليلى، مساعد آلي لدى المتجر. إذا أردت التحدث مع شخص من فريقنا فأخبرني، وسيرد عليك في أقرب وقت.',
    "the disclosure's own wording until 2026-09-28 — #118 removed «فأخبرني» by hand"],
];

/** Says nothing of the buyer's gender: leaves as written. */
const NEUTRAL: readonly (readonly [string, string])[] = [
  ['لن تصل أي رسائل أخرى منا.', "the messages' verb (the stop line)"],
  ['هل تناسب هذه الكمية؟', "the quantity's verb (the minimum line)"],
  ['تتوفر الحقيبة بثلاثة ألوان.', "the bag's verb"],
  ['هل تتوفر بألوان أخرى؟', "the bag's verb, as a question"],
  ['لا تُطلب أي دفعة مقدمة.', 'a passive: folds to «لا تطلب», and «لا» is no frame'],
  ['لا تُرسل العينات مجانًا.', 'a passive'],
  ['حُدد السعر حسب الكمية.', 'a passive that folds to the imperative «حدد»'],
  ['هذه الحقيبة لا تُستخدم للأغذية.', 'a passive'],
  ['الحقيبة لا تحتاج إلى كي.', "the bag's need, after «لا»"],
  ['المدة التي تحتاجها الطلبية خمسة وعشرون يومًا.', 'its subject follows: the order needs'],
  ['كم يومًا تحتاج الطلبية؟', 'its subject follows'],
  ['حقيبة تحتاجها الأسواق الآن.', 'its subject follows the verb and its object: the markets need it'],
  ['كم تبلغ تكلفة الشحن؟', "the cost's verb"],
  ['نتوقع أن تصل الشحنة خلال أسبوع.', '«أن» after "we expect", not after "you can"'],
  ['الشركة تفضل الدفع بالتحويل البنكي.', '«تفضل» mid-sentence: the company prefers'],
  ['أخبرنا الفريق بطلبك، وسيصلك الرد قريبًا.', '"we told the team"'],
  ['شاركنا في معرض كانتون العام الماضي.', '"we took part"'],
  ['تواصلنا مع المصنع اليوم.', '"we contacted"'],
  ['أرسل لك الكتالوج الآن.', '"I send you": the speaker acts'],
  ['شكرًا لك على رسالتك.', 'the unvowelled «ـك» addresses anybody'],
  ['يسعدني مساعدتك.', 'the unvowelled «ـك»'],
  ['هل لديك تفضيل للون معين؟', '«لديك» unvowelled; «تفضيل» is a noun'],
  ['مرحبًا بك! ما المنتج المطلوب؟', 'a noun phrase'],
  ['يمكن إرسال صورة للمنتج هنا.', '«يمكن» with a verbal noun — the house form'],
  ['هل يمكنك وصف المنتج بشكل أدق؟', '«يمكنك» with a verbal noun'],
  ['يُرجى توضيح الكمية المطلوبة.', '«يُرجى» — the house form'],
  ['ما الكمية المطلوبة تقريبًا؟', 'a noun phrase — the house form'],
  ['ذلكَ هو المنتج الأنسب.', '«ذلكَ» is "that", whatever its vowel'],
  ['هناكَ ثلاثة مقاسات.', '«هناكَ» is "there"'],
  ['كم تحتاجون تقريبًا؟', 'the plural: polite, misgenders nobody (not caught by design)'],
  ['هل أنتم مهتمون بالطلب؟', 'the plural'],
  ['تخزين الحقائب سهل.', 'a noun in «ت…ين»'],
  ['التنوع في الألوان كبير.', 'a noun that starts like «تنوي»'],
  ['أخيرًا، المنتج جاهز.', 'starts like «أخي»'],
  ['تم تأكيد الطلب — وستصلك الفاتورة بعد ذلك.', "the order line: the invoice's verb"],
  ['Thanks — what size are you looking for?', 'not Arabic'],
  // Seen live, 2026-10-14 — neutral, and must stay so.
  ['أكياس القماش عندنا تجي بمقاسين: 30×40 سم و38×42 سم. أي مقاس يناسبك أكثر؟', "live: the bags' verb «تجي»; «يناسبك»"],
  ['سعر الحقيبة الواحدة 3.80 دولار، يعني 500 حقيبة بتطلع 1900 دولار.', "live: «بتطلع» is the total's verb"],
  ['لا يوجد خصم متاح حالياً، لكن إن أردت يمكنني تمرير طلبك للفريق.', 'live: «أردت» unvowelled, like «ـك»'],
  ['تمام، سأحوّل طلبك إلى فريقنا وسيتواصلون معك قريبًا.', 'live'],
  ['نعم، أنا مساعد آلي. سأحوّلك لأحد أفراد الفريق ليكمل معك.', 'live: the identity answer, neutral'],
  ['تمام، هحوّل طلبك لفريقنا وهما هيتواصلوا معاك في أقرب وقت.', "live, Egyptian: «معاك» unvowelled — the house rule's «ـك»"],
  ['يسعدني أن أنقل طلبك للفريق لمراجعته.', '«يسعدني», not «أنا سعيد»'],
  ['عيد سعيد وكل عام وأنتم بخير!', '«سعيد» describing a holiday, not the speaker'],
  ['أكياس قابلة لإعادة التدوير.', '«التدوير» (recycling) is not «تدور»'],
  ['المقاس المطلوب هو 38×42 سم كما تبيّن الصورة.', '«تبيّن» (shows) is not the Gulf «تبي»'],
];

/**
 * Caught though nobody is addressed — accepted. A reply to a buyer rarely
 * asks this way, and a false catch costs one more writing.
 */
const ACCEPTED_FALSE_CATCHES: readonly (readonly [string, string])[] = [
  ['هل تحتاج الحقيبة إلى طباعة؟', '"does the bag need printing?" — reads like "do you need"'],
];

describe('a reply that addresses the buyer as a man or a woman is caught', () => {
  for (const [text, why] of [...GENDERED, ...ACCEPTED_FALSE_CATCHES]) {
    it(`${why} — ${text}`, () => {
      expect(addressesInGender(text), text).not.toBeNull();
    });
  }
});

describe('a reply that does not, leaves', () => {
  for (const [text, why] of NEUTRAL) {
    it(`${why} — ${text}`, () => {
      expect(addressesInGender(text), `${text} → matched ${addressesInGender(text)}`).toBeNull();
    });
  }
});

describe("every fixed Arabic sentence Nomi sends already addresses nobody in a gender", () => {
  // The fixed sentences live as literals in these files; every Arabic one is
  // read, outside comments — and outside the disclosure's EARLIER wordings,
  // recognised in old messages but never said again (one is caught above).
  const FILES = [
    'src/core/conversation/templates.ts',
    'src/core/conversation/fastpath.ts',
    'src/core/conversation/disclosure.ts',
    'src/core/channel/reopen.ts',
  ];
  const literals = FILES.flatMap((f) =>
    [...readFileSync(f, 'utf8')
      .replace(/const EARLIER[\s\S]*?\n\];/, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s\/\/ .*$/gm, '')
      .matchAll(/'([^'\n]*[\u0621-\u064A][^'\n]*)'|`([^`]*[\u0621-\u064A][^`]*)`/g)]
      .map((m) => ({ file: f, text: m[1] ?? m[2] ?? '' })));
  const all = [...literals, { file: 'optOut.ts OPT_OUT_REPLIES', text: OPT_OUT_REPLIES.ar }];

  it('reads them (a moved sentence must not empty this test)', () => {
    expect(all.length).toBeGreaterThan(30);
  });
  for (const { file, text } of all) {
    it(`${file}: ${text.slice(0, 60)}`, () => {
      expect(addressesInGender(text), `${text} → matched ${addressesInGender(text)}`).toBeNull();
    });
  }
});
