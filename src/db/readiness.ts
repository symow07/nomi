import type { Db } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { practiceCopyOf } from './practice.js';
import { checklistFor, checklistKind, observeChecklist, readinessOf, type Readiness } from './practiceChecklist.js';

/**
 * B16 — the one reader every readiness count reads: the checklist for the workspace's kind, and what it has seen —
 * read from its practice copy as it stands (and written down, `observeChecklist`), so no page is behind Practice.
 * Its own module: `practice.ts` reaches the channels, and `practiceChecklist.ts` is read by the advisor's side.
 */
export async function loadReadiness(db: Db, live: BusinessId): Promise<Readiness> {
  const items = checklistFor(await checklistKind(db, live));
  const seen = await observeChecklist(db, live, await practiceCopyOf(db, live));
  return readinessOf(items, seen);
}
