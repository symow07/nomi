import { TERM } from './vocabulary.js';
import { MARK } from './tokens.js';
import { box, joinLines, joinSections } from './components.js';
import { formatUsdCompact } from './format.js';

/**
 * M7 — The shareable 员工周报: a card designed to be screenshotted into a
 * WeChat group. This IS the v1 referral strategy, so it must brag honestly
 * (real numbers, no vanity), read at a glance, and carry a quiet mark that
 * tells the next owner where the employee came from.
 */

export type ShareableWeekInput = {
  readonly employeeName: string;
  readonly avatar: string;
  readonly weekZh: string;                   // e.g. 7月13日–7月19日
  readonly conversations: number;
  readonly nightShiftHandled: number;
  readonly quotes: number;
  readonly orderValueUsd: number;            // 0 = line omitted, never faked
  readonly highlightZh: string;              // ONE story, e.g. 凌晨2点接住了俄罗斯买家
  readonly knowledgeZh: string | null;       // knowledgeLineZh, optional
};

/** The referral mark — short, curious, never salesy. */
export const SHARE_MARK_ZH = '—— 数字员工，由 Nomi 打理';

export function renderShareableWeekly(w: ShareableWeekInput): string {
  return joinSections([
    box(`${w.avatar} ${w.employeeName}的一周`, [
      w.weekZh,
      `接待 ${w.conversations} 个${TERM.inquiry} · ${TERM.quote} ${w.quotes} 次`,
      w.nightShiftHandled > 0 ? `${TERM.nightShift}独立接待 ${w.nightShiftHandled} 次` : null,
      w.orderValueUsd > 0 ? `谈成 ${formatUsdCompact(w.orderValueUsd)} 的${TERM.order}` : null,
      `${MARK.star} ${w.highlightZh}`,
    ]),
    w.knowledgeZh,
    SHARE_MARK_ZH,
  ]);
}
