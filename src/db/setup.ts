import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { anyConnected, connectedChannels } from './connectedChannels.js';

/**
 * D — how far a workspace is through setting up, as five steps.
 *
 * Four of them are LIVE facts derived from rows (M11.2): a step is done only
 * because the data behind it exists, read fresh, never a stored tick. The fifth
 * — the assistant's name — is different in kind: it is a decision the owner
 * recorded (Getting ready → `onboarding_state.assistant_named_at`, rule 2), and
 * the row's default name does not count until then. That is the one thing
 * `onboarding_state` is read for here.
 *
 * Order is the order an owner meets them: the name sits before the channel
 * because nothing can go live, or be sent alone, until it is confirmed.
 */
export type SetupStep = 'profile' | 'products' | 'name' | 'channels' | 'first_success';
export const SETUP_STEPS: readonly SetupStep[] = ['profile', 'products', 'name', 'channels', 'first_success'];

export type SetupProgress = {
  readonly steps: readonly { readonly step: SetupStep; readonly done: boolean }[];
  readonly done: number;
  readonly total: number;
  /** The first step not done, else null: setup is complete. */
  readonly next: SetupStep | null;
};

export const setupFrom = (m: Record<SetupStep, boolean>): SetupProgress => {
  const steps = SETUP_STEPS.map((s) => ({ step: s, done: m[s] }));
  return {
    steps,
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    next: steps.find((s) => !s.done)?.step ?? null,
  };
};

export const NOTHING_DONE: SetupProgress = setupFrom({
  profile: false, products: false, name: false, channels: false, first_success: false,
});

export async function setupProgress(tx: Tx, businessId: BusinessId): Promise<SetupProgress> {
  // Each figure is a live EXISTS over real rows. Explicit business_id filters
  // keep it tenant-safe regardless of a table's RLS, and first_success joins
  // conversations so an approved draft must belong to one.
  const r = (await sql<{
    profile_done: boolean; products_done: boolean; name_done: boolean; first_success_done: boolean;
  }>`
    select
      coalesce((select (description is not null and location is not null
                        and (contact_email is not null or contact_phone is not null))
                  from businesses where id = ${businessId}::uuid), false) as profile_done,
      exists(select 1 from products
              where business_id = ${businessId}::uuid and is_active and price_usd_per_unit is not null) as products_done,
      exists(select 1 from onboarding_state
              where business_id = ${businessId}::uuid and assistant_named_at is not null) as name_done,
      exists(select 1 from drafts d
               join conversations c on c.id = d.conversation_id and c.business_id = ${businessId}::uuid
              where d.business_id = ${businessId}::uuid and d.status in ('approved','edited') and d.decided_at is not null) as first_success_done
  `.execute(tx)).rows[0]!;
  // Phase 4b — ANY place a buyer writes, connected: WhatsApp, Instagram,
  // Messenger or a mailbox. The same definition the Channels page reads.
  const channelsDone = anyConnected(await connectedChannels(tx, businessId));
  return setupFrom({
    profile: r.profile_done, products: r.products_done, name: r.name_done,
    channels: channelsDone, first_success: r.first_success_done,
  });
}
