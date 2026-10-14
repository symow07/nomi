import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { anyConnected, connectedChannels } from './connectedChannels.js';
import { scriptLanguagesOf, scriptPattern, type ScriptLanguage } from '../core/onboard/scriptNames.js';

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
 *
 * The fifth step — "send your assistant's first reply to a customer" — is
 * done when such a reply WENT OUT (the warmth run, phase 9, V1-109): a sent
 * row the assistant wrote (`outbound_messages.origin = 'employee'`, sent alone
 * or approved by the owner), in one of this business's own conversations.
 * It counted an approved draft, so a reply approved and then refused, or one
 * approved where nothing could carry it, ticked the step while Before going
 * live said nothing had been sent — and a reply sent alone never ticked it.
 */
export type SetupStep = 'profile' | 'products' | 'name' | 'channels' | 'first_success';
export const SETUP_STEPS: readonly SetupStep[] = ['profile', 'products', 'name', 'channels', 'first_success'];

/** Active products with no name in a served language that has its own script: how many, of how many. */
export type NamesWanted = { readonly lang: ScriptLanguage; readonly missing: number; readonly of: number };

export type SetupProgress = {
  readonly steps: readonly { readonly step: SetupStep; readonly done: boolean }[];
  readonly done: number;
  readonly total: number;
  /** The first step not done, else null: setup is complete. */
  readonly next: SetupStep | null;
  /**
   * 2026-10-14 — the products step waits on these too: a product named only in English is not found by a buyer
   * writing Chinese (`src/core/onboard/scriptNames.ts`). Only the languages the owner chose or buyers wrote in
   * (`scriptNeeds`), and only those with something missing; empty when none.
   */
  readonly names?: readonly NamesWanted[];
  /** …and the profile's other script languages: shown as a suggestion, never an undone step. */
  readonly suggested?: readonly NamesWanted[];
};

export const setupFrom = (
  m: Record<SetupStep, boolean>, names: readonly NamesWanted[] = [], suggested: readonly NamesWanted[] = [],
): SetupProgress => {
  const steps = SETUP_STEPS.map((s) => ({ step: s, done: m[s] }));
  return {
    steps,
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    next: steps.find((s) => !s.done)?.step ?? null,
    names,
    suggested,
  };
};

/**
 * WHICH SCRIPTS A WORKSPACE NEEDS NAMES IN (the owner, 2026-10-14, on PR 344): "require a name only for a language the
 * owner actually serves — the ones they selected, or the ones their buyers have actually written in. Everything else
 * is a suggestion, not an undone step."
 *
 *   · required — a language with its own script that the owner CHOSE (the profile's list, once they changed it:
 *     `languages_chosen_at`, 0160 — the default en/zh/ar is nobody's choice), or that a buyer of theirs has written in
 *     (`clients.preferred_language`, the analysis's reading; the owner's own test conversations do not count);
 *   · suggested — one on the profile's list that is neither: shown, never an undone step.
 */
export async function scriptNeeds(tx: Tx, businessId: BusinessId): Promise<{
  readonly required: readonly ScriptLanguage[]; readonly suggested: readonly ScriptLanguage[];
}> {
  const r = (await sql<{ served: string[] | null; chosen: boolean; written: string[] | null }>`
    select b.languages_served as served, b.languages_chosen_at is not null as chosen,
           array(select distinct cl.preferred_language from clients cl
                  where cl.business_id = b.id and cl.preferred_language is not null
                    and exists (select 1 from conversations c
                                 where c.client_id = cl.id and not coalesce(c.owner_testing, false))) as written
      from businesses b where b.id = ${businessId}::uuid`.execute(tx)).rows[0];
  const served = r?.served ?? [];
  const required = scriptLanguagesOf([...(r?.chosen ? served : []), ...(r?.written ?? [])]);
  return { required, suggested: scriptLanguagesOf(served).filter((l) => !required.includes(l)) };
}

/** Active products with no name in each of these languages: how many, of how many. Only languages with one missing. */
async function namesMissing(tx: Tx, businessId: BusinessId, langs: readonly ScriptLanguage[]): Promise<readonly NamesWanted[]> {
  const out: NamesWanted[] = [];
  for (const lang of langs) {
    const pat = scriptPattern(lang);
    const r = (await sql<{ missing: number; of: number }>`
      select count(*) filter (where not (p.name ~ ${pat} or coalesce(p.name_zh ~ ${pat}, false)
                                         or exists (select 1 from product_aliases a
                                                     where a.product_id = p.id and a.alias ~ ${pat})))::int as missing,
             count(*)::int as of
        from products p
       where p.business_id = ${businessId}::uuid and p.is_active`.execute(tx)).rows[0]!;
    if (r.missing > 0) out.push({ lang, missing: r.missing, of: r.of });
  }
  return out;
}

/** What the products step waits for (`names`, required) and what is only suggested. */
export async function namesWantedFor(tx: Tx, businessId: BusinessId): Promise<{
  readonly names: readonly NamesWanted[]; readonly suggested: readonly NamesWanted[];
}> {
  const needs = await scriptNeeds(tx, businessId);
  return { names: await namesMissing(tx, businessId, needs.required), suggested: await namesMissing(tx, businessId, needs.suggested) };
}

export const NOTHING_DONE: SetupProgress = setupFrom({
  profile: false, products: false, name: false, channels: false, first_success: false,
});

export async function setupProgress(tx: Tx, businessId: BusinessId): Promise<SetupProgress> {
  // Each figure is a live EXISTS over real rows. Explicit business_id filters
  // keep it tenant-safe regardless of a table's RLS, and first_success joins
  // conversations so the sent reply must belong to one of this business's.
  const r = (await sql<{
    profile_done: boolean; products_done: boolean; name_done: boolean; first_success_done: boolean;
  }>`
    select
      coalesce((select (description is not null and location is not null
                        and (contact_email is not null or contact_phone is not null))
                  from businesses where id = ${businessId}::uuid), false) as profile_done,
      -- T3 — a product counts once customers can reach it: offered, priced, found by a name.
      -- K5 — or the owner chose "prices go to me": there is nothing to price.
      (exists(select 1 from products p
              where p.business_id = ${businessId}::uuid and p.is_active and p.price_usd_per_unit is not null
                and exists (select 1 from product_aliases a where a.product_id = p.id))
       or coalesce((select prices_to_owner from businesses where id = ${businessId}::uuid), false)) as products_done,
      exists(select 1 from onboarding_state
              where business_id = ${businessId}::uuid and assistant_named_at is not null) as name_done,
      exists(select 1 from outbound_messages o
               join conversations c on c.id = o.conversation_id and c.business_id = ${businessId}::uuid
              where o.business_id = ${businessId}::uuid and o.origin = 'employee'
                and o.status in ('sent', 'delivered', 'read')) as first_success_done
  `.execute(tx)).rows[0]!;
  // Phase 4b — ANY place a buyer writes, connected: WhatsApp, Instagram,
  // Messenger or a mailbox. The same definition the Channels page reads.
  const channelsDone = anyConnected(await connectedChannels(tx, businessId));
  // 2026-10-14 (the owner) — "any owner selling to Chinese buyers has this problem on day one": the products step
  // is done only once every active product carries a name in each language the owner chose or a buyer wrote in.
  // On PR 344: never one merely on the default list — that is a suggestion (`scriptNeeds`).
  const { names, suggested } = await namesWantedFor(tx, businessId);
  return setupFrom({
    profile: r.profile_done, products: r.products_done && names.length === 0, name: r.name_done,
    channels: channelsDone, first_success: r.first_success_done,
  }, names, suggested);
}
