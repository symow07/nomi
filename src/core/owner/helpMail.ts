import type { Locale } from './i18n/locale.js';
import { t, type MessageKey } from './i18n/messages.js';

/**
 * Block 6.1 — "Still stuck? Write to us": WHAT IS SENT, in one list. The owner's notice before sending
 * (`help.write.sends.*`, drawn by helpPanel.ts) and the operator's mail (`helpMail`, sent by notify.ts) are both built
 * from `HELP_MAIL_FIELDS`, so neither can say more or less than the other (tests/parity/help-panel.test.ts).
 *
 * Exactly four things: the words as typed, the page, the workspace's id, and who asked — the owner or a team member.
 * Not the business's name (the operator looks it up by the id), not the person's id, no address of theirs, nothing
 * about a customer.
 */
export const HELP_MAIL_FIELDS = ['words', 'page', 'workspace', 'role'] as const;
export type HelpMailField = (typeof HELP_MAIL_FIELDS)[number];

export type HelpMailRequest = {
  readonly words: string;
  /** The page it was written from, as `pageFrom` read it; null when none could be. */
  readonly page: string | null;
  readonly workspaceId: string;
  readonly role: 'owner' | 'staff';
};

/** The notice's line for each field: what the owner is told is sent. */
export const helpNoticeKey = (f: HelpMailField): MessageKey => `help.write.sends.${f}` as MessageKey;

/** Each field as the mail carries it. */
export function helpMailFields(locale: Locale, r: HelpMailRequest): Readonly<Record<HelpMailField, string>> {
  return {
    words: r.words,
    page: t(locale, 'help.mail.page', { page: r.page ?? '—' }),
    workspace: t(locale, 'help.mail.workspace', { id: r.workspaceId }),
    role: t(locale, 'help.mail.role', { role: t(locale, r.role === 'owner' ? 'help.role.owner' : 'help.role.staff') }),
  };
}

/** The operator's mail: the fields in `HELP_MAIL_FIELDS`' order between two fixed lines, and nothing else. */
export function helpMail(locale: Locale, r: HelpMailRequest): { readonly subject: string; readonly text: string } {
  const f = helpMailFields(locale, r);
  return {
    subject: t(locale, 'help.mail.subject', { id: r.workspaceId }),
    text: [t(locale, 'help.mail.intro'), '', f.words, '', ...HELP_MAIL_FIELDS.filter((k) => k !== 'words').map((k) => f[k]), t(locale, 'help.mail.answer')].join('\n'),
  };
}
