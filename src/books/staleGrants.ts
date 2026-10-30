import { withTenantTx, type Db } from '../db/client.js';
import { parseBusinessId } from '../core/types/ids.js';
import type { RevokeOutcome } from '../core/books/connector.js';
import { disconnectSystem, loadConnection, noteGiveBackTried, noteRead, noteStaleTried, refreshUnderLock, staleGrants } from '../db/booksConnections.js';
import { xeroConnector, type XeroDeps } from './connectors/xero.js';
import { qboConnector, type QboDeps } from './connectors/quickbooks.js';
import { sheetsConnector, type SheetsDeps } from './connectors/sheets.js';

/**
 * THE STALE GRANT (0212; the owner, 2026-10-23; Google Sheets 0213, 2026-10-24) — a QuickBooks, Xero or Google Sheets
 * grant Nomi no longer uses must not stay live there unknown to anyone.
 *
 *   · CONNECTING AGAIN gives the old grant back FIRST, before the owner is sent to the consent page (`giveBackFirst`,
 *     a POST — never the GET that starts the consent, which any link could open). First, because Xero's revocation
 *     removes every connection the person made, Intuit's disconnects the company and Google's ends the whole grant:
 *     given back after the new consent, it could end the new grant too. So a consent left unfinished leaves the
 *     system disconnected — the button says so.
 *   · Not confirmed (no answer, an error), connecting goes on — the owner is never locked out — and the old grant, once
 *     the new one replaces it, is a STALE grant (`saveConnection`): said on the books' page, tried again every hour
 *     (`retryStaleGrants`; the worker's `books.staleGrants`) and by the page's own button.
 *   · A stale grant given back while a newer grant is live may end the newer one with it (as above), so the live grant
 *     is then tried at once: refused, the page asks to connect again — now with nothing old left to give back.
 */
export type GrantDeps = { readonly db: Db; readonly credentialKey: Buffer; readonly xero?: XeroDeps; readonly quickbooks?: QboDeps; readonly sheets?: SheetsDeps };
export type Ledger = 'xero' | 'quickbooks' | 'sheets';

// The books' currency plays no part in signing in or out.
const connectorOf = (deps: GrantDeps, system: Ledger) =>
  (system === 'xero' ? (deps.xero ? xeroConnector(deps.xero, 'MAD') : null)
    : system === 'quickbooks' ? (deps.quickbooks ? qboConnector(deps.quickbooks, 'MAD') : null)
      : (deps.sheets ? sheetsConnector(deps.sheets, 'MAD') : null));

/** Before the consent page: the grant held for `system`, given back. Confirmed, the connection is disconnected here. */
export async function giveBackFirst(deps: GrantDeps, businessIdRaw: string, system: Ledger, by: string): Promise<RevokeOutcome> {
  const bid = parseBusinessId(businessIdRaw);
  const c = connectorOf(deps, system);
  if (!bid.ok || !c) return 'nothing_held';
  const conn = await withTenantTx(deps.db, bid.value, (tx) => loadConnection(tx, deps.credentialKey, bid.value, system));
  if (!conn?.grant) return 'nothing_held';
  const out = await c.revoke(conn.grant);
  await withTenantTx(deps.db, bid.value, (tx) => (out === 'given_back' ? disconnectSystem(tx, bid.value, system, by, out)
    : out === 'not_given_back' ? noteGiveBackTried(tx, bid.value, system) : Promise.resolve()));
  return out;
}

export type StaleRetry = {
  /** Stale grants the system confirmed given back this time, and the ones still not. */
  readonly givenBack: number; readonly left: number;
  /** A system whose live grant ended with a stale one given back: the page asks to connect again. */
  readonly endedLive: readonly Ledger[];
};

/** Every stale grant of this workspace tried once more (the hourly round, and the page's button for one system). */
export async function retryStaleGrants(deps: GrantDeps, businessIdRaw: string, by: string, only?: Ledger): Promise<StaleRetry> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return { givenBack: 0, left: 0, endedLive: [] };
  const stale = (await withTenantTx(deps.db, bid.value, (tx) => staleGrants(tx, deps.credentialKey, bid.value)))
    .filter((g) => only === undefined || g.system === only);
  let givenBack = 0; let left = 0;
  const done = new Set<Ledger>();
  for (const g of stale) {
    const c = connectorOf(deps, g.system);
    // not offered on this installation now, or sealed with a key it no longer has: nothing can give it back from here
    if (!c || !g.grant) { left++; continue; }
    const out = await c.revoke(g.grant);
    await withTenantTx(deps.db, bid.value, (tx) => noteStaleTried(tx, g.id, out));
    if (out === 'given_back') { givenBack++; done.add(g.system); } else left++;
  }
  const endedLive: Ledger[] = [];
  for (const system of done) {
    const conn = await withTenantTx(deps.db, bid.value, (tx) => loadConnection(tx, deps.credentialKey, bid.value, system));
    if (!conn?.grant || conn.state !== 'connected') continue;
    // B12 — under the connection's lock: the newest grant refreshed, and a rotated one kept before anyone else refreshes.
    const r = await refreshUnderLock(deps.db, deps.credentialKey, bid.value, system, by, async (grant, keep) => {
      if (!grant) return null;
      const next = await connectorOf(deps, system)!.refresh(grant);
      // a refresh may return the next grant (Xero rotates it; Intuit's changes daily): kept at once, as every refresh is
      if (!('kind' in next) && next.secret !== grant.secret) await keep(next.secret);
      return next;
    });
    if (r !== null && 'kind' in r && r.reason !== 'unreachable') {
      await withTenantTx(deps.db, bid.value, (tx) => noteRead(tx, bid.value, system, { ok: false, reason: 'revoked' }));
      endedLive.push(system);
    }
  }
  return { givenBack, left, endedLive };
}
