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
 -- closed_for: the paid attempt of the same invoice whose payment made Nomi expire this link.
 -- paid_twice: this attempt's payment came after another link of the invoice was paid, and was more than was owed.
 closed_for uuid, paid_twice text check(paid_twice in ('untold','told')),
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


-- Before merge: failure lifecycle facts, without changing any existing payment kind's guards.
alter table stripe_connections add column deauthorization_state text check (deauthorization_state in ('pending','done'));
alter table stripe_connections add column deauthorization_reason text;
alter table stripe_connections add column payout_destination text;
alter table stripe_payouts add column destination text;
alter table stripe_payouts add column failure_balance_id text;
alter table stripe_payouts add column failure_date date;
create unique index stripe_payout_failure_once on stripe_payouts(connection_id,failure_balance_id) where failure_balance_id is not null;
alter table stripe_movements drop constraint stripe_movements_kind_check;
alter table stripe_movements add constraint stripe_movements_kind_check check (kind in ('payment','fee','refund','refund_fee','refund_reversal'));
alter table stripe_movements add column reverses_id uuid references stripe_movements(id);
alter table stripe_movements add constraint stripe_refund_reversal_source check ((kind = 'refund_reversal') = (reverses_id is not null));
alter table invoice_payments add column reverses_payment_id uuid;
alter table invoice_payments add foreign key (business_id,reverses_payment_id) references invoice_payments(business_id,id);
alter table invoice_payments drop constraint invoice_payments_kind_check;
alter table invoice_payments add constraint invoice_payments_kind_check check (kind in ('in','refund','refund_reversal'));
alter table invoice_payments add constraint invoice_refund_reversal_source check ((kind = 'refund_reversal') = (reverses_payment_id is not null));
-- Re-made from 0188_credit_notes.sql; existing payment/refund checks stay unchanged, with a separate refund-reversal branch.
create or replace function invoice_payments_rules() returns trigger
language plpgsql as $$
declare
  i record; owed numeric; e record; original record; returned numeric; relieved numeric; ceiling numeric; relief numeric;
begin
  if tg_op <> 'INSERT' then
    if books_purge_allowed() then return coalesce(new, old); end if;
    raise exception 'books: a payment never changes — a correction is a new entry' using errcode = 'NB019';
  end if;
  select state, currency into i from invoices where id = new.invoice_id for update;
  if i.state <> 'issued' then
    raise exception 'books: only an issued invoice is paid' using errcode = 'NB019';
  end if;
  if new.currency <> i.currency then
    raise exception 'books: a payment is in its invoice''s currency (%)', i.currency using errcode = 'NB019';
  end if;
  owed := invoice_total(new.invoice_id) - invoice_credited(new.invoice_id) - invoice_paid(new.invoice_id);
  -- A customer who paid a second payment link of an invoice already paid through another has paid twice: the
  -- money arrived, so it is recorded whole and the excess is owed back to them (refund_due). Never refunded here.
  if new.kind = 'in' and new.amount > owed and not (new.created_by = 'stripe' and exists(
       select 1 from stripe_checkout_attempts a where a.business_id = new.business_id and a.invoice_id = new.invoice_id and a.state = 'paid')) then
    raise exception 'books: % is more than is still owed (%)', new.amount, owed using errcode = 'NB019';
  end if;
  if new.kind = 'refund' and new.amount > -owed then
    raise exception 'books: % is more than the customer is owed back (%)', new.amount, greatest(-owed, 0) using errcode = 'NB019';
  end if;
  if new.kind = 'refund_reversal' then
    select * into original from invoice_payments
     where business_id = new.business_id and id = new.reverses_payment_id
       and invoice_id = new.invoice_id and kind = 'refund';
    if not found or original.currency <> new.currency or original.account_id <> new.account_id then
      raise exception 'books: a refund reversal names its original refund' using errcode = 'NB019';
    end if;
    select coalesce(sum(amount), 0), coalesce(sum(receivable_book), 0) into returned, relieved
      from invoice_payments where business_id = new.business_id and reverses_payment_id = original.id;
    ceiling := original.amount - returned;
    if new.amount > ceiling then
      raise exception 'books: % is more than the refund still reversible (%)', new.amount, ceiling using errcode = 'NB019';
    end if;
    relief := case when new.amount = ceiling then -original.receivable_book - relieved
                   else round(-original.receivable_book * new.amount / original.amount, 2) end;
    if new.receivable_book <> relief then
      raise exception 'books: a refund reversal restores its exact receivable relief' using errcode = 'NB019';
    end if;
  end if;
  select state into e from journal_entries where id = new.entry_id;
  if e.state <> 'posted' then
    raise exception 'books: a payment is recorded with its posted entry' using errcode = 'NB019';
  end if;
  return new;
end $$;

-- Keep single-column deletion edges for customer erasure, and check their tenant and subject here.
create function check_stripe_send_references() returns trigger
language plpgsql security definer set search_path=public set row_security=off as $$
declare c record; o record;
begin
  -- A conversation's FK detach also detaches its outbound, regardless of FK action order.
  if tg_op = 'UPDATE' and old.conversation_id is not null and new.conversation_id is null then
    new.outbound_id := null;
  end if;
  if new.conversation_id is not null then
    select business_id into c from conversations where id=new.conversation_id for share;
    if not found or c.business_id is distinct from new.business_id then
      raise exception 'payment link: conversation belongs to another workspace' using errcode='23503';
    end if;
  end if;
  if new.outbound_id is not null then
    select business_id,conversation_id into o from outbound_messages where id=new.outbound_id for share;
    if not found or o.business_id is distinct from new.business_id then
      raise exception 'payment link: outbound belongs to another workspace' using errcode='23503';
    end if;
    if o.conversation_id is distinct from new.conversation_id then
      raise exception 'payment link: outbound belongs to another conversation' using errcode='23503';
    end if;
  end if;
  return new;
end $$;
revoke all on function check_stripe_send_references() from public;
create trigger stripe_send_references before insert or update on stripe_link_sends
for each row execute function check_stripe_send_references();

create function check_stripe_reversal_reference() returns trigger
language plpgsql security definer set search_path=public set row_security=off as $$
declare original record;
begin
  if new.reverses_id is not null then
    select business_id,connection_id into original from stripe_movements where id=new.reverses_id for share;
    if not found or original.business_id is distinct from new.business_id then
      raise exception 'payment link: reversed movement belongs to another workspace' using errcode='23503';
    end if;
    if original.connection_id is distinct from new.connection_id then
      raise exception 'payment link: reversed movement belongs to another connection' using errcode='23503';
    end if;
  end if;
  return new;
end $$;
revoke all on function check_stripe_reversal_reference() from public;
create trigger stripe_reversal_reference before insert or update on stripe_movements
for each row execute function check_stripe_reversal_reference();
