import type { ColumnType, Generated } from 'kysely';

/**
 * Kysely table types — hand-written for the columns the service touches.
 * (Codegen against a live DB replaces this file in Week 3; hand-written is
 * fine while the schema is this small and lets us typecheck without a DB.)
 *
 * NOTE ON MONEY: pg returns `numeric` as strings to avoid float loss. Columns
 * typed `ColumnType<string, number, number>` reflect that: string OUT,
 * number IN. Repositories convert with Number() at the boundary — exactly one
 * place, never in core.
 */

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type Numeric = ColumnType<string, number, number>;

export interface Database {
  businesses: {
    id: string;
    name: string;
    engine: 'n8n' | 'service';
  };
  clients: {
    id: Generated<string>;
    business_id: string;
    display_name: string | null;
    email: string | null;
    last_seen_at: Timestamp;
  };
  client_channels: {
    id: Generated<string>;
    client_id: string;
    channel: string;
    channel_user_id: string;
  };
  conversations: {
    id: Generated<string>;
    business_id: string;
    client_id: string;
    channel: string;
    phase: string;
    is_active: boolean;
    assigned_to: string | null;
    assigned_at: Timestamp | null;
    closed_at: Timestamp | null;
  };
  conversation_state: {
    id: Generated<string>;
    conversation_id: string;
    phase: string;
    identified_product_id: string | null;
    product_confidence: Numeric;
    product_confirmed_by_client: boolean;
    inquiry_quantity: number | null;
    inquiry_unit: string | null;
    client_email_collected: boolean;
    escalation_score: number; // legacy — dual-written until the contract migration
    problem_score: number;
    lead_score: number;
    pending_question: string | null;
    turn_count: number;
    last_message_at: Timestamp;
    context_summary: string | null;
  };
  messages: {
    id: Generated<string>;
    conversation_id: string;
    external_id: string | null;
    direction: 'inbound' | 'outbound';
    input_type: string;
    text_content: string | null;
    image_url: string | null;
    detected_language: string | null;
    ai_analysis: unknown;
    sent_at: Timestamp;
    processed_at: Timestamp | null;
  };
  products: {
    id: Generated<string>;
    business_id: string;
    sku: string;
    name: string;
    category: string | null;
    unit: string;
    moq: number;
    price_usd_per_unit: Numeric | null; // legacy scalar — n8n still reads it
    currency: Generated<string>;   // M43a — the amount's currency, beside the amount
    lead_time_days: number | null;
    customizable: boolean;
    is_active: boolean;
  };
  order_updates: {
    id: Generated<string>;
    business_id: string;
    order_id: string;
    state: string;
    note: string | null;
    tracking_reference: string | null;
    at: Generated<Timestamp>;
    by_actor: Generated<string>;
  };
  sample_policy: {
    id: Generated<string>;
    business_id: string;
    price_amount: Numeric;
    currency: Generated<string>;
    credited_on_first_order: boolean;
    stated_at: Generated<Timestamp>;
    stated_by: Generated<string>;
  };
  sample_requests: {
    id: Generated<string>;
    business_id: string;
    conversation_id: string;
    asked_text: string;
    requested_at: Generated<Timestamp>;
    address: string | null;
    handled_at: Timestamp | null;
    handled_by: string | null;
  };
  factory_closures: {
    id: Generated<string>;
    business_id: string;
    label: string;
    starts_on: string;
    ends_on: string;
    created_at: Generated<Timestamp>;
    archived_at: Timestamp | null;
  };
  price_tiers: {
    product_id: string;
    min_qty: number;
    max_qty: number | null;
    unit_price_usd: Numeric;
    currency: Generated<string>;   // M43a
  };
  pricing_policy: {
    id: Generated<string>;
    business_id: string;
    product_id: string | null;
    floor_price_usd: Numeric;
    currency: Generated<string>;   // M43a
    max_discount_pct: Numeric;
    human_required_above_pct: Numeric;
  };
  negotiation_rules: {
    id: Generated<string>;
    business_id: string;
    priority: number;
    condition: unknown;
    action: unknown;
    is_active: boolean;
  };
  substitution_rules: {
    id: Generated<string>;
    business_id: string;
    product_id: string;
    substitute_id: string;
    reason: string;
    rank: number;
  };
  orders: {
    id: Generated<string>;
    order_reference: string;
    business_id: string;
    client_id: string;
    conversation_id: string;
    product_id: string;
    quantity: number;
    unit: string;
    agreed_unit_price_usd: Numeric | null;
    total_value_usd: Numeric | null;
    currency: Generated<string>;   // M43a
    tracking_reference: string | null;   // M46
    client_email: string | null;
    payment_terms: string | null;
    status: string;
    quote_id: string | null;
    created_at: Generated<Timestamp>;
    confirmed_at: Timestamp | null;
  };
  conversation_signals: {
    id: Generated<string>;
    conversation_id: string;
    business_id: string;
    kind: string;
    payload: unknown;
    resolved_at: Timestamp | null;
    created_at: Generated<Timestamp>;
  };
  conversation_events: {
    id: Generated<number>;
    business_id: string;
    conversation_id: string;
    type: string;
    payload: unknown;
    created_at: Generated<Timestamp>;
  };
  turns: {
    message_id: string;
    business_id: string;
    conversation_id: string;
    state_before: unknown;
    input: unknown;
    analysis: unknown;
    retrieved: unknown;
    decision: unknown;
    quote_id: string | null;
    engine: 'n8n' | 'service';
    engine_version: string;
    prompt_version: string | null;
    model_id: string | null;
    latency_ms: number | null;
    created_at: Generated<Timestamp>;
  };
  quotes: {
    id: Generated<string>;
    business_id: string;
    conversation_id: string;
    product_id: string;
    quantity: number;
    inputs: unknown;
    unit_price_usd: Numeric;
    discount_pct: Numeric;
    total_usd: Numeric;
    currency: Generated<string>;   // M43a
    requires_human: boolean;
    applied_rules: string[];
    engine_version: string;
    created_at: Generated<Timestamp>;
  };
  'shadow.turn_decisions': {
    message_id: string;
    conversation_id: string | null;
    business_id: string | null;
    n8n_decision: unknown;
    svc_decision: unknown;
    diverged: boolean | null;
    divergences: string[] | null;
    expected: boolean;
    created_at: Generated<Timestamp>;
  };
}
