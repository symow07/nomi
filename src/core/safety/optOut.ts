import { normalizeForDeletion } from './deletion.js';

/**
 * A BUYER WHO SAYS STOP IS NOT WRITTEN TO AGAIN (the owner, 2026-10-10).
 *
 * WhatsApp's, Messenger's and Instagram's rules all say the same thing: a
 * person who asks a business to stop messaging them is not messaged again. So
 * "stop messaging me", STOP, 别再发了, «لا تراسلني», «ماتبقاش تصيفط ليا» is an
 * OPT-OUT: recorded for that buyer on that channel (`opt_outs`, 0135), answered
 * with one fixed line, and then nothing — no reply, no follow-up, no reopening
 * template, no outreach — until the buyer writes again. Writing again lifts the
 * silence for replies only; nothing is ever sent FIRST to them again until the
 * owner, on the buyer's page, records that they asked for it.
 *
 * ── CATCH IT. A MISS IS A POLICY BREACH; A FALSE HIT COSTS A MINUTE. ───────
 *
 * The owner's rule: a false positive is cheap (a person picks the conversation
 * up, and can lift the record), a false negative is a breach. So the patterns
 * here are broad, and informal: "pls stop", "leave me alone", 别发了, «بطلوا
 * رسايل», «باراكا من الميساجات», "safi matb9ach tsiftli".
 *
 * ── BUT A REQUEST FOR A PERSON IS NOT ONE. ─────────────────────────────────
 *
 * "Stop the bot, get me a person" is not "stop messaging me": the buyer wants
 * help, and silence would be the worst answer. So `readOptOut` (core/scoring/
 * detect.ts) reads this file's answer beside "wants a person": a stop that
 * also asks for, or names, a person — or that is aimed at the machine ("stop
 * the bot", «لا أريد روبوت») — goes to a PERSON with the ordinary hand-off, and
 * is never recorded as an opt-out. So does a bare word that may mean an order
 * rather than the messages ("cancel", 取消, «إلغاء», "annuler"). Genuinely
 * ambiguous goes to a person, never to the do-not-contact list.
 *
 * Six languages — en, zh, ar (with Gulf, Egyptian, Levantine and Moroccan
 * Darija, in Arabic letters and in Latin), es, fr, pt — plus the bare English
 * keywords every channel's users know. tests/parity/opt-out-requests.test.ts
 * holds the three lists: opt-outs, requests for a person, and neither.
 */

/** The deletion check's folding, and the letters a Persian keyboard gives Arabic (as `readable` in detect.ts). */
export const readableForOptOut = (text: string): string =>
  normalizeForDeletion(text).replace(/[یى]/g, 'ي').replace(/ک/g, 'ك');

/** Arabic letters, for word edges: `\b` knows only ASCII. */
const AR = String.raw`ء-يٮ-ۓ`;
const NA = `(?<![${AR}])`;   // no Arabic letter before
const NZ = `(?![${AR}])`;    // no Arabic letter after
/** Latin letters with the accents French, Spanish and Portuguese write. */
const LT = 'a-zçãõáéíóúâêôàüñèëîïûùÿœ';
const NL = `(?<![${LT}])`;
const NR = `(?![${LT}])`;

/** The message with nothing round it: no spaces, punctuation, symbols or emoji at either end. */
const bare = (t: string): string =>
  t.replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '').replace(/\s+/g, ' ');

/** Politeness round a keyword: "stop please", «توقف من فضلك», "arrêtez s'il vous plaît", "退订谢谢". */
const POLITE = new RegExp(String.raw`^(?:(?:please|pls|plz|kindly|ok|okay|por\s+favor|porfa|s'il\s+vous\s+pla[iî]t|svp|stp|merci\s+de|请|麻烦|من\s+فضلك|لو\s+سمحت|رجاء|عافاك|يا\s+اخي|يا\s+اخوي)\s*)+|(?:\s*[,.!]?\s*(?:please|pls|plz|thanks|thank\s+you|thx|ty|por\s+favor|porfa|gracias|merci|svp|stp|s'il\s+vous\s+pla[iî]t|s'il\s+te\s+pla[iî]t|obrigad[oa]|pf|pfv|谢谢|谢谢你|谢了|请|شكرا|من\s+فضلك|لو\s+سمحت|عافاك|بارك\s+الله\s+فيك|3afak|afak|now|right\s+now|already|immediately|asap))+$`, 'u');
const plain = (whole: string): string => bare(whole.replace(POLITE, ''));

// ── The whole message is one of these ───────────────────────────────────────

/** Keywords a buyer types alone to stop a business's messages. */
const BARE_STOP = new Set([
  // English, and the keyword every channel's users know in any language
  'stop', 'stop all', 'stopall', 'stop it', 'stop now', 'stop please', 'please stop', 'pls stop', 'plz stop',
  'stop pls', 'stop plz', 'just stop', 'ok stop', 'okay stop', 'stop already', 'stop stop', 'stoppp', 'stopp',
  'unsubscribe', 'unsubscribe me', 'unsub', 'opt out', 'optout', 'opt-out', 'opt me out', 'remove me', 'remove',
  'enough', 'no more', 'no more messages', 'leave me alone', 'go away',
  // 中文
  '停', '停止', '停下', '退订', 'td', '别发了', '别再发了', '不要再发了', '够了', '滚', '别烦我', '别烦了',
  '拒收', '取消订阅', '请勿打扰', '勿扰', '别打扰我',
  // العربية (folded: «أ إ آ» as «ا», no diacritics)
  'ستوب', 'توقف', 'توقفوا', 'وقف', 'وقفوا', 'اوقف', 'اوقفوا', 'كفي', 'كفايه', 'كفاية',
  'باراكا', 'بركا', 'براكا', 'حبس', 'حبسو', 'الغاء الاشتراك', 'بطل', 'بطلوا',
  // Darija / Arabizi in Latin letters
  'baraka', 'safi baraka', '7bes', 'hbes', 'stopi',
  // Español
  'baja', 'de baja', 'para', 'para ya', 'basta', 'ya basta', 'basta ya',
  // Français
  'arrêt', 'arret', 'arrête', 'arrete', 'arrêtez', 'arretez', 'désabonner', 'desabonner', 'désinscrire',
  'stop svp', 'stop merci',
  // Português
  'pare', 'parar', 'chega', 'sair', 'descadastrar', 'descadastre', 'para com isso', 'sai fora', 'me tira daqui',
  // and a few more said alone
  'cease and desist', 'remove this number', 'take me off', 'صافي باراكا', 'صافي بركا', 'بلاش', 'بلاش رسايل',
]);

/**
 * Alone, these may stop the messages — or an order. A person reads them; they
 * are never recorded as an opt-out.
 */
const BARE_UNSURE = new Set([
  'cancel', 'cancel it', 'cancel please', 'end', 'quit', 'no thanks stop',
  '取消', '算了', '不要发了', '不用发了', '不用了',
  'الغاء', 'الغي', 'الغوا', 'خلاص', 'بس خلاص', 'safi',
  'cancelar', 'cancela', 'annuler', 'annulez', 'fin', 'صافي',
  "don't send anything", "don't send anything else", 'dont send anything',
]);

// ── Anywhere in the message ─────────────────────────────────────────────────

/** Messages, as a buyer names them, in English. */
const EN_MSGS = String.raw`(?:messages?|msgs?|texts?|sms|e-?mails?|mails?|spam|ads|adverts?|promotions?|promos?|offers?|marketing|newsletters?|notifications?|updates|broadcasts?|stuff|crap|junk|this|these|those|that|anything|everything)`;
/** Verbs that can only mean writing to the buyer: "stop messaging me". */
const EN_REACH = String.raw`(?:messag|msg|txt|text|contact|writ|spam|bother|harass|pester|disturb|ping|dm|whatsapp|hound|chas|bugg|nag|follow(?:ing)?\s+up\s+with)\w*`;
const EN_AGAIN = String.raw`(?:again|anymore|any\s+more|ever|no\s+more)`;

const EN: readonly RegExp[] = [
  // "stop messaging me", "please stop texting", "stop contacting us", "stop writing to me"
  new RegExp(String.raw`(?<!\b(?:don't|dont|not|never|can't|cant|won't|wont|didn't|didnt)\s)\b(?:stop|quit|cease)\s+(?:\w+\s+){0,2}?${EN_REACH}`),
  /\bcease\s+and\s+desist\b/,
  // "I have asked you to stop", "I already told you to stop messaging me"
  /\bi\s+(?:have\s+|already\s+|have\s+already\s+|'ve\s+)?(?:asked|told)\s+(?:you|u)(?:\s+\w+){0,2}?\s+to\s+stop\b/,
  // "stop this nonsense", "stop all this crap"
  /\bstop\s+(?:this|that|the|all\s+(?:this|the|these)|these|your)\s+(?:nonsense|crap|bs|bullshit|rubbish|junk|harass?ment|madness)\b/,
  // "I am not interested stop", "no thanks stop"
  /\b(?:interested|thanks|thank\s+you|thx|no|nope)\s+stop\s*[.!]*\s*$/,
  // "Stop. Not interested.", "STOP - wrong number"
  /(?:^|[.!?,;:\n]\s*)stop\s*[.!,;:—–-]+\s*(?:i'?m\s+|i\s+am\s+)?(?:not\s+interested|no\s+thanks|no\s+thank\s+you|wrong\s+number|leave\s+me\s+alone|do\s+not|don't|dont|never|unsubscribe|remove\s+me)/,
  // "don't msg me", "pls dont text", "do not message this number"
  /\b(?:do\s+not|don't|dont|never)\s+(?:ever\s+)?(?:message|msg|txt|text|contact|whatsapp|dm)\s*(?:me|us|this\s+number|my\s+number)?\s*(?:$|[.!,;]|please|pls|plz|again|anymore|any\s+more|ever)/,
  /\b(?:do\s+not|don't|dont|never)\s+(?:message|msg|text|contact|call|whatsapp)\s+(?:this|my)\s+number\b/,
  // "please remove me", "remove this number", "take me off"
  /\b(?:remove|delete)\s+(?:me|this\s+number|my\s+number)\s*(?:$|[.!,;]|please|pls|plz|thanks|thank\s+you)/,
  /\btake\s+(?:me|this\s+number|my\s+number)\s+off\s*(?:$|[.!,;]|please|pls|(?:of\s+)?(?:your|the|this|ur)\s+(?:\w+\s+)?(?:list|contacts?|database|broadcasts?|group))/,
  // "i said stop", "u can stop now", "can you stop", "I told you to stop"
  /\b(?:i\s+said|i\s+told\s+you(?:\s+to)?|told\s+you(?:\s+to)?|i\s+say|u\s+can|you\s+can|can\s+(?:you|u)|could\s+(?:you|u)|will\s+(?:you|u)|would\s+(?:you|u)|pls\s+just|please\s+just)\s+stop(?:\s+(?:it|now|please|pls|already|that|this|messaging(?:\s+me)?|texting(?:\s+me)?))?\s*[.!]*\s*$/,
  // "stop sending me messages", "stop sending these", "stop sending" (the clause ends)
  new RegExp(String.raw`\bstop\s+send(?:ing)?\s+(?:me\s+|us\s+)?(?:any\s+|more\s+|these\s+|those\s+|your\s+|the\s+|all\s+)*${EN_MSGS}\b`),
  new RegExp(String.raw`\bstop\s+send(?:ing)?\s*(?:me|us)?\s*(?:$|[.!,;]|please|pls|plz)`),
  // "don't message me", "do not contact me", "never text me again", "dont write to me"
  new RegExp(String.raw`\b(?:do\s+not|don't|dont|never|pls\s+don't|please\s+don't|please\s+do\s+not)\s+(?:ever\s+)?(?:message|contact|write(?:\s+to)?|bother|spam|harass|disturb|pester|dm|whatsapp|ping)\s+(?:me|us)\b`),
  // a channel's own verb only with "again" / "anymore": "don't text me again", "don't email me anymore"
  new RegExp(String.raw`\b(?:do\s+not|don't|dont|never)\s+(?:ever\s+)?(?:text|e-?mail|call|send\s+(?:me|us)\s+anything)\s+(?:me\s+|us\s+)?${EN_AGAIN}\b`),
  // "don't send me messages", "do not send me any more texts"
  new RegExp(String.raw`\b(?:do\s+not|don't|dont)\s+send\s+(?:me|us)\s+(?:any\s+|more\s+|your\s+|these\s+)*(?:messages?|msgs?|texts?|e-?mails?|spam|ads|promotions?|offers?|marketing|newsletters?|anything)\b`),
  // "no more messages", "enough with the texts"
  new RegExp(String.raw`\b(?:no\s+more\s+|enough\s+(?:with\s+)?(?:the\s+|your\s+)?)(?:messages?|msgs?|texts?|e-?mails?|spam|marketing|promotions?|promos?|ads|offers?|newsletters?)\b`),
  // "I don't want any more messages", "I do not want to receive your texts", "I don't want to hear from you"
  new RegExp(String.raw`\b(?:i|we)\s+(?:do\s+not|don't|dont)\s+want\s+(?:to\s+(?:receive|get|see)\s+)?(?:any\s+(?:more\s+)?|more\s+|your\s+|ur\s+|these\s+|those\s+)*(?:messages?|msgs?|texts?|e-?mails?|spam|marketing|promotions?|ads|offers?|newsletters?)\b`),
  /\b(?:i|we)\s+(?:do\s+not|don't|dont)\s+want\s+to\s+(?:hear\s+from\s+you|be\s+(?:contacted|messaged|texted|bothered)|receive\s+anything|get\s+anything)\b/,
  /\b(?:i|we)\s+(?:do\s+not|don't|dont)\s+want\s+(?:to\s+be\s+on\s+)?(?:your|this|the)\s+(?:mailing\s+|marketing\s+|broadcast\s+)?list\b/,
  // "leave me alone", "unsubscribe", "opt me out", "lose my number"
  /\bleave\s+(?:me|us)\s+alone\b/,
  // "unsubscribe" and the ways it is mistyped: unsub, unsubcribe, unsubscibe, unsuscribe
  /\bun-?\s?su(?:b|s|bs)\w*/,
  /\bopt\s*-?\s*(?:me\s+)?out\b/,
  /\b(?:lose|forget)\s+my\s+(?:number|contact)\b/,
  // "remove me from your list", "take me off your mailing list", "delete me from the broadcast"
  /\b(?:remove|take|delete|drop|erase)\s+(?:me|us|my\s+number|this\s+number)\s+(?:off|from|out\s+of)\s+(?:your|the|this|ur|all|any)\s+(?:\w+\s+){0,2}?(?:list|lists|contacts?|database|broadcasts?|groups?|system|records?|mailing)\b/,
  // "I will block you", "I'm going to report this number"
  /\b(?:i|we)(?:'ll|\s+will|\s+am\s+going\s+to|'m\s+going\s+to|\s+are\s+going\s+to)\s+(?:block|report)\s+(?:you|this\s+number|ur\s+number|your\s+number)\b/,
  // The last sentence is "stop": "not interested. stop", "pls stop!!", "Stop, please."
  /(?:^|[.!,;:\n]\s*|\s-\s*)(?:(?:please|pls|plz|just|ok|okay|now|so|then|and)\s+)?stop(?:\s+(?:it|now|please|pls|plz|already|that|this|messaging|thanks|thank\s+you))?\s*[.!]*\s*$/,
  // "please stop" / "stop please" anywhere, as a sentence of its own
  /(?:^|[.!?,;:\n]\s*)(?:please|pls|plz|kindly)\s+stop\s*(?:[.!,;]|$)/,
  /(?:^|[.!?,;:\n]\s*)stop\s+(?:please|pls|plz)\s*(?:[.!,;]|$)/,
];

// ── 中文 ─────────────────────────────────────────────────────────────────────
// 别/不要/不用/勿 + (再) + (给我) + 发 + 了/消息/信息… — never 不要发货 (don't ship), 别再发错了 (don't send the wrong one).
const ZH_DONT = '(?:别|不要|不用|勿|请勿|不准|不许|甭|别再|不要再|不用再|请不要|请别|麻烦别|麻烦不要|你们别|你们不要)';
/**
 * 别再发了 / 不要再给我发消息 / 别发广告. Read with what comes before it: after the
 * thing shipped (这批别发了, 货先不要发了) it is the order — `ZH_SHIPPED_BEFORE`.
 */
const ZH_SEND: readonly RegExp[] = [
  new RegExp(`${ZH_DONT}(?:再|在)?(?:给我|跟我|向我|对我|往我这)?(?:发|发送|推送|群发|推|乱发)(?:消息|信息|短信|讯息|广告|推广|这些|这种|那些|垃圾|邮件|微信|过来)`),
  new RegExp(`(?:别|不要|请勿|勿|不准|不许|请不要|请别)(?:再|在)(?:给我|跟我|向我)?(?:发|发送|推送|群发)(?!错|货|快递|样|顺丰|物流|包裹|过去|给他|给她|地址)(?:了|啦|啊)?`),
  new RegExp(`(?:别|不要|请不要|请别)(?:给我|跟我|向我)(?:发|发送|推送|群发)(?!错|货|快递|样|顺丰|物流|包裹|过去|地址)(?:了|啦|啊)?`),
  /(?:以后|今后)(?:都)?(?:别|不要|不用)(?:再)?(?:发|联系)了/,
  /(?<![不用])别发了/,
];
const ZH: readonly RegExp[] = [
  new RegExp(`${ZH_DONT}(?:再|在)?(?:联系|打扰|骚扰|烦|找|微我|私信|私聊)(?:我|我们)`),
  new RegExp(`${ZH_DONT}(?:再|在)?(?:打扰|骚扰|烦人)(?:了|啦|啊)?(?:$|[。,!！])`),
  new RegExp(`${ZH_DONT}(?:再|在)?(?:给我|跟我)打电话`),
  /退订|取消订阅|取消关注|拒收|退出名单|退出列表|移出名单|拉黑你|把你拉黑|屏蔽你|别骚扰|勿扰|请勿打扰/,
  /再发(?:我就|就|我)?(?:投诉|举报|拉黑|报警|屏蔽)/,
  /把我(?:删了|删掉|删除|移除|拉黑)/,
  /(?:从|把我从)(?:你们的)?(?:名单|列表|通讯录|群发列表)(?:里|中)?(?:删|移|去)(?:除|掉)?/,
  /(?:请|麻烦)?停止(?:发送|推送|发|给我发|联系|骚扰|打扰|群发)/,
  /不(?:想|要|需要|愿意)(?:再)?(?:收到|接到|看到|接收)(?:你们的|你的|任何)?(?:消息|信息|短信|广告|推送|推广|邮件)/,
  /(?:我)?不需要(?:你们的|你的)?(?:消息|信息|推送|广告|推广)(?:了)?/,
  /不(?:想|要|需要|愿意)(?:再)?(?:收到|接收|接到)(?:了|啦)?\s*[。!！]*$/,
];
/** Who 别发了 is about, when the thing shipped is named before it: 这批别发了, 货先不要发了 — an order, not the messages. */
const ZH_SHIPPED_BEFORE = /(?:货|这批|那批|这个|那个|样品|快递|包裹|订单|单子|这单|那单|产品|东西先)\s*(?:先|就|也|都)?\s*$/;

// ── العربية — folded text ───────────────────────────────────────────────────
/** "Don't": MSA, Gulf, Egyptian, Levantine, Darija. */
const AR_DONT = String.raw`(?:لا|ما|مش|مو|ماعاد|لا\s+عاد|ما\s+عاد|ارجو\s+ان\s+لا|يرجي\s+عدم)`;
/** Writing to me, in the forms a buyer types; each can only mean messages. */
const AR_WRITE_ME = String.raw`(?:تراسلني|تراسلوني|تراسلنا|تراسلونا|تكاتبني|تكاتبوني|تبعتلي|تبعتولي|تبعتلنا|تبعتوا\s+لي|تكتبلي|تكتبولي|تتواصل\s+معي|تتواصلوا\s+معي|تتواصلون\s+معي|تتواصلي\s+معي|تزعجني|تزعجوني|تزعجنا|تضايقني|تضايقوني|تتصل\s+بي\s+(?:مره|مرة)\s+(?:ثانيه|ثانية|اخري|تانيه|تانية)|تكلمني\s+تاني|تكلموني\s+تاني)`;
/** "Send me", which needs messages after it — «لا ترسل لي الشحنة» is the order. */
const AR_SEND_ME = String.raw`(?:ترسل\s+لي|ترسلوا\s+لي|ترسلون\s+لي|ترسلي\s+لي|ترسلين\s+لي|ترسللي|ترسلولي|تبعت\s+لي|تبعث\s+لي|تبعثلي|تبعثولي|تكتب\s+لي|تكتبوا\s+لي|تكتبون\s+لي|تبعتوا\s+لي)`;
const AR_MSGS = String.raw`(?:رسائل|الرسائل|رسايل|الرسايل|رساله|رسالة|مسجات|المسجات|ميساجات|الميساجات|مساجات|المساجات|اعلانات|الاعلانات|عروض|العروض|اي\s+شي|اي\s+شيء|شيء|شي|اشي|حاجه|حاجة|حاجات|حد|اي\s+حاجه|اي\s+حاجة)`;
const AR_AGAIN = String.raw`(?:مره\s+(?:ثانيه|ثانية|تانيه|تانية|اخري)|مرة\s+(?:ثانيه|ثانية|تانيه|تانية|اخري)|تاني|ثاني|بعد\s+(?:اليوم|الان|كذا)|ابدا|مجددا|نهائيا|خلاص)`;
const AR_STOP_V = String.raw`(?:التوقف|الكف|ايقاف|توقيف|بلاش|توقف|توقفوا|توقفي|اوقف|اوقفوا|اوقفي|وقف|وقفوا|وقفي|بطل|بطلوا|بطلي|كفايه|كفاية|كفي|كفا|بس|خلاص|حبس|حبسو|حبسي|سد|سدو|باراكا|بركا|براكا|يكفي)`;
const AR_STOP_OBJ = String.raw`(?:عن\s+)?(?:مراسلتي|مراسلتنا|ارسال\s+(?:ال)?(?:رسائل|رسايل|مسجات)|ارسال|الارسال|الرسائل|الرسايل|رسائل|رسايل|رسائلكم|رسايلكم|المسجات|مسجات|الميساجات|ميساجات|المساجات|مساجات|الميساج|الازعاج|ازعاجي|ازعاجنا|التواصل\s+معي|الاتصال\s+بي|ازعاج|تبعتلي|تبعتولي|تراسلني|تراسلوني|ترسل\s+لي|ترسلوا\s+لي|تصيفط|تصيفطو|تصيفطلي|تصيفطولي)`;

const AR_PATTERNS: readonly RegExp[] = [
  // «لا تراسلني», «لا تتواصلوا معي», «ما عاد تراسلني», «مش تبعتلي»
  new RegExp(`${NA}${AR_DONT}\\s*${AR_WRITE_ME}${NZ}`),
  // «ماتبعتليش», «متبعتليش تاني», «ماتراسلنيش», «ماتزعجنيش» — the joined Egyptian / Darija negation
  new RegExp(`${NA}(?:ما|م)ت(?:بعتلي|بعتولي|راسلني|راسلوني|زعجني|زعجوني|كلمني|كلموني|صيفطلي|صيفطولي|صيفط|صيفطو|بعثلي|كتبلي)(?:ش|شي)${NZ}`),
  // «لا ترسل لي رسائل», «لا ترسلوا لي أي شيء», «لا ترسل لي مرة ثانية»
  new RegExp(`${NA}${AR_DONT}\\s*${AR_SEND_ME}\\s+(?:اي\\s+|المزيد\\s+من\\s+|اكثر\\s+)?(?:${AR_MSGS}|${AR_AGAIN})${NZ}`),
  new RegExp(`${NA}${AR_DONT}\\s*${AR_SEND_ME}\\s*$`),
  // «لا ترسلوا رسائل», «خلاص لا ترسل» — the verb with no «لي», then messages or the end
  new RegExp(`${NA}${AR_DONT}\\s*(?:ترسل|ترسلوا|ترسلون|ترسلي|تبعت|تبعتوا|تبعث|تبعثوا|تكتب|تكتبوا|تراسل|تراسلوا)\\s+(?:اي\\s+|المزيد\\s+من\\s+)?(?:رسائل|الرسائل|رسايل|الرسايل|رساله|رسالة|مسجات|ميساجات|اعلانات|عروض)${NZ}`),
  new RegExp(`${NA}${AR_DONT}\\s*(?:ترسل|ترسلوا|ترسلون|تبعت|تبعتوا|تراسل|تراسلوا|تكتب|تكتبوا)\\s*[.!،]*\\s*$`),
  // «ما ابغى اي رسالة», «انا مش عايز حاجة منكم», «ما بغيتش نتوصل بالرسائل»
  new RegExp(`${NA}(?:لا|ما|مش|مو)\\s*(?:اريد|نريد|ابغي|ابغا|ابي|بدي|عايز|عاوز|عايزه|عاوزه|حاب|بغيت|بغيتش|بغيناش)\\s+(?:اي\\s+)?(?:رساله|رسالة|حاجه\\s+منكم|حاجة\\s+منكم|شي\\s+منكم|شيء\\s+منكم|اي\\s+حاجه|اي\\s+حاجة|منكم\\s+(?:شي|شيء|حاجه|حاجة|رسائل|رسايل)|نتوصل\\s+(?:ب|بال)(?:رسائل|ميساجات|شي))${NZ}`),
  new RegExp(`${NA}ما\\s*بغيتش\\s+نتوصل${NZ}`),
  // «توقف عن مراسلتي», «بطلوا رسايل», «كفاية رسائل», «حبس الميساجات», «باراكا من الميساجات»
  new RegExp(`${NA}${AR_STOP_V}\\s+(?:(?:عليا|علينا|عني|عنا|معايا)\\s+)?(?:من\\s+)?(?:(?:هاد|هادو|هاذ|هذه|هاي|دي|ده)\\s+)?${AR_STOP_OBJ}${NZ}`),
  // «لا أريد رسائل», «ما ابي رسايل», «مش عايز رسايل تاني», «لا اريد استقبال اي رسائل»
  new RegExp(`${NA}(?:لا|ما|مش|مو)\\s+(?:اريد|نريد|ابغي|ابغا|ابي|بدي|بدنا|عايز|عاوز|عايزه|عاوزه|حاب|احب|بغيت)\\s+(?:اي\\s+|استقبال\\s+|تلقي\\s+|وصول\\s+|المزيد\\s+من\\s+|منكم\\s+)*(?:رسائل|الرسائل|رسايل|الرسايل|مسجات|ميساجات|اعلانات|عروض|رسائلكم|رسايلكم|اي\\s+(?:شي|شيء)\\s+منكم)${NZ}`),
  // Darija: «ما بغيتش الميساجات», «ماتبقاش تصيفط ليا», «ما تعاودش تصيفط»
  new RegExp(`${NA}ما\\s*(?:بغيتش|بغيناش|بغيت\\s+حتي)\\s+(?:هاد\\s+)?(?:الميساجات|الميساج|الرسائل|الرسايل|المساجات|ميساجات|رسائل)${NZ}`),
  new RegExp(`${NA}(?:ما|م)\\s*(?:تبقاش|تبقاوش|تعاودش|تعاودوش|تزيدش|تزيدوش)\\s+(?:ت)?(?:صيفط|صيفطو|صيفطي|راسل|راسلني|كتب|بعث|بعت|عيط)`),
  // «إلغاء الاشتراك», «ألغوا اشتراكي», «احذفني من القائمة», «شيلني من عندكم»
  new RegExp(`${NA}(?:الغاء|الغي|الغوا|اوقف|اوقفوا)\\s+(?:ال)?(?:اشتراك|اشتراكي|الاشتراك|التسجيل)${NZ}`),
  new RegExp(`${NA}(?:احذفني|احذفوني|امسحني|امسحوني|شيلني|شيلوني|ازلني|ازيلوني|اخرجني|اخرجوني|طلعني|طلعوني)\\s+من\\s+(?:القائمه|القائمة|قائمتكم|قائمه|قائمة|عندكم|الليست|الجروب|المجموعه|المجموعة|قوائمكم)${NZ}`),
  // «اتركني في حالي», «سيبني في حالي», «خليني فحالي», «خلوني بحالي»
  new RegExp(`${NA}(?:اتركني|اتركوني|سيبني|سيبوني|خليني|خلوني|خلني|دعني|دعوني)\\s+(?:في\\s+|ف|ب)?(?:حالي|شاني|وشاني|راحتي)${NZ}`),
  // «ابعدوا عني», «ابعد عني» — stay away from me
  new RegExp(`${NA}(?:ابعد|ابعدوا|ابعدو|ابعدي|ابتعد|ابتعدوا|انقلع|انقلعوا)\\s+عني${NZ}`),
  // «أرجو عدم مراسلتي», «عدم الإزعاج»
  new RegExp(`${NA}(?:ارجو|ارجوا|نرجو|يرجي|برجاء|رجاء)?\\s*عدم\\s+(?:مراسلتي|مراسلتنا|الازعاج|ازعاجي|التواصل\\s+معي|الاتصال\\s+بي|ارسال\\s+(?:ال)?(?:رسائل|رسايل))${NZ}`),
  // «سأحظرك», «راح ابلك بلوك»
  new RegExp(`${NA}(?:ساحظرك|سوف\\s+احظرك|راح\\s+احظرك|بعملك\\s+بلوك|هعملك\\s+بلوك|راح\\s+اسويلك\\s+بلوك|غادي\\s+نبلوكيك)${NZ}`),
];

/** Darija and Egyptian in Latin letters (Arabizi): "matb9ach tsiftli", "7bes les messages", "matb3atlish tany". */
const ARABIZI: readonly RegExp[] = [
  /\b(?:ma\s*)?t?b9a(?:ch|sh|w(?:ch|sh))\s+(?:t|ts)?(?:sift|sifet|sayft|seft|sifto|rasel|kteb|ba3t|b3at)\w*/,
  /\bma\s*t(?:sift|sifet|seft)(?:li|lia|liya)?(?:ch|sh)\b/,
  /\bmatsift(?:li|lia)?(?:ch|sh)\b/,
  /\b(?:7bes|hbes|7bsso|baraka|safi|sedd?)\s+(?:mn|men|من)?\s*(?:had\s+)?(?:les\s+|l)?(?:messages?|msgs?|missajat|mesajat|misajat|massajat|sms)\b/,
  /\bma\s*bghit(?:ch|sh)\s+(?:had\s+)?(?:les\s+|l)?(?:messages?|msgs?|missajat|mesajat|misajat)\b/,
  /\b(?:ma\s*)?tb3atli(?:sh|ch)\b/,
  /\bbatt?al(?:o|ou)?\s+(?:teb3at|tb3at|tbaat)\w*/,
  /\b(?:matrasalnich|ma\s*trasalnich|matkallemnich)\b/,
  /\bsafi\s+baraka\b|\bbaraka\s+(?:3lia|3liya|3lina|3lih|mn|men|alia)\b/,
];

// ── Español · Français · Português ──────────────────────────────────────────
const ES: readonly RegExp[] = [
  // "deja de escribirme", "dejen de mandarme mensajes", "deja de molestarme"
  new RegExp(String.raw`${NL}(?:deja|dejen|dejad|deje|dejes|parad|paren|para)\s+de\s+(?:escribirme|mandarme|enviarme|contactarme|molestarme|molestar|fastidiar|spamearme|mensajearme|escribirnos|mandarnos|enviarnos|contactarnos|molestarnos|acosarme|insistir|escribir|mandar\s+(?:mensajes|correos|publicidad|spam)|enviar\s+(?:mensajes|correos|publicidad|spam))${NR}`),
  // "no quiero que me escriban más"
  new RegExp(String.raw`${NL}no\s+(?:quiero|queremos|deseo)\s+que\s+(?:me|nos)\s+(?:escriban|escribas|manden|mandes|envíen|envien|envíes|envies|contacten|contactes|molesten|molestes|llamen|llames)${NR}`),
  // "no me escribas más", "no me contactes", "no me mandes más mensajes", "ya no me escriban"
  new RegExp(String.raw`${NL}(?:ya\s+)?no\s+(?:me|nos)\s+(?:escribas|escriban|escribáis|contactes|contacten|molestes|molesten|spamees|acoses)${NR}`),
  new RegExp(String.raw`${NL}(?:ya\s+)?no\s+(?:me|nos)\s+(?:mandes|manden|envíes|envies|envíen|envien|llames|llamen)\s+(?:más|mas|nunca|nada|otra\s+vez|(?:más\s+|mas\s+)?(?:mensajes|correos|publicidad|promociones|ofertas|spam))${NR}`),
  // "no quiero recibir más mensajes", "no quiero más publicidad"
  new RegExp(String.raw`${NL}no\s+(?:quiero|queremos|deseo)\s+(?:recibir\s+)?(?:más\s+|mas\s+|ningún\s+|ningun\s+|ninguna\s+|sus\s+|tus\s+)*(?:mensajes?|correos?|emails?|publicidad|promociones|ofertas|spam|notificaciones|nada\s+(?:de\s+(?:ustedes|ti|vosotros)|más|mas))${NR}`),
  // "dame de baja", "darme de baja", "cancelar suscripción", "sácame de la lista"
  new RegExp(String.raw`${NL}(?:dame|denme|darme|deme|dadme|me\s+dan|me\s+das)\s+de\s+baja${NR}`),
  new RegExp(String.raw`${NL}(?:cancelar|cancela|cancelen|anular)\s+(?:la\s+|mi\s+)?suscripci[oó]n${NR}`),
  new RegExp(String.raw`${NL}desuscrib\w*|${NL}desinscrib\w*`),
  new RegExp(String.raw`${NL}(?:s[aá]came|s[aá]quenme|qu[ií]tame|qu[ií]tenme|b[oó]rrame|b[oó]rrenme|elim[ií]name|elim[ií]nenme)\s+de\s+(?:la|tu|su|esta|vuestra|sus|tus)\s+(?:\w+\s+)?(?:lista|listas|difusi[oó]n|base|grupo|contactos)${NR}`),
  // "déjame en paz", "basta de mensajes", "ya no me escribas"
  new RegExp(String.raw`${NL}(?:d[eé]jame|d[eé]jenme|dejadme)\s+en\s+paz${NR}`),
  new RegExp(String.raw`${NL}(?:basta|ya\s+basta|suficiente)\s+(?:de\s+|con\s+)(?:los\s+|tus\s+|sus\s+)?(?:mensajes|correos|spam|publicidad|promociones)${NR}`),
  new RegExp(String.raw`${NL}(?:te|los|les|lo)\s+voy\s+a\s+(?:bloquear|reportar|denunciar)${NR}`),
];

const FR: readonly RegExp[] = [
  // "arrêtez de m'écrire", "arrête de m'envoyer des messages", "arrêtez de me contacter"
  new RegExp(String.raw`${NL}(?:arr[eê]te[sz]?|arr[eê]tez|arr[eê]ter|cessez|cesse|cesser)\s+de\s+(?:m'|me\s+|nous\s+)?(?:[ée]crire|envoyer|contacter|d[ée]ranger|harceler|spammer|appeler|relancer|texter|solliciter|inonder)`),
  // "ne m'écrivez plus", "ne me contactez plus", "ne m'envoyez plus rien"
  new RegExp(String.raw`${NL}ne\s+(?:m'|me\s+|nous\s+)(?:[ée]crivez|[ée]cris|envoyez|envoie|envoyer|contactez|contacte|d[ée]rangez|d[ée]range|appelez|relancez|relance|sollicitez)\s+plus${NR}`),
  // "je ne veux plus recevoir de messages", "je ne veux plus de vos mails", "je ne veux plus être contacté"
  new RegExp(String.raw`${NL}(?:je|nous|on)\s+(?:ne\s+)?(?:veux|voulons|veut|souhaite|souhaitons)\s+plus\s+(?:recevoir\s+)?(?:de\s+|vos\s+|des\s+|aucun\s+|aucune\s+|tes\s+)?(?:messages?|mails?|e-?mails?|sms|pubs?|publicit[ée]s?|offres|promotions?|newsletters?|notifications?|relances?|rien)${NR}`),
  new RegExp(String.raw`${NL}(?:je|nous)\s+(?:ne\s+)?(?:veux|voulons|souhaite)\s+plus\s+(?:[êe]tre\s+(?:contact[ée]e?s?|sollicit[ée]e?s?|d[ée]rang[ée]e?s?)|qu'on\s+me\s+(?:contacte|[ée]crive))${NR}`),
  // "désabonnez-moi", "me désinscrire", "retirez-moi de votre liste"
  new RegExp(String.raw`${NL}d[ée]sabonn\w*|${NL}d[ée]sinscri\w*`),
  new RegExp(String.raw`${NL}(?:retirez|retire|enlevez|enl[eè]ve|supprimez|supprime|sortez|sors)[-\s](?:moi|nous)\s+de\s+(?:la|votre|vos|ta|tes|cette)\s+(?:\w+\s+)?(?:liste|listes|diffusion|fichier|base|groupe)${NR}`),
  // "laissez-moi tranquille", "foutez-moi la paix", "plus de messages svp"
  new RegExp(String.raw`${NL}(?:laissez|laisse|laissez[-\s]nous)[-\s]moi\s+tranquille${NR}|${NL}(?:foutez|fichez|fiche|fous)[-\s]moi\s+la\s+paix${NR}`),
  new RegExp(String.raw`${NL}(?:plus\s+de|assez\s+de|ras\s+le\s+bol\s+des?)\s+(?:vos\s+|ces\s+|tes\s+)?(?:messages|mails|e-?mails|sms|pubs?|publicit[ée]s|spams?|relances)${NR}`),
  new RegExp(String.raw`${NL}je\s+vais\s+vous\s+(?:bloquer|signaler)${NR}`),
  // "merci de ne plus me contacter", "ne plus m'envoyer de messages"
  new RegExp(String.raw`${NL}ne\s+plus\s+(?:m'|me\s+|nous\s+)?(?:envoyer|[ée]crire|contacter|d[ée]ranger|relancer|appeler|solliciter|harceler)${NR}`),
];

const PT: readonly RegExp[] = [
  // "pare de me mandar mensagens", "para de me mandar mensagem", "parem de me encher"
  new RegExp(String.raw`${NL}(?:pare|para|parem|parar|pode\s+parar)\s+de\s+(?:me\s+|nos\s+)?(?:mandar|enviar|escrever|contatar|contactar|ligar|incomodar|perturbar|chamar|encher|importunar|spamar)`),
  // "não me mande mais mensagens", "não me escreva mais", "não me incomode", "não me contate"
  new RegExp(String.raw`${NL}n[aã]o\s+(?:me|nos)\s+(?:mande|mandem|manda|envie|enviem|escreva|escrevam|ligue|liguem|chame|chamem)\s+(?:mais|nunca|nada)${NR}`),
  new RegExp(String.raw`${NL}n[aã]o\s+(?:me|nos)\s+(?:incomode|incomodem|perturbe|perturbem|contate|contatem|contacte|importune)${NR}`),
  // "não quero mais receber mensagens", "não quero mais propaganda"
  new RegExp(String.raw`${NL}n[aã]o\s+(?:quero|queremos|desejo)\s+(?:mais\s+)?(?:receber\s+)?(?:mais\s+|nenhuma\s+|nenhum\s+|suas\s+|seus\s+)*(?:mensage(?:m|ns)|msgs?|e-?mails?|propagandas?|promo[cç][õo]es|ofertas|spam|notifica[cç][õo]es|nada\s+(?:de\s+voc[eê]s|mais))${NR}`),
  // "me descadastre", "descadastrar", "cancelar inscrição", "me tira dessa lista", "sair da lista"
  new RegExp(String.raw`${NL}descadastr\w*`),
  new RegExp(String.raw`${NL}n[aã]o\s+(?:quero|queremos)\s+(?:receber\s+)?(?:mais\s+nada|nada\s+mais)${NR}`),
  new RegExp(String.raw`${NL}n[aã]o\s+(?:quero|queremos)\s+que\s+(?:me|nos)\s+(?:mandem|mande|enviem|envie|escrevam|escreva|liguem|ligue|contatem|contate|incomodem|incomode)${NR}`),
  new RegExp(String.raw`${NL}(?:cancelar|cancela|cancelem)\s+(?:a\s+|minha\s+)?(?:inscri[cç][aã]o|assinatura)${NR}`),
  new RegExp(String.raw`${NL}(?:me\s+)?(?:tira|tire|tirem|remove|remova|removam|exclui|exclua|apaga|apague)(?:[-\s]me)?\s+(?:da|dessa|desta|de\s+sua|de\s+tua|do|desse|deste)\s+(?:\w+\s+)?(?:lista|listas|transmiss[aã]o|grupo|cadastro|contatos)${NR}`),
  new RegExp(String.raw`${NL}(?:quero\s+)?sair\s+(?:da|dessa|desta)\s+(?:lista|transmiss[aã]o|grupo)${NR}`),
  // "me deixa em paz", "chega de mensagens"
  new RegExp(String.raw`${NL}(?:me\s+deix[ae]|deixe[-\s]me|deixa[-\s]me|me\s+deixem)\s+em\s+paz${NR}`),
  new RegExp(String.raw`${NL}(?:chega|basta)\s+de\s+(?:mensage(?:m|ns)|msgs?|spam|propagandas?|e-?mails?|promo[cç][õo]es)${NR}`),
  new RegExp(String.raw`${NL}(?:vou\s+(?:te|lhe|voc[eê]s?)\s+(?:bloquear|denunciar)|vou\s+bloquear\s+(?:voc[eê]s?|esse\s+n[uú]mero))${NR}`),
];

/**
 * The general shapes, in every Latin-script language at once — a phrase list
 * alone missed a third of a held-out set:
 *   · a stop word, then a word for the messages, in the same clause: "stop the
 *     messages", "arrêtez les messages", "para com essas mensagens";
 *   · a stop word ending the message, after a comma or a stop: "not
 *     interested, arrêtez", "spam, basta", «...، كفاية»;
 *   · calling it spam: "this is spam", "c'est du spam", «هذا سبام», 垃圾短信;
 *   · a threat to block or report the sender.
 * Never Spanish or Portuguese "para" alone ("para los mensajes" is "for the
 * messages"), never "deja" ("deja un mensaje" is "leave a message").
 */
const LATIN_STOP = String.raw`(?:stop|quit|cease|enough\s+(?:with|of)|basta|paren|parad|arr[eê]tez|arr[eê]te|cessez|assez\s+(?:de|avec)|pare|parem|chega|para\s+com|para\s+de\s+mandar|deja\s+de\s+mandar)`;
const LATIN_MSGS = String.raw`(?:messages?|msgs?|texts?|spam|spams|e-?mails?|mails?|ads|adverts?|promotions?|promos?|offers?|marketing|newsletters?|notifications?|mensajes?|correos?|publicidad|promociones|ofertas|sms|pubs?|publicit[ée]s?|relances?|mensage(?:m|ns)|propagandas?|promo[cç][õo]es|whatsapps?)`;
const GENERAL: readonly RegExp[] = [
  new RegExp(String.raw`${NL}${LATIN_STOP}\s+(?:[^\s.,;!?]+\s+){0,2}?${LATIN_MSGS}${NR}`),
  new RegExp(String.raw`(?:^|[.!?,;:\n—–]\s*|\s-\s*)(?:(?:ok|okay|so|then|and|now|please|pls|y|et|e|alors|ya|j[aá])\s+)?(?:stop|enough|basta|ya\s+basta|paren|alto\s+ya|arr[eê]tez|arr[eê]te|assez|[çc]a\s+suffit|cessez|pare|parem|chega|para\s+com\s+isso|para\s+ya)\s*[.!]*\s*$`),
  new RegExp(String.raw`(?:^|[.!?,;:،\n]\s*)(?:بس\s+)?(?:توقف|توقفوا|كفايه|كفاية|كفي|كفى|باراكا|بركا|براكا|حبس|حبسو|ستوب)\s*[.!]*\s*$`),
  /(?:^|[。,!！?？\n])\s*(?:停|停止|够了|别发了|别再发了|退订)\s*[。!！]*$/,
  /\b(?:this\s+is|that's|thats|it's|its|stop\s+the|stop|no\s+more|enough|such)\s+(?:a\s+|the\s+|all\s+this\s+)?spam\b|(?:^|[.!?,;:\n]\s*)spam\s*[.!]*\s*$|c'est\s+du\s+spam|\bes\s+spam\b|\b[ée]\s+spam\b/,
  new RegExp(`${NA}(?:هذا|هذه|هاد|ده|دي|كله|كلها|رسائل|رسايل)\\s+(?:سبام|ازعاج|مزعج|مزعجه|مزعجة)${NZ}`),
  /垃圾信息|垃圾短信|垃圾广告|骚扰信息|骚扰短信/,
  // a threat to block or report
  /\b(?:i(?:'ll|\s+will|\s+am\s+going\s+to|'m\s+going\s+to|'m\s+gonna|\s+gonna)|we(?:'ll|\s+will))\s+(?:block|report)\s+(?:you|u|this|your|ur)\b|\b(?:blocked|blocking)\s+(?:you|this\s+number)\b/,
  new RegExp(`${NA}(?:و|ف)?(?:(?:اعمل|اعملك|هعملك|بعملك|حعملك|راح\\s+اعملك|اسوي|اسويلك|راح\\s+اسويلك|نديرلك|غادي\\s+نديرلك|حطيتك|عملتلك|سويتلك|درتلك)\\s+(?:لك\\s+)?بلوك|ابلوكك|نبلوكيك|نبلوكيك|بلوكيتك|احظرك|احظركم|حظرتك|حظرتكم|ابلغ\\s+عنك|ابلغ\\s+عنكم)${NZ}`),
  new RegExp(String.raw`${NL}(?:te|los|les|vous|lhe)\s+(?:voy\s+a\s+|vais\s+|vou\s+)?(?:bloquear|bloquer|denunciar|signaler)|${NL}(?:vou|voy\s+a|je\s+vais)\s+(?:te\s+|vous\s+|lhe\s+)?(?:bloquear|bloquer|denunciar|signaler)${NR}`),
];

const ANYWHERE: readonly RegExp[] = [...EN, ...ZH, ...AR_PATTERNS, ...ARABIZI, ...ES, ...FR, ...PT, ...GENERAL];

/**
 * A stop that may not be about the messages — read by a person, never
 * recorded: "stop" as a sentence with more after it ("Stop! wrong address"),
 * and a stop aimed at the machine ("stop the bot", "no more auto replies",
 * 别用机器人回复了, «توقفوا عن الرد الآلي») — the buyer may want someone, not silence.
 */
const UNSURE_ANYWHERE: readonly RegExp[] = [
  /(?:^|[.!?,;:\n]\s*)(?:(?:please|pls|plz|ok|okay)\s+)?stop\s*[.!,;:—–-]+\s*\S/,
  /\bstop\s+(?:the|this|your|ur|with\s+(?:the|these|this|your|all\s+(?:the|these)))\s+(?:\w+\s+)?(?:chat\s?bots?|bots?|robots?|auto[-\s]?repl\w*|automated|automatic|machine)/,
  /\bno\s+more\s+(?:chat\s?bots?|bots?|robots?|auto[-\s]?repl\w*|automated|automatic)\b/,
  /(?:别|不要|别再|不要再|关掉|取消)(?:用)?(?:机器人|自动回复|智能客服)/,
  new RegExp(`${NA}${AR_STOP_V}\\s+(?:عن\\s+)?(?:الرد\\s+الالي|الردود\\s+الالي[هة]|الروبوت|البوت|روبوت|رد\\s+الي)`),
  new RegExp(String.raw`${NL}(?:deja|dejen|para|paren|basta|arr[eê]tez|arr[eê]te|cessez|pare|parem|chega)\s+(?:de\s+|con\s+|avec\s+|les\s+|le\s+|la\s+|o\s+|a\s+|os\s+|el\s+|los\s+)*(?:bot|robot|rob[oô]|respuestas\s+autom[aá]ticas|r[ée]ponses\s+automatiques|respostas\s+autom[aá]ticas)${NR}`),
];

/** The first of `ZH_SEND` that matches with no shipped thing just before it. */
function zhSend(t: string): string | null {
  for (const p of ZH_SEND) {
    for (const m of t.matchAll(new RegExp(p.source, 'g'))) {
      if (!ZH_SHIPPED_BEFORE.test(t.slice(Math.max(0, m.index - 8), m.index))) return m[0];
    }
  }
  return null;
}

/**
 * What the words say about the messages, before anything else reads them:
 *   · `stop`   — they ask the business to stop messaging them;
 *   · `unsure` — a bare word that may stop the messages or an order ("cancel");
 *   · null     — neither.
 * `words` is what matched, for the record. Whether a stop is really an opt-out,
 * or a request for a person, is `readOptOut`'s call (core/scoring/detect.ts).
 */
export function asksToStop(text: string): { readonly kind: 'stop' | 'unsure'; readonly words: string } | null {
  const t = readableForOptOut(text ?? '');
  if (!t) return null;
  const whole = bare(t);
  if (BARE_STOP.has(whole) || BARE_STOP.has(plain(whole)) || /^(?:stop[\s!.]*){2,}$/.test(whole)) return { kind: 'stop', words: whole };
  const zh = zhSend(t);
  if (zh) return { kind: 'stop', words: zh };
  for (const p of ANYWHERE) {
    const m = p.exec(t);
    if (m) return { kind: 'stop', words: m[0] };
  }
  if (BARE_UNSURE.has(whole) || BARE_UNSURE.has(plain(whole))) return { kind: 'unsure', words: whole };
  for (const p of UNSURE_ANYWHERE) {
    const m = p.exec(t);
    if (m) return { kind: 'unsure', words: m[0] };
  }
  return null;
}

/**
 * LG — the language of the words that caught a stop, for a turn no model
 * read: the one line is said in it. Null for a keyword every language uses
 * ("STOP") or a shape that names none; the gate's own rules decide then.
 */
export function optOutLanguage(text: string): 'en' | 'zh' | 'ar' | 'es' | 'fr' | 'pt' | null {
  const t = readableForOptOut(text ?? '');
  if (!t) return null;
  if (zhSend(t)) return 'zh';
  for (const [lang, list] of [['en', EN], ['zh', ZH], ['ar', [...AR_PATTERNS, ...ARABIZI]], ['es', ES], ['fr', FR], ['pt', PT]] as const) {
    if (list.some((p) => p.test(t))) return lang;
  }
  return null;
}

// ── What turns a stop into a request for a person ───────────────────────────

/**
 * The machine as what is being stopped, or as what the buyer will not talk to:
 * "stop the bot", "no more automated messages", 不要机器人, «لا أريد روبوت». The
 * buyer is asking for someone, not for silence. "AI" / "IA" only in capitals,
 * read from the raw text: lower-cased, French «j'ai» would read as one.
 */
const MACHINE: readonly RegExp[] = [
  /\b(?:the|this|your|ur|a|an|no|stupid|damn|dumb|fucking)\s+(?:chat\s?)?(?:bot|robot)s?\b/,
  /\b(?:chat\s?bot|bot|robot)\s+(?:messages?|repl(?:y|ies)|answers?|responses?)\b/,
  /\bautomated\s+(?:messages?|repl(?:y|ies)|responses?|texts?|system|answers?)\b|\bauto[-\s]?(?:repl(?:y|ies)|respon\w*|messages?)\b/,
  /\b(?:talk|talking|speak|speaking|chat|chatting)\s+(?:to|with)\s+(?:a|an|the|this|some)\s+(?:machine|bot|robot|computer|program)\b/,
  /\bare\s+(?:you|u)\s+(?:a\s+|an\s+)?(?:bot|robot|machine|human|real)\b|\bchat\s?bot\b/,
  /机器人|自动回复|自動回覆|人工智能|智能客服|是不是真人|是机器/,
  new RegExp(`${NA}(?:روبوت|الروبوت|البوت|الرد\\s+الالي|رد\\s+الي|ردود\\s+الي[هة]|مساعد\\s+الي|ذكاء\\s+اصطناعي|الذكاء\\s+الاصطناعي)${NZ}`),
  new RegExp(String.raw`${NL}(?:hablar|hablando|conversar|parler|discuter|falar|conversando|falando)\s+(?:con|avec|[àa]|com)\s+(?:un|una|el|le|la|um|uma|o|a)?\s*(?:bot|robot|rob[oô]|m[aá]quina|machine|ia|chatbot)${NR}`),
  new RegExp(String.raw`${NL}(?:mensajes|respuestas|messages|r[ée]ponses|mensagens|respostas)\s+(?:autom[aá]tic[oa]s|automatiques|automatizad[oa]s)${NR}`),
  new RegExp(String.raw`${NL}(?:eres|es|[êe]tes|es-tu|[ée]|voc[eê]\s+[ée])\s+(?:un|una|um|uma)?\s*(?:bot|robot|rob[oô]|m[aá]quina|machine)${NR}`),
];
const MACHINE_CAPS = /\b(?:AI|A\.I\.|IA)\b/;

/**
 * A person, named the way a buyer asks for one: "a real person", 人工, «موظف»,
 * "un agente". Not "my manager", not "anyone": a stop that names one of these
 * goes to a person, so the list stays to the words that ask.
 */
const PERSON: readonly RegExp[] = [
  /\b(?:a\s+)?(?:real\s+)?(?:person|human|human\s+being|agent|representative|operator|customer\s+(?:service|support|care))\b/,
  /\bsomeone\s+(?:real|from\s+your|at\s+your|who)\b/,
  /人工|真人|客服|工作人员|人工服务/,
  new RegExp(`${NA}(?:شخص|انسان|موظف|موظفه|موظفة|بشر|خدمه\\s+العملاء|خدمة\\s+العملاء|حد\\s+(?:يرد|حقيقي|يكلمني)|احد\\s+(?:يرد|حقيقي)|بنادم)${NZ}`),
  new RegExp(String.raw`${NL}(?:persona\s+real|humano|humana|agente|asesor|asesora|personne\s+r[ée]elle|vraie\s+personne|humain|conseill[eè]re?|pessoa\s+real|atendente|atendimento\s+humano)${NR}`),
];

/** Does this message name the machine — as what to stop, or what not to talk to? */
export function namesTheMachine(text: string): boolean {
  const raw = (text ?? '').normalize('NFKC');
  if (MACHINE_CAPS.test(raw)) return true;
  const t = readableForOptOut(raw);
  return MACHINE.some((re) => re.test(t));
}

/** Does this message ask for a person in the words people use? It only ever sends a stop to a person. */
export function namesAPerson(text: string): boolean {
  const t = readableForOptOut(text ?? '');
  return PERSON.some((re) => re.test(t));
}

/**
 * The fixed line an opt-out is answered with — said once, and then nothing.
 * It promises only what is built: nothing more is sent, and a message from
 * them is answered. Nobody is addressed in a gender (rule 6), and the
 * assistant is not named — the business is speaking.
 */
export const OPT_OUT_REPLIES = {
  en: "Done — we won't send you any more messages. If you write to us again, we'll reply.",
  zh: '好的，我们不会再给你发消息。如果你再联系我们，我们会回复。',
  ar: 'تم، لن تصل أي رسائل أخرى منا. وعند الكتابة إلينا مجددًا يصل الرد.',
  es: 'Hecho: no te enviaremos más mensajes. Si nos escribes de nuevo, te responderemos.',
  fr: "C'est noté : nous ne vous enverrons plus de messages. Si vous nous écrivez à nouveau, nous vous répondrons.",
  pt: 'Combinado: não enviaremos mais mensagens. Se voltar a nos escrever, responderemos.',
} as const;
