/**
 * A BUYER WHO ASKS FOR THEIR DATA TO BE DELETED IS ANSWERED BY A PERSON.
 *
 * Decided by the owner, 2026-09-27: the conversation goes to a person, the
 * assistant says NOTHING — no receipt, no acknowledgment — and a human replies.
 * The assistant must never promise a deletion: only the business can record the
 * request (CC-02, the buyer file) and only Nomi's operator can carry it out
 * (docs/DATA-DELETION-RUNBOOK.md). A cheerful "Done, I've deleted your data!" from a
 * model would be a promise to a person that the code cannot keep.
 *
 * Two layers, both deterministic:
 *
 * 1. `asksForDeletion` — the buyer's own words, BEFORE any model call. A hit is
 *    the `deletion_requested` signal, scored like a request for a person, so
 *    the turn is gated (no analysis, no writer) and becomes a SILENT hand-off.
 *
 * 2. `promisesDeletion` — the reply, AFTER it was written. A buyer who asked in
 *    words layer 1 did not know still must not be promised anything: a reply
 *    that promises or claims a deletion is thrown away and the turn becomes the
 *    same silent hand-off.
 *
 * ── PRECISION FIRST. A PASSING MENTION IS NOT A REQUEST. ────────────────────
 *
 * Buyers delete things all day: "delete that line from the quote", "remove the
 * logo", "删掉第三项", "احذف السطر من عرض السعر". None of those may hand off. So a
 * request needs BOTH a deletion verb AND the buyer's own data as its object —
 * "my data", "my information", "my number", "everything you have on me",
 * "我的个人信息", "بياناتي" — joined directly, with only filler words between
 * them ("all", "of", "the", "please"…), or one of a few fixed phrases ("right
 * to be forgotten", 被遗忘权, الحق في النسيان). A verb near an unrelated "my …"
 * never counts: "remove the logo, my details are in the e-mail" and "I emailed
 * my details and removed the logo" do not match.
 *
 * A miss is not silent: layer 2 catches the promise a model would make. A false
 * hit costs a buyer a human reply instead of an automatic one — the safe way to
 * be wrong. tests/parity/deletion-requests.test.ts holds both lists.
 *
 * Languages: English, Chinese and Arabic (the owner's three), and French,
 * Spanish, Portuguese, German, Russian and Turkish, which buyers write in.
 */

/** Lower-cased, width-folded, Arabic diacritics/tatweel removed, alef forms unified, spaces collapsed. */
export function normalizeForDeletion(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\u0307/g, '')                          // the dot "İ".toLowerCase() leaves behind
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')     // Arabic harakat, dagger alef, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ── English ──────────────────────────────────────────────────────────────────
const EN_VERB = '(?:delete|erase|remove|wipe|purge|destroy)';
const EN_VERB_DONE = '(?:deleted|erased|removed|wiped|purged|destroyed)';
/** Between the verb and its object: words that do not change whose data it is. */
const EN_FILL = '(?:\\s+(?:all|any|of|the|every|entire|whole|each|out))*';
/** Between "my data" and "deleted": helpers only, never content. */
const EN_HELP = '(?:\\s+(?:should|must|to|be|been|being|get|gets|got|please|all|completely|permanently|fully|now|asap|immediately|entirely))*';
/** The buyer's own data, as a buyer names it. "account" never as in "account manager". */
const EN_MINE_STRONG = '(?:my\\s+(?:personal\\s+)?(?:data|information|info|details|records?|profile'
  + '|contact\\s+(?:details|info|information)'
  + '|messages|chat\\s+history|conversation\\s+history|message\\s+history|history'
  + '|account(?!\\s+(?:manager|number|rep|representative|holder|executive)))(?![a-z])'
  + '|(?:everything|anything|all|any\\s+(?:data|info|information|details))\\s+(?:you\\s+(?:have|hold|keep|store|stored|saved|collected|got|\'ve\\s+got)\\s+)?(?:on|about)\\s+me'
  + '|(?:the\\s+)?(?:data|information|info|details|records)\\s+you\\s+(?:have|hold|keep|store|stored|saved|collected)\\s+(?:on|about|of)\\s+me'
  + '|(?:all\\s+)?(?:our|this)\\s+(?:conversation|chat)\\s+history)';
/**
 * "My e-mail", "my number": data too, but also the thing on a cc line or in a
 * group. After a verb they count only where the clause ends there, or goes on
 * to say where from — "remove my number from your list", not "remove my e-mail
 * from the cc".
 */
const EN_MINE_WEAK = '(?:my\\s+(?:e-?mail(?:\\s+address)?|(?:phone\\s+|mobile\\s+|whatsapp\\s+)?number)(?![a-z]))';
const EN_WEAK_ENDS = '(?=\\s*(?:$|[.!?,;]|please\\b|thanks?\\b|thank\\s+you\\b|from\\s+(?:your|all|every)\\b'
  + '|from\\s+the\\s+(?:list|database|records|system|contacts|files|mailing\\s+list|marketing\\s+list)\\b))';
const EN_MINE_AFTER_VERB = `(?:${EN_MINE_STRONG}|${EN_MINE_WEAK}${EN_WEAK_ENDS})`;
const EN_MINE_ANY = `(?:${EN_MINE_STRONG}|${EN_MINE_WEAK})`;
const EN: readonly RegExp[] = [
  new RegExp(`\\b${EN_VERB}${EN_FILL}\\s+${EN_MINE_AFTER_VERB}`),        // "delete all of my data", "remove my number from your list"
  new RegExp(`\\b${EN_MINE_ANY}${EN_HELP}\\s+${EN_VERB_DONE}\\b`),        // "my data deleted", "my details to be removed"
  new RegExp(`\\b${EN_VERB}\\s+me\\s+from\\s+your\\s+(?:database|records|system|list|mailing\\s+list|contacts?|files)\\b`),
  /\bforget\s+(?:everything|all)\s+(?:you\s+know\s+)?about\s+me\b/,
  /\bright\s+to\s+(?:be\s+forgotten|erasure|deletion)\b/,
  /\b(?:data|account)\s+deletion\s+request\b/,
  // GDPR and a deletion word in the SAME clause: "are you GDPR compliant? also
  // delete the extra line" is two clauses, and asks nothing about the buyer.
  /\bgdpr\b[^.!?\n]{0,40}\b(?:delete|deletion|erase|erasure|remove|removal)\b|\b(?:delete|deletion|erase|erasure|remove|removal)\b[^.!?\n]{0,40}\bgdpr\b/,
];

// ── Chinese ──────────────────────────────────────────────────────────────────
const ZH_VERB = '(?:删除|删掉|删了|删去|删|清除|清掉|抹掉|抹去|移除|销毁)';
const ZH_MINE = '(?:我的|我)(?:所有|全部|一切)?(?:的)?(?:个人)?(?:数据|资料|信息|记录|号码|电话号码|电话|手机号码|手机号|邮箱|邮件地址|账号|帐号|账户|帐户|聊天记录|对话记录|消息记录|隐私)';
const ZH: readonly RegExp[] = [
  new RegExp(`${ZH_VERB}(?:掉|了|去)?(?:所有|全部|一切)?(?:的)?${ZH_MINE}`),     // 删除我的数据, 删掉我所有的资料
  // The object, a politeness or two, then the verb — never across punctuation:
  // "我的邮箱写错了，删掉重发" corrects an address; it does not ask for erasure.
  new RegExp(`${ZH_MINE}(?:都|全|全部|给|请|帮我|麻烦|你们|您)*[^，。、,.!?！？\\s]{0,2}?${ZH_VERB}`),  // 把我的信息删了, 我的资料请删除
  /(?:保存|存|留)的(?:关于我的|我的)(?:数据|资料|信息|记录)(?:都|全部|请)?(?:删|清除)/,
  /被遗忘权|删除权/,
];

// ── Arabic (normalised: alef forms unified, no diacritics) ───────────────────
const AR_VERB = '(?:احذف|احذفوا|احذفي|حذف|تحذف|تحذفوا|امسح|امسحوا|امسحي|مسح|تمسح|ازل|ازيلوا|ازاله|ازالة|تزيل|تزيلوا|الغ|الغاء)';
const AR_MINE = '(?:بياناتي الشخصيه|بياناتي الشخصية|معلوماتي الشخصيه|معلوماتي الشخصية|بياناتي|معلوماتي|رقم هاتفي|رقم جوالي|رقم تلفوني|رقمي|بريدي الالكتروني|بريدي|ايميلي|حسابي|رسائلي|محادثاتي|سجلاتي|سجلي'
  + '|البيانات الخاصه بي|البيانات الخاصة بي|المعلومات الخاصه بي|المعلومات الخاصة بي|كل ما لديكم عني|كل ما عندكم عني|ما لديكم عني)';
const AR: readonly RegExp[] = [
  new RegExp(`${AR_VERB}(?:\\s+(?:كل|جميع|كامل))?\\s+${AR_MINE}`),             // حذف بياناتي, امسحوا كل معلوماتي
  new RegExp(`${AR_MINE}(?:\\s+(?:ارجو|اريد|من فضلك|رجاء|لو سمحت))?\\s+(?:محذوفه|محذوفة|ان تحذف|ان يتم حذفها|يتم حذفها|تحذف|تمسح)`),
  /الحق في النسيان|الحق في المحو|الحق في الحذف/,
];

// ── Other buyers' languages ──────────────────────────────────────────────────
const OTHER: readonly RegExp[] = [
  // French
  /\b(?:supprime[rz]?|effacer|effacez|efface|retirer|retirez)\s+(?:toutes\s+)?(?:mes|les)\s+(?:donn[ée]es|informations|coordonn[ée]es)(?:\s+personnelles)?\b/,
  /\bmes\s+(?:donn[ée]es|informations)(?:\s+personnelles)?\s+(?:soient\s+)?(?:supprim[ée]es|effac[ée]es)\b/,
  /\bdroit\s+[àa]\s+l'oubli\b/,
  // Spanish
  /\b(?:borrar|borren|borra|borre|eliminar|eliminen|elimina|elimine|suprimir|supriman)\s+(?:todos\s+)?mis\s+(?:datos|informaci[oó]n)(?:\s+personales)?\b/,
  /\bmis\s+(?:datos|informaci[oó]n)(?:\s+personales)?\s+(?:sean\s+)?(?:borrad[oa]s?|eliminad[oa]s?)\b/,
  /\bderecho\s+al\s+olvido\b/,
  // Portuguese
  /\b(?:apagar|apaguem|apague|excluir|excluam|exclua|eliminar|deletar|delete|remover|removam|remova)\s+(?:todos\s+)?(?:os\s+)?meus\s+(?:dados|informa[çc][õo]es)(?:\s+pessoais)?\b/,
  /\bdireito\s+ao\s+esquecimento\b/,
  // German
  /\b(?:l[öo]schen|l[öo]sche|entfernen|entfernt)(?:\s+sie)?\s+(?:alle\s+)?meine\s+(?:pers[öo]nlichen\s+)?(?:daten|informationen|angaben)\b/,
  /\bmeine\s+(?:pers[öo]nlichen\s+)?(?:daten|informationen|angaben)\s+(?:bitte\s+)?(?:l[öo]schen|entfernen|gel[öo]scht)\b/,
  /\brecht\s+auf\s+vergessenwerden\b/,
  // Russian
  /(?:удалите|удалить|удали|сотрите|стереть|сотри)\s+(?:все\s+)?мои\s+(?:персональные\s+)?(?:данные|информацию|сведения)/,
  /мои\s+(?:персональные\s+)?(?:данные|информацию)\s+(?:пожалуйста\s+)?(?:удалите|удалить)/,
  /право\s+на\s+забвение/,
  // Turkish
  /(?:ki[şs]isel\s+)?(?:verilerimi|bilgilerimi)\s+(?:l[üu]tfen\s+)?(?:sil|silin|siliniz|silmenizi|kald[ıi]r[ıi]n|kald[ıi]r)/,
  /unutulma\s+hakk[ıi]/,
];

const REQUEST_PATTERNS: readonly RegExp[] = [...EN, ...ZH, ...AR, ...OTHER];

/**
 * Layer 1: does this buyer message ask for THEIR data to be deleted? Returns
 * the words that matched (for the record), or null. Never true for a mention of
 * deleting something else — a line, a logo, an item, an order, a message sent
 * by mistake.
 */
export function asksForDeletion(text: string): string | null {
  const t = normalizeForDeletion(text ?? '');
  if (!t) return null;
  for (const p of REQUEST_PATTERNS) {
    const m = p.exec(t);
    if (m) return m[0];
  }
  return null;
}

// ── Layer 2: a reply that promises or claims a deletion ─────────────────────
const PROMISE_PATTERNS: readonly RegExp[] = [
  // English — "your" only: "I'll remove the number 3 from the quote" promises
  // nothing about the buyer's data. The same care as layer 1: "your account
  // manager" is a person, and "your e-mail" / "your number" come off a cc line
  // or a quote as often as off a list — they count only where the clause ends
  // there, or says the list, database or records they leave.
  new RegExp(`\\b(?:i|we)(?:'ll|'ve| will| have| shall| can| am going to| are going to|'m going to|'re going to)?\\s+(?:go ahead and\\s+)?`
    + `(?:delete|deleted|erase|erased|remove|removed|wipe|wiped|purge|purged)(?:\\s+(?:all|any|of|every))*\\s+your\\s+(?:personal\\s+)?`
    + `(?:(?:data|information|info|details|records|messages|contact details|history|account(?!\\s+(?:manager|number|rep|representative|holder|executive)))\\b`
    + `|(?:number|phone number|mobile number|whatsapp number|e-?mail(?:\\s+address)?)(?=\\s*(?:$|[.!?,;]|from\\s+(?:our|all|every)\\b`
    + `|from\\s+the\\s+(?:list|database|records|system|contacts|files|mailing\\s+list|marketing\\s+list)\\b)))`),
  /\byour\s+(?:personal\s+)?(?:data|information|info|details|records|messages|number|account|history)\s+(?:has|have|will|shall|is|are)\s+(?:been\s+|be\s+|being\s+)?(?:deleted|erased|removed|wiped|purged)\b/,
  /\b(?:all\s+)?(?:the\s+)?(?:data|information|details)\s+we\s+(?:have|hold|keep|store)\s+(?:on|about)\s+you\s+(?:has|have|will|is|are)\s+(?:been\s+|be\s+)?(?:deleted|erased|removed|wiped)\b/,
  // Chinese — 已为您删除所有数据 / 我们会删除您的信息 / 您的资料已删除 / 已经帮您把数据删除了
  /(?:已经?|会|将|马上|立即|这就)(?:为您|为你|帮您|帮你|给您|给你)?(?:删除|删掉|清除|抹掉|移除)(?:了)?(?:您的|你的)?(?:所有|全部)?(?:的)?(?:个人)?(?:数据|资料|信息|记录|聊天记录|号码|账号)/,
  /(?:您的|你的)(?:所有|全部)?(?:的)?(?:个人)?(?:数据|资料|信息|记录|聊天记录|号码|账号).{0,6}?(?:已|会|将|已经)(?:被)?.{0,2}?(?:删除|删掉|清除|抹掉|移除)/,
  /(?:已经?|会|将|马上|立即)(?:为您|为你|帮您|帮你)?把(?:您的|你的)?(?:所有|全部)?(?:的)?(?:个人)?(?:数据|资料|信息|记录|聊天记录|号码|账号)(?:都|全部)?(?:删除|删掉|清除|抹掉|移除)/,
  // Arabic (normalised) — سنحذف بياناتك / تم حذف معلوماتك / سيتم حذف بياناتكم
  /(?:سنحذف|ساحذف|سوف نحذف|سوف احذف|حذفنا|حذفت|تم حذف|سيتم حذف|قمنا بحذف|سنقوم بحذف|ساقوم بحذف|سنمسح|مسحنا|تم مسح|سيتم مسح|سنزيل|تمت ازاله|تمت ازالة|سيتم ازاله|سيتم ازالة)(?:\s+(?:كل|جميع))?\s+(?:بياناتك|معلوماتك|رقمك|رسائلك|حسابك|بياناتكم|معلوماتكم|رسائلكم|حسابكم|سجلك|سجلاتك)/,
  // French / Spanish / Portuguese / German / Russian / Turkish
  /\b(?:nous\s+(?:allons|avons|supprimerons|effacerons)|je\s+(?:vais|ai|supprimerai|effacerai))\s+(?:supprim|effac)\w*\s+(?:vos|tes|toutes\s+vos)\s+(?:donn[ée]es|informations)/,
  /\bvos\s+(?:donn[ée]es|informations)\s+(?:ont\s+[ée]t[ée]|seront)\s+(?:supprim|effac)\w*/,
  /\b(?:borraremos|eliminaremos|hemos\s+borrado|hemos\s+eliminado|borrar[ée]|eliminar[ée]|he\s+borrado|he\s+eliminado)\s+(?:todos\s+)?(?:sus|tus)\s+(?:datos|informaci[oó]n)/,
  /\bsus\s+datos\s+(?:han\s+sido|ser[aá]n|fueron)\s+(?:borrad|eliminad)\w*/,
  /\b(?:vamos|vou|iremos|irei)\s+(?:apagar|excluir|remover|deletar)\s+(?:todos\s+)?(?:os\s+)?(?:seus|teus)\s+dados|\b(?:apagamos|exclu[íi]mos|removemos|deletamos)\s+(?:os\s+)?(?:seus\s+)?dados/,
  /\b(?:wir|ich)\s+(?:werden|haben|habe|werde)\s+(?:ihre|deine)\s+daten\s+(?:l[öo]schen|gel[öo]scht|entfernen|entfernt)/,
  /\b(?:ihre|deine)\s+daten\s+(?:wurden|werden|sind)\s+(?:gel[öo]scht|entfernt)/,
  /(?:мы|я)\s+(?:удалим|удалили|удалю|удалил|удалила)\s+(?:все\s+)?(?:ваши|твои)\s+(?:данные|сведения|информацию)|(?:ваши|твои)\s+данные\s+(?:были\s+|будут\s+)?удален/,
  /(?:verilerinizi|bilgilerinizi)\s+(?:sildik|silece[ğg]iz|siliyoruz)|(?:verileriniz|bilgileriniz)\s+(?:silindi|silinecek)/,
];

/**
 * Layer 2: does this reply promise or claim that the buyer's data is (or will
 * be) deleted? Returns the words that matched, or null. It reads the reply the
 * buyer would read — a reply that merely offers a person, or says the team
 * will be in touch, promises nothing and passes.
 */
export function promisesDeletion(reply: string): string | null {
  const t = normalizeForDeletion(reply ?? '');
  if (!t) return null;
  for (const p of PROMISE_PATTERNS) {
    const m = p.exec(t);
    if (m) return m[0];
  }
  return null;
}
