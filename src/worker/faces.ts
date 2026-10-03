import { withTenantTx, type Db } from '../db/client.js';
import { facesDue, recordFace, type FaceDue, type FaceFound } from '../db/faces.js';
import { parseBusinessId } from '../core/types/ids.js';

/**
 * THE WARMTH RUN (2026-10-03) — customers' photos, fetched in the background.
 *
 * Every ten minutes (QUEUES.faces): the customers due a look (0123's
 * `faces_due`: no face yet, or their time has come again), a handful at a
 * time, each asked of their channel and kept. A page never waits on this and
 * never calls Meta: it draws the coloured initial until a photo is kept.
 *
 * `look` is the channel's question (`metaProfilePhoto` in
 * src/channels/meta/messaging.ts, with the business's own Page token); this
 * function only walks the list and writes what each look found, one customer
 * at a time, so one slow answer costs one face, not the round.
 */
export const FACES_PER_ROUND = 20;

export async function fetchFaces(deps: {
  readonly db: Db;
  readonly look: (due: FaceDue) => Promise<FaceFound>;
  readonly max?: number;
}): Promise<{ readonly looked: number; readonly kept: number }> {
  const due = await facesDue(deps.db, deps.max ?? FACES_PER_ROUND);
  let kept = 0;
  for (const d of due) {
    const bid = parseBusinessId(d.businessId);
    if (!bid.ok) continue;
    let found: FaceFound;
    try {
      found = await deps.look(d);
    } catch {
      found = { state: 'failed' };
    }
    await withTenantTx(deps.db, bid.value, (tx) => recordFace(tx, d.businessId, d.clientId, found));
    if (found.state === 'kept') kept++;
  }
  return { looked: due.length, kept };
}
