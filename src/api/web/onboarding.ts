import { withTenantTx, type Db } from '../../db/client.js';
import { parseBusinessId } from '../../core/types/ids.js';
import { NOTHING_DONE, setupProgress, type SetupProgress, type SetupStep } from '../../db/setup.js';

/**
 * M11.2 — Guided Owner Onboarding. A LIVE read model: each step is "done" only
 * because the underlying business data exists (read fresh every request) —
 * except the name, which is the decision the owner recorded (D, rule 2). The
 * page only reads and DEEP-LINKS to the existing page that completes each
 * step; it re-implements nothing. Honest ✓/○ checklist — no percentage, no fake
 * completion (a step that has no real data simply reads as not done).
 *
 * D — the derivation itself moved to `db/setup.ts`, because the shell needs it
 * on every request (the Setup badge, the Today card) and reads it through
 * `workspaceFacts`. This module keeps the shape My business consumes.
 */

export type OnboardingStep = SetupStep;
export const STEP_LINK: Record<OnboardingStep, string> = {
  // Phase 9 (V1-112) — the name step opens at the name's own field, not the page's top.
  profile: '/app/settings/profile', products: '/app/products', name: '/app/onboarding#name',
  // THE WARMTH RUN, phase 7 — channels have one home: My business › Where
  // customers reach you (each row there opens the Channels page to connect).
  channels: '/app/business/channels', first_success: '/app/inbox',
};

export type OnboardingData = {
  readonly steps: readonly { readonly step: OnboardingStep; readonly done: boolean }[];
  readonly allDone: boolean;
  readonly nextStep: OnboardingStep | null;
};

const shape = (p: SetupProgress): OnboardingData =>
  ({ steps: p.steps, allDone: p.next === null, nextStep: p.next });

export async function loadOnboarding(db: Db, businessIdRaw: string): Promise<OnboardingData> {
  const bid = parseBusinessId(businessIdRaw);
  if (!bid.ok) return shape(NOTHING_DONE);
  return shape(await withTenantTx(db, bid.value, (tx) => setupProgress(tx, bid.value)));
}

// Phase F: this module no longer renders. It is the ONE derivation of "what is
// still missing", consumed by My factory (src/api/web/factory.ts). The page it
// used to draw was never mounted — the /app/onboarding route renders the pilot
// runbook — so a fourth setup UI existed only in the test suite.
