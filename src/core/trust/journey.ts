/**
 * M5 — The first-week trust journey: seven defined days, each with one beat
 * that must actually have happened (event-driven in production, deterministic
 * in the demo factory — never faked in production).
 */

export type JourneyDay = {
  readonly day: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly beat:
    | 'introduction'        // employee + job sheet shown, first supervised draft
    | 'first_correction'    // an edit was remembered (scoped)
    | 'first_night_shift'   // morning recap of the night
    | 'first_spot_check'
    | 'buyer_memory'        // returning buyer recalled
    | 'progress_update'     // capability progress (NOT necessarily promotion)
    | 'weekly_summary';
  readonly goalZh: string;  // what the owner should feel by end of day
};

export const FIRST_WEEK: readonly JourneyDay[] = [
  { day: 1, beat: 'introduction',      goalZh: '知道她负责什么、什么要等你审批' },
  { day: 2, beat: 'first_correction',  goalZh: '看到你改过的说法被记住了' },
  { day: 3, beat: 'first_night_shift', goalZh: '看到你睡觉时发生了什么' },
  { day: 4, beat: 'first_spot_check',  goalZh: '两分钟抽查一次她做过的事' },
  { day: 5, beat: 'buyer_memory',      goalZh: '看到她记得回头的买家' },
  { day: 6, beat: 'progress_update',   goalZh: '看到她在哪些事上更稳了' },
  { day: 7, beat: 'weekly_summary',    goalZh: '一页看懂这周：做了什么、学了什么、下一步' },
];

export type JourneyEvent = { readonly beat: JourneyDay['beat']; readonly at: Date };

/**
 * Which beat is due next? Beats happen in order; a beat only counts when its
 * real triggering event exists. Nothing is invented to keep the schedule.
 */
export function nextJourneyBeat(events: readonly JourneyEvent[]): JourneyDay | null {
  const done = new Set(events.map((e) => e.beat));
  for (const d of FIRST_WEEK) {
    if (!done.has(d.beat)) return d;
  }
  return null;   // week complete
}

/** Sequencing rule for tests: recorded beats must respect the defined order. */
export function journeyInOrder(events: readonly JourneyEvent[]): boolean {
  const order = new Map(FIRST_WEEK.map((d, i) => [d.beat, i]));
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime());
  let last = -1;
  for (const e of sorted) {
    const i = order.get(e.beat) ?? -1;
    if (i < last) return false;
    last = i;
  }
  return true;
}
