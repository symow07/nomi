-- ---------------------------------------------------------------------------
-- 0025 — the owner can author her own price rules, and edit her own products.
--
-- WHAT WAS WRONG. `confirmImport` was the only writer of products, price_tiers
-- and pricing_policy outside the demo seeds, every insert was
-- `on conflict do nothing`, and no update route existed anywhere. So a price
-- could not be corrected — re-importing the same SKU was a silent no-op — and
-- the importer INVENTED the commercial policy it could not know:
--
--     floor_price_usd = the list price,  max_discount_pct = 0,
--     human_required_above_pct = 0
--
-- which makes the floor equal to the list price and gives her zero negotiating
-- authority by construction. The product's central claim is that she "quotes
-- within the owner's own price rules"; those rules had never been the owner's.
--
-- WHAT THIS MIGRATION DOES: nothing to the pricing tables. They were already
-- right. `pricing_policy` carries floor, max discount and approval threshold,
-- keyed `unique (business_id, product_id)` with a NULL product_id meaning the
-- business default — so a per-product rule can override a business-wide one,
-- which is exactly what `repos.pricingPolicy` already asks for.
--
-- Crucially, all three columns are NOT NULL, so "the owner has not answered
-- yet" is representable ONLY as the absence of a row. That is the property the
-- new code depends on: no row means unanswered, and nothing may invent one.
--
-- All this adds is two audit verbs, because `channel_audit.action` is a
-- CHECK-constrained vocabulary and an owner edit currently has no honest name:
--
--   product_edited   price, minimum order, unit, or sellable/paused changed.
--                    detail carries the BEFORE and AFTER of each changed field,
--                    so a price change reads as a change and not as a silent
--                    overwrite.
--   price_rules_set  the owner answered the three questions, for one product or
--                    as her default. detail carries before/after the same way.
--
-- Additive and forward-only (ADR-0007): existing rows stay valid, nothing is
-- dropped, and an older build ignores the two new verbs entirely.
-- ---------------------------------------------------------------------------

alter table channel_audit drop constraint if exists channel_audit_action_check;
alter table channel_audit add constraint channel_audit_action_check
  check (action in ('connect','reconnect','disconnect','test','rotate_credential',
                    'set_owner_phone','update_profile',
                    'activate','deactivate','blocked_not_allowlisted',
                    'allowlist_add','allowlist_archive',
                    'send_refused','activation_refused',
                    'product_edited','price_rules_set'));

insert into _migrations (version, name) values (25, '0025_owner_authored_price_rules')
  on conflict (version) do nothing;
