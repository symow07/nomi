import { sql } from 'kysely';
import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { type Locale } from '../../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../../core/owner/i18n/messages.js';
import { esc } from './layout.js';

/**
 * M11.2 — Guided Owner Onboarding. A LIVE read model: each step is "done" only
 * because the underlying business data exists (read fresh every request). No
 * duplicate progress store — onboarding_state is never read or written here.
 * The page only reads and DEEP-LINKS to the existing page that completes each
 * step; it re-implements nothing. Honest ✓/○ checklist — no percentage, no fake
 * completion (a step that has no real data simply reads as not done).
 */

export type OnboardingStep = 'profile' | 'products' | 'channels' | 'first_success';
const STEPS: readonly OnboardingStep[] = ['profile', 'products', 'channels', 'first_success'];
export const STEP_LINK: Record<OnboardingStep, string> = {
  profile: '/app/settings', products: '/app/products', channels: '/app/channels', first_success: '/app/inbox',
};

export type OnboardingData = {
  readonly steps: readonly { readonly step: OnboardingStep; readonly done: boolean }[];
  readonly allDone: boolean;
  readonly nextStep: OnboardingStep | null;
};

export async function loadOnboarding(db: Db, businessIdRaw: string): Promise<OnboardingData> {
  const bid = parseBusinessId(businessIdRaw);
  const build = (m: Record<OnboardingStep, boolean>): OnboardingData => {
    const steps = STEPS.map((s) => ({ step: s, done: m[s] }));
    return { steps, allDone: steps.every((s) => s.done), nextStep: steps.find((s) => !s.done)?.step ?? null };
  };
  if (!bid.ok) return build({ profile: false, products: false, channels: false, first_success: false });

  return withTenantTx(db, bid.value, async (tx) => {
    // One round-trip; each figure is a live EXISTS over real rows. Explicit
    // business_id filters keep it tenant-safe regardless of a table's RLS, and
    // Step 4 joins conversations so an approved draft must belong to a real one.
    const r = (await sql<{
      profile_done: boolean; products_done: boolean; channels_done: boolean; first_success_done: boolean;
    }>`
      select
        coalesce((select (description is not null and location is not null
                          and (contact_email is not null or contact_phone is not null))
                    from businesses where id = ${bid.value}), false) as profile_done,
        exists(select 1 from products
                where business_id = ${bid.value} and is_active and price_usd_per_unit is not null) as products_done,
        exists(select 1 from channels ch
                 join channel_credentials cc on cc.business_id = ch.business_id
                   and cc.channel = 'whatsapp' and cc.is_active
                where ch.business_id = ${bid.value} and ch.kind = 'whatsapp' and ch.status = 'connected') as channels_done,
        exists(select 1 from drafts d
                 join conversations c on c.id = d.conversation_id and c.business_id = ${bid.value}
                where d.business_id = ${bid.value} and d.status in ('approved','edited') and d.decided_at is not null) as first_success_done
    `.execute(tx)).rows[0]!;
    return build({
      profile: r.profile_done, products: r.products_done, channels: r.channels_done, first_success: r.first_success_done,
    });
  });
}

// Phase F: this module no longer renders. It is the ONE derivation of "what is
// still missing", consumed by My factory (src/api/web/factory.ts). The page it
// used to draw was never mounted — the /app/onboarding route renders the pilot
// runbook — so a fourth setup UI existed only in the test suite.
