import { refreshUnderLock } from '../db/booksConnections.js';
import type { Db } from '../db/client.js';
import type { BusinessId } from '../core/types/ids.js';
import { refused, type ConnectRefusal } from '../core/books/connector.js';
import { xeroAccess, type XeroDeps } from './connectors/xero.js';
import { qboAccess, type QboAccess, type QboDeps } from './connectors/quickbooks.js';

/**
 * Audit batch 3 (B12) — Xero's and QuickBooks' access, got under the connection's lock (`refreshUnderLock`): the
 * newest grant read, refreshed, and the next one kept, before the next caller may do the same. Every piece of work
 * that refreshes either of them gets its access here.
 */
type Where = { readonly db: Db; readonly credentialKey: Buffer; readonly businessId: BusinessId; readonly by: string };

/** Xero refreshes on every use, and the refresh token it returns replaces the one spent. */
export const xeroAccessLocked = (xero: XeroDeps, w: Where): Promise<{ readonly accessToken: string } | ConnectRefusal> =>
  refreshUnderLock(w.db, w.credentialKey, w.businessId, 'xero', w.by, async (grant, keep) => {
    if (!grant) return refused('revoked');
    const a = await xeroAccess(xero, grant);
    if ('kind' in a) return a;
    await keep(a.grant.secret);
    return { accessToken: a.accessToken };
  });

/** QuickBooks' access for `qboWithAccess`: refreshed only near its end (or forced after a 401), and kept when it was. */
export const qboAccessLocked = (qbo: QboDeps, w: Where) => (_g: unknown, o: { readonly force?: boolean }): Promise<QboAccess | ConnectRefusal> =>
  refreshUnderLock(w.db, w.credentialKey, w.businessId, 'quickbooks', w.by, async (grant, keep) => {
    if (!grant) return refused('revoked');
    const a = await qboAccess(qbo, grant, o);
    if (!('kind' in a) && a.fresh) await keep(a.grant.secret);
    return a;
  });
