-- The owner's selected WhatsApp catalogue. No trigger or write on any send-path table.
create table wa_catalogue_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  retailer_id text not null unique default ('nomi_' || replace(gen_random_uuid()::text, '-', '')),
  description text not null default '', product_url text not null default '',
  availability text not null default '', brand text not null default '', condition text not null default 'new',
  image_id uuid references product_images(id) on delete set null,
  account_id uuid references whatsapp_accounts(id) on delete set null,
  catalog_id text, accepted_fingerprint text, accepted_snapshot jsonb,
  state text not null default 'not_submitted' check(state in ('not_submitted','pending','synced','error','unknown','removed')),
  error text, updated_at timestamptz not null default now(),
  unique(business_id, product_id), unique(business_id, id)
);
create table wa_catalogue_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  account_id uuid not null references whatsapp_accounts(id) on delete cascade,
  catalog_id text not null, created_by text not null,
  state text not null default 'preview' check(state in ('preview','submitting','pending','finished','failed','unknown','empty')),
  handle text, error text, created_at timestamptz not null default now(), submitted_at timestamptz, checked_at timestamptz,
  unique(business_id, id)
);
create index wa_catalogue_batches_recent on wa_catalogue_batches(business_id, created_at desc);
create table wa_catalogue_batch_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  batch_id uuid not null, item_id uuid not null,
  operation text not null check(operation in ('CREATE','UPDATE','DELETE')),
  fingerprint text not null, snapshot jsonb not null,
  selected boolean not null default false,
  result text not null default 'preview' check(result in ('preview','pending','synced','failed','unknown')),
  error text, warning text,
  foreign key(business_id,batch_id) references wa_catalogue_batches(business_id,id) on delete cascade,
  foreign key(business_id,item_id) references wa_catalogue_items(business_id,id) on delete cascade,
  unique(batch_id,item_id), unique(business_id,id)
);
create table wa_catalogue_images (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  item_id uuid not null, batch_item_id uuid not null,
  image_id uuid not null references product_images(id) on delete cascade,
  image_version text not null,
  token text not null unique check(length(token) = 43),
  state text not null check(state in ('submitted','published','revoked')),
  pending_until timestamptz not null, published_at timestamptz,
  foreign key(business_id,item_id) references wa_catalogue_items(business_id,id) on delete cascade,
  foreign key(business_id,batch_item_id) references wa_catalogue_batch_items(business_id,id) on delete cascade,
  unique(business_id,id)
);
create index wa_catalogue_images_item on wa_catalogue_images(business_id,item_id,state);
create table wa_catalogue_sends (
  outbound_id uuid primary key references outbound_messages(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  item_id uuid not null,
  catalog_id text not null, retailer_id text not null, name text not null,
  price text not null, currency text not null, fingerprint text not null,
  foreign key(business_id,item_id) references wa_catalogue_items(business_id,id) on delete cascade
);

-- Existing parents have globally unique ids. Check their tenant under the caller's RLS too.
create function wa_catalogue_check_parents() returns trigger language plpgsql set search_path = public as $$
declare row_data jsonb := to_jsonb(new); ref record; parent_id uuid; parent_business uuid; image_product uuid;
begin
  for ref in select * from (values
    ('wa_catalogue_items','product_id','products'), ('wa_catalogue_items','image_id','product_images'),
    ('wa_catalogue_items','account_id','whatsapp_accounts'), ('wa_catalogue_batches','account_id','whatsapp_accounts'),
    ('wa_catalogue_images','image_id','product_images'), ('wa_catalogue_sends','outbound_id','outbound_messages')
  ) as refs(child,col,parent) where child = tg_table_name loop
    parent_id := (row_data->>ref.col)::uuid;
    if parent_id is null then continue; end if;
    if ref.parent = 'product_images' then
      select p.business_id, p.id into parent_business, image_product
        from product_images i join products p on p.id=i.product_id where i.id=parent_id;
      if tg_table_name='wa_catalogue_items' and image_product is distinct from (row_data->>'product_id')::uuid then
        raise foreign_key_violation using message='catalogue photo belongs to a different product';
      end if;
      if tg_table_name='wa_catalogue_images' and not exists
        (select 1 from wa_catalogue_items where id=(row_data->>'item_id')::uuid and business_id=new.business_id and product_id=image_product) then
        raise foreign_key_violation using message='catalogue publication belongs to a different product';
      end if;
    else
      execute format('select business_id from %I where id=$1', ref.parent) into parent_business using parent_id;
    end if;
    if parent_business is distinct from new.business_id then
      raise foreign_key_violation using message='catalogue reference is outside this workspace';
    end if;
  end loop;
  if tg_table_name='wa_catalogue_images' and not exists
    (select 1 from wa_catalogue_batch_items where id=(row_data->>'batch_item_id')::uuid and business_id=new.business_id and item_id=(row_data->>'item_id')::uuid) then
    raise foreign_key_violation using message='catalogue publication belongs to a different batch item';
  end if;
  return new;
end $$;
revoke all on function wa_catalogue_check_parents() from public;
create trigger wa_catalogue_items_parents before insert or update of business_id,product_id,image_id,account_id on wa_catalogue_items
  for each row execute function wa_catalogue_check_parents();
create trigger wa_catalogue_batches_parents before insert or update of business_id,account_id on wa_catalogue_batches
  for each row execute function wa_catalogue_check_parents();
create trigger wa_catalogue_images_parents before insert or update of business_id,item_id,batch_item_id,image_id on wa_catalogue_images
  for each row execute function wa_catalogue_check_parents();
create trigger wa_catalogue_sends_parents before insert or update of business_id,outbound_id on wa_catalogue_sends
  for each row execute function wa_catalogue_check_parents();
-- A practice copy reaches nobody (0086): it sends no product card.
create trigger wa_catalogue_sends_practice_refuses before insert or update on wa_catalogue_sends
  for each row execute function practice_refuses();

do $$ declare t text; begin
  foreach t in array array['wa_catalogue_items','wa_catalogue_batches','wa_catalogue_batch_items','wa_catalogue_images','wa_catalogue_sends'] loop
    execute format('alter table %I enable row level security',t);
    execute format('create policy tenant on %I for all to nomi_app using (business_id=current_business_id()) with check (business_id=current_business_id())',t);
    execute format('create policy not_for_accountants on %I as restrictive for all using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()))',t);
    execute format('grant select,insert,update on %I to nomi_app',t);
    execute format('revoke delete,truncate on %I from nomi_app',t);
  end loop;
end $$;

-- The capability reveals only its tenant. Bytes and current eligibility are then read in a tenant transaction.
create function wa_catalogue_image_business(p_token text, p_now timestamptz) returns uuid
language sql stable security definer set search_path=public as $$
  select g.business_id from wa_catalogue_images g
    join businesses b on b.id=g.business_id
    join product_images i on i.id=g.image_id and i.token=g.image_version
    join wa_catalogue_items c on c.id=g.item_id and c.business_id=g.business_id and c.product_id=i.product_id
    join wa_catalogue_batch_items bi on bi.id=g.batch_item_id and bi.business_id=g.business_id and bi.selected
  where g.token=p_token and b.practice_of is null and b.is_active
    and (g.state='published' or (g.state='submitted' and g.pending_until>p_now))
$$;
revoke all on function wa_catalogue_image_business(text,timestamptz) from public;
grant execute on function wa_catalogue_image_business(text,timestamptz) to nomi_app;

-- Compose with the migration-time predecessor, including other feature branches when combined.
alter function customer_erasure_contract() rename to customer_erasure_contract_before_0235;
create function customer_erasure_contract()
returns table(tbl text, action text, clear text[], blank text[], detach text[], match text)
language sql immutable set search_path=public as $$
  select * from customer_erasure_contract_before_0235()
  union all select t,'unrelated',null::text[],null::text[],null::text[],null::text
    from unnest(array['wa_catalogue_items','wa_catalogue_batches','wa_catalogue_batch_items','wa_catalogue_images']) t
  union all select 'wa_catalogue_sends','erase',null::text[],null::text[],null::text[],null::text
$$;
revoke all on function customer_erasure_contract() from public;
revoke all on function customer_erasure_contract_before_0235() from public;
alter function customer_erasure_edges() rename to customer_erasure_edges_before_0235;
create function customer_erasure_edges() returns table(child text,col text,parent text,pcol text)
language sql immutable set search_path=public as $$
  select * from customer_erasure_edges_before_0235()
  union all select 'wa_catalogue_sends','outbound_id','outbound_messages','id'
$$;
revoke all on function customer_erasure_edges() from public;
revoke all on function customer_erasure_edges_before_0235() from public;
alter function erase_customer_rows(uuid,uuid,uuid,boolean) rename to erase_customer_rows_before_0235;
create function erase_customer_rows(p_business uuid,p_client uuid,p_request uuid,p_restored boolean default false)
returns jsonb language plpgsql volatile security definer set search_path=public set row_security=off as $$
declare result jsonb; removed bigint;
begin
  delete from wa_catalogue_sends where business_id=p_business and outbound_id in
    (select o.id from outbound_messages o join conversations c on c.id=o.conversation_id
     where o.business_id=p_business and c.business_id=p_business and c.client_id=p_client);
  get diagnostics removed=row_count;
  result:=erase_customer_rows_before_0235(p_business,p_client,p_request,p_restored);
  -- Counted with the rest of what was erased: the ledger, the closed request's note and erase-buyer's plan read `erased`.
  return jsonb_set(result,'{erased}',erasure_add(coalesce(result->'erased','{}'::jsonb),'wa_catalogue_sends',removed));
end $$;
revoke all on function erase_customer_rows(uuid,uuid,uuid,boolean) from public;
revoke all on function erase_customer_rows_before_0235(uuid,uuid,uuid,boolean) from public;
insert into _migrations (version, name) values (235, 'wa_catalogue') on conflict (version) do nothing;
