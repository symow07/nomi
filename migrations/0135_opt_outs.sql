-- 0135 · A buyer who says stop is not written to again (the owner, 2026-10-10).
--
-- WhatsApp's, Messenger's and Instagram's rules: a person who asks a business
-- to stop messaging them is not messaged again. Until now "stop messaging me"
-- ran an ordinary turn — in auto the assistant answered it — and nothing was
-- written down, so a reply queued earlier, a follow-up or the reopening
-- template could still reach them.
--
-- WHAT THIS IS. `opt_outs`: the buyer, on ONE channel, asked to stop. Written
-- when their words say so (src/core/safety/optOut.ts, read before any model),
-- whoever holds the conversation and on every path where no turn runs; or by
-- the owner, on the buyer's page, when a person read a message the words did
-- not settle. The send gate reads it at send time (src/core/channel/sendGate.ts):
--   · nothing reaches them — the assistant, the owner, a follow-up — until
--     they write again, except the one line that answers the stop;
--   · writing again lifts that silence for replies only: no follow-up, no
--     outreach and no reopening template ever goes to them while it stands;
--   · only the owner lifts it, on the buyer's page, when the buyer asked
--     to hear from the business again (`lifted_at`, on the audit trail).
--
-- PER BUYER AND PER CHANNEL. Keyed on (channel, identity) like `suppressions`
-- (0036): the number on WhatsApp, the account on Instagram or Messenger, the
-- address on e-mail. A stop on WhatsApp says nothing about their e-mail.
--
-- THE NOTICE. Two sentences must reach a buyer a person now holds: the line
-- that answers a stop, and (fix 1 of the same batch) "someone from our team
-- will reply". `outbound_messages.notice` / `drafts.notice` mark them, so the
-- gate can let exactly those through and nothing else the assistant wrote.
--
-- KEPT WHEN THE BUYER IS ERASED (tools/erase-buyer.mjs rule `keep`, by
-- identity): like a suppression, it is what stops them being written to again.

create table if not exists opt_outs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  channel text not null,
  identity text not null,
  -- When it was first recorded, and when they last said it: the silence runs from the last.
  asked_at timestamptz not null default now(),
  last_asked_at timestamptz not null default now(),
  asks integer not null default 1 check (asks >= 1),
  -- buyer  their own words said it
  -- owner  the owner recorded it, having read a message the words did not settle
  recorded_by text not null default 'buyer' check (recorded_by in ('buyer', 'owner')),
  lifted_at timestamptz,
  lifted_by text,
  created_at timestamptz not null default now(),
  constraint opt_outs_lifted check ((lifted_at is null) = (lifted_by is null))
);

create unique index if not exists opt_outs_one_standing
  on opt_outs (business_id, channel, identity) where lifted_at is null;
create index if not exists opt_outs_business on opt_outs (business_id, asked_at);

alter table opt_outs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'opt_outs' and policyname = 'opt_outs_tenant') then
    create policy opt_outs_tenant on opt_outs
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;

grant select, insert, update on opt_outs to nomi_app;
revoke delete, truncate on opt_outs from nomi_app;

-- ── The notice: the one row the gate lets reach a buyer a person holds ─────
alter table outbound_messages add column if not exists notice text
  check (notice in ('handoff', 'opt_out'));
alter table drafts add column if not exists notice text
  check (notice in ('handoff', 'opt_out'));

-- ── The hand-off's reason: 0132's two lists, with one reason added ─────────
alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable','unlisted_number','email_reply','email_unconfirmed',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked','billing_lapsed','plan_limit','provider_billing','opted_out'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply','email_unconfirmed',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked','billing_lapsed','plan_limit','provider_billing','opted_out'));

-- ── The audit trail learns two verbs: the owner recording one, and lifting one ─
-- 0126's list, copied from the live constraint, with two added.
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
                    'deletion_dismissed',
                    'product_imported','import_confirmed','prices_to_owner_set','selling_set',
                    'how_you_sell_saved','knowledge_imported','pilot_ended','pilot_resumed',
                    'customer_erased',
                    'opt_out_recorded','opt_out_lifted'));

-- ── Practice: Start over and the thirty days take a practice stop with them ─
-- 0089's function, with opt_outs added before the conversations go.
create or replace function practice_erase(p_copy uuid, p_older_than interval) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
begin
  if not exists (select 1 from businesses where id = p_copy and practice_of is not null) then
    raise exception 'practice_erase: not a practice copy' using errcode = '42501';
  end if;
  select coalesce(array_agg(c.id), '{}') into v_ids
    from conversations c
   where c.business_id = p_copy
     and coalesce((select max(m.sent_at) from messages m where m.conversation_id = c.id), c.created_at)
         <= now() - p_older_than;
  if cardinality(v_ids) = 0 then return 0; end if;

  -- What points at a conversation without going with it, first.
  delete from opt_outs o
   where o.business_id = p_copy
     and exists (select 1 from client_channels cc join conversations c on c.client_id = cc.client_id
                  where c.id = any(v_ids) and cc.channel = o.channel and cc.channel_user_id = o.identity);
  delete from promised_dates where conversation_id = any(v_ids);
  delete from deletion_asks where conversation_id = any(v_ids);
  delete from email_confirmations where order_id in (select id from orders where conversation_id = any(v_ids));
  delete from order_proposals where conversation_id = any(v_ids)
     or order_id in (select id from orders where conversation_id = any(v_ids));
  delete from orders where conversation_id = any(v_ids);
  delete from sequence_sends where outbound_id in (select id from outbound_messages where conversation_id = any(v_ids));
  delete from sequence_enrollments where conversation_id = any(v_ids);
  delete from deliveries where conversation_id = any(v_ids);
  delete from spot_checks where conversation_id = any(v_ids);
  delete from repairs where conversation_id = any(v_ids);
  delete from conversation_events where conversation_id = any(v_ids);
  if to_regclass('shadow.turn_decisions') is not null then
    execute 'delete from shadow.turn_decisions where conversation_id = any($1)' using v_ids;
  end if;
  -- The rest goes with the conversation (messages, turns, drafts, quotes, sends, signals, state…).
  delete from conversations where id = any(v_ids);
  return cardinality(v_ids);
end $$;
revoke all on function practice_erase(uuid, interval) from public;

-- ── A customer's erasure keeps their stop, like their suppression ──────────
-- 0130's contract, with one row added.
create or replace function customer_erasure_contract()
returns table (tbl text, action text, clear text[], blank text[], detach text[], match text)
language sql immutable set search_path = public as $$
  values
    ('clients', 'anonymise', array['display_name','email','phone','country','preferred_language','notes'], null::text[], null::text[], null::text),
    ('client_channels', 'erase', null, null, null, null),
    ('conversations', 'shell', array['assigned_to','assigned_at','ai_disclosed_at','ai_disclosure_delivered_at','owner_unsent_reply','owner_unsent_reply_at'], null, null, null),
    ('messages', 'erase', null, null, null, null),
    ('message_fragments', 'erase', null, null, null, null),
    ('turns', 'erase', null, null, null, null),
    ('drafts', 'erase', null, null, null, null),
    ('conversation_state', 'erase', null, null, null, null),
    ('conversation_signals', 'erase', null, null, null, null),
    ('conversation_events', 'erase', null, null, null, null),
    ('conversation_notes', 'erase', null, null, null, null),
    ('escalation_events', 'erase', null, null, null, null),
    ('handoffs', 'erase', null, null, null, null),
    ('sample_requests', 'erase', null, null, null, null),
    ('quotes', 'erase-unless-kept', null, null, null, null),
    ('quote_proofs', 'erase', null, null, null, null),
    ('outbound_messages', 'erase', null, null, null, null),
    ('outbound_transitions', 'erase', null, null, null, null),
    ('deliveries', 'erase', null, null, null, null),
    ('repairs', 'erase', null, null, null, null),
    ('shadow.turn_decisions', 'erase', null, null, null, null),
    ('spot_checks', 'detach', array['correction'], null, array['conversation_id'], null),
    ('orders', 'keep', array['client_email','shipping_address','notes'], null, null, null),
    ('order_updates', 'keep', null, null, null, null),
    ('email_confirmations', 'keep', array['subject','body_html'], array['to_email'], null, null),
    ('sequence_enrollments', 'erase', null, null, null, 'identity'),
    ('sequence_sends', 'erase', null, null, null, null),
    ('contacts', 'erase', null, null, null, 'identity'),
    ('contact_consent', 'erase', null, null, null, 'identity'),
    ('pilot_allowlist', 'erase', null, null, null, 'phone'),
    ('suppressions', 'keep', null, null, null, 'identity'),
    ('opt_outs', 'keep', null, null, null, 'identity'),
    ('deletion_requests', 'keep', null, null, null, null),
    ('deletion_asks', 'erase', null, null, null, null),
    ('customers_answered', 'erase', null, null, null, null),
    ('order_proposals', 'erase', null, null, null, null),
    ('promised_dates', 'erase', null, null, null, null),
    ('client_faces', 'erase', null, null, null, null),
    ('channel_events', 'receipts', null, null, null, null),
    ('channel_audit', 'redact', null, null, null, null),
    ('logins', 'unrelated', null, null, null, null),
    ('login_codes', 'unrelated', null, null, null, null),
    -- 0130 — the advisor's history: a turn that names them goes whole, its other links with it, and a
    -- conversation it leaves empty goes too (erase_customer_rows, below).
    ('advisor_turn_subjects', 'erase', null, null, null, null),
    ('advisor_turns', 'erase', null, null, null, null),
    ('advisor_threads', 'erase', null, null, null, null)
$$;
revoke all on function customer_erasure_contract() from public;

insert into _migrations (version, name) values (135, 'opt_outs')
  on conflict (version) do nothing;
