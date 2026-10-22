/**
 * S4 (Phase 5, item 16) — STRICT MODE PER LANGUAGE. Pure.
 *
 * In a strict language, what the assistant sends alone is only sentences a native reader of that language signed:
 * each reply sent without a person pressing send must be made, end to end, of signed sentences, their blanks filled
 * by Nomi's own facts — never free text the model wrote. A reply that is not waits for the owner as a draft, like any
 * other held reply (`autonomy_withheld: strict_unapproved`). It only ever takes the right to send alone away.
 *
 * GATED ON A PERSON (decision 15): a language is strict only when its reader signed a set — the exact sentences, the
 * reader named, in the same commit (`SIGNED`). None is signed today, so strict mode is in force nowhere and nothing
 * changes until one is. `PROPOSED` is what a reader is given to read: the starter set, written here, unsigned.
 *
 * The blanks, and what may fill them — nothing else:
 *   · {product}  — the name of the product this turn is about, exactly as the catalogue has it;
 *   · {business} — the business's name; {name} — the assistant's chosen name;
 *   · {qty}      — a whole number (digits as buyers type them, grouped or not);
 *   · {price}    — an amount: a figure with at most a currency sign or code beside it;
 *   · {days}     — one to three digits.
 * The figures themselves are checked where every reply's are (the numeral guard): this is about the words.
 */
export const STRICT_LOCALES = ['en', 'zh', 'ar', 'es', 'fr'] as const;
export type StrictLocale = (typeof STRICT_LOCALES)[number];

/** The starter sets, for a reader to read and sign or change. Not in force: only `SIGNED` is. */
const PROPOSED: Readonly<Record<StrictLocale, readonly string[]>> = {
  en: [
    'Hello, thank you for your message.',
    'Which product are you interested in?',
    'How many pieces do you need?',
    'The price of {product} is {price} per piece for {qty} pieces.',
    'The minimum order for {product} is {qty} pieces.',
    '{product} can be ready in {days} days.',
    'We can send a sample of {product}.',
    'Someone from our team will reply as soon as possible.',
    'Thank you!',
  ],
  zh: [
    '您好，感谢您的留言。',
    '请问您对哪款产品感兴趣？',
    '请问您需要多少件？',
    '{product}{qty}件的价格是每件{price}。',
    '{product}的起订量是{qty}件。',
    '{product}可以在{days}天内备好。',
    '我们可以寄送{product}的样品。',
    '我们团队的同事会尽快回复您。',
    '谢谢！',
  ],
  // No gender for the buyer (rule 6): noun phrases and the passive, never an imperative or an agreeing verb.
  ar: [
    'مرحبًا، شكرًا على الرسالة.',
    'ما المنتج المطلوب؟',
    'كم عدد القطع المطلوبة؟',
    'سعر {product} هو {price} للقطعة عند طلب {qty} قطعة.',
    'الحد الأدنى للطلب من {product} هو {qty} قطعة.',
    'يمكن تجهيز {product} خلال {days} يومًا.',
    'يمكن إرسال عينة من {product}.',
    'سيصل الرد من أحد أفراد فريقنا في أقرب وقت ممكن.',
    'شكرًا!',
  ],
  es: [
    'Hola, gracias por tu mensaje.',
    '¿Qué producto te interesa?',
    '¿Cuántas piezas necesitas?',
    'El precio de {product} es {price} por pieza para {qty} piezas.',
    'El pedido mínimo de {product} es de {qty} piezas.',
    '{product} puede estar listo en {days} días.',
    'Podemos enviar una muestra de {product}.',
    'Una persona de nuestro equipo responderá lo antes posible.',
    '¡Gracias!',
  ],
  fr: [
    'Bonjour, merci pour votre message.',
    'Quel produit vous intéresse ?',
    'Combien de pièces vous faut-il ?',
    'Le prix de {product} est de {price} la pièce pour {qty} pièces.',
    'La commande minimum pour {product} est de {qty} pièces.',
    '{product} peut être prêt en {days} jours.',
    'Nous pouvons envoyer un échantillon de {product}.',
    'Une personne de notre équipe va répondre dès que possible.',
    'Merci !',
  ],
};

/**
 * The sets a reader signed, by language: the sentences exactly as signed, and who signed them. Written here only in
 * the commit that names the reader; never by an assistant. Empty: strict mode is in force in no language.
 */
const SIGNED: Readonly<Partial<Record<StrictLocale, { readonly sentences: readonly string[]; readonly by: string }>>> = {};

/** Which languages are strict, and their signed sentences. */
export type StrictSigned = Readonly<Partial<Record<StrictLocale, readonly string[]>>>;
export const STRICT_SIGNED: StrictSigned = Object.freeze(Object.fromEntries(
  STRICT_LOCALES.flatMap((l) => (SIGNED[l] ? [[l, SIGNED[l]!.sentences]] : []))) as StrictSigned);

/** The starter set, for a reader to sign (and for the tests). */
export const proposedSentences = (l: StrictLocale): readonly string[] => PROPOSED[l];

/** The signed sentences of a language when it is strict; null when it is not (the reply is then not checked here). */
export function strictSetFor(language: string | null | undefined, signed: StrictSigned = STRICT_SIGNED): readonly string[] | null {
  const head = (language ?? '').slice(0, 2).toLowerCase();
  const l = STRICT_LOCALES.find((x) => x === head);
  return l ? signed[l] ?? null : null;
}

export type StrictFacts = { readonly product: string | null; readonly business: string | null; readonly name: string | null };

const QTY = '[0-9٠-٩۰-۹](?:[0-9٠-٩۰-۹]|[,.٬   ](?=[0-9٠-٩۰-۹]{3}))*';
const PRICE = `(?:[$€£¥￥]|[A-Z]{3} ?)?${QTY}(?:[.,٫][0-9٠-٩۰-۹]{1,2})?(?: ?[A-Z]{3}| ?(?:元|درهم|ريال))?`;
const DAYS = '[0-9٠-٩۰-۹]{1,3}';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tidy = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();

/** One signed sentence as a pattern, its blanks filled only as allowed; null when a blank has nothing to fill it. */
function patternOf(sentence: string, facts: StrictFacts): string | null {
  let missing = false;
  const out = tidy(sentence).split(/(\{[a-z]+\})/).map((part) => {
    const blank = /^\{([a-z]+)\}$/.exec(part)?.[1];
    if (blank === undefined) return escape(part);
    const fact = blank === 'product' ? facts.product : blank === 'business' ? facts.business : blank === 'name' ? facts.name : null;
    if (blank === 'qty') return QTY;
    if (blank === 'price') return PRICE;
    if (blank === 'days') return DAYS;
    if (fact && fact.trim()) return escape(tidy(fact));
    missing = true;
    return '';
  }).join('');
  return missing ? null : out;
}

/**
 * Is this reply made ONLY of signed sentences, end to end? Each sentence in turn, separated by a space or a line break
 * (or nothing, in Chinese);
 * nothing before, between or after them. A reply that is not — a word changed, a sentence added, a blank filled with
 * anything but its fact — is not, and waits for the owner.
 */
export function onlySignedSentences(reply: string, sentences: readonly string[], facts: StrictFacts): boolean {
  const text = tidy(reply);
  if (!text) return false;
  const patterns = sentences.map((s) => patternOf(s, facts)).filter((p): p is string => p !== null);
  if (patterns.length === 0) return false;
  // Separated by a space, or by nothing where the script writes none (Chinese runs its sentences together).
  const one = `(?:${patterns.map((p) => `(?:${p})`).join('|')})`;
  return new RegExp(`^${one}(?: ?${one})*$`, 'u').test(text);
}
