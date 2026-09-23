import { sql } from 'kysely';
import { withTenantTx, type Db } from '../db/client.js';
import { parseBusinessId } from '../core/types/ids.js';
import { type Locale, parseLocale } from '../core/owner/i18n/locale.js';
import { t, type MessageKey } from '../core/owner/i18n/messages.js';
import type { NotifyJob } from '../queue/boss.js';
import type { SendResult } from '../channels/contract.js';
import { assistantNameOfConversation, mainAssistantName } from '../db/assistants.js';
import { ownerLoginEmail, channelIsLive } from '../db/backups.js';
import { formatDate } from '../core/owner/i18n/format.js';
import type { BusinessId } from '../core/types/ids.js';

/**
 * The installation's own sender, as this module needs it — the shape of
 * `SystemMail` (src/channels/email/systemMail.ts), declared here rather than
 * imported, so the conversation path does not reach into the mail transport
 * modules even by a type (tests/parity/c5-prospects.test.ts walks imports).
 */
export type OwnerMailer = {
  send(message: { readonly to: string; readonly subject: string; readonly text: string }): Promise<{ ok: true } | { ok: false; error: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * P3 — Owner WhatsApp alerts. The QUEUES.notify consumer: a NotifyJob carries a
 * language-NEUTRAL `kind` (the event code); this resolves the business's persisted
 * owner locale + destination and renders the owner-facing text via the existing
 * t() catalog. No translated strings live in the pipeline or the job — only codes.
 */

export type AlertKind = NotifyJob['kind'];
export type AlertOutcome = 'sent' | 'skipped_no_destination' | 'failed_permanent';

/** Event → neutral alert code (business logic stays locale-free). */
export function alertKindFor(effects: { readonly hotLeadAlert: boolean; readonly handoffAlert: boolean }): AlertKind | null {
  if (effects.handoffAlert) return 'handoff';
  if (effects.hotLeadAlert) return 'hot_lead';
  return null;
}

/** Pure: localized owner-facing alert text. delivery_failed reuses dead_letter. */
export function renderOwnerAlert(
  locale: Locale, kind: AlertKind, name: string | null = null,
  detail: { readonly lastBackupAt?: Date | null } = {},
): string {
  // The backup alert says WHEN the last good copy is from, or that there has
  // never been one — the two are different news, so they are two sentences.
  if (kind === 'backup_stale') {
    return detail.lastBackupAt
      ? t(locale, 'notify.backup_stale', { when: formatDate(locale, detail.lastBackupAt) })
      : t(locale, 'notify.backup_stale.never');
  }
  const key = (kind === 'delivery_failed' ? 'dead_letter' : kind);
  // A5.2 — the assistant this alert is about, when the owner has named one;
  // otherwise the catalogue says "your assistant".
  return t(locale, `notify.${key}` as MessageKey, name ? { name } : undefined);
}

/** Owner alert destination input: '' clears it; a valid E.164-ish number, else invalid. */
export function validateOwnerPhone(raw: string): { ok: true; value: string | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };            // clear
  const cleaned = trimmed.replace(/[\s().\-]/g, '');
  return /^\+\d{8,15}$/.test(cleaned) ? { ok: true, value: cleaned } : { ok: false };
}

export type NotifyDeps = {
  readonly db: Db;
  readonly adapter: { sendText(to: string, body: string): Promise<SendResult> };
  /** The installation's own sender (A3). Null: no e-mail leaves this installation. */
  readonly mail?: OwnerMailer | null;
};

/**
 * Deliver one owner alert through the EXISTING adapter send path. Returns an
 * outcome; throws only on a RETRYABLE provider failure so pg-boss retries (a
 * permanent failure is swallowed to avoid a dead-letter loop). No owner phone =
 * honestly skipped, never a fake send.
 *
 * `backup_stale` is the exception, on purpose: it is the one alert that must
 * not depend on WhatsApp, because the channel it would travel on is itself
 * something that can be down, unverified, or never connected — and the
 * message says the data has no safe copy. It goes by E-MAIL to the address
 * the owner signs in with, always; and by WhatsApp as well when a channel is
 * live and a number is set. See `deliverBackupAlert`.
 */
export async function deliverOwnerAlert(deps: NotifyDeps, job: NotifyJob): Promise<AlertOutcome> {
  const bid = parseBusinessId(job.businessId);
  if (!bid.ok) return 'skipped_no_destination';
  if (job.kind === 'backup_stale') return deliverBackupAlert(deps, bid.value, job);

  const found = await withTenantTx(deps.db, bid.value, async (tx) => {
    const row = (await sql<{ owner_locale: string; owner_phone: string | null }>`
      select owner_locale, owner_phone from businesses where id = ${bid.value}`.execute(tx)).rows[0] ?? null;
    // Looked up only when there is somewhere to send it.
    const name = row?.owner_phone
      ? (job.conversationId && UUID.test(job.conversationId)
          ? await assistantNameOfConversation(tx, bid.value, job.conversationId)
          : await mainAssistantName(tx, bid.value))
      : null;
    return { row, name };
  });
  const dest = found.row;

  if (!dest || !dest.owner_phone) return 'skipped_no_destination';

  const locale: Locale = parseLocale(dest.owner_locale) ?? 'en';
  const body = renderOwnerAlert(locale, job.kind, found.name);
  const res = await deps.adapter.sendText(dest.owner_phone, body);
  if (res.ok) return 'sent';
  if (res.retryable) throw new Error(`owner alert send failed (retryable): ${res.error}`);
  return 'failed_permanent';
}

/**
 * The backup alert: e-mail first, WhatsApp too where it can actually arrive.
 *
 * Outcome is `sent` when at least one way delivered; `failed_permanent` when
 * every way that existed failed; `skipped_no_destination` when there was no
 * way at all (no login e-mail, no sender, and no live number) — which the log
 * line makes visible, since an alert about missing backups that has nowhere
 * to go is itself something the operator needs to know.
 */
async function deliverBackupAlert(deps: NotifyDeps, bid: BusinessId, job: NotifyJob): Promise<AlertOutcome> {
  const found = await withTenantTx(deps.db, bid, async (tx) => {
    const row = (await sql<{ owner_locale: string; owner_phone: string | null }>`
      select owner_locale, owner_phone from businesses where id = ${bid}`.execute(tx)).rows[0] ?? null;
    return {
      row,
      email: await ownerLoginEmail(tx, bid),
      live: row?.owner_phone ? await channelIsLive(tx, bid) : false,
    };
  });
  if (!found.row) return 'skipped_no_destination';
  const locale: Locale = parseLocale(found.row.owner_locale) ?? 'en';
  const lastBackupAt = job.lastBackupAt ? new Date(job.lastBackupAt) : null;
  const body = renderOwnerAlert(locale, 'backup_stale', null, { lastBackupAt });

  let tried = 0; let sent = 0;
  if (deps.mail && found.email) {
    tried++;
    const r = await deps.mail.send({ to: found.email, subject: t(locale, 'notify.backup_stale.subject'), text: body });
    if (r.ok) sent++; else console.warn(`[notify] backup alert e-mail failed: ${r.error}`);
  }
  if (found.live && found.row.owner_phone) {
    tried++;
    const r = await deps.adapter.sendText(found.row.owner_phone, body);
    if (r.ok) sent++;
    else if (r.retryable && sent === 0) throw new Error(`owner alert send failed (retryable): ${r.error}`);
  }
  if (tried === 0) { console.warn('[notify] backup alert has nowhere to go: no login e-mail or sender, and no live number'); return 'skipped_no_destination'; }
  return sent > 0 ? 'sent' : 'failed_permanent';
}
