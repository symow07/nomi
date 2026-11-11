-- ---------------------------------------------------------------------------
-- 0242 — KS6's "CONNECTED BEFORE" COUNTS EVERY CHANNEL KIND.
--
-- What 0115 said: while the installation's `approve_connections` is on, a
-- workspace that signed itself up waits for the operator before its FIRST
-- connection; one that connected before, in any state since, is never asked
-- again. "Connected before" was read as a WhatsApp `channels` row or a
-- `meta_accounts` row — the only two doors that asked in 0115.
--
-- What changed: since 4.1 (D3) every connect door asks the one connection
-- question — the mailbox, Telegram, the chat page and Reconnect too. So a
-- workspace whose only channels were a mailbox, Telegram or the chat page was
-- asked for approval AGAIN: turning its own Telegram or chat page back on was
-- refused "approval".
--
-- Now: "connected before" is exactly what 0240's `first_channel_at()` counts —
-- any channel kind the product connects (every `channels` row's
-- `connected_at`, the channel trail's first connect or reconnect, a Page, a
-- mailbox, a WhatsApp account, a TikTok account), archived or not. One
-- definition, read in one place. The rest of 0115's answer is unchanged: the
-- switch, the installation's own workspace and every workspace the operator
-- made (`signed_up_at` null) never asked, a practice copy never asked, an
-- approved ask never asked again, and a workspace that signed itself up with
-- nothing ever connected still asked.
-- ---------------------------------------------------------------------------

-- Re-made from 0115's (its only definition): "connected before" is `first_channel_at()`.
create or replace function connection_approval_needed()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ops_flags where flag = 'approve_connections' and cleared_at is null)
     and coalesce((
       select b.signed_up_at is not null and b.practice_of is null
          and not exists (select 1 from connection_approvals a where a.business_id = b.id and a.decision = 'approved')
          -- Connected before, any kind, in any state since: never asked again (0240's one definition).
          and first_channel_at(b.id) is null
         from businesses b where b.id = current_business_id()), false)
$$;
revoke all on function connection_approval_needed() from public;
grant execute on function connection_approval_needed() to nomi_app;

insert into _migrations (version, name) values (242, 'ks6_connected_before')
  on conflict (version) do nothing;
