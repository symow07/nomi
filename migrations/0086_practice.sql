-- ---------------------------------------------------------------------------
-- 0086 — PRACTICE, PER WORKSPACE (P2; the owner's decision of 2026-09-30;
-- docs/PRACTICE.md).
--
-- One shared practice sandbox that every signed-in owner could read and reset
-- was a data leak as soon as there are two customers (#129 limited it to the
-- pilot workspace). Now each workspace gets its own PRACTICE COPY: a second
-- business row, `practice_of` the owner's, holding what the assistant needs to
-- answer as this business — never anyone real.
--
--   · `businesses.practice_of` — the workspace a copy practises for; one copy
--     each; the copy goes with it. `practice_stopped_at` — Practice's own Stop,
--     on top of the owner's real one (which is copied in).
--   · `products.source_id`, `assistants.source_id` — the live row a copy row
--     mirrors. Practice's own quotes, orders, conversation state and
--     conversations reference these with no cascade, so they are refreshed IN
--     PLACE; every other copied table is replaced whole.
--   · `practice_refresh(live)` — creates the copy on first use and brings it in
--     line with the live workspace, in one transaction, before every practice
--     turn. A definer function: the app role has no DELETE, and three of the
--     copied tables are insert-only history. Only for the workspace the caller
--     is in (`current_business_id()`), and never for a copy.
--   · A trigger refuses, on a practice business, every channel, credential,
--     sending identity, person and login: a copy can reach nobody, by
--     construction rather than by seed data.
--
-- What is copied and what is not: tests/integration/practice-tables.ts, held against the
-- schema by tests/integration/practice-copy.test.ts.
-- ---------------------------------------------------------------------------

alter table businesses add column if not exists practice_of uuid references businesses(id) on delete cascade;
alter table businesses add column if not exists practice_stopped_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_practice_not_self') then
    alter table businesses add constraint businesses_practice_not_self check (practice_of is distinct from id);
  end if;
end $$;
create unique index if not exists businesses_one_practice on businesses (practice_of) where practice_of is not null;

alter table products add column if not exists source_id uuid;
create unique index if not exists products_practice_source on products (business_id, source_id) where source_id is not null;
alter table assistants add column if not exists source_id uuid;
create unique index if not exists assistants_practice_source on assistants (business_id, source_id) where source_id is not null;

-- ── Nobody real, by construction ────────────────────────────────────────────
create or replace function practice_refuses() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from businesses where id = new.business_id and practice_of is not null) then
    raise exception 'a practice workspace has no channel, credential, sending identity, person or login (%)', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['channels', 'channel_credentials', 'channel_sources', 'connector_credentials',
                           'meta_accounts', 'mail_accounts', 'sending_domains', 'people', 'logins'] loop
    if not exists (select 1 from pg_trigger where tgname = t || '_practice_refuses') then
      execute format('create trigger %I before insert or update on %I for each row execute function practice_refuses()',
                     t || '_practice_refuses', t);
    end if;
  end loop;
end $$;

-- ── The refresh ─────────────────────────────────────────────────────────────
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
    timezone = l.timezone, default_language = l.default_language, owner_locale = l.owner_locale,
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

  -- How much she may do alone, and the operator's switches over her.
  delete from autonomy_policy where business_id = v_copy;
  insert into autonomy_policy (business_id, capability, mode, auto_after_clean_approvals, time_window)
  select v_copy, capability, mode, auto_after_clean_approvals, time_window from autonomy_policy where business_id = p_live;
  delete from ops_flags where business_id = v_copy;
  insert into ops_flags (business_id, flag, capability, reason, set_by, set_at)
  select v_copy, flag, capability, reason, set_by, set_at from ops_flags where business_id = p_live and cleared_at is null;

  return v_copy;
end $$;
revoke all on function practice_refresh(uuid) from public;
grant execute on function practice_refresh(uuid) to nomi_app;

-- ── Copies are not workspaces ───────────────────────────────────────────────
-- The hourly Meta-errors check reads every workspace's sends; a copy's go to
-- the practice adapter, never to Meta, and would count as sends that could
-- not fail. Redefined here (0085 is applied and never edited).
create or replace function meta_error_rates(p_since timestamptz)
returns table (business_id uuid, business_name text, attempted integer, failed integer, errors text[])
language sql stable security definer set search_path = public as $$
  select o.business_id, b.name,
         count(*)::int as attempted,
         count(*) filter (where o.status in ('failed', 'uncertain'))::int as failed,
         coalesce((array_agg(distinct left(o.last_error, 60))
                    filter (where o.status in ('failed', 'uncertain') and o.last_error is not null))[1:5], '{}') as errors
    from outbound_messages o
    join businesses b on b.id = o.business_id
   where coalesce(o.channel, 'whatsapp') in ('whatsapp', 'instagram', 'messenger')
     and o.status in ('sent', 'delivered', 'read', 'failed', 'uncertain')
     and o.created_at >= p_since
     and b.practice_of is null
   group by o.business_id, b.name
$$;
revoke all on function meta_error_rates(timestamptz) from public;
grant execute on function meta_error_rates(timestamptz) to nomi_app;

insert into _migrations (version, name) values (86, 'practice')
on conflict (version) do nothing;
