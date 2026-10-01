-- 0107 — the first quote of each product waits for the owner (R3, the
-- onboarding plan's phase 6; decision 9).
--
-- A price question is answered from the catalogue, and a catalogue row the
-- owner has never seen quoted is the one place a misread price goes out
-- unnoticed. So for a workspace that signed itself up, a reply that states a
-- product's price goes alone only after the owner has sent one quote of that
-- product themselves. A new product starts unvetted; any change to its price —
-- the product's own price or currency, or any of its price tiers — makes it
-- unvetted again, by trigger, whoever writes it.
--
--   · products.quote_vetted_at — when the owner sent its first quote.
--   · quote_vetted(product) — for the CURRENT business, from the workspace
--     that pays: always yes where the operator made the workspace or opened
--     it as a pilot (the ramp does not bind it, as `earned_rung()`); a
--     practice copy answers for its product's source.

alter table products add column if not exists quote_vetted_at timestamptz;

create or replace function products_price_unvets() returns trigger
language plpgsql as $$
begin
  if new.price_usd_per_unit is distinct from old.price_usd_per_unit or new.currency is distinct from old.currency then
    new.quote_vetted_at := null;
  end if;
  return new;
end $$;
drop trigger if exists products_price_unvets on products;
create trigger products_price_unvets before update of price_usd_per_unit, currency on products
  for each row execute function products_price_unvets();

create or replace function price_tiers_unvet() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update products set quote_vetted_at = null
   where id = coalesce(new.product_id, old.product_id) and quote_vetted_at is not null;
  return null;
end $$;
drop trigger if exists price_tiers_unvet on price_tiers;
create trigger price_tiers_unvet after insert or update or delete on price_tiers
  for each row execute function price_tiers_unvet();

create or replace function quote_vetted(p_product uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
             when p.signed_up_at is null then true
             when p.auto_earned_by is not null and p.auto_earned_by <> 'ramp' then true
             else exists (select 1 from products pr
                           where pr.business_id = p.id and pr.quote_vetted_at is not null
                             and pr.id = coalesce((select src.source_id from products src
                                                    where src.id = p_product and src.business_id = me.id), p_product))
           end
      from businesses me
      join businesses p on p.id = coalesce(me.practice_of, me.id)
     where me.id = current_business_id()), false);
$$;
revoke all on function quote_vetted(uuid) from public;
grant execute on function quote_vetted(uuid) to nomi_app;

insert into _migrations (version, name) values (107, 'first_quote')
on conflict (version) do nothing;
