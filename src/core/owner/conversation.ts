import { formatWhenZh } from './format.js';
import { BUDGET } from './tokens.js';
import { buyerHeader, hiddenEarlier, joinLines, meaningLine } from './components.js';

/**
 * M1 — 对话回看: read a conversation. The second of the three daily actions.
 *
 * One message thread, rendered for a phone, newest context last, every foreign
 * message paired with its Chinese meaning. The owner reads it like scrolling
 * any chat — no interface to learn.
 */

export type ThreadMessage = {
  readonly direction: 'inbound' | 'outbound';
  readonly text: string;
  readonly textZh: string | null;    // back-translation; null when already zh
  readonly at: Date;
  readonly sentBy: 'employee' | 'owner' | null;  // outbound only
};

export function renderConversation(input: {
  buyerName: string;
  countryZh: string | null;
  employeeName: string;
  messages: readonly ThreadMessage[];
  now: Date;
  /** keep it one screen: show the last N, summarize the rest */
  limit?: number;
}): string {
  const limit = input.limit ?? BUDGET.conversationTail;
  const shown = input.messages.slice(-limit);
  const hidden = input.messages.length - shown.length;

  const header = `${buyerHeader({
    name: input.buyerName,
    countryZh: null,
  })}${input.countryZh ? `（${input.countryZh}）` : ''} 的对话`;

  const body = shown.flatMap((m) => {
    const when = formatWhenZh(m.at, input.now);
    const who =
      m.direction === 'inbound' ? '买家'
      : m.sentBy === 'owner' ? '你'
      : input.employeeName;
    return [
      `${when} ${who}：${m.text}`,
      m.textZh ? meaningLine(m.textZh, true) : null,
    ];
  });

  return joinLines([
    header,
    hidden > 0 ? hiddenEarlier(hidden) : null,
    '',
    ...body,
  ]);
}
