-- 0094 — the import review, kept (K1, K3), and "prices go to me" (K5).
-- The onboarding plan's Stage 2 ("Show it what you sell"), 2026-10-01.
--
-- Until now an import lived only in the review page's hidden field: the lines
-- went back and forth, the confirm re-read them, and nothing was kept. A photo
-- was read and thrown away. So the owner could not remove one row, fix a name,
-- say what a price is per, keep the photo beside the lines, or be asked to
-- type three prices from the paper before confirming (K7) — and a product
-- could not say where it came from.
--
--   · `catalog_imports` — one import, open until confirmed or dropped. Its
--     rows (what was read, what the owner changed, the flags, the ticks, the
--     three challenge rows) are one jsonb list: the review edits them as a
--     whole, and nothing else reads them.
--   · `catalog_import_photos` — each photo of an import and the text read
--     from it. Kept after the import is confirmed: a product added from a
--     photo points at it (K3), so "where did this price come from?" has the
--     paper as its answer.
--   · `products.source_line / source_photo_id / source_import_id` (K3).
--   · `businesses.prices_to_owner` (K5): the business states no price; every
--     price question goes to the owner. Setup's products step accepts it.
--   · a signal, `price_to_owner`, for the hand-off K5 makes;
--   · audit verbs: `product_imported` (one row per product an import added),
--     `import_confirmed`, `prices_to_owner_set`.
--
-- None of it belongs to a customer: a customer's erasure never reaches these
-- tables, and a workspace's erasure takes them (both tools find a table by its
-- columns). The practice copy takes none of the import tables; it copies the
-- new business column with the profile, so a business whose prices go to the
-- owner practises that way.

create table if not exists catalog_imports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  -- paste: typed or pasted lines · photo: one or more photos of a printed list
  -- · store: a shop's public product feed · file: a store's exported file (K8)
  kind text not null check (kind in ('paste', 'photo', 'store', 'file')),
  state text not null default 'open' check (state in ('open', 'confirmed', 'dropped')),
  -- The workspace's currency when it was read: every price in the rows is in it.
  currency text not null check (currency in ('USD', 'CNY', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'IDR')),
  -- The paste as it came, or the store's address; photos keep their own text.
  source_text text,
  rows jsonb not null default '[]'::jsonb check (jsonb_typeof(rows) = 'array'),
  -- K7 — a challenge row the owner typed differently: every row needs its own tick.
  check_every_row boolean not null default false,
  -- K2 — the discount the owner allowed, which sets each new product's floor.
  discount_pct numeric(5, 2) check (discount_pct is null or (discount_pct >= 0 and discount_pct < 100)),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by text,
  constraint catalog_imports_confirmed check ((state = 'confirmed') = (confirmed_at is not null))
);
create index if not exists catalog_imports_business_open
  on catalog_imports (business_id, created_at desc) where state = 'open';

create table if not exists catalog_import_photos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  import_id uuid not null references catalog_imports(id),
  position integer not null check (position between 1 and 20),
  media_type text not null check (media_type in ('image/jpeg', 'image/png', 'image/webp')),
  bytes bytea not null check (octet_length(bytes) between 1 and 8388608),
  -- What the reader made of it; the owner may correct it before the rows are read again.
  transcript text not null,
  created_at timestamptz not null default now(),
  unique (import_id, position)
);

alter table products
  add column if not exists source_line text,
  add column if not exists source_import_id uuid references catalog_imports(id),
  add column if not exists source_photo_id uuid references catalog_import_photos(id);

alter table businesses
  add column if not exists prices_to_owner boolean not null default false;

do $$
declare t text;
begin
  foreach t in array array['catalog_imports', 'catalog_import_photos'] loop
    execute format('alter table %I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_tenant') then
      execute format('create policy %I on %I for all to nomi_app using (business_id = current_business_id()) with check (business_id = current_business_id())', t || '_tenant', t);
    end if;
    execute format('grant select, insert, update on %I to nomi_app', t);
    execute format('revoke delete, truncate on %I from nomi_app', t);
  end loop;
end $$;

-- K5 — "prices go to me": a price question handed to the owner.
-- EVERY EXISTING KIND IS COPIED FROM THE LIVE CONSTRAINT (0077's list, both checks).
alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered',
    'price_to_owner'));

-- …and the hand-off's reason on the escalation trail (0077's list, plus the one).
alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered',
    'price_to_owner'));

-- The audit verbs (0076's list, copied from the live constraint, plus three).
alter table channel_audit drop constraint if exists channel_audit_action_check;
alter table channel_audit add constraint channel_audit_action_check
  check (action in ('connect','reconnect','disconnect','test','rotate_credential',
                    'set_owner_phone','update_profile','activate','deactivate',
                    'blocked_not_allowlisted','allowlist_add','allowlist_archive',
                    'send_refused','activation_refused','product_edited',
                    'price_rules_set','transcript_corrected',
                    'assistant_added','assistant_changed','assistant_archived',
                    'export_data','deletion_requested','deletion_withdrawn',
                    'assistant_stop','assistant_start',
                    'deletion_dismissed',
                    'product_imported','import_confirmed','prices_to_owner_set'));

-- The practice copy practises as the business sells: "prices go to me" is
-- copied with the profile. 0092's refresh, with that one column added.
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
    timezone = l.timezone, currency = l.currency, prices_to_owner = l.prices_to_owner, default_language = l.default_language, owner_locale = l.owner_locale,
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

insert into _migrations (version, name) values (94, 'catalog_imports')
on conflict (version) do nothing;
