-- ---------------------------------------------------------------------------
-- 0182 — WHERE THE EXCHANGE DIFFERENCE GOES (Phase 5, C1; the owner's question, answered before C1).
--
-- A3 (0173) already refuses an entry whose books'-currency remainder is not a line of its own: nothing is absorbed or
-- rounded away. This names the account. Each workspace has an exchange-LOSS and an exchange-GAIN account (for a
-- Moroccan chart, CGNC 6331 Pertes de change propres à l'exercice and 7331 Gains de change propres à l'exercice);
-- the line that carries a difference is MARKED (`journal_lines.is_fx`), and the database refuses a marked line
-- anywhere else: a loss is a debit on the loss account, a gain a credit on the gain account, in the books' own
-- currency. Every entry Nomi drafts marks its difference; C2's realised differences land on the same two accounts.
-- ---------------------------------------------------------------------------

alter table books_settings add column if not exists fx_loss_account_id uuid;
alter table books_settings add column if not exists fx_gain_account_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'books_settings_fx_loss_fk') then
    alter table books_settings add constraint books_settings_fx_loss_fk foreign key (business_id, fx_loss_account_id)
      references accounts (business_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'books_settings_fx_gain_fk') then
    alter table books_settings add constraint books_settings_fx_gain_fk foreign key (business_id, fx_gain_account_id)
      references accounts (business_id, id) on delete cascade;
  end if;
end $$;

alter table journal_lines add column if not exists is_fx boolean not null default false;

-- The lines' rules, re-made from their latest definition (0173) with the marked line's.
create or replace function journal_lines_rules() returns trigger
language plpgsql as $$
declare
  s text;
  day date;
  t record;
  bs record;
begin
  select state, entry_date into s, day from journal_entries where id = coalesce(new.entry_id, old.entry_id);
  if s = 'posted' and not books_purge_allowed() then
    raise exception 'books: the entry is posted, and its lines are never changed — reverse it' using errcode = 'NB005';
  end if;
  if s = 'discarded' and not books_purge_allowed() then
    raise exception 'books: the draft was discarded, and its lines stay as they were' using errcode = 'NB005';
  end if;
  -- A3 — while drafted, the books' figures are not the drafter's to write: the posting writes them, at the owner's
  -- rate (journal_entries_rules). A draft line's book amounts and rate are cleared whenever the line changes.
  if tg_op <> 'DELETE' and s = 'draft' and pg_trigger_depth() = 1 then
    new.book_debit := null; new.book_credit := null; new.rate := null; new.rate_stated_at := null; new.rate_id := null;
  end if;
  if tg_op = 'UPDATE' and new.entry_id <> old.entry_id then
    raise exception 'books: a line stays on its entry' using errcode = 'NB005';
  end if;
  -- C1 (0182) — the exchange difference, marked: only on the workspace's two exchange accounts, in the books' own
  -- currency, a loss as a debit on the loss account and a gain as a credit on the gain account.
  if tg_op <> 'DELETE' and new.is_fx then
    select fx_loss_account_id, fx_gain_account_id into bs from books_settings where business_id = new.business_id;
    if bs.fx_loss_account_id is null or bs.fx_gain_account_id is null then
      raise exception 'books: the exchange accounts are not set — choose them, then mark the difference' using errcode = 'NB017';
    end if;
    if new.currency <> books_currency(new.business_id) then
      raise exception 'books: an exchange difference is in the books'' own currency' using errcode = 'NB017';
    end if;
    if (new.debit > 0 and new.account_id <> bs.fx_loss_account_id) or (new.credit > 0 and new.account_id <> bs.fx_gain_account_id) then
      raise exception 'books: an exchange difference goes to the exchange accounts — a loss as a debit on the loss account, a gain as a credit on the gain account' using errcode = 'NB017';
    end if;
  end if;
  if tg_op <> 'DELETE' and new.tax_code_id is not null then
    select * into t from tax_codes where id = new.tax_code_id;
    if day < t.valid_from or (t.valid_to is not null and day >= t.valid_to) then
      raise exception 'books: tax code % is not in force on %', t.code, day using errcode = 'NB012';
    end if;
  end if;
  return coalesce(new, old);
end $$;

insert into _migrations (version, name) values (182, 'fx_accounts')
  on conflict (version) do nothing;
