import { sql } from 'kysely';
import type { Tx } from './client.js';

/**
 * CC-25 — the transcript window: a conversation's NEWEST messages, and the way
 * back to the ones before them (2026-09-27).
 *
 * The conversation page read `order by sent_at asc limit 200` — the OLDEST two
 * hundred. On a thread past two hundred messages the newest ones, the question
 * the owner was about to answer among them, were not on the page at all. The
 * owner's decision: the page always shows the newest messages. A window is read
 * from the newest end, `TRANSCRIPT_WINDOW` at a time, and shown oldest-first
 * within itself, so the page still reads top to bottom like a conversation.
 *
 * PAGING IS BY KEYSET, NEVER BY OFFSET: (sent_at, id), newest first, the id
 * breaking ties. Two messages stamped with the same instant sort the same way
 * on every request, so a window boundary between them can neither show one
 * twice nor lose one; and an offset would shift under every message that
 * arrives while she reads.
 *
 * The cursor comes from the SQL rows, before anything is filtered out for
 * display (a reaction, a sticker — G2c): a window may show fewer than it read,
 * and the next one still starts exactly where this one stopped.
 */
export const TRANSCRIPT_WINDOW = 50;

/**
 * The cursor names the OLDEST message a window shows: `<epoch ms>_<message id>`.
 * Digits, an underscore, lowercase hex and hyphens — nothing a URL has to
 * percent-encode, so no `%` reaches the page.
 *
 * The id decides; the time is a check. The next window is bounded by the
 * message ROW's own stamp (microseconds), never by the milliseconds written
 * here — those would skip a message stamped inside the lost microseconds.
 */
export type TranscriptCursor = { readonly at: number; readonly id: string };

/** The furthest instant a JavaScript Date can hold, either side of 1970; nothing past it is a stamp. */
const MAX_MS = 8_640_000_000_000_000;
/**
 * Negative too: a mail's own date header is its stamp (inboxReader), and a
 * cursor this could not read back would be a door that led to the same page
 * for ever.
 */
const CURSOR = /^(0|-?[1-9][0-9]{0,15})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export const encodeCursor = (m: { readonly sentAt: Date; readonly id: string }): string =>
  `${m.sentAt.getTime()}_${m.id}`;

/** Exactly the shape `encodeCursor` writes, or null. Null means the latest window. */
export function parseCursor(raw: unknown): TranscriptCursor | null {
  if (typeof raw !== 'string') return null;
  const m = CURSOR.exec(raw);
  if (!m) return null;
  const at = Number(m[1]);
  return Number.isSafeInteger(at) && Math.abs(at) <= MAX_MS ? { at, id: m[2]! } : null;
}

/** One stored message, as the transcript pages read it. */
export type TranscriptRow = {
  readonly id: string;
  readonly direction: string;
  readonly text_content: string | null;
  readonly sent_at: Date;
  readonly input_type: string;
  readonly transcription: string | null;
  /** G2c — what arrived that could not be read, from `ai_analysis`. */
  readonly received: string | null;
  /** G13 — the provider's handle for a voice note's audio. */
  readonly media: string | null;
  /** D4 — who wrote an outbound message, from the sent row it was copied from. */
  readonly origin: string | null;
};

export type TranscriptWindow = {
  /** Oldest first. */
  readonly rows: readonly TranscriptRow[];
  /** The cursor for the messages before these; null when these are the first. */
  readonly earlier: string | null;
  /** A window further back than the newest: the cursor named a message of THIS conversation. */
  readonly older: boolean;
};

/**
 * The window that ends just before `before`, or the newest one.
 *
 * `before` is whatever the request carried. A cursor counts only when it names
 * a message of THIS conversation stamped when it says — read inside the
 * tenant's transaction, so another business's message is not there to be
 * found. A malformed, stale or foreign cursor is the newest window, never an
 * error and never an empty page.
 */
export async function loadTranscriptWindow(tx: Tx, conversationId: string, before: unknown): Promise<TranscriptWindow> {
  const cursor = parseCursor(before);
  const anchor = cursor === null ? undefined : (await sql<{ sent_at: Date }>`
    select sent_at from messages
     where id = ${cursor.id}::uuid and conversation_id = ${conversationId}::uuid`.execute(tx)).rows[0];
  const older = cursor !== null && anchor !== undefined && anchor.sent_at.getTime() === cursor.at;

  const read = (await sql<TranscriptRow>`
    select m.id::text as id, m.direction, m.text_content, m.sent_at, m.input_type, m.transcription,
           m.ai_analysis->>'received' as received, m.provider_media_id as media,
           -- D4 — the sent row it was copied from, by the id it was copied under.
           -- CH3 — or the owner's own reply from Meta's app, which no sent row holds.
           coalesce(o.origin, case when m.external_id like 'echo:%' then 'owner' end) as origin
      from messages m
      left join outbound_messages o
        on m.direction = 'outbound' and m.external_id = 'out:' || o.id::text
     where m.conversation_id = ${conversationId}::uuid
       and ${older && cursor ? sql`(m.sent_at, m.id) < (
             select a.sent_at, a.id from messages a
              where a.id = ${cursor.id}::uuid and a.conversation_id = ${conversationId}::uuid)` : sql`true`}
     order by m.sent_at desc, m.id desc
     limit ${TRANSCRIPT_WINDOW + 1}
  `.execute(tx)).rows;

  // The extra row only says whether there is more; it is never shown.
  const shown = read.slice(0, TRANSCRIPT_WINDOW);
  const oldest = shown.at(-1);
  return {
    rows: shown.reverse(),
    earlier: read.length > TRANSCRIPT_WINDOW && oldest ? encodeCursor({ sentAt: oldest.sent_at, id: oldest.id }) : null,
    older,
  };
}
