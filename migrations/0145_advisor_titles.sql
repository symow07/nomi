-- ---------------------------------------------------------------------------
-- 0145 — D16 (the data-protection audit, 2026-10-12): AN ADVISOR CONVERSATION
-- THAT OUTLIVES A CUSTOMER'S ERASURE LOSES ITS TITLE.
--
-- A customer's erasure deletes every advisor question that names them, with its
-- answer, and a conversation left with no question (0130). A conversation that
-- keeps other questions stayed with its title — sealed, made from its first
-- question, and so possibly the customer's name. The database cannot read a
-- sealed title, so it clears it: '' is "no title" to the app, which shows the
-- conversation by its date, as it shows one whose title cannot be opened.
--
-- The count is `advisor_titles`, outside the maps tools/erase-buyer.mjs plans.
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_proc where proname = 'erase_customer_rows_jobs') then
    alter function erase_customer_rows(uuid, uuid, uuid, boolean) rename to erase_customer_rows_jobs;
  end if;
end $$;
revoke all on function erase_customer_rows_jobs(uuid, uuid, uuid, boolean) from public;

create or replace function erase_customer_rows(p_business uuid, p_client uuid, p_request uuid, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_threads uuid[];
  v_n bigint := 0;
  v_counts jsonb;
begin
  -- The conversations that will lose a question, before it goes.
  v_threads := array(select distinct t.thread_id from advisor_turns t join advisor_turn_subjects s on s.turn_id = t.id
                      where s.client_id = p_client and s.business_id = p_business);
  v_counts := erase_customer_rows_jobs(p_business, p_client, p_request, p_restored);
  update advisor_threads set title_ciphertext = '' where id = any(v_threads) and title_ciphertext <> '';
  get diagnostics v_n = row_count;
  return case when v_n > 0 then v_counts || jsonb_build_object('advisor_titles', v_n) else v_counts end;
end $$;
revoke all on function erase_customer_rows(uuid, uuid, uuid, boolean) from public;

insert into _migrations (version, name) values (145, 'advisor_titles')
  on conflict (version) do nothing;
