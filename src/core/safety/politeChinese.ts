/**
 * A CUSTOMER IS 您 (the owner, 2026-11-04). Customer-facing Chinese always says 您, never 你; the owner's own pages keep 你.
 *
 * The writer is told so (`prompts/response.txt`), and this makes it true of whatever the writer returned, with no model
 * call and no retry: 你 and 你们 become 您. Only the writer's words pass here. An owner's reply, a taught answer and an
 * edited draft are the owner's own and go as they wrote them; the fixed sentences are written with 您 and
 * `tests/parity/polite-chinese.test.ts` holds them.
 *
 * What stays: the word 迷你 ("mini"), and a name the business uses, whole. Japanese is left alone: kana anywhere says the
 * text is not Chinese.
 */

const KANA = /[぀-ヿ]/u;
const ALWAYS_KEPT: readonly string[] = ['迷你'];
const escaped = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function addressPolitely(reply: string, names: readonly string[] = []): string {
  if (!/[你妳]/u.test(reply) || KANA.test(reply)) return reply;
  const kept = [...names.filter((n) => /[你妳]/u.test(n)), ...ALWAYS_KEPT]
    .sort((a, b) => b.length - a.length).map(escaped).join('|');
  return reply.replace(new RegExp(`(${kept})|[你妳][们們]?`, 'gu'), (m, name: string | undefined) => (name ? m : '您'));
}
