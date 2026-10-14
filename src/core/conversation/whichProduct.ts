import type { RetrievedProduct } from '../../retrieval/ports.js';
import type { ProductId } from '../types/ids.js';
import type { FixedLanguage } from './gateLanguage.js';

/**
 * TWO PRODUCTS THE WORDS FIT ABOUT EQUALLY: ASK WHICH, NEVER GUESS (the owner, 2026-10-14).
 *
 * «无纺布袋多少钱？» in a shop with «无纺布购物袋» and «无纺布手提袋» fits both names exactly as well (0.400 each, 0156's
 * character pairs); "how much are the shopping bags?" fits a non-woven and a canvas one about as well (0.286, 0.308).
 * The analysis then picked one, and the turn priced it — "a confident price for the wrong product is a money error in
 * front of a real buyer, and the buyer has no way to know it's wrong." So when the two best names are close, neither
 * is taken: the buyer is asked which, by name, and nothing is priced. A clear lead is not asked about: «无纺布购物袋» said
 * whole (1.0 against 0.4), or «无纺布袋» against «帆布袋» (0.40 against 0.25).
 *
 * Close = the second at least `CLOSE` of the first, both found by their names (a semantic rank is another scale). A
 * product the buyer already confirmed in this conversation is not asked about again.
 *
 * Pure.
 */
export const CLOSE = 0.85;

export function closeCall(
  candidates: readonly RetrievedProduct[],
  confirmed: ProductId | null,
): readonly [RetrievedProduct, RetrievedProduct] | null {
  const byName = candidates.filter((c) => c.matchedVia === 'trigram').slice().sort((a, b) => b.relevance - a.relevance);
  const [a, b] = byName;
  if (!a || !b || a.productId === b.productId) return null;
  if (confirmed !== null && (a.productId === confirmed || b.productId === confirmed)) return null;
  return b.relevance >= CLOSE * a.relevance ? [a, b] : null;
}

/** "Which one — A or B?", in the buyer's language; the names as the owner wrote them (her Chinese name to a Chinese buyer). */
export function whichOne(a: string, b: string, language: FixedLanguage): string {
  switch (language) {
    case 'zh': return `请问您指的是哪一款：${a}，还是${b}？`;
    case 'ar': return `أيّ المنتجين هو المقصود: ${a} أم ${b}؟`;
    case 'es': return `¿Cuál de los dos: ${a} o ${b}?`;
    case 'fr': return `Lequel des deux : ${a} ou ${b} ?`;
    case 'pt': return `Qual dos dois: ${a} ou ${b}?`;
    default: return `Which one do you mean — ${a} or ${b}?`;
  }
}
