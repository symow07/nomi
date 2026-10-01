-- 0112 — daily caps on the mail strangers cause (MAIL, the onboarding plan's
-- phase 7b; decision 36).
--
-- Sign-in codes, password-reset links and owner alerts are sent to addresses
-- typed by people Nomi does not know yet. Until now only codes were limited,
-- 6 an hour per address (0058); nothing limited a day, or the installation.
-- A burst — scripted sign-ups, a loop — could exhaust the sender's quota and
-- stop every code and alert at once.
--
--   · mail_sends — per UTC day, kind ('code' or 'alert') and recipient: how
--     many were sent and how many the caps refused. The recipient is kept
--     only as its SHA-256 (lower-cased): counted, never readable.
--   · claim_mail_send(kind, recipient, per_address, installation) — asked
--     before each send: 'ok' (and counted), 'address_cap' or
--     'installation_cap' (and counted as refused). One at a time per kind.

create table if not exists mail_sends (
  day date not null,
  kind text not null check (kind in ('code', 'alert')),
  recipient_hash text not null check (recipient_hash ~ '^[0-9a-f]{64}$'),
  sent integer not null default 0 check (sent >= 0),
  refused integer not null default 0 check (refused >= 0),
  primary key (day, kind, recipient_hash)
);
revoke all on mail_sends from public;

create or replace function claim_mail_send(p_kind text, p_recipient text, p_per_address integer, p_installation integer)
returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_hash text := encode(sha256(convert_to(lower(btrim(coalesce(p_recipient, ''))), 'UTF8')), 'hex');
  v_all integer;
  v_mine integer;
  v_why text := null;
begin
  perform pg_advisory_xact_lock(hashtext('mail_sends:' || p_kind));
  select coalesce(sum(sent), 0) into v_all from mail_sends where day = v_day and kind = p_kind;
  select coalesce(sum(sent), 0) into v_mine from mail_sends where day = v_day and kind = p_kind and recipient_hash = v_hash;
  if v_all >= p_installation then v_why := 'installation_cap';
  elsif v_mine >= p_per_address then v_why := 'address_cap';
  end if;
  insert into mail_sends (day, kind, recipient_hash, sent, refused)
  values (v_day, p_kind, v_hash, case when v_why is null then 1 else 0 end, case when v_why is null then 0 else 1 end)
  on conflict (day, kind, recipient_hash) do update
    set sent = mail_sends.sent + excluded.sent, refused = mail_sends.refused + excluded.refused;
  return coalesce(v_why, 'ok');
end $$;
revoke all on function claim_mail_send(text, text, integer, integer) from public;
grant execute on function claim_mail_send(text, text, integer, integer) to nomi_app;

-- The operator's daily list reads yesterday's totals: counts only.
create or replace function mail_sends_on(p_day date)
returns table (kind text, sent bigint, refused bigint)
language sql stable security definer set search_path = public as $$
  select kind, coalesce(sum(sent), 0), coalesce(sum(refused), 0) from mail_sends where day = p_day group by kind order by kind;
$$;
revoke all on function mail_sends_on(date) from public;
grant execute on function mail_sends_on(date) to nomi_app;

insert into _migrations (version, name) values (112, 'mail_caps')
on conflict (version) do nothing;
