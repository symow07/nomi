import { detectInjection } from '../safety/injection.js';

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
/** The owner's line on how the assistant talks: one line since Block 3 PR 1 (the column keeps 0059's 600). */
export const NOTE_MAX = 200;

/**
 * THE VOICE (Block 3 PR 1 of the finishing roadmap; 0228). How the owner chose the replies should sound: the tone, the
 * length and whether an emoji may appear. Read by the reply writer as fixed instructions beside the owner's own line
 * (`note`); no guard reads any of it, and it cannot widen what the assistant may say.
 */
export const VOICE_TONES = ['plain', 'warm', 'formal'] as const;
export type VoiceTone = (typeof VOICE_TONES)[number];
export const VOICE_LENGTHS = ['short', 'normal'] as const;
export type VoiceLength = (typeof VOICE_LENGTHS)[number];
export const VOICE_EMOJI = ['never', 'like_customer'] as const;
export type VoiceEmoji = (typeof VOICE_EMOJI)[number];
export type Voice = { readonly tone: VoiceTone; readonly length: VoiceLength; readonly emoji: VoiceEmoji };
/** What a workspace made before 0228 keeps: the way replies already sounded. */
export const DEFAULT_VOICE: Voice = { tone: 'warm', length: 'normal', emoji: 'never' };

const pick = <T extends readonly string[]>(list: T, v: string | undefined, fallback: T[number]): T[number] | null => {
  const s = (v ?? '').trim();
  if (s === '') return fallback;
  return (list as readonly string[]).includes(s) ? (s as T[number]) : null;
};
/** The form's three choices; an empty one is the default, a word outside its list is nothing (refused). */
export function voiceFrom(input: { readonly tone?: string; readonly length?: string; readonly emoji?: string }): Voice | null {
  const tone = pick(VOICE_TONES, input.tone, DEFAULT_VOICE.tone);
  const length = pick(VOICE_LENGTHS, input.length, DEFAULT_VOICE.length);
  const emoji = pick(VOICE_EMOJI, input.emoji, DEFAULT_VOICE.emoji);
  return tone && length && emoji ? { tone, length, emoji } : null;
}

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
  readonly voice: Voice;
};

export type AssistantInput = { readonly name: string; readonly role: string; readonly note: string; readonly channels: readonly string[];
  readonly tone?: string; readonly length?: string; readonly emoji?: string };
export type AssistantProblem = 'name_missing' | 'name_long' | 'role_invalid' | 'note_long' | 'note_injection' | 'voice_invalid';
export type ValidAssistant = { readonly name: string; readonly role: AssistantRole; readonly note: string | null; readonly channels: readonly AssistantChannel[]; readonly voice: Voice };

const isRole = (v: string): v is AssistantRole => (ASSISTANT_ROLES as readonly string[]).includes(v);
const isChannel = (v: string): v is AssistantChannel => (ASSISTANT_CHANNELS as readonly string[]).includes(v);

export function validateAssistant(input: AssistantInput): { ok: true; value: ValidAssistant } | { ok: false; problem: AssistantProblem } {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, problem: 'name_missing' };
  if (name.length > NAME_MAX) return { ok: false, problem: 'name_long' };
  if (!isRole(input.role)) return { ok: false, problem: 'role_invalid' };
  const note = input.note.trim();
  if (note.length > NOTE_MAX) return { ok: false, problem: 'note_long' };
  // Block 3 PR 1 — the line reaches the writer's prompt, so an instruction dressed as a way of talking is refused.
  if (note && detectInjection(note).detected) return { ok: false, problem: 'note_injection' };
  const voice = voiceFrom(input);
  if (!voice) return { ok: false, problem: 'voice_invalid' };
  // A channel that is not one is dropped, not refused: it cannot be wrong in a way she can fix.
  const channels = [...new Set(input.channels.map((c) => c.trim()).filter(isChannel))];
  return { ok: true, value: { name, role: input.role, note: note === '' ? null : note, channels, voice } };
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
  /** Block 3 PR 1 — how the owner chose it should talk; absent when the conversation has no assistant row. */
  readonly voice?: Voice;
  readonly business: {
    readonly name: string; readonly kind: string | null;
    readonly country: string | null; readonly description: string | null;
  };
};
