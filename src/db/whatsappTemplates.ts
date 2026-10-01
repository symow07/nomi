import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import {
  REOPEN_TEMPLATE, pickReopenLanguage, renderReopen, reopenParam, type ReopenLanguage,
} from '../core/channel/reopen.js';

/**
 * WA-S (0120) — the reopening template's languages for a business, as Meta
 * last answered. A store: Meta decides the status, this keeps it; the
 * outbound worker reads only `reopenFor`.
 */
export type TemplateRow = {
  readonly language: string; readonly status: string; readonly reason: string | null;
  readonly submittedAt: Date; readonly checkedAt: Date | null;
};

export async function listReopenTemplates(tx: Tx, businessId: BusinessId, wabaId: string): Promise<TemplateRow[]> {
  return (await sql<{ language: string; status: string; reason: string | null; submitted_at: Date; checked_at: Date | null }>`
    select language, status, reason, submitted_at, checked_at from whatsapp_templates
     where business_id = ${businessId}::uuid and waba_id = ${wabaId} and name = ${REOPEN_TEMPLATE} and archived_at is null
     order by language`.execute(tx)).rows
    .map((r) => ({ language: r.language, status: r.status, reason: r.reason, submittedAt: r.submitted_at, checkedAt: r.checked_at }));
}

/** A language asked of Meta: the row it answered, replacing any earlier one for the same language. */
export async function recordSubmitted(
  tx: Tx, businessId: BusinessId,
  input: { readonly wabaId: string; readonly language: string; readonly status: string; readonly id: string | null; readonly reason: string | null; readonly by: string },
): Promise<void> {
  await sql`update whatsapp_templates set archived_at = now()
             where business_id = ${businessId}::uuid and name = ${REOPEN_TEMPLATE} and language = ${input.language} and archived_at is null`.execute(tx);
  await sql`insert into whatsapp_templates (business_id, waba_id, name, language, status, meta_template_id, reason, submitted_by, checked_at)
            values (${businessId}::uuid, ${input.wabaId}, ${REOPEN_TEMPLATE}, ${input.language}, ${input.status},
                    ${input.id && /^[0-9]{1,40}$/.test(input.id) ? input.id : null}, ${input.reason}, ${input.by.slice(0, 120)}, now())`.execute(tx);
}

/** What Meta says now, language by language; a language Meta holds that we never asked for is recorded too. */
export async function recordStatuses(
  tx: Tx, businessId: BusinessId, wabaId: string,
  statuses: readonly { readonly language: string; readonly status: string; readonly id: string | null; readonly reason: string | null }[],
): Promise<void> {
  for (const s of statuses) {
    if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(s.language)) continue;
    const id = s.id && /^[0-9]{1,40}$/.test(s.id) ? s.id : null;
    const updated = await sql`
      update whatsapp_templates set status = ${s.status}, meta_template_id = coalesce(${id}, meta_template_id),
             reason = ${s.reason}, checked_at = now()
       where business_id = ${businessId}::uuid and waba_id = ${wabaId} and name = ${REOPEN_TEMPLATE}
         and language = ${s.language} and archived_at is null`.execute(tx);
    if (Number(updated.numAffectedRows ?? 0) === 0) {
      await sql`insert into whatsapp_templates (business_id, waba_id, name, language, status, meta_template_id, reason, submitted_by, checked_at)
                values (${businessId}::uuid, ${wabaId}, ${REOPEN_TEMPLATE}, ${s.language}, ${s.status}, ${id}, ${s.reason}, 'meta', now())`.execute(tx);
    }
  }
}

export type Reopen = {
  readonly name: string; readonly language: ReopenLanguage; readonly params: readonly string[];
  /** The template as the customer reads it: what the transcript shows was sent. */
  readonly text: string;
};

/**
 * The template that reopens THIS customer's window, for a business whose own
 * number is live: an APPROVED language of the reopening template on that
 * number's account, the customer's own when it is approved. Null otherwise —
 * and then a closed window stays closed.
 */
export async function reopenFor(tx: Tx, businessId: BusinessId, customerLanguage: string | null): Promise<Reopen | null> {
  const row = (await sql<{ name: string; default_language: string | null; langs: string[] | null }>`
    select b.name, b.default_language,
           (select array_agg(t.language) from whatsapp_templates t
             where t.business_id = b.id and t.waba_id = a.waba_id and t.name = ${REOPEN_TEMPLATE}
               and t.status = 'APPROVED' and t.archived_at is null) as langs
      from businesses b
      join whatsapp_accounts a on a.business_id = b.id and a.archived_at is null and a.last_error is null
     where b.id = ${businessId}::uuid`.execute(tx)).rows[0];
  if (!row?.langs?.length) return null;
  const language = pickReopenLanguage(row.langs, customerLanguage, row.default_language);
  if (!language) return null;
  const param = reopenParam(row.name);
  return { name: REOPEN_TEMPLATE, language, params: [param], text: renderReopen(language, param) };
}
