-- Invoice-backed direct payments: minimal provider facts, immutable mapping snapshots and owner-confirmed payouts.
-- Clearing and transit are deliberately not manual payment accounts. Existing account codes are never overwritten.
insert into chart_template_accounts(template,code,name,kind,parent_code,holds_money) values
 ('uk-plain','1030','Stripe clearing','asset',null,false), ('uk-plain','1040','Payouts in transit','asset',null,false),
 ('us-plain','1030','Stripe clearing','asset',null,false), ('us-plain','1040','Payouts in transit','asset',null,false)
on conflict(template,code) do nothing;

create table stripe_connections (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
 account text not null check(account ~ '^acct_[A-Za-z0-9]+$'), live boolean not null,
 country text not null check(country in ('GB','US')), currency text not null,
 ready boolean not null, active boolean not null default true, connected_by text not null,
 connected_at timestamptz not null default now(), disconnected_at timestamptz,
 unique(account,live), unique(business_id,id)
);
create unique index stripe_one_active_connection on stripe_connections(business_id,live) where active;
create table stripe_mappings (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
 connection_id uuid not null, clearing_id uuid not null, transit_id uuid not null, fee_id uuid not null,
 journal_id uuid not null, bank_id uuid not null, created_by text not null, created_at timestamptz not null default now(),
 unique(business_id,id),
 foreign key(business_id,connection_id) references stripe_connections(business_id,id),
 foreign key(business_id,clearing_id) references accounts(business_id,id),
 foreign key(business_id,transit_id) references accounts(business_id,id),
 foreign key(business_id,fee_id) references accounts(business_id,id),
 foreign key(business_id,bank_id) references accounts(business_id,id),
 foreign key(business_id,journal_id) references journals(business_id,id),
 check(clearing_id <> transit_id and clearing_id <> bank_id and transit_id <> bank_id)
);
create table stripe_oauth_states (
 business_id uuid not null references businesses(id) on delete cascade, digest text primary key,
 owner_id text not null, session_digest text not null, live boolean not null,
 expires_at timestamptz not null, claimed_at timestamptz
);
create table stripe_checkout_attempts (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
 connection_id uuid not null, mapping_id uuid not null, invoice_id uuid not null,
 amount numeric(24,2) not null check(amount > 0), currency text not null,
 state text not null default 'creating' check(state in ('creating','open','processing','paid','expired','failed')),
 session_id text, intent_id text, url text, expires_at timestamptz not null, created_at timestamptz not null default now(),
 reason text, unique(business_id,id), unique(connection_id,session_id), unique(connection_id,intent_id),
 foreign key(business_id,connection_id) references stripe_connections(business_id,id),
 foreign key(business_id,mapping_id) references stripe_mappings(business_id,id),
 foreign key(business_id,invoice_id) references invoices(business_id,id)
);
create unique index stripe_one_open_invoice on stripe_checkout_attempts(invoice_id) where state in ('creating','open','processing');
create table stripe_event_inbox (
 business_id uuid not null references businesses(id) on delete cascade, connection_id uuid not null,
 event_id text not null, event_type text not null, event_created bigint not null, object_id text not null, intent_id text,
 state text not null default 'pending' check(state in ('pending','done','exception')), reason text,
 received_at timestamptz not null default now(), processed_at timestamptz,
 primary key(connection_id,event_id), foreign key(business_id,connection_id) references stripe_connections(business_id,id)
);
create index stripe_inbox_pending on stripe_event_inbox(business_id,received_at) where state <> 'done';
create table stripe_movements (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
 connection_id uuid not null, attempt_id uuid not null, kind text not null check(kind in ('payment','fee','refund','refund_fee')),
 provider_id text not null, amount numeric(24,2) not null check(amount >= 0), currency text not null, event_date date not null,
 entry_id uuid, reason text, unique(connection_id,kind,provider_id),
 foreign key(business_id,connection_id) references stripe_connections(business_id,id),
 foreign key(business_id,attempt_id) references stripe_checkout_attempts(business_id,id),
 foreign key(business_id,entry_id) references journal_entries(business_id,id)
);
create table stripe_payouts (
 business_id uuid not null references businesses(id) on delete cascade, connection_id uuid not null, provider_id text not null,
 amount numeric(24,2) not null check(amount > 0), currency text not null, event_date date not null, arrival_date date not null,
 status text not null check(status in ('pending','in_transit','paid','failed','canceled')),
 nomi_amount numeric(24,2), mapping_id uuid, confirmed_by text, confirmed_at timestamptz,
 entry_id uuid, reversal_id uuid, receipt_id uuid, reason text,
 primary key(connection_id,provider_id), check(nomi_amount is null or nomi_amount > 0 and nomi_amount <= amount),
 foreign key(business_id,connection_id) references stripe_connections(business_id,id),
 foreign key(business_id,mapping_id) references stripe_mappings(business_id,id),
 foreign key(business_id,entry_id) references journal_entries(business_id,id),
 foreign key(business_id,reversal_id) references journal_entries(business_id,id),
 foreign key(business_id,receipt_id) references journal_entries(business_id,id)
);
create table stripe_link_sends (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id) on delete cascade,
 attempt_id uuid not null, conversation_id uuid references conversations(id) on delete set null,
 outbound_id uuid references outbound_messages(id) on delete set null, sent_by text not null, queued_at timestamptz not null default now(),
 foreign key(business_id,attempt_id) references stripe_checkout_attempts(business_id,id)
);

do $$ declare t text; begin
 foreach t in array array['stripe_connections','stripe_mappings','stripe_oauth_states','stripe_checkout_attempts','stripe_event_inbox','stripe_movements','stripe_payouts','stripe_link_sends'] loop
  execute format('alter table %I enable row level security',t);
  execute format('create policy tenant on %I for all to nomi_app using (business_id = current_business_id()) with check (business_id = current_business_id())',t);
  execute format('create policy not_for_staff on %I as restrictive for all using (not (select viewer_is_staff())) with check (not (select viewer_is_staff()))',t);
  execute format('create policy not_for_accountants on %I as restrictive for all using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()))',t);
  execute format('grant select,insert,update on %I to nomi_app',t);
  execute format('revoke delete,truncate on %I from nomi_app',t);
 end loop;
end $$;
revoke update on stripe_mappings from nomi_app;

-- Authentication precedes this lookup at the Connect endpoint. It reveals ids only, never ledger or customer data.
create function stripe_connection_for(p_account text,p_live boolean) returns table(business_id uuid,connection_id uuid)
language sql stable security definer set search_path=public set row_security=off as $$
 select c.business_id,c.id from stripe_connections c join businesses b on b.id=c.business_id
 where c.account=p_account and c.live=p_live and b.practice_of is null
   and not viewer_is_staff() and not viewer_is_accountant()
$$;
revoke all on function stripe_connection_for(text,boolean) from public;
grant execute on function stripe_connection_for(text,boolean) to nomi_app;
create function stripe_pending_workspaces() returns table(business_id uuid)
language sql stable security definer set search_path=public set row_security=off as $$
 select distinct e.business_id from stripe_event_inbox e where e.state='pending'
$$;
revoke all on function stripe_pending_workspaces() from public;
grant execute on function stripe_pending_workspaces() to nomi_app;

-- Extend, rather than replace, the latest erasure contract and detach the send's customer references before erasing.
alter function customer_erasure_contract() rename to customer_erasure_contract_before_0233;
create function customer_erasure_contract() returns table(tbl text,action text,clear text[],blank text[],detach text[],match text)
language sql immutable set search_path=public as $$
 select * from customer_erasure_contract_before_0233()
 union all select t,'unrelated',null::text[],null::text[],null::text[],null::text from unnest(array[
 'stripe_connections','stripe_mappings','stripe_oauth_states','stripe_checkout_attempts','stripe_event_inbox','stripe_movements','stripe_payouts']) t
 union all select 'stripe_link_sends','detach',null::text[],null::text[],array['conversation_id','outbound_id'],null::text
$$;
revoke all on function customer_erasure_contract() from public;
alter function customer_erasure_edges() rename to customer_erasure_edges_before_0233;
create function customer_erasure_edges() returns table(child text,col text,parent text,pcol text)
language sql immutable set search_path=public as $$
 select * from customer_erasure_edges_before_0233()
 union all select 'stripe_link_sends','conversation_id','conversations','id'
 union all select 'stripe_link_sends','outbound_id','outbound_messages','id'
$$;
revoke all on function customer_erasure_edges() from public;
alter function erase_customer_rows(uuid,uuid,uuid,boolean) rename to erase_customer_rows_before_0233;
create function erase_customer_rows(p_business uuid,p_client uuid,p_request uuid,p_restored boolean default false) returns jsonb
language plpgsql volatile security definer set search_path=public set row_security=off as $$
declare n bigint; result jsonb;
begin
 update stripe_link_sends set conversation_id=null,outbound_id=null where business_id=p_business
 and (conversation_id in (select id from conversations where business_id=p_business and client_id=p_client)
 or outbound_id in (select o.id from outbound_messages o join conversations c on c.id=o.conversation_id where c.business_id=p_business and c.client_id=p_client));
 get diagnostics n=row_count;
 result := erase_customer_rows_before_0233(p_business,p_client,p_request,p_restored);
 return jsonb_set(result,'{changed}',erasure_add(coalesce(result->'changed','{}'::jsonb),'stripe_link_sends',n));
end $$;
revoke all on function erase_customer_rows(uuid,uuid,uuid,boolean) from public;
revoke all on function erase_customer_rows_before_0233(uuid,uuid,uuid,boolean) from public;

insert into _migrations(version,name) values(233,'invoice_payment_links') on conflict(version) do nothing;
