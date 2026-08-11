import { PROVIDER_TIMEOUT_MS, type FetchLike } from './client.js';

/**
 * M4 — WhatsApp media download (buyer photos). Cloud API via 360dialog:
 * GET /{media_id} returns a short-lived URL + mime; a second GET fetches
 * bytes. The sandbox proxies both under the same host with D360-API-KEY.
 * Failures are classified like sends: 429/5xx/network retryable, 4xx not
 * (expired media ids are gone forever — ask the buyer to resend).
 */

export type MediaResult =
  | { readonly ok: true; readonly base64: string; readonly mediaType: 'image/jpeg' | 'image/png' | 'image/webp' }
  | { readonly ok: false; readonly retryable: boolean; readonly error: string };

export type MediaFetcher = (mediaId: string) => Promise<MediaResult>;

/**
 * M34 — the same two-GET download, for voice notes. A separate result type
 * rather than a widened `MediaResult`, because the image path's narrowed
 * `mediaType` is what lets `imageTurn` hand bytes to the vision model without
 * re-checking: widening it would silently make an ogg file a legal argument
 * there.
 */
export type AudioResult =
  | { readonly ok: true; readonly base64: string; readonly mediaType: string }
  | { readonly ok: false; readonly retryable: boolean; readonly error: string };

export type AudioFetcher = (mediaId: string) => Promise<AudioResult>;

/** WhatsApp voice notes are ogg/opus; the rest arrive from other channels. */
const SUPPORTED_AUDIO = new Set([
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/aac', 'audio/amr',
]);

/** Voice notes are speech, not photographs — a smaller ceiling than an image. */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

type BinaryFetchLike = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) =>
  Promise<{ status: number; text(): Promise<string>; arrayBuffer?(): Promise<ArrayBuffer> }>;

const SUPPORTED = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Buyer photos only — anything bigger is not a product picture. */
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

export function whatsappMediaFetcher(cfg: {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike | BinaryFetchLike;
  /** Auth header override (Meta: Bearer token). Default: 360dialog header. */
  authHeaders?: Record<string, string>;
}): MediaFetcher {
  const doFetch = (cfg.fetchImpl ?? (fetch as unknown as BinaryFetchLike)) as BinaryFetchLike;
  const auth = cfg.authHeaders ?? { 'D360-API-KEY': cfg.apiKey };

  return async (mediaId) => {
    try {
      const meta = await doFetch(`${cfg.baseUrl}/${mediaId}`, {
        method: 'GET', headers: auth,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (meta.status >= 400) {
        return { ok: false, retryable: meta.status === 429 || meta.status >= 500,
          error: `media meta ${meta.status}` };
      }
      const metaText = await meta.text();
      const parsed = JSON.parse(metaText) as { url?: string; mime_type?: string };
      const mediaType = String(parsed.mime_type ?? '');
      if (!parsed.url || !SUPPORTED.has(mediaType)) {
        return { ok: false, retryable: false, error: `unsupported media: ${mediaType || 'no url'}` };
      }

      const bin = await doFetch(parsed.url, {
        method: 'GET', headers: auth,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (bin.status >= 400 || !bin.arrayBuffer) {
        return { ok: false, retryable: bin.status === 429 || bin.status >= 500,
          error: `media bytes ${bin.status}` };
      }
      const bytes = await bin.arrayBuffer();
      if (bytes.byteLength > MAX_MEDIA_BYTES) {
        return { ok: false, retryable: false, error: `media too large: ${bytes.byteLength} bytes` };
      }
      const base64 = Buffer.from(bytes).toString('base64');
      return { ok: true, base64, mediaType: mediaType as 'image/jpeg' | 'image/png' | 'image/webp' };
    } catch (e) {
      return { ok: false, retryable: true, error: `network: ${String(e)}` };
    }
  };
}

/**
 * M34 — voice notes, over the identical two-GET path.
 *
 * Deliberately a second function rather than a flag on the first: the failure
 * classification is the same, but the accepted MIME set and the size ceiling
 * are different facts about different media, and a boolean parameter would let
 * a caller ask for "audio" and receive an image-sized budget.
 *
 * An expired media id is NOT retryable — WhatsApp media ids die, and retrying a
 * dead one costs the buyer another wait before the same refusal.
 */
export function whatsappAudioFetcher(cfg: {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike | BinaryFetchLike;
  authHeaders?: Record<string, string>;
}): AudioFetcher {
  const doFetch = (cfg.fetchImpl ?? (fetch as unknown as BinaryFetchLike)) as BinaryFetchLike;
  const auth = cfg.authHeaders ?? { 'D360-API-KEY': cfg.apiKey };

  return async (mediaId) => {
    try {
      const meta = await doFetch(`${cfg.baseUrl}/${mediaId}`, {
        method: 'GET', headers: auth,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (meta.status >= 400) {
        return { ok: false, retryable: meta.status === 429 || meta.status >= 500,
          error: `media meta ${meta.status}` };
      }
      const parsed = JSON.parse(await meta.text()) as { url?: string; mime_type?: string };
      const mediaType = String(parsed.mime_type ?? '').split(';')[0]!.trim().toLowerCase();
      if (!parsed.url || !SUPPORTED_AUDIO.has(mediaType)) {
        return { ok: false, retryable: false, error: `unsupported audio: ${mediaType || 'no url'}` };
      }

      const bin = await doFetch(parsed.url, {
        method: 'GET', headers: auth,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (bin.status >= 400 || !bin.arrayBuffer) {
        return { ok: false, retryable: bin.status === 429 || bin.status >= 500,
          error: `media bytes ${bin.status}` };
      }
      const bytes = await bin.arrayBuffer();
      if (bytes.byteLength > MAX_AUDIO_BYTES) {
        return { ok: false, retryable: false, error: `audio too large: ${bytes.byteLength} bytes` };
      }
      return { ok: true, base64: Buffer.from(bytes).toString('base64'), mediaType };
    } catch (e) {
      return { ok: false, retryable: true, error: `network: ${String(e)}` };
    }
  };
}
