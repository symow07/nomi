import { sql } from 'kysely';
import { withTenantTx, lockConversation, type Db } from '../db/client.js';
import { tenantRepos } from '../db/repos.js';
import { recordConsent } from '../db/contacts.js';
import { handToPerson } from './received.js';
import { normalizeIdentity } from '../core/outreach/consent.js';
import { parseBusinessId, type ConversationId } from '../core/types/ids.js';
import type { InboundMail } from '../channels/email/inbound.js';

/**
 * C4.c — HE ANSWERED. What that changes, in one transaction.
 *
 *   1. His words are on the conversation, as an inbound message, once —
 *      the external id is his Message-ID, so a provider that delivers the same
 *      mail twice records it once.
 *   2. Consent: `replied_to_email`, observed rather than attested, for e-mail to
 *      his address. Recorded once per address — the first answer is the
 *      evidence; the tenth is conversation.
 *   3. The conversation goes to a person, through the SAME handoff an unread
 *      document or an unlisted number takes (`handToPerson`). No model runs on
 *      a stranger's first answer to a cold mail.
 *   4. Nothing here stops his follow-ups, and nothing needs to: the sequence
 *      sweep asks "has he written since he was enrolled?" before every step, so
 *      the inbound row written in (1) is what stops them (C4.b's `replied`).
 *
 * ── WHICH TENANT, AND WHY IT CANNOT BE FORGED ─────────────────────────────
 *
 * The webhook is signed, and still the request is not trusted to name a
 * business. The reply quotes the Message-ID of the mail it answers; that id is
 * looked up among the e-mails this product actually SENT (`resolve_email_reply`,
 * 0048), and the business, the conversation and the address come from that row.
 *
 * And the sender must BE that address. A colleague who replies from another
 * mailbox, or a forward, is not the person she wrote to, has consented to
 * nothing, and must not stop or advance anything in his name. It is dropped,
 * and said so in the outcome.
 */

export type EmailReplyOutcome =
  | 'recorded'
  /** The same mail, delivered again. */
  | 'duplicate'
  /** It quotes no mail this product sent. Acknowledged and ignored. */
  | 'unknown_thread'
  /** It answers one of her mails, from an address that mail did not go to. */
  | 'not_the_recipient';

export async function recordEmailReply(
  db: Db, mail: InboundMail,
): Promise<{ readonly outcome: EmailReplyOutcome; readonly conversationId: string | null }> {
  if (mail.quoted.length === 0) return { outcome: 'unknown_thread', conversationId: null };

  const thread = (await sql<{ business_id: string; conversation_id: string; identity: string }>`
    select business_id::text as business_id, conversation_id::text as conversation_id, identity
      from resolve_email_reply(${sql.val(mail.quoted)}::text[])`.execute(db)).rows[0];
  if (!thread) return { outcome: 'unknown_thread', conversationId: null };

  const from = normalizeIdentity('email', mail.from);
  if (!from.ok || from.value !== thread.identity) {
    return { outcome: 'not_the_recipient', conversationId: null };
  }
  const bid = parseBusinessId(thread.business_id);
  if (!bid.ok) return { outcome: 'unknown_thread', conversationId: null };
  const cid = thread.conversation_id;

  return withTenantTx(db, bid.value, async (tx) => {
    await lockConversation(tx, cid);
    const inserted = await sql<{ id: string }>`
      insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
      values (${cid}, ${`email:${mail.messageId}`}, 'inbound', 'text', ${mail.text}, clock_timestamp())
      on conflict do nothing
      returning id`.execute(tx);
    if (inserted.rows.length === 0) return { outcome: 'duplicate' as const, conversationId: cid };

    await sql`update client_channels set last_inbound_at = now()
               where channel = 'email' and channel_user_id = ${from.value}`.execute(tx);

    const already = (await sql<{ yes: boolean }>`
      select exists (select 1 from contact_consent
                      where business_id = ${bid.value}::uuid and channel = 'email'
                        and identity = ${from.value} and evidence = 'replied_to_email') as yes`
      .execute(tx)).rows[0]?.yes === true;
    if (!already) {
      await recordConsent(tx, bid.value, {
        channel: 'email', identity: from.value, evidence: 'replied_to_email',
        note: null, recordedBy: 'buyer',
      });
    }

    await handToPerson(tenantRepos(tx, bid.value), cid as ConversationId, { kind: 'email_reply' });
    return { outcome: 'recorded' as const, conversationId: cid };
  });
}
