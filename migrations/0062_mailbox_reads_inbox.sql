-- 0062 — E1: she reads the inbox.
--
-- Until now a connected mailbox could only SEND; a buyer's e-mail landed in
-- the owner's Gmail unread by this product, and the page promised exactly
-- that. The owner asked for e-mail to be answered like every other channel.
--
-- Reading is a separate grant the owner makes on purpose (gmail.readonly),
-- recorded here as a fact about the connection, never inferred. `inbox_read_at`
-- is the watermark of the newest mail seen, so a minute's read asks Google only
-- for what is newer. `messages.subject` keeps what the buyer's mail was called,
-- so her answer can be "Re:" it — the only way a reply lands in his thread.

alter table mail_accounts
  add column if not exists reads_inbox   boolean not null default false,
  add column if not exists inbox_read_at timestamptz;

alter table messages add column if not exists subject text;

insert into _migrations (version, name) values (62, 'mailbox_reads_inbox')
on conflict (version) do nothing;
