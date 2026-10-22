-- ---------------------------------------------------------------------------
-- 0204 — ONE TELEGRAM BOT, MANY BUSINESSES: WHICH ONE A CHAT IS WRITING TO (Phase 5, S7; the owner's choice,
-- 2026-10-22: one Nomi bot for everyone).
--
-- Every business that turns Telegram on gets a start code (`channel_credentials` on 'telegram', `external_ref` = the
-- code), and shares the bot's link with it: t.me/<bot>?start=<code>. A buyer who opens that link starts a chat that
-- belongs to that business — a `client_channels` handle there, the chat's id. A chat that has started more than one
-- business's link writes to the one it started last (its handle's newest `last_inbound_at`), and only while that
-- business has Telegram on; otherwise to nobody.
--
-- The question is asked before any tenant is known, so it is a narrowly-scoped definer function, like
-- `resolve_tenant`: a chat id in, the business's start code out (which `resolve_tenant` then turns into the business).
-- ---------------------------------------------------------------------------

create or replace function telegram_route(p_chat text) returns text
  language sql stable security definer set search_path = public, pg_temp as $$
  select cr.external_ref
    from client_channels cc
    join channel_credentials cr on cr.business_id = cc.business_id and cr.channel = 'telegram' and cr.is_active
   where cc.channel = 'telegram' and cc.channel_user_id = p_chat
   order by cc.last_inbound_at desc nulls last, cc.created_at desc
   limit 1
$$;
revoke all on function telegram_route(text) from public;
grant execute on function telegram_route(text) to nomi_app;

insert into _migrations (version, name) values (204, 'telegram_route')
  on conflict (version) do nothing;
