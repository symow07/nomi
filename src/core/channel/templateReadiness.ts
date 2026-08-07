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
  /** What the send path will be told, derived from the installation. */
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
 * M25 — the state itself, DERIVED. This is what replaced the hardcoded literal
 * `channelStore.load` used to put into every `ConversationSendContext`.
 *
 * WHERE THE TRUTH LIVES. A template is approved by Meta, not by us, and the
 * product must not call Meta to find out. So it is told, the same way every
 * other Meta fact is: the operator records it beside the credentials.
 *
 * WHAT THIS DOES NOT CLAIM. Not that a template will send — nothing here calls
 * anything, and the worker still hands the conversation back to the owner. It
 * decides only what is TRUE of this installation, so the refusal the owner
 * reads is derived rather than assumed.
 *
 * Fail closed, as everywhere else: anything unresolved is 'none', the state
 * that keeps a message with the owner.
 */
export type TemplateFacts = {
  /** A messaging provider is wired (WHATSAPP_PROVIDER is not 'disabled'). */
  readonly providerConfigured: boolean;
  /** Templates the operator has recorded as APPROVED by the provider. */
  readonly approvedTemplates: readonly string[];
};

export function templateState(f: TemplateFacts): TemplateState {
  // No provider means no template can leave whatever is approved — reporting
  // 'approved' here would be readiness the installation does not have.
  if (!f.providerConfigured) return 'none';
  return f.approvedTemplates.some((t) => t.trim() !== '') ? 'approved' : 'none';
}

/**
 * Parse the operator's list. Forgiving about spacing and empty entries, and
 * deliberately unforgiving about everything else: this is the only thing
 * between "a template exists" and "we told the owner one does".
 *
 * `'rejected'` is never derived. A rejected template is simply not approved,
 * and from outside Meta the two are indistinguishable; inventing the
 * distinction would be a status we cannot substantiate. The value stays in
 * `TemplateState` because `sendPlan` handles it and a future status sync can
 * produce it honestly.
 */
export function parseApprovedTemplates(raw: string | undefined): readonly string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
}

/**
 * The single place an approved template enters the send path.
 *
 * M25 replaced the literal with `templateState(...)`, resolved once at the
 * composition root and threaded into `channelStore`. `sendPlan` returns
 * `send_template` the moment that state is 'approved', `gateOutbound` reports
 * `viaTemplate`, and `window_needs_owner` becomes reachable — gate unchanged,
 * nothing else to edit.
 *
 * Returned as data rather than written only in a comment so a test can pin it:
 * if the entry point moves, the test fails instead of the documentation
 * quietly going stale.
 */
export const TEMPLATE_ENTRY_POINT = {
  file: 'src/db/channels.ts',
  symbol: 'channelStore.load',
  field: 'template',
  /** No longer a literal — resolved from META_TEMPLATE_NAMES + provider state. */
  source: 'templateState(TemplateFacts)',
} as const;
