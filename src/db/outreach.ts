import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { CHANNEL_REGISTRY, type OutreachChannel } from '../core/channel/registry.js';

/**
 * M42 — whether she has decided to write first, per channel.
 *
 * Insert-only history; the newest row per channel is the one in force. Reading
 * it is a `distinct on`, which is the same shape `owner_rates` and
 * `sample_policy` use and for the same reason: the row that was current in
 * March still explains a refusal from March.
 */

/**
 * May she even MAKE this decision yet?
 *
 * Two conditions, and the second one was a screenshot's doing. A card read
 * "Not set up here yet — she cannot send on this one" directly above a switch
 * she had just turned on, which is the switch-connected-to-nothing this repo
 * has paid for before.
 *
 *   coldInitiate !== 'never'  — the platform can carry a first message at all.
 *   availableHere             — and this product can send on it TODAY.
 *
 * The second is deliberately not a pre-decision she is allowed to make: turning
 * writing-first on is a deliberate act with a real consequence, and one taken
 * three months before the channel existed is not that. E-mail becomes
 * switchable when its adapter lands (M40) and the registry's `availableHere`
 * follows the adapters on disk, so nothing here has to be remembered.
 *
 * The COLUMN stays permissive by comparison — `outreach_settings` accepts any
 * channel that could ever initiate — because a decision she made while a
 * channel was live must still read back after it is taken away.
 */
export const canBeEnabled = (channel: OutreachChannel): boolean =>
  CHANNEL_REGISTRY[channel].coldInitiate !== 'never' && CHANNEL_REGISTRY[channel].availableHere;

export async function outreachEnabled(
  tx: Tx, businessId: BusinessId,
): Promise<ReadonlyMap<OutreachChannel, boolean>> {
  const rows = await sql<{ channel: string; enabled: boolean }>`
    select distinct on (channel) channel, enabled
      from outreach_settings
     where business_id = ${businessId}::uuid
     order by channel, at desc, id desc`.execute(tx);
  return new Map(rows.rows.map((r) => [r.channel as OutreachChannel, r.enabled]));
}

/** Her decision, recorded with her name on it. Never an update. */
export async function setOutreach(
  tx: Tx, businessId: BusinessId,
  input: { readonly channel: OutreachChannel; readonly enabled: boolean; readonly by: string },
): Promise<boolean> {
  if (!canBeEnabled(input.channel)) return false;
  await sql`
    insert into outreach_settings (business_id, channel, enabled, by_actor)
    values (${businessId}::uuid, ${input.channel}, ${input.enabled}, ${input.by})`.execute(tx);
  return true;
}
