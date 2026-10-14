import type { RetrievedProduct } from '../../retrieval/ports.js';
import type { ProductId } from '../types/ids.js';
import type { FixedLanguage } from './gateLanguage.js';

/**
 * TWO PRODUCTS THE WORDS FIT ABOUT EQUALLY: ASK WHICH, NEVER GUESS (the owner, 2026-10-14).
 *
 * «无纺布袋多少钱？» in a shop with «无纺布购物袋» and «无纺布手提袋» fits both names exactly as well (0.400 each, 0156's
 * character pairs); "how much are the shopping bags?" fits a non-woven and a canvas one about as well (0.286, 0.308).
 * The analysis then picked one, and the turn priced it — "a confident price for the wrong product is a money error in
 * front of a real buyer, and the buyer has no way to know it's wrong." So when the best names are close, none is
 * taken: the buyer is asked which, by name, and nothing is priced. A clear lead is not asked about: «无纺布购物袋» said
 * whole (1.0 against 0.4), or «无纺布袋» against «帆布袋» (0.40 against 0.25).
 *
 * Close = at least `CLOSE` of the best score, found by name (a semantic rank is another scale). EVERY product that
 * close is in the question (the owner, on #343: "an owner with five bag variants will hit that"): up to `NAMED` by
 * name; past that, the first `NAMED` and how many more fit — never two picked from five, never one dropped in silence.
 * A product the buyer already confirmed in this conversation is not asked about again.
 *
 * Pure.
 */
export const CLOSE = 0.85;
/** How many close products the question names; the rest are counted. */
export const NAMED = 4;

export function closeCall(
  candidates: readonly RetrievedProduct[],
  confirmed: ProductId | null,
): readonly RetrievedProduct[] | null {
  const seen = new Set<string>();
  const byName = candidates
    .filter((c) => c.matchedVia === 'trigram')
    .filter((c) => (seen.has(c.productId) ? false : (seen.add(c.productId), true)))
    // Best first; equal scores in name order, so the question reads the same every time.
    .sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name));
  const top = byName[0];
  if (!top) return null;
  const close = byName.filter((c) => c.relevance >= CLOSE * top.relevance);
  if (close.length < 2) return null;
  if (confirmed !== null && close.some((c) => c.productId === confirmed)) return null;
  return close;
}

/** "Which one do you mean — A, B or C?", in the buyer's language; the names as the owner wrote them. */
export function whichOne(names: readonly string[], language: FixedLanguage): string {
  const shown = names.slice(0, NAMED);
  const more = names.length - shown.length;
  const last = shown[shown.length - 1]!;
  const head = shown.slice(0, -1);
  if (more > 0) {
    switch (language) {
      case 'zh': return `有几款都符合：${shown.join('、')}，另外还有${more}款。请问您指的是哪一款？`;
      case 'ar': return `عدة منتجات تطابق الطلب: ${shown.join('، ')}، و${more} غيرها. أيّ منتج هو المقصود؟`;
      case 'es': return `Varios encajan: ${shown.join(', ')} y ${more} más. ¿Cuál de ellos?`;
      case 'fr': return `Plusieurs correspondent : ${shown.join(', ')} et ${more} autres. Lequel ?`;
      case 'pt': return `Vários correspondem: ${shown.join(', ')} e mais ${more}. Qual deles?`;
      default: return `Several fit: ${shown.join(', ')}, and ${more} more. Which one do you mean?`;
    }
  }
  switch (language) {
    case 'zh': return `请问您指的是哪一款：${head.join('、')}，还是${last}？`;
    case 'ar': return shown.length === 2
      ? `أيّ المنتجين هو المقصود: ${head[0]} أم ${last}؟`
      : `أيّ منتج هو المقصود: ${head.join(' أم ')} أم ${last}؟`;
    case 'es': return shown.length === 2 ? `¿Cuál de los dos: ${head[0]} o ${last}?` : `¿Cuál de ellos: ${head.join(', ')} o ${last}?`;
    case 'fr': return shown.length === 2 ? `Lequel des deux : ${head[0]} ou ${last} ?` : `Lequel : ${head.join(', ')} ou ${last} ?`;
    case 'pt': return shown.length === 2 ? `Qual dos dois: ${head[0]} ou ${last}?` : `Qual deles: ${head.join(', ')} ou ${last}?`;
    default: return `Which one do you mean — ${head.join(', ')} or ${last}?`;
  }
}
