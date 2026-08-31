import { type Result, ok, err } from '../types/result.js';

/**
 * M39 — what each channel can actually carry.
 *
 * This is M25/M26's pattern on the channel axis: the product states what is
 * possible BEFORE it is asked to do it, so it can never promise something an
 * API does not permit. The owner reads it on the connection screen instead of
 * discovering it after her account is gone.
 *
 * ── IT IS NOT A POLICY. IT IS WHAT THE APIS PERMIT ────────────────────────
 *
 * Every tool that appears to cold-DM on Instagram is automating the consumer
 * app, and those accounts get banned. Writing "never" here is not caution; it
 * is the documented behaviour of the Graph API, and a product that hedged it
 * into "not recommended" would be lying in the direction that costs her the
 * account she has spent years building.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT ANSWER ───────────────────────────
 *
 * It names requirements. It does not evaluate them, because every one of them
 * already has exactly one answerer and a second would drift:
 *
 *   approved_template        → `templateReadiness.ts` (M22 §B)
 *   verified_sending_domain  → `outreach/domain.ts` (M40.1)
 *   business_verification    }
 *   privacy_policy_url       } → Meta's decision; she supplies the evidence
 *
 * And CONSENT is not on the list at all, though the roadmap names it for
 * WhatsApp. Consent is universal — no channel may carry an uninvited message
 * without it — so it belongs to M38 and is answered by `mayContact` for every
 * channel at once. Listing it here as a per-channel requirement would create a
 * second place that decides whether a buyer opted in, and the two would agree
 * right up until the day they did not.
 *
 * Pure per ADR-0002.
 */

/**
 * The channels this product can reach. WeChat is absent until M48: a channel
 * with no adapter behind it would be a row promising something no code can do,
 * which is the exact failure this registry exists to prevent.
 */
export const OUTREACH_CHANNELS = ['email', 'whatsapp', 'instagram', 'messenger'] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

/** What the API structurally permits for a message the buyer did not invite. */
export type ColdInitiate =
  /** Email. The only true cold channel there is. */
  | 'open'
  /** WhatsApp. Possible, but only once several things Meta owns are true. */
  | 'conditional'
  /** Instagram, Messenger. Not "discouraged" — the API cannot express it. */
  | 'never';

/**
 * Things that must be true before a `conditional` channel may initiate.
 * Named here, answered elsewhere — see the header.
 */
export const REQUIREMENTS = [
  'approved_template', 'business_verification', 'privacy_policy_url',
  'verified_sending_domain',   // M40.1
] as const;
export type Requirement = (typeof REQUIREMENTS)[number];

/**
 * What genuinely works instead, on a channel that cannot be initiated.
 *
 * A refusal that names no alternative is where an owner goes looking for a tool
 * that will say yes — and the alternatives here are not consolation prizes.
 * Both are inbound-triggered, which is what this product is already built for:
 * the buyer comments or taps, and the conversation starts inside the window.
 */
export const INSTEAD = ['comment_to_dm', 'click_to_whatsapp', 'buyer_writes_first'] as const;
export type Instead = (typeof INSTEAD)[number];

export type ChannelCapability = {
  readonly channel: OutreachChannel;
  readonly coldInitiate: ColdInitiate;
  /** Non-empty only where `coldInitiate` is 'conditional'. */
  readonly requires: readonly Requirement[];
  /** How long a reply stays possible after the buyer writes, in hours. */
  readonly replyWindowHours: number | null;
  readonly instead: readonly Instead[];
  /**
   * Whether THIS PRODUCT can carry a message on it today — which is a different
   * question from whether the channel allows one, and conflating the two is how
   * the first version of this page told an owner "Email · you can write first"
   * beside a Connect button, when nothing here can send an email at all.
   *
   * Derived-checkable rather than a claim: a channel marked available must have
   * an adapter under `src/channels/`, and a parity test walks that directory in
   * both directions. Email flips with M40, and it flips because the adapter
   * lands, not because someone remembered to edit a boolean.
   */
  readonly availableHere: boolean;
};

export const CHANNEL_REGISTRY: Readonly<Record<OutreachChannel, ChannelCapability>> = {
  email: {
    availableHere: false, channel: 'email', coldInitiate: 'open',
    // M40.1 — mail leaves as HER domain, so a missing SPF/DKIM/DMARC record
    // damages the address she has used with buyers for years. The damage is
    // silent and gradual, which is exactly why it is a requirement here rather
    // than a warning somewhere.
    requires: ['verified_sending_domain'],
    replyWindowHours: null, instead: [],
  },
  whatsapp: {
    availableHere: true, channel: 'whatsapp', coldInitiate: 'conditional',
    // Business Verification and a published privacy-policy URL are required
    // before ANY template send at all (Meta, Jan 2026) — not per message.
    requires: ['approved_template', 'business_verification', 'privacy_policy_url'],
    replyWindowHours: 24, instead: [],
  },
  instagram: {
    availableHere: false, channel: 'instagram', coldInitiate: 'never', requires: [],
    // The API replies only within 24h of a user-initiated message. Message tags
    // are non-promotional only, and one-time notifications do not exist here.
    replyWindowHours: 24,
    instead: ['comment_to_dm', 'click_to_whatsapp', 'buyer_writes_first'],
  },
  messenger: {
    availableHere: false, channel: 'messenger', coldInitiate: 'never', requires: [],
    // The human-agent tag extends replies to 7 days. Still not cold: it extends
    // a conversation the buyer started, which is a different thing entirely.
    replyWindowHours: 24,
    instead: ['comment_to_dm', 'click_to_whatsapp', 'buyer_writes_first'],
  },
};

export type InitiateRefusal =
  | { readonly kind: 'never'; readonly channel: OutreachChannel; readonly instead: readonly Instead[] }
  | { readonly kind: 'unmet'; readonly channel: OutreachChannel; readonly missing: readonly Requirement[] };

/**
 * May an uninvited message go out on this channel at all?
 *
 * FAIL CLOSED IN BOTH DIRECTIONS. A requirement the caller did not mention is
 * unmet, not satisfied — a caller that forgets to resolve template readiness
 * gets a refusal, never a send. And `never` is checked first, so no set of
 * satisfied requirements can ever talk a reply-only channel into initiating.
 *
 * It says nothing about whether THIS person may be written to. That is M38's,
 * and M42 composes the two.
 */
export function mayInitiate(
  channel: OutreachChannel,
  satisfied: ReadonlySet<Requirement> = new Set(),
): Result<ChannelCapability, InitiateRefusal> {
  return mayInitiateWith(CHANNEL_REGISTRY[channel], satisfied);
}

/**
 * The same decision over a capability rather than a channel name.
 *
 * It exists as its own function because the ordering inside it is a guarantee
 * that today's data cannot exercise: no `never` channel currently carries a
 * requirement, so checking requirements first would produce the same answers
 * and a mutation of the order survives every test written against the real
 * registry. The seam lets the ordering be tested against a capability that
 * could exist tomorrow — a reply-only channel with a condition attached.
 *
 * The failure it prevents is not a wrong boolean; both orders refuse. It is a
 * wrong SENTENCE: `unmet` renders as "you can write first once these are in
 * place", which is a promise no amount of paperwork can make true on Instagram.
 */
export function mayInitiateWith(
  cap: ChannelCapability,
  satisfied: ReadonlySet<Requirement> = new Set(),
): Result<ChannelCapability, InitiateRefusal> {
  if (cap.coldInitiate === 'never') {
    return err({ kind: 'never', channel: cap.channel, instead: cap.instead });
  }
  const missing = cap.requires.filter((r) => !satisfied.has(r));
  return missing.length === 0 ? ok(cap) : err({ kind: 'unmet', channel: cap.channel, missing });
}
