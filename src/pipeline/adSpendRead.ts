import { sql } from 'kysely';
import { withTenantTx, type Db } from '../db/client.js';
import type { BusinessId } from '../core/types/ids.js';
import { decryptSecret } from '../security/credentials.js';
import { readInsights, type AdsFetch, type InsightsRead } from '../channels/meta/adSpend.js';
import { dayIn, readSpan } from '../core/ads/spend.js';
import { finishRead, liveAdConnection, markAdConnection, readHistory, startRead, storeSpend } from '../db/adSpend.js';

/**
 * 0238 — ONE WORKSPACE'S AD SPEND, read once a day.
 *
 * Never a loop: the read's row is written (and committed) BEFORE Meta is asked, and a connection already read on
 * this UTC day is skipped — so a job retried by the queue, or run twice, asks Meta nothing more that day. Any
 * outcome but `ok` keeps nothing of what was read (all or nothing) and is tried again the next day; a refused
 * token (190, whatever the subcode) or a lost permission (200) stops every read until the owner connects again;
 * a throttle waits as long as Meta says, or an hour. No row of the workspace's is touched by a failed read.
 */

export type AdSpendReadDeps = {
  readonly db: Db;
  /** Null: the installation has no ads login — no read, no call. */
  readonly fetchImpl: AdsFetch | null;
  readonly credentialKey: Buffer | null;
  readonly now?: () => Date;
};

export type AdSpendReadOutcome = 'off' | 'skipped' | InsightsRead['kind'];

const THROTTLE_FLOOR_SEC = 3600;

export async function readAdSpendFor(deps: AdSpendReadDeps, businessId: BusinessId): Promise<AdSpendReadOutcome> {
  if (!deps.fetchImpl || !deps.credentialKey) return 'off';
  const now = (deps.now ?? (() => new Date()))();
  const begun = await withTenantTx(deps.db, businessId, async (tx) => {
    // The daily list already says this; a direct call is held to the same rule.
    // (A real workspace, switched on, not suspended, its connection live and accepted: the definer's one answer.)
    const listed = (await sql<{ ok: boolean }>`select exists (select 1 from ad_spend_workspaces() w where w.business_id = ${businessId}::uuid) as ok`
      .execute(tx)).rows[0]!.ok;
    if (!listed) return null;
    const c = await liveAdConnection(tx, businessId);
    if (!c || c.state !== 'active' || (c.retryAfter && c.retryAfter > now)) return null;
    const h = await readHistory(tx, businessId, c.id, now);
    if (h.today) return null;
    const span = readSpan(dayIn(now, c.timezone), !h.everOk);
    return { c, span, readId: await startRead(tx, businessId, c, span, now) };
  });
  if (!begun) return 'skipped';
  const { c, span, readId } = begun;

  let token: string | null = null;
  try { token = decryptSecret(c.ciphertext, deps.credentialKey).plain; } catch { token = null; }
  const r: InsightsRead = token
    ? await readInsights({ token, accountId: c.adAccountId, currency: c.currency, since: span.since, until: span.until }, deps.fetchImpl)
    : { kind: 'failed', pages: 0, usage: [], waitSec: null, code: null, subcode: null, message: 'the credential key cannot open the token' };

  const done = (deps.now ?? (() => new Date()))();
  await withTenantTx(deps.db, businessId, async (tx) => {
    const usage = r.usage.map((u) => u.headers);
    if (r.kind === 'ok') {
      await storeSpend(tx, businessId, c, r.rows, done);
      await finishRead(tx, businessId, readId, { outcome: 'ok', pages: r.pages, rows: r.rows.length, code: null, subcode: null, message: null, usage, now: done });
      if (r.waitSec) await markAdConnection(tx, businessId, c.id, { retryAfter: new Date(done.getTime() + r.waitSec * 1000) });
      return;
    }
    await finishRead(tx, businessId, readId, { outcome: r.kind, pages: r.pages, rows: 0, code: r.code, subcode: r.subcode, message: r.message, usage, now: done });
    if (r.kind === 'refused' || r.kind === 'permission') await markAdConnection(tx, businessId, c.id, { state: r.kind, note: r.message });
    else if (r.kind === 'throttled') {
      await markAdConnection(tx, businessId, c.id, { retryAfter: new Date(done.getTime() + Math.max(r.waitSec ?? 0, THROTTLE_FLOOR_SEC) * 1000) });
    }
  });
  return r.kind;
}

/** The daily job: every workspace `ad_spend_workspaces()` names (live, accepted, a real workspace, switched on, not suspended). */
export async function readAllAdSpend(deps: AdSpendReadDeps, parse: (raw: string) => BusinessId | null): Promise<Record<string, number>> {
  const tally: Record<string, number> = {};
  if (!deps.fetchImpl || !deps.credentialKey) return tally;
  const due = (await sql<{ business_id: string }>`select business_id::text as business_id from ad_spend_workspaces()`.execute(deps.db)).rows;
  for (const d of due) {
    const b = parse(d.business_id);
    if (!b) continue;
    let out: AdSpendReadOutcome;
    try { out = await readAdSpendFor(deps, b); } catch { out = 'failed'; }
    tally[out] = (tally[out] ?? 0) + 1;
  }
  return tally;
}
