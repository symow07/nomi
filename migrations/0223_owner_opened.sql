-- ---------------------------------------------------------------------------
-- 0222 — WHEN A CONVERSATION WAS LAST OPENED (the owner, 2026-11-04).
--
-- The Customers list writes a row that needs the owner's attention in bold until it is opened. Nothing recorded an
-- opening. One nullable column, on the conversation, so it is erased with the conversation and needs no decision of its
-- own in the customer erasure. Null means "not opened since this was added".
--
-- Whoever opens it, once: a team shares one list, and the row's dot stays until the row is dealt with.
-- ---------------------------------------------------------------------------

alter table conversations
  add column if not exists owner_opened_at timestamptz;

-- Opening a conversation is not activity in it: `updated_at` is how a Meta echo finds the customer's latest conversation
-- (src/pipeline/echo.ts), and reading an older one must not make it the latest.
drop trigger if exists trg_conversations_updated_at on conversations;
create trigger trg_conversations_updated_at
  before update on conversations
  for each row
  when (new.owner_opened_at is not distinct from old.owner_opened_at)
  execute function set_updated_at();

insert into _migrations (version, name) values (223, 'owner_opened')
  on conflict (version) do nothing;
