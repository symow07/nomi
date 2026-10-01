/**
 * CH7 — A SHARED POST OR A STORY REPLY, MATCHED TO A PRODUCT. Pure.
 *
 * On Instagram the commonest first message is "price?" on a post, or a post
 * shared with no words at all. CH7a named it and handed it to a person. Now
 * the shop's OWN caption (read with its own Page token — another account's
 * post cannot be read, so it never matches) is looked at for the catalogue's
 * names: the product's name, its Chinese name, and every alias (T3).
 *
 *   · exactly one product named → the turn runs with that product named, on a
 *     line marked as what the customer did, never as words they said;
 *   · none, or several products named that are not one inside another (a
 *     carousel of three bags) → nothing is guessed: a post with no words goes
 *     to a person as before, now with its caption shown; words are answered
 *     as before.
 *
 * A name is found only whole: "bag" is not found in "handbag", and a name of
 * fewer than three characters (two for Chinese, Japanese or Korean) is never
 * looked for — "S", "XL" and "包" name nothing on their own. Where one
 * matched name holds another ("Silk scarf XL" and "Silk scarf"), the longer
 * one is the product meant.
 */
export type CatalogueEntry = {
  readonly productId: string;
  readonly name: string;
  readonly names: readonly string[];
};

export type PostMatch =
  | { readonly kind: 'matched'; readonly productId: string; readonly name: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'several' };

/** What arrived, for the line the turn reads. */
export type PostKind = 'shared_post' | 'story_reply';

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/u;

/** Lower case, width folded, marks and punctuation as spaces, one space between words. */
export function foldForMatch(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function found(caption: string, name: string): boolean {
  const n = foldForMatch(name);
  if (!n) return false;
  const cjk = CJK.test(n);
  if ([...n.replace(/ /g, '')].length < (cjk ? 2 : 3)) return false;
  // Chinese, Japanese and Korean are written without spaces: a name is found inside the run.
  if (cjk) return caption.replace(/ /g, '').includes(n.replace(/ /g, ''));
  return ` ${caption} `.includes(` ${n} `);
}

export function matchCaption(caption: string | null | undefined, catalogue: readonly CatalogueEntry[]): PostMatch {
  if (!caption || !caption.trim()) return { kind: 'none' };
  const text = foldForMatch(caption);
  const hits: { productId: string; name: string; term: string }[] = [];
  for (const p of catalogue) {
    let best: string | null = null;
    for (const term of [p.name, ...p.names]) {
      if (term && found(text, term)) {
        const f = foldForMatch(term);
        if (best === null || f.length > best.length) best = f;
      }
    }
    if (best !== null) hits.push({ productId: p.productId, name: p.name, term: best });
  }
  // A match held inside a longer match of another product is that product's, not its own.
  const kept = hits.filter((h) => !hits.some((o) => o.productId !== h.productId && o.term.length > h.term.length && o.term.includes(h.term)));
  const ids = new Set(kept.map((h) => h.productId));
  if (ids.size === 1) return { kind: 'matched', productId: kept[0]!.productId, name: kept[0]!.name };
  return ids.size === 0 ? { kind: 'none' } : { kind: 'several' };
}

/**
 * The line the turn reads: what the customer did, and the product's own
 * catalogue name. Marked in brackets like a photo's description — never
 * words in the customer's mouth. Not owner-facing copy.
 */
export function postLine(kind: PostKind, productName: string): string {
  return kind === 'story_reply'
    ? `[replied to your story about: ${productName}]`
    : `[shared your post about: ${productName}]`;
}

/** The caption as kept on a hand-off, for the card: trimmed, at most 600 characters. */
export function captionShown(caption: string | null | undefined): string | null {
  const c = (caption ?? '').replace(/\s+/g, ' ').trim();
  return c ? (c.length > 600 ? `${c.slice(0, 599)}…` : c) : null;
}
