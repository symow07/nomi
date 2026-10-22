import { sql } from 'kysely';
import type { Db, Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { SURVEY_ANSWER_MS, SURVEY_DELAY_MS, SURVEY_SIGNED, freeToAsk, surveyFor, surveyScore, type SurveySigned } from '../core/conversation/survey.js';
import { disclosureFor, withDisclosure } from '../core/conversation/disclosure.js';
import { assistantNameOfConversation } from './assistants.js';
import { assistantHold } from './assistantStop.js';
import { enqueueOutboundRow } from './channels.js';
import { aiMaySpeak, ownershipOf } from '../core/conversation/ownership.js';

/**
 * S6 (Phase 5, item 20; 0202) — HOW DID WE DO? asked, sent and answered.
 *
 *   · `noteSurveyDue`, in the transaction that confirms the order: with surveys on, one question is due ten minutes
 *     later (one per conversation).
 *   · `sendDueSurveys`, the minute's sweep: each one due is asked — written as the assistant's automated message, so
 *     the send gate holds it as it holds a follow-up (stopped, silenced, opted out, a language without a signed
 *     disclosure, a shut window: never as a template) — or set aside with the reason: surveys switched off since, a
 *     person holds the conversation, not a chat channel, not free any more, no signed sentence in the buyer's
 *     language, no assistant's name for the disclosure it would need.
 *   · `recordSurveyAnswer`, before any turn: a message that is ONLY a score, from a buyer asked in the last 24 hours,
 *     is their answer — kept, and answered by nobody. Anything else is an ordinary message.
 */
export async function noteSurveyDue(tx: Tx, businessId: BusinessId, conversationId: string, now: Date): Promise<boolean> {
  const r = await sql`insert into survey_asks (business_id, client_id, conversation_id, due_at)
    select c.business_id, c.client_id, c.id, ${new Date(now.getTime() + SURVEY_DELAY_MS)}
      from conversations c join businesses b on b.id = c.business_id
     where c.business_id = ${businessId}::uuid and c.id = ${conversationId}::uuid and b.surveys_on
    on conflict (conversation_id) do nothing`.execute(tx);
  return (r.numAffectedRows ?? 0n) > 0n;
}

/** The workspaces with a survey due now (across workspaces: ids only). */
export async function surveyBusinessesDue(db: Db): Promise<readonly string[]> {
  return (await sql<{ id: string }>`select id::text as id from survey_businesses_due() as id`.execute(db)).rows.map((r) => r.id);
}

type Due = {
  id: string; conversation_id: string; on: boolean; assigned_to: string | null; channel: string;
  last_inbound: Date | null; language: string | null; business: string; disclosed: boolean;
};

/** Each survey due, asked or set aside. Returns the conversations whose question was queued, for the send kick. */
export async function sendDueSurveys(tx: Tx, businessId: BusinessId, now: Date, signed: SurveySigned = SURVEY_SIGNED): Promise<readonly string[]> {
  // Stopped or silenced, the assistant asks nothing: the question waits (and lapses if the window does).
  const hold = await assistantHold(tx, businessId);
  if (hold === 'stopped' || hold === 'silenced') return [];
  const due = (await sql<Due>`
    select s.id::text as id, s.conversation_id::text as conversation_id, b.surveys_on as on, c.assigned_to, c.channel,
           -- the window the send gate reads: when the buyer last wrote on this channel
           (select max(cc.last_inbound_at) from client_channels cc where cc.client_id = c.client_id and cc.channel = c.channel) as last_inbound,
           coalesce(cl.preferred_language,
             (select m.detected_language from messages m where m.conversation_id = c.id and m.direction = 'inbound'
               and m.detected_language is not null order by m.sent_at desc limit 1)) as language,
           b.name as business, c.ai_disclosure_delivered_at is not null as disclosed
      from survey_asks s
      join conversations c on c.id = s.conversation_id
      join clients cl on cl.id = s.client_id
      join businesses b on b.id = s.business_id
     where s.business_id = ${businessId}::uuid and s.state = 'due' and s.due_at <= ${now}
     order by s.due_at limit 20
       for update of s skip locked`.execute(tx)).rows;
  const queued: string[] = [];
  const skip = (id: string, why: string) => sql`update survey_asks set state = 'skipped', skipped_why = ${why} where id = ${id}::uuid`.execute(tx);
  for (const d of due) {
    if (!d.on) { await skip(d.id, 'off'); continue; }
    if (!aiMaySpeak(ownershipOf(d.assigned_to))) { await skip(d.id, 'held'); continue; }
    if (!['whatsapp', 'instagram', 'messenger'].includes(d.channel)) { await skip(d.id, 'channel'); continue; }
    if (!freeToAsk(d.channel, d.last_inbound ? new Date(d.last_inbound) : null, now)) { await skip(d.id, 'not_free'); continue; }
    const question = surveyFor(d.language, d.business, signed);
    if (!question) { await skip(d.id, 'unsigned'); continue; }
    // Sent without anyone pressing send: the first such message of a conversation says what is writing (rule 3).
    let body = question.text;
    if (!d.disclosed) {
      const disclosure = disclosureFor({ detected: question.locale, name: await assistantNameOfConversation(tx, businessId, d.conversation_id), business: d.business });
      if (!disclosure) { await skip(d.id, 'no_name'); continue; }
      body = withDisclosure(disclosure, body);
    }
    const row = await enqueueOutboundRow(tx, businessId, d.conversation_id, body, 'employee');
    if (row === null) { await skip(d.id, 'channel'); continue; }
    await sql`update survey_asks set state = 'sent', outbound_id = ${row}::uuid, asked_at = ${now}, language = ${question.locale}
      where id = ${d.id}::uuid`.execute(tx);
    queued.push(d.conversation_id);
  }
  return queued;
}

/**
 * Is this buyer's message their answer to a survey? Kept if so: the language the question was asked in, and the
 * business's name, for the thank-you (sent only where its sentence is signed); null when it is no answer.
 */
export async function recordSurveyAnswer(tx: Tx, businessId: BusinessId, conversationId: string, o: {
  readonly text: string; readonly messageId: string | null; readonly now: Date;
}): Promise<{ readonly language: string | null; readonly business: string } | null> {
  const score = surveyScore(o.text);
  if (score === null) return null;
  const r = await sql<{ language: string | null; business: string }>`update survey_asks s set state = 'answered', score = ${score}, answer_text = ${o.text.trim().slice(0, 500)},
      answered_at = ${o.now}, answer_message_id = ${o.messageId}
    where s.id = (select a.id from survey_asks a join conversations c on c.client_id = a.client_id
                   where c.id = ${conversationId}::uuid and a.business_id = ${businessId}::uuid and a.state = 'sent'
                     and a.asked_at > ${new Date(o.now.getTime() - SURVEY_ANSWER_MS)}
                   order by a.asked_at desc limit 1)
    returning s.language, (select b.name from businesses b where b.id = s.business_id) as business`.execute(tx);
  return r.rows[0] ?? null;
}

export type SurveyFacts = { readonly on: boolean; readonly business: string; readonly asked: number; readonly answered: number; readonly average: number | null };

/** For My business: the switch, and the last 90 days of it. */
export async function surveyFacts(tx: Tx, businessId: BusinessId, now: Date): Promise<SurveyFacts> {
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const r = (await sql<{ on: boolean; business: string; asked: number; answered: number; average: string | null }>`
    select b.surveys_on as on, b.name as business,
           (select count(*)::int from survey_asks s where s.business_id = b.id and s.state in ('sent', 'answered') and s.asked_at >= ${since}) as asked,
           (select count(*)::int from survey_asks s where s.business_id = b.id and s.state = 'answered' and s.asked_at >= ${since}) as answered,
           (select round(avg(s.score), 1)::text from survey_asks s where s.business_id = b.id and s.state = 'answered' and s.asked_at >= ${since}) as average
      from businesses b where b.id = ${businessId}::uuid`.execute(tx)).rows[0];
  return { on: r?.on === true, business: r?.business ?? '', asked: r?.asked ?? 0, answered: r?.answered ?? 0, average: r?.average === null || r?.average === undefined ? null : Number(r.average) };
}

export async function setSurveysOn(tx: Tx, businessId: BusinessId, on: boolean): Promise<void> {
  await sql`update businesses set surveys_on = ${on} where id = ${businessId}::uuid`.execute(tx);
}

export type SurveyAnswer = { readonly conversationId: string; readonly buyer: string | null; readonly score: number; readonly answeredAt: Date };

/** The latest answers, newest first, each with the buyer it came from. */
export async function latestSurveyAnswers(tx: Tx, businessId: BusinessId, limit = 20): Promise<readonly SurveyAnswer[]> {
  return (await sql<{ conversation_id: string; buyer: string | null; score: number; answered_at: Date }>`
    select s.conversation_id::text as conversation_id, cl.display_name as buyer, s.score, s.answered_at
      from survey_asks s join clients cl on cl.id = s.client_id
     where s.business_id = ${businessId}::uuid and s.state = 'answered'
     order by s.answered_at desc limit ${limit}`.execute(tx)).rows
    .map((r) => ({ conversationId: r.conversation_id, buyer: r.buyer, score: r.score, answeredAt: new Date(r.answered_at) }));
}
