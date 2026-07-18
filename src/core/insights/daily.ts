/**
 * M7 — Smart insights, not dashboards. One brief line about today, then at
 * most three insights — and every insight ends in a one-tap action. There
 * are deliberately NO chart pages: an insight that doesn't tell the owner
 * what to tap is a vanity metric and doesn't render.
 */

export type OneTapAction =
  | { readonly kind: 'review_drafts'; readonly labelZh: '去审批' }
  | { readonly kind: 'follow_up'; readonly buyerName: string; readonly labelZh: '发跟进' }
  | { readonly kind: 'open_conversation'; readonly buyerName: string; readonly labelZh: '看对话' }
  | { readonly kind: 'consider_promotion'; readonly capabilityZh: string; readonly labelZh: '看晋升' }
  | { readonly kind: 'fix_catalog'; readonly labelZh: '补资料' };

export type Insight = {
  readonly lineZh: string;                // one line, the finding
  readonly action: OneTapAction;          // structurally mandatory
};

export type DailyData = {
  readonly handled: number;
  readonly waitingApproval: number;
  readonly needFollowUp: readonly { readonly buyerName: string; readonly daysSilent: number }[];
  readonly hotLeadSilent: { readonly buyerName: string; readonly quotedUsd: number } | null;
  readonly promotionReady: string | null;         // capability zh when evidence met
  readonly productsMissingPrice: number;
};

/** 今天：12个已处理，3个等你审批，1个客户需要跟进 */
export function renderDailyBrief(d: DailyData): string {
  const bits = [
    `${d.handled}个已处理`,
    d.waitingApproval > 0 ? `${d.waitingApproval}个等你审批` : null,
    d.needFollowUp.length > 0 ? `${d.needFollowUp.length}个客户需要跟进` : null,
  ].filter(Boolean).join('，');
  return `今天：${bits || '还没有新动静'}`;
}

export const MAX_INSIGHTS = 3;

/** Priority order: money at risk → work waiting → growth → hygiene. */
export function deriveInsights(d: DailyData): readonly Insight[] {
  const out: Insight[] = [];

  if (d.hotLeadSilent) {
    out.push({
      lineZh: `${d.hotLeadSilent.buyerName} 拿了$${Math.round(d.hotLeadSilent.quotedUsd).toLocaleString('en-US')}的报价后没回音`,
      action: { kind: 'follow_up', buyerName: d.hotLeadSilent.buyerName, labelZh: '发跟进' },
    });
  }
  if (d.waitingApproval > 0) {
    out.push({
      lineZh: `${d.waitingApproval} 条草稿等你，最久的买家在等回复`,
      action: { kind: 'review_drafts', labelZh: '去审批' },
    });
  }
  const f = d.needFollowUp[0];
  if (f && !d.hotLeadSilent) {
    out.push({
      lineZh: `${f.buyerName} 已经 ${f.daysSilent} 天没说话，值得问一句`,
      action: { kind: 'follow_up', buyerName: f.buyerName, labelZh: '发跟进' },
    });
  }
  if (d.promotionReady) {
    out.push({
      lineZh: `「${d.promotionReady}」达到晋升标准了`,
      action: { kind: 'consider_promotion', capabilityZh: d.promotionReady, labelZh: '看晋升' },
    });
  }
  if (d.productsMissingPrice > 0) {
    out.push({
      lineZh: `${d.productsMissingPrice} 个产品还没有价格，问到只能先记着`,
      action: { kind: 'fix_catalog', labelZh: '补资料' },
    });
  }
  return out.slice(0, MAX_INSIGHTS);
}
