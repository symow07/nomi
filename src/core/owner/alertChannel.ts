/**
 * THE WARMTH RUN (2026-10-03), phase 8 — HOW A NOTIFICATION REACHES A PERSON
 * OUTSIDE NOMI. Pure: every fact is passed in.
 *
 * The owner: "Outside the app: build the delivery channel as a setting, not a
 * hardcoded path. E-mail and browser notification work today. WhatsApp is the
 * intended primary and becomes the default the moment Meta approval lands —
 * design it so switching is a setting change, not a rebuild." And: "Only two
 * things may interrupt the owner outside the app: an order waiting for their
 * tap, and a conversation the assistant handed over because it could not
 * handle it. Everything else waits quietly in-app."
 *
 * A person's choice is stored as given, or NULL for "the default" (0124). The
 * default is decided here, when a notification leaves, from facts of that
 * moment — so the day `META_APP_REVIEW` says approved, everyone on the default
 * whose WhatsApp is reachable is on WhatsApp, and nothing was rebuilt or
 * rewritten. CHOOSABLE and DEFAULT are two things: WhatsApp may be chosen
 * wherever it is reachable today; it is the default only once approved.
 */

export type AlertChannel = 'email' | 'browser' | 'whatsapp';

/** The three ways, in the order the Notifications page offers them. */
export const ALERT_CHANNELS: readonly AlertChannel[] = ['email', 'browser', 'whatsapp'];

/** What a form or a row carries, read as a way — or null for anything else. */
export const parseAlertChannel = (raw: unknown): AlertChannel | null =>
  typeof raw === 'string' && (ALERT_CHANNELS as readonly string[]).includes(raw) ? raw as AlertChannel : null;

/**
 * THE OWNER'S WHATSAPP PATH, as the code decides it today: the owner set an
 * alert number, and a channel is live — the operator alerts' own test
 * (`channelIsLive`). Where it is REACHABLE, the owner may CHOOSE WhatsApp,
 * approval or not: the pilot heard of hand-overs this way before this setting
 * existed, and must not lose it.
 */
export const ownerWhatsAppReachable = (f: { readonly ownerPhone: string | null; readonly channelLive: boolean }): boolean =>
  !!f.ownerPhone && f.channelLive;

/**
 * …and it is the DEFAULT only once Meta approved Nomi as well (the operator's
 * `META_APP_REVIEW=approved:<date>`): before approval a message to the owner's
 * phone more than a day after their last one to the business may not arrive,
 * so the default stays e-mail, as the owner said. No WhatsApp registration,
 * template or review is part of this; that track is parked.
 */
export const ownerWhatsAppDefault = (f: {
  readonly approved: boolean; readonly ownerPhone: string | null; readonly channelLive: boolean;
}): boolean => f.approved && ownerWhatsAppReachable(f);

/** The default: WhatsApp where it is the default (above), e-mail otherwise. */
export const defaultAlertChannel = (whatsappDefault: boolean): AlertChannel => (whatsappDefault ? 'whatsapp' : 'email');

/** What can carry a notification to this person now. E-mail is the floor, wherever there is an address to send to. */
export type AlertWays = {
  /**
   * Phase 9 of the warmth run (w4-settings-a-02) — this person has an address
   * e-mail can go to (their sign-in). Absent: yes. Without one, e-mail is no
   * floor: nothing is said to carry what it cannot.
   */
  readonly email?: boolean;
  /** The owner's WhatsApp path is reachable, and this person is the owner (the alert number is the owner's). */
  readonly whatsapp: boolean;
  /** This installation sends phone alerts, and this person has a phone or browser that turned them on. */
  readonly browser: boolean;
  /** Meta approved Nomi: with `whatsapp`, WhatsApp is the default. */
  readonly approved: boolean;
};

/**
 * The way a notification goes to a person: their choice, or the default; and
 * e-mail whenever the way wanted cannot be used now (WhatsApp with no number on
 * a live channel, Browser with no phone turned on). A failure on the way — a
 * WhatsApp outside Meta's day before approval among them — is caught by the
 * sender, which falls back to e-mail the same (`deliverOwnerInterruption`).
 *
 * NULL: nothing reaches this person — the way wanted cannot be used, and they
 * have no e-mail address to fall back to (w4-settings-a-02). The sender then
 * tries nothing, exactly as it did when this said "e-mail" and found no
 * address; the Notifications page and Setup now say so instead of naming a
 * way that cannot reach them.
 */
export function alertChannelFor(choice: AlertChannel | null, can: AlertWays): AlertChannel | null {
  const want = choice ?? defaultAlertChannel(can.whatsapp && can.approved);
  const mail = can.email !== false;
  if (want === 'email') return mail ? 'email' : null;
  return can[want] ? want : mail ? 'email' : null;
}

/**
 * What a save writes. The owner choosing the way that is the default now
 * stores NULL — "the default" — so an owner who picks e-mail before approval
 * is on WhatsApp the day approval lands; an owner who picks WhatsApp before
 * approval keeps `whatsapp`. A colleague's choice is stored as made: WhatsApp
 * is never theirs (the alert number is the owner's), and choosing is how a
 * colleague asks for notifications at all.
 */
export const storedAlertChoice = (chosen: AlertChannel, isOwner: boolean, whatsappDefault: boolean): AlertChannel | null =>
  isOwner && chosen === defaultAlertChannel(whatsappDefault) ? null : chosen;
