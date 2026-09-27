-- 0076 · A deletion request in chat is written down when it arrives (2026-09-27).
--
-- WHAT WAS WRONG. Since 0075 a buyer who asks in chat for their data to be
-- deleted is handed to a person and told nothing. But the only record of the
-- asking was the hand-off's reason, and handing the conversation back clears
-- that — so the one thing between the request and a missed legal deadline was
-- the owner remembering to record it on the buyer's page FIRST. The safe
-- outcome depended on two actions in the right order, and nothing enforced it.
--
-- WHAT THIS IS. The hand-off itself writes the request down, here, the moment
-- the buyer's message is read: the buyer, the conversation, the message and
-- the time. It is the REMINDER, not the action. Nothing is erased because of
-- it and Nomi's operator is not told: the owner still decides, on the buyer's
-- page — record it as a deletion request (it becomes a `deletion_requests`
-- row, the operator's to carry out, counted from when the buyer asked), or
-- mark it as not a deletion request. Until then it waits, on the buyer's page,
-- on Your data and on Today, whoever holds the conversation.
--
-- WHY NOT A STATE OF `deletion_requests`. An open row there is the business's
-- word to Nomi's operator, and the public page promises what follows from it;
-- the operator's tools act on it. A buyer's words read by a pattern are not
-- that word, and must never be mistaken for it by anything that reads that
-- table. So the reminder lives beside it, and points at it once recorded.
--
-- ONE WAITING PER BUYER. A buyer who asks again while it waits asks the same
-- thing: the row counts the asks and keeps the FIRST time, because that is
-- when their request was received. Recorded or dismissed, it stops waiting,
-- and a new ask starts a new one.
--
-- ERASED WITH THE BUYER (tools/erase-buyer.mjs rule `erase`): it holds their
-- conversation and their message, and the request row it pointed at is what
-- stays as the record that they asked.

create table if not exists deletion_asks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  client_id uuid not null references clients(id),
  conversation_id uuid not null references conversations(id),
  -- The message that asked. Null only when it could not be found (the words
  -- that decided it were a reply's, not the buyer's own).
  message_id uuid references messages(id),
  -- When the buyer asked: the message's own time. Never moved by a repeat.
  asked_at timestamptz not null,
  asks integer not null default 1 check (asks >= 1),
  last_asked_at timestamptz not null default now(),
  -- waiting    nobody has decided yet
  -- recorded   the owner recorded it as a deletion request (`request_id`)
  -- dismissed  the owner decided it was not one
  state text not null default 'waiting' check (state in ('waiting', 'recorded', 'dismissed')),
  request_id uuid references deletion_requests(id),
  decided_at timestamptz,
  decided_by text,
  created_at timestamptz not null default now(),
  constraint deletion_asks_decided check ((state = 'waiting') = (decided_at is null)),
  constraint deletion_asks_recorded check ((state = 'recorded') = (request_id is not null))
);

create unique index if not exists deletion_asks_one_waiting
  on deletion_asks (client_id) where state = 'waiting';
create index if not exists deletion_asks_business
  on deletion_asks (business_id, state, asked_at);
create index if not exists deletion_asks_conversation
  on deletion_asks (conversation_id);

alter table deletion_asks enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'deletion_asks' and policyname = 'deletion_asks_tenant') then
    create policy deletion_asks_tenant on deletion_asks
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

grant select, insert, update on deletion_asks to nomi_app;
revoke delete, truncate on deletion_asks from nomi_app;

-- The audit trail learns one verb: the owner deciding a noted request was not
-- a deletion request. EVERY EXISTING VERB IS COPIED FROM THE LIVE CONSTRAINT
-- (0070's list), not from memory.
alter table channel_audit drop constraint if exists channel_audit_action_check;
alter table channel_audit add constraint channel_audit_action_check
  check (action in ('connect','reconnect','disconnect','test','rotate_credential',
                    'set_owner_phone','update_profile','activate','deactivate',
                    'blocked_not_allowlisted','allowlist_add','allowlist_archive',
                    'send_refused','activation_refused','product_edited',
                    'price_rules_set','transcript_corrected',
                    'assistant_added','assistant_changed','assistant_archived',
                    'export_data','deletion_requested','deletion_withdrawn',
                    'assistant_stop','assistant_start',
                    'deletion_dismissed'));

insert into _migrations (version, name) values (76, 'deletion_asks')
on conflict (version) do nothing;
