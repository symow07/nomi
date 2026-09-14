import { withTenantTx, lockConversation, type Db } from '../db/client.js';
import { tenantRepos } from '../db/repos.js';
import { ensureConversation, enqueueOutboundRow } from '../db/channels.js';
import { outreachFacts } from '../db/outreach.js';
import { gateOutreach, type OutreachRefusal } from '../core/outreach/gate.js';
import { normalizeIdentity, type IdentityError } from '../core/outreach/consent.js';
import type { TemplateState } from '../core/channel/window.js';
import type { BusinessId, ConversationId } from '../core/types/ids.js';

/**
 * C4.a — SHE WRITES TO SOMEONE WHO HAS NOT WRITTEN TO HER.
 *
 * The first thing in this product that starts a conversation. Everything else
 * answers one: a buyer messages her, a conversation exists, a reply is queued
 * into it. Here there is no conversation and no inbound message, and the whole
 * difficulty is that absence — there is nothing to prove he wants to hear from
 * her except what she recorded before today.
 *
 * ── IT IS THE SAME SEND PATH, DELIBERATELY ────────────────────────────────
 *
 * This is `ownerReply` with a different origin, and that is the entire design:
 *
 *   writeFirst → enqueueOutboundRow(origin='outreach') → the outbound worker
 *   → the gate → the adapter for the row's channel → the mail transport
 *
 * No second sender, no "just this once" direct call to a provider. A first
 * message faces the send gate, the outreach gate, her daily cap and the
 * suppression list exactly as a sequence step will in C4.b — because they are
 * the same rows going through the same loop. That is what makes the refusals
 * visible on her conversation and countable against her day.
 *
 * ── THE CHECK HERE IS A COURTESY, NOT THE AUTHORITY ───────────────────────
 *
 * `gateOutreach` runs twice: here, so she is told NOW rather than discovering it
 * from a refusal card a minute later, and in the worker at send time, which is
 * the decision that counts. The precedent is `ownerSendVerdict` on her reply
 * box (M20.4) and the reason is the same: a suppression can arrive between her
 * pressing send and the row being sent, and only the later check can see it.
 * Both call the one function, so they cannot disagree about the same buyer.
 *
 * ── SHE IS THE AUTHOR, SO THERE IS NO DRAFT ───────────────────────────────
 *
 * Draft-first exists so her employee's words are approved before a buyer reads
 * them. These are her own words, typed by her, the way an owner reply is — a
 * draft of her own message for her own approval would be theatre.
 *
 * ── AND IT DOES NOT TAKE THE CONVERSATION OVER ────────────────────────────
 *
 * Ownership stays with her employee, so when he replies, the reply is answered
 * the way every other buyer's is. Writing the first line is not the same act as
 * holding the thread.
 */

export type WriteFirstDeps = {
  readonly db: Db;
  readonly now: () => Date;
  /** The bare re-drive tick: boss.send(QUEUES.outbound, {businessId, conversationId}). */
  readonly kickDrive: (businessId: string, conversationId: string) => Promise<void>;
  /** M39 — resolved at boot; one of the requirements the outreach gate reads. */
  readonly templateState: TemplateState;
};

export type WriteFirstOutcome =
  /** Queued through the one send path; the worker's gate decides the rest. */
  | 'queued'
  /** No subject or no message. A mail is both, and neither is invented here. */
  | 'empty'
  /**
   * The address belongs to a client this tenant cannot see. `client_channels`
   * is unique on (channel, identity) GLOBALLY, so an address already held by
   * another factory writes no identity row here and there is nothing to send
   * to. Named rather than swallowed: `enqueueOutboundRow` returning null used
   * to read as success everywhere it happened.
   */
  | 'no_channel'
  | IdentityError
  | OutreachRefusal;

export type WriteFirstResult = {
  readonly outcome: WriteFirstOutcome;
  /** Present once a conversation exists, so the caller can link to it. */
  readonly conversationId: string | null;
};

/** Private: the one failure that must undo the rows written before it. */
class NoChannel extends Error {}

export async function writeFirst(
  deps: WriteFirstDeps,
  input: {
    readonly businessId: BusinessId;
    /**
     * E-mail only. A first WhatsApp message must be an approved TEMPLATE, and
     * this product sends none yet (M22 §B): a free-form row would be refused
     * `window_needs_owner` at send time, so accepting one here would take her
     * words and tell her later they could never have gone. Narrowed in the type
     * so no route can offer it by mistake.
     */
    readonly channel: 'email';
    readonly identity: string;
    readonly subject: string;
    readonly body: string;
    readonly actor: string;
    /** Her own name for him, so her inbox shows a person rather than a string. */
    readonly displayName?: string | null;
  },
): Promise<WriteFirstResult> {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject || !body) return { outcome: 'empty', conversationId: null };

  const identity = normalizeIdentity(input.channel, input.identity);
  if (!identity.ok) return { outcome: identity.error, conversationId: null };

  let result: WriteFirstResult;
  try {
    result = await withTenantTx(deps.db, input.businessId, async (tx): Promise<WriteFirstResult> => {
    const facts = await outreachFacts(tx, input.businessId, {
      channel: input.channel, identity: identity.value,
      templateState: deps.templateState, now: deps.now(),
      // Mail she queued a minute ago spends today's cap too (C4.b).
      counting: 'sent_or_queued',
    });
    const may = gateOutreach(facts);
    if (!may.ok) return { outcome: may.error, conversationId: null };

    const conv = await ensureConversation(
      tx, input.businessId, identity.value, input.displayName ?? null, input.channel,
    );
    await lockConversation(tx, conv.conversationId);
    const rowId = await enqueueOutboundRow(
      tx, input.businessId, conv.conversationId, body, 'outreach', { subject },
    );
    // Nothing to send to — and the client and conversation just created for
    // him must not survive as an empty thread in her inbox. Thrown so the
    // transaction rolls back rather than committing a person with no address.
    if (rowId === null) throw new NoChannel();

    // Her name on the act, the subject on the row, and no message body in the
    // event — the `owner_reply` convention (M16.1).
    await tenantRepos(tx, input.businessId).events.append(
      conv.conversationId as ConversationId, 'wrote_first',
      { actor: input.actor, channel: input.channel },
    );
    return { outcome: 'queued', conversationId: conv.conversationId };
    });
  } catch (e) {
    if (e instanceof NoChannel) return { outcome: 'no_channel', conversationId: null };
    throw e;
  }

  if (result.outcome === 'queued' && result.conversationId) {
    await deps.kickDrive(input.businessId, result.conversationId);
  }
  return result;
}
