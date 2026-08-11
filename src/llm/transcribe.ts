/**
 * M34 — the transcription port, and its one adapter.
 *
 * WHY A SEPARATE PROVIDER. The Claude API takes text and images; it does not
 * accept audio. Transcription is therefore a different vendor from every other
 * model call in this repo, and the seam matters more than the vendor: this port
 * is what the turn pipeline depends on, so a second provider (or a local
 * model, or a Chinese-market provider for WeChat) is a new file rather than a
 * rewrite. Same shape as `Analyzer` / `ReplyWriter` in `ports.ts`.
 *
 * FAIL CLOSED, LOUDLY. Every failure returns `ok: false` — never an empty
 * transcript, never a guess. The caller turns that into the `audio_unheard`
 * refusal, so a buyer whose question was never heard cannot receive a confident
 * answer to a question she invented. `retryable` distinguishes "try again"
 * (network, 429, 5xx) from "this note is gone" (expired media, unsupported
 * format), exactly as `MediaResult` does for photos.
 *
 * NOT CONFIGURED IS A LEGITIMATE STATE. If no transcriber is wired, the port is
 * absent and every voice note refuses with `audio_unheard`. That is the honest
 * behaviour, and it is what ships until an operator sets a key.
 */

export type TranscriptResult =
  | {
      readonly ok: true;
      readonly text: string;
      /** BCP-47-ish tag the provider reports, e.g. 'ar', 'zh'. Never inferred here. */
      readonly language: string | null;
    }
  | { readonly ok: false; readonly retryable: boolean; readonly error: string };

/**
 * Bytes in, words out. The audio arrives as base64 because that is what
 * `MediaFetcher` already returns for photos — one media path, two consumers.
 */
export type Transcriber = (audio: {
  readonly base64: string;
  readonly mediaType: string;
}) => Promise<TranscriptResult>;

/** WhatsApp voice notes are ogg/opus; the other two appear on other channels. */
const SUPPORTED = new Set(['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm']);

/** A voice note longer than this is not a B2B enquiry; refuse rather than pay. */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

const EXT: Record<string, string> = {
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'audio/wav': 'wav', 'audio/webm': 'webm',
};

/**
 * OpenAI Whisper (`whisper-1`), over plain fetch — no new dependency. Chosen
 * for its published multilingual coverage: this product's three locales include
 * Arabic and Chinese, and a transcriber that is strong only in English would
 * refuse exactly the buyers the pilot is for.
 *
 * The API key never leaves this closure and is never logged; failures report a
 * status code, never a response body, because a provider error body can echo
 * request content.
 */
export function whisperTranscriber(cfg: {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}): Transcriber {
  const doFetch = cfg.fetchImpl ?? fetch;
  const base = cfg.baseUrl ?? 'https://api.openai.com/v1';
  const model = cfg.model ?? 'whisper-1';
  const timeoutMs = cfg.timeoutMs ?? 30_000;

  return async ({ base64, mediaType }) => {
    const type = mediaType.split(';')[0]!.trim().toLowerCase();
    if (!SUPPORTED.has(type)) {
      return { ok: false, retryable: false, error: `unsupported audio: ${type}` };
    }
    let bytes: ArrayBuffer;
    try {
      const buf = Buffer.from(base64, 'base64');
      bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    } catch {
      return { ok: false, retryable: false, error: 'audio is not valid base64' };
    }
    if (bytes.byteLength === 0) return { ok: false, retryable: false, error: 'audio is empty' };
    if (bytes.byteLength > MAX_AUDIO_BYTES) {
      return { ok: false, retryable: false, error: `audio too large: ${bytes.byteLength} bytes` };
    }

    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), `note.${EXT[type] ?? 'ogg'}`);
    form.append('model', model);
    // verbose_json is the only response format that reports the language, and
    // the owner needs to see WHICH language was heard when a transcript looks
    // wrong — a mistranscription and a misdetected language read identically.
    form.append('response_format', 'verbose_json');

    try {
      const res = await doFetch(`${base}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        return {
          ok: false,
          retryable: res.status === 429 || res.status >= 500,
          error: `transcription ${res.status}`,
        };
      }
      const body = (await res.json()) as { text?: unknown; language?: unknown };
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      // A blank transcript is NOT a successful transcription of silence: the
      // buyer sent something. Refusing here is what keeps her from answering a
      // question she invented.
      if (!text) return { ok: false, retryable: false, error: 'transcript was empty' };
      return { ok: true, text, language: typeof body.language === 'string' ? body.language : null };
    } catch (e) {
      const name = e instanceof Error ? e.name : 'error';
      return { ok: false, retryable: true, error: `transcription failed: ${name}` };
    }
  };
}
