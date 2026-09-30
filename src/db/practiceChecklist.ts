import { sql } from 'kysely';
import { isRetailKind } from '../core/owner/sellingStyle.js';
import { withTenantTx, type Db } from './client.js';
import type { BusinessId } from '../core/types/ids.js';
import { asksAboutBeingAi } from '../core/safety/identity.js';

/**
 * THE PRACTICE CHECKLIST (P4 part two; docs/PRACTICE.md) — what an owner
 * should have seen before customers. Each item is read from the practice
 * copy's own rows, where the real turn left them; once seen it is written on
 * the WORKSPACE (0091 `practice_checks`), because Practice is not kept.
 */

export const CHECKLIST_ITEMS = [
  'quoted',          // one of their products quoted with the total they expected ("your total first")
  'found_by_name',   // a product found by the name customers use
  'handed_over',     // a question the assistant cannot answer, handed to the owner
  'bot_answered',    // "are you a real person?" answered honestly
  'person_handoff',  // "I want a person" handed to the owner
  'discount_held',   // a discount beyond the owner's limit held for them
  'stop_handoff',    // Practice stopped, then a message handed to the owner
  'retail_price',    // (retail and brands) "how much is this?" answered with a price — needs RT
  'order_tapped',    // an order the owner confirmed, and what the customer received
  'price_handed',    // (no catalogue) a price question answered without a figure, handed to the owner
  'offer_answered',  // (no catalogue) a question about what they offer, answered from the profile
] as const;
export type ChecklistItem = (typeof CHECKLIST_ITEMS)[number];

/** Which list a workspace works through: its catalogue, a shop's, or none. */
export type ChecklistKind = 'catalogue' | 'retail' | 'no_catalogue';

export const checklistFor = (kind: ChecklistKind): readonly ChecklistItem[] =>
  kind === 'no_catalogue'
    ? ['price_handed', 'offer_answered', 'handed_over', 'bot_answered', 'person_handoff', 'stop_handoff']
    : ['quoted', 'found_by_name', 'handed_over', 'bot_answered', 'person_handoff', 'discount_held', 'stop_handoff',
       ...(kind === 'retail' ? ['retail_price' as const] : []), 'order_tapped'];

/**
 * Items that cannot pass yet, whatever is practised: a shop's price before a
 * quantity is the plan's RT (phase 3). Until it lands the item shows the gap.
 */
export const NOT_YET: ReadonlySet<ChecklistItem> = new Set(['retail_price']);


export async function checklistKind(db: Db, live: BusinessId): Promise<ChecklistKind> {
  const r = await withTenantTx(db, live, async (tx) => (await sql<{ kind: string | null; priced: boolean }>`
    select b.kind,
           exists (select 1 from products p where p.business_id = b.id and p.is_active and p.price_usd_per_unit is not null) as priced
      from businesses b where b.id = ${live}::uuid`.execute(tx)).rows[0]);
  if (!r?.priced) return 'no_catalogue';
  return isRetailKind(r.kind) ? 'retail' : 'catalogue';
}

/** What the copy shows was seen, read from the real turn's own rows. */
async function seenOnCopy(db: Db, copy: BusinessId): Promise<Set<ChecklistItem>> {
  const seen = new Set<ChecklistItem>();
  await withTenantTx(db, copy, async (tx) => {
    const r = (await sql<Record<string, boolean>>`
      select
        exists (select 1 from turns where business_id = ${copy}::uuid
                  and decision->'product'->>'productId' is not null
                  and coalesce(decision->'product'->>'matchMethod', '') <> 'image') as found_by_name,
        exists (select 1 from conversation_signals s join conversations c on c.id = s.conversation_id
                 where c.business_id = ${copy}::uuid
                   and s.kind in ('complaint', 'repeated_ambiguity', 'low_confidence_image', 'audio_unheard',
                                  'media_unreadable', 'not_answered')) as handed_over,
        exists (select 1 from conversation_signals s join conversations c on c.id = s.conversation_id
                 where c.business_id = ${copy}::uuid and s.kind = 'human_requested') as person_handoff,
        exists (select 1 from quotes where business_id = ${copy}::uuid and requires_human) as discount_held,
        exists (select 1 from turns where business_id = ${copy}::uuid
                  and decision->'action'->>'kind' = 'held' and decision->'action'->>'reason' = 'assistant_stopped') as stop_handoff,
        exists (select 1 from order_proposals where business_id = ${copy}::uuid and state = 'confirmed') as order_tapped,
        exists (select 1 from turns t where t.business_id = ${copy}::uuid
                  and t.analysis->'intent'->>'primary' = 'price_request' and t.quote_id is null
                  and exists (select 1 from drafts d where d.turn_message_id = t.message_id))
        -- K5 — or handed to the owner because her prices go to her.
        or exists (select 1 from conversation_signals s join conversations c on c.id = s.conversation_id
                    where c.business_id = ${copy}::uuid and s.kind = 'price_to_owner') as price_handed,
        exists (select 1 from turns t where t.business_id = ${copy}::uuid
                  and coalesce(t.decision->'product', 'null'::jsonb) = 'null'::jsonb
                  and t.answer_path in ('model', 'taught_answer')) as offer_answered`.execute(tx)).rows[0] ?? {};
    for (const [k, v] of Object.entries(r)) if (v) seen.add(k as ChecklistItem);

    // "Are you a real person?" answered honestly: a turn whose question asked it,
    // whose reply was written and not held for failing that very question — or
    // the disclosure sent for it.
    const asked = (await sql<{ id: string; text: string | null; held: boolean; drafted: boolean; disclosed: boolean }>`
      select t.message_id as id, t.input->>'text' as text,
             exists (select 1 from drafts d join conversation_events e
                       on e.conversation_id = d.conversation_id and e.type = 'draft_pending'
                      and e.payload->>'draftId' = d.id::text and e.payload->>'heldBecause' = 'identity_question'
                      where d.turn_message_id = t.message_id) as held,
             exists (select 1 from drafts d where d.turn_message_id = t.message_id) as drafted,
             exists (select 1 from conversation_events e where e.conversation_id = t.conversation_id
                       and e.type = 'ai_disclosed' and e.payload->>'reason' = 'identity_question') as disclosed
        from turns t where t.business_id = ${copy}::uuid
       order by t.created_at desc limit 200`.execute(tx)).rows;
    if (asked.some((a) => a.text && asksAboutBeingAi(a.text) && !a.held && (a.drafted || a.disclosed))) seen.add('bot_answered');
  });
  return seen;
}

/**
 * Read what the copy shows, write down what is new on the workspace, and
 * return everything the workspace has seen. Called when Practice is drawn and
 * before Start over erases the transcript it was seen in.
 */
export async function observeChecklist(db: Db, live: BusinessId, copy: BusinessId | null): Promise<ReadonlySet<ChecklistItem>> {
  const now = copy ? await seenOnCopy(db, copy) : new Set<ChecklistItem>();
  return withTenantTx(db, live, async (tx) => {
    const quoted = (await sql<{ ok: boolean }>`
      select exists (select 1 from practice_totals where business_id = ${live}::uuid and agreed) as ok`.execute(tx)).rows[0]?.ok;
    if (quoted) now.add('quoted');
    for (const item of now) {
      await sql`insert into practice_checks (business_id, item) values (${live}::uuid, ${item}) on conflict do nothing`.execute(tx);
    }
    const rows = (await sql<{ item: string }>`select item from practice_checks where business_id = ${live}::uuid`.execute(tx)).rows;
    return new Set(rows.map((r) => r.item as ChecklistItem));
  });
}

/**
 * "YOUR TOTAL FIRST" — the total the owner expects, typed with the practice
 * message before the answer comes. Kept on the workspace (0091).
 */
export async function expectTotal(db: Db, live: BusinessId, messageId: string, expected: number): Promise<void> {
  await withTenantTx(db, live, (tx) => sql`
    insert into practice_totals (business_id, message_id, expected) values (${live}::uuid, ${messageId}, ${expected})
    on conflict do nothing`.execute(tx));
}

export type PracticeTotal = {
  readonly messageId: string; readonly expected: number;
  readonly quoted: number | null; readonly currency: string | null; readonly agreed: boolean | null;
};

/**
 * Compare each waiting expectation with the first quote the copy made after
 * the owner's line, and write the verdict: the page shows the pair, and the
 * rows are the measure of how often an owner's expectation and the quote
 * disagree. A line erased before any quote stays undecided. The newest few.
 */
export async function settleTotals(db: Db, live: BusinessId, copy: BusinessId | null): Promise<readonly PracticeTotal[]> {
  const waiting = await withTenantTx(db, live, async (tx) => (await sql<{ message_id: string; expected: string }>`
    select message_id, expected::text as expected from practice_totals
     where business_id = ${live}::uuid and decided_at is null order by created_at`.execute(tx)).rows);
  if (copy && waiting.length) {
    for (const w of waiting) {
      const q = await withTenantTx(db, copy, async (tx) => (await sql<{ total: string; currency: string }>`
        select q.total_usd::text as total, q.currency from quotes q
          join messages m on m.conversation_id = q.conversation_id and m.external_id = ${w.message_id}
         where q.business_id = ${copy}::uuid and q.created_at >= m.sent_at
         order by q.created_at limit 1`.execute(tx)).rows[0]);
      if (!q) continue;
      const agreed = Math.abs(Number(q.total) - Number(w.expected)) < 0.005;
      await withTenantTx(db, live, (tx) => sql`
        update practice_totals set quoted = ${q.total}::numeric, currency = ${q.currency}, agreed = ${agreed}, decided_at = now()
         where business_id = ${live}::uuid and message_id = ${w.message_id} and decided_at is null`.execute(tx));
    }
  }
  return withTenantTx(db, live, async (tx) => (await sql<{ message_id: string; expected: string; quoted: string | null; currency: string | null; agreed: boolean | null }>`
    select message_id, expected::text as expected, quoted::text as quoted, currency, agreed from practice_totals
     where business_id = ${live}::uuid order by created_at desc limit 3`.execute(tx)).rows.map((r) => ({
    messageId: r.message_id, expected: Number(r.expected), quoted: r.quoted === null ? null : Number(r.quoted),
    currency: r.currency, agreed: r.agreed,
  })));
}
