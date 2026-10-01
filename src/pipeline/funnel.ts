import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import { parseBusinessId } from '../core/types/ids.js';
import { checklistFor, checklistKind, type ChecklistItem } from '../db/practiceChecklist.js';

/**
 * G9 — THE COHORT'S FUNNEL, read from what is already on record
 * (`funnel_workspaces()`, 0104): for each workspace that signed itself up,
 * when it reached each step — imported, confirmed a list, completed the
 * Practice checklist for its kind, named the assistant, connected a channel,
 * heard from a first customer, sent a first reply — and how its drafts went.
 * `exitMeasures` turns that into the plan's exit criteria (decision 33) that
 * rows can answer; incidents and Meta's strikes are the operator's to count.
 * Read by `tools/workspaces.mjs --funnel` and the daily list.
 */
export type FunnelRow = {
  readonly businessId: string; readonly name: string; readonly kind: string | null; readonly signedUpAt: Date;
  readonly firstImportAt: Date | null; readonly firstImportConfirmedAt: Date | null;
  readonly checksSeen: number; readonly checksTotal: number; readonly checklistCompleteAt: Date | null;
  readonly namedAt: Date | null; readonly connectedAt: Date | null;
  readonly firstCustomerAt: Date | null; readonly firstReplyAt: Date | null;
  readonly draftsDecided: number; readonly draftsExpired: number; readonly medianDecisionSeconds: number | null;
  readonly operatorBeforeFirstReply: boolean;
};

export async function loadFunnel(db: Db): Promise<FunnelRow[]> {
  const rows = (await sql<{
    business_id: string; name: string; kind: string | null; signed_up_at: Date;
    first_import_at: Date | null; first_import_confirmed_at: Date | null; checks: Record<string, string>;
    named_at: Date | null; connected_at: Date | null; first_customer_at: Date | null; first_reply_at: Date | null;
    drafts_decided: number; drafts_expired: number; median_decision_seconds: number | null; operator_before_first_reply: boolean;
  }>`select * from funnel_workspaces()`.execute(db)).rows;
  const out: FunnelRow[] = [];
  for (const r of rows) {
    const bid = parseBusinessId(r.business_id);
    const required: readonly ChecklistItem[] = bid.ok ? checklistFor(await checklistKind(db, bid.value)) : [];
    const seen = required.map((i) => r.checks[i]).filter((x): x is string => typeof x === 'string').map((x) => new Date(x));
    out.push({
      businessId: r.business_id, name: r.name, kind: r.kind, signedUpAt: r.signed_up_at,
      firstImportAt: r.first_import_at, firstImportConfirmedAt: r.first_import_confirmed_at,
      checksSeen: seen.length, checksTotal: required.length,
      checklistCompleteAt: required.length > 0 && seen.length === required.length ? new Date(Math.max(...seen.map((d) => d.getTime()))) : null,
      namedAt: r.named_at, connectedAt: r.connected_at, firstCustomerAt: r.first_customer_at, firstReplyAt: r.first_reply_at,
      draftsDecided: Number(r.drafts_decided), draftsExpired: Number(r.drafts_expired),
      medianDecisionSeconds: r.median_decision_seconds === null ? null : Number(r.median_decision_seconds),
      operatorBeforeFirstReply: r.operator_before_first_reply === true,
    });
  }
  return out;
}

const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const DAY = 86_400_000;

export type ExitMeasures = {
  /** A first real reply within 7 days of being able to connect (pass: at least 12 of 20). Counted once the 7 days are over, or it replied. */
  readonly firstReplyIn7Days: { readonly pass: number; readonly of: number };
  /** Median minutes from sign-up to a complete Practice checklist (pass: under 60). */
  readonly signupToChecklistMinutes: number | null;
  /** The median of each workspace's median minutes from a draft to the owner's decision (pass: under 2 hours) — clock time, not business hours. */
  readonly decisionMinutes: number | null;
  /** Drafts that expired in the 24-hour window, of all drafts decided or expired (pass: under 20%). */
  readonly expired: { readonly expired: number; readonly of: number };
  /** A first reply with no operator action before it (pass: at least 15 of 20). */
  readonly firstReplyWithoutOperator: { readonly pass: number; readonly of: number };
};

/**
 * Decision 33's measures that rows can answer. "Able to connect" is the later
 * of the sign-up and the day Meta approved Nomi (`openFrom`, CH4's
 * META_APP_REVIEW date; before it, the sign-up).
 */
export function exitMeasures(rows: readonly FunnelRow[], now: Date, openFrom: Date | null): ExitMeasures {
  let pass7 = 0; let of7 = 0;
  for (const r of rows) {
    const able = openFrom && openFrom > r.signedUpAt ? openFrom : r.signedUpAt;
    const within = r.firstReplyAt !== null && r.firstReplyAt.getTime() - able.getTime() <= 7 * DAY;
    if (within) { pass7++; of7++; } else if (now.getTime() - able.getTime() > 7 * DAY) of7++;
  }
  const checklist = rows.filter((r) => r.checklistCompleteAt).map((r) => (r.checklistCompleteAt!.getTime() - r.signedUpAt.getTime()) / 60_000);
  const decisions = rows.map((r) => r.medianDecisionSeconds).filter((x): x is number => x !== null).map((s) => s / 60);
  const expired = rows.reduce((n, r) => n + r.draftsExpired, 0);
  const decided = rows.reduce((n, r) => n + r.draftsDecided, 0);
  const replied = rows.filter((r) => r.firstReplyAt !== null);
  return {
    firstReplyIn7Days: { pass: pass7, of: of7 },
    signupToChecklistMinutes: median(checklist),
    decisionMinutes: median(decisions),
    expired: { expired, of: expired + decided },
    firstReplyWithoutOperator: { pass: replied.filter((r) => !r.operatorBeforeFirstReply).length, of: replied.length },
  };
}

/** Sign-up forms sent since `since`, and how many came back with their code. Counts only. */
export async function signupForms(db: Db, since: Date): Promise<{ readonly forms: number; readonly codesUsed: number }> {
  const r = (await sql<{ forms: number; codes_used: number }>`select forms, codes_used from signup_forms_since(${since})`.execute(db)).rows[0];
  return { forms: Number(r?.forms ?? 0), codesUsed: Number(r?.codes_used ?? 0) };
}
