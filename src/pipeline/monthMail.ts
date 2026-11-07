import { sql } from 'kysely';
import { withTenantTx, type Db } from '../db/client.js';
import { parseBusinessId, type BusinessId } from '../core/types/ids.js';
import type { OwnerMailer } from './notify.js';
import { refusedByCap } from '../core/ops/mailCap.js';
import { ownerLoginEmail } from '../db/backups.js';
import { mainAssistantName } from '../db/assistants.js';
import {
  claimMonthReports, loadMonthReport, monthReportDone, type MonthReportClaim, type MonthReportOutcome,
} from '../db/monthReport.js';
import { isEmptyMonth, monthMailOf, type MonthMail } from '../core/report/monthMail.js';
import type { MonthReport } from '../core/report/month.js';

/**
 * Block 4.3 — "WHAT NOMI DID FOR YOU", BY E-MAIL, once a month (the design spec §3).
 *
 * On the 1st at 08:00 in the workspace's zone (outside the owner's quiet hours, within the month's first week), each
 * workspace is CLAIMED once for the month just ended (`claim_month_reports`, 0231): a practice copy, a suspended or
 * switched-off workspace, one whose owner stopped the e-mail on the month page, and one begun after that month are
 * never claimed. The e-mail is built then, from the same report the page draws, and goes to the OWNER's sign-in
 * address only — never to a colleague: it carries the invoices — through the installation's owner-mail sender under
 * MAIL's daily `alert` cap (rule 70). What became of it is written on the claim: sent, an empty month (nothing to
 * say, nothing sent), no address, not sent (the cap, or stopped since the claim) or failed. A claim is never retried,
 * so nothing goes twice.
 *
 * OFF unless the operator sets MONTH_REPORT_MAIL=on (`monthMailOn`), and then only where the installation sends
 * owner mail and knows its own address (PUBLIC_BASE_URL): without them nothing is claimed.
 */
export const monthMailOn = (env: Record<string, string | undefined>): boolean => env['MONTH_REPORT_MAIL']?.trim() === 'on';

export type MonthMailDeps = {
  readonly db: Db;
  /** The owner-mail sender, capped (`alertMail` in main.ts); null where the installation sends no owner mail. */
  readonly mail: OwnerMailer | null;
  readonly publicBaseUrl: string | null;
};

/**
 * One month's e-mail for one workspace, as it would leave now: the report, the e-mail built from it, and the owner's
 * sign-in address (null when the owner has none). The job sends it; tools/month-report.mjs previews it.
 */
export async function monthMailFor(db: Db, businessId: BusinessId, month: string, now: Date, publicBaseUrl: string):
  Promise<{ readonly report: MonthReport; readonly mail: MonthMail; readonly to: string | null }> {
  const read = await withTenantTx(db, businessId, async (tx) => ({
    report: await loadMonthReport(tx, businessId, month, now),
    business: (await sql<{ name: string }>`select name from businesses where id = ${businessId}::uuid`.execute(tx)).rows[0]?.name ?? '',
    name: await mainAssistantName(tx, businessId),
    to: await ownerLoginEmail(tx, businessId),
  }));
  const url = `${publicBaseUrl.replace(/\/+$/, '')}/app/results/month?month=${month}`;
  return { report: read.report, mail: monthMailOf(read.report, { business: read.business, name: read.name, url }), to: read.to };
}

/** One claimed month's e-mail: built and sent, its outcome written on the claim. */
export async function sendMonthReport(deps: MonthMailDeps & { readonly mail: OwnerMailer; readonly publicBaseUrl: string },
  claim: MonthReportClaim, now: Date): Promise<MonthReportOutcome> {
  const bid = parseBusinessId(claim.businessId);
  const outcome = await (async (): Promise<MonthReportOutcome> => {
    if (!bid.ok) return 'failed';
    const { report, mail, to } = await monthMailFor(deps.db, bid.value, claim.month, now, deps.publicBaseUrl);
    if (report.mailOff) return 'not_sent';
    if (isEmptyMonth(report)) return 'empty';
    if (!to) return 'no_address';
    const sent = await deps.mail.send({ to, subject: mail.subject, text: mail.text }).catch(() => ({ ok: false as const, error: 'threw' }));
    if (sent.ok) return 'sent';
    if (refusedByCap(sent)) return 'not_sent';
    console.warn('[month-report] e-mail failed');
    return 'failed';
  })().catch((e: unknown) => { console.warn(`[month-report] could not be built: ${e instanceof Error ? e.name : 'error'}`); return 'failed' as const; });
  await monthReportDone(deps.db, claim.businessId, claim.month, outcome);
  return outcome;
}

/** The job: every month now due is claimed and sent, one after another. Nothing is claimed without a sender and an address. */
export async function monthReportsDue(deps: MonthMailDeps, now: Date): Promise<readonly (MonthReportClaim & { readonly outcome: MonthReportOutcome })[]> {
  const { mail, publicBaseUrl } = deps;
  if (!mail || !publicBaseUrl) return [];
  const out: (MonthReportClaim & { readonly outcome: MonthReportOutcome })[] = [];
  for (const claim of await claimMonthReports(deps.db, now)) {
    out.push({ ...claim, outcome: await sendMonthReport({ ...deps, mail, publicBaseUrl }, claim, now) });
  }
  return out;
}
