import { sql } from 'kysely';
import { assistantIdForChannel } from './assistants.js';
import type { AssistantRole } from '../core/owner/assistants.js';
import { closureDate } from '../core/commerce/closures.js';
import { isReportedOrderState } from '../core/commerce/orderState.js';
import { writeOrderState } from './orders.js';
import { moneyFromRow, usd } from '../core/types/money.js';
import type { Tx } from './client.js';
import type {
  AuditRepo,
  CatalogRepo,
  ClientRepo,
  ConversationRepo,
  EventLog,
  OrderRepo,
  SignalRepo,
  Tenant,
} from './ports.js';
import type { BusinessId, ClientId, ConversationId, OrderId } from '../core/types/ids.js';
import { parseEmail } from '../core/types/ids.js';
import type { ConversationState } from '../core/types/conversation.js';
import type {
  ConfirmableOrder,
  NegotiationRule,
  PriceTier,
  PricingPolicy,
  Product,
  RuleAction,
  RuleCondition,
} from '../core/types/commerce.js';
import type { Signal } from '../core/scoring/signals.js';
import type { AllowedClaim, ClaimKind } from '../core/safety/claims.js';
import type { KnowledgeSnippet } from '../core/types/knowledge.js';
import { loadKillSwitches } from './opsFlags.js';
import { issueProofLinkTx } from './proofs.js';

const ENGINE_VERSION = process.env['ENGINE_VERSION'] ?? 'dev';

/** pg returns numeric as string. Exactly one conversion point, right here. */
const num = (v: string | number | null): number => (v === null ? 0 : Number(v));

export function tenantRepos(tx: Tx, businessId: BusinessId): Tenant {
  // ── conversations ──────────────────────────────────────────────────────────
  const conversations: ConversationRepo = {
    async loadState(id) {
      const row = await tx
        .selectFrom('conversations as c')
        .innerJoin('conversation_state as cs', 'cs.conversation_id', 'c.id')
        .innerJoin('clients as cl', 'cl.id', 'c.client_id')
        .select([
          'c.id', 'c.business_id', 'c.client_id', 'c.phase as conv_phase',
          'c.assigned_to', 'c.is_active',
          'cs.identified_product_id', 'cs.product_confidence',
          'cs.product_confirmed_by_client', 'cs.inquiry_quantity', 'cs.inquiry_unit',
          'cs.problem_score', 'cs.lead_score', 'cs.pending_question',
          'cs.turn_count', 'cs.context_summary',
          'cl.email as client_email', 'cl.display_name', 'cl.preferred_language',
        ])
        .where('c.id', '=', id)
        .executeTakeFirst();
      if (!row) return null;

      const email = row.client_email ? parseEmail(row.client_email) : null;
      return {
        conversationId: row.id as ConversationId,
        businessId: row.business_id as BusinessId,
        clientId: row.client_id as ClientId,
        phase: row.conv_phase as ConversationState['phase'],
        turnCount: row.turn_count,
        scores: { problem: row.problem_score, lead: row.lead_score },
        product: row.identified_product_id
          ? {
              productId: row.identified_product_id as never,
              confidence: num(row.product_confidence),
              confirmedByClient: row.product_confirmed_by_client,
              matchMethod: 'text',
            }
          : null,
        quantity: row.inquiry_quantity
          ? { value: row.inquiry_quantity, unit: row.inquiry_unit ?? 'pcs' }
          : null,
        contact: { email: email?.ok ? email.value : null },
        pendingQuestion: row.pending_question as ConversationState['pendingQuestion'],
        assignedTo: row.assigned_to as ConversationState['assignedTo'],
        // G11 — remembered from his own messages, so a turn with no analysis
        // (a fast path, an injection) still answers in the language he writes.
        preferredLanguage: row.preferred_language ?? null,
        contextSummary: row.context_summary,
      };
    },

    async saveState(state) {
      await tx
        .updateTable('conversation_state')
        .set({
          phase: state.phase,
          identified_product_id: state.product?.productId ?? null,
          product_confidence: state.product?.confidence ?? 0,
          product_confirmed_by_client: state.product?.confirmedByClient ?? false,
          inquiry_quantity: state.quantity?.value ?? null,
          inquiry_unit: state.quantity?.unit ?? null,
          client_email_collected: state.contact.email !== null,
          problem_score: state.scores.problem,
          lead_score: state.scores.lead,
          // DUAL-WRITE (ADR-0007): n8n still reads the legacy blended score
          // during shadow. Dropped by the contract migration, not before.
          escalation_score: state.scores.problem,
          pending_question: state.pendingQuestion,
          turn_count: state.turnCount,
          last_message_at: new Date(),
        })
        .where('conversation_id', '=', state.conversationId)
        .execute();

      await tx
        .updateTable('conversations')
        .set({ phase: state.phase, assigned_to: state.assignedTo })
        .where('id', '=', state.conversationId)
        .execute();
    },

    async findActiveByClient(clientId) {
      const row = await tx
        .selectFrom('conversations')
        .select('id')
        .where('client_id', '=', clientId)
        .where('is_active', '=', true)
        .limit(1)
        .executeTakeFirst();
      return row ? conversations.loadState(row.id as ConversationId) : null;
    },

    async create(clientId, channel) {
      const conv = await tx
        .insertInto('conversations')
        .values({
          business_id: businessId, client_id: clientId, channel,
          phase: 'warm_intake', is_active: true, assigned_to: null,
          assigned_at: null, closed_at: null,
          // A5 — who answers is decided wherever a conversation is created.
          assistant_id: await assistantIdForChannel(tx, businessId, channel),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('conversation_state')
        .values({
          conversation_id: conv.id, phase: 'warm_intake',
          product_confidence: 0, product_confirmed_by_client: false,
          inquiry_quantity: null, inquiry_unit: null, client_email_collected: false,
          escalation_score: 0, problem_score: 0, lead_score: 0,
          pending_question: null, turn_count: 0,
          last_message_at: new Date(), identified_product_id: null,
          context_summary: null,
        })
        .execute();
      const state = await conversations.loadState(conv.id as ConversationId);
      if (!state) throw new Error('conversation vanished after create');
      return state;
    },

    async assign(id, agent) {
      await tx
        .updateTable('conversations')
        .set({ assigned_to: agent, assigned_at: agent ? new Date() : null })
        .where('id', '=', id)
        .execute();
    },

    async close(id) {
      await tx
        .updateTable('conversations')
        .set({ phase: 'closed', is_active: false, closed_at: new Date() })
        .where('id', '=', id)
        .execute();
    },
    // A5.3 — the conversation's own assistant, archived or not (a conversation
    // she held still names her); else the main one; else nobody.
    async speaker(id) {
      const r = (await sql<{
        a_name: string | null; a_role: AssistantRole | null; a_note: string | null;
        b_name: string; b_kind: string | null; b_country: string | null; b_description: string | null;
      }>`
        select a.name as a_name, a.role as a_role, a.note as a_note,
               b.name as b_name, b.kind as b_kind, b.country as b_country, b.description as b_description
          from conversations c
          join businesses b on b.id = c.business_id
          left join assistants a on a.id = coalesce(c.assistant_id,
               (select d.id from assistants d
                 where d.business_id = c.business_id and d.is_default and d.archived_at is null))
         where c.id = ${id}::uuid and c.business_id = ${businessId}::uuid`.execute(tx)).rows[0];
      if (!r) return null;
      return {
        name: r.a_name, role: r.a_role, note: r.a_note,
        business: { name: r.b_name, kind: r.b_kind, country: r.b_country, description: r.b_description },
      };
    },
  };

  // ── clients ────────────────────────────────────────────────────────────────
  const clients: ClientRepo = {
    async saveEmail(clientId, email) {
      await tx.updateTable('clients').set({ email }).where('id', '=', clientId).execute();
    },
    async touchLastSeen(clientId) {
      await tx.updateTable('clients').set({ last_seen_at: new Date() })
        .where('id', '=', clientId).execute();
    },
    // G11 — his language, as he writes it. Two letters, from the analyser.
    async savePreferredLanguage(clientId, language) {
      await sql`update clients set preferred_language = ${language.slice(0, 2).toLowerCase()}
                 where id = ${clientId}`.execute(tx);
    },
  };

  // ── catalog ────────────────────────────────────────────────────────────────
  const catalog: CatalogRepo = {
    async product(id) {
      const r = await tx.selectFrom('products').selectAll()
        .where('id', '=', id).where('is_active', '=', true).executeTakeFirst();
      if (!r) return null;
      return {
        id: r.id as Product['id'],
        businessId: r.business_id as BusinessId,
        sku: r.sku, name: r.name, moq: r.moq, unit: r.unit,
        leadTimeDays: r.lead_time_days, customizable: r.customizable,
      };
    },

    async priceTiers(productId) {
      const rows = await tx.selectFrom('price_tiers').selectAll()
        .where('product_id', '=', productId).orderBy('min_qty').execute();
      // M43a — a tier whose currency this build cannot price is DROPPED, never
      // defaulted to USD. Defaulting is how a row in another currency becomes a
      // dollar quote; dropping it makes the quote refuse for want of a tier,
      // which is the fail-closed answer.
      return rows.flatMap((r): PriceTier[] => {
        const unitPrice = moneyFromRow(num(r.unit_price_usd), r.currency);
        return unitPrice === null ? [] : [{
          productId: r.product_id as PriceTier['productId'],
          minQty: r.min_qty, maxQty: r.max_qty,
          unitPrice,
        }];
      });
    },

    async pricingPolicy(productId) {
      // Product-specific policy wins; business-wide default is the fallback.
      const r = await tx.selectFrom('pricing_policy').selectAll()
        .where((eb) => productId
          ? eb.or([eb('product_id', '=', productId), eb('product_id', 'is', null)])
          : eb('product_id', 'is', null))
        .orderBy(sql`product_id is null`) // false (specific) sorts first
        .limit(1)
        .executeTakeFirst();
      if (!r) return null;
      const floorPrice = moneyFromRow(num(r.floor_price_usd), r.currency);
      // A floor this build cannot read is not "no floor" — it is a policy row
      // that exists and cannot be enforced. Returning null here means the quote
      // engine applies NO floor, so this must not be reached: the currency
      // check constraint in 0030 refuses the write in the first place.
      if (floorPrice === null) return null;
      return {
        businessId: r.business_id as BusinessId,
        productId: r.product_id as PricingPolicy['productId'],
        floorPrice,
        maxDiscountPct: num(r.max_discount_pct),
        humanRequiredAbovePct: num(r.human_required_above_pct),
      };
    },

    async negotiationRules() {
      const rows = await tx.selectFrom('negotiation_rules').selectAll()
        .where('is_active', '=', true).orderBy('priority').execute();
      return rows.map((r): NegotiationRule => ({
        businessId: r.business_id as BusinessId,
        priority: r.priority,
        condition: r.condition as RuleCondition,
        action: r.action as RuleAction,
      }));
    },

    // M37.5 — live rows only; archived terms are history, not policy.
    async forbiddenTerms() {
      const r = await sql<{ term: string }>`
        select term from forbidden_terms
         where business_id = ${businessId} and archived_at is null
         order by created_at`.execute(tx);
      return r.rows.map((x) => x.term);
    },

    // M44 — live rows only; an archived closure is history, not a calendar.
    async factoryClosures() {
      const r = await sql<{ label: string; starts_on: Date; ends_on: Date }>`
        select label, starts_on, ends_on from factory_closures
         where business_id = ${businessId} and archived_at is null
         order by starts_on`.execute(tx);
      return r.rows.map((x) => ({
        label: x.label,
        from: closureDate(x.starts_on),
        to: closureDate(x.ends_on),
      }));
    },

    // G6 — newest in force, as with her sample policy and her rate.
    async tradeTerms() {
      const r = await sql<{ payment_terms: string; incoterm: string; stated_at: Date }>`
        select payment_terms, incoterm, stated_at from trade_terms
         where business_id = ${businessId} order by stated_at desc, id desc limit 1`.execute(tx);
      const row = r.rows[0];
      return row ? { paymentTerms: row.payment_terms, incoterm: row.incoterm, statedAt: row.stated_at } : null;
    },

    // M45 — the most recently stated policy is the one in force. A currency
    // this build cannot price is not a policy it can quote: dropped, not
    // defaulted, exactly as every other money read here.
    async samplePolicy() {
      const r = await sql<{ price_amount: string; currency: string; credited_on_first_order: boolean; stated_at: Date }>`
        select price_amount, currency, credited_on_first_order, stated_at
          from sample_policy where business_id = ${businessId}
         order by stated_at desc limit 1`.execute(tx);
      const row = r.rows[0];
      if (!row) return null;
      const price = moneyFromRow(Number(row.price_amount), row.currency);
      return price === null ? null : {
        price,
        creditedOnFirstOrder: row.credited_on_first_order,
        statedAt: row.stated_at,
      };
    },

    async claimsPolicy() {
      const rows = await sql<{ kind: string; claim_key: string; allowed: boolean }>`
        select kind, claim_key, allowed from claims_policy`.execute(tx);
      return rows.rows.map((r): AllowedClaim => ({
        kind: r.kind as ClaimKind, claimKey: r.claim_key, allowed: r.allowed,
      }));
    },

    async bundleRules() { return []; },        // schema exists; wiring lands with recommendations
    async substitutions() { return []; },      // idem

  };

  // ── orders ─────────────────────────────────────────────────────────────────
  const orders: OrderRepo = {
    async create(conversationId, order: ConfirmableOrder) {
      const conv = await tx.selectFrom('conversations')
        .select(['client_id']).where('id', '=', conversationId)
        .executeTakeFirstOrThrow();

      const ref = await sql<{ ref: string }>`select generate_order_reference() as ref`
        .execute(tx);
      const orderReference = ref.rows[0]?.ref ?? `YW-${Date.now()}`;

      try {
        const row = await tx.insertInto('orders').values({
          order_reference: orderReference,
          business_id: businessId,
          client_id: conv.client_id,
          conversation_id: conversationId,
          product_id: order.productId,
          quantity: order.quantity.value,
          unit: order.quantity.unit,
          agreed_unit_price_usd: order.unitPrice.amount,
          total_value_usd: order.total.amount,
          currency: order.total.currency,
          client_email: order.email,
          // G6 — hers at the moment he confirmed, or null: kept with the order
          // so a document he already holds is not rewritten when she changes
          // her terms later.
          payment_terms: order.paymentTerms,
          incoterm: order.incoterm,
          status: 'confirmed',
          quote_id: null,
          confirmed_at: new Date(),
        }).returning(['id', 'order_reference']).executeTakeFirstOrThrow();

        // G4 — the order's FIRST entry in its history, written by the one
        // writer of that history. Without it the log had no head, the lookup
        // (which reads the log, not the cache) found nothing, and "where is my
        // order?" fell through to the model the minute after he confirmed.
        await writeOrderState(tx, businessId, row.id, {
          state: 'confirmed', note: null, trackingReference: null,
          actor: 'employee', at: new Date(),
        });

        return {
          orderId: row.id as OrderId,
          orderReference: row.order_reference,
          alreadyExisted: false,
        };
      } catch (e: unknown) {
        // orders_one_open_per_conversation (ADR-0004): a second confirmation is
        // not an error — it is the SAME order. Idempotent by construction.
        if ((e as { code?: string }).code === '23505') {
          const existing = await tx.selectFrom('orders')
            .select(['id', 'order_reference'])
            .where('conversation_id', '=', conversationId)
            .where('status', '!=', 'cancelled')
            .executeTakeFirstOrThrow();
          return {
            orderId: existing.id as OrderId,
            orderReference: existing.order_reference,
            alreadyExisted: true,
          };
        }
        throw e;
      }
    },
    // M46 — the latest thing SHE recorded. The log is the history; this reads
    // its newest row rather than `orders.status`, so the answer a buyer gets
    // and the record she keeps cannot disagree.
    //
    // G4 — his latest ORDER, by buyer. Confirming closes the conversation, so
    // the question always arrives in a new one; `orders.client_id` is indexed
    // and set on every order, so this needs no join through conversations.
    async latestForClient(clientId) {
      const r = await sql<{
        order_id: string; reference: string; state: string; at: Date;
        note: string | null; tracking_reference: string | null; by_actor: string;
      }>`
        select o.id as order_id, o.order_reference as reference,
               u.state, u.at, u.note, u.by_actor,
               -- THE ONE ON FILE, not the one on this update row. She typed the
               -- courier's number once; a later note that did not repeat it
               -- must not tell a waiting buyer there is no tracking.
               o.tracking_reference
          from orders o
          join lateral (
            select state, at, note, by_actor from order_updates u
             where u.order_id = o.id
             order by u.at desc, u.id desc limit 1
          ) u on true
         where o.business_id = ${businessId} and o.client_id = ${clientId}
         order by o.created_at desc
         limit 1
      `.execute(tx);
      const row = r.rows[0];
      if (!row || !isReportedOrderState(row.state)) return null;
      return {
        orderId: row.order_id,
        reference: row.reference,
        update: {
          state: row.state, at: row.at, note: row.note,
          trackingReference: row.tracking_reference, by: row.by_actor,
        },
      };
    },
  };

  // ── signals ────────────────────────────────────────────────────────────────
  const signals: SignalRepo = {
    async unresolved(conversationId) {
      const rows = await tx.selectFrom('conversation_signals')
        .select(['kind', 'payload'])
        .where('conversation_id', '=', conversationId)
        .where('resolved_at', 'is', null)
        .execute();
      return rows.map((r) => {
        const p = (r.payload ?? {}) as Record<string, unknown>;
        switch (r.kind) {
          case 'repeated_ambiguity':
            return { kind: 'repeated_ambiguity', turns: Number(p['turns'] ?? 2) } as Signal;
          case 'high_value': {
            // M43a — a stored signal keeps the currency it was raised in. Rows
            // written before 0030 carry none; they were all USD, and saying so
            // here is a statement about history rather than a default applied
            // to new data.
            const total = moneyFromRow(Number(p['total'] ?? p['totalUsd'] ?? 0), String(p['currency'] ?? 'USD'));
            return { kind: 'high_value', total: total ?? usd(0) } as Signal;
          }
          case 'audio_unheard':
            return { kind: 'audio_unheard', reason: String(p['reason'] ?? 'transcription_failed') } as Signal;
          case 'media_unreadable':
            return { kind: 'media_unreadable', received: String(p['received'] ?? 'other') } as Signal;
          default:
            return { kind: r.kind } as Signal;
        }
      });
    },

    async record(conversationId, signal) {
      const { kind, ...payload } = signal as { kind: Signal['kind'] } & Record<string, unknown>;
      // One active signal per kind per conversation: refresh, don't stack.
      await tx.updateTable('conversation_signals')
        .set({ resolved_at: new Date() })
        .where('conversation_id', '=', conversationId)
        .where('kind', '=', kind)
        .where('resolved_at', 'is', null)
        .execute();
      await tx.insertInto('conversation_signals').values({
        conversation_id: conversationId,
        business_id: businessId,
        kind,
        payload: JSON.stringify(payload),
        resolved_at: null,
      }).execute();
    },

    async resolve(conversationId, kind) {
      await tx.updateTable('conversation_signals')
        .set({ resolved_at: new Date() })
        .where('conversation_id', '=', conversationId)
        .where('kind', '=', kind)
        .where('resolved_at', 'is', null)
        .execute();
    },
  };

  // ── events (append-only analytics) ─────────────────────────────────────────
  const events: EventLog = {
    async append(conversationId, type, payload = {}) {
      await tx.insertInto('conversation_events').values({
        business_id: businessId,
        conversation_id: conversationId,
        type,
        payload: JSON.stringify(payload),
      }).execute();
    },
  };

  // ── audit (replay records) ─────────────────────────────────────────────────
  const audit: AuditRepo = {
    // M36 — the client's own price history for this product, newest first.
    // Joined through conversations because quotes carry a conversation, not a
    // client: the same buyer across two threads is one buyer.
    async priorQuotesForClient(clientId, productId) {
      // G7b — only prices he was actually GIVEN. A quote whose reply became a
      // draft counts once she approved it unchanged (发送 — `applyOwnerCommand`
      // sets 'approved' in its own transaction, which is what makes a new price
      // the baseline); one still pending, skipped, rewritten or expired never
      // set his expectation. A quote with no draft went out on its own — or
      // was stopped later, which is counted too: over-counting history only
      // asks her more often, and under-counting it is how he gets contradicted.
      const r = await sql<{ quantity: number; unit_price_usd: string; currency: string; created_at: Date }>`
        select q.quantity, q.unit_price_usd, q.currency, q.created_at
          from quotes q
          join conversations c on c.id = q.conversation_id
         where c.client_id = ${clientId} and q.product_id = ${productId}
           and q.business_id = ${businessId}
           and not exists (
             select 1 from turns t join drafts d on d.turn_message_id = t.message_id
              where t.quote_id = q.id and d.status <> 'approved')
         order by q.created_at desc limit 10
      `.execute(tx);
      // A prior quote in a currency this build cannot price is dropped rather
      // than compared: M36's consistency guard would otherwise order two
      // amounts that were never comparable.
      return r.rows.flatMap((x) => {
        const unitPrice = moneyFromRow(Number(x.unit_price_usd), x.currency);
        return unitPrice === null ? [] : [{ quantity: x.quantity, unitPrice, at: x.created_at }];
      });
    },
    async recordQuote(q) {
      const row = await tx.insertInto('quotes').values({
        business_id: businessId,
        conversation_id: q.conversationId,
        product_id: q.productId,
        quantity: q.quantity,
        inputs: JSON.stringify(q.inputs),
        unit_price_usd: q.unitPrice.amount,
        discount_pct: q.discountPct,
        total_usd: q.total.amount,
        currency: q.total.currency,
        requires_human: q.requiresHuman,
        applied_rules: [...q.appliedRules],
        engine_version: ENGINE_VERSION,
        // G5 — what the quote said about delivery (0040).
        lead_time_days: q.leadTimeDays,
        lead_time_withheld: q.leadTimeWithheld
          ? JSON.stringify({
              label: q.leadTimeWithheld.label,
              from: q.leadTimeWithheld.from.toISOString().slice(0, 10),
              to: q.leadTimeWithheld.to.toISOString().slice(0, 10),
            })
          : null,
      }).returning('id').executeTakeFirstOrThrow();
      return { quoteId: row.id };
    },

    async recordTurn(t) {
      await tx.insertInto('turns').values({
        message_id: t.messageId,
        business_id: businessId,
        conversation_id: t.conversationId,
        state_before: JSON.stringify(t.stateBefore),
        input: JSON.stringify(t.input),
        analysis: t.analysis === null ? null : JSON.stringify(t.analysis),
        retrieved: t.retrieved === null ? null : JSON.stringify(t.retrieved),
        decision: JSON.stringify(t.decision),
        quote_id: t.quoteId,
        engine: 'service',
        engine_version: ENGINE_VERSION,
        prompt_version: t.promptVersion,
        model_id: t.modelId,
        latency_ms: t.latencyMs,
        answer_path: t.measure?.path ?? null,
        llm_calls: t.measure?.llmCalls ?? null,
        input_tokens: t.measure?.inputTokens ?? null,
        output_tokens: t.measure?.outputTokens ?? null,
        analyser_avoidable: t.measure?.analyserAvoidable ?? null,
        own_understanding: t.measure?.ownUnderstanding ? JSON.stringify(t.measure.ownUnderstanding) : null,
      })
      .onConflict((oc) => oc.column('message_id').doNothing()) // replays are idempotent
      .execute();
    },
  };

  // autonomy_policy + drafts (migration 0009) — raw SQL, like db/channels.ts,
  // since they sit outside the typed core schema. Both are existing tables.
  const autonomy: import('./ports.js').AutonomyRepo = {
    // M34.9 — the decision is core (demotionDecision), the write is here, and
    // the evidence load is the SAME one promotion uses. Three call sites, one
    // definition of what the evidence is: the alternative was a second copy of
    // that query, which is the bug this repo pays for most often.
    async selfDemote({ capability, violations }) {
      const { loadCapabilityEvidence, autoDemote } = await import('../pipeline/capability.js');
      const { demotionDecision } = await import('../core/trust/evidence.js');
      const base = await loadCapabilityEvidence(tx, capability);
      // The violation this turn produced is not yet queryable — commitTurn
      // appends the event in the same transaction — so it is added here rather
      // than read back, which also keeps the decision on THIS turn's facts.
      const evidence = { ...base, policyViolations: base.policyViolations + violations };
      return autoDemote(tx, businessId, capability, demotionDecision(evidence), evidence);
    },
    async grants() {
      const r = await sql<{ capability: string; mode: string; time_window: string | null }>`
        select capability, mode, time_window from autonomy_policy where business_id = ${businessId}
      `.execute(tx);
      return r.rows.map((row) => ({
        capability: row.capability as import('../core/conversation/autonomy.js').Capability,
        mode: row.mode as 'draft' | 'auto',
        timeWindow: row.time_window,
      }));
    },
  };

  // M34.6 — ops_flags (migration 0014). The same loader the SEND gate uses, so
  // "is she silenced?" has one answer and one query, not two that can drift.
  const ops: import('./ports.js').OpsRepo = {
    switches: () => loadKillSwitches(tx, businessId),
  };

  const drafts: import('./ports.js').DraftRepo = {
    async create(input) {
      const r = await sql<{ id: string }>`
        insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
        values (${businessId}, ${input.conversationId}, ${input.capability},
                ${input.draftText}, ${input.turnMessageId}, 'pending')
        returning id
      `.execute(tx);
      return { draftId: r.rows[0]!.id };
    },
  };

  // ── samples (M45) ────────────────────────────────────────────────────────
  const samples: import('./ports.js').SampleRepo = {
    async record(conversationId, askedText) {
      // ON CONFLICT DO NOTHING against the one-OPEN-per-conversation index: the
      // first time he asked is the fact worth keeping, and a re-ask must not
      // reset the clock on a request she has been sitting on for two days.
      //
      // The predicate is repeated in the conflict target because Postgres
      // matches a partial index by its predicate as well as its columns — and
      // that is the behaviour we want: once she has handled the last request,
      // there is no conflict and a buyer asking again raises a new one.
      await sql`
        insert into sample_requests (business_id, conversation_id, asked_text)
        values (${businessId}, ${conversationId}, ${askedText})
        on conflict (conversation_id) where handled_at is null do nothing
      `.execute(tx);
    },
  };

  // ── knowledge (M13) ──────────────────────────────────────────────────────
  // Read-only in the turn: the identified product's active rows + business-level,
  // ranked by relevance then confidence tier. retrieve_knowledge runs under RLS.
  const knowledge: import('./ports.js').KnowledgeRepo = {
    async retrieve({ query, productId, k }) {
      const rows = await sql<{
        id: string; product_id: string | null; kind: string;
        label: string; content: string; source: string; relevance: number;
      }>`
        select * from retrieve_knowledge(${businessId}::uuid, ${query}, ${productId}::uuid, ${k})
      `.execute(tx);
      return rows.rows.map((r) => ({
        id: r.id, productId: r.product_id, kind: r.kind as KnowledgeSnippet['kind'],
        label: r.label, content: r.content, source: r.source as KnowledgeSnippet['source'],
        relevance: Number(r.relevance),
      }));
    },
  };

  // G11 — the buyer's proof link, minted in THIS transaction (db/proofs.ts).
  const proofs: import('./ports.js').ProofRepo = {
    issue: (quoteId) => issueProofLinkTx(tx, businessId, quoteId),
  };

  return { businessId, conversations, clients, catalog, orders, samples, signals, events, audit, autonomy, ops, drafts, knowledge, proofs };
}
