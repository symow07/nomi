import { whisperTranscriber, type Transcriber } from '../llm/transcribe.js';
import {
  whatsappAudioFetcher, whatsappMediaFetcher, type AudioFetcher, type MediaFetcher,
} from '../channels/whatsapp/media.js';
import { metaAudioFetcher, metaMediaFetcher } from '../channels/whatsapp/meta.js';

/**
 * G2b — what the worker needs to HEAR a voice note and SEE a photo.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * M34 and M4.5 built both paths, wired both into the worker, and tested both —
 * and neither could ever run. `startWorker` took four optional strings
 * (TRANSCRIBE_*, MEDIA_*) that neither entrypoint passed, so the transcriber
 * and both fetchers were `undefined` in production for the life of the
 * process. Every voice note refused as `not_configured`, every photo as
 * `media_failed`, and because both refusals are honest by design nothing
 * looked broken. Setting the variables on the host changed nothing: nothing
 * read them. The module-reachability check passed throughout, because the
 * modules WERE imported — what was unreachable was the condition guarding them.
 *
 * ── THE MEDIA CREDENTIAL IS THE CHANNEL'S CREDENTIAL ──────────────────────
 *
 * The media endpoint is the same provider, the same account, and the same
 * token the adapter already sends with, so the fetchers are built from the
 * provider config `validateEnv` already checked — not from a second pair of
 * variables that would have to be kept in step with the first:
 *
 *   meta       Graph root + Bearer token          (metaMediaFetcher / metaAudioFetcher)
 *   360dialog  D360 base URL + D360-API-KEY       (whatsappMediaFetcher / …AudioFetcher)
 *   disabled   nothing: no webhook, so no media ever arrives
 *
 * Only the TRANSCRIBER is a separate account (speech-to-text is not WhatsApp's
 * to provide), so it is the one new setting. Absent, a voice note is refused
 * with `audio_unheard` and the owner is told why — the honest state M34 was
 * designed around, now reachable ONLY when the key is genuinely absent.
 *
 * Building a fetcher does no I/O; nothing here touches the network until a
 * media job runs.
 */

export type MediaPorts = {
  readonly transcriber?: Transcriber | undefined;
  readonly audio?: AudioFetcher | undefined;
  readonly image?: MediaFetcher | undefined;
};

/** The fields of the production config this reads. `ProdConfig` satisfies it. */
export type MediaSource = {
  readonly provider: 'meta' | '360dialog' | 'disabled';
  readonly META_WHATSAPP_ACCESS_TOKEN?: string | undefined;
  readonly META_WHATSAPP_PHONE_NUMBER_ID?: string | undefined;
  readonly META_APP_SECRET?: string | undefined;
  readonly META_GRAPH_API_VERSION: string;
  readonly D360_BASE_URL?: string | undefined;
  readonly D360_API_KEY?: string | undefined;
  readonly TRANSCRIBE_API_KEY?: string | undefined;
  readonly TRANSCRIBE_BASE_URL?: string | undefined;
};

export function mediaPortsFor(src: MediaSource): MediaPorts {
  const transcriber = src.TRANSCRIBE_API_KEY
    ? whisperTranscriber({
        apiKey: src.TRANSCRIBE_API_KEY,
        ...(src.TRANSCRIBE_BASE_URL ? { baseUrl: src.TRANSCRIBE_BASE_URL } : {}),
      })
    : undefined;

  if (src.provider === 'meta' && src.META_WHATSAPP_ACCESS_TOKEN) {
    const meta = {
      accessToken: src.META_WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: src.META_WHATSAPP_PHONE_NUMBER_ID ?? '',
      appSecret: src.META_APP_SECRET ?? '',
      graphVersion: src.META_GRAPH_API_VERSION,
    };
    return { transcriber, audio: metaAudioFetcher(meta), image: metaMediaFetcher(meta) };
  }

  if (src.provider === '360dialog' && src.D360_BASE_URL && src.D360_API_KEY) {
    const d360 = { baseUrl: src.D360_BASE_URL, apiKey: src.D360_API_KEY };
    return { transcriber, audio: whatsappAudioFetcher(d360), image: whatsappMediaFetcher(d360) };
  }

  return { transcriber };
}
