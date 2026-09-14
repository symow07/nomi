import { mayUseDomain } from '../outreach/domain.js';
import type { DomainCheck } from '../outreach/domain.js';
import type { Requirement } from './registry.js';
import type { TemplateState } from './window.js';

/**
 * C4.a — moved here from `api/web/channels.ts`, unchanged.
 *
 * It was a pure function living in a renderer, and the send path now needs the
 * same answer: whether this installation satisfies what a channel requires is
 * what decides if an outreach message may leave, not only what a page says.
 * Two copies of that predicate would be two answers, and the one the page shows
 * would be the one nobody sends by.
 */
export type DomainState = { readonly check: DomainCheck | null; readonly checkedAt: Date | null };

/**
 * M39 — which of the registry's named requirements are actually true here.
 *
 * `approved_template` has exactly one answerer (`templateReadiness.ts`) and it
 * is asked, not re-derived. The other two are Meta's to confirm and hers to
 * supply, and NOTHING in this product can observe them — so they are UNMET.
 *
 * That is the fail-closed direction and it is deliberate: an unobservable
 * requirement reported as satisfied would put "you can write first" in front of
 * an owner whose first template send would be rejected, or worse, accepted
 * against an unverified business.
 */
export function satisfiedRequirements(
  templateState: TemplateState, domain: DomainState | null, now: Date,
): ReadonlySet<Requirement> {
  const s = new Set<Requirement>();
  if (templateState === 'approved') s.add('approved_template');
  // M40.1 — the SAME predicate the send path uses, TTL and all. A page that
  // read the stored states directly would call a six-week-old pass a pass.
  if (mayUseDomain({ check: domain?.check ?? null, checkedAt: domain?.checkedAt ?? null }, now).ok) {
    s.add('verified_sending_domain');
  }
  return s;
}

