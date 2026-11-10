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
  | 'telegram' | 'line' | 'email' | 'web_chat' | 'tiktok';

export type SendResult =
  | { readonly ok: true; readonly providerMessageId: string; readonly recipientId?: string }
  | {
      readonly ok: false; readonly retryable: boolean; readonly error: string;
      /**
       * Audit batch 1 (B5) — the provider may have accepted it: no answer in time, the connection lost after the
       * request was written, or a yes that named no message. Never retried; the row stops and a person decides
       * (0052, `sendFailure.ts`).
       */
      readonly uncertain?: true;
    };

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
 * 0226 — a FILE, with the words that go with it: an invoice as a PDF. The address is one Nomi serves (the worker
 * refuses any other, F1); `filename` is what the customer's app shows and saves it as. `caption` is ordinary text
 * and may be empty: Meta's attachments carry none.
 */
export type OutboundDocument = {
  readonly url: string;
  readonly filename: string;
  readonly caption: string;
};

/**
 * Part B (5.3) — ONE item of the business's own WhatsApp catalogue, as a single-product message (interactive
 * `product`, no header, no body). Both ids are what Meta accepted for that item; the worker hands an adapter this
 * only after the send gate allowed the row and the item still matches what Meta holds.
 */
export type OutboundProduct = {
  readonly catalogId: string;
  readonly retailerId: string;
};

/** 0226 — a file attached to a mail: the bytes themselves, since a mail carries no link a provider fetches. */
export type MailAttachment = {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
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
  /**
   * C4.c — THE SIGNED TOKEN A PROVIDER MUST ECHO ON EVERY EVENT about this mail.
   *
   * M40.2's bounce and complaint webhook finds the tenant and the address from
   * a signed `tag` on each event, and nothing handed a transport one: the token
   * lived only inside the List-Unsubscribe URL. So no real provider could ever
   * have echoed it, and every bounce would have been dropped as unsigned. A
   * transport attaches this as the provider's own message metadata (SES message
   * tags, Postmark metadata, a Mailgun variable) so its events carry it back.
   * Null only where the installation has no signing context, and then the mail
   * carries no unsubscribe link either and is refused before it gets here.
   */
  readonly tag: string | null;
  /** 0226 — files attached to the mail (an invoice as a PDF). Absent or empty: a plain-text mail, as every mail was. */
  readonly attachments?: readonly MailAttachment[];
};

export interface ChannelAdapter {
  readonly kind: ChannelKind;
  readonly provider: string;                    // '360dialog' | 'simulator'
  /** HMAC check over the RAW body — before any parsing. */
  verifyWebhook(rawBody: string, signatureHeader: string | undefined): boolean;
  /** Raw provider payload → canonical events. Never throws. */
  parseWebhook(payload: unknown): ChannelEvent[];
  sendText(to: string, body: string): Promise<SendResult>;
  /** The connected account this optional private-comment endpoint belongs to. */
  readonly commentPrivateReplyAccountId?: string;
  /** Instagram's one private reply, addressed by comment_id, never by a DM recipient. */
  sendCommentPrivateReply?(commentId: string, body: string): Promise<SendResult>;
  /**
   * M26 — optional so an adapter that cannot carry pictures says so by omission
   * rather than by throwing. The worker refuses an image row when this is
   * absent; it never silently downgrades to text, because a caption without its
   * picture is a different message from the one the owner approved.
   */
  sendMedia?(to: string, media: OutboundMedia): Promise<SendResult>;
  /**
   * 0226 — a file (an invoice as a PDF). Optional like `sendMedia`: an adapter that cannot carry a file says so by
   * omission, and the worker refuses the row (`media_unsupported`) rather than sending its caption alone. Instagram
   * and the web chat carry none; e-mail attaches the bytes through `sendMail` instead.
   */
  sendDocument?(to: string, document: OutboundDocument): Promise<SendResult>;
  /**
   * Part B (5.3) — a product card. Optional like `sendMedia`: an adapter that cannot carry one says so by omission,
   * and the worker refuses the row (`media_unsupported`). It is never sent as its transcript words instead: a line of
   * text is not the card the owner chose.
   */
  sendProduct?(to: string, product: OutboundProduct): Promise<SendResult>;
  /**
   * WA-S — an approved WhatsApp message template (the only way to write after
   * the 24-hour window closed). Optional: only WhatsApp has templates.
   */
  sendTemplate?(to: string, template: { readonly name: string; readonly language: string; readonly params: readonly string[] }): Promise<SendResult>;
  /**
   * C4.a — optional for the same reason `sendMedia` is: an adapter that cannot
   * carry a subject says so by omission rather than by throwing, and the
   * worker refuses the row instead of silently sending something else. A
   * WhatsApp adapter omits it; the e-mail adapter implements this one and not
   * `sendText`, because a mail with no subject is not the message she wrote.
   */
  sendMail?(message: MailMessage): Promise<SendResult>;
  /**
   * The sender's display name, for a channel whose webhook carries only an id
   * (Instagram and the Page; WhatsApp sends the name in the payload). Optional
   * for the same reason the others are: an adapter that cannot ask says so by
   * omission, and the conversation is created either way — she can name him
   * herself on his page. Must never throw.
   */
  nameOf?(externalId: string): Promise<string | null>;
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
