/**
 * The lists `assistant-pronouns.test.ts` reads. Each entry is a decision, so each
 * carries its reason; adding one is a claim that a reviewer can check.
 */

/**
 * Arabic forms the 2026-09-23 sweep removed that can be NOTHING but the owner
 * (or a buyer) addressed in a gender, or a verb whose subject was the
 * assistant: feminine imperatives and second-person forms (اكتبي، تريدين),
 * vowel-marked perfects (طلبتِ), and masculine imperatives that cannot be read
 * as a past tense or a noun (أضف، اربط، اضغط). Words that are ALSO a past tense,
 * a first person or a noun (أرسل، انتظر، ردّها) are deliberately absent — a
 * ban on them would block ordinary copy.
 */
export const AR_BANNED_FORMS: readonly string[] = [
  "أكّدي", "اختاري", "حاولي", "فاكتبي", "واذكري", "خذي", "انتظري", "اكتبي",
  "تودّين", "اطلبي", "أتريدين", "انظري", "تنظري", "تختاري", "اعلمي", "ترسلينه",
  "تؤكّدي", "تقرئيه", "تضغطي", "شغّلي", "تعبتِ", "طلبتِ", "فتحتِه", "فعلتِه",
  "أرسلتِه", "أدخلتِه", "عرضتِها", "علّمتِها", "أعددتِه", "طلبتِه", "اخترتِ", "علّمها",
  "أضف", "اربط", "اختر", "اضغط", "تعتمدينه", "تحدّدينه", "حدّدتِه", "تحدّدي",
  "تغيّريه", "أخبري", "تُخبري", "راجعي", "الصقي", "أخبريها", "تحدّدين", "سجّلتِه",
  "سجّلي", "اخصميها", "تحدّديها", "حدّدتِها", "اجعليه", "أزيليه", "امنحي", "تبيعينه",
  "علّمتِه", "غيّريه", "تجاهليه", "اعرضه", "أبقه", "اخفضه", "املأ", "العب",
  "ارفع", "تريدين", "اعتمدي", "أعطاكِ", "احفظي", "افتحي", "الصقيه", "انسخيه",
  "أضيفيه", "أخذتِ", "أرسلي", "أرسليها", "أضفتِه", "أضيفي", "أضيفيها", "أعيدي",
  "أمامكِ", "أنتِ", "أوقفي", "أوقفيها", "إنكِ", "ابحثي", "ابدئي", "اتركيه",
  "اتركيها", "احذفي", "احذفيه", "اربطي", "اربطيه", "استبدلي", "اسمحي", "اضغطي",
  "افحصي", "افصلي", "اقرئي", "اقرئيها", "التقيتِه", "املئي", "باسمكِ", "بريدكِ",
  "بكِ", "بنطاقكِ", "بنفسكِ", "تبحثين", "تتعاملين", "تتوقفي", "تراسلي", "تراسليه",
  "ترسلين", "تستطيعين", "تستعملينه", "تشغّليها", "تصلكِ", "تصلين", "تصنعينه", "تضغطينه",
  "تضيفينه", "تعرفينه", "تقولي", "تنتظركِ", "توافقي", "توقيعكِ", "جرّبي", "حدّدتِ",
  "دعيها", "راسلكِ", "رسائلكِ", "رسالتكِ", "سؤالكِ", "ستجدينها", "سجلاتكِ", "شركتكِ",
  "طلبكِ", "علّمي", "عندكِ", "فأوقفيها", "فانظري", "قائمتكِ", "قرّري", "قلتِ",
  "كنتِ", "لترَي", "لكِ", "منكِ", "نشرتِه", "واسمحي", "والصقيه", "وتُبلَّغين",
  "وذكرتِ", "ويمكنكِ", "يخبركِ", "يخصّكِ", "يراسلكِ", "يمكنكِ", "أضِف", "أعِدها",
  "أحِل", "تولَّ", "راجِع", "وراجِع", "راسِله", "رُدّ", "عُد", "اضبطه",
  "اتركه", "افتحه",
];

/**
 * A word right after `{name}` that looks like a verb and is not one agreeing
 * with her: verbal nouns with an object suffix, a preposition, and impersonal
 * forms («ما يُقال», «ما يمكن»). Compared without diacritics.
 */
export const AR_NAME_ADJACENT_NOUNS: readonly string[] = [
  'تسعيرها',  // verbal noun + ـها = the products («لا يمكن لـ {name} تسعيرها»)
  'تأكيده',   // verbal noun + ـه = the certification
  'تحت',      // preposition («لا سعر من {name} تحت …»)
  'يقال',     // impersonal passive, after ما («ليس لدى {name} ما يُقال»)
  'يمكن',     // impersonal, after ما («ليس لدى {name} ما يمكن تسعيره»)
];

/** Keys where هو / هي stands for a THING, never the assistant. */
export const AR_HUWA_HIYA_THINGS: Readonly<Record<string, string>> = {
  'activation.stop.what': '«كما هو» — everything stays as it is',
  'factory.rehearsal.answer_withheld': '«كما هو» — a fact cannot be said as it stands',
  'otp.mail.subject': '«هو رمز» — the sign-in code',
  'otp.mail.body': '«رمزك هو» — the sign-in code',
};

/** Keys where Chinese 它 stands for a thing. Empty: the sweep reworded every one. */
export const ZH_IT_THINGS: Readonly<Record<string, string>> = {};
