-- ---------------------------------------------------------------------------
-- 0092 — ONE CURRENCY PER WORKSPACE (CUR, the owner's decision 2026-09-30;
-- part two — part one, #152, made the send path know every currency).
--
-- "One currency per workspace, chosen during setup. USD/CNY for everyone is a
-- leftover from the export positioning." No conversion: a workspace prices,
-- quotes and confirms in its own currency, and a figure in another one is
-- refused on its way out (the numeral guard, part one).
--
--   · businesses.currency — chosen at sign-up from the country (asked when the
--     country's own money is not on the list); every workspace made before
--     this keeps USD, the only currency its prices could be in.
--   · The five checks of 0030, sample_policy's (0033) and owner_rates' (0031)
--     widen from USD (and CNY) to the plan's first list (decision 19): USD,
--     CNY, AED, SAR, BRL, MXN, INR, IDR. EUR and GBP join only with EU1.
--   · Prices get room: numeric(10,4) stops below a million, and a phone in
--     rupiah costs more than that. Unit prices and floors become (14,4),
--     totals (16,2), a sample's price (14,2). The columns keep their names
--     (`*_usd`): each amount has sat beside its own currency column since 0030.
--     `active_conversations_summary` reads one of them, so it is dropped and
--     made again — same definition, same caller's rights, same grants.
--   · `practice_refresh` copies the currency with the rest of the profile
--     (redefined here; 0090 is applied and never edited).
-- ---------------------------------------------------------------------------

alter table businesses add column if not exists currency text not null default 'USD';
alter table businesses add constraint businesses_currency_known check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR'));

alter table products       drop constraint products_currency_known,
                           add constraint products_currency_known check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR'));
alter table price_tiers    drop constraint price_tiers_currency_known,
                           add constraint price_tiers_currency_known check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR'));
alter table pricing_policy drop constraint pricing_policy_currency_known,
                           add constraint pricing_policy_currency_known check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR'));
alter table quotes         drop constraint quotes_currency_known,
                           add constraint quotes_currency_known check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR'));
alter table orders         drop constraint orders_currency_known,
                           add constraint orders_currency_known check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR'));
alter table sample_policy  drop constraint sample_policy_currency_check,
                           add constraint sample_policy_currency_known check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR'));
alter table owner_rates    drop constraint owner_rates_currencies_known,
                           add constraint owner_rates_currencies_known
                             check (from_currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR') and to_currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR'));

-- The view that reads a product's price: its grants, kept to be given back.
create temp table cur_view_grants as
  select g.grantee, g.privilege_type
    from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.table_name = 'active_conversations_summary'
     and g.grantee <> (select pg_get_userbyid(c.relowner) from pg_class c
                        where c.oid = 'public.active_conversations_summary'::regclass);
drop view active_conversations_summary;

alter table products       alter column price_usd_per_unit    type numeric(14,4);
alter table price_tiers    alter column unit_price_usd        type numeric(14,4);
alter table pricing_policy alter column floor_price_usd       type numeric(14,4);
alter table quotes         alter column unit_price_usd        type numeric(14,4),
                           alter column total_usd             type numeric(16,2);
alter table orders         alter column agreed_unit_price_usd type numeric(14,4),
                           alter column total_value_usd       type numeric(16,2);
alter table sample_policy  alter column price_amount          type numeric(14,2);
alter table order_proposals alter column unit_price           type numeric(14,4),
                            alter column total                type numeric(16,2);

create view active_conversations_summary with (security_invoker = true) as
 SELECT c.id AS conversation_id,
    c.business_id,
    c.client_id,
    c.channel,
    c.phase,
    c.is_active,
    c.assigned_to,
    cl.display_name AS client_name,
    cl.email AS client_email,
    cl.preferred_language,
    cl.is_vip,
    cs.identified_product_id,
    cs.product_confidence,
    cs.product_confirmed_by_client,
    cs.inquiry_quantity,
    cs.inquiry_unit,
    cs.client_email_collected,
    cs.escalation_score,
    cs.pending_question,
    cs.turn_count,
    cs.context_summary,
    cs.last_message_at,
    p.name AS product_name,
    p.sku AS product_sku,
    p.moq AS product_moq,
    p.price_usd_per_unit AS product_price_usd,
    p.lead_time_days,
    p.customizable AS product_customizable,
    pi.url AS product_primary_image_url
   FROM conversations c
     JOIN clients cl ON cl.id = c.client_id
     LEFT JOIN conversation_state cs ON cs.conversation_id = c.id
     LEFT JOIN products p ON p.id = cs.identified_product_id
     LEFT JOIN LATERAL ( SELECT product_images.url
           FROM product_images
          WHERE product_images.product_id = p.id AND product_images.is_primary = true
         LIMIT 1) pi ON true
  WHERE c.is_active = true;

do $$
declare g record;
begin
  for g in select grantee, privilege_type from cur_view_grants loop
    execute format('grant %s on active_conversations_summary to %s', g.privilege_type,
                   case when g.grantee = 'PUBLIC' then 'public' else quote_ident(g.grantee) end);
  end loop;
end $$;
drop table cur_view_grants;

create or replace function practice_refresh(p_live uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_copy uuid;
begin
  if p_live is null or p_live is distinct from current_business_id() then
    raise exception 'practice_refresh: only for the workspace you are in' using errcode = '42501';
  end if;
  if exists (select 1 from businesses where id = p_live and practice_of is not null) then
    raise exception 'practice_refresh: a practice copy has no practice of its own' using errcode = '42501';
  end if;

  -- The copy, on first use.
  select id into v_copy from businesses where practice_of = p_live;
  if v_copy is null then
    insert into businesses (id, name, practice_of, engine)
    select gen_random_uuid(), name, id, engine from businesses where id = p_live
    returning id into v_copy;
  end if;

  -- The profile, and the owner's own Stop — Practice's Stop binds on top of it.
  update businesses c set
    name = l.name, description = l.description, location = l.location, working_hours = l.working_hours,
    timezone = l.timezone, currency = l.currency, default_language = l.default_language, owner_locale = l.owner_locale,
    languages_served = l.languages_served, kind = l.kind, country = l.country, website = l.website,
    contact_email = l.contact_email, contact_phone = l.contact_phone, engine = l.engine,
    handoff_sla_minutes = l.handoff_sla_minutes, batch_debounce_ms = l.batch_debounce_ms,
    batch_max_window_ms = l.batch_max_window_ms, batch_max_fragments = l.batch_max_fragments,
    assistant_stopped_at = coalesce(l.assistant_stopped_at, c.practice_stopped_at),
    assistant_stopped_by = case when l.assistant_stopped_at is not null then l.assistant_stopped_by
                                when c.practice_stopped_at is not null then 'practice' end,
    outreach_area = false, is_active = l.is_active
  from businesses l
  where c.id = v_copy and l.id = p_live;

  -- Products, in place. SKUs are unique per business: park the copy's first,
  -- so two products that swapped SKUs never collide mid-statement.
  update products set sku = 'practice:' || id::text where business_id = v_copy;
  insert into products (id, business_id, source_id, sku, name, name_zh, description, category, unit, moq,
                        price_usd_per_unit, price_rmb_per_unit, lead_time_days, customizable, is_active, currency)
  select gen_random_uuid(), v_copy, p.id, p.sku, p.name, p.name_zh, p.description, p.category, p.unit, p.moq,
         p.price_usd_per_unit, p.price_rmb_per_unit, p.lead_time_days, p.customizable, p.is_active, p.currency
    from products p where p.business_id = p_live
  on conflict (business_id, source_id) where source_id is not null do update set
    sku = excluded.sku, name = excluded.name, name_zh = excluded.name_zh, description = excluded.description,
    category = excluded.category, unit = excluded.unit, moq = excluded.moq,
    price_usd_per_unit = excluded.price_usd_per_unit, price_rmb_per_unit = excluded.price_rmb_per_unit,
    lead_time_days = excluded.lead_time_days, customizable = excluded.customizable,
    is_active = excluded.is_active, currency = excluded.currency, updated_at = now();
  -- A product the owner removed is not deleted in the copy (Practice may have
  -- quoted it): it stops being offered.
  update products c set is_active = false
   where c.business_id = v_copy
     and not exists (select 1 from products l where l.business_id = p_live and l.id = c.source_id);

  -- The product's own rows, replaced whole.
  delete from price_tiers where product_id in (select id from products where business_id = v_copy);
  insert into price_tiers (product_id, min_qty, max_qty, unit_price_usd, currency)
  select c.id, t.min_qty, t.max_qty, t.unit_price_usd, t.currency
    from price_tiers t join products c on c.business_id = v_copy and c.source_id = t.product_id;
  delete from product_aliases where product_id in (select id from products where business_id = v_copy);
  insert into product_aliases (product_id, alias, language, alias_type)
  select c.id, a.alias, a.language, a.alias_type
    from product_aliases a join products c on c.business_id = v_copy and c.source_id = a.product_id;
  delete from product_images where product_id in (select id from products where business_id = v_copy);
  insert into product_images (product_id, url, is_primary, label, sort_order)
  select c.id, i.url, i.is_primary, i.label, i.sort_order
    from product_images i join products c on c.business_id = v_copy and c.source_id = i.product_id;

  -- What the owner taught: the active facts, a product's pointing at the copy's product.
  delete from product_knowledge where business_id = v_copy;
  insert into product_knowledge (business_id, product_id, kind, label, content, source_language, source, status)
  select v_copy, c.id, k.kind, k.label, k.content, k.source_language, k.source, k.status
    from product_knowledge k
    left join products c on c.business_id = v_copy and c.source_id = k.product_id
   where k.business_id = p_live and k.status = 'active' and (k.product_id is null or c.id is not null);

  -- Prices and the rules around them.
  delete from pricing_policy where business_id = v_copy;
  insert into pricing_policy (business_id, product_id, floor_price_usd, max_discount_pct, human_required_above_pct, currency)
  select v_copy, c.id, pp.floor_price_usd, pp.max_discount_pct, pp.human_required_above_pct, pp.currency
    from pricing_policy pp
    left join products c on c.business_id = v_copy and c.source_id = pp.product_id
   where pp.business_id = p_live and (pp.product_id is null or c.id is not null);
  delete from negotiation_rules where business_id = v_copy;
  insert into negotiation_rules (business_id, priority, condition, action, is_active)
  select v_copy, n.priority,
         case when n.condition ? 'productId'
              then jsonb_set(n.condition, '{productId}',
                             coalesce(to_jsonb((select c.id from products c where c.business_id = v_copy
                                                   and c.source_id::text = n.condition->>'productId')), 'null'::jsonb))
              else n.condition end,
         n.action, n.is_active
    from negotiation_rules n where n.business_id = p_live;
  delete from bundle_rules where business_id = v_copy;
  insert into bundle_rules (business_id, name, requires, grants, is_active)
  select v_copy, b.name,
         array(select c.id from unnest(b.requires) r join products c on c.business_id = v_copy and c.source_id = r),
         b.grants, b.is_active
    from bundle_rules b where b.business_id = p_live;
  delete from substitution_rules where business_id = v_copy;
  insert into substitution_rules (business_id, product_id, substitute_id, reason, rank)
  select v_copy, a.id, s.id, r.reason, r.rank
    from substitution_rules r
    join products a on a.business_id = v_copy and a.source_id = r.product_id
    join products s on s.business_id = v_copy and s.source_id = r.substitute_id
   where r.business_id = p_live;

  -- What she may say, and when the business is closed.
  delete from claims_policy where business_id = v_copy;
  insert into claims_policy (business_id, kind, claim_key, allowed, detail)
  select v_copy, kind, claim_key, allowed, detail from claims_policy where business_id = p_live;
  delete from forbidden_terms where business_id = v_copy;
  insert into forbidden_terms (business_id, term, note, archived_at)
  select v_copy, term, note, archived_at from forbidden_terms where business_id = p_live;
  delete from factory_closures where business_id = v_copy;
  insert into factory_closures (business_id, label, starts_on, ends_on, archived_at)
  select v_copy, label, starts_on, ends_on, archived_at from factory_closures where business_id = p_live;

  -- Insert-only history: the current row only.
  delete from sample_policy where business_id = v_copy;
  insert into sample_policy (business_id, price_amount, currency, credited_on_first_order, stated_at, stated_by)
  select v_copy, price_amount, currency, credited_on_first_order, stated_at, stated_by
    from sample_policy where business_id = p_live order by stated_at desc limit 1;
  delete from trade_terms where business_id = v_copy;
  insert into trade_terms (business_id, payment_terms, incoterm, stated_at, stated_by)
  select v_copy, payment_terms, incoterm, stated_at, stated_by
    from trade_terms where business_id = p_live order by stated_at desc limit 1;
  delete from owner_rates where business_id = v_copy;
  insert into owner_rates (business_id, from_currency, to_currency, rate, stated_at, stated_by)
  select distinct on (from_currency, to_currency) v_copy, from_currency, to_currency, rate, stated_at, stated_by
    from owner_rates where business_id = p_live order by from_currency, to_currency, stated_at desc;

  -- The assistant, in place (Practice's conversations name it), and its name's confirmation.
  update assistants set is_default = false where business_id = v_copy;
  insert into assistants (id, business_id, source_id, name, role, note, channels, is_default, created_by, archived_at)
  select gen_random_uuid(), v_copy, a.id, a.name, a.role, a.note, a.channels, a.is_default, 'practice', a.archived_at
    from assistants a where a.business_id = p_live
  on conflict (business_id, source_id) where source_id is not null do update set
    name = excluded.name, role = excluded.role, note = excluded.note, channels = excluded.channels,
    is_default = excluded.is_default, archived_at = excluded.archived_at;
  update assistants c set archived_at = coalesce(c.archived_at, now())
   where c.business_id = v_copy
     and not exists (select 1 from assistants l where l.business_id = p_live and l.id = c.source_id);
  insert into onboarding_state (business_id, assistant_named_at)
  select v_copy, assistant_named_at from onboarding_state where business_id = p_live
  on conflict (business_id) do update set assistant_named_at = excluded.assistant_named_at, updated_at = now();

  -- How much she may do alone — the owner's levels, or, while the owner looks
  -- at Practice "as if sending alone" (0090), every capability alone: it lifts
  -- the owner's level and nothing else; every other hold still applies.
  delete from autonomy_policy where business_id = v_copy;
  if (select practice_alone from businesses where id = v_copy) then
    insert into autonomy_policy (business_id, capability, mode)
    select v_copy, c, 'auto'
      from unnest(array['greet', 'qualify', 'recommend', 'quote', 'negotiate', 'confirm_order', 'follow_up']) as c;
  else
    insert into autonomy_policy (business_id, capability, mode, auto_after_clean_approvals, time_window)
    select v_copy, capability, mode, auto_after_clean_approvals, time_window from autonomy_policy where business_id = p_live;
  end if;
  -- …and the operator's switches over her.
  delete from ops_flags where business_id = v_copy;
  insert into ops_flags (business_id, flag, capability, reason, set_by, set_at)
  select v_copy, flag, capability, reason, set_by, set_at from ops_flags where business_id = p_live and cleared_at is null;

  return v_copy;
end $$;
revoke all on function practice_refresh(uuid) from public;
grant execute on function practice_refresh(uuid) to nomi_app;

insert into _migrations (version, name) values (92, 'workspace_currency')
on conflict (version) do nothing;
