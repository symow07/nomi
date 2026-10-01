import type { MetaFetch } from './messaging.js';

/**
 * CH7 — the caption of the shop's OWN post, story or reel, read with the
 * Page token that connected it (`instagram_basic`, which connect already asks
 * for; its use here is CH7's own App Review submission — decision 6).
 *
 * `GET /{media-id}?fields=caption`. Meta answers only for media the token's
 * account owns: a post of another shop, shared into the chat, is an error
 * here — and an error is "no caption", so a stranger's post is never matched
 * to this catalogue. A story usually has no caption at all.
 *
 * It NEVER throws and never holds a conversation up for long: five seconds,
 * then nothing. No token, no permission, a bad minute at Meta — all read as
 * "no caption", and the message goes on exactly as it did before CH7.
 */
export const CAPTION_TIMEOUT_MS = 5_000;
/** Instagram's own limit on a caption. */
export const CAPTION_MAX = 2_200;

export function metaPostCaption(cfg: {
  readonly accessToken: string;
  readonly graphVersion: string;
  readonly fetchImpl?: MetaFetch | undefined;
}) {
  const doFetch: MetaFetch = cfg.fetchImpl ?? (fetch as unknown as MetaFetch);
  return async (mediaId: string): Promise<string | null> => {
    if (!/^[0-9A-Za-z_]{1,64}$/.test(mediaId)) return null;
    try {
      const res = await doFetch(
        `https://graph.facebook.com/${cfg.graphVersion}/${encodeURIComponent(mediaId)}?fields=caption`,
        { method: 'GET', headers: { Authorization: `Bearer ${cfg.accessToken}` }, signal: AbortSignal.timeout(CAPTION_TIMEOUT_MS) },
      );
      if (res.status < 200 || res.status >= 300) return null;
      const body = JSON.parse(await res.text()) as unknown;
      const caption = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['caption'] : null;
      return typeof caption === 'string' && caption.trim() ? caption.slice(0, CAPTION_MAX) : null;
    } catch {
      return null;
    }
  };
}
