import { sql } from 'kysely';
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
          'cl.email as client_email', 'cl.display_name',
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
        preferredLanguage: null,
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
      return rows.map((r): PriceTier => ({
        productId: r.product_id as PriceTier['productId'],
        minQty: r.min_qty, maxQty: r.max_qty,
        unitPriceUsd: num(r.unit_price_usd),
      }));
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
      return {
        businessId: r.business_id as BusinessId,
        productId: r.product_id as PricingPolicy['productId'],
        floorPriceUsd: num(r.floor_price_usd),
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
          agreed_unit_price_usd: order.unitPriceUsd,
          total_value_usd: order.totalUsd,
          client_email: order.email,
          payment_terms: order.paymentTerms,
          status: 'confirmed',
          quote_id: null,
          confirmed_at: new Date(),
        }).returning(['id', 'order_reference']).executeTakeFirstOrThrow();

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
          case 'high_value':
            return { kind: 'high_value', totalUsd: Number(p['totalUsd'] ?? 0) } as Signal;
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
    async recordQuote(q) {
      const row = await tx.insertInto('quotes').values({
        business_id: businessId,
        conversation_id: q.conversationId,
        product_id: q.productId,
        quantity: q.quantity,
        inputs: JSON.stringify(q.inputs),
        unit_price_usd: q.unitPriceUsd,
        discount_pct: q.discountPct,
        total_usd: q.totalUsd,
        requires_human: q.requiresHuman,
        applied_rules: [...q.appliedRules],
        engine_version: ENGINE_VERSION,
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
      })
      .onConflict((oc) => oc.column('message_id').doNothing()) // replays are idempotent
      .execute();
    },
  };

  // autonomy_policy + drafts (migration 0009) — raw SQL, like db/channels.ts,
  // since they sit outside the typed core schema. Both are existing tables.
  const autonomy: import('./ports.js').AutonomyRepo = {
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

  return { businessId, conversations, clients, catalog, orders, signals, events, audit, autonomy, drafts };
}
