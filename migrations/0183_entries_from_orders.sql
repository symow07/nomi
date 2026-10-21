-- ---------------------------------------------------------------------------
-- 0183 — AN ENTRY FROM A NOMI ORDER, ONCE (Phase 5, C1; item 3: "from Nomi's orders").
--
-- A confirmed order is a sale: drafted into the books as a debit on the workspace's receivable account and a credit
-- on its sales account, in the order's currency, on the day it was confirmed, its document the order's reference —
-- a DRAFT, for the owner to post. The accounts and the sales journal are the owner's choice (books_settings). The
-- draft remembers its order (`journal_entries.source_order_id`), and an order has at most one entry that is not
-- discarded: the same order is never entered twice. Tax and the buyer as a party come with C2's invoices.
-- ---------------------------------------------------------------------------

alter table books_settings add column if not exists sales_journal_id uuid;
alter table books_settings add column if not exists receivable_account_id uuid;
alter table books_settings add column if not exists sales_account_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'books_settings_sales_journal_fk') then
    alter table books_settings add constraint books_settings_sales_journal_fk foreign key (business_id, sales_journal_id)
      references journals (business_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'books_settings_receivable_fk') then
    alter table books_settings add constraint books_settings_receivable_fk foreign key (business_id, receivable_account_id)
      references accounts (business_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'books_settings_sales_account_fk') then
    alter table books_settings add constraint books_settings_sales_account_fk foreign key (business_id, sales_account_id)
      references accounts (business_id, id) on delete cascade;
  end if;
end $$;

alter table journal_entries add column if not exists source_order_id uuid;
create unique index if not exists journal_entries_one_per_order
  on journal_entries (business_id, source_order_id) where source_order_id is not null and state <> 'discarded';

insert into _migrations (version, name) values (183, 'entries_from_orders')
  on conflict (version) do nothing;
