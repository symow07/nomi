/**
 * Block 6.1 — the help question's "not yet" (src/advisor/help.ts, `NOT_YET`), both ways, in every owner language
 * (en, zh, ar, es, fr).
 *
 *   · ASKS — a question about something Nomi does not do. Each must be caught BEFORE any model is asked, by the
 *     thing it names (`term`).
 *   · PASSING — words that look like one and are not a question about it. None may be caught.
 *
 * A new phrasing goes HERE first, with its reason, and only then into a pattern. The builder's eleven, the tester's
 * thirteen ordinary variants (6.1's verification, 2026-11-10: nine of them reached the model) and the passing mentions
 * the supervisor named ("line 3 of my list", "call me Ana", "I texted them yesterday") are all here.
 *
 * Since the re-verification (2026-11-10: four of the tester's ten new asks still reached the model), the patterns
 * match each thing's WORD FAMILY when the sentence asks whether Nomi does it — the four are below with their reason,
 * then ten asks and ten passing mentions written for the families, in all five languages.
 */
export type NotYetLang = 'en' | 'zh' | 'ar' | 'es' | 'fr';
export type NotYetAsk = { readonly text: string; readonly lang: NotYetLang; readonly term: string; readonly why: string };
export type NotYetPassing = { readonly text: string; readonly lang: NotYetLang; readonly why: string };

export const NOT_YET_ASKS: readonly NotYetAsk[] = [
  // ── The builder's eleven (one per thing) ──
  { lang: 'en', term: 'WeChat', text: 'Can Nomi answer my WeChat messages?', why: 'the builder\'s list' },
  { lang: 'en', term: 'WeCom', text: 'Does it work with WeCom?', why: 'the builder\'s list' },
  { lang: 'en', term: 'RED', text: 'Can I connect Xiaohongshu?', why: 'the builder\'s list' },
  { lang: 'en', term: 'SMS', text: 'Can the assistant send SMS?', why: 'the builder\'s list' },
  { lang: 'en', term: 'calls', text: 'Can the assistant make phone calls to customers?', why: 'the builder\'s list' },
  { lang: 'en', term: 'Viber', text: 'Do you support Viber?', why: 'the builder\'s list' },
  { lang: 'en', term: 'LINE', text: 'Does it work with the LINE app?', why: 'the builder\'s list' },
  { lang: 'en', term: 'Zapier', text: 'Can I use Zapier?', why: 'the builder\'s list' },
  { lang: 'en', term: 'Google Calendar', text: 'Does it sync with Google Calendar?', why: 'the builder\'s list' },
  { lang: 'en', term: 'Amazon', text: 'Can I sell on Amazon with it?', why: 'the builder\'s list' },
  { lang: 'en', term: 'eBay', text: 'Does it connect to eBay?', why: 'the builder\'s list' },

  // ── The tester's ordinary variants (all thirteen; the nine that reached the model first) ──
  { lang: 'en', term: 'LINE', text: 'Do you support LINE?', why: 'the app\'s name in capitals, with no "app" after it' },
  { lang: 'en', term: 'calls', text: 'Can Nomi call customers?', why: 'to call customers, no "my"' },
  { lang: 'en', term: 'calls', text: 'Can the assistant phone my customers?', why: '"phone" as a verb' },
  { lang: 'en', term: 'SMS', text: 'Can it send text messages?', why: 'a text message is an SMS' },
  { lang: 'en', term: 'SMS', text: 'Can it text my customers?', why: '"text" as a verb with a customer after it' },
  { lang: 'en', term: 'WeChat', text: 'Does it work with We Chat?', why: 'the name written as two words, both capitals' },
  { lang: 'ar', term: 'WeChat', text: 'هل يعمل Nomi مع وي تشات؟', why: 'WeChat in Arabic letters' },
  { lang: 'ar', term: 'SMS', text: 'هل يمكن إرسال رسائل نصية قصيرة؟', why: '"short text messages", the Arabic for SMS' },
  { lang: 'es', term: 'calls', text: '¿Puede hacer llamadas telefónicas?', why: '"telephone calls" in Spanish' },
  { lang: 'en', term: 'WeChat', text: 'Can it reply on Weixin?', why: 'WeChat\'s Chinese name, romanised' },
  { lang: 'zh', term: 'WeChat', text: 'Can it reply on 微信?', why: 'WeChat in Chinese inside English' },
  { lang: 'zh', term: 'SMS', text: '能发短信吗？', why: '"can it send SMS?"' },
  { lang: 'fr', term: 'SMS', text: 'Peut-il envoyer des SMS ?', why: 'SMS in French' },

  // ── More of each, in every owner language ──
  { lang: 'en', term: 'LINE', text: 'Can I connect Line?', why: 'the app named after "connect", only its first letter a capital' },
  { lang: 'en', term: 'calls', text: 'Can it answer voice calls?', why: 'voice calls' },
  { lang: 'en', term: 'SMS', text: 'Can Nomi send texts to my customers?', why: 'to send texts' },
  { lang: 'zh', term: 'WeChat', text: '可以接微信吗？', why: 'WeChat in Chinese' },
  { lang: 'zh', term: 'WeCom', text: '支持企业微信吗？', why: 'WeCom in Chinese, which holds WeChat\'s word: WeCom is asked first' },
  { lang: 'zh', term: 'RED', text: '能连小红书吗', why: 'RED in Chinese' },
  { lang: 'zh', term: 'calls', text: '它可以给客户打电话吗？', why: '"can it phone customers?"' },
  { lang: 'zh', term: 'calls', text: '支持语音通话吗？', why: 'voice calls' },
  { lang: 'zh', term: 'Amazon', text: '能在亚马逊上用吗？', why: 'Amazon in Chinese' },
  { lang: 'zh', term: 'Google Calendar', text: '能同步谷歌日历吗？', why: 'Google Calendar in Chinese' },
  { lang: 'ar', term: 'calls', text: 'هل يمكنه إجراء مكالمات هاتفية مع العملاء؟', why: '"make telephone calls"' },
  { lang: 'ar', term: 'calls', text: 'هل يتصل بالعملاء؟', why: '"does it call the customers?"' },
  { lang: 'ar', term: 'Viber', text: 'هل يدعم فايبر؟', why: 'Viber in Arabic letters' },
  { lang: 'ar', term: 'LINE', text: 'هل يعمل مع تطبيق لاين؟', why: 'LINE in Arabic letters' },
  { lang: 'ar', term: 'Amazon', text: 'هل يمكن البيع على أمازون؟', why: 'Amazon in Arabic letters' },
  { lang: 'es', term: 'SMS', text: '¿Puede enviar mensajes de texto a mis clientes?', why: '"text messages" in Spanish' },
  { lang: 'es', term: 'calls', text: '¿Puede llamar a mis clientes?', why: '"call my customers" in Spanish' },
  { lang: 'es', term: 'WeChat', text: '¿Funciona con WeChat?', why: 'the name, in a Spanish question' },
  { lang: 'es', term: 'Google Calendar', text: '¿Se sincroniza con el calendario de Google?', why: 'Google Calendar in Spanish' },
  { lang: 'fr', term: 'calls', text: 'Peut-il passer des appels téléphoniques ?', why: '"telephone calls" in French' },
  { lang: 'fr', term: 'calls', text: 'Peut-il appeler mes clients ?', why: '"call my customers" in French' },
  { lang: 'fr', term: 'SMS', text: 'Peut-il envoyer des textos à mes clients ?', why: '"textos", the French word for SMS' },
  { lang: 'fr', term: 'Google Calendar', text: 'Est-ce que ça marche avec l\'agenda Google ?', why: 'Google Calendar in French' },
  { lang: 'fr', term: 'eBay', text: 'Peut-on le connecter à eBay ?', why: 'the name, in a French question' },

  // ── The tester's four that still reached the model (re-verification, 2026-11-10) ──
  { lang: 'en', term: 'calls', text: 'Can Nomi phone people who haven\'t replied?', why: '"phone" with "people": the calling family asked of Nomi, not only customers or clients' },
  { lang: 'ar', term: 'SMS', text: 'هل يدعم الرسائل القصيرة؟', why: '«الرسائل القصيرة», "the short messages", the common Arabic for SMS, with no «نصية»' },
  { lang: 'es', term: 'LINE', text: '¿Funciona con Line?', why: 'the app after "funciona con", only its first letter a capital' },
  { lang: 'fr', term: 'calls', text: 'Est-ce que Nomi peut téléphoner aux clients ?', why: '"téléphoner", the French verb of calling, asked of Nomi' },

  // ── Ten more, written for the families ──
  { lang: 'en', term: 'calls', text: 'Will the assistant ring customers who don\'t answer?', why: '"ring", the calling family\'s third verb' },
  { lang: 'en', term: 'SMS', text: 'Does Nomi text people when an order ships?', why: '"text" as a verb with "people" after it, asked of Nomi' },
  { lang: 'zh', term: 'calls', text: '能电话通知客户吗？', why: '电话通知, "notify by phone"' },
  { lang: 'zh', term: 'LINE', text: '可以接入Line吗？', why: 'the app after 接入, only its first letter a capital' },
  { lang: 'ar', term: 'calls', text: 'هل يتصل بهم Nomi؟', why: '«يتصل», "does it call them", the calling verb after «هل»' },
  { lang: 'ar', term: 'SMS', text: 'هل يمكنه إرسال رسائل قصيرة للعملاء؟', why: '"send short messages", SMS without «نصية»' },
  { lang: 'es', term: 'calls', text: '¿Puede Nomi telefonear a los clientes?', why: '"telefonear", the Spanish verb of calling' },
  { lang: 'es', term: 'LINE', text: '¿Se puede conectar a Line?', why: 'the app after "conectar a"' },
  { lang: 'fr', term: 'calls', text: 'Est-ce qu\'il peut appeler les gens qui n\'ont pas répondu ?', why: '"appeler les gens", people rather than clients' },
  { lang: 'fr', term: 'LINE', text: 'Ça marche avec Line ?', why: 'the app after "marche avec"' },
];

export const NOT_YET_PASSING: readonly NotYetPassing[] = [
  // ── The supervisor's three ──
  { lang: 'en', text: 'Why did line 3 of my list fail?', why: 'a line of a price list, not the app' },
  { lang: 'en', text: 'Can a customer say "call me Ana"?', why: 'a name, not a phone call' },
  { lang: 'en', text: 'I texted them yesterday, will it show here?', why: 'a report of a text the owner sent, not a question about SMS' },
  // ── English ──
  { lang: 'en', text: 'Which line of my price list failed?', why: 'a line of a list' },
  { lang: 'en', text: 'How do I reply to text on WhatsApp?', why: 'text as words, on a channel Nomi has' },
  { lang: 'en', text: 'Can I paste text messages from a chat into my products?', why: 'text pasted from a chat is how products are added' },
  { lang: 'en', text: 'Can I change the text customers see?', why: '"the text customers see" — text as a noun' },
  { lang: 'en', text: 'Can I send text and a photo in Practice?', why: 'text in Practice, not an SMS' },
  { lang: 'en', text: 'Can we chat about the price list?', why: '"we chat" as words, not WeChat' },
  { lang: 'en', text: 'We chat with customers on Instagram.', why: '"We chat" at a sentence\'s start, not the name' },
  { lang: 'en', text: 'Where is the calendar?', why: 'Nomi\'s own calendar' },
  { lang: 'en', text: 'Do customers see my phone number?', why: 'a phone number, not a call' },
  { lang: 'en', text: 'A customer called me yesterday about an order.', why: 'a report of a call' },
  { lang: 'en', text: 'Can I add a new line to a product?', why: 'a line of text' },
  // ── Chinese ──
  { lang: 'zh', text: '客户的电话号码在哪里？', why: 'a phone number, not a call' },
  { lang: 'zh', text: '他昨天给我打电话了，怎么记下来？', why: 'a report of a call, no "can it"' },
  { lang: 'zh', text: '我昨天给客户发了短信。', why: 'a report of an SMS the owner sent' },
  { lang: 'zh', text: '价目表第三行读错了。', why: 'a line of a list' },
  // ── Arabic ──
  { lang: 'ar', text: 'أين رقم هاتف العميل؟', why: 'a phone number, not a call' },
  { lang: 'ar', text: 'راسلتهم أمس، هل يظهر ذلك هنا؟', why: '"I messaged them yesterday" — a report' },
  { lang: 'ar', text: 'السطر الثالث من قائمة الأسعار لم يُقرأ.', why: 'a line of a list' },
  { lang: 'ar', text: 'اسمي آنا.', why: 'a name' },
  // ── Spanish ──
  { lang: 'es', text: 'Me llamo Ana, ¿dónde cambio mi nombre?', why: '"me llamo" is a name, not a call' },
  { lang: 'es', text: 'Un cliente me llamó ayer.', why: 'a report of a call' },
  { lang: 'es', text: 'La línea 3 de mi lista falló.', why: 'a line of a list' },
  { lang: 'es', text: '¿Puedo pegar el texto de mi lista?', why: 'text pasted, not an SMS' },
  // ── French ──
  { lang: 'fr', text: 'Je m\'appelle Ana, où changer mon nom ?', why: '"je m\'appelle" is a name, not a call' },
  { lang: 'fr', text: 'Un client m\'a appelé hier.', why: 'a report of a call' },
  { lang: 'fr', text: 'La ligne 3 de ma liste a échoué.', why: 'a line of a list' },
  { lang: 'fr', text: 'Je leur ai écrit hier.', why: 'a report of a message' },

  // ── Ten for the families: their words, in no question to Nomi about doing it ──
  { lang: 'en', text: 'I\'ll call you back after I check the price.', why: 'the owner\'s own promise to call, not a question about Nomi' },
  { lang: 'en', text: 'Can it read line 4 of my list?', why: 'a line of a list, in a question to Nomi' },
  { lang: 'en', text: 'Can it show the customer\'s phone number?', why: 'a phone number, not a call' },
  { lang: 'en', text: 'Is there a support line I can ring?', why: 'a support line, not the app, and the owner ringing it' },
  { lang: 'zh', text: '我回头给你打电话。', why: 'a promise to call, no question to Nomi' },
  { lang: 'zh', text: 'Line 是我的客户，她的订单在哪？', why: 'a customer called Line' },
  { lang: 'ar', text: 'اتصلت بالعميل أمس.', why: '"I called the customer yesterday" — a report' },
  { lang: 'ar', text: 'هل يمكن تغيير معلومات الاتصال؟', why: '«معلومات الاتصال», contact details, not a call' },
  { lang: 'ar', text: 'هل يمكن أن تكون الرسائل قصيرة؟', why: '"can the messages be short?" — the voice\'s length, not SMS' },
  { lang: 'es', text: '¿Cómo se puede llamar al asistente?', why: '"llamar" as naming the assistant, not a call' },
  { lang: 'es', text: 'Te llamo luego para confirmar.', why: 'the owner\'s own promise to call' },
  { lang: 'fr', text: 'Je vous appelle demain.', why: 'the owner\'s own promise to call' },
  { lang: 'fr', text: 'Peut-il lire la ligne 4 de ma liste ?', why: 'a line of a list' },
];
