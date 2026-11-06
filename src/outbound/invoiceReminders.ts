import { sql } from 'kysely';
import { withTenantTx, lockConversation, type Db, type Tx } from '../db/client.js';
import type { BusinessId } from '../core/types/ids.js';
import { enqueueOutboundRow } from '../db/channels.js';
import { assistantHold } from '../db/assistantStop.js';
import { assistantNameOfConversation } from '../db/assistants.js';
import { zoneOf } from '../db/zone.js';
import { invoiceKey } from '../db/booksInvoices.js';
import { aiMaySpeak, ownershipOf } from '../core/conversation/ownership.js';
import { disclosureFor, withDisclosure } from '../core/conversation/disclosure.js';
import { channelSendPlan } from '../core/channel/window.js';
import { CHANNEL_REGISTRY, type ChannelCapability } from '../core/channel/registry.js';
import { invoiceReminderSubject, invoiceReminderText } from '../core/books/invoiceWords.js';

/**
 * 0226 — REMINDERS AT +3 AND +10 DAYS for an invoice that went from Nomi and is still open, by the channel it went on.
 *
 * Every hour the sweep asks the database which workspaces have one due (`invoice_reminder_workspaces()`: the switch
 * on, the invoice issued and owed, sent three or ten days ago, that reminder not yet made). For each, within the
 * workspace's own daytime (`REMINDER_HOURS`, so nobody is reminded at three in the morning), it decides per invoice:
 *
 *   SENT ALONE, in the assistant's voice, when every one of these holds — the assistant may speak in the conversation
 *   (nobody holds it), the customer writes in ENGLISH (the only language the sentence exists in: the owner, 2026-11-06),
 *   the channel can carry it now (e-mail: a mailbox this installation can send from; a windowed channel: inside its
 *   window — never a template, nothing is submitted to Meta), and the assistant has a confirmed name to say who writes
 *   (rule 3: the first message nobody approved carries the disclosure).
 *
 *   A DRAFT FOR THE OWNER otherwise: the same sentence waits on the conversation page as a `follow_up` draft, with the
 *   card saying why (`withheld.reason`: invoice_window, invoice_language, invoice_mailbox, invoice_held,
 *   invoice_unnamed). `expire_waiting_drafts` leaves these alone (0226): a closed window is the reason the draft
 *   exists, and the owner decides — send it when they write again, reach them another way, or skip it.
 *
 * Once each: `invoice_reminders (invoice_id, nth)` is unique, written before anything is queued. An invoice that
 * reaches day ten with no reminder yet gets the second alone — never two at once. While the assistant is stopped or
 * silenced nothing is decided; the sweep looks again next hour.
 *
 * The figures are the invoice's own (its key and what is owed, from rows the database checked), never a model's: the
 * sentence is fixed and asks no model, so the numeral guard — which reads what a model wrote — has nothing to check.
 */

export const REMINDER_HOURS: readonly [number, number] = [9, 17];
export const REMINDER_DAYS_1 = 3;
export const REMINDER_DAYS_2 = 10;

export type ReminderWithheld = 'invoice_window' | 'invoice_language' | 'invoice_mailbox' | 'invoice_held' | 'invoice_unnamed';

export type ReminderDeps = {
  readonly db: Db;
  readonly now: () => Date;
  /** The bare re-drive tick (boss.send(QUEUES.outbound, {businessId, conversationId})). */
  readonly kickDrive: (businessId: string, conversationId: string) => Promise<void>;
  /** Whether a mail from this business can leave: a connected mailbox, or the installation's SMTP. */
  readonly mailboxConnected: (tx: Tx, businessId: BusinessId) => Promise<boolean>;
  /** The owner is told a reply waits (G5's `draft_waiting`), after the draft is committed. */
  readonly notifyDraft?: (businessId: string, conversationId: string) => Promise<void>;
};

type Due = {
  invoice_id: string; year: number; number: number; currency: string; owed: string; nth: 1 | 2;
  conversation_id: string; channel: string; assigned_to: string | null; disclosed: boolean;
  last_inbound: Date | null; language: string | null; business: string;
};

const hourIn = (now: Date, zone: string): number => {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: zone }).format(now)) % 24;
  } catch {
    return now.getUTCHours();
  }
};

const windowed = (channel: string): boolean => {
  const cap = (CHANNEL_REGISTRY as Readonly<Record<string, ChannelCapability | undefined>>)[channel];
  return cap === undefined ? true : cap.replyWindowHours !== null;
};

/** What is due in one workspace right now: at most one reminder per invoice, the later one where both would be. */
export async function dueInvoiceReminders(tx: Tx, businessId: BusinessId, now: Date): Promise<readonly Due[]> {
  return (await sql<Due>`
    with latest as (
      select distinct on (s.invoice_id) s.invoice_id, s.conversation_id, s.sent_at
        from invoice_sends s where s.business_id = ${businessId}::uuid and s.conversation_id is not null
       order by s.invoice_id, s.sent_at desc
    ), due as (
      select i.id as invoice_id, i.year, i.number, i.currency,
             (invoice_total(i.id) - invoice_credited(i.id) - invoice_paid(i.id))::text as owed,
             l.conversation_id,
             case when l.sent_at <= ${now}::timestamptz - ${REMINDER_DAYS_2}::int * interval '1 day'
                       and not exists (select 1 from invoice_reminders r where r.invoice_id = i.id and r.nth = 2) then 2
                  when l.sent_at <= ${now}::timestamptz - ${REMINDER_DAYS_1}::int * interval '1 day'
                       and l.sent_at > ${now}::timestamptz - ${REMINDER_DAYS_2}::int * interval '1 day'
                       and not exists (select 1 from invoice_reminders r where r.invoice_id = i.id and r.nth = 1) then 1
             end as nth
        from invoices i join latest l on l.invoice_id = i.id
       where i.business_id = ${businessId}::uuid and i.state = 'issued'
         and invoice_total(i.id) - invoice_credited(i.id) - invoice_paid(i.id) > 0
    )
    select d.invoice_id::text as invoice_id, d.year, d.number, d.currency, d.owed, d.nth, d.conversation_id::text as conversation_id,
           c.channel, c.assigned_to, c.ai_disclosure_delivered_at is not null as disclosed,
           (select max(cc.last_inbound_at) from client_channels cc where cc.client_id = c.client_id and cc.channel = c.channel) as last_inbound,
           coalesce(cl.preferred_language,
             (select m.detected_language from messages m where m.conversation_id = c.id and m.direction = 'inbound'
               and m.detected_language is not null order by m.sent_at desc limit 1)) as language,
           b.name as business
      from due d
      join conversations c on c.id = d.conversation_id
      join clients cl on cl.id = c.client_id
      join businesses b on b.id = ${businessId}::uuid
     where d.nth is not null
     order by d.nth desc, d.invoice_id limit 50`.execute(tx)).rows;
}

/** The sentence as it would go, so the page can show it beside a draft. */
export const reminderBody = (d: Pick<Due, 'year' | 'number' | 'currency' | 'owed' | 'business'>): string =>
  invoiceReminderText({ key: invoiceKey(d.year, d.number), currency: d.currency, owed: d.owed, business: d.business });

export type ReminderSweep = { readonly sent: number; readonly drafted: number };

/** One workspace's due reminders, decided and written; the conversations whose send or draft needs a kick or a word. */
export async function remindInvoicesOf(deps: ReminderDeps, businessId: BusinessId): Promise<ReminderSweep & { kicks: string[]; drafts: string[] }> {
  const now = deps.now();
  const out = { sent: 0, drafted: 0, kicks: [] as string[], drafts: [] as string[] };
  await withTenantTx(deps.db, businessId, async (tx) => {
    // Stopped, silenced, out of allowance or lapsed: nothing is decided now; the hour after, it is asked again.
    if (await assistantHold(tx, businessId)) return;
    const hour = hourIn(now, await zoneOf(tx, businessId));
    if (hour < REMINDER_HOURS[0] || hour >= REMINDER_HOURS[1]) return;
    const mailbox = await deps.mailboxConnected(tx, businessId);
    for (const d of await dueInvoiceReminders(tx, businessId, now)) {
      const key = invoiceKey(d.year, d.number);
      const body = reminderBody(d);
      const langHead = (d.language ?? '').slice(0, 2).toLowerCase();
      let why: ReminderWithheld | null = null;
      let name: string | null = null;
      if (!aiMaySpeak(ownershipOf(d.assigned_to))) why = 'invoice_held';
      else if (langHead !== 'en') why = 'invoice_language';
      else if (d.channel === 'email' && !mailbox) why = 'invoice_mailbox';
      else if (d.channel !== 'email' && windowed(d.channel)
        && channelSendPlan(d.channel, d.last_inbound ? new Date(d.last_inbound) : null, now, 'none').action !== 'send_free') why = 'invoice_window';
      if (why === null && !d.disclosed) {
        name = await assistantNameOfConversation(tx, businessId, d.conversation_id);
        if (!name) why = 'invoice_unnamed';
      }
      // Written FIRST and once: a second sweep in the same hour finds the row and does nothing.
      const made = (await sql<{ id: string }>`
        insert into invoice_reminders (business_id, invoice_id, nth, conversation_id, sent_at, drafted_at)
        values (${businessId}::uuid, ${d.invoice_id}::uuid, ${d.nth}, ${d.conversation_id}::uuid,
                ${why === null ? now : null}, ${why === null ? null : now})
        on conflict (invoice_id, nth) do nothing returning id::text as id`.execute(tx)).rows[0];
      if (!made) continue;
      await lockConversation(tx, d.conversation_id);
      if (why === null) {
        // Sent without anyone pressing send: the first such message of a conversation says what is writing (rule 3).
        const text = d.disclosed ? body
          : withDisclosure(disclosureFor({ detected: 'en', name, business: d.business })!, body);
        const mail = d.channel === 'email' ? { subject: invoiceReminderSubject({ key, currency: d.currency, owed: d.owed, business: d.business }) } : null;
        const rowId = await enqueueOutboundRow(tx, businessId, d.conversation_id, text, 'employee', mail);
        if (rowId === null) {
          // No identity to send to: the reminder becomes the owner's, with the conversation's channel named.
          await sql`update invoice_reminders set sent_at = null, drafted_at = ${now} where id = ${made.id}::uuid`.execute(tx);
          await draft(tx, businessId, d, made.id, body, 'invoice_held', key, now);
          out.drafted += 1; out.drafts.push(d.conversation_id);
          continue;
        }
        await sql`update invoice_reminders set outbound_id = ${rowId}::uuid where id = ${made.id}::uuid`.execute(tx);
        out.sent += 1; out.kicks.push(d.conversation_id);
      } else {
        await draft(tx, businessId, d, made.id, body, why, key, now);
        out.drafted += 1; out.drafts.push(d.conversation_id);
      }
    }
  });
  return out;
}

async function draft(tx: Tx, businessId: BusinessId, d: Due, reminderId: string, body: string, why: ReminderWithheld, key: string, now: Date): Promise<void> {
  const draftId = (await sql<{ id: string }>`
    insert into drafts (business_id, conversation_id, capability, draft_text, status, created_at)
    values (${businessId}::uuid, ${d.conversation_id}::uuid, 'follow_up', ${body}, 'pending', ${now}) returning id::text as id`.execute(tx)).rows[0]!.id;
  // The card reads this back (inbox.ts `withheldOf`), as it reads every draft's reason.
  await sql`insert into conversation_events (business_id, conversation_id, type, payload)
    values (${businessId}::uuid, ${d.conversation_id}::uuid, 'draft_pending',
            ${JSON.stringify({ draftId, capability: 'follow_up', gate: 'en', invoiceReminder: { invoiceId: d.invoice_id, nth: d.nth }, withheld: { reason: why, key } })}::jsonb)`.execute(tx);
  await sql`update invoice_reminders set draft_id = ${draftId}::uuid where id = ${reminderId}::uuid`.execute(tx);
}

/** The hourly sweep over every workspace with a reminder due. */
export async function remindDueInvoices(deps: ReminderDeps): Promise<ReminderSweep> {
  const businesses = (await sql<{ id: string }>`select invoice_reminder_workspaces()::text as id`.execute(deps.db)).rows.map((r) => r.id);
  let sent = 0; let drafted = 0;
  for (const id of businesses) {
    const r = await remindInvoicesOf(deps, id as BusinessId);
    sent += r.sent; drafted += r.drafted;
    for (const cid of r.kicks) await deps.kickDrive(id, cid);
    for (const cid of r.drafts) await deps.notifyDraft?.(id, cid);
  }
  return { sent, drafted };
}
