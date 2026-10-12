-- ---------------------------------------------------------------------------
-- 0146 — D17 (the data-protection audit, 2026-10-12): WHAT IS ARCHIVED STOPS
-- HOLDING WHO SOMEONE WAS, OR A WAY IN.
--
-- Removing a team member, replacing a login, a device that stopped answering,
-- a mailbox disconnected: each archives its row (`archived_at`), and every
-- archived row kept what it held for the life of the workspace — a removed
-- member's access-code hash, when they were last seen and their alert channel;
-- a login's address and password hash; a device's push endpoint and keys; a
-- mailbox's refresh token. And removing a member archived only them: their own
-- login and devices stayed live.
--
-- From here, archiving clears them, by trigger, whoever archives (the app, the
-- operator's tools): what identifies the person or opens the account is
-- replaced by a value that identifies nobody (the columns' checks are the app's
-- own and stay). A removed member's NAME stays, beside what they did, until the
-- workspace closes (the privacy page says so); their login and devices are
-- archived with them. Rows already archived are cleared now.
-- ---------------------------------------------------------------------------

create or replace function people_archived_forget() returns trigger
language plpgsql as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    new.code_hash := null;
    new.last_seen_at := null;
    new.alert_channel := null;
  end if;
  return new;
end $$;
drop trigger if exists people_archived_forget on people;
create trigger people_archived_forget before update of archived_at on people
  for each row execute function people_archived_forget();

-- A removed member's own login and devices go with them.
create or replace function people_archived_cascade() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    update logins set archived_at = now() where person_id = new.id and archived_at is null;
    update push_subscriptions set archived_at = now(), archived_reason = 'removed' where person_id = new.id and archived_at is null;
  end if;
  return null;
end $$;
revoke all on function people_archived_cascade() from public;
drop trigger if exists people_archived_cascade on people;
create trigger people_archived_cascade after update of archived_at on people
  for each row execute function people_archived_cascade();

create or replace function logins_archived_forget() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    -- An unfinished sign-up of that address loses it too, unless a live login still signs in with it (D1).
    if not exists (select 1 from logins l where l.email = old.email and l.archived_at is null and l.id <> old.id) then
      update login_codes set payload = null, email = '' where purpose = 'signup' and email = old.email;
    end if;
    new.email := 'erased.' || new.id::text || '@login.invalid';
    new.password_hash := 'scrypt$erased';
    new.failed_attempts := 0;
    new.locked_until := null;
    new.email_verified_at := null;
  end if;
  return new;
end $$;
revoke all on function logins_archived_forget() from public;
drop trigger if exists logins_archived_forget on logins;
create trigger logins_archived_forget before update of archived_at on logins
  for each row execute function logins_archived_forget();

create or replace function push_subscriptions_archived_forget() returns trigger
language plpgsql as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    new.endpoint := 'https://erased.invalid/' || new.id::text;
    new.p256dh := repeat('0', 87);
    new.auth := repeat('0', 22);
    new.device := null;
  end if;
  return new;
end $$;
drop trigger if exists push_subscriptions_archived_forget on push_subscriptions;
create trigger push_subscriptions_archived_forget before update of archived_at on push_subscriptions
  for each row execute function push_subscriptions_archived_forget();

create or replace function mail_accounts_archived_forget() returns trigger
language plpgsql as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    new.refresh_token_ciphertext := 'v1.erased';
  end if;
  return new;
end $$;
drop trigger if exists mail_accounts_archived_forget on mail_accounts;
create trigger mail_accounts_archived_forget before update of archived_at on mail_accounts
  for each row execute function mail_accounts_archived_forget();

-- What is already archived, the same now.
update people set code_hash = null, last_seen_at = null, alert_channel = null
 where archived_at is not null and (code_hash is not null or last_seen_at is not null or alert_channel is not null);
update logins set archived_at = now()
 where archived_at is null and person_id in (select id from people where archived_at is not null);
update push_subscriptions set archived_at = now(), archived_reason = 'removed'
 where archived_at is null and person_id in (select id from people where archived_at is not null);
update logins set email = 'erased.' || id::text || '@login.invalid', password_hash = 'scrypt$erased',
                  failed_attempts = 0, locked_until = null, email_verified_at = null
 where archived_at is not null and email not like 'erased.%@login.invalid';
update push_subscriptions set endpoint = 'https://erased.invalid/' || id::text, p256dh = repeat('0', 87), auth = repeat('0', 22), device = null
 where archived_at is not null and endpoint not like 'https://erased.invalid/%';
update mail_accounts set refresh_token_ciphertext = 'v1.erased'
 where archived_at is not null and refresh_token_ciphertext <> 'v1.erased';

insert into _migrations (version, name) values (146, 'staff_records')
  on conflict (version) do nothing;
