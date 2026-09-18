import { smtpDeliver, type SmtpConfig, type SmtpDeps } from './smtp.js';
import { mimeMessage, mintMessageId } from './senders.js';

/**
 * A3 — mail from the INSTALLATION, not from a business.
 *
 * Until now every mail this product sent was a business's own: from her
 * address, on her verified domain, through her mailbox. A sign-in code is none
 * of those — it is sent before a business exists, to someone who may never
 * become one. It needs a sender of its own, and that sender must never be able
 * to carry a business's outreach (no consent gate, no unsubscribe header, no
 * domain check applies to it), so it is a separate, smaller thing: subject and
 * text to one address, nothing else.
 *
 * Unset, there is no system mail, and everything that would need it stays off.
 */
export type SystemMail = {
  readonly from: string;
  send(message: { readonly to: string; readonly subject: string; readonly text: string }): Promise<{ ok: true } | { ok: false; error: string }>;
};

/** All five, or none. A half-set sender is no sender, and says which part is missing. */
export function systemSmtpConfigFrom(env: Record<string, string | undefined>): SmtpConfig | null {
  const host = env['SYSTEM_SMTP_HOST']?.trim() ?? '';
  const user = env['SYSTEM_SMTP_USER']?.trim() ?? '';
  const password = env['SYSTEM_SMTP_PASSWORD'] ?? '';
  const from = (env['SYSTEM_SMTP_FROM']?.trim() ?? '').toLowerCase();
  const port = Number(env['SYSTEM_SMTP_PORT'] ?? 587);
  if (!host && !user && !from && !password) return null;
  const missing: string[] = [];
  if (!host) missing.push('SYSTEM_SMTP_HOST');
  if (!user) missing.push('SYSTEM_SMTP_USER');
  if (!password) missing.push('SYSTEM_SMTP_PASSWORD');
  if (!/^[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(from)) missing.push('SYSTEM_SMTP_FROM');
  if (!Number.isInteger(port) || port < 1 || port > 65535) missing.push('SYSTEM_SMTP_PORT');
  if (missing.length) {
    console.warn(`System mail: ${missing.join(', ')} missing or malformed. Sign-in codes stay off.`);
    return null;
  }
  return { host, port, user, password, from };
}

export function systemMailer(config: SmtpConfig, deps: { readonly smtp?: SmtpDeps; readonly now?: () => Date } = {}): SystemMail {
  return {
    from: config.from,
    async send(message) {
      // No tag: that is a business's bounce-tracking token, and this is not a business's mail.
      const data = mimeMessage({ ...message, from: config.from, tag: null, headers: { 'Auto-Submitted': 'auto-generated' } },
        mintMessageId(config.from), (deps.now ?? (() => new Date()))());
      const sent = await smtpDeliver(config, { to: message.to, data }, deps.smtp);
      return sent.ok ? { ok: true } : { ok: false, error: sent.error };
    },
  };
}
