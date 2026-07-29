import { sql } from 'kysely';
import { withTenantTx, type Db } from '../db/client.js';
import { parseBusinessId } from '../core/types/ids.js';
import { type Locale, parseLocale } from '../core/owner/i18n/locale.js';
import { t, EMPLOYEE_NAME, type MessageKey } from '../core/owner/i18n/messages.js';
import type { NotifyJob } from '../queue/boss.js';
import type { SendResult } from '../channels/contract.js';

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
export function renderOwnerAlert(locale: Locale, kind: AlertKind): string {
  const key = (kind === 'delivery_failed' ? 'dead_letter' : kind);
  return t(locale, `notify.${key}` as MessageKey, { name: EMPLOYEE_NAME[locale] });
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

  const dest = await withTenantTx(deps.db, bid.value, async (tx) =>
    (await sql<{ owner_locale: string; owner_phone: string | null }>`
      select owner_locale, owner_phone from businesses where id = ${bid.value}`.execute(tx)).rows[0] ?? null);

  if (!dest || !dest.owner_phone) return 'skipped_no_destination';

  const locale: Locale = parseLocale(dest.owner_locale) ?? 'en';
  const body = renderOwnerAlert(locale, job.kind);
  const res = await deps.adapter.sendText(dest.owner_phone, body);
  if (res.ok) return 'sent';
  if (res.retryable) throw new Error(`owner alert send failed (retryable): ${res.error}`);
  return 'failed_permanent';
}
