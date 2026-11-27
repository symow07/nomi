/** The settings overhaul (rule 104), Settings › Assistant: Reply permissions, Name and identity, Promises and words.
 * Only the words these three pages ADD — a page's one line, a shortened safety line, a table's column and cell
 * words. Every other sentence on them is the one the older pages already had, under its own key. All five languages. */
export const SETTINGS_ASSISTANT_EN = {
  'as.perm.lede': 'What {name} may send without you.',
  'as.perm.answering': '{name} is answering. Stopping cancels waiting replies on every channel.',
  'as.perm.disclosure': 'A reply sent without you tells your customer, in the first message, that they are not talking to a person, and offers someone from your team.',
  'as.perm.kind': 'Kind of reply',
  'as.perm.action': 'Action',
  'as.perm.locked': 'Cannot be changed',
  'as.perm.earned': 'Earned with your customers',
  'as.perm.again': 'Choose this level again',
  'as.name.lede': 'The name customers read, and how {name} talks to them.',
  'as.name.section': 'Name, job and tone',
  'as.name.edit': 'Edit',
  'as.name.editing': 'You are editing {who}.',
  'as.name.toMain': 'Edit the main assistant',
  'as.promises.lede': 'What {name} may claim, and the words {name} never uses.',
  'as.words.note': 'Note',
} as const;

type Key = keyof typeof SETTINGS_ASSISTANT_EN;

export const SETTINGS_ASSISTANT_ZH: Record<Key, string> = {
  'as.perm.lede': '{name}可以不经你同意发出哪些回复。',
  'as.perm.answering': '{name}正在回复。停止后，所有渠道上等待发出的回复都会取消。',
  'as.perm.disclosure': '不经你发出的回复，会在第一条消息里告诉客户对方不是真人，并提出可以转给你团队的人。',
  'as.perm.kind': '回复类型',
  'as.perm.action': '操作',
  'as.perm.locked': '不能更改',
  'as.perm.earned': '要在你的客户中逐步赢得',
  'as.perm.again': '重新选择这个级别',
  'as.name.lede': '客户看到的名字，以及{name}和客户说话的方式。',
  'as.name.section': '名字、职责和语气',
  'as.name.edit': '编辑',
  'as.name.editing': '你正在编辑{who}。',
  'as.name.toMain': '编辑主助手',
  'as.promises.lede': '{name}可以作出哪些声明，以及{name}绝不使用的词。',
  'as.words.note': '备注',
};

export const SETTINGS_ASSISTANT_AR: Record<Key, string> = {
  'as.perm.lede': 'ما يجوز أن يرسله {name} من دونك.',
  'as.perm.answering': '{name} يجيب الآن. الإيقاف يلغي الردود المنتظرة على كل القنوات.',
  'as.perm.disclosure': 'الرد المرسَل من دونك يخبر عميلك، في أول رسالة، أنه لا يتحدث مع شخص، ويعرض عليه أحد أفراد فريقك.',
  'as.perm.kind': 'نوع الرد',
  'as.perm.action': 'الإجراء',
  'as.perm.locked': 'لا يمكن تغييره',
  'as.perm.earned': 'يُكتسب مع عملائك',
  'as.perm.again': 'اختيار هذا المستوى من جديد',
  'as.name.lede': 'الاسم الذي يقرؤه العملاء، وطريقة حديث {name} معهم.',
  'as.name.section': 'الاسم والمهمة والنبرة',
  'as.name.edit': 'تعديل',
  'as.name.editing': 'أنت تعدّل {who}.',
  'as.name.toMain': 'تعديل المساعد الرئيسي',
  'as.promises.lede': 'ما يجوز أن يؤكده {name}، والكلمات التي لا يستخدمها {name} أبدًا.',
  'as.words.note': 'ملاحظة',
};

export const SETTINGS_ASSISTANT_ES: Record<Key, string> = {
  'as.perm.lede': 'Lo que {name} puede enviar sin ti.',
  'as.perm.answering': '{name} está respondiendo. Al detenerlo se cancelan las respuestas en espera en todos los canales.',
  'as.perm.disclosure': 'Una respuesta enviada sin ti le dice a tu cliente, en el primer mensaje, que no habla con una persona, y le ofrece a alguien de tu equipo.',
  'as.perm.kind': 'Tipo de respuesta',
  'as.perm.action': 'Acción',
  'as.perm.locked': 'No se puede cambiar',
  'as.perm.earned': 'Se gana con tus clientes',
  'as.perm.again': 'Elegir este nivel de nuevo',
  'as.name.lede': 'El nombre que leen los clientes y cómo les habla {name}.',
  'as.name.section': 'Nombre, función y tono',
  'as.name.edit': 'Editar',
  'as.name.editing': 'Estás editando a {who}.',
  'as.name.toMain': 'Editar el asistente principal',
  'as.promises.lede': 'Lo que {name} puede afirmar y las palabras que {name} nunca usa.',
  'as.words.note': 'Nota',
};

export const SETTINGS_ASSISTANT_FR: Record<Key, string> = {
  'as.perm.lede': 'Ce que {name} peut envoyer sans vous.',
  'as.perm.answering': '{name} répond en ce moment. L’arrêt annule les réponses en attente sur tous les canaux.',
  'as.perm.disclosure': 'Une réponse envoyée sans vous indique à votre client, dès le premier message, qu’il ne parle pas à une personne, et lui propose quelqu’un de votre équipe.',
  'as.perm.kind': 'Type de réponse',
  'as.perm.action': 'Action',
  'as.perm.locked': 'Ne peut pas être modifié',
  'as.perm.earned': 'Se gagne avec vos clients',
  'as.perm.again': 'Choisir à nouveau ce niveau',
  'as.name.lede': 'Le nom que lisent les clients, et la façon dont {name} leur parle.',
  'as.name.section': 'Nom, rôle et ton',
  'as.name.edit': 'Modifier',
  'as.name.editing': 'Vous modifiez {who}.',
  'as.name.toMain': 'Modifier l’assistant principal',
  'as.promises.lede': 'Ce que {name} peut affirmer, et les mots que {name} n’emploie jamais.',
  'as.words.note': 'Note',
};
