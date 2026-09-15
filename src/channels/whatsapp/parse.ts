/**
 * WhatsApp Cloud API webhook parser (360dialog hosts Cloud API only since
 * Oct 2025 — one payload shape). Pure: payload in, canonical events out.
 *
 * Operational contract this exists to honour (ADR-0012 C):
 *  - ack < 5s → the HTTP handler does NOTHING but verify, call this, persist,
 *    enqueue; all real work is async.
 *  - retries for up to 7 days → every event carries the provider's own id so
 *    dedup is the channel_events primary key.
 *  - one webhook may batch multiple messages AND statuses.
 */

export type InboundMessageEvent = {
  readonly kind: 'message';
  readonly eventId: string;              // wamid
  /** Idempotency key for channel_events. Messages: the wamid itself. */
  readonly dedupKey: string;
  readonly waId: string;                 // buyer phone id
  readonly profileName: string | null;
  readonly phoneNumberId: string;        // merchant number id → resolves tenant
  readonly occurredAt: Date;
  readonly messageType: 'text' | 'image' | 'audio' | 'unsupported';
  /**
   * G2c — the provider's own type, lower-cased ('document', 'sticker',
   * 'reaction', 'location'…). `messageType` says which pipeline can READ it;
   * this says what it WAS, so an unreadable message is handed to a person with
   * a name ("he sent a document") instead of running a turn on empty text.
   */
  readonly received: string;
  readonly text: string | null;          // body, or a photo / document / video caption
  readonly mediaId: string | null;
};

export type StatusEvent = {
  readonly kind: 'status';
  readonly eventId: string;              // wamid the status refers to
  /**
   * Statuses share the message's wamid, so 'delivered' and 'read' for the
   * same message would collide under wamid-only dedup (the 'read' would be
   * dropped as a replay — found by the local end-to-end run). Key is
   * wamid#status: distinct statuses process, true retries still dedup.
   */
  readonly dedupKey: string;
  readonly status: 'sent' | 'delivered' | 'read' | 'failed';
  readonly occurredAt: Date;
  readonly phoneNumberId: string;
  readonly errorDetail: string | null;
};

export type ChannelEvent = InboundMessageEvent | StatusEvent;

type J = Record<string, unknown>;
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Meta timestamps are unix-seconds strings. */
const ts = (v: unknown): Date => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
};

export function parseWebhook(payload: unknown): ChannelEvent[] {
  const out: ChannelEvent[] = [];

  for (const entry of arr((payload as J)?.['entry'])) {
    for (const change of arr(entry['changes'])) {
      const value = (change['value'] ?? {}) as J;
      const phoneNumberId =
        str(((value['metadata'] ?? {}) as J)['phone_number_id']) ?? '';

      // contacts[] pairs with messages[] by wa_id
      const names = new Map<string, string>();
      for (const c of arr(value['contacts'])) {
        const waId = str(c['wa_id']);
        const name = str(((c['profile'] ?? {}) as J)['name']);
        if (waId && name) names.set(waId, name);
      }

      for (const m of arr(value['messages'])) {
        const id = str(m['id']);
        const from = str(m['from']);
        if (!id || !from) continue; // malformed — skip, never throw in ingress

        const type = str(m['type']) ?? 'unsupported';
        const image = (m['image'] ?? {}) as J;
        out.push({
          kind: 'message',
          eventId: id,
          dedupKey: id,
          waId: from,
          profileName: names.get(from) ?? null,
          phoneNumberId,
          occurredAt: ts(m['timestamp']),
          messageType:
            type === 'text' ? 'text'
            : type === 'image' ? 'image'
            : type === 'audio' || type === 'voice' ? 'audio'
            : 'unsupported',
          received: type.toLowerCase(),
          // G2c — a document or video caption is the buyer's own words about
          // the file ("RFQ attached"). It is kept so the owner reads it beside
          // the note that a file arrived; it never becomes a turn's text.
          text:
            str(((m['text'] ?? {}) as J)['body']) ??
            str(image['caption']) ??
            str(((m['document'] ?? {}) as J)['caption']) ??
            str(((m['video'] ?? {}) as J)['caption']),
          mediaId: str(image['id']) ?? str(((m['audio'] ?? {}) as J)['id']),
        });
      }

      for (const s of arr(value['statuses'])) {
        const id = str(s['id']);
        const status = str(s['status']);
        if (!id || !status) continue;
        if (!['sent', 'delivered', 'read', 'failed'].includes(status)) continue;
        const firstError = arr(s['errors'])[0];
        out.push({
          kind: 'status',
          eventId: id,
          dedupKey: `${id}#${status}`,
          status: status as StatusEvent['status'],
          occurredAt: ts(s['timestamp']),
          phoneNumberId,
          errorDetail: firstError ? (str(firstError['title']) ?? JSON.stringify(firstError)) : null,
        });
      }
    }
  }
  return out;
}
