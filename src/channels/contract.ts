import type { ChannelEvent } from './whatsapp/parse.js';

/**
 * M3 — The channel contract: the minimum boundary that keeps provider
 * concepts out of the product. WhatsApp/360dialog is the only real
 * implementation; the contract exists so a provider swap (or a second
 * channel) replaces one adapter, not the product. Deliberately small —
 * multi-provider support is NOT built now (ADR-0012 feature gate).
 */

export type ChannelKind =
  | 'whatsapp'
  // future — types only, no fake integrations:
  | 'instagram' | 'messenger' | 'wechat' | 'rednote'
  | 'telegram' | 'line' | 'email' | 'web_chat';

export type SendResult =
  | { readonly ok: true; readonly providerMessageId: string }
  | { readonly ok: false; readonly retryable: boolean; readonly error: string };

/**
 * M26 — a picture, with the words that go with it.
 *
 * `caption` is ordinary reply text and is guarded exactly like any other reply:
 * it passes through the numeral and claims guards upstream, and reaches here
 * already approved. The URL is not free text — it is one of the owner's own
 * `product_images.url` rows, so a picture a buyer receives is always one the
 * owner uploaded.
 */
export type OutboundMedia = {
  readonly url: string;
  readonly caption: string;
};

/**
 * C4.a — a message that needs more than a body.
 *
 * `sendText(to, body)` is the WhatsApp shape and it has no room for a subject.
 * Deriving one from the first line was considered and rejected: the subject
 * would become a side effect of how she phrased her opening sentence, and a
 * long first line would arrive as an unreadable subject in her buyer's inbox.
 * She writes the subject with the body and approves both together, so it
 * travels with the body — here, and on the outbound row.
 *
 * `headers` carries the RFC 8058 unsubscribe pair. It is not optional in
 * practice: every message this product sends to someone who did not write
 * first must carry a way out, and the send path supplies it.
 */
export type MailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly headers: Readonly<Record<string, string>>;
};

export interface ChannelAdapter {
  readonly kind: ChannelKind;
  readonly provider: string;                    // '360dialog' | 'simulator'
  /** HMAC check over the RAW body — before any parsing. */
  verifyWebhook(rawBody: string, signatureHeader: string | undefined): boolean;
  /** Raw provider payload → canonical events. Never throws. */
  parseWebhook(payload: unknown): ChannelEvent[];
  sendText(to: string, body: string): Promise<SendResult>;
  /**
   * M26 — optional so an adapter that cannot carry pictures says so by omission
   * rather than by throwing. The worker refuses an image row when this is
   * absent; it never silently downgrades to text, because a caption without its
   * picture is a different message from the one the owner approved.
   */
  sendMedia?(to: string, media: OutboundMedia): Promise<SendResult>;
  /**
   * C4.a — optional for the same reason `sendMedia` is: an adapter that cannot
   * carry a subject says so by omission rather than by throwing, and the
   * worker refuses the row instead of silently sending something else. A
   * WhatsApp adapter omits it; the e-mail adapter implements this one and not
   * `sendText`, because a mail with no subject is not the message she wrote.
   */
  sendMail?(message: MailMessage): Promise<SendResult>;
}

/** Actions that must leave an audit record (who, when, outcome). */
export type ConnectionAction =
  | 'connect' | 'reconnect' | 'disconnect' | 'test' | 'rotate_credential';

/** Connection lifecycle as stored — mirrors core/channel/health statuses. */
export type ConnectionRecord = {
  readonly id: string;
  readonly businessId: string;
  readonly kind: ChannelKind;
  readonly status: 'connected' | 'connecting' | 'needs_attention' | 'disconnected' | 'degraded';
  readonly displayPhone: string | null;
  readonly lastInboundAt: Date | null;
  readonly lastDeliveredAt: Date | null;
  readonly lastWebhookAt: Date | null;
  readonly consecutiveSendFailures: number;
  readonly connectedAt: Date | null;
  readonly disconnectedAt: Date | null;
};
