/**
 * M34 — what to do with a voice note, decided purely.
 *
 * The I/O (download, transcribe) lives in the worker; the DECISION lives here,
 * where it is testable without a network and where the fail-closed rule is
 * visible in one place rather than spread across a pipeline.
 *
 * THE RULE. A voice note is heard or it is refused. There is no third outcome,
 * and in particular there is no "treat it as an empty message" — which is what
 * the product did before this milestone, and which produced a confident reply
 * to a question nobody asked. `low_confidence_image` (M4) established the shape:
 * when the machine is not sure what the buyer sent, the owner is told and the
 * employee stays quiet.
 *
 * WHY A TRANSCRIPT IS NOT A CLAIM. Everything else in this product refuses to
 * state what it was not told. A transcript is different in kind: it is a
 * best-effort reading of what the BUYER said, not an assertion by the factory —
 * so it may be uncertain, provided the uncertainty is visible. It is stored
 * beside the audio, shown to the owner, and correctable by her. What must never
 * happen is a transcript that is wrong and invisible, or absent and ignored.
 *
 * Pure per ADR-0002 — data in, decision out.
 */

/** Why a voice note could not be heard. Each maps to owner-facing copy. */
export type UnheardReason =
  /** No transcriber is configured on this installation. */
  | 'not_configured'
  /** The provider refused, timed out, or the media id had already expired. */
  | 'transcription_failed'
  /** WhatsApp gave us a format nothing here can read. */
  | 'unsupported_format'
  /** The webhook said audio, but carried no media id to fetch. */
  | 'no_media';

export type HearingOutcome =
  | {
      readonly kind: 'heard';
      readonly transcript: string;
      readonly language: string | null;
    }
  | {
      readonly kind: 'unheard';
      readonly reason: UnheardReason;
      /** Worth another attempt later (network, 429, 5xx) versus gone for good. */
      readonly retryable: boolean;
      /** Operator-facing detail. NEVER shown to the owner or a buyer. */
      readonly detail: string;
    };

/** What the worker learned by trying. Deliberately provider-shaped-but-neutral. */
export type HearingInput = {
  /** false when no transcriber is wired on this installation. */
  readonly transcriberConfigured: boolean;
  readonly mediaId: string | null | undefined;
  /** Absent when the download failed or was never attempted. */
  readonly fetch?: { readonly ok: boolean; readonly retryable: boolean; readonly error: string } | undefined;
  /** Absent when the download failed. */
  readonly transcript?:
    | { readonly ok: true; readonly text: string; readonly language: string | null }
    | { readonly ok: false; readonly retryable: boolean; readonly error: string }
    | undefined;
};

/** A transcript of only punctuation or whitespace is not speech. */
const isMeaningful = (s: string): boolean => /[\p{L}\p{N}]/u.test(s);

export function decideHearing(input: HearingInput): HearingOutcome {
  if (!input.transcriberConfigured) {
    return {
      kind: 'unheard', reason: 'not_configured', retryable: false,
      detail: 'no transcriber configured on this installation',
    };
  }
  if (!input.mediaId) {
    return { kind: 'unheard', reason: 'no_media', retryable: false, detail: 'audio message carried no media id' };
  }
  if (!input.fetch || !input.fetch.ok) {
    const err = input.fetch?.error ?? 'media was not fetched';
    return {
      // "unsupported audio: …" is a fact about the format, not a transient
      // failure, and the owner's next action differs: ask for a resend in a
      // different form, rather than wait.
      kind: 'unheard',
      reason: err.startsWith('unsupported audio') ? 'unsupported_format' : 'transcription_failed',
      retryable: input.fetch?.retryable ?? false,
      detail: err,
    };
  }
  if (!input.transcript) {
    return { kind: 'unheard', reason: 'transcription_failed', retryable: true, detail: 'transcription was not attempted' };
  }
  if (!input.transcript.ok) {
    return {
      kind: 'unheard',
      reason: input.transcript.error.startsWith('unsupported audio') ? 'unsupported_format' : 'transcription_failed',
      retryable: input.transcript.retryable,
      detail: input.transcript.error,
    };
  }
  const text = input.transcript.text.trim();
  // A transcript with no letters or digits is not a reading of speech — it is
  // the transcriber's way of saying it heard nothing. Refusing here is the
  // difference between "she could not hear you" and a reply to silence.
  if (!isMeaningful(text)) {
    return { kind: 'unheard', reason: 'transcription_failed', retryable: false, detail: 'transcript contained no words' };
  }
  return { kind: 'heard', transcript: text, language: input.transcript.language };
}
