import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { CASES_MAX, type CaseRef, type CaseResult, type CheckKind } from '../core/owner/cases.js';
import { notOwnerTesting } from './handled.js';

/**
 * SAVED CASES AND THE CHECKS THAT RUN THEM (Block 3 PR 3; 0230). A case is never copied: it is read from the rows
 * that already hold it — a draft a person approved or rewrote (`drafts.sent_text`, the turn's own text as the
 * question) or a reply a person typed (an owner's outbound message, the customer's last message before it as the
 * question). A check (`case_checks`) keeps the staged change, the case REFERENCES and each re-run's reply and
 * comparison — never the customer's words, which are read again when the page is drawn and gone when they were erased.
 */
export type SavedCase = { readonly ref: CaseRef; readonly question: string; readonly accepted: string; readonly at: Date };

const recentCases = async (tx: Tx, businessId: BusinessId, limit: number): Promise<SavedCase[]> => {
  const drafts = (await sql<{ id: string; question: string | null; answer: string | null; at: Date }>`
    select d.id::text as id, t.input->>'text' as question, d.sent_text as answer, d.decided_at as at
      from drafts d join turns t on t.message_id = d.turn_message_id
     where d.business_id = ${businessId}::uuid and d.status in ('approved', 'edited') and d.sent_text is not null
       and ${notOwnerTesting('d.conversation_id')}
     order by d.decided_at desc limit ${limit}`.execute(tx)).rows;
  const typed = (await sql<{ id: string; question: string | null; answer: string | null; at: Date }>`
    select m.id::text as id, m.text_content as answer, m.sent_at as at,
           (select q.text_content from messages q
             where q.conversation_id = m.conversation_id and q.direction = 'inbound' and coalesce(q.text_content, '') <> ''
               and q.sent_at <= m.sent_at
               and q.sent_at > coalesce((select max(p.sent_at) from messages p where p.conversation_id = m.conversation_id
                                          and p.direction = 'outbound' and p.sent_at < m.sent_at and p.id <> m.id), '-infinity'::timestamptz)
             order by q.sent_at desc limit 1) as question
      from messages m
      join conversations c on c.id = m.conversation_id and c.business_id = ${businessId}::uuid
      left join outbound_messages o on m.external_id = 'out:' || o.id::text
     where m.direction = 'outbound' and coalesce(m.text_content, '') <> ''
       and (o.origin = 'owner' and o.kind = 'text' or o.id is null and m.external_id like 'echo:%')
       and ${notOwnerTesting('m.conversation_id')}
     order by m.sent_at desc limit ${limit}`.execute(tx)).rows;
  const rows: { ref: CaseRef; question: string | null; accepted: string | null; at: Date }[] = [
    ...drafts.map((r) => ({ ref: { kind: 'draft' as const, id: r.id }, question: r.question, accepted: r.answer, at: r.at })),
    ...typed.map((r) => ({ ref: { kind: 'message' as const, id: r.id }, question: r.question, accepted: r.answer, at: r.at })),
  ];
  return rows.flatMap((c) => (c.question && c.accepted ? [{ ref: c.ref, question: c.question, accepted: c.accepted, at: c.at }] : []))
    .sort((a, b) => +new Date(b.at) - +new Date(a.at));
};

/** Up to CASES_MAX: the cases whose words touch the change first, then the most recent others. Empty words: all recent. */
export async function casesFor(tx: Tx, businessId: BusinessId, words: readonly string[]): Promise<{ readonly cases: readonly SavedCase[]; readonly touching: number }> {
  const all = await recentCases(tx, businessId, 200);
  const touches = (c: SavedCase) => words.length > 0 && words.some((w) => `${c.question}\n${c.accepted}`.toLowerCase().includes(w));
  const first = all.filter(touches);
  const rest = all.filter((c) => !touches(c));
  const cases = [...first, ...rest].slice(0, CASES_MAX);
  return { cases, touching: Math.min(first.length, CASES_MAX) };
}

/** The customer's words behind a reference, read again now; null when erased. */
export async function caseTexts(tx: Tx, businessId: BusinessId, refs: readonly CaseRef[]): Promise<Map<string, { question: string; accepted: string } | null>> {
  const out = new Map<string, { question: string; accepted: string } | null>();
  const all = await recentCases(tx, businessId, 500);
  for (const r of refs) {
    const c = all.find((x) => x.ref.kind === r.kind && x.ref.id === r.id);
    out.set(`${r.kind}:${r.id}`, c ? { question: c.question, accepted: c.accepted } : null);
  }
  return out;
}

export type CheckStatus = 'running' | 'done' | 'kept' | 'reverted' | 'failed';
export type CaseCheck = {
  readonly id: string; readonly kind: CheckKind; readonly change: unknown; readonly summary: string; readonly status: CheckStatus;
  readonly refs: readonly CaseRef[]; readonly touching: number; readonly results: readonly CaseResult[]; readonly spentCalls: number;
  readonly stoppedByAllowance: boolean; readonly createdAt: Date; readonly finishedAt: Date | null; readonly decidedAt: Date | null;
};
type Row = { id: string; kind: CheckKind; change: unknown; summary: string; status: CheckStatus; refs: unknown; touching: number; results: unknown;
  spent_calls: number; stopped_by_allowance: boolean; created_at: Date; finished_at: Date | null; decided_at: Date | null };
const toCheck = (r: Row): CaseCheck => ({
  id: r.id, kind: r.kind, change: r.change, summary: r.summary, status: r.status,
  refs: Array.isArray(r.refs) ? (r.refs as CaseRef[]) : [], touching: r.touching,
  results: Array.isArray(r.results) ? (r.results as CaseResult[]) : [], spentCalls: r.spent_calls, stoppedByAllowance: r.stopped_by_allowance,
  createdAt: r.created_at, finishedAt: r.finished_at, decidedAt: r.decided_at,
});
const COLS = sql`id::text as id, kind, change, summary, status, refs, touching, results, spent_calls, stopped_by_allowance, created_at, finished_at, decided_at`;

export async function startCheck(tx: Tx, businessId: BusinessId, by: string, kind: CheckKind, change: unknown, summary: string,
  cases: readonly SavedCase[], touching: number): Promise<string> {
  const r = await sql<{ id: string }>`insert into case_checks (business_id, kind, change, summary, refs, touching, created_by)
    values (${businessId}::uuid, ${kind}, ${JSON.stringify(change)}::jsonb, ${summary.slice(0, 200)}, ${JSON.stringify(cases.map((c) => c.ref))}::jsonb, ${touching}, ${by})
    returning id::text as id`.execute(tx);
  return r.rows[0]!.id;
}
export async function checkById(tx: Tx, businessId: BusinessId, id: string): Promise<CaseCheck | null> {
  const r = (await sql<Row>`select ${COLS} from case_checks where business_id = ${businessId}::uuid and id = ${id}::uuid`.execute(tx)).rows[0];
  return r ? toCheck(r) : null;
}
export async function listChecks(tx: Tx, businessId: BusinessId, limit = 30): Promise<readonly CaseCheck[]> {
  return (await sql<Row>`select ${COLS} from case_checks where business_id = ${businessId}::uuid order by created_at desc limit ${limit}`.execute(tx)).rows.map(toCheck);
}
export async function finishCheck(tx: Tx, businessId: BusinessId, id: string, results: readonly CaseResult[], spentCalls: number, stoppedByAllowance: boolean, status: 'done' | 'failed'): Promise<void> {
  await sql`update case_checks set status = ${status}, results = ${JSON.stringify(results)}::jsonb, spent_calls = ${spentCalls}, stopped_by_allowance = ${stoppedByAllowance}, finished_at = now()
    where business_id = ${businessId}::uuid and id = ${id}::uuid and status = 'running'`.execute(tx);
}
/** The owner's decision, once: the row is locked, and only a check that is done can be decided. */
export async function decideCheck(tx: Tx, businessId: BusinessId, id: string, by: string, decision: 'kept' | 'reverted'): Promise<CaseCheck | 'not_done' | 'gone'> {
  const r = (await sql<Row>`select ${COLS} from case_checks where business_id = ${businessId}::uuid and id = ${id}::uuid for update`.execute(tx)).rows[0];
  if (!r) return 'gone';
  if (r.status === 'running') return 'not_done';
  if (r.status !== 'done') return 'gone';
  await sql`update case_checks set status = ${decision}, decided_at = now(), decided_by = ${by} where id = ${id}::uuid`.execute(tx);
  return toCheck(r);
}
