/**
 * 5.4 — the words prefilled in the owner's private reply to a comment. The owner edits them and presses Send; nothing
 * goes without that. Written to the customer, so English and fixed (no owner catalogue: an Arabic page must not put
 * its direction marks into a message).
 *
 * NO PRICE unless the owner types one: the suggestion carries no figure of its own, the product's catalogue name is
 * the only thing named, and the customer's own words are quoted only when they hold no digit and no currency sign —
 * "is it $20?" quoted back would read as a price the owner never gave. No product link is stored anywhere, so none is
 * offered (one is never invented).
 */
const QUOTE_MAX = 200;

const quotable = (words: string): string | null => {
  const w = words.replace(/\s+/g, ' ').trim();
  if (!w || /[\p{Nd}\p{Sc}]/u.test(w)) return null;
  return w.length > QUOTE_MAX ? `${w.slice(0, QUOTE_MAX - 1)}…` : w;
};

export function suggestCommentReply(input: { readonly words: string; readonly productName: string | null }): string {
  const product = input.productName?.replace(/\s+/g, ' ').trim() || null;
  const quoted = quotable(input.words);
  return [
    product ? `Hi, thanks for your comment on our post about ${product}.` : 'Hi, thanks for your comment on our post.',
    quoted ? `You asked: “${quoted}”` : null,
    'How can I help?',
  ].filter((l): l is string => l !== null).join(' ');
}
