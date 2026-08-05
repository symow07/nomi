import { sql } from 'kysely';
import {
  channelLifecycle, isConnected, type ChannelFacts, type ChannelLifecycle,
} from '../core/channel/lifecycle.js';
import { withTenantTx, type Db } from '../db/client.js';
import { loadPilotReadiness } from '../api/web/pilot.js';
import { activeAllowlistCount } from './allowlist.js';
import { readSchemaState } from '../db/schemaVersion.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * M18.1 — explicit activation.
 *
 * The M15 readiness checks stop being a display and become a GATE: activation
 * refuses unless the factory is genuinely ready, at least one number is on the
 * pilot allowlist, and the compromised setup-era credentials have been rotated
 * (M18.0). Every attempt — allowed or refused — is auditable.
 *
 * What this does NOT do: flip the messaging provider. `WHATSAPP_PROVIDER` stays
 * an environment variable set by a human at deploy time. A runtime toggle to
 * live messaging is exactly the kind of control that gets clicked by accident,
 * so activation is deliberately only HALF the switch — the product half.
 * Messages flow only when the env says `meta` AND the channel is activated.
 */

export type ActivationRefusal =
  | 'schema_stale'          // M19.1 — the database is behind this build
  | 'not_ready'             // M15 readiness incomplete
  | 'no_allowlist'          // M18.2 requires at least one reachable number
  | 'secrets_not_rotated'   // M18.0 gate
  | 'no_channel';           // nothing to activate

export type ActivationResult =
  | { readonly ok: true; readonly activatedAt: Date }
  | { readonly ok: false; readonly code: ActivationRefusal };

/** Everything activation requires, so the UI can explain a refusal precisely. */
export type ActivationPreconditions = {
  readonly ready: boolean;
  readonly allowlistCount: number;
  readonly secretsRotated: boolean;
  readonly hasChannel: boolean;
  /** M19.1 — the applied migration version vs the one this build needs. */
  readonly schema: { readonly required: number; readonly actual: number | null; readonly ok: boolean };
  /** M20.3.1 — the one channel-state answer both sections of My factory render. */
  readonly lifecycle: ChannelLifecycle;
  readonly blockers: readonly ActivationRefusal[];
};

export async function activationPreconditions(
  db: Db, businessId: BusinessId, opts: { readonly providerConfigured: boolean },
): Promise<ActivationPreconditions> {
  const [readiness, allowlistCount, chRow, schema] = await Promise.all([
    loadPilotReadiness(db, businessId),
    activeAllowlistCount(db, businessId),
    // M20.3.1 — the REAL question, not "does a row exist?". A row exists after a
    // rollback too, which is how a disconnected factory came to read as ready.
    withTenantTx(db, businessId, (tx) =>
      sql<{ status: string | null; cred_active: boolean | null; activated_at: Date | null; disconnected_at: Date | null }>`
        select ch.status, ch.activated_at, ch.disconnected_at,
               (select bool_or(cc.is_active) from channel_credentials cc
                 where cc.business_id = ch.business_id and cc.channel = 'whatsapp') as cred_active
          from channels ch
         where ch.business_id = ${businessId} and ch.kind = 'whatsapp' limit 1
      `.execute(tx).then((r) => r.rows[0] ?? null)),
    readSchemaState(db),
  ]);

  const facts: ChannelFacts = {
    hasChannel: chRow !== null,
    status: chRow?.status ?? null,
    credentialActive: chRow?.cred_active === true,
    providerConfigured: opts.providerConfigured,
    activatedAt: chRow?.activated_at ?? null,
    disconnectedAt: chRow?.disconnected_at ?? null,
  };
  const lifecycle = channelLifecycle(facts);
  const secretsRotated = readiness.attest.secretsRotatedAt !== null;
  const blockers: ActivationRefusal[] = [];
  // M19.1 FIRST: a stale schema means the send path is broken in a way that
  // /health cannot see. Activating on top of it would fail at the first real
  // buyer message — the one moment that cannot be undone.
  if (!schema.ok) blockers.push('schema_stale');
  if (!readiness.readyToLaunch) blockers.push('not_ready');
  if (allowlistCount < 1) blockers.push('no_allowlist');
  if (!secretsRotated) blockers.push('secrets_not_rotated');
  // Not "is there a row" but "could a message actually leave" — a paused or
  // never-connected channel is equally not ready, and says so on the page.
  if (!isConnected(facts)) blockers.push('no_channel');

  return {
    ready: readiness.readyToLaunch,
    allowlistCount,
    secretsRotated,
    hasChannel: isConnected(facts),
    lifecycle,
    schema: { required: schema.required, actual: schema.actual, ok: schema.ok },
    blockers,
  };
}

/**
 * Turn the pilot on for this factory. Refuses — loudly and specifically — if any
 * precondition is unmet. Pilot mode (the allowlist) stays ON: activation is the
 * start of a controlled pilot, not the end of one.
 */
export async function activate(
  db: Db, businessId: BusinessId, actor: string, opts: { readonly providerConfigured: boolean },
): Promise<ActivationResult> {
  const pre = await activationPreconditions(db, businessId, opts);
  if (pre.blockers.length > 0) {
    // M22 (F-10) — a refused activation is its own event with its own verb.
    // Conflating it with a refused SEND hid which of the two had happened: they
    // occur at different moments, for different reasons, with different fixes.
    // The refusal itself is unchanged — this only records what already happened.
    await withTenantTx(db, businessId, (tx) => sql`
      insert into channel_audit (business_id, action, actor, detail)
      values (${businessId}, 'activation_refused', ${actor},
              ${JSON.stringify({ blockers: pre.blockers })}::jsonb)
    `.execute(tx));
    return { ok: false, code: pre.blockers[0]! };
  }

  return withTenantTx(db, businessId, async (tx) => {
    const now = new Date();
    await sql`
      update channels set activated_at = ${now}, activated_by = ${actor},
                          pilot_mode = true, updated_at = now()
       where business_id = ${businessId} and kind = 'whatsapp'
    `.execute(tx);
    await sql`
      insert into channel_audit (business_id, action, actor, detail)
      values (${businessId}, 'activate', ${actor},
              ${JSON.stringify({ allowlistCount: pre.allowlistCount, pilotMode: true })}::jsonb)
    `.execute(tx);
    return { ok: true as const, activatedAt: now };
  });
}

/**
 * M18.4 — the rollback rung that lives in the product. Clears activation and
 * disconnects the channel, which makes the send gate suppress outbound at SEND
 * time (queued employee messages are canceled, not delivered late). Deletes
 * nothing: the allowlist, conversations, and history all survive, so
 * reconnecting resumes rather than rebuilds.
 */
export async function deactivate(
  db: Db, businessId: BusinessId, actor: string, reason: string,
): Promise<{ ok: true }> {
  await withTenantTx(db, businessId, async (tx) => {
    await sql`
      update channels set activated_at = null, status = 'disconnected',
                          disconnected_at = now(), updated_at = now()
       where business_id = ${businessId} and kind = 'whatsapp'
    `.execute(tx);
    await sql`
      insert into channel_audit (business_id, action, actor, detail)
      values (${businessId}, 'deactivate', ${actor}, ${JSON.stringify({ reason })}::jsonb)
    `.execute(tx);
  });
  return { ok: true };
}

/** Is this factory activated right now? (activation + connected channel) */
export async function activationState(
  db: Db, businessId: BusinessId,
): Promise<{ activatedAt: Date | null; activatedBy: string | null; pilotMode: boolean; status: string | null }> {
  return withTenantTx(db, businessId, (tx) =>
    sql<{ activated_at: Date | null; activated_by: string | null; pilot_mode: boolean; status: string }>`
      select activated_at, activated_by, pilot_mode, status from channels
       where business_id = ${businessId} and kind = 'whatsapp' limit 1
    `.execute(tx).then((r) => {
      const row = r.rows[0];
      return {
        activatedAt: row?.activated_at ?? null,
        activatedBy: row?.activated_by ?? null,
        pilotMode: row?.pilot_mode ?? true,     // fail-closed
        status: row?.status ?? null,
      };
    }));
}
