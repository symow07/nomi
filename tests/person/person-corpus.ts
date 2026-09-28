/**
 * "WANTS A PERSON" — the corpus, shared by the layer tests
 * (tests/person/person-request.test.ts) and the turn tests
 * (tests/pipeline/person-corpus.test.ts), the way the deletion corpus is
 * (tests/parity/deletion-corpus.ts). A new phrasing goes in here with the
 * group it belongs to, never into the patterns alone.
 *
 * Three groups, in the owner's order (2026-09-28), each in en / zh / ar:
 *   1. REQUESTS — a buyer asking for a person on the SELLER's side. Every one
 *      hands off at layer 1, before any model: a miss loses a buyer.
 *   2. OTHER_MEANINGS — the words, meaning something else (a product, labour
 *      cost, the newest model, hiring). Layer 1 stays out; layer 2 reads them.
 *   3. OWN_SIDE — people on the BUYER's side, or a name, or a report of a call.
 *      Layer 1 stays out; layer 2 reads them.
 * Around them: ordinary chat that shares the words, a person declined, a
 * question about what they are talking to, and the few asks left to layer 2
 * on purpose because they are as often a greeting.
 */

export type Lang = 'en' | 'zh' | 'ar';

/** The five the old list missed — the owner's first priority, by cost. */
export const THE_FIVE_MISSES: readonly [string, string][] = [
  ['Can I talk to someone?', "'talk to', where the list said only 'speak to'"],
  ['I want to speak with a person', "'speak with', where the list said only 'speak to'"],
  ['أريد أحدًا يساعدني', "«اريد احد» typed with the hamza most people type"],
  ['我要找你们经理', 'the seller’s manager, in Chinese'],
  ['أريد التحدث مع مديركم', 'the seller’s manager, in Arabic'],
];

/** 1 · Requests for a person on the seller's side: layer 1 hands off, no model is asked. */
export const REQUESTS: Record<Lang, readonly string[]> = {
  en: [
    'speak with a person',
    "This isn't working — I want to speak to a real person now.",
    'I want to speak to someone',
    'I want to talk to a person',
    'Can I speak to a person?',
    'Could we talk with a human please',
    "I'd like to speak to a representative",
    'I would rather talk to a real person',
    'I would like to talk to someone from your company',
    'We need to talk to someone about the invoice',
    'Can I talk to someone from your sales team?',
    'Can I speak to sales?',
    'May I speak to the owner?',
    'I want to talk to your boss',
    'Get me your manager',
    'Put me through to someone who can help',
    'Connect me with customer service',
    'Transfer me',
    'Let me talk to a human',
    'I need a real person',
    'I need help from a human',
    'I want a human, not a bot',
    "I don't want to talk to a bot",
    'get me a live agent',
    'Is there someone I can talk to?',
    'real person please',
    'Real human needed',
    'Human please',
    'Agent!',
    'please call me',
    'call me back please',
    'Can you call me back?',
    'Can someone call me?',
    'Call me asap',
    'Give me a call tomorrow',
    'Can I call you?',
    'Please have someone call me',
    'Can I get a human?',
    // Written otherwise, read the same: full-width letters, curly apostrophes.
    'ＣＡＮ Ｉ ＴＡＬＫ ＴＯ ＳＯＭＥＯＮＥ？',
    'I’d like to speak with a person',
  ],
  zh: [
    // The human agent, asked for by its own words.
    '我要找人工客服，谢谢',
    '转人工',
    '人工',
    '我要人工！',
    '帮我找个人工',
    '帮我转接客服',
    // A real person.
    '找真人',
    '能不能找个真人',
    '有没有真人',
    '有真人吗？',
    '我想和真人聊聊',
    '我不想跟机器说话',
    '换个人跟我说',
    // Someone of theirs, to talk with.
    '我要跟人说话',
    '我想找个人聊聊',
    '能不能跟工作人员说一下',
    '我要跟你们的人谈',
    '我要和客服说',
    '我要找客服',
    '可以找客服吗',
    '找你们业务员',
    // Their manager, boss or person in charge.
    '请你们负责人联系我',
    '能让你们老板跟我谈吗',
    '您的客户经理一直没回复',
    '请经理直接联系我',
    '我要投诉，叫你们领导来',
    // Their people, to come to the buyer.
    '请让客服联系我',
    '让你们销售联系我',
    '叫你们的人给我打电话',
    // A call, which only a person makes.
    '给我打电话',
    '打电话给我',
    '能打给我吗',
    '打我电话',
    '请电话联系我',
    '请回电',
    // Written otherwise, read the same.
    '我要找你們經理',   // traditional characters
    '转人工!',           // ASCII punctuation
    '转人工🙏',          // an emoji ends the word too
    '麻烦转人工 谢谢',
  ],
  ar: [
    // A real person, or someone.
    'أريد التحدث مع شخص حقيقي من فضلك',
    'أريد شخصا حقيقيا',
    'أريد إنسانًا',
    'اريد احد يساعدني',
    'أريد أحداً يرد علي',
    'أبغى أحد يكلمني',
    'أريد التحدث مع أحد',
    'ممكن أكلم أحد؟',
    'هل يوجد أحد أتكلم معه؟',
    'أحتاج مساعدة من شخص حقيقي',
    'لا أريد التحدث مع روبوت',
    // Someone of theirs.
    'ابغى اكلم موظف',
    'ممكن أكلم موظفة؟',
    'أريد موظف خدمة العملاء',
    'عايز اكلم حد من فضلك',
    'بدي احكي مع حدا',
    'حولني على خدمة العملاء',
    'حولوني لشخص',
    'أريد التكلم مع البائع',
    // Their manager or official.
    'ممكن أتكلم مع المسؤول؟',
    'أريد الاتصال بالمدير',
    'أريد التحدث مع المديرة',
    'مسؤولكم لم يرد علي',
    'مسؤولتكم لم ترد علي',
    'المدير عندكم موجود؟',
    // A call, which only a person makes.
    'اتصل بي',
    'اتصل علي',
    'اتصلوا بي من فضلك',
    'كلمني على الواتساب',
    'رن علي الآن',
    'ممكن تتصل بي؟',
    'ممكن اتصال؟',
    'هل يمكن الاتصال بكم؟',
    // Written otherwise, read the same: tatweel, diacritics, a Persian keyboard's letters.
    'أريـــد التحدث مع مديركم',
    'أُرِيدُ أَحَدًا يُسَاعِدُنِي',
    'اریدُ التحدث مع مدیرکم',
  ],
};

/** 2 · The words, meaning something else. Not layer 1's. [text, what it means] */
export const OTHER_MEANINGS: Record<Lang, readonly [string, string][]> = {
  en: [
    ['Do you sell human hair wigs?', "'human' — a product"],
    ['I want a human hair wig in black', "'a human' — then 'hair': still the product"],
    ['We need 500 human-hair extensions', "'human-hair' — the product, hyphenated"],
    ['We want to be your agent in Saudi Arabia', "'agent' — a trade relationship"],
    ['Our agent in Dubai will collect the goods', "'agent' — theirs, a trade term"],
    ['We got help from a human resources firm', "'human' — human resources"],
    ["I don't want a machine-made bag", "'machine' — how the goods are made"],
  ],
  zh: [
    ['我们在找人工成本低的工厂', "'找人工' — labour cost"],
    ['这道工序需要人工', "'需要人工' — done by hand"],
    ['这个是机器做的，没有人工', "'没有人工' — no hand work"],
    ['你们用人工智能回复吗？', "'人工智能' — AI"],
    ['人工缝制的包多少钱', "'人工缝制' — hand-sewn"],
    ['不要机器做的，要手工的', "'不要机器' — not machine-made"],
    ['我们在找销售渠道', "'找销售' — sales channels, being sought"],
    ['这是真人秀同款', "'真人秀' — a reality show, a product line"],
  ],
  ar: [
    ['اريد احدث موديل', "'اريد احد' — inside «احدث», the newest"],
    ['أريد أحد هذه الموديلات', "«احد» before a noun — one of these models"],
    ['نريد التواصل مع احد المصانع', "«احد» before a noun — one of the factories"],
    ['أريد مندوب مبيعات في السعودية', "'a sales agent' — appointing one, a trade relationship"],
    ['نبحث عن موظفين للمصنع', "'staff' — hiring"],
    ['أريد آلة خياطة صناعية', "'a machine' — a sewing machine, a product"],
  ],
};

/** 3 · People on the buyer's own side, a name, a report of a call. Not layer 1's. [text, why] */
export const OWN_SIDE: Record<Lang, readonly [string, string][]> = {
  en: [
    ["I'll speak to someone in my team and get back to you", 'someone in my team'],
    ['I will speak to a person in our office first', 'a person in our office'],
    ['I need to talk to someone at my company first', 'someone at my company'],
    ['Can I talk to my boss first and come back to you?', 'my boss'],
    ['Let me talk to someone and get back to you', "'let me talk to someone' — as often their own"],
    ['Hi, you can call me Ahmed', 'a name, not a call'],
    ['Call me Ahmed', 'a name, not a call'],
    ['Can I call you Lily?', 'a name, not a call'],
    ['My colleague will call me back tomorrow', 'their own colleague calls them'],
    ['A real person from our company will visit your factory', 'their own company'],
    ['Our sales team will contact you', 'their own sales team'],
    ['I will get help from a person in my team', 'help from their own team'],
  ],
  zh: [
    ['我们在找真人模特', "'找真人' — real models they are looking for"],
    ['我们在找真人模特拍产品图', "'找真人' — real models, for their photo shoot"],
    ['我让经理联系你', 'their manager contacts the seller'],
    ['我让我们的人联系你', 'their people contact the seller'],
    ['我们客服会联系你', 'their own customer service'],
    ['我找人问一下', 'they ask someone of theirs'],
    ['他给我打电话了', 'a call they had — a report'],
    ['我们经理给我打电话说可以发货', 'their manager called them — a report'],
    ['我会给你打电话', 'they will call the seller'],
    ['叫我小王就行', 'a name'],
  ],
  ar: [
    ['أحتاج التحدث مع شخص في شركتي أولاً', 'someone in their own company'],
    ['أحتاج مساعدة من شخص في شركتي', 'help from their own company'],
    ['اتصل بي مديري أمس', 'their manager called them — a report'],
    ['مديري سيتصل بك غدا', 'their manager will call the seller'],
    ['سأتصل بك غدا', 'they will call the seller'],
    ['سأتحدث مع مديري وأعود إليك', 'their own manager'],
    ['اسمي أحمد', 'a name'],
  ],
};

/**
 * Ordinary trade chat that shares words with a request — talk, speak, call,
 * agent, real, someone, 人工, 真人, 老板, 电话, «احد», «التواصل», «اتصل» — and asks
 * for nobody. Layer 1 stays out of all of it.
 */
export const PASSING: Record<Lang, readonly string[]> = {
  en: [
    'We want to talk about the price',
    'I want to talk to you about a big order',
    'Can I talk to you about pricing?',
    'Let me talk with my team',
    'Speak to you soon',
    'Talk to you later',
    'You can call me anytime',
    'I will call you tomorrow',
    'Can we have a call next week?',
    'Can I get a human hair sample?',
    'Can we have a representative sample?',
    'Can I get an agent price?',
    'I want a real bargain',
    'We need an agent in Riyadh',
    'Human resources department needs 200 uniforms',
    'Our customers are real people who care about quality',
    'Is this made by real people or machines?',
    'Someone told me you have the best price',
    'I need someone to confirm the shipping date',
    'Is there anyone who ships to Brazil?',
    'Transfer the money today',
    'Pass me the invoice please',
    'Give me a discount',
    'Call me crazy but I love this bag',
    'My colleague will ask someone to call me',
    'Can you speak English?',
  ],
  zh: [
    '请问有没有现货？',
    '你们工厂在哪里？',
    '我们公司老板想要样品',
    '你们的产品我们老板很喜欢',
    '谢谢你们的帮助，我们领导很满意',
    '我们领导让我问一下你们的价格',
    '人工费多少',
    '这个需要人工缝吗',
    '人工成本太高了',
    '真人秀',
    '在吗',
    '打电话费用谁出？',
  ],
  ar: [
    'أريد التحدث عن السعر',
    'أريد التواصل معكم',
    'ممكن التواصل مع الشركة؟',
    'أريد أحد الأنواع',
    'أحد العملاء طلب هذا المنتج',
    'هل عندكم مندوب في دبي؟',
    'أريد أحدث الألوان',
    'أريد التحدث مع زوجتي أولا',
    'مدير المبيعات لدينا سيتصل بكم',
    'اتصل بي أحد موظفيكم أمس',
    'شكرا على المساعدة',
  ],
};

/** Declining a person is not asking for one. */
export const DECLINED: Record<Lang, readonly string[]> = {
  en: [
    "I don't want to talk to a person, just send the price",
    'No need to connect me with a person',
    "Don't transfer me to a human, you are doing fine",
  ],
  zh: ['不用转人工，你回答就行', '我不需要人工客服', '别找真人了'],
  ar: ['لا أريد التحدث مع شخص، أرسل السعر فقط', 'مش عايز اكلم حد'],
};

/** A question about WHAT they are talking to is not, by itself, a request: layer 2's. */
export const ABOUT_THE_ASSISTANT: Record<Lang, readonly string[]> = {
  en: ['Are you a human?', 'Hold on — am I talking to a bot or a real person?'],
  zh: ['你是真人吗？'],
  ar: ['هل أنت إنسان؟'],
};

/**
 * Asks left to layer 2 ON PURPOSE: as often a greeting or a trade term as a
 * request, so the model reads them (and, unsure, answers true).
 */
export const LEFT_TO_LAYER_TWO: Record<Lang, readonly [string, string][]> = {
  en: [['Is anyone there?', 'a greeting as often as an ask'],
       ['Hello?? Is anybody actually reading these messages?', 'only the meaning says it'],
       ['Honestly I would prefer that Mr. Wang handles my order himself', 'a named person, no word on any list']],
  zh: [['客服在吗', 'the everyday greeting to a shop'], ['有人吗', 'anyone there? — a greeting as often']],
  ar: [['فيه أحد يرد؟', 'anyone there? — a greeting as often'], ['أريد مندوب مبيعات', 'a sales rep — or appointing one']],
};

/** Every non-request, flattened: what layer 1 must never fire on. */
export const NEVER_LAYER_ONE = (): readonly string[] => [
  ...Object.values(OTHER_MEANINGS).flat().map(([t]) => t),
  ...Object.values(OWN_SIDE).flat().map(([t]) => t),
  ...Object.values(PASSING).flat(),
  ...Object.values(DECLINED).flat(),
  ...Object.values(ABOUT_THE_ASSISTANT).flat(),
  ...Object.values(LEFT_TO_LAYER_TWO).flat().map(([t]) => t),
];
