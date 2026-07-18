/**
 * M5 — Monthly employee review (and the day-7 weekly summary): arithmetic
 * over recorded work, no vanity metrics. The outcome is one of four fixed
 * sentences the owner already knows from the vocabulary, chosen by
 * deterministic rules.
 */

export type ReviewStats = {
  readonly conversations: number;
  readonly draftsApproved: number;
  readonly draftsEdited: number;
  readonly autoReplies: number;         // sent without owner (promoted/night shift)
  readonly buyerReplies: number;        // buyers who answered — did the work land?
  readonly quotes: number;
  readonly ordersProgressed: number;
  readonly nightShiftHandled: number;
  readonly escalations: number;         // handoffs to a human
  readonly repairsOpened: number;
  readonly repairsClosed: number;
  readonly spotChecksPassed: number;
  readonly spotChecksFailed: number;
  readonly trainingExamplesAdded: number;
  readonly capabilitiesPromoted: readonly string[];   // zh capability names
  readonly capabilitiesLimited: readonly string[];
  /** prior period edit ratio, for the trend — null on the first review */
  readonly previousEditRatio: number | null;
};

export type ReviewOutcome =
  | '表现稳定，可以继续'
  | '有进步，建议继续观察'
  | '需要加强培训'
  | '某项职责建议暂时收回';

export type ComputedReview = {
  readonly editRatio: number;               // edited / (approved + edited)
  readonly autoShare: number;               // auto / (auto + approved + edited)
  readonly improving: boolean | null;       // vs previous period; null = no baseline
  readonly minutesSavedEstimate: number;    // honest arithmetic, labeled an estimate
  readonly outcome: ReviewOutcome;
  readonly supervisionFocusZh: string;      // where the owner still needs to look
};

/** ~3 minutes of owner time per handled message that needed no edit. */
export const MINUTES_SAVED_PER_CLEAN_ITEM = 3;

export function computeReview(s: ReviewStats): ComputedReview {
  const decided = s.draftsApproved + s.draftsEdited;
  const editRatio = decided === 0 ? 0 : s.draftsEdited / decided;
  const total = decided + s.autoReplies;
  const autoShare = total === 0 ? 0 : s.autoReplies / total;
  const improving = s.previousEditRatio === null ? null : editRatio < s.previousEditRatio;
  const minutesSavedEstimate = (s.draftsApproved + s.autoReplies) * MINUTES_SAVED_PER_CLEAN_ITEM;

  const openRepairs = s.repairsOpened - s.repairsClosed;
  const outcome: ReviewOutcome =
    s.capabilitiesLimited.length > 0 || openRepairs > 0 || s.spotChecksFailed > s.spotChecksPassed
      ? '某项职责建议暂时收回'
      : editRatio > 0.3
        ? '需要加强培训'
        : improving === true
          ? '有进步，建议继续观察'
          : '表现稳定，可以继续';

  const supervisionFocusZh =
    s.capabilitiesLimited.length > 0 ? `${s.capabilitiesLimited[0]}（已收回，等新的抽查）`
    : editRatio > 0.3 ? '报价和付款条件的说法，还需要你多看'
    : s.escalations > 3 ? '找真人谈的买家变多了，值得看看原因'
    : '大额订单和特殊付款条件';

  return { editRatio, autoShare, improving, minutesSavedEstimate, outcome, supervisionFocusZh };
}
