/**
 * 360dialog send client. Thin by design: build request, send, map result.
 * Retries/ordering live in the outbound worker + sequencer, not here.
 *
 * Sandbox: base https://waba-sandbox.360dialog.io — free, immediate, no
 * verification (ADR-0012 B). Production: https://waba-v2.360dialog.io.
 * Auth: D360-API-KEY header.
 */

export type WhatsAppSendResult =
  | { readonly ok: true; readonly providerMessageId: string }
  | { readonly ok: false; readonly retryable: boolean; readonly error: string };

export type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number; text(): Promise<string> }>;

export function whatsappClient(cfg: {
  baseUrl: string;         // sandbox or production
  apiKey: string;
  fetchImpl?: FetchLike;
}) {
  const doFetch: FetchLike = cfg.fetchImpl ?? (fetch as unknown as FetchLike);

  async function post(payload: unknown): Promise<WhatsAppSendResult> {
    try {
      const res = await doFetch(`${cfg.baseUrl}/messages`, {
        method: 'POST',
        headers: { 'D360-API-KEY': cfg.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      if (res.status >= 200 && res.status < 300) {
        const id = /"id"\s*:\s*"([^"]+)"/.exec(text)?.[1];
        return id
          ? { ok: true, providerMessageId: id }
          : { ok: false, retryable: false, error: `2xx without message id: ${text.slice(0, 200)}` };
      }
      // 429/5xx retry; 4xx (bad payload, auth, 24h-window violation) do not —
      // retrying a policy rejection just re-fails and burns quality rating.
      return {
        ok: false,
        retryable: res.status === 429 || res.status >= 500,
        error: `${res.status}: ${text.slice(0, 300)}`,
      };
    } catch (e) {
      return { ok: false, retryable: true, error: `network: ${String(e)}` };
    }
  }

  return {
    sendText(to: string, body: string): Promise<WhatsAppSendResult> {
      return post({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body },
      });
    },
    /** Typing indicator + read receipt: cheap humanity (TRUST docs). */
    markRead(messageId: string): Promise<WhatsAppSendResult> {
      return post({ messaging_product: 'whatsapp', status: 'read', message_id: messageId });
    },
  };
}
