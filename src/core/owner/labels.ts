/**
 * S2 (Phase 5, item 19) — LABELS: a workspace's own words to sort its buyers by. One line, 1 to 40 characters, its
 * spaces as one; the same label whatever its capitals ("Wholesale" is "wholesale"). Pure: 0196 checks the same.
 */
export const LABEL_MAX = 40;

/** The label as kept, or null when it cannot be one. */
export function labelNameOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  return name.length >= 1 && name.length <= LABEL_MAX ? name : null;
}
