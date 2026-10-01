import type { BlockingReason, Quote, QuoteRefusal } from '../types/commerce.js';
import { currencySymbol, symbolIsCode } from '../types/money.js';
import type { FixedLanguage } from './gateLanguage.js';

/**
 * Deterministic outbound templates.
 *
 * Requirement: "Every outbound commitment must remain deterministic."
 * A message that COMMITS the business — an order confirmation, a refusal, a
 * blocking question about money — is rendered here, from code, with numbers
 * that came from SQL. The LLM writes conversational prose; it never writes
 * commitments.
 *
 * LG (decision 16) — each is written in English, Chinese and Arabic, and said
 * in the customer's language where it is one of the three (`fixedLanguage`);
 * any other language gets the English one, and that reply waits for the owner
 * (the gate per language). The Arabic addresses the customer in neither
 * gender (rule 6): the passive, a noun phrase, «يُرجى», the unvowelled ـك.
 */

/**
 * A unit as each language writes it in a customer's sentence — one and many
 * where the language tells them apart; one it does not know is left as written.
 */
const UNIT_WORDS: Readonly<Record<Exclude<FixedLanguage, 'en'>, Readonly<Record<string, readonly [string, string]>>>> = {
  zh: { pcs: ['件', '件'], item: ['件', '件'], items: ['件', '件'], sets: ['套', '套'], pairs: ['双', '双'], cartons: ['箱', '箱'], dozen: ['打', '打'], rolls: ['卷', '卷'], m: ['米', '米'], kg: ['公斤', '公斤'] },
  ar: { pcs: ['قطعة', 'قطعة'], item: ['قطعة', 'قطعة'], items: ['قطعة', 'قطعة'], sets: ['طقم', 'طقم'], pairs: ['زوج', 'زوج'], cartons: ['كرتون', 'كرتون'], dozen: ['دزينة', 'دزينة'], rolls: ['لفة', 'لفة'], m: ['متر', 'متر'], kg: ['كغ', 'كغ'] },
  es: { pcs: ['unidad', 'unidades'], item: ['unidad', 'unidades'], items: ['unidad', 'unidades'], sets: ['juego', 'juegos'], pairs: ['par', 'pares'], cartons: ['caja', 'cajas'], dozen: ['docena', 'docenas'], rolls: ['rollo', 'rollos'], m: ['metro', 'metros'], kg: ['kg', 'kg'] },
  fr: { pcs: ['pièce', 'pièces'], item: ['pièce', 'pièces'], items: ['pièce', 'pièces'], sets: ['lot', 'lots'], pairs: ['paire', 'paires'], cartons: ['carton', 'cartons'], dozen: ['douzaine', 'douzaines'], rolls: ['rouleau', 'rouleaux'], m: ['mètre', 'mètres'], kg: ['kg', 'kg'] },
  pt: { pcs: ['unidade', 'unidades'], item: ['unidade', 'unidades'], items: ['unidade', 'unidades'], sets: ['conjunto', 'conjuntos'], pairs: ['par', 'pares'], cartons: ['caixa', 'caixas'], dozen: ['dúzia', 'dúzias'], rolls: ['rolo', 'rolos'], m: ['metro', 'metros'], kg: ['kg', 'kg'] },
};
const unitIn = (lang: FixedLanguage, unit: string, n: number): string =>
  (lang === 'en' ? unit : UNIT_WORDS[lang][unit]?.[n === 1 ? 0 : 1] ?? unit);
/** A figure and its unit: set together in Chinese, a space between elsewhere (CC-13). */
const qtyIn = (lang: FixedLanguage, n: number, unit: string): string =>
  `${n.toLocaleString('en-US')}${lang === 'zh' ? '' : ' '}${unitIn(lang, unit, n)}`;

/**
 * G4 — "A confirmation email is on its way" was a promise nothing in this
 * product can keep: it sends no e-mail at all until M40 has a sender. The buyer
 * was told to wait for a message that would never come. What happens next is
 * the factory's own step, and that is what is said.
 */
export function orderConfirmedReply(input: {
  orderReference: string;
  productName: string;
  quantity: number;
  unit: string;
  language?: FixedLanguage;
}): string {
  const { orderReference, productName, quantity, unit } = input;
  const lang = input.language ?? 'en';
  // The positioning rewrite (2026-09-30): not every business is a factory,
  // and not every one sends a proforma.
  if (lang === 'zh') return `你的订单已确认——编号 ${orderReference}：${productName}，${qtyIn(lang, quantity, unit)}。接下来我们会把发票发给你。`;
  if (lang === 'ar') return `تم تأكيد الطلب — المرجع ${orderReference}: ${qtyIn(lang, quantity, unit)} من ${productName}. وستصلك الفاتورة بعد ذلك.`;
  if (lang === 'es') return `Tu pedido está confirmado — referencia ${orderReference}: ${productName}, ${qtyIn(lang, quantity, unit)}. Te enviaremos la factura a continuación.`;
  if (lang === 'fr') return `Votre commande est confirmée — référence ${orderReference} : ${productName}, ${qtyIn(lang, quantity, unit)}. Nous vous enverrons ensuite la facture.`;
  if (lang === 'pt') return `Seu pedido está confirmado — referência ${orderReference}: ${productName}, ${qtyIn(lang, quantity, unit)}. Em seguida enviaremos a fatura.`;
  return (
    `Your order is confirmed — reference ${orderReference}: ` +
    `${qtyIn(lang, quantity, unit)} of ${productName}. ` +
    `We'll send you the invoice next.`
  );
}

/** The sentences `orderBlockedReply` says, one per reason, in each language. */
const BLOCKED: Readonly<Record<FixedLanguage, Readonly<Record<'email_missing' | 'product_not_confirmed_by_client' | 'quantity_missing'
  | 'below_minimum' | 'pending_question_unresolved' | 'handed_off' | 'missing_product' | 'other', string>>>> = {
  en: {
    email_missing: 'Almost there — could you share the email address for the order confirmation?',
    product_not_confirmed_by_client: 'Before I confirm — could you confirm this is exactly the product you want?',
    quantity_missing: 'How many would you like?',
    below_minimum: 'The requested quantity is below the minimum order for this product — could you increase it?',
    pending_question_unresolved: 'Just to be sure we are aligned — could you answer my previous question first?',
    handed_off: 'A colleague of mine will personally review this order with you shortly.',
    missing_product: 'Could you tell me which product you would like to order?',
    other: 'I need one more detail before I can confirm — bear with me a moment.',
  },
  zh: {
    email_missing: '快好了——能发一下用于订单确认的邮箱地址吗？',
    product_not_confirmed_by_client: '确认之前——能确认一下这正是你要的产品吗？',
    quantity_missing: '需要多少？',
    below_minimum: '这个数量低于该产品的最低起订量——可以加一些吗？',
    pending_question_unresolved: '为了确认我们理解一致——能先回答一下上一个问题吗？',
    handed_off: '我们团队会有人尽快亲自和你确认这个订单。',
    missing_product: '想订哪个产品呢？',
    other: '确认之前还需要一个细节——请稍等。',
  },
  ar: {
    email_missing: 'اقتربنا — يُرجى مشاركة البريد الإلكتروني لتأكيد الطلب.',
    product_not_confirmed_by_client: 'قبل التأكيد — يُرجى التأكد من أن هذا هو المنتج المطلوب تمامًا.',
    quantity_missing: 'ما الكمية المطلوبة؟',
    below_minimum: 'الكمية المطلوبة أقل من الحد الأدنى للطلب من هذا المنتج — هل يمكن زيادتها؟',
    pending_question_unresolved: 'للتأكد من وضوح كل شيء — يُرجى الإجابة عن السؤال السابق أولًا.',
    handed_off: 'ستتم مراجعة هذا الطلب شخصيًا من فريقنا قريبًا.',
    missing_product: 'ما المنتج المراد طلبه؟',
    other: 'يلزم تفصيل واحد إضافي قبل التأكيد — لحظة من فضلك.',
  },
  // The customer is addressed as each language's disclosure addresses them,
  // and in no gender: no adjective agrees with the customer or with "us".
  es: {
    email_missing: 'Ya casi está. ¿Me compartes el correo electrónico para la confirmación del pedido?',
    product_not_confirmed_by_client: 'Antes de confirmar: ¿es exactamente este el producto que quieres?',
    quantity_missing: '¿Cuántas unidades quieres?',
    below_minimum: 'La cantidad pedida está por debajo del pedido mínimo de este producto. ¿Puedes aumentarla?',
    pending_question_unresolved: 'Para no confundirnos: ¿puedes responder primero a la pregunta anterior?',
    handed_off: 'Alguien de nuestro equipo revisará este pedido contigo personalmente en breve.',
    missing_product: '¿Qué producto quieres pedir?',
    other: 'Necesito un detalle más antes de confirmar. Un momento, por favor.',
  },
  fr: {
    email_missing: "On y est presque. Pouvez-vous indiquer l'adresse e-mail pour la confirmation de commande ?",
    product_not_confirmed_by_client: 'Avant de confirmer : est-ce bien exactement ce produit que vous voulez ?',
    quantity_missing: 'Combien en voulez-vous ?',
    below_minimum: "La quantité demandée est inférieure au minimum de commande pour ce produit. Pouvez-vous l'augmenter ?",
    pending_question_unresolved: "Pour bien nous comprendre : pouvez-vous d'abord répondre à la question précédente ?",
    handed_off: "Quelqu'un de notre équipe va revoir cette commande avec vous personnellement très bientôt.",
    missing_product: 'Quel produit souhaitez-vous commander ?',
    other: "Il me manque un détail avant de confirmer. Un instant, s'il vous plaît.",
  },
  pt: {
    email_missing: 'Quase lá. Pode enviar o e-mail para a confirmação do pedido?',
    product_not_confirmed_by_client: 'Antes de confirmar: é exatamente este o produto que você quer?',
    quantity_missing: 'Quantas unidades você quer?',
    below_minimum: 'A quantidade pedida está abaixo do pedido mínimo deste produto. Pode aumentar?',
    pending_question_unresolved: 'Para não haver confusão: pode responder primeiro à pergunta anterior?',
    handed_off: 'Alguém da nossa equipe vai revisar este pedido com você pessoalmente em breve.',
    missing_product: 'Qual produto você quer pedir?',
    other: 'Falta um detalhe antes de confirmar. Um momento, por favor.',
  },
};

export function orderBlockedReply(reasons: readonly BlockingReason[], quote: Quote | null, language: FixedLanguage = 'en'): string {
  const say = BLOCKED[language];
  // One question at a time: the FIRST unmet requirement, in funnel order.
  const first = reasons[0];
  switch (first) {
    case 'email_missing':
      return say.email_missing;
    case 'product_not_confirmed_by_client':
      return say.product_not_confirmed_by_client;
    case 'quantity_missing':
      return say.quantity_missing;
    case 'quantity_below_moq': {
      // 0081 — only a product with a stated minimum is ever below it; the
      // minimum is said in the product's own unit, not in "pieces".
      if (!quote || quote.moq === null) return say.below_minimum;
      const moq = qtyIn(language, quote.moq, quote.quantity.unit);
      if (language === 'zh') return `这个产品的最低起订量是${moq}——这个数量可以吗？`;
      if (language === 'ar') return `الحد الأدنى للطلب من هذا المنتج ${moq} — هل تناسب هذه الكمية؟`;
      if (language === 'es') return `El pedido mínimo de este producto es de ${moq}. ¿Te sirve esa cantidad?`;
      if (language === 'fr') return `Le minimum de commande pour ce produit est de ${moq}. Cette quantité vous convient-elle ?`;
      if (language === 'pt') return `O pedido mínimo deste produto é de ${moq}. Essa quantidade serve?`;
      return `The minimum order for this product is ${moq} — would that quantity work for you?`;
    }
    case 'pending_question_unresolved':
      return say.pending_question_unresolved;
    case 'problem_score_too_high':
    case 'conversation_handed_off':
      return say.handed_off;
    case 'missing_product':
      return say.missing_product;
    default:
      return say.other;
  }
}

export function quoteRefusalContext(refusal: QuoteRefusal): { note: string; allow: number[] } {
  switch (refusal.kind) {
    case 'below_moq':
      return {
        note: `Quantity ${refusal.requested} is below the minimum of ${refusal.moq}.`,
        allow: [refusal.moq, refusal.requested],
      };
    case 'below_floor':
      return { note: 'The requested price is below what we can offer.', allow: [] };
    case 'no_price_tier':
    case 'no_price_configured':
      // Passed as next_question, so it can reach the customer: said the way a customer may read it.
      return { note: 'There is no price set for this yet. Do not give one; say someone from the team will confirm the price.', allow: [] };
  }
}

/** The positioning rewrite (2026-09-30): "specialists" assumed a sales team; a one-person brand has none. */
export const HANDOFF_REPLIES: Readonly<Record<FixedLanguage, string>> = {
  en: 'Thanks — someone from our team will reply to you personally, as soon as they can.',
  zh: '谢谢——我们团队会有人尽快亲自回复你。',
  ar: 'شكرًا — سيصلك ردّ شخصي من فريقنا في أقرب وقت ممكن.',
  es: 'Gracias. Alguien de nuestro equipo te responderá personalmente en cuanto pueda.',
  fr: "Merci. Quelqu'un de notre équipe vous répondra personnellement dès que possible.",
  // «Obrigado/obrigada» agrees with who speaks; the assistant has no gender, so the team thanks.
  pt: 'Agradecemos a mensagem. Alguém da nossa equipe vai responder pessoalmente assim que possível.',
};

/**
 * G8 — the one reply that needs no guard: no figure, no claim, no promise, no
 * word an owner could reasonably forbid. Used when even the stand-in below
 * fails a guard, and always held for her (core/conversation/hold.ts).
 */
export const SAFE_REPLIES: Readonly<Record<FixedLanguage, string>> = {
  en: 'Thanks for your message — let me check the details and come back to you shortly.',
  zh: '谢谢你的消息——我核对一下细节，稍后回复你。',
  ar: 'شكرًا على الرسالة — سيتم التحقق من التفاصيل والعودة بالرد قريبًا.',
  es: 'Gracias por tu mensaje. Reviso los detalles y te respondo en breve.',
  fr: 'Merci pour votre message. Je vérifie les détails et je reviens vers vous rapidement.',
  pt: 'Agradecemos a mensagem. Vamos verificar os detalhes e responder em breve.',
};

/**
 * Stand-in when generation failed the guards twice. G8: guarded before use
 * (pipeline/turn.ts), and `nextQuestion` must be the analyser's question —
 * never an internal note meant for the writer.
 */
const TELL_ME_MORE: Readonly<Record<FixedLanguage, string>> = {
  en: 'Thanks for your message — could you tell me a little more about what you need?',
  zh: '谢谢你的消息——能再多说一点你的需求吗？',
  ar: 'شكرًا على الرسالة — يُرجى توضيح المطلوب بتفصيل أكثر.',
  es: 'Gracias por tu mensaje. ¿Puedes contarme un poco más de lo que necesitas?',
  fr: "Merci pour votre message. Pouvez-vous m'en dire un peu plus sur votre besoin ?",
  pt: 'Agradecemos a mensagem. Pode contar um pouco mais sobre o que precisa?',
};

export function guardFallbackReply(quote: Quote | null, nextQuestion: string | null, language: FixedLanguage = 'en'): string {
  if (quote) {
    // Symbol and code both come from the quote's currency. A hardcoded "$"
    // beside an amount that is not dollars is the defect M43a removes.
    // CUR — a currency written by its code ("AED 12.00") is not repeated after it.
    const unit = `${currencySymbol(quote.unitPrice.currency)}${quote.unitPrice.amount.toFixed(2)}` +
      `${symbolIsCode(quote.unitPrice.currency) ? '' : ` ${quote.unitPrice.currency}`}`;
    const total = `${currencySymbol(quote.total.currency)}${quote.total.amount.toLocaleString('en-US')}`;
    const days = quote.leadTimeDays;
    // RT — the price of one, as a shop gives it: no "for 1 pcs", no total that repeats it.
    const one = quote.quantity.value === 1;
    const qty = qtyIn(language, quote.quantity.value, quote.quantity.unit);
    if (language === 'zh') {
      return (one ? `单价 ${unit}` : `${qty}：单价 ${unit}，总价 ${total}`) + (days ? `，${days} 天可备好。` : '。');
    }
    if (language === 'ar') {
      return (one ? `السعر ${unit} للوحدة` : `لكمية ${qty}: سعر الوحدة ${unit}، والإجمالي ${total}`) +
        (days ? `، ومدة التجهيز بالأيام: ${days}.` : '.');
    }
    if (language === 'es') {
      return (one ? `${unit} por unidad` : `Para ${qty}: ${unit} por unidad, ${total} en total`) + (days ? `, con ${days} días de preparación.` : '.');
    }
    if (language === 'fr') {
      return (one ? `${unit} l'unité` : `Pour ${qty} : ${unit} l'unité, ${total} au total`) + (days ? `, délai de préparation : ${days} jours.` : '.');
    }
    if (language === 'pt') {
      return (one ? `${unit} por unidade` : `Para ${qty}: ${unit} por unidade, ${total} no total`) + (days ? `, com prazo de preparo de ${days} dias.` : '.');
    }
    // The positioning rewrite: "lead time" is trade vocabulary.
    return (one ? `${unit} each` : `For ${qty}: ${unit} each, ${total} in total`) + (days ? `, ready in ${days} days.` : '.');
  }
  return nextQuestion ?? TELL_ME_MORE[language];
}
