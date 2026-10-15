-- ---------------------------------------------------------------------------
-- 0163 — A WITHDRAWAL IS NARROWED TO THE LANGUAGE IT HAPPENED IN (the owner,
-- 2026-10-15: "Narrow it to the language it happened in… Leave the
-- earned-rung part alone for now.")
--
-- Before: a reply the assistant kept that failed its guards (twice over, or an
-- Arabic reply it could not write without a gender) dropped the capability to
-- "waits" in `autonomy_policy`, which is keyed (workspace, capability) — so one
-- Arabic reply made English and Chinese buyers wait too.
--
-- Now the turn records the withdrawal for (capability, language) here and
-- leaves `autonomy_policy` as the owner set it; the send decision reads both.
-- A withdrawal stays until the owner chooses a level again, or grants the
-- capability, on the assistant's page (`lifted_at`, `lifted_by`). A reply
-- whose language nobody could tell still withdraws the capability everywhere,
-- as before: such a reply never goes alone anyway, so there is no narrower
-- place to put it.
--
-- Unchanged, on purpose: the earned rung is cleared as before (the owner:
-- "leave it alone for now"), and a spot check's withdrawal (the owner's verdict
-- on work sent alone) still spans every language.
-- ---------------------------------------------------------------------------

create table if not exists language_withdrawals (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  capability       text not null,
  language         text not null check (language ~ '^[a-z]{2,3}$'),
  withdrawn_at     timestamptz not null default now(),
  reasons          text[] not null default '{}',
  lifted_at        timestamptz,
  lifted_by        text,
  check ((lifted_at is null) = (lifted_by is null))
);

-- One open withdrawal per capability and language: a second failure while one
-- stands changes nothing.
create unique index if not exists language_withdrawals_open
  on language_withdrawals (business_id, capability, language) where lifted_at is null;

alter table language_withdrawals enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'language_withdrawals' and policyname = 'language_withdrawals_tenant') then
    create policy language_withdrawals_tenant on language_withdrawals
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

grant select, insert, update on language_withdrawals to nomi_app;
revoke delete, truncate on language_withdrawals from nomi_app;

-- The language the system's own step back was narrowed to; null = every language.
alter table capability_events add column if not exists language text
  check (language is null or language ~ '^[a-z]{2,3}$');

-- The five-minute alert names the language: each untold step back narrowed to
-- one as 'capability:language' (`narrowed`), and the capabilities that stepped
-- back in every language (`everywhere`), beside the list it always returned.
-- The return type changes, so the function is dropped and made again; the app
-- reads it by column name.
drop function if exists claim_self_demotions();
create function claim_self_demotions()
returns table (business_id uuid, capabilities text[], reasons text[], narrowed text[], everywhere text[])
language plpgsql volatile security definer set search_path = public as $$
begin
  return query
  with told as (
    update capability_events ce set alerted_at = now()
     where ce.actor = 'system_self_demoted' and ce.alerted_at is null
    returning ce.business_id, ce.capability, ce.reasons, ce.language
  )
  select t.business_id,
         array_agg(distinct t.capability order by t.capability),
         coalesce((select array_agg(distinct r order by r) from told t2, unnest(t2.reasons) r
                    where t2.business_id = t.business_id and r <> ''), '{}'),
         coalesce(array_agg(distinct t.capability || ':' || t.language order by t.capability || ':' || t.language)
                    filter (where t.language is not null), '{}'),
         coalesce(array_agg(distinct t.capability order by t.capability) filter (where t.language is null), '{}')
    from told t
    join businesses b on b.id = t.business_id and b.practice_of is null and b.is_active
   group by t.business_id;
end $$;
revoke all on function claim_self_demotions() from public;
grant execute on function claim_self_demotions() to nomi_app;

-- 0095's refresh, and the withdrawals in it (practice-copy.test.ts holds every copied table to the refresh).
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
    timezone = l.timezone, currency = l.currency, prices_to_owner = l.prices_to_owner,
    quantity_first = l.quantity_first, default_language = l.default_language, owner_locale = l.owner_locale,
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
  -- 0163 — and the languages a capability stands withdrawn from: Practice answers as the workspace would, in every
  -- language. "As if sending alone" (0090) lifts the owner's level, never these: a withdrawal is a hold.
  delete from language_withdrawals where business_id = v_copy;
  insert into language_withdrawals (business_id, capability, language, withdrawn_at, reasons)
  select v_copy, capability, language, withdrawn_at, reasons from language_withdrawals
   where business_id = p_live and lifted_at is null;

  return v_copy;
end $$;
revoke all on function practice_refresh(uuid) from public;
grant execute on function practice_refresh(uuid) to nomi_app;

-- 0162's contract, and the new table in it (D19, 0144): without it every customer erasure would refuse.
create or replace function customer_erasure_contract()
returns table (tbl text, action text, clear text[], blank text[], detach text[], match text)
language sql immutable set search_path = public as $$
  values
    ('clients', 'anonymise', array['display_name','email','phone','country','preferred_language','notes'], null::text[], null::text[], null::text),
    ('client_channels', 'erase', null, null, null, null),
    ('conversations', 'shell', array['assigned_to','assigned_at','ai_disclosed_at','ai_disclosure_delivered_at','owner_unsent_reply','owner_unsent_reply_at'], null, null, null),
    ('messages', 'erase', null, null, null, null),
    ('message_fragments', 'erase', null, null, null, null),
    ('turns', 'erase', null, null, null, null),
    ('drafts', 'erase', null, null, null, null),
    ('conversation_state', 'erase', null, null, null, null),
    ('conversation_signals', 'erase', null, null, null, null),
    ('conversation_events', 'erase', null, null, null, null),
    ('conversation_notes', 'erase', null, null, null, null),
    ('escalation_events', 'erase', null, null, null, null),
    ('handoffs', 'erase', null, null, null, null),
    ('sample_requests', 'erase', null, null, null, null),
    ('quotes', 'erase-unless-kept', null, null, null, null),
    ('quote_proofs', 'erase', null, null, null, null),
    ('outbound_messages', 'erase', null, null, null, null),
    ('outbound_transitions', 'erase', null, null, null, null),
    ('deliveries', 'erase', null, null, null, null),
    ('repairs', 'erase', null, null, null, null),
    ('shadow.turn_decisions', 'erase', null, null, null, null),
    ('spot_checks', 'detach', array['correction'], null, array['conversation_id'], null),
    ('orders', 'keep', array['client_email','shipping_address','notes','tracking_reference','proforma_token'], null, null, null),
    ('order_updates', 'keep', array['note','tracking_reference'], null, null, null),
    ('email_confirmations', 'keep', array['subject','body_html'], array['to_email'], null, null),
    ('sequence_enrollments', 'erase', null, null, null, 'identity'),
    ('sequence_sends', 'erase', null, null, null, null),
    ('contacts', 'erase', null, null, null, 'identity'),
    ('contact_consent', 'erase', null, null, null, 'identity'),
    ('pilot_allowlist', 'erase', null, null, null, 'phone'),
    ('suppressions', 'keep', array['detail'], null, null, 'identity'),
    ('opt_outs', 'keep-standing', null, null, null, 'any-identity'),
    ('deletion_requests', 'keep', array['subject_note'], null, null, null),
    ('deletion_asks', 'erase', null, null, null, null),
    ('customers_answered', 'erase', null, null, null, null),
    ('order_proposals', 'erase', null, null, null, null),
    ('promised_dates', 'erase', null, null, null, null),
    ('client_faces', 'erase', null, null, null, null),
    ('channel_events', 'receipts', null, null, null, null),
    ('channel_audit', 'redact', null, null, null, null),
    ('logins', 'unrelated', null, null, null, null),
    ('login_codes', 'unrelated', null, null, null, null),
    ('advisor_turn_subjects', 'erase', null, null, null, null),
    ('advisor_turns', 'erase', null, null, null, null),
    ('advisor_threads', 'erase', null, null, null, null),
    -- D19 (0144) — the workspace's own settings and rules.
    ('autonomy_policy', 'unrelated', null, null, null, null),
    ('bundle_rules', 'unrelated', null, null, null, null),
    ('claims_policy', 'unrelated', null, null, null, null),
    ('factory_closures', 'unrelated', null, null, null, null),
    ('forbidden_terms', 'unrelated', null, null, null, null),
    ('negotiation_rules', 'unrelated', null, null, null, null),
    ('onboarding_state', 'unrelated', null, null, null, null),
    ('outreach_settings', 'unrelated', null, null, null, null),
    ('owner_rates', 'unrelated', null, null, null, null),
    ('pricing_policy', 'unrelated', null, null, null, null),
    ('sample_policy', 'unrelated', null, null, null, null),
    ('selling_answers', 'unrelated', null, null, null, null),
    ('substitution_rules', 'unrelated', null, null, null, null),
    ('trade_terms', 'unrelated', null, null, null, null),
    ('tenant_budgets', 'unrelated', null, null, null, null),
    ('assistants', 'unrelated', null, null, null, null),
    -- D19 (0144) — its catalogue and what the owner taught.
    ('products', 'unrelated', null, null, null, null),
    ('product_knowledge', 'unrelated', null, null, null, null),
    ('catalog_imports', 'unrelated', null, null, null, null),
    ('catalog_import_photos', 'unrelated', null, null, null, null),
    ('knowledge_proposals', 'unrelated', null, null, null, null),
    -- D19 (0144) — its channels and connections.
    ('channels', 'unrelated', null, null, null, null),
    ('channel_credentials', 'unrelated', null, null, null, null),
    ('channel_sources', 'unrelated', null, null, null, null),
    ('connector_credentials', 'unrelated', null, null, null, null),
    ('connection_approvals', 'unrelated', null, null, null, null),
    ('mail_accounts', 'unrelated', null, null, null, null),
    ('meta_accounts', 'unrelated', null, null, null, null),
    ('whatsapp_accounts', 'unrelated', null, null, null, null),
    ('whatsapp_templates', 'unrelated', null, null, null, null),
    ('sending_domains', 'unrelated', null, null, null, null),
    -- D19 (0144) — the people who work there, and their own records.
    ('people', 'unrelated', null, null, null, null),
    ('agents', 'unrelated', null, null, null, null),
    ('login_setups', 'unrelated', null, null, null, null),
    ('push_subscriptions', 'unrelated', null, null, null, null),
    ('advisor_consents', 'unrelated', null, null, null, null),
    -- D19 (0144) — outreach sequences as written, before anyone is enrolled.
    ('sequences', 'unrelated', null, null, null, null),
    ('sequence_steps', 'unrelated', null, null, null, null),
    -- D19 (0144) — billing, usage and plan.
    ('payments', 'unrelated', null, null, null, null),
    ('stripe_events', 'unrelated', null, null, null, null),
    ('subscriptions', 'unrelated', null, null, null, null),
    ('workspace_billing', 'unrelated', null, null, null, null),
    ('workspace_suspensions', 'unrelated', null, null, null, null),
    ('usage_ledger', 'unrelated', null, null, null, null),
    ('allowance_alerts', 'unrelated', null, null, null, null),
    ('retention_notices', 'unrelated', null, null, null, null),
    -- D19 (0144) — operations: flags, practice counts, the assistant's capability history (counts), the erasure ledger (ids and counts).
    ('ops_flags', 'unrelated', null, null, null, null),
    ('practice_checks', 'unrelated', null, null, null, null),
    ('practice_totals', 'unrelated', null, null, null, null),
    ('capability_events', 'unrelated', null, null, null, null),
    ('erasure_ledger', 'unrelated', null, null, null, null),
    -- D19 (0144) — words the owner or the operator wrote, never linked to a customer: a calendar entry, the pilot's log.
    ('calendar_entries', 'unrelated', null, null, null, null),
    ('pilot_log', 'unrelated', null, null, null, null),
    -- D19 (0144) — a company's public facts, looked up by its domain.
    ('organization_enrichments', 'unrelated', null, null, null, null),
    -- D19 (0144) — errors, with no value they carried (D19: messages stored without quoted values).
    ('app_errors', 'unrelated', null, null, null, null),
    -- D4 (0147) — the record that a waiting deletion request was chased: ids and dates, Nomi's own.
    ('deletion_chases', 'unrelated', null, null, null, null),
    -- Phase 1 (0148) — how the workspace signed up, as the abuse score decided it: the workspace's own, never a
    -- customer's. (`signup_marks` holds no business at all.)
    ('signup_risk', 'unrelated', null, null, null, null),
    -- Phase 2a (0150) — the morning summary's claims: a day and what came of it, the owner's own, never a customer's.
    ('morning_summaries', 'unrelated', null, null, null, null),
    -- 0162 — the workspace's count of its own orders: numbers, never a customer's.
    ('order_numbers', 'unrelated', null, null, null, null),
    -- 0163 — a capability withdrawn in one language: the assistant's record, no customer in it.
    ('language_withdrawals', 'unrelated', null, null, null, null)
$$;

revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (163, 'language_withdrawals')
  on conflict (version) do nothing;
