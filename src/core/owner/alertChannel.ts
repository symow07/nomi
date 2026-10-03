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
 * is on WhatsApp, and nothing was rebuilt or rewritten.
 */

export type AlertChannel = 'email' | 'browser' | 'whatsapp';

/** The three ways, in the order the Notifications page offers them. */
export const ALERT_CHANNELS: readonly AlertChannel[] = ['email', 'browser', 'whatsapp'];

/** What a form or a row carries, read as a way — or null for anything else. */
export const parseAlertChannel = (raw: unknown): AlertChannel | null =>
  typeof raw === 'string' && (ALERT_CHANNELS as readonly string[]).includes(raw) ? raw as AlertChannel : null;

/**
 * THE OWNER'S WHATSAPP PATH, as the code decides it: Meta approved Nomi (the
 * operator's `META_APP_REVIEW=approved:<date>`), the owner set an alert number,
 * and a channel is live — the operator alerts' own test (`channelIsLive`).
 * Before approval it is closed whatever else is true: no WhatsApp registration,
 * template or review is part of this; that track is parked.
 */
export const ownerWhatsAppOpen = (f: {
  readonly approved: boolean; readonly ownerPhone: string | null; readonly channelLive: boolean;
}): boolean => f.approved && !!f.ownerPhone && f.channelLive;

/** The default: WhatsApp where that path is open, e-mail otherwise. */
export const defaultAlertChannel = (whatsappOpen: boolean): AlertChannel => (whatsappOpen ? 'whatsapp' : 'email');

/** What can carry a notification to this person now. E-mail is the floor and is always tried. */
export type AlertWays = {
  /** The owner's WhatsApp path is open, and this person is the owner (the alert number is the owner's). */
  readonly whatsapp: boolean;
  /** This installation sends phone alerts, and this person has a phone or browser that turned them on. */
  readonly browser: boolean;
};

/**
 * The way a notification goes to a person: their choice, or the default; and
 * e-mail whenever the way wanted cannot be used now (WhatsApp before approval,
 * Browser with no phone turned on). A failure on the way is caught by the
 * sender, which falls back to e-mail the same (`deliverOwnerInterruption`).
 */
export function alertChannelFor(choice: AlertChannel | null, can: AlertWays): AlertChannel {
  const want = choice ?? defaultAlertChannel(can.whatsapp);
  return want === 'email' || can[want] ? want : 'email';
}

/**
 * What a save writes. The owner choosing the way that is the default now
 * stores NULL — "the default" — so that choosing e-mail while WhatsApp cannot
 * yet be chosen does not keep the owner off WhatsApp the day it can. A
 * colleague's choice is stored as made: WhatsApp is never theirs (the alert
 * number is the owner's), and choosing is how a colleague asks for
 * notifications at all.
 */
export const storedAlertChoice = (chosen: AlertChannel, isOwner: boolean, whatsappOpen: boolean): AlertChannel | null =>
  isOwner && chosen === defaultAlertChannel(whatsappOpen) ? null : chosen;
