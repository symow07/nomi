import { sql } from 'kysely';
import type { Tx } from '../db/client.js';
import type { AudioFetcher } from '../channels/whatsapp/media.js';
import type { Transcriber } from '../llm/transcribe.js';
import { decideHearing, type HearingOutcome } from '../core/conversation/hearing.js';

/**
 * M34 — hearing a voice note, end to end.
 *
 * The I/O half of `core/conversation/hearing.ts`: download, transcribe, record.
 * The DECISION is entirely the pure function's; this file only performs its
 * inputs and persists its outcome.
 *
 * ONE PIPELINE, NOT TWO. A heard voice note produces a transcript that goes
 * into the SAME `computeTurn` a typed message would — same analyzer, same
 * retrieval, same quote engine, same gate. Nothing about being spoken makes a
 * price rule optional. The only difference is provenance: the message row says
 * the words were transcribed, and the owner can see and correct them.
 *
 * THE M4 LESSON, APPLIED. `imageTurn.ts` was built and never called from the
 * worker — a whole pipeline that only tests exercised. This one is wired into
 * `worker/main.ts` in the same commit that introduces it, and a test asserts
 * the worker actually calls it.
 */

export type VoiceTurnDeps = {
  /** Absent when no transcriber is configured — every note then refuses. */
  readonly transcriber?: Transcriber | undefined;
  /** Absent when the channel cannot download media. */
  readonly audio?: AudioFetcher | undefined;
};

/**
 * Fetch + transcribe, then let the pure decision stand. Never throws for an
 * expected failure: a provider outage is a refusal, not a crashed job that
 * pg-boss retries into the same wall three times.
 */
export async function hearVoiceNote(
  deps: VoiceTurnDeps,
  mediaId: string | null | undefined,
): Promise<HearingOutcome> {
  if (!deps.transcriber || !deps.audio) {
    return decideHearing({ transcriberConfigured: false, mediaId });
  }
  if (!mediaId) return decideHearing({ transcriberConfigured: true, mediaId });

  const fetched = await deps.audio(mediaId);
  if (!fetched.ok) {
    return decideHearing({ transcriberConfigured: true, mediaId, fetch: fetched });
  }
  const transcript = await deps.transcriber({ base64: fetched.base64, mediaType: fetched.mediaType });
  return decideHearing({
    transcriberConfigured: true, mediaId,
    fetch: { ok: true, retryable: false, error: '' },
    transcript,
  });
}

/**
 * The inbound message row for a voice note.
 *
 * Written whichever way the hearing went — an unheard note is still a thing the
 * buyer sent, and a transcript row that only exists on success would make
 * "she never heard it" indistinguishable from "he never wrote". `input_type`
 * carries which: 'voice_transcribed' when the words are real, 'voice' when the
 * audio arrived and the words did not.
 */
export async function recordVoiceMessage(
  tx: Tx,
  conversationId: string,
  messageId: string,
  outcome: HearingOutcome,
  /**
   * G13 — the provider's handle for the audio. Kept so the owner can PLAY the
   * note she is being asked to correct; it lived only in the job payload
   * before, so by the time she saw the transcript the recording was
   * unreachable. Never a URL: a download link is signed and expires.
   */
  mediaId?: string | null,
): Promise<void> {
  const heard = outcome.kind === 'heard';
  await sql`
    insert into messages
      (conversation_id, external_id, direction, input_type, text_content, transcription,
       detected_language, provider_media_id, sent_at)
    values
      (${conversationId}, ${messageId}, 'inbound',
       ${heard ? 'voice_transcribed' : 'voice'},
       ${heard ? outcome.transcript : null},
       ${heard ? outcome.transcript : null},
       ${heard ? outcome.language : null},
       ${mediaId ?? null},
       clock_timestamp())
    on conflict do nothing
  `.execute(tx);
}
