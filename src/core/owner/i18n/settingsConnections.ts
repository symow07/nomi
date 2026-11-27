/** The settings overhaul (rule 104) — Settings › Connections and Settings › You: the words these pages add to become
 * the one template (a line under each title, the danger zone's one line per action, the Account page's one refusal).
 * Every other sentence on these pages is the one it already was. Written in all five languages. */
export const SETTINGS_CONNECTIONS_EN = {
  'set.channels.lede': 'Every place customers write to you, and where each connection stands.',
  'set.wa.lede': 'Your WhatsApp number: where its connection stands and what WhatsApp allows.',
  'set.wa.disconnect.what': 'Messages stop arriving and nothing is sent on WhatsApp. Your conversations stay.',
  'set.meta.lede': 'One Facebook Page connects both Instagram and Messenger.',
  'set.meta.rules': 'What these two places allow',
  'set.meta.disconnect.what': 'Nothing from that Page or Instagram reaches you until you connect again.',
  'set.email.lede': 'The mailbox e-mail leaves from, and your own sending domain.',
  'set.email.domain': 'Your sending domain',
  'set.email.disconnect.what': 'No e-mail leaves until an account is connected again.',
  'set.shopify.disconnect.what': 'Nomi forgets its access to the store and stops answering order questions.',
  'set.account.lede': 'How you sign in, and the language Nomi shows you.',
  'set.account.pw.both': 'To change your password, fill in both your current password and the new one.',
  'set.flash.saved': 'Saved.',
} as const;

type Key = keyof typeof SETTINGS_CONNECTIONS_EN;

export const SETTINGS_CONNECTIONS_ZH: Record<Key, string> = {
  'set.channels.lede': '客户给你发消息的每个地方，以及每个连接的状态。',
  'set.wa.lede': '你的 WhatsApp 号码：连接状态，以及 WhatsApp 允许什么。',
  'set.wa.disconnect.what': 'WhatsApp 上不再收到消息，也不会发出任何消息。已有的对话会保留。',
  'set.meta.lede': '一个 Facebook 主页同时连接 Instagram 和 Messenger。',
  'set.meta.rules': '这两个地方允许什么',
  'set.meta.disconnect.what': '在你重新连接之前，这个主页和 Instagram 的消息都不会到你这里。',
  'set.email.lede': '发出邮件的邮箱，以及你自己的发信域名。',
  'set.email.domain': '你的发信域名',
  'set.email.disconnect.what': '再连接一个账户之前不会发出任何邮件。',
  'set.shopify.disconnect.what': 'Nomi 不再保留这家店铺的访问权限，也不再回答订单问题。',
  'set.account.lede': '你的登录方式，以及 Nomi 给你显示的语言。',
  'set.account.pw.both': '要更改密码，请同时填写当前密码和新密码。',
  'set.flash.saved': '已保存。',
};

export const SETTINGS_CONNECTIONS_AR: Record<Key, string> = {
  'set.channels.lede': 'كل مكان يكتب إليك فيه العملاء، وحالة كل اتصال.',
  'set.wa.lede': 'رقم واتساب الخاص بك: حالة اتصاله وما يسمح به واتساب.',
  'set.wa.disconnect.what': 'تتوقف الرسائل عن الوصول ولا يُرسل شيء على واتساب. تبقى محادثاتك.',
  'set.meta.lede': 'صفحة فيسبوك واحدة تربط إنستغرام وماسنجر معًا.',
  'set.meta.rules': 'ما يسمح به هذان المكانان',
  'set.meta.disconnect.what': 'لا يصلك شيء من تلك الصفحة أو من إنستغرام حتى تعيد الاتصال.',
  'set.email.lede': 'صندوق البريد الذي يخرج منه البريد الإلكتروني، ونطاق الإرسال الخاص بك.',
  'set.email.domain': 'نطاق الإرسال الخاص بك',
  'set.email.disconnect.what': 'لا يخرج أي بريد إلكتروني حتى يُربط حساب من جديد.',
  'set.shopify.disconnect.what': 'ينسى Nomi صلاحية الوصول إلى المتجر ويتوقف عن الإجابة عن أسئلة الطلبات.',
  'set.account.lede': 'طريقة دخولك، واللغة التي يعرضها لك Nomi.',
  'set.account.pw.both': 'لتغيير كلمة المرور، اكتب كلمة المرور الحالية والجديدة معًا.',
  'set.flash.saved': 'تم الحفظ.',
};

export const SETTINGS_CONNECTIONS_ES: Record<Key, string> = {
  'set.channels.lede': 'Cada lugar donde te escriben tus clientes y cómo está cada conexión.',
  'set.wa.lede': 'Tu número de WhatsApp: cómo está su conexión y qué permite WhatsApp.',
  'set.wa.disconnect.what': 'Dejan de llegar mensajes y no se envía nada por WhatsApp. Tus conversaciones se quedan.',
  'set.meta.lede': 'Una sola página de Facebook conecta Instagram y Messenger.',
  'set.meta.rules': 'Qué permiten estos dos lugares',
  'set.meta.disconnect.what': 'No te llega nada de esa página ni de Instagram hasta que vuelvas a conectar.',
  'set.email.lede': 'El buzón desde el que sale el correo y tu propio dominio de envío.',
  'set.email.domain': 'Tu dominio de envío',
  'set.email.disconnect.what': 'No sale ningún correo hasta que se conecte otra cuenta.',
  'set.shopify.disconnect.what': 'Nomi olvida su acceso a la tienda y deja de responder preguntas sobre pedidos.',
  'set.account.lede': 'Cómo inicias sesión y el idioma en que Nomi te habla.',
  'set.account.pw.both': 'Para cambiar tu contraseña, escribe la actual y la nueva.',
  'set.flash.saved': 'Guardado.',
};

export const SETTINGS_CONNECTIONS_FR: Record<Key, string> = {
  'set.channels.lede': 'Chaque endroit où vos clients vous écrivent, et l’état de chaque connexion.',
  'set.wa.lede': 'Votre numéro WhatsApp : l’état de sa connexion et ce que WhatsApp autorise.',
  'set.wa.disconnect.what': 'Les messages n’arrivent plus et rien n’est envoyé sur WhatsApp. Vos conversations restent.',
  'set.meta.lede': 'Une seule Page Facebook connecte Instagram et Messenger.',
  'set.meta.rules': 'Ce que ces deux endroits autorisent',
  'set.meta.disconnect.what': 'Plus rien ne vous parvient de cette Page ni d’Instagram tant que vous ne reconnectez pas.',
  'set.email.lede': 'La boîte d’où partent les e-mails, et votre propre domaine d’envoi.',
  'set.email.domain': 'Votre domaine d’envoi',
  'set.email.disconnect.what': 'Aucun e-mail ne part tant qu’un compte n’est pas reconnecté.',
  'set.shopify.disconnect.what': 'Nomi oublie son accès à la boutique et ne répond plus aux questions sur les commandes.',
  'set.account.lede': 'Comment vous vous connectez, et la langue dans laquelle Nomi s’affiche.',
  'set.account.pw.both': 'Pour changer de mot de passe, saisissez l’actuel et le nouveau.',
  'set.flash.saved': 'Enregistré.',
};
