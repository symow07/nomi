import { formatWhenZh } from './format.js';

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
  const limit = input.limit ?? 8;
  const shown = input.messages.slice(-limit);
  const hidden = input.messages.length - shown.length;

  const lines: string[] = [
    `👤 ${input.buyerName}${input.countryZh ? `（${input.countryZh}）` : ''} 的对话`,
  ];
  if (hidden > 0) lines.push(`（更早的 ${hidden} 条略过）`);
  lines.push('');

  for (const m of shown) {
    const when = formatWhenZh(m.at, input.now);
    if (m.direction === 'inbound') {
      lines.push(`${when} 买家：${m.text}`);
      if (m.textZh) lines.push(`　〔意思〕${m.textZh}`);
    } else {
      const who = m.sentBy === 'owner' ? '你' : input.employeeName;
      lines.push(`${when} ${who}：${m.text}`);
      if (m.textZh) lines.push(`　〔意思〕${m.textZh}`);
    }
  }
  return lines.join('\n');
}
