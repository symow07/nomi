import { sql } from 'kysely';
import { lockConversation, type Tx } from './client.js';
import { ensureConversation } from './channels.js';
import type { BusinessId } from '../core/types/ids.js';

// ── The owner's one private reply, queued ─────────────────────────────────

/** Why the owner's reply was not queued. Each is said on the Comments page; nothing reaches Instagram. */
export type CommentReplyRefusal =
  | 'not_found' | 'account' | 'off' | 'not_asking' | 'used' | 'age_unknown' | 'expired' | 'empty' | 'too_long';

/** Instagram's own limit on a private reply's text, as the sender enforces it. */
export const COMMENT_REPLY_MAX = 1000;
const WEEK_MS = 7 * 86_400_000;

class Refused extends Error { constructor(readonly reason: CommentReplyRefusal) { super(reason); } }

type Standing = {
  id: string; account_id: string; comment_id: string; identity: string; username: string | null;
  created_at: Date | null; asking: boolean; enabled: boolean; live: boolean;
  reply_outbound: string | null; reply_attempted: Date | null; reply_outcome: string | null; outbound_status: string | null;
};

async function standing(tx: Tx, business: string, id: string, lock: boolean): Promise<Standing | null> {
  return (await sql<Standing>`select c.id, c.account_id, c.comment_id, c.identity, c.username, c.created_at, c.asking,
      coalesce(s.enabled, false) as enabled,
      (m.id is not null and m.archived_at is null and m.last_error is null and m.ig_account_id = c.account_id
        and b.practice_of is null and b.is_active) as live,
      r.outbound_id as reply_outbound, r.attempted_at as reply_attempted, r.outcome as reply_outcome, o.status as outbound_status
    from ig_comments c
    join businesses b on b.id = c.business_id
    left join ig_comment_settings s on s.meta_account_id = c.meta_account_id and s.business_id = c.business_id
    left join meta_accounts m on m.id = c.meta_account_id and m.business_id = c.business_id
    left join ig_comment_replies r on r.comment_id = c.id and r.business_id = c.business_id
    left join outbound_messages o on o.id = r.outbound_id and o.business_id = c.business_id
   where c.business_id = ${business}::uuid and c.id = ${id}::uuid
   ${lock ? sql`for update of c` : sql``}`.execute(tx)).rows[0] ?? null;
}

/**
 * A reservation that never reached Instagram (refused by the send gate before any call: the owner's or the
 * operator's silence, an opt-out) may be pointed at a new reply. Anything that was ever attempted is used for good.
 */
const reusable = (s: Standing): boolean =>
  s.reply_outcome === 'reserved' && s.reply_attempted === null && (s.reply_outbound === null || s.outbound_status === 'canceled');

function refusal(s: Standing | null, now: Date): CommentReplyRefusal | null {
  if (!s) return 'not_found';
  if (!s.live) return 'account';
  if (!s.enabled) return 'off';
  if (!s.asking) return 'not_asking';
  if (s.reply_outcome !== null && !reusable(s)) return 'used';
  const made = s.created_at?.getTime();
  if (made === undefined || !Number.isFinite(made) || made > now.getTime()) return 'age_unknown';
  if (now.getTime() - made >= WEEK_MS) return 'expired';
  return null;
}

/**
 * The owner's Send on a comment. ONE transaction, the caller's: the customer and the conversation the reply belongs
 * to (the commenter's scoped id is the recipient), the outbound row — kind `comment_private_reply`, origin owner,
 * approved, never deduplicated — and the reservation naming it. The send gate decides again at send time from rows
 * read under the same locks (`lockedCommentReplyFacts`); this decides only whether to queue at all.
 *
 * Lock order is the drive's: the conversation first, then the comment. A refusal found after the conversation was
 * made throws, so nothing of it is kept.
 */
export async function queueCommentPrivateReply(tx: Tx, business: BusinessId, input: {
  readonly commentId: string; readonly ownerId: string; readonly body: string;
  readonly publicRequested: boolean; readonly now: Date;
}): Promise<{ ok: true; conversationId: string; outboundId: string } | { ok: false; reason: CommentReplyRefusal }> {
  const body = input.body.replace(/\r\n?/g, '\n').trim();
  if (!body) return { ok: false, reason: 'empty' };
  if (body.length > COMMENT_REPLY_MAX) return { ok: false, reason: 'too_long' };
  const first = await standing(tx, business, input.commentId, false);
  const early = refusal(first, input.now);
  if (early || !first) return { ok: false, reason: early ?? 'not_found' };
  const { conversationId, clientId } = await ensureConversation(tx, business, first.identity, first.username, 'instagram');
  await lockConversation(tx, conversationId);
  await sql`select pg_advisory_xact_lock(hashtextextended(${'ig-comment:' + business + ':' + first.account_id + ':' + first.comment_id},0))`.execute(tx);
  const s = await standing(tx, business, input.commentId, true);
  const late = refusal(s, input.now);
  if (late || !s) throw new Refused(late ?? 'not_found');
  const outbound = (await sql<{ id: string }>`insert into outbound_messages
      (business_id, conversation_id, seq, body, origin, to_wa_id, channel, approved, kind)
    select ${business}, ${conversationId}::uuid, coalesce(max(seq), 0) + 1, ${body}, 'owner', ${s.identity},
           'instagram', true, 'comment_private_reply'
      from outbound_messages where conversation_id = ${conversationId}::uuid
    returning id`.execute(tx)).rows[0]!.id;
  if (s.reply_outcome === null) {
    await sql`insert into ig_comment_replies (business_id, comment_id, outbound_id, owner_id, public_requested)
      values (${business}, ${s.id}::uuid, ${outbound}::uuid, ${input.ownerId}, ${input.publicRequested})`.execute(tx);
  } else {
    const moved = await sql`update ig_comment_replies set outbound_id = ${outbound}::uuid, owner_id = ${input.ownerId},
        public_requested = ${input.publicRequested}
      where business_id = ${business} and comment_id = ${s.id}::uuid and attempted_at is null and outcome = 'reserved'`.execute(tx);
    if (moved.numAffectedRows !== 1n) throw new Refused('used');
  }
  // The comment belongs to the conversation its reply goes out on; the gate reads them as one.
  await sql`update ig_comments set conversation_id = ${conversationId}::uuid, client_id = ${clientId}::uuid
    where business_id = ${business} and id = ${s.id}::uuid`.execute(tx);
  return { ok: true, conversationId, outboundId: outbound };
}

/** Thrown inside the route's transaction so a conversation made for a refused reply is not kept. */
export const isCommentRefusal = (e: unknown): e is { reason: CommentReplyRefusal } => e instanceof Refused;

