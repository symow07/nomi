/**
 * PRACTICE, PER WORKSPACE — which of a workspace's tables its practice copy
 * takes (P1, the owner's decision of 2026-09-30; docs/PRACTICE.md).
 *
 * A practice copy is a second business row, `practice_of` the owner's, that
 * holds what the assistant needs to answer AS THIS BUSINESS — its profile,
 * catalogue, prices, rules, assistant and settings — and nothing about anyone
 * real: no customer, no conversation, no channel, no person. It is refreshed
 * from the live workspace before every practice turn (`practice_refresh`,
 * migration 0086), so a price fixed on Products shows in the next message.
 *
 * Every business-scoped table is named here exactly once, and
 * practice-copy.test.ts holds that against the schema: a table added later
 * that nobody classified fails it, the way `tools/erase-buyer.mjs` refuses what
 * it cannot classify — and every copied table must appear in the refresh.
 * Only the tests read these lists; the refresh itself is SQL (0086).
 */

/**
 * Copied into the practice copy, refreshed every turn.
 *   · products and assistants are UPDATED IN PLACE, matched by `source_id`:
 *     practice's own quotes, orders, conversation state and conversations
 *     reference them with no cascade, so a delete-and-reinsert refresh would
 *     fail as soon as Practice had quoted;
 *   · the rest is replaced whole (nothing practice writes refers to them);
 *   · sample_policy, trade_terms and owner_rates are history tables: only the
 *     current row is copied (per currency pair, for the rate).
 */
export const PRACTICE_COPY = [
  'products', 'product_knowledge',
  'pricing_policy', 'negotiation_rules', 'bundle_rules', 'substitution_rules',
  'claims_policy', 'forbidden_terms', 'factory_closures',
  'sample_policy', 'trade_terms', 'owner_rates',
  'assistants', 'onboarding_state', 'autonomy_policy',
  // The operator's switches bind Practice as they bind the workspace: a
  // silenced assistant is silenced in Practice too.
  'ops_flags',
] as const;

/** Child tables (no business_id of their own) copied with their parent product. */
export const PRACTICE_COPY_CHILDREN = ['price_tiers', 'product_aliases', 'product_images'] as const;

/**
 * Never copied. Practice writes its OWN rows into some of these (its
 * conversation, drafts, turns, quotes, orders, the practice customer) — the
 * refresh never touches those. Nothing of the live workspace's is read.
 */
export const PRACTICE_SKIP = [
  // What happened: conversations and everything hanging off them.
  'conversations', 'conversation_events', 'conversation_notes', 'conversation_signals', 'handoffs',
  'escalation_events', 'message_fragments', 'drafts', 'turns', 'quotes', 'quote_proofs',
  'orders', 'order_updates', 'order_proposals', 'payments', 'deliveries', 'repairs',
  'sample_requests', 'promised_dates', 'outbound_messages', 'outbound_transitions', 'spot_checks',
  'capability_events', 'deletion_asks', 'deletion_requests', 'calendar_entries',
  // Who: customers, contacts and what was learned about them.
  'clients', 'contacts', 'contact_consent', 'suppressions', 'organization_enrichments',
  // Where: every channel, credential and sending identity — a copy can reach nobody.
  'channels', 'channel_credentials', 'channel_audit', 'channel_events', 'channel_sources',
  'connector_credentials', 'meta_accounts', 'mail_accounts', 'sending_domains',
  'pilot_allowlist', 'pilot_log', 'agents',
  // The people who work there, and how they sign in.
  'people', 'logins', 'login_setups',
  // Writing first (the outreach area) is not practised.
  'outreach_settings', 'sequences', 'sequence_steps', 'sequence_enrollments', 'sequence_sends',
  // Money and operations: the copy spends the owner's allowance (P5), not its own.
  'usage_ledger', 'tenant_budgets', 'subscriptions', 'app_errors',
] as const;

export type PracticeTable = (typeof PRACTICE_COPY)[number] | (typeof PRACTICE_SKIP)[number];
