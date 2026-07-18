import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook authenticity. Meta signs Cloud API webhooks with
 * X-Hub-Signature-256: sha256=<hmac-sha256(app_secret, raw_body)>.
 * Verification must run over the RAW body bytes, before JSON parsing.
 *
 * Replay defense is layered: (1) this signature, (2) channel_events PK =
 * provider event id — a replayed webhook is a dup insert and a no-op,
 * (3) staleness rejection below for events older than the provider's own
 * 7-day retry horizon.
 */

export function signBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

export function verifySignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const expected = Buffer.from(signBody(rawBody, secret));
  const got = Buffer.from(signatureHeader);
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

/** Providers retry ≤7 days; anything older is a replay or a bug. */
export const MAX_EVENT_AGE_MS = 7 * 24 * 3600 * 1000 + 3600 * 1000;

export function isStaleEvent(occurredAt: Date, now: Date): boolean {
  return now.getTime() - occurredAt.getTime() > MAX_EVENT_AGE_MS;
}
