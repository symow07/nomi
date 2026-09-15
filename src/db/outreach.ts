import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { CHANNEL_REGISTRY, type OutreachChannel } from '../core/channel/registry.js';
import { DAILY_OUTREACH_CEILING } from '../core/channel/limits.js';
import { satisfiedRequirements } from '../core/channel/requirements.js';
import type { TemplateState } from '../core/channel/window.js';
import type { OutreachInput } from '../core/outreach/gate.js';
import type { ContactChannel } from '../core/outreach/consent.js';
import { contactability } from './contacts.js';
import { sendingDomain } from './sendingDomain.js';

/**
 * M42 — whether she has decided to write first, per channel.
 *
 * Insert-only history; the newest row per channel is the one in force. Reading
 * it is a `distinct on`, which is the same shape `owner_rates` and
 * `sample_policy` use and for the same reason: the row that was current in
 * March still explains a refusal from March.
 */

/**
 * May she even MAKE this decision yet?
 *
 * Two conditions, and the second one was a screenshot's doing. A card read
 * "Not set up here yet — she cannot send on this one" directly above a switch
 * she had just turned on, which is the switch-connected-to-nothing this repo
 * has paid for before.
 *
 *   coldInitiate !== 'never'  — the platform can carry a first message at all.
 *   availableHere             — and this product can send on it TODAY.
 *
 * The second is deliberately not a pre-decision she is allowed to make: turning
 * writing-first on is a deliberate act with a real consequence, and one taken
 * three months before the channel existed is not that. E-mail becomes
 * switchable when its adapter lands (M40) and the registry's `availableHere`
 * follows the adapters on disk, so nothing here has to be remembered.
 *
 * The COLUMN stays permissive by comparison — `outreach_settings` accepts any
 * channel that could ever initiate — because a decision she made while a
 * channel was live must still read back after it is taken away.
 */
export const canBeEnabled = (channel: OutreachChannel): boolean =>
  CHANNEL_REGISTRY[channel].coldInitiate !== 'never' && CHANNEL_REGISTRY[channel].availableHere;

/**
 * C4.a — her decision AND her ceiling, which arrived together (0046).
 *
 * One row holds both because they are one decision read at one moment: "write
 * first on e-mail, at most this many a day". A second table for the number
 * would be a second history to keep in step with this one.
 */
export type OutreachSetting = {
  readonly enabled: boolean;
  /** Null = she has stated no number of her own; the code's default applies. */
  readonly dailyCap: number | null;
};

export async function outreachSettings(
  tx: Tx, businessId: BusinessId,
): Promise<ReadonlyMap<OutreachChannel, OutreachSetting>> {
  const rows = await sql<{ channel: string; enabled: boolean; daily_cap: number | null }>`
    select distinct on (channel) channel, enabled, daily_cap
      from outreach_settings
     where business_id = ${businessId}::uuid
     order by channel, at desc, id desc`.execute(tx);
  return new Map(rows.rows.map((r) => [
    r.channel as OutreachChannel,
    { enabled: r.enabled, dailyCap: r.daily_cap === null ? null : Number(r.daily_cap) },
  ]));
}

/** The same rows, as the boolean the pages have read since M42. */
export async function outreachEnabled(
  tx: Tx, businessId: BusinessId,
): Promise<ReadonlyMap<OutreachChannel, boolean>> {
  const rows = await outreachSettings(tx, businessId);
  return new Map([...rows].map(([channel, s]) => [channel, s.enabled]));
}

/**
 * Her decision, recorded with her name on it. Never an update.
 *
 * C4.a — `dailyCap` is carried forward rather than reset when she flips the
 * switch: the number she chose is a separate decision from whether the channel
 * is on, and turning e-mail off for a week must not quietly raise her ceiling
 * back to the default when she turns it on again.
 */
export async function setOutreach(
  tx: Tx, businessId: BusinessId,
  input: {
    readonly channel: OutreachChannel; readonly enabled: boolean; readonly by: string;
    /** Omitted keeps whatever is in force; explicit null clears it to the default. */
    readonly dailyCap?: number | null;
  },
): Promise<boolean> {
  if (!canBeEnabled(input.channel)) return false;
  const current = (await outreachSettings(tx, businessId)).get(input.channel);
  const cap = input.dailyCap === undefined ? (current?.dailyCap ?? null) : input.dailyCap;
  await sql`
    insert into outreach_settings (business_id, channel, enabled, by_actor, daily_cap)
    values (${businessId}::uuid, ${input.channel}, ${input.enabled}, ${input.by}, ${cap})`.execute(tx);
  return true;
}

/**
 * C4.a — HOW MANY FIRST MESSAGES LEFT TODAY, on this channel.
 *
 * Counted from `outbound_messages`, which is the record of what actually went
 * out. There is no `outreach_log`: the roadmap named one for five milestones and
 * it never had a writer, and a second table counting the same sends is two
 * numbers that can disagree about the same day — the `message_fragments` mistake
 * with a different name (0036, 0037).
 *
 * `sent_at`, not `created_at`: a row queued yesterday and sent today spends
 * today's quota, because today is when a stranger heard from her. Statuses are
 * not filtered — `sent_at` is written by `transition()` only on 'sent', so a
 * refused or canceled row has none and cannot consume a ceiling it never used.
 *
 * Shanghai, like `DAILY_OUTBOUND_CEILING`: one definition of "today" per
 * product, and hers is the one the factory works in.
 */
export async function outreachSentToday(
  tx: Tx, businessId: BusinessId, channel: OutreachChannel,
  /**
   * C4.b — 'sent' is what the SEND-TIME gate counts: the row being sent is not
   * sent yet, so counting queued rows would count it against itself.
   * 'sent_or_queued' is what a PRECHECK counts — her write button, the sequence
   * scheduler — because mail already queued today will spend today's quota
   * the moment the worker reaches it. Counting only the sent, sixty first
   * messages queued in one minute against a cap of fifty would all be accepted
   * and ten refused later, each one a refusal card instead of a "not today".
   */
  counting: 'sent' | 'sent_or_queued' = 'sent',
): Promise<number> {
  const r = await sql<{ n: number }>`
    select count(*)::int as n from outbound_messages
     where business_id = ${businessId}::uuid
       and channel = ${channel} and origin = 'outreach'
       and (sent_at >= (date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')
            -- In flight means queued in the last day. A row stuck in 'queued'
            -- since last week is not about to spend today's quota, and letting
            -- it count would lower her cap for good.
            ${counting === 'sent_or_queued'
              ? sql`or (status in ('queued', 'sending') and created_at > now() - interval '1 day')`
              : sql``})
  `.execute(tx);
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * C4.a — EVERY FACT THE OUTREACH GATE NEEDS, resolved once.
 *
 * The gate (M42) is pure and composes M38 and M39; somebody has to read the
 * rows. This is that reader for ONE buyer, and its callers are the moments a
 * first message is decided: `writeFirst` when she presses send, the sequence
 * scheduler when a follow-up falls due (C4.b), and the outbound store when the
 * row actually leaves. All of them then ask `gateOutreach`, so the answer she was
 * given and the answer the send path acts on come from the same rows and the
 * same function.
 *
 * Her contacts LIST asks the same gate with the rows `listContacts` already
 * holds — the same consent and suppression shape `contactability` reads, per
 * M38 — rather than calling this once per person: a page of two hundred buyers
 * is not two hundred sets of four queries. It passes `ceilingReached: false`,
 * because a list is not an attempt; this function counts.
 *
 * Fail-closed by construction. Every field resolves to its refusing value when
 * the row behind it is absent: no `outreach_settings` row is not enabled, no
 * consent row is no consent, an unverified domain leaves `satisfied` empty, and
 * a channel this product cannot carry is `availableHere: false`.
 */
export async function outreachFacts(
  tx: Tx, businessId: BusinessId,
  input: {
    readonly channel: OutreachChannel & ContactChannel;
    readonly identity: string;
    readonly templateState: TemplateState;
    readonly now: Date;
    /** See `outreachSentToday`. The send path leaves it at 'sent'. */
    readonly counting?: 'sent' | 'sent_or_queued';
  },
): Promise<OutreachInput> {
  // Sequential, not Promise.all: one transaction is one connection, and the
  // order of reads inside it should be the order they are written here.
  const settings = await outreachSettings(tx, businessId);
  const person = await contactability(tx, businessId, input.channel, input.identity);
  const domain = await sendingDomain(tx, businessId);
  const cap = settings.get(input.channel)?.dailyCap ?? DAILY_OUTREACH_CEILING;
  const sent = await outreachSentToday(tx, businessId, input.channel, input.counting ?? 'sent');
  return {
    channel: input.channel,
    availableHere: CHANNEL_REGISTRY[input.channel].availableHere,
    enabled: settings.get(input.channel)?.enabled === true,
    satisfied: satisfiedRequirements(input.templateState, domain, input.now),
    consent: person.consent,
    suppression: person.suppression,
    ceilingReached: sent >= cap,
  };
}
