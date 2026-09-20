-- 0064 — Phase 2: a request to be deleted is WRITTEN DOWN.
--
-- WHAT WAS WRONG. `/data-deletion` is the URL Meta's review reads, and it told
-- every buyer: "Within 30 days, your messages, attachments, name and account
-- identifiers are removed from Nomi, and you receive a confirmation on the same
-- channel." Nothing in this product deletes anything. The app role holds no
-- DELETE grant on any table (by design, and a test holds it), there is no
-- deletion job, and no confirmation is ever sent. A buyer who asked was told a
-- clock was running that nobody had started.
--
-- WHAT THIS IS, AND WHAT IT IS NOT. It is not an erase button. Erasure is the
-- one operation in this product that cannot be undone or audited after the
-- fact, and a route that performs it is a route that can be reached by a
-- mistake, a stolen session or a bug. So the app RECORDS the request — who
-- asked, when, for what — and a person carries it out against the database,
-- following docs/DATA-DELETION-RUNBOOK.md, and writes back what they did.
--
-- That is slower than a button and it is what the pages now promise: a person
-- does this by hand. The request row is what makes the promise checkable —
-- before it, a buyer's e-mail sat in an inbox and nobody could say how many
-- were outstanding or how old the oldest one was.
--
-- THE GRANTS DO NOT MOVE. select/insert/update, never delete: this table is a
-- record of what was asked, so a request is closed, never removed. Archive,
-- never erase — the same rule the rest of the schema follows.

create table if not exists deletion_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),

  -- WHOSE data. 'workspace' is the owner asking for their whole account to go;
  -- 'buyer' is one person who wrote in and asked. They are not the same job and
  -- the runbook treats them differently, so the row says which from the start.
  scope text not null check (scope in ('workspace', 'buyer')),

  -- The buyer, when there is one. A workspace request names nobody.
  client_id uuid references clients(id),

  -- How the buyer identified themselves, in the owner's words — "the WhatsApp
  -- number ending 4471, wrote on the 19th". Free text on purpose: the operator
  -- has to be able to find the person, and the channels this arrives on are not
  -- all channels this product can resolve. Never the buyer's own message.
  subject_note text,

  -- Who pressed it here. A person id, or 'owner' for a session signed before
  -- M47 put a person in it — the same convention the audit trail uses.
  asked_by text not null,
  asked_at timestamptz not null default now(),

  -- open      nobody has acted yet
  -- withdrawn the owner changed their mind before anyone did
  -- done       the operator carried it out
  -- refused    the operator did not, and said why (a record the law requires
  --            kept, a request from someone who could not be identified)
  state text not null default 'open'
    check (state in ('open', 'withdrawn', 'done', 'refused')),
  closed_at timestamptz,
  closed_by text,
  closed_note text,

  -- A buyer request names a buyer; a workspace request does not. Enforced here
  -- rather than trusted to the route, because the runbook reads this column to
  -- decide which set of statements to run.
  constraint deletion_requests_subject
    check ((scope = 'buyer') = (client_id is not null)),
  -- A closed request says when. An open one has not been closed.
  constraint deletion_requests_closed
    check ((state in ('open')) = (closed_at is null))
);

-- The operator's question is "what is outstanding, oldest first".
create index if not exists deletion_requests_open
  on deletion_requests (asked_at) where state = 'open';
create index if not exists deletion_requests_business
  on deletion_requests (business_id, asked_at desc);

-- One open workspace request per business: pressing it twice is one request,
-- not two, and the operator should never have to reconcile duplicates.
create unique index if not exists deletion_requests_one_open_workspace
  on deletion_requests (business_id) where scope = 'workspace' and state = 'open';

alter table deletion_requests enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'deletion_requests' and policyname = 'deletion_requests_tenant') then
    create policy deletion_requests_tenant on deletion_requests
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

grant select, insert, update on deletion_requests to nomi_app;
revoke delete, truncate on deletion_requests from nomi_app;

-- The audit trail learns two verbs: asking to be deleted, and taking that back.
-- The whole list is restated, as 0027 and 0059 did — a check constraint cannot
-- be added to, only replaced. `export_data` joins them: an owner taking a copy
-- of everything is a thing that happened and should be visible on the trail,
-- and it is the first thing a compromised session would do.
-- EVERY EXISTING VERB IS COPIED FROM THE LIVE CONSTRAINT, not from memory: a
-- shorter list here does not fail at migration time, it fails weeks later the
-- first time somebody activates a channel.
alter table channel_audit drop constraint if exists channel_audit_action_check;
alter table channel_audit add constraint channel_audit_action_check
  check (action in ('connect','reconnect','disconnect','test','rotate_credential',
                    'set_owner_phone','update_profile','activate','deactivate',
                    'blocked_not_allowlisted','allowlist_add','allowlist_archive',
                    'send_refused','activation_refused','product_edited',
                    'price_rules_set','transcript_corrected',
                    'assistant_added','assistant_changed','assistant_archived',
                    'export_data','deletion_requested','deletion_withdrawn'));

insert into _migrations (version, name) values (64, 'deletion_requests')
on conflict (version) do nothing;
