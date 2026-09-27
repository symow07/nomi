import { sql } from 'kysely';
import type { Db } from './client.js';

/**
 * CC-02a — the operator's question: which deletion requests are nearly late?
 *
 * Asked across EVERY business, once a day, through `deletion_requests_due()`
 * (migration 0073) — a definer function, because row-level security rightly
 * hides each tenant's requests from every other, and the deadline belongs to
 * whoever runs the installation, not to any one business. It answers with the
 * business's name, the scope and when it was asked, and nothing else: never
 * the buyer, never the note. Read on the plain connection, as
 * `inboxes_to_read` is — there is no tenant to bind.
 */
export type DueDeletion = {
  readonly business: string;
  readonly scope: 'workspace' | 'buyer';
  readonly askedAt: Date;
};

export async function dueDeletionRequests(db: Db): Promise<DueDeletion[]> {
  const r = await sql<{ business_name: string; scope: string; asked_at: Date }>`
    select business_name, scope, asked_at from deletion_requests_due()`.execute(db);
  return r.rows.map((x) => ({
    business: x.business_name,
    scope: x.scope === 'workspace' ? 'workspace' : 'buyer',
    askedAt: x.asked_at,
  }));
}
