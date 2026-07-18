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

type BinaryFetchLike = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) =>
  Promise<{ status: number; text(): Promise<string>; arrayBuffer?(): Promise<ArrayBuffer> }>;

const SUPPORTED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function whatsappMediaFetcher(cfg: {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike | BinaryFetchLike;
}): MediaFetcher {
  const doFetch = (cfg.fetchImpl ?? (fetch as unknown as BinaryFetchLike)) as BinaryFetchLike;

  return async (mediaId) => {
    try {
      const meta = await doFetch(`${cfg.baseUrl}/${mediaId}`, {
        method: 'GET', headers: { 'D360-API-KEY': cfg.apiKey },
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
        method: 'GET', headers: { 'D360-API-KEY': cfg.apiKey },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (bin.status >= 400 || !bin.arrayBuffer) {
        return { ok: false, retryable: bin.status === 429 || bin.status >= 500,
          error: `media bytes ${bin.status}` };
      }
      const base64 = Buffer.from(await bin.arrayBuffer()).toString('base64');
      return { ok: true, base64, mediaType: mediaType as 'image/jpeg' | 'image/png' | 'image/webp' };
    } catch (e) {
      return { ok: false, retryable: true, error: `network: ${String(e)}` };
    }
  };
}
