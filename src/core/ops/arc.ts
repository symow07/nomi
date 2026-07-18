/**
 * M8 — The 30-day emotional arc, instrumented. Five beats — first draft
 * ("it works") through the monthly review ("renewal is obvious") — each
 * derived out of tables that already exist; nothing is logged specially
 * for this, so nothing can be faked for it.
 */

export type ArcBeat =
  | 'minute10_first_draft'   // onboarding_state.first_draft_approved_at   ("it works")
  | 'day1_first_real_buyer'  // first non-test inbound conversation        (excitement)
  | 'week1_trust'            // spot check passed AND a correction learned  (trust)
  | 'week2_letting_go'       // first promotion offered (evidence met)      (letting go)
  | 'month1_renewal_obvious';// monthly review rendered with hours + knowledge

export const ARC_ORDER: readonly ArcBeat[] = [
  'minute10_first_draft', 'day1_first_real_buyer', 'week1_trust',
  'week2_letting_go', 'month1_renewal_obvious',
];

export type ArcSignals = {
  readonly signupAt: Date;
  readonly firstDraftApprovedAt: Date | null;
  readonly firstRealBuyerAt: Date | null;
  readonly firstSpotCheckPassedAt: Date | null;
  readonly firstCorrectionLearnedAt: Date | null;
  readonly firstPromotionOfferedAt: Date | null;
  readonly firstMonthlyReviewAt: Date | null;
};

export type ArcStatus = {
  readonly reached: readonly { readonly beat: ArcBeat; readonly at: Date; readonly dayN: number }[];
  readonly next: ArcBeat | null;
};

const day = (signup: Date, at: Date): number =>
  Math.floor((at.getTime() - signup.getTime()) / (24 * 3600 * 1000));

export function arcStatus(s: ArcSignals): ArcStatus {
  const at: Record<ArcBeat, Date | null> = {
    minute10_first_draft: s.firstDraftApprovedAt,
    day1_first_real_buyer: s.firstRealBuyerAt,
    week1_trust:
      s.firstSpotCheckPassedAt && s.firstCorrectionLearnedAt
        ? new Date(Math.max(s.firstSpotCheckPassedAt.getTime(), s.firstCorrectionLearnedAt.getTime()))
        : null,
    week2_letting_go: s.firstPromotionOfferedAt,
    month1_renewal_obvious: s.firstMonthlyReviewAt,
  };

  const reached: ArcStatus['reached'][number][] = [];
  let next: ArcBeat | null = null;
  for (const beat of ARC_ORDER) {
    const t = at[beat];
    if (t) reached.push({ beat, at: t, dayN: day(s.signupAt, t) });
    else if (next === null) next = beat;
  }
  return { reached, next };
}
