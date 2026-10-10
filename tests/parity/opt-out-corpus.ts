/**
 * "STOP MESSAGING ME" — the corpus (0135, the owner's decisions of 2026-10-10),
 * shared by the layer test (tests/parity/opt-out-requests.test.ts) and the turn
 * test (tests/pipeline/opt-out-turn.test.ts). A new phrasing goes in here, in
 * the group it belongs to, with its reason — never into the patterns alone.
 *
 * Three groups, each in the six languages the assistant answers in (Arabic
 * with its Gulf, Egyptian, Levantine and Moroccan Darija forms, in Arabic and
 * in Latin letters):
 *   1. OPT_OUTS — "stop messaging me". Each is recorded as an opt-out, answered
 *      with one line, and then nothing. A miss is a policy breach, so the
 *      informal and the rude are here as well as the formal.
 *   2. PERSON — "let me talk to a person", and every stop that is not only a
 *      stop: one that asks for or names a person, one aimed at the machine,
 *      and a bare word that may mean an order. Each goes to a person with the
 *      ordinary hand-off, and NONE is recorded as an opt-out: a buyer who wanted
 *      help must not get silence.
 *   3. NEITHER — the words, meaning something else: a shipment, production, an
 *      order, a bus stop. Answered as usual.
 */

export type Lang = 'en' | 'zh' | 'ar' | 'es' | 'fr' | 'pt';

/** 1 · Opt-outs: recorded, one line, then silence. */
export const OPT_OUTS: Record<Lang, readonly string[]> = {
  en: [
    'STOP', 'stop', 'Stop.', 'Stop please', 'pls stop', 'STOP ALL', 'Unsubscribe', 'unsubscribe me', 'opt out',
    'stop messaging me', 'Stop messaging me please', 'please stop texting me', 'stop sending me messages',
    'stop sending me these', 'Stop contacting me', 'stop spamming me', 'stop bothering me', 'stop writing to me',
    'stop following up with me', "don't message me again", "Don't text me anymore", 'do not contact me',
    'never message me again', 'dont write to me', 'no more messages please', "I don't want any more messages",
    "I don't want to receive your texts", "I don't want to hear from you", 'leave me alone', 'Leave me alone!!',
    'remove me from your list', 'take me off your mailing list', 'lose my number', "I'll block you",
    'not interested. stop', 'Not interested, please stop.', 'ok stop', 'enough', "please don't contact me again",
    'Wrong number. Stop.', 'I never signed up for this, stop texting me', 'how do I unsubscribe from this',
    "don't call me again", 'STOP!!! 😡',
  ],
  zh: [
    '退订', 'TD', '停', '别再发了', '别发了', '不要再发了', '不要再给我发消息了', '别给我发广告', '别再联系我',
    '不要打扰我', '别烦我', '别烦了', '请勿打扰', '以后别发了', '我不想再收到你们的消息', '不需要了，别再发了',
    '取消订阅', '拒收', '请停止发送', '把我从名单里删除', '你再发我就拉黑你了', '够了', '不要再联系我了谢谢',
    '别再给我发了！', '不要骚扰我',
  ],
  ar: [
    // Modern Standard Arabic
    'لا تراسلني', 'لا ترسل لي رسائل', 'توقف عن مراسلتي', 'توقفوا عن إرسال الرسائل', 'لا أريد أي رسائل',
    'أرجو عدم مراسلتي', 'إلغاء الاشتراك', 'ألغوا اشتراكي', 'احذفني من القائمة', 'لا تتواصلوا معي', 'كفى رسائل',
    'ستوب', 'توقف', 'لا تزعجني',
    // Gulf
    'لا عاد تراسلني', 'ما ابي رسايل', 'وقفوا الرسايل', 'لا ترسلون لي شي', 'خلني في حالي',
    // Egyptian
    'متبعتليش تاني', 'ماتبعتليش رسايل', 'بطلوا رسايل', 'مش عايز رسايل تاني', 'كفاية رسايل بقى', 'سيبني في حالي',
    // Levantine
    'ما بدي رسائل', 'لا تبعتلي', 'بدي ياكم توقفوا الرسائل',
    // Moroccan Darija, in Arabic letters
    'ماتبقاش تصيفط ليا', 'ما تبقاش تصيفطلي الميساجات', 'باراكا من الميساجات', 'حبس الميساجات',
    'ما بغيتش الميساجات', 'ماتصيفطليش', 'حبسو عليا هاد الميساجات',
    // Darija and Egyptian in Latin letters
    'safi matb9ach tsiftli', 'matb9awch tsifto lia', 'baraka mn les messages', '7bes les messages',
    'ma bghitch les messages', 'matsiftlich', 'matb3atlish tany', 'battal teb3atly',
  ],
  es: [
    'deja de escribirme', 'Dejen de mandarme mensajes', 'no me escribas más', 'no me mandes más mensajes',
    'no quiero recibir más mensajes', 'dame de baja', 'darme de baja por favor', 'cancelar suscripción',
    'sácame de la lista', 'déjame en paz', 'basta de mensajes', 'BAJA', 'ya no me escribas', 'no me contactes',
    'para ya',
  ],
  fr: [
    "arrêtez de m'écrire", "Arrête de m'envoyer des messages", 'ne me contactez plus', "ne m'écrivez plus",
    'je ne veux plus recevoir de messages', 'je ne veux plus de vos mails', 'désabonnez-moi', 'me désinscrire',
    'retirez-moi de votre liste', 'laissez-moi tranquille', 'plus de messages svp', 'stop svp',
    'je ne veux plus être contacté', 'Arrêtez !',
  ],
  pt: [
    'pare de me mandar mensagens', 'para de me mandar mensagem', 'não me mande mais mensagens', 'não me escreva mais',
    'não quero mais receber mensagens', 'me descadastre', 'descadastrar', 'me tira dessa lista', 'quero sair da lista',
    'me deixa em paz', 'chega de mensagens', 'pare', 'não me incomode', 'parem de me encher',
  ],
};

/**
 * 2a · "Let me talk to a person", "I want a human": a hand-off, never an
 * opt-out. The hand-off notice goes out and a person takes it.
 */
export const PERSON_REQUESTS: Record<Lang, readonly string[]> = {
  en: ['Let me talk to a person', 'I want to speak to a real person', 'Can I talk to someone?', 'I want to talk to a human'],
  zh: ['转人工', '我要人工客服', '我想跟真人说话', '我要找你们经理'],
  ar: ['أريد التحدث مع موظف', 'حولني على موظف', 'أريد التحدث مع شخص حقيقي', 'عايز أكلم حد من خدمة العملاء'],
  es: ['quiero hablar con una persona', '¿puedo hablar con alguien de tu equipo?', 'pásame con un agente'],
  fr: ['je voudrais parler à une vraie personne', 'passez-moi un conseiller', 'puis-je parler au responsable'],
  pt: ['quero falar com uma pessoa', 'quero atendimento humano', 'me passa para um atendente'],
};

/**
 * 2b · A stop that is not only a stop: it asks for or names a person, or is
 * aimed at the machine. Genuinely ambiguous — a person reads it, nothing is
 * recorded.
 */
export const STOP_AND_PERSON: Record<Lang, readonly [string, string][]> = {
  en: [
    ['stop the bot, get me a person', 'a person, asked for'],
    ['Stop sending automated messages, I want to talk to a human', 'the machine stopped, a human asked for'],
    ['no more bot replies, real person please', 'the machine stopped, a person asked for'],
    ['Stop messaging me and have a real person call me', 'stop, and a person asked for'],
    ['stop. are you a bot?', 'stop, and a question about what is answering'],
    ['I want a human, stop with these auto replies', 'a human, asked for'],
  ],
  zh: [
    ['别用机器人回复了，转人工', 'the machine stopped, 转人工'],
    ['不要自动回复了，我要找客服', 'the auto-reply stopped, 客服 asked for'],
    ['别再发了，让真人来回复', 'stop, and 真人 asked for'],
  ],
  ar: [
    ['توقفوا عن الرد الآلي، أريد التحدث مع موظف', 'the machine stopped, a member of staff asked for'],
    ['بطلوا الروبوت ده، عايز أكلم حد', 'the robot stopped, someone asked for'],
    ['لا ترسل لي رسائل، أريد شخص حقيقي يرد', 'stop, and a real person asked for'],
  ],
  es: [
    ['deja de mandarme mensajes automáticos, quiero hablar con una persona', 'the machine stopped, a person asked for'],
    ['no me escribas más con el bot, pásame con un agente', 'an agent asked for'],
  ],
  fr: [
    ["arrêtez de m'envoyer des réponses automatiques, je veux parler à un conseiller", 'a conseiller asked for'],
    ['ne me contactez plus avec le robot, je veux une vraie personne', 'a real person asked for'],
  ],
  pt: [
    ['pare de me mandar mensagens automáticas, quero falar com um atendente', 'an atendente asked for'],
    ['não me mande mais mensagens do robô, quero atendimento humano', 'a human asked for'],
  ],
};

/** 2c · Alone, these may stop the messages or an order: a person reads them; nothing is recorded. */
export const UNSURE: readonly [string, string][] = [
  ['cancel', 'the order, or the messages'],
  ['Cancel', 'the same, capitalised'],
  ['end', 'an SMS keyword, or the end of something else'],
  ['取消', 'cancel: an order, or the messages'],
  ['不用发了', '"no need to send it": a file, or the messages'],
  ['إلغاء', 'cancel'],
  ['خلاص', '"done / enough": a deal agreed, or the messages'],
  ['safi', 'Darija "OK / enough"'],
  ['cancelar', 'cancel, in Spanish and Portuguese'],
  ['annuler', 'cancel, in French'],
  ['stop, wrong address — send it to the warehouse', '"stop" with more after it: the shipment, or the messages'],
  ['Stop! I made a mistake in the quantity', '"stop" with more after it: the order, most likely'],
  ["don't send anything else", 'the messages, or the shipment'],
  ['不要发了谢谢你', "\"don't send it, thanks\": the shipment, or the messages"],
];

/** 3 · The words, meaning something else. Nothing recorded; nothing handed over by this check. */
export const NEITHER: Record<Lang, readonly [string, string][]> = {
  en: [
    ['stop by our office tomorrow', 'a visit'],
    ['when will production stop?', 'production'],
    ['the bus stop is near the factory', 'a place'],
    ['nonstop flights to Dubai', 'a word containing it'],
    ["don't send the wrong color again", 'a shipment'],
    ["don't send the samples again, we have enough", 'a shipment'],
    ['can you stop the order?', 'an order'],
    ['I want to stop ordering from the other supplier', 'their other supplier'],
    ['please don\'t stop writing such good offers', 'a compliment'],
    ['remove the logo from the bag', 'a design change'],
    ['remove my email from the cc', 'a cc line'],
    ['cancel the blue ones, keep the red', 'part of an order'],
    ["don't call me now, I'm driving — text me", 'a better time, by text'],
    ['we will block the production slot for you', 'a booking'],
  ],
  zh: [
    ['不要发货', 'do not ship'],
    ['先别发货', 'hold the shipment'],
    ['这批别发了', 'this batch: an order'],
    ['货先不要发了', 'the goods: an order'],
    ['别再发错了', 'do not send the wrong one again'],
    ['别给我发错货', 'do not ship me the wrong goods'],
    ['停产了吗', 'discontinued?'],
    ['不要发顺丰', 'not by SF Express'],
    ['不用找了', 'keep the change'],
  ],
  ar: [
    ['لا ترسل الشحنة قبل الدفع', 'the shipment'],
    ['أوقفوا الطلب', 'the order'],
    ['توقف الإنتاج', 'production'],
    ['لا ترسلوا العينة الآن', 'the sample'],
    ['خلاص اتفقنا', 'a deal agreed'],
    ['بس عندي سؤال', '"but I have a question"'],
    ['وقف الطلب رقم 5', 'order 5'],
    ['لا تتصل بي الآن، أرسل واتساب', 'a better way to reach them'],
  ],
  es: [
    ['para mañana', 'for tomorrow'],
    ['deja de enviar la muestra', 'the sample'],
    ['cancelar el pedido', 'the order'],
    ['no me mandes la factura todavía', 'the invoice, not yet'],
    ['para el lunes por favor', 'for Monday'],
  ],
  fr: [
    ['arrêtez la production', 'production'],
    ['annulez la commande', 'the order'],
    ["ne m'envoyez pas la facture", 'the invoice'],
    ["j'ai dit que c'était urgent", '«j\'ai», not "AI"'],
  ],
  pt: [
    ['pare a produção', 'production'],
    ['para quando é a entrega?', 'a delivery date'],
    ['não me mande a fatura ainda', 'the invoice, not yet'],
  ],
};

/**
 * 1b · Three held-out rounds (2026-10-10), written without looking at the
 * patterns and measured before they were changed: 42/68, 37/54 and 39/46
 * caught at first, with no false alarm in 102 lines that must stay unread.
 * A fourth round, after the general shapes: 36/40, no false alarm in 33.
 * Folded in so each stays caught. Mixed languages, as buyers write.
 */
export const HELD_OUT_OPT_OUTS: readonly string[] = [
  // round 1
  'Please remove me', 'Stop sending me stuff', 'dont msg me', 'pls dont text', 'u can stop now', 'i said stop', 'STOP STOP STOP',
  'Do not message this number', 'who is this? stop messaging', 'Remove this number', "I'm not interested, don't contact me again",
  'Quit messaging me', 'cease and desist', 'no thanks, please remove my number from your list', 'unsubscribe pls', 'STOP texting',
  'can you stop sending these messages', 'I want to opt out', 'take me off', 'stop sending',
  '别发信息了', '不要再给我发这些了', '请不要再联系我', '麻烦以后不要发了', '退订谢谢', '别再推送了', '能不能别发了', '再发投诉你', '不要再发广告了', '我不需要，别发了', '把我删了吧',
  'لا تكتب لي مرة ثانية', 'ارجو التوقف عن ارسال الرسائل', 'مش عاوز اي رسايل منكم', 'لا ترسلوا لي شيء', 'يا اخي لا تراسلني', 'كفاية', 'ابعدوا عني', 'ما ابغى رسايل', 'بلاش رسايل', 'متبعتوليش تاني',
  'ماتعاودش تصيفطلي', 'ماتبقاوش تصيفطو ليا الرسائل', 'صافي باراكا', 'safi baraka 3lia', 'ma tsiftlich l messages',
  'no me envíes más', 'deja de mandar mensajes', 'quítame de la lista', 'no me interesa, no me escribas', 'ya no quiero mensajes', 'basta', 'no me molesten',
  'stop merci', "arrêtez s'il vous plaît", "ne plus m'envoyer de messages", 'je souhaite me désabonner', 'merci de ne plus me contacter', "cessez de m'écrire", 'désinscription',
  'pare de mandar mensagem', 'não quero receber mais nada', 'por favor não me mande mais nada', 'me remove da lista', 'não me mandem mais mensagens', 'chega', 'sai fora',
  // round 2
  'STOP pls', 'Stop!!!', 'stop it now', 'Please stop this', 'no more msgs', "I'm not interested. Please do not contact me again.",
  'Remove me from this list', 'unsubcribe', 'unsubscibe', 'Plz stop sending', 'stop sending pls', 'Stop spam', 'This is spam, stop',
  'Spam. Stop.', 'Who gave you my number? Stop messaging me', 'stop msging me', 'Stop with the messages',
  '别给我发了', '不要再发消息给我', '停止推送', '退订！', '不要再打扰了', '你们别再发了好吗', '不要再给我打电话了', '别发了谢谢',
  'وقف الرسايل', 'لا ترسلوا رسائل', 'رجاء لا ترسلوا لي رسائل', 'ما ابغى اي رسالة', 'خلاص لا ترسل', 'توقفوا', 'لا تراسلوني مرة ثانية',
  'انا مش عايز حاجة منكم', 'ابعتلي تاني وهعملك بلوك', 'عافاك ماتصيفطش ليا', 'ماتبقاوش تبعثو ليا', 'ما بغيتش نتوصل بالرسائل',
  'matb9awch tseftou lia', 'stop 3afak',
  'no quiero nada, no me escriban', 'dejen de molestar', 'por favor no me manden más', 'spam, basta',
  'stop les messages', 'arrêtez les messages', 'je ne suis pas intéressé, arrêtez', "ne m'envoyez plus rien", "c'est du spam, arrêtez",
  'para de mandar', 'não me manda mais', 'para com essas mensagens', 'não tenho interesse, não me mande mais', 'me exclui da lista', 'chega de spam',
  // round 3
  'Kindly stop', 'stop it', 'STOP SENDING', 'stop this nonsense', 'Enough with the spam', 'No more ads please', 'I am not interested stop',
  "don't contact me", 'You keep messaging me, stop', 'please unsubscribe me from this', 'remove my number', 'Stop. Not interested.', 'leave me alone pls',
  '不要再发了，谢谢', '不想收到', '别再给我推送广告', '不要再发信息给我了', '烦死了别发了', '请不要打扰', '以后不要再联系了',
  'لا ترسل لي اي رسائل اخرى', 'توقفوا عن ازعاجي', 'كفاية ازعاج', 'لو سمحت لا تراسلني', 'مش عايز اي رسايل', 'ما بدي اي رسائل منكم',
  'عافاك حبس الميساجات', 'ماتبقاش تبعث ليا', 'safi baraka mn les msgs', 'ma tb9ach tsift lia', 'لا عاد ترسلون',
  'no me escribas', 'basta ya de mensajes', 'no quiero que me escriban más', 'por favor deja de enviarme mensajes', 'no me interesa, basta',
  'arrêtez de me spammer', "merci d'arrêter de m'écrire", 'je ne souhaite plus recevoir vos messages', 'stop, merci', 'ça suffit',
  'pare de me enviar mensagens', 'não quero mais mensagens', 'não me mande nada', 'para de me encher', 'não tenho interesse, pare',
  // round 4 — 36/40 at first, no false alarm in 33
  'pls stop msg me', 'Stop messages', 'I dont want ur messages', 'Remove me pls', 'NO MORE', 'stop now please', 'Please, do not text me',
  'not interested, please remove me', 'I have asked you to stop', 'stop bugging me', 'Stop sending me promotions', 'enough is enough, stop',
  '别再发这种消息了', '我不需要这些信息，请不要再发了', '退订，谢谢', '再发我就投诉了', '不要再给我发微信了',
  'من فضلك توقف عن ارسال الرسائل', 'لا تبعتلي رسايل تاني', 'ما تراسلني', 'وقفوا الإرسال', 'ارجو عدم الازعاج', 'ما ابي شي منكم', 'بطل تبعتلي',
  'حبسو الرسائل عافاكم', 'ماتعاودوش تصيفطو ليا', 'baraka 3lia mn had les messages',
  'no me manden más mensajes por favor', 'quiero darme de baja', 'paren de escribirme', 'no me interesa, no me contacten',
  'ne me contactez plus svp', "arrêtez de m'envoyer des pubs", 'désabonnement', 'je ne veux plus de messages',
  'não me envie mais mensagens', 'pare de me mandar propaganda', 'quero me descadastrar', 'para de mandar mensagem por favor',
];

/** 3b · The held-out rounds' lines that must stay unread: none was ever read wrongly. */
export const HELD_OUT_NEITHER: readonly string[] = [
  'can you send me the catalogue?', 'please send the invoice again', 'stop the production of size M', 'I want to cancel order 1234',
  'the stop button on the machine is broken', 'do you sell door stops?', 'no more than 500 pcs please', 'enough for 200 bags?',
  'leave the logo as it is', "don't send it before Monday", 'remove the zipper', 'is the price final? no more discount?',
  '先别发，等我确认', '发货了吗', '不要发太多', '停止生产这款吗？', '别发错颜色',
  'متى ترسلون الشحنة؟', 'لا ترسل قبل ما أدفع', 'وقفوا الإنتاج لهذا اللون', 'ابغى ارسل لكم التصميم', 'خلاص تمام', 'بس السعر غالي',
  'para cuándo llega?', 'no me mandes el pedido aún', 'basta con 100 unidades', 'arrête la commande de rouge', 'pare o envio até segunda',
  'não envie antes de segunda', 'chega amanhã?',
  'I sent the invoice, check your spam', 'is this your spam filter?', 'the price of the block is too high', 'where do I stop to pick up?',
  'can we stop at 300 pcs?', 'stop motion video for the bag', 'non-stop production?', 'I will stop by Monday', 'enough stock?',
  'the messages you sent are not clear', 'send the messages to my partner', 'remove the label', 'take the logo off', 'cancel the red ones',
  '我的消息你收到了吗', '请发报价', '别着急', '不要红色', '停车场在哪里', '先停一下，我问问老板', '发我地址',
  'سعر البلوك كم؟', 'وصلتك رسالتي؟', 'ارسل لي السعر', 'ابغى ارسل التصميم', 'كفاية 200 قطعة', 'خلاص موافق', 'لا ترسل اللون الأحمر',
  'mándame el precio', 'para el viernes', 'basta con 50', 'deja un mensaje', 'para los mensajes usa este número',
  'envoyez-moi le prix', "arrête de t'inquiéter", 'stop ou encore ?', 'assez grand ?',
  'a entrega chega amanhã', 'quando chega?', 'basta enviar o comprovante', 'pode mandar mensagem amanhã', 'para com o cliente final',
  'what is your stop loss policy for orders?', 'stop me if this is too much detail', 'can you send messages to my assistant too?',
  'I got your messages, thanks', 'remove 2 items from the order', 'please take off the tax', 'no more than 3 colors',
  'enough samples for now, thanks', 'do you have a contact person in Dubai?', 'send me a text when it ships',
  '你们几点下班', '发顺丰吧', '不要包装', '停一下，我算算', '把我的地址改一下', '能不能便宜点',
  'وقت التسليم متى', 'ارسل لي صور', 'لا تنسى الفاتورة', 'خلاص ارسل الفاتورة', 'كفاية كذا اللون', 'بس ابغى لون ثاني',
  'para qué sirve?', 'basta con el modelo azul', 'no me envíes la versión vieja', 'deja de lado el logo',
  'arrêtez-vous à quelle heure ?', "ne m'envoyez pas l'ancien modèle", 'plus de couleurs ?',
  'pare no centro', 'chega quando?', 'não me mande o modelo antigo', 'basta isso',
];
