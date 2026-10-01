import { sql } from 'kysely';
import type { Tx } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { profileOf, sellingAnswers, type SellingProfile } from '../core/owner/sellingStyle.js';
import { closureDate } from '../core/commerce/closures.js';
import {
  ALL_QUESTIONS, isQuestion, type Answer, type Line, type Question, type SellingState,
} from '../core/owner/howYouSell.js';

/**
 * HS (0096) — where the owner is in "How you sell", what is in force, and the
 * one writer of the lines she ticked. Every write happens in the caller's
 * transaction; each line goes to the table that already holds that fact, with
 * that table's own audit trail, and one `how_you_sell_saved` row names them.
 */

export type Progress = Readonly<Partial<Record<Question, { readonly state: 'draft' | 'answered' | 'skipped'; readonly answer: Answer | null }>>>;

export type SellingFacts = {
  readonly kind: string | null;
  readonly profile: SellingProfile;
  readonly pricesToOwner: boolean;
  readonly zone: string;
};

export async function sellingFacts(tx: Tx, bid: BusinessId): Promise<SellingFacts> {
  const b = (await sql<{ kind: string | null; prices_to_owner: boolean; timezone: string | null }>`
    select kind, prices_to_owner, timezone from businesses where id = ${bid}`.execute(tx)).rows[0];
  return { kind: b?.kind ?? null, profile: profileOf(b?.kind), pricesToOwner: b?.prices_to_owner ?? false, zone: b?.timezone ?? 'UTC' };
}

export async function loadProgress(tx: Tx, bid: BusinessId): Promise<Progress> {
  const rows = (await sql<{ question: string; state: 'draft' | 'answered' | 'skipped'; answer: Answer | null }>`
    select question, state, answer from selling_answers where business_id = ${bid}`.execute(tx)).rows;
  return Object.fromEntries(rows.filter((r) => isQuestion(r.question)).map((r) => [r.question, { state: r.state, answer: r.answer }]));
}

const ymd = (v: unknown): string => closureDate(v).toISOString().slice(0, 10);

/** What is in force now: the lines are drawn against it. */
export async function loadSellingState(tx: Tx, bid: BusinessId): Promise<SellingState> {
  const b = (await sql<{ kind: string | null; quantity_first: boolean | null; working_hours: string | null }>`
    select kind, quantity_first, working_hours from businesses where id = ${bid}`.execute(tx)).rows[0];
  const products = (await sql<{ id: string; name: string; moq: number | null }>`
    select id::text as id, name, moq from products where business_id = ${bid} and is_active order by name, id limit 500`.execute(tx)).rows;
  const allowed = (await sql<{ kind: string; claim_key: string }>`
    select kind, claim_key from claims_policy where business_id = ${bid} and allowed`.execute(tx)).rows;
  const terms = (await sql<{ payment_terms: string; incoterm: string }>`
    select payment_terms, incoterm from trade_terms where business_id = ${bid} order by stated_at desc limit 1`.execute(tx)).rows[0];
  const closures = (await sql<{ label: string; starts_on: unknown; ends_on: unknown }>`
    select label, starts_on, ends_on from factory_closures where business_id = ${bid} and archived_at is null`.execute(tx)).rows;
  const words = (await sql<{ term: string }>`
    select term from forbidden_terms where business_id = ${bid} and archived_at is null`.execute(tx)).rows;
  const told = (await sql<{ question: string; content: string }>`
    select a.question, k.content from selling_answers a
      join product_knowledge k on k.id = a.told_id and k.status = 'active'
     where a.business_id = ${bid}`.execute(tx)).rows;
  return {
    quantityFirst: sellingAnswers(b?.kind, { quantityFirst: b?.quantity_first ?? null }).quantityFirst,
    products,
    allowed: new Set(allowed.map((a) => `${a.kind}:${a.claim_key}`)),
    terms: terms ? { payment: terms.payment_terms, incoterm: terms.incoterm } : null,
    workingHours: b?.working_hours ?? null,
    closures: closures.map((c) => ({ label: c.label, from: ymd(c.starts_on), to: ymd(c.ends_on) })),
    words: new Set(words.map((w) => w.term.trim().toLowerCase())),
    told: Object.fromEntries(told.filter((r) => isQuestion(r.question)).map((r) => [r.question, r.content])),
  };
}

/** Her answer as typed, kept until its lines are saved (or she changes it). */
export async function saveDraft(tx: Tx, bid: BusinessId, q: Question, answer: Answer, actor: string): Promise<void> {
  await sql`
    insert into selling_answers (business_id, question, state, answer, updated_by)
    values (${bid}, ${q}, 'draft', ${JSON.stringify(answer)}::jsonb, ${actor})
    on conflict (business_id, question) do update set
      state = 'draft', answer = excluded.answer, updated_at = now(), updated_by = excluded.updated_by, answered_at = null
  `.execute(tx);
}

export async function skipQuestion(tx: Tx, bid: BusinessId, q: Question, actor: string): Promise<void> {
  await sql`
    insert into selling_answers (business_id, question, state, updated_by)
    values (${bid}, ${q}, 'skipped', ${actor})
    on conflict (business_id, question) do update set
      state = case when selling_answers.state = 'answered' then 'answered' else 'skipped' end,
      updated_at = now(), updated_by = excluded.updated_by
  `.execute(tx);
}

const audit = (tx: Tx, bid: BusinessId, action: string, actor: string, detail: unknown) => sql`
  insert into channel_audit (business_id, channel_id, action, actor, detail)
  values (${bid}, null, ${action}, ${actor}, ${JSON.stringify(detail)}::jsonb)`.execute(tx);

/**
 * The ticked lines, written. Each to its own table, as the page that owns
 * that fact would write it; then the question is answered. `told` is the
 * label each word-for-word answer is kept under, in her language.
 */
export async function applyLines(
  tx: Tx, bid: BusinessId, q: Question, lines: readonly Line[], actor: string,
  told: { readonly label: string; readonly language: string },
): Promise<void> {
  for (const l of lines) {
    switch (l.kind) {
      case 'quantity_first': {
        const before = (await sql<{ v: boolean | null }>`select quantity_first as v from businesses where id = ${bid} for update`.execute(tx)).rows[0]?.v ?? null;
        await sql`update businesses set quantity_first = ${l.to} where id = ${bid}`.execute(tx);
        await audit(tx, bid, 'selling_set', actor, { field: 'quantityFirst', from: before, to: l.to, via: 'how_you_sell' });
        break;
      }
      case 'minimum': {
        const r = await sql<{ id: string }>`
          update products set moq = ${l.to}, updated_at = now()
           where business_id = ${bid} and id = ${l.productId}::uuid and moq is distinct from ${l.to} returning id`.execute(tx);
        if (r.rows[0]) await audit(tx, bid, 'product_edited', actor, { productId: l.productId, changes: { moq: { from: l.from, to: l.to } }, source: { via: 'how_you_sell' } });
        break;
      }
      case 'promise':
      case 'cert': {
        const before = (await sql<{ allowed: boolean }>`select allowed from claims_policy
          where business_id = ${bid} and kind = ${l.claimKind} and claim_key = ${l.claim}`.execute(tx)).rows[0]?.allowed ?? false;
        await sql`insert into claims_policy (business_id, kind, claim_key, allowed) values (${bid}, ${l.claimKind}, ${l.claim}, ${l.to})
                  on conflict (business_id, kind, claim_key) do update set allowed = ${l.to}, updated_at = now()`.execute(tx);
        await audit(tx, bid, 'selling_set', actor, { field: l.kind, key: l.claim, from: before, to: l.to, via: 'how_you_sell' });
        break;
      }
      case 'terms':
        // As the terms page states them: a new row (what an order was confirmed
        // under stays on the record), and the delivery term allowed to be said.
        await sql`insert into trade_terms (business_id, payment_terms, incoterm, stated_at, stated_by)
                  values (${bid}, ${l.payment}, ${l.incoterm}, now(), ${actor})`.execute(tx);
        await sql`insert into claims_policy (business_id, kind, claim_key, allowed) values (${bid}, 'incoterm', ${l.incoterm}, true)
                  on conflict (business_id, kind, claim_key) do update set allowed = true, updated_at = now()`.execute(tx);
        break;
      case 'hours':
        await sql`update businesses set working_hours = ${l.text} where id = ${bid}`.execute(tx);
        await audit(tx, bid, 'update_profile', actor, { fields: ['workingHours'], via: 'how_you_sell' });
        break;
      case 'closure':
        await sql`insert into factory_closures (business_id, label, starts_on, ends_on)
                  values (${bid}, ${l.label}, ${l.from}::date, ${l.to}::date)`.execute(tx);
        break;
      case 'word': {
        const exists = (await sql<{ id: string }>`select id from forbidden_terms where business_id = ${bid}
          and lower(btrim(term)) = lower(btrim(${l.term})) and archived_at is null`.execute(tx)).rows[0];
        if (!exists) await sql`insert into forbidden_terms (business_id, term, note) values (${bid}, ${l.term}, null)`.execute(tx);
        break;
      }
      case 'told': {
        // A new answer replaces the one this flow wrote last: archived, never
        // erased, and the new row says which it superseded.
        const prev = (await sql<{ told_id: string | null }>`select told_id::text as told_id from selling_answers
          where business_id = ${bid} and question = ${l.question} for update`.execute(tx)).rows[0]?.told_id ?? null;
        if (prev) await sql`update product_knowledge set status = 'archived', updated_at = now() where id = ${prev}::uuid and status = 'active'`.execute(tx);
        const id = (await sql<{ id: string }>`
          insert into product_knowledge (business_id, product_id, kind, label, content, source_language, source, supersedes_id)
          values (${bid}, null, 'faq', ${told.label}, ${l.text}, ${told.language}, 'owner_confirmed', ${prev}::uuid)
          returning id::text as id`.execute(tx)).rows[0]!.id;
        await sql`update selling_answers set told_id = ${id}::uuid where business_id = ${bid} and question = ${l.question}`.execute(tx);
        break;
      }
    }
  }
  await sql`
    insert into selling_answers (business_id, question, state, updated_by, answered_at)
    values (${bid}, ${q}, 'answered', ${actor}, now())
    on conflict (business_id, question) do update set
      state = 'answered', answered_at = now(), updated_at = now(), updated_by = excluded.updated_by
  `.execute(tx);
  await audit(tx, bid, 'how_you_sell_saved', actor, { question: q, lines: lines.map((l) => l.key) });
}

/** Every question this business has answered or left for later, in the order of the flow. */
export const answeredIn = (p: Progress): ReadonlySet<Question> =>
  new Set(ALL_QUESTIONS.filter((q) => p[q]?.state === 'answered' || p[q]?.state === 'skipped'));
