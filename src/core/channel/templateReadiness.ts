import type { TemplateState } from './window.js';

/**
 * M22 §B — template readiness, stated honestly and stated ONCE.
 *
 * WHAT A TEMPLATE IS FOR. WhatsApp lets a business reply freely only within 24
 * hours of the buyer's last message. After that, the only way to reach them is
 * a message whose exact wording Meta approved in advance. Every overnight
 * conversation in a real pilot hits this.
 *
 * WHAT EXISTS TODAY. The state machine is complete and correct: `sendPlan`
 * already returns `send_template` when — and only when — a template is
 * approved, `gateOutbound` already reports it as `viaTemplate`, and the worker
 * already refuses rather than sending. What does not exist is an approved
 * template, because that is Meta's decision and not a line of code.
 *
 * SO THIS FILE PROMISES NOTHING. It reports which of the two independent
 * things is missing — the credentials (ours to configure) or the approval
 * (Meta's to grant) — and it never conflates them. `checkMetaReadiness` covers
 * the credentials; this covers the approval; neither infers the other.
 *
 * There is exactly ONE line to change when a template is approved, and
 * `templateEntryPoint()` names it so nobody has to go looking.
 */

export type TemplateReadiness = {
  /** What the send path will be told. Today, always 'none'. */
  readonly state: TemplateState;
  /** Can a conversation be re-opened after the 24-hour window closes? */
  readonly canReopenWindow: boolean;
  /**
   * True while the ONLY thing standing between the product and re-engagement is
   * an approval nobody in this repository can grant. Being explicit about this
   * is the point: it is not a bug, not a missing feature, and not something a
   * deploy fixes.
   */
  readonly awaitingExternalApproval: boolean;
};

export function templateReadiness(state: TemplateState): TemplateReadiness {
  return {
    state,
    canReopenWindow: state === 'approved',
    awaitingExternalApproval: state !== 'approved',
  };
}

/**
 * The single place an approved template enters the send path.
 *
 * `channelStore.load` hardcodes `template: 'none'` into every
 * `ConversationSendContext`. That one value is why `sendPlan` never returns
 * `send_template` in production, why `gate.viaTemplate` is never true, and why
 * `window_needs_owner` — though fully implemented and fully explained to the
 * owner — cannot currently fire. Replace that literal with the tenant's real
 * template state and the whole path lights up, gate unchanged.
 *
 * Returned as data rather than written only in a comment so a test can pin it:
 * if the entry point moves, the test that asserts this file names the truth
 * fails, instead of the documentation quietly going stale.
 */
export const TEMPLATE_ENTRY_POINT = {
  file: 'src/db/channels.ts',
  symbol: 'channelStore.load',
  field: 'template',
  currentValue: 'none',
} as const;
