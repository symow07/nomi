-- 0063 — E1.2: ask ONCE which mailboxes may be read.
--
-- The inbox pass asked every live tenant "do you have a readable mailbox?",
-- one query each, every minute. On a database with four hundred live
-- businesses that is four hundred queries a minute to learn that almost none
-- of them has granted reading — and it pushed the minute sweep past its budget,
-- so follow-ups that were due went late (the integration suite caught it).
--
-- One question instead, answered across tenants the way `live_business_ids`
-- already answers its own: a definer function, because `mail_accounts` is
-- behind row-level security and this is the operator's question, not a
-- business's. It returns ids and nothing else — never an address, never a token.

create or replace function inboxes_to_read()
returns table (business_id uuid)
language sql stable security definer set search_path = public as $$
  select m.business_id from mail_accounts m
    join businesses b on b.id = m.business_id and b.is_active
   where m.archived_at is null and m.reads_inbox and m.needs_attention_at is null
   order by m.inbox_read_at nulls first
$$;
revoke all on function inboxes_to_read() from public;
grant execute on function inboxes_to_read() to nomi_app;

insert into _migrations (version, name) values (63, 'inboxes_to_read')
on conflict (version) do nothing;
