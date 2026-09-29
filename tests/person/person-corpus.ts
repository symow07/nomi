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
 * question about what they are talking to, the few asks left to layer 2 on
 * purpose — and a shop's opener (客服在吗), held in both states: answered as
 * the opener, handed off when asked again after the disclosure.
 */

// Spanish and French since 2026-09-29: the disclosure speaks them, so layer 1 hears them.
export type Lang = 'en' | 'zh' | 'ar' | 'es' | 'fr';

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
    '人工在吗',        // the human agent, asked for — not 客服在吗, a shop's opener
    '真人在不在',
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
  es: [
    "¿Puedo hablar con una persona?",
    "Quiero hablar con una persona real",
    "Necesito hablar con alguien de tu equipo",
    "Quisiera hablar con el encargado",
    "Me gustaría hablar con un asesor",
    "Pásame con un agente, por favor",
    "Comunícame con atención al cliente",
    "¿Me puedes llamar?",
    "Llámame por favor",
    "Llámame mañana",
    "No quiero hablar con un bot",
    "¿Hay alguien con quien pueda hablar?",
    "Persona real por favor",
    "Quiero hablar con el dueño",
  ],
  fr: [
    "Je voudrais parler à une vraie personne",
    "Puis-je parler à quelqu'un ?",
    "J'aimerais parler avec un conseiller",
    "Je veux parler au responsable",
    "Est-ce que je peux parler à un humain ?",
    "Passez-moi le service client",
    "Mettez-moi en relation avec un conseiller",
    "Appelez-moi svp",
    "Pouvez-vous m'appeler ?",
    "Rappelez-moi demain",
    "Je ne veux pas parler à un robot",
    "Il y a quelqu'un à qui je peux parler ?",
    "Une vraie personne svp",
    "J'ai besoin de parler à quelqu'un de votre équipe",
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
  es: [
    ["¿Venden pelucas de cabello humano?", "'humano' — a product"],
    ["Queremos ser su agente en México", "'agente' — a trade relationship"],
    ["Nuestro agente en Madrid recogerá la mercancía", "'agente' — theirs, a trade term"],
    ["No quiero una bolsa hecha a máquina", "'máquina' — how the goods are made"],
    ["¿Tienen robots de cocina?", "'robots' — a product"],
  ],
  fr: [
    ["Vous vendez des perruques en cheveux humains ?", "'humains' — a product"],
    ["Nous voulons être votre agent en France", "'agent' — a trade relationship"],
    ["Notre agent à Lyon récupérera la marchandise", "'agent' — theirs, a trade term"],
    ["Je ne veux pas d'un sac fait à la machine", "'machine' — how the goods are made"],
    ["Vous avez des robots aspirateurs ?", "'robots' — a product"],
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
  es: [
    ["Voy a hablar con alguien de mi equipo y te digo", "someone in their own team"],
    ["Necesito hablar con mi jefe primero", "their own boss"],
    ["Quiero hablar con una persona de mi empresa antes", "a person at their own company"],
    ["Llámame Ana", "a name, not a call"],
    ["Me puedes llamar Ana", "a name, not a call"],
    ["Mi compañero me llamará mañana", "their colleague calls them"],
    ["Nuestro equipo de ventas te contactará", "their own sales team"],
  ],
  fr: [
    ["Je vais parler à quelqu'un de mon équipe et je reviens vers vous", "someone in their own team"],
    ["Je dois parler à mon responsable d'abord", "their own manager"],
    ["Je voudrais parler à une personne de ma société d'abord", "a person at their own company"],
    ["Appelez-moi Marie", "a name, not a call"],
    ["Vous pouvez m'appeler Marie", "a name, not a call"],
    ["Mon collègue me rappellera demain", "their colleague calls them"],
    ["Notre équipe commerciale vous contactera", "their own sales team"],
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
  es: [
    "Queremos hablar del precio",
    "Quiero hablar contigo sobre un pedido grande",
    "¿Podemos hablar del precio?",
    "Hablamos pronto",
    "Te llamo mañana",
    "Puedes llamarme cuando quieras",
    "Me puedes llamar cuando quieras",
    "¿Podemos hacer una llamada la próxima semana?",
    "¿Tienen muestra de cabello humano?",
    "Uno de nuestros clientes pidió este producto",
    "Gracias por la ayuda",
  ],
  fr: [
    "Nous voulons parler du prix",
    "Je voudrais vous parler d'une grosse commande",
    "Peut-on parler du prix ?",
    "À bientôt",
    "Je vous appelle demain",
    "Vous pouvez m'appeler quand vous voulez",
    "Pouvons-nous faire un appel la semaine prochaine ?",
    "Avez-vous un échantillon de cheveux humains ?",
    "Un de nos clients a demandé ce produit",
    "Merci pour votre aide",
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
  es: [
    "No quiero hablar con una persona, solo mándame el precio",
    "No hace falta pasarme con nadie",
  ],
  fr: [
    "Je ne veux pas parler à une personne, envoyez juste le prix",
    "Pas besoin de me passer quelqu'un",
  ],
};

/** A question about WHAT they are talking to is not, by itself, a request: layer 2's. */
export const ABOUT_THE_ASSISTANT: Record<Lang, readonly string[]> = {
  en: ['Are you a human?', 'Hold on — am I talking to a bot or a real person?'],
  zh: ['你是真人吗？'],
  ar: ['هل أنت إنسان؟'],
  es: [
    "¿Eres humano?",
    "¿Estoy hablando con un bot o con una persona?",
  ],
  fr: [
    "Êtes-vous un humain ?",
    "Je parle à un robot ou à une vraie personne ?",
  ],
};

/**
 * Asks left to layer 2 ON PURPOSE: only the meaning says it, so the model
 * reads them (and, unsure, answers true).
 */
export const LEFT_TO_LAYER_TWO: Record<Lang, readonly [string, string][]> = {
  en: [['Hello?? Is anybody actually reading these messages?', 'only the meaning says it'],
       ['Honestly I would prefer that Mr. Wang handles my order himself', 'a named person, no word on any list']],
  zh: [['有没有人能帮我？', 'someone who can help — more than a greeting']],
  ar: [['أريد مندوب مبيعات', 'a sales rep — or appointing one']],
  es: [
    ["Hola?? ¿Alguien está leyendo estos mensajes?", "only the meaning says it"],
  ],
  fr: [
    ["Allô ?? Quelqu'un lit vraiment ces messages ?", "only the meaning says it"],
  ],
};

/**
 * A SHOP'S OPENER (the owner's decision, 2026-09-28): a greeting aimed at a
 * shop, not a request for a named human. Held in BOTH states:
 *   · as the opener — the disclosure not yet sent in the conversation — it is
 *     answered, whatever the model says, and the disclosure goes with the reply;
 *   · as a repeat AFTER the disclosure went out, it is a real request and hands
 *     off at layer 1, before any model. A second ask is not an opener.
 * [text, why]
 */
export const OPENERS: Record<Lang, readonly [string, string][]> = {
  en: [
    ['Is anyone there?', 'anyone there — the greeting'],
    ['Anyone there?', 'the same, shorter'],
    ['Hello, is anybody there?', 'with a hello'],
    ['Hi there! Anyone around?', 'around'],
    ['Is someone there?', 'someone'],
    ['Hello? Anyone?', 'a ping'],
    ['Good morning, is anyone available?', 'available'],
    ['Is there anyone?', 'is there anyone'],
    ['Is customer service available?', 'the service, asked whether it is there — 客服在吗 in English'],
  ],
  zh: [
    ['客服在吗', 'the everyday greeting to a shop'],
    ['客服在吗？', 'the same, asked'],
    ['你好，客服在吗？', 'with a hello'],
    ['请问客服在吗', 'with 请问'],
    ['亲，客服在不在', '在不在 — the same question'],
    ['你们客服在吗', 'your customer service — the shop'],
    ['客服在线吗', 'online?'],
    ['客服在吗🙏', 'with an emoji'],
    ['老板在吗', 'the shopkeeper — how a buyer addresses any shop'],
    ['掌柜在吗？', 'the shopkeeper'],
    ['店家在吗', 'the shop'],
    ['有人吗', 'anyone there?'],
    ['有人在吗？', 'anyone there?'],
    ['有没有人', 'anyone?'],
    ['在吗在吗，有人吗', 'pinging'],
    ['您好，请问有人在吗', 'politely'],
  ],
  ar: [
    ['فيه أحد؟', 'anyone there?'],
    ['فيه أحد يرد؟', 'anyone to answer?'],
    ['في حد؟', 'anyone? — the dialect'],
    ['هل يوجد أحد؟', 'is there anyone?'],
    ['مرحبا، هل يوجد أحد هنا؟', 'with a hello'],
    ['السلام عليكم، فيه أحد؟', 'with a greeting'],
    ['أحد موجود؟', 'anyone present?'],
    ['حد موجود؟', 'the same, the dialect'],
    ['هل من أحد؟', 'is there anyone?'],
    ['هل خدمة العملاء موجودة؟', 'customer service there? — 客服在吗 in Arabic'],
  ],
  es: [
    ["¿Hay alguien?", "anyone there — the greeting"],
    ["Hola, ¿hay alguien ahí?", "with a hello"],
    ["¿Alguien disponible?", "available"],
    ["Buenas, ¿hay alguien?", "with a greeting"],
    ["¿Hay alguien atendiendo?", "anyone attending"],
  ],
  fr: [
    ["Il y a quelqu'un ?", "anyone there — the greeting"],
    ["Bonjour, il y a quelqu'un ?", "with a hello"],
    ["Quelqu'un est là ?", "anyone there"],
    ["Y a-t-il quelqu'un ?", "is there anyone"],
    ["Quelqu'un en ligne ?", "online?"],
  ],
};

/**
 * An opener and more: the opener asks for nobody, so before the disclosure the
 * model reads the rest (and decides); after it, the opener is a request and
 * hands off at layer 1 like the bare one.
 */
export const OPENERS_WITH_MORE: Record<Lang, readonly string[]> = {
  en: ['Hi, is anyone there? I have a question about the price', 'Anyone there? Do you ship to Kenya?'],
  zh: ['客服在吗？这个包多少钱', '老板在吗，还有现货吗', '有人吗？我想问一下起订量'],
  ar: ['فيه أحد؟ أريد أعرف السعر', 'السلام عليكم، هل يوجد أحد؟ كم سعر هذا؟'],
  es: [
    "¿Hay alguien? Tengo una pregunta sobre el precio",
  ],
  fr: [
    "Il y a quelqu'un ? J'ai une question sur le prix",
  ],
};

/**
 * Near an opener, and not one: addressed to whoever answers (the assistant),
 * or the words in a sentence. Never handed off by the words, in either state.
 * [text, why]
 */
export const NOT_OPENERS: Record<Lang, readonly [string, string][]> = {
  en: [
    ['Are you there?', 'addressed to whoever answers'],
    ['Hello?', 'a hello'],
    ['Is anyone there able to ship by Friday?', 'a question about shipping, in one clause'],
    ['Someone there told me the price was lower', "'someone there' inside a sentence"],
  ],
  zh: [
    ['在吗', 'addressed to whoever answers'],
    ['亲，在吗？', 'the same'],
    ['客服在哪里', 'where — a question'],
    ['有人说你们的质量不好', 'someone said'],
    ['我们公司没有人在', 'nobody at their own company'],
    ['老板在开会', 'the boss is in a meeting'],
  ],
  ar: [
    ['موجود؟', 'addressed to whoever answers'],
    ['في أحد المصانع رأيت هذا المنتج', '«في أحد» — in one of the factories'],
    ['هل يوجد أحد الألوان بالأزرق؟', '«يوجد أحد» — one of the colours'],
  ],
  es: [
    ["¿Estás ahí?", "addressed to whoever answers"],
    ["¿Hola?", "a hello"],
    ["Alguien me dijo que el precio era más bajo", "'alguien' inside a sentence"],
  ],
  fr: [
    ["Vous êtes là ?", "addressed to whoever answers"],
    ["Allô ?", "a hello"],
    ["Quelqu'un m'a dit que le prix était plus bas", "'quelqu'un' inside a sentence"],
  ],
};

/**
 * A plain ask, however much it looks like an opener: layer 1's, handed off on
 * the FIRST message, before any disclosure. The opener rule never reaches it.
 */
export const PLAIN_ASKS_THAT_LOOK_LIKE_OPENERS: Record<Lang, readonly string[]> = {
  en: ['Is anyone there? I want to speak to a real person', 'Anyone there? Can I talk to someone?'],
  zh: ['人工在吗', '真人在不在', '客服在吗？转人工', '有人吗？我要找人工客服'],
  ar: ['فيه أحد؟ أريد التحدث مع شخص حقيقي', 'هل يوجد أحد أتكلم معه؟'],
  es: [
    "¿Hay alguien? Quiero hablar con una persona real",
  ],
  fr: [
    "Il y a quelqu'un ? Je voudrais parler à une vraie personne",
  ],
};

/** Every non-request, flattened: what layer 1 must never fire on (before any disclosure). */
export const NEVER_LAYER_ONE = (): readonly string[] => [
  ...Object.values(OTHER_MEANINGS).flat().map(([t]) => t),
  ...Object.values(OWN_SIDE).flat().map(([t]) => t),
  ...Object.values(PASSING).flat(),
  ...Object.values(DECLINED).flat(),
  ...Object.values(ABOUT_THE_ASSISTANT).flat(),
  ...Object.values(LEFT_TO_LAYER_TWO).flat().map(([t]) => t),
  ...Object.values(OPENERS).flat().map(([t]) => t),
  ...Object.values(OPENERS_WITH_MORE).flat(),
  ...Object.values(NOT_OPENERS).flat().map(([t]) => t),
];
