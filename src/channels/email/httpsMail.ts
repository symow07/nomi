import type { SystemMail } from './systemMail.js';

/**
 * MAIL (decision 36) — A DEDICATED SENDER OVER HTTPS, for the mail strangers
 * cause: sign-in codes, password-reset links and owner alerts.
 *
 * Until now every one of them left through the operator's own mailbox (the
 * Gmail API, because Railway's Hobby plan blocks SMTP). Scripted sign-ups
 * could then make Nomi e-mail any address from it, burning its reputation and
 * its daily quota — and with them every sign-in code and backup alert at once.
 * With this set, the operator's mailbox carries operator mail only.
 *
 * Two providers, chosen by the operator (MAIL_PROVIDER): both take one JSON
 * POST over HTTPS with the key in a header. All three variables or none — a
 * half-set sender is no sender, and the boot says which part is missing. The
 * key is pasted into Railway by the owner; it never appears anywhere else.
 */
export const MAIL_PROVIDERS = ['resend', 'postmark'] as const;
export type MailProvider = (typeof MAIL_PROVIDERS)[number];
export type HttpsMailConfig = { readonly provider: MailProvider; readonly apiKey: string; readonly from: string };

export function httpsMailConfigFrom(env: Record<string, string | undefined>): HttpsMailConfig | null {
  const provider = (env['MAIL_PROVIDER'] ?? '').trim().toLowerCase();
  const apiKey = (env['MAIL_API_KEY'] ?? '').trim();
  const from = (env['MAIL_FROM'] ?? '').trim();
  if (!provider && !apiKey && !from) return null;
  const missing: string[] = [];
  if (!(MAIL_PROVIDERS as readonly string[]).includes(provider)) missing.push('MAIL_PROVIDER (resend or postmark)');
  if (apiKey.length < 8) missing.push('MAIL_API_KEY');
  // "Nomi <no-reply@mail.nomidoes.com>" or a bare address.
  if (!/^(?:[^<>]*<)?[^@\s<>]+@[a-z0-9.-]+\.[a-z]{2,}>?$/i.test(from)) missing.push('MAIL_FROM');
  if (missing.length) {
    console.warn(`Dedicated mail sender: ${missing.join(', ')} missing or malformed. Codes and owner alerts stay on the operator's mailbox.`);
    return null;
  }
  return { provider: provider as MailProvider, apiKey, from };
}

export type MailFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The provider's request for one message: its address, its headers, its body. Pure. */
export function providerRequest(config: HttpsMailConfig, message: { readonly to: string; readonly subject: string; readonly text: string }):
  { readonly url: string; readonly headers: Record<string, string>; readonly body: string } {
  if (config.provider === 'postmark') {
    return {
      url: 'https://api.postmarkapp.com/email',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': config.apiKey },
      body: JSON.stringify({
        From: config.from, To: message.to, Subject: message.subject, TextBody: message.text,
        MessageStream: 'outbound', Headers: [{ Name: 'Auto-Submitted', Value: 'auto-generated' }],
      }),
    };
  }
  return {
    url: 'https://api.resend.com/emails',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      from: config.from, to: [message.to], subject: message.subject, text: message.text,
      headers: { 'Auto-Submitted': 'auto-generated' },
    }),
  };
}

export function httpsSystemMailer(config: HttpsMailConfig, fetchImpl: MailFetch = fetch as unknown as MailFetch): SystemMail {
  const address = /<([^>]+)>/.exec(config.from)?.[1] ?? config.from;
  return {
    from: address,
    async send(message) {
      const req = providerRequest(config, message);
      try {
        const res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: req.body });
        if (res.ok) return { ok: true };
        // The provider's own words, cut short; never the key, which is only in a header.
        return { ok: false, error: `${config.provider} ${res.status}: ${(await res.text()).slice(0, 200)}` };
      } catch (e) {
        return { ok: false, error: `${config.provider}: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  };
}

/**
 * A sender that asks before each message whether today's caps allow it. A
 * refused message is not sent and says why (`daily_cap: address_cap` …), so
 * the page that asked for a code can say so instead of "could not send".
 */
export function cappedMail(mail: SystemMail, claim: (to: string) => Promise<'ok' | 'address_cap' | 'installation_cap'>): SystemMail {
  return {
    from: mail.from,
    async send(message) {
      const c = await claim(message.to);
      if (c !== 'ok') return { ok: false, error: `daily_cap: ${c}` };
      return mail.send(message);
    },
  };
}
export const refusedByCap = (r: { ok: boolean; error?: string }): boolean => !r.ok && (r.error ?? '').startsWith('daily_cap:');
