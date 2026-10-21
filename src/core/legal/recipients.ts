/**
 * D18 (the data-protection audit, 2026-10-12) — NO SERVICE RECEIVES ANYONE'S
 * DATA BEFORE THE PRIVACY PAGE NAMES IT.
 *
 * Six services this build can use are off in production, and the privacy page
 * does not name them. Switched on, each would receive someone's data unnamed:
 * Stripe (an owner's billing), the browsers' push services (alerts), Resend or
 * Postmark (sign-in codes and alerts), 360dialog (every WhatsApp message), the
 * installation's own SMTP server (mail to customers), and Apollo (prospect
 * searches). Each is listed here with what switches it on. While `named` is
 * false, switching it on fails: the boot refuses the variable (`validateEnv`),
 * and Apollo, switched on per business by a stored key, is not wired at all.
 *
 * To switch one on: give the privacy page its line (who receives what, where,
 * on what terms) in every language, set `named: true` with that line's key, and
 * the test that every named service's line exists holds it.
 */
export type OptionalRecipient = {
  readonly id: 'stripe' | 'webPush' | 'httpsMail' | 'd360' | 'smtp' | 'apollo'
    // A5 (Phase 5, PHASE-5.md §6.3) — the books' new processors, none named yet.
    | 'googleSheets' | 'odoo' | 'xero' | 'intuit' | 'documentReader' | 'telegram';
  readonly name: string;
  /** The variables that switch it on, as the boot reads them; none for one switched on inside the product. */
  readonly switchedOnBy: (env: Readonly<Record<string, string | undefined>>) => readonly string[];
  /** The privacy page's key that names it, once it does. */
  readonly named: false | { readonly key: string };
};

const set = (env: Readonly<Record<string, string | undefined>>, ...names: string[]): string[] =>
  names.filter((n) => (env[n] ?? '').trim() !== '');

export const OPTIONAL_RECIPIENTS: readonly OptionalRecipient[] = [
  { id: 'stripe', name: 'Stripe', switchedOnBy: (env) => set(env, 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'), named: false },
  { id: 'webPush', name: 'the browsers\' push services (web push)', switchedOnBy: (env) => set(env, 'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY'), named: false },
  { id: 'httpsMail', name: 'Resend or Postmark', switchedOnBy: (env) => set(env, 'MAIL_PROVIDER', 'MAIL_API_KEY'), named: false },
  {
    id: 'd360', name: '360dialog',
    switchedOnBy: (env) => [...(env['WHATSAPP_PROVIDER'] === '360dialog' ? ['WHATSAPP_PROVIDER=360dialog'] : []), ...set(env, 'D360_API_KEY')],
    named: false,
  },
  { id: 'smtp', name: 'the installation\'s own SMTP server', switchedOnBy: (env) => set(env, 'SMTP_HOST'), named: false },
  { id: 'apollo', name: 'Apollo', switchedOnBy: () => [], named: false },
  // A5 (Phase 5, PHASE-5.md §6.3) — each receives a shop's books or messages once switched on, so none may be before
  // the privacy page names it in every language. Odoo is the shop's own system, connected per business with a key it
  // gives (like Apollo): nothing in the environment switches it on, and nothing wires it while it is unnamed.
  { id: 'googleSheets', name: 'Google (Sheets)', switchedOnBy: (env) => set(env, 'SHEETS_CLIENT_ID', 'SHEETS_CLIENT_SECRET'), named: false },
  { id: 'odoo', name: 'Odoo (the shop\'s own)', switchedOnBy: () => [], named: false },
  { id: 'xero', name: 'Xero', switchedOnBy: (env) => set(env, 'XERO_CLIENT_ID', 'XERO_CLIENT_SECRET'), named: false },
  { id: 'intuit', name: 'Intuit (QuickBooks)', switchedOnBy: (env) => set(env, 'QBO_CLIENT_ID', 'QBO_CLIENT_SECRET'), named: false },
  { id: 'documentReader', name: 'the model that reads receipts, invoices and bills', switchedOnBy: (env) => set(env, 'DOCUMENT_READER_API_KEY'), named: false },
  { id: 'telegram', name: 'Telegram', switchedOnBy: (env) => set(env, 'TELEGRAM_BOT_TOKEN'), named: false },
];

/** What the boot refuses: each service switched on that the privacy page does not name. */
export function unnamedRecipientProblems(
  env: Readonly<Record<string, string | undefined>>, recipients: readonly OptionalRecipient[] = OPTIONAL_RECIPIENTS,
): string[] {
  return recipients.flatMap((r) => {
    const by = r.switchedOnBy(env);
    return r.named || by.length === 0 ? [] : [
      `${by.join(', ')}: switches on ${r.name}, which the privacy page does not name as a recipient — `
      + 'give it its line on the privacy page and mark it named in src/core/legal/recipients.ts first (D18)',
    ];
  });
}

/** Is this one named (and so may be switched on)? */
export const recipientNamed = (id: OptionalRecipient['id'], recipients: readonly OptionalRecipient[] = OPTIONAL_RECIPIENTS): boolean =>
  recipients.some((r) => r.id === id && r.named !== false);
