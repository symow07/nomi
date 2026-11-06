import { sql } from 'kysely';
import type { Db, Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { withTenantTx } from './client.js';
import type { AudioFetcher, MediaFetcher } from '../channels/whatsapp/media.js';
import { practiceOf } from './practice.js';

/**
 * 0224 (Block 1 #11) — A PRACTICE PHOTO OR VOICE NOTE. The owner uploads one on the Practice page as a customer would
 * send it; its bytes are kept on the practice copy, and the worker's media port reads them back where a channel's
 * download would be — so the photo goes through the real vision and the voice note through the real transcriber,
 * and the turn is the real turn. The job names the media `practice:<id>`; the worker recognises the prefix.
 * Only a practice copy may hold one (a trigger refuses the rest); the row hangs off its practice conversation, so Start
 * over and the thirty days take it with the conversation. The app role may insert and read; it deletes nothing.
 */
export const PRACTICE_MEDIA_PREFIX = 'practice:';

export type PracticeMediaKind = 'image' | 'audio';

/** The photo kinds the vision path takes, and the voice-note kinds the transcriber takes (channels/whatsapp/media.ts). */
export const PRACTICE_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const PRACTICE_AUDIO_TYPES: ReadonlySet<string> = new Set(['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/aac', 'audio/amr', 'audio/x-m4a']);

/** What kind an uploaded file is, by its declared type; null when it is neither a photo nor a voice note. */
export function practiceMediaKind(mediaType: string): PracticeMediaKind | null {
  const type = mediaType.trim().toLowerCase();
  if (PRACTICE_IMAGE_TYPES.has(type)) return 'image';
  if (PRACTICE_AUDIO_TYPES.has(type)) return 'audio';
  return null;
}

/** Keeps the bytes on the copy; returns the media id the inbound job names (`practice:<uuid>`). */
export async function storePracticeMedia(tx: Tx, copy: BusinessId, conversationId: string, media: { readonly kind: PracticeMediaKind; readonly mediaType: string; readonly bytes: Buffer }): Promise<string> {
  const r = (await sql<{ id: string }>`
    insert into practice_media (business_id, conversation_id, kind, media_type, bytes)
    values (${copy}::uuid, ${conversationId}::uuid, ${media.kind}, ${media.mediaType.toLowerCase()}, ${media.bytes})
    returning id::text as id`.execute(tx)).rows[0]!;
  return `${PRACTICE_MEDIA_PREFIX}${r.id}`;
}

/** P5 — who pays for a practice photo or voice note: the workspace the copy practises for (the copy itself, if none). */
export async function practicePayerOf(db: Db, copy: BusinessId): Promise<BusinessId> {
  return (await withTenantTx(db, copy, (tx) => practiceOf(tx, copy))) ?? copy;
}

/** Is this media id one of Practice's? */
export const isPracticeMediaId = (mediaId: string | null | undefined): boolean =>
  typeof mediaId === 'string' && mediaId.startsWith(PRACTICE_MEDIA_PREFIX);

/**
 * The fetchers the worker uses in place of a channel's download: the bytes kept here, base64, with their type. A media
 * id this copy does not hold is "not found", never retried — nothing would make it appear.
 */
export function practiceMediaFetchers(db: Db, copy: BusinessId): { readonly image: MediaFetcher; readonly audio: AudioFetcher } {
  const read = async (mediaId: string, kind: PracticeMediaKind) => {
    const id = mediaId.slice(PRACTICE_MEDIA_PREFIX.length);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return withTenantTx(db, copy, async (tx) => (await sql<{ media_type: string; bytes: Buffer }>`
      select media_type, bytes from practice_media where id = ${id}::uuid and business_id = ${copy}::uuid and kind = ${kind}`.execute(tx)).rows[0] ?? null);
  };
  return {
    image: async (mediaId) => {
      const row = await read(mediaId, 'image');
      if (!row || !PRACTICE_IMAGE_TYPES.has(row.media_type)) return { ok: false, retryable: false, error: 'practice media not found' };
      return { ok: true, base64: Buffer.from(row.bytes).toString('base64'), mediaType: row.media_type as 'image/jpeg' | 'image/png' | 'image/webp' };
    },
    audio: async (mediaId) => {
      const row = await read(mediaId, 'audio');
      if (!row) return { ok: false, retryable: false, error: 'practice media not found' };
      return { ok: true, base64: Buffer.from(row.bytes).toString('base64'), mediaType: row.media_type };
    },
  };
}
