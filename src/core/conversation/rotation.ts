/**
 * S3 (Phase 5, item 21) — HAND-OFFS IN TURN: who is given the next one. Pure.
 *
 * Among the people in turn — not archived, not an accountant, not away now — the one who has waited longest since
 * they were last given one; never given one comes first. Ties go to whoever joined first, then to the id, so the
 * answer never depends on the order the rows came in. Waiting longest, rather than fewest given, is what keeps it fair
 * when someone is away: back, they are next once, not given everything they missed.
 */
export type RotationMember = {
  readonly id: string; readonly inRotation: boolean; readonly archived: boolean; readonly accountant: boolean;
  readonly awayUntil: Date | null; readonly lastGivenAt: Date | null; readonly joinedAt: Date;
};

export const availableNow = (m: RotationMember, now: Date): boolean =>
  m.inRotation && !m.archived && !m.accountant && (m.awayUntil === null || m.awayUntil.getTime() <= now.getTime());

/** The next one in turn, or null when nobody is (the hand-off then waits for anyone, as without the turn). */
export function nextInRotation(members: readonly RotationMember[], now: Date): string | null {
  const open = members.filter((m) => availableNow(m, now));
  if (open.length === 0) return null;
  const at = (d: Date | null) => (d === null ? -Infinity : d.getTime());
  return [...open].sort((a, b) => at(a.lastGivenAt) - at(b.lastGivenAt) || a.joinedAt.getTime() - b.joinedAt.getTime()
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]!.id;
}
