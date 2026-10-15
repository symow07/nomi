-- ---------------------------------------------------------------------------
-- 0164 — A MAILBOX IS CONNECTED TO ONE WORKSPACE AT A TIME (the isolation
-- sweep's item 12; the owner, 2026-10-15: "If a cheap guard stops one mailbox
-- being connected twice, take it while you're in there.")
--
-- `mail_accounts` allowed one live mailbox per workspace (0050) but said
-- nothing across workspaces: two workspaces could read and send from the same
-- Gmail, and both would read the same mail — exactly what makes item 1 (one
-- e-mail, two workspaces, one answered) happen. WhatsApp numbers and Pages are
-- unique among live rows; mailboxes now are too. The connect is refused,
-- changing nothing, with its own notice (`connect.flash.address_taken`).
--
-- Production had one live mailbox when this was written, so nothing collides.
-- An archived row (a mailbox disconnected) frees its address.
-- ---------------------------------------------------------------------------

create unique index if not exists mail_accounts_one_live_address
  on mail_accounts (lower(address)) where archived_at is null;

insert into _migrations (version, name) values (164, 'mailbox_one_workspace')
  on conflict (version) do nothing;
