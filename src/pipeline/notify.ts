import { sql } from 'kysely';
import { withTenantTx, type Db } from '../db/client.js';
import { parseBusinessId } from '../core/types/ids.js';
import { type Locale, parseLocale } from '../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../core/owner/i18n/messages.js';
import type { NotifyJob } from '../queue/boss.js';
import type { SendResult } from '../channels/contract.js';
import { assistantNameOfConversation, mainAssistantName } from '../db/assistants.js';

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
export function renderOwnerAlert(locale: Locale, kind: AlertKind, name: string | null = null): string {
  const key = (kind === 'delivery_failed' ? 'dead_letter' : kind);
  // A5.2 — the assistant this alert is about, when the business has named one.
  return t(locale, `notify.${key}` as MessageKey, { name: name ?? EMPLOYEE_NAME[locale] });
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
};

/**
 * Deliver one owner alert through the EXISTING adapter send path. Returns an
 * outcome; throws only on a RETRYABLE provider failure so pg-boss retries (a
 * permanent failure is swallowed to avoid a dead-letter loop). No owner phone =
 * honestly skipped, never a fake send.
 */
export async function deliverOwnerAlert(deps: NotifyDeps, job: NotifyJob): Promise<AlertOutcome> {
  const bid = parseBusinessId(job.businessId);
  if (!bid.ok) return 'skipped_no_destination';

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
