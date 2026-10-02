-- 0122 — a name a customer uses can be taken off a product (phase 9 of the UI
-- rebuild, V1-313). The product page lists the names a product is found by,
-- and none could be removed: `product_aliases` has no archive column, and the
-- app role deletes nothing anywhere, by design.
--
-- That stays true. The one removal is this function: it takes ONE name off ONE
-- product of the business the transaction is for (`current_business_id()`),
-- and never the product's own name or its Chinese name — those are written
-- back by every edit (`addAliases`), and a product found by no name cannot be
-- quoted. Matching reads the table as it is (`search_products`, 0007), so a
-- name taken off is not matched from the next message on; nothing else moves.
-- The caller writes the removal on the audit trail, so the word is kept there.

create or replace function remove_product_alias(p_product_id uuid, p_alias text)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  v_n integer;
begin
  delete from product_aliases pa
   using products p
   where pa.product_id = p_product_id
     and p.id = pa.product_id
     and p.business_id = current_business_id()
     and lower(pa.alias) = lower(p_alias)
     and lower(pa.alias) <> lower(p.name)
     and (p.name_zh is null or lower(pa.alias) <> lower(p.name_zh));
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

revoke all on function remove_product_alias(uuid, text) from public;
grant execute on function remove_product_alias(uuid, text) to nomi_app;

insert into _migrations (version, name) values (122, 'alias_remove')
on conflict (version) do nothing;
