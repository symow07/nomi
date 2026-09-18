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
