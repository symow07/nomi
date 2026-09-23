/**
 * A5 — more than one assistant, and what one IS.
 *
 * v1, as decided with the owner: assistants differ by NAME, ROLE and CHANNELS.
 * What the business sells, what it taught, its price limits and what an
 * assistant may do alone stay the business's. So an assistant is small on
 * purpose, and nothing here can widen what may be said to a buyer.
 *
 * Pure: the lists, and whether what the owner typed is usable.
 */

export const ASSISTANT_ROLES = ['sales', 'support', 'after_sales', 'other'] as const;
export type AssistantRole = (typeof ASSISTANT_ROLES)[number];

/** The channels a conversation can arrive on here — the ones an assistant can be given. */
export const ASSISTANT_CHANNELS = ['whatsapp', 'instagram', 'messenger', 'email'] as const;
export type AssistantChannel = (typeof ASSISTANT_CHANNELS)[number];

export const NAME_MAX = 40;
export const NOTE_MAX = 600;

/**
 * What a business's FIRST assistant is called, by the language they signed up
 * in. A starting point she can change on the team page — this is the only
 * moment code decides a name, and after it the `assistants` table is the
 * source for every reading of it.
 *
 * It is a default for the ROW, not a name anybody chose, so it is not SHOWN
 * until the owner confirms it in Getting ready (`chosenName` in db/assistants;
 * before that, copy says "your assistant"). It still matters: it is what the
 * confirmation form offers, and what the row holds meanwhile.
 *
 * Not a translation table, and the difference is deliberate. A name written into
 * a database row is not translated afterwards — it is stored once and shown to
 * everyone, whatever language the page is in. So Arabic takes the Latin name
 * rather than ياسمين: a workspace that signed up in Arabic is read in Arabic
 * and English by the same team, and a name that only works in one of them is
 * the wrong thing to have committed to a row. Chinese keeps 小雅, which is the
 * name that workspace's buyers and staff will actually use.
 *
 * CC-16 is the finding behind this: an Arabic page showed "Lily" because the
 * row had been created from the business's stored locale, so the name stopped
 * following the page. It cannot follow the page — it is her name. This makes
 * the stored name the one that reads acceptably wherever it is shown.
 */
export const DEFAULT_ASSISTANT_NAME: Readonly<Record<string, string>> = {
  en: 'Lily',
  zh: '小雅',
  ar: 'Lily',
};

/** Her name at creation, for a locale this build may not know. */
export const defaultAssistantName = (locale: string): string =>
  DEFAULT_ASSISTANT_NAME[locale] ?? DEFAULT_ASSISTANT_NAME['en']!;

export type Assistant = {
  readonly id: string; readonly name: string; readonly role: AssistantRole; readonly note: string | null;
  readonly channels: readonly AssistantChannel[]; readonly isDefault: boolean;
};

export type AssistantInput = { readonly name: string; readonly role: string; readonly note: string; readonly channels: readonly string[] };
export type AssistantProblem = 'name_missing' | 'name_long' | 'role_invalid' | 'note_long';
export type ValidAssistant = { readonly name: string; readonly role: AssistantRole; readonly note: string | null; readonly channels: readonly AssistantChannel[] };

const isRole = (v: string): v is AssistantRole => (ASSISTANT_ROLES as readonly string[]).includes(v);
const isChannel = (v: string): v is AssistantChannel => (ASSISTANT_CHANNELS as readonly string[]).includes(v);

export function validateAssistant(input: AssistantInput): { ok: true; value: ValidAssistant } | { ok: false; problem: AssistantProblem } {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, problem: 'name_missing' };
  if (name.length > NAME_MAX) return { ok: false, problem: 'name_long' };
  if (!isRole(input.role)) return { ok: false, problem: 'role_invalid' };
  const note = input.note.trim();
  if (note.length > NOTE_MAX) return { ok: false, problem: 'note_long' };
  // A channel that is not one is dropped, not refused: it cannot be wrong in a way she can fix.
  const channels = [...new Set(input.channels.map((c) => c.trim()).filter(isChannel))];
  return { ok: true, value: { name, role: input.role, note: note === '' ? null : note, channels } };
}

/**
 * Who answers a conversation that starts on this channel: the assistant given
 * that channel, else the default. `null` only when the business has no
 * assistant rows at all yet — which reads as "the default", as it always did.
 */
export function assistantFor(assistants: readonly Assistant[], channel: string): Assistant | null {
  return assistants.find((a) => !a.isDefault && (a.channels as readonly string[]).includes(channel))
    ?? assistants.find((a) => a.isDefault) ?? null;
}

/**
 * A5.3 — who is speaking in a conversation, as the reply writer is told it.
 *
 * `name`, `role` and `note` are the conversation's assistant (its own, else the
 * main one); all three are null while the business has named nobody, and the
 * writer is then told nothing about a speaker, as before. `business` is what
 * the owner said about her own business at sign-up and under Settings.
 *
 * None of it is a fact a buyer may be quoted: numbers, claims and forbidden
 * words are guarded exactly as they were, whoever is speaking.
 */
export type Speaker = {
  readonly name: string | null;
  readonly role: AssistantRole | null;
  readonly note: string | null;
  readonly business: {
    readonly name: string; readonly kind: string | null;
    readonly country: string | null; readonly description: string | null;
  };
};
