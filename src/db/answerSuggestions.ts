import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { ANSWER_KINDS, type KnowledgeKind } from '../core/types/knowledge.js';
import { ANSWER_MAX, QUESTION_MAX, questionKey, suggestionsFrom, type AnswerSuggestion, type HumanAnswer } from '../core/owner/answerSuggestions.js';
import { REOPEN_LANGUAGES, renderReopen, reopenParam } from '../core/channel/reopen.js';
import { notOwnerTesting } from './handled.js';

/**
 * S5 (Phase 5, item 17; 0199) — ANSWERS PEOPLE GAVE, read from the replies already kept and offered to the owner.
 *
 * Two kinds of reply are a person's words, and only these are read:
 *   · a reply typed in a conversation a person held (`outbound_messages.origin = 'owner'`, sent), or written in the
 *     channel's own app (the echo), with the buyer's last message before it, after anything sent before it;
 *   · a draft a person rewrote before it went (`drafts.status = 'edited'`), with the buyer's words of that turn.
 * The assistant's own words, sent alone or approved as written, are never read. Nor is the reopening template, which
 * goes in a person's place when the window has shut (their words wait in the box), nor a conversation the owner
 * marked as their own test.
 *
 * A suggestion is left out when the owner already decided on that question, or when the assistant would already
 * answer it from what it was taught (the turn's own test: a taught answer this close).
 */
export const SUGGESTIONS_SHOWN = 12;
const DAYS = 90;
const READ = 500;

export const questionHash = (key: string): string => createHash('sha256').update(key, 'utf8').digest('hex');

async function humanAnswers(tx: Tx, businessId: BusinessId, now: Date): Promise<HumanAnswer[]> {
  const since = new Date(now.getTime() - DAYS * 86_400_000);
  const typed = (await sql<{ question: string | null; answer: string | null; at: Date }>`
    select m.text_content as answer, m.sent_at as at,
           (select q.text_content from messages q
             where q.conversation_id = m.conversation_id and q.direction = 'inbound' and coalesce(q.text_content, '') <> ''
               and q.sent_at <= m.sent_at
               and q.sent_at > coalesce((select max(p.sent_at) from messages p where p.conversation_id = m.conversation_id
                                          and p.direction = 'outbound' and p.sent_at < m.sent_at and p.id <> m.id), '-infinity'::timestamptz)
             order by q.sent_at desc limit 1) as question
      from messages m
      join conversations c on c.id = m.conversation_id and c.business_id = ${businessId}::uuid
      left join outbound_messages o on m.external_id = 'out:' || o.id::text
     where m.direction = 'outbound' and m.sent_at >= ${since} and coalesce(m.text_content, '') <> ''
       and (o.origin = 'owner' and o.kind = 'text' or o.id is null and m.external_id like 'echo:%')
       and ${notOwnerTesting('m.conversation_id')}
     order by m.sent_at desc limit ${READ}`.execute(tx)).rows;
  const rewritten = (await sql<{ question: string | null; answer: string | null; at: Date }>`
    select t.input->>'text' as question, d.sent_text as answer, d.decided_at as at
      from drafts d join turns t on t.message_id = d.turn_message_id
     where d.business_id = ${businessId}::uuid and d.status = 'edited' and d.decided_at >= ${since}
       and ${notOwnerTesting('d.conversation_id')}
     order by d.decided_at desc limit ${READ}`.execute(tx)).rows;
  const name = (await sql<{ name: string }>`select name from businesses where id = ${businessId}::uuid`.execute(tx)).rows[0]?.name ?? '';
  const reopening = new Set(Object.values(REOPEN_LANGUAGES).map((l) => renderReopen(l, reopenParam(name)).trim()));
  return [...typed, ...rewritten]
    .filter((r): r is { question: string; answer: string; at: Date } => !!r.question && !!r.answer && !reopening.has(r.answer.trim()))
    .map((r) => ({ question: r.question, answer: r.answer, at: new Date(r.at) }));
}

/** Would the assistant already answer this, word for word, from what it was taught? (The turn's own test.) */
async function alreadyTaught(tx: Tx, businessId: BusinessId, question: string, minRelevance: number): Promise<boolean> {
  const rows = (await sql<{ kind: string; relevance: number }>`
    select kind, relevance from retrieve_knowledge(${businessId}::uuid, ${question}, null, 6)`.execute(tx)).rows;
  return rows.some((r) => ANSWER_KINDS.has(r.kind as KnowledgeKind) && Number(r.relevance) >= minRelevance);
}

export async function answerSuggestions(tx: Tx, businessId: BusinessId, now: Date, minRelevance: number): Promise<readonly AnswerSuggestion[]> {
  const decided = new Set((await sql<{ h: string }>`select question_hash as h from answer_decisions
    where business_id = ${businessId}::uuid`.execute(tx)).rows.map((r) => r.h));
  const out: AnswerSuggestion[] = [];
  for (const s of suggestionsFrom(await humanAnswers(tx, businessId, now))) {
    if (out.length >= SUGGESTIONS_SHOWN) break;
    if (decided.has(questionHash(s.key))) continue;
    if (await alreadyTaught(tx, businessId, s.question, minRelevance)) continue;
    out.push(s);
  }
  return out;
}

export type AnswerDecision = 'taught' | 'dismissed' | 'already' | 'invalid';

/**
 * The owner makes it a taught answer, in the words they leave in the form (a business-wide FAQ, the owner's own),
 * and the question is decided for good — in one transaction.
 */
export async function teachSuggestion(tx: Tx, businessId: BusinessId, o: {
  readonly question: string; readonly label: string; readonly content: string; readonly actor: string;
}): Promise<AnswerDecision> {
  const key = questionKey(o.question.slice(0, QUESTION_MAX));
  const label = o.label.trim(), content = o.content.trim();
  if (key === null || !label || !content || label.length > QUESTION_MAX || content.length > ANSWER_MAX) return 'invalid';
  const hash = questionHash(key);
  if ((await sql`select 1 from answer_decisions where business_id = ${businessId}::uuid and question_hash = ${hash}`.execute(tx)).rows.length) return 'already';
  const k = (await sql<{ id: string }>`insert into product_knowledge (business_id, product_id, kind, label, content, source)
    values (${businessId}::uuid, null, 'faq', ${label}, ${content}, 'owner_confirmed') returning id::text as id`.execute(tx)).rows[0]!.id;
  await sql`insert into answer_decisions (business_id, question_hash, decision, knowledge_id, decided_by)
    values (${businessId}::uuid, ${hash}, 'taught', ${k}::uuid, ${o.actor})`.execute(tx);
  return 'taught';
}

/** Not an answer to keep: that question is never suggested again, whoever asks it. */
export async function dismissSuggestion(tx: Tx, businessId: BusinessId, question: string, actor: string): Promise<AnswerDecision> {
  const key = questionKey(question.slice(0, QUESTION_MAX));
  if (key === null) return 'invalid';
  const r = await sql`insert into answer_decisions (business_id, question_hash, decision, decided_by)
    values (${businessId}::uuid, ${questionHash(key)}, 'dismissed', ${actor}) on conflict (business_id, question_hash) do nothing`.execute(tx);
  return (r.numAffectedRows ?? 0n) > 0n ? 'dismissed' : 'already';
}
