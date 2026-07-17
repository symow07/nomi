import { BOX, INDENT, MARK } from './tokens.js';

/**
 * M2 — The text component kit. Every owner-facing renderer composes these;
 * none draws its own borders, headers, translation lines, lists, or action
 * bars. One canonical component per pattern — duplicates get deleted.
 */

/** Display width on a phone: CJK and full-width chars count 2 columns. */
export const textWidth = (line: string): number =>
  [...line].reduce((w, ch) => w + ((ch.codePointAt(0) ?? 0) > 0xff ? 2 : 1), 0);

/** Join lines, dropping nulls. The one list-assembly idiom. */
export const joinLines = (parts: readonly (string | null)[]): string =>
  parts.filter((p): p is string => p !== null).join('\n');

/** Join sections with ONE blank line between — spacing is a token, not a habit. */
export const joinSections = (sections: readonly (string | null)[]): string =>
  sections.filter((s): s is string => s !== null && s !== '').join('\n\n');

/** Boxed card: computed facts look like an invoice, never like chat. */
export function box(title: string, lines: readonly (string | null)[]): string {
  return joinLines([
    BOX.top(title),
    ...lines.filter((l): l is string => l !== null).map((l) => `${BOX.side}${l}`),
    BOX.bottom,
  ]);
}

/** 👤 Ahmed · 阿联酋 · 老询盘 — the one way a buyer is introduced. */
export function buyerHeader(input: {
  readonly name: string | null;
  readonly countryZh: string | null;
  readonly tag?: string | null;       // 老询盘 / 新询盘 / 的对话 suffix handled by caller
}): string {
  return [`${MARK.person} ${input.name ?? '未知买家'}`, input.countryZh, input.tag ?? null]
    .filter(Boolean).join(' · ');
}

/** 标签：内容 — labeled line. */
export const labeled = (label: string, text: string): string => `${label}：${text}`;

/** Indented back-translation line under a foreign message. */
export const meaningLine = (zh: string, short = false): string =>
  `${short ? INDENT : ''}${short ? MARK.meaningShort : MARK.meaning}${zh}`;

/** 〔翻译〕 line for the buyer's own words. */
export const translationLine = (zh: string): string => `${MARK.translation}${zh}`;

/** Numbered list capped at `max`, remainder summarized — never a wall. */
export function numberedList(
  items: readonly string[],
  max: number,
): readonly string[] {
  const shown = items.slice(0, max).map((it, i) => `${i + 1}. ${it}`);
  if (items.length > max) shown.push(`……还有 ${items.length - max} 件`);
  return shown;
}

/** （更早的 N 条略过） */
export const hiddenEarlier = (n: number): string => `（更早的 ${n} 条略过）`;

/**
 * The action bar: reply words, always the same three, always this shape.
 * The owner learns it once and it works on every card forever.
 */
export const actionBar = (): string =>
  '回复「发送」照发 ｜「改 + 内容」按你的改 ｜「不回」跳过';
