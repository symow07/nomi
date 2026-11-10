/** Each rule has a labelled witness and a disabled-rule control in comment-questions.test.ts. No model. */
const RULES = [
  { id: 'en-price', pattern: /\b(?:how much|what(?: is|'s) the price|what price|price\s*(?:please|pls|plz)|tell me the price|^price$)/u },
  { id: 'en-stock', pattern: /\b(?:is (?:this|it|the .+? one) (?:available|in stock)|do you have|any stock|can i buy|still available|^available$|^in stock$)/u },
  { id: 'zh-price', pattern: /(?:多少钱|什么价格|请问价格|怎么卖|价钱吗|价格多少|价格呢)/u },
  { id: 'zh-stock', pattern: /(?:有(?:现)?货吗|还有吗|可以买到吗|还有库存吗|有库存吗)/u },
  { id: 'ar-price', pattern: /(?:^بكم|كم السعر|ما سعر|السعر من فضلك|كم ثمن|بكام)/u },
  { id: 'ar-stock', pattern: /(?:هل (?:متوفر|هذا متاح|يوجد|في مخزون)|عندكم|متوفر\s*$|متاح\s*$)/u },
  { id: 'es-price', pattern: /\b(?:cuanto (?:cuesta|vale)|precio por favor|cual es el precio|que precio|^precio$)/u },
  { id: 'es-stock', pattern: /\b(?:esta disponible|tienen (?:en|este|esta)|hay stock|queda alguna|puedo comprar|^disponible$)/u },
  { id: 'fr-price', pattern: /\b(?:combien coute|prix svp|prix s il vous plait|quel est le prix|coute combien|a combien|^prix$)/u },
  { id: 'fr-stock', pattern: /\b(?:est ce disponible|vous avez|en stock$|il en reste|puis je acheter|^disponible$)/u },
  { id: 'pt-price', pattern: /\b(?:quanto (?:custa|fica)|preco por favor|qual (?:e )?o (?:preco|valor)|^preco$)/u },
  { id: 'pt-stock', pattern: /\b(?:esta disponivel|tem (?:em|estoque)|ainda tem|posso comprar|^disponivel$)/u },
  // Missed in review (2026-11-10); one phrasing a line, each line's witness named by its id in the test.
  { id: 'zh-price-is', pattern: /价格是多少/u },
  { id: 'zh-price-tell', pattern: /告诉我(?:一下)?价格吗/u },
  { id: 'ar-price-kam', pattern: /كم سعر/u },
  { id: 'ar-price-mumkin', pattern: /ممكن السعر/u },
  { id: 'ar-stock-mawjud', pattern: /هل (?:هو |هي |هذا |هذه )?موجود/u },
  { id: 'ar-stock-baqi', pattern: /هل بقي/u },
  { id: 'es-price-tell', pattern: /\bme (?:dices|das) el precio\b/u },
  { id: 'es-stock-quedan', pattern: /\bquedan unidades\b/u },
  { id: 'es-stock-hay-en', pattern: /^hay en\b/u },
  { id: 'es-stock-talla', pattern: /\btienen talla\b/u },
  { id: 'fr-price-ca', pattern: /\bcombien ca coute\b/u },
  { id: 'fr-price-cest', pattern: /\bc est combien\b/u },
  { id: 'fr-price-give', pattern: /\bme donner le prix\b/u },
  { id: 'fr-stock-vous-reste', pattern: /\bil vous en reste\b/u },
  { id: 'fr-stock-inverted', pattern: /\best (?:il|elle) disponible\b/u },
  { id: 'pt-price-tell', pattern: /\bme dizer o preco\b/u },
  { id: 'pt-stock-cor', pattern: /^tem na cor\b/u },
  { id: 'pt-stock-tamanho', pattern: /^tem tamanho\b/u },
] as const;
const NEGATED = /(?:\b(?:not asking|do not want|don t want|no pregunto|no quiero|ne demande pas|ne veux pas|nao pergunto|nao quero)\b|不问|都不买|لا اسال|لا اريد)/u;
/** A negation reaches only its own clause: "I don't want the red one, do you have it in blue?" still asks. */
const CLAUSE_END = /[,，、;；.。!！?？¿¡،؛\n]+/u;

/** Conservative recognition of a price or stock question; statements and unrelated questions stay alone. */
export function asksPriceOrAvailability(text: string): boolean {
  if (!text.trim() || text.length > 4000) return false;
  return text.split(CLAUSE_END).some(clauseAsks);
}

function clauseAsks(clause: string): boolean {
  const folded = clause.normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!folded || NEGATED.test(folded)) return false;
  return RULES.some(rule => rule.pattern.test(folded));
}
