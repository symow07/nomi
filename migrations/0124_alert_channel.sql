-- 0124 — THE WARMTH RUN (2026-10-03), phase 8: how a notification reaches
-- each person outside Nomi.
--
-- The owner: "Outside the app: build the delivery channel as a setting, not a
-- hardcoded path. E-mail and browser notification work today. WhatsApp is the
-- intended primary and becomes the default the moment Meta approval lands —
-- design it so switching is a setting change, not a rebuild." And: "Only two
-- things may interrupt the owner outside the app: an order waiting for their
-- tap, and a conversation the assistant handed over because it could not
-- handle it."
--
-- Each person keeps their own choice: 'email', 'browser' (the web push
-- subscriptions of 0098) or 'whatsapp' (the business's alert number). NULL is
-- "the default", and the default is never written down: it is decided as each
-- notification leaves — WhatsApp where the owner's WhatsApp path is open (Meta
-- approved Nomi, `META_APP_REVIEW=approved:<date>`, an alert number is set and
-- a channel is live), e-mail otherwise. So the day approval lands, everyone
-- still on the default moves to WhatsApp with no row changed.
--
-- WhatsApp may be CHOSEN before that, wherever the owner's alert number is set
-- on a live channel (src/core/owner/alertChannel.ts): it is how hand-overs
-- reached the pilot until now. So, once, below: an owner who set an alert
-- number asked for WhatsApp alerts, and that is recorded as their choice —
-- today's behaviour kept. The owner is found as the code finds them (the live
-- `people` row with `is_owner`, one per business by `people_one_owner`); a
-- business with no owner row is left as it is.

alter table people
  add column if not exists alert_channel text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'people_alert_channel_known') then
    alter table people add constraint people_alert_channel_known
      check (alert_channel is null or alert_channel in ('email', 'browser', 'whatsapp'));
  end if;
end $$;

-- A colleague who turned on phone alerts before this setting existed asked
-- for alerts on their phone, and for nothing else: that is their choice,
-- written down once, so they keep hearing on the phone rather than by an
-- e-mail they never asked for.
update people p set alert_channel = 'browser'
 where not p.is_owner and p.archived_at is null and p.alert_channel is null
   and exists (select 1 from push_subscriptions s where s.person_id = p.id and s.archived_at is null);

-- Whoever set an alert number asked for WhatsApp alerts: the owner keeps them.
update people p set alert_channel = 'whatsapp'
  from businesses b
 where b.id = p.business_id and b.owner_phone is not null
   and p.is_owner and p.archived_at is null and p.alert_channel is null;

insert into _migrations (version, name) values (124, 'alert_channel')
on conflict (version) do nothing;
