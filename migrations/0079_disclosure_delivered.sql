-- 0079 — when the disclosure REACHED the buyer, not when it was queued.
--
-- `ai_disclosed_at` (0066) is written when a reply carrying the disclosure is
-- QUEUED. A queued reply can still be refused at send time — the owner's Stop,
-- a hand-over, the pilot allowlist, a closed window — and then the buyer was
-- never told, while the column says he was. Two rules read "has this buyer
-- been told?" and both need the truth (the owner's decision, 2026-09-28):
--
--   · a shop's opener (客服在吗, "Is anyone there?") asked AGAIN after the buyer
--     was told is a request for a person and hands off; before, it is answered;
--   · the disclosure goes with each message sent alone until one carrying it
--     has actually gone out — not only until one was queued.
--
-- So a second timestamp, written by the send path the moment the provider
-- accepts a message that carries the disclosure sentence: an auto-sent reply,
-- the disclosure sent when a buyer asked what he is talking to, or a draft or a
-- reply of the owner's that carries it. Whatever mode sent it. NULL until then.
--
-- Written only by that send, and never by saveState: the turn reads its state
-- before a send can land, and writing that copy back would erase the stamp.
--
-- Backfill: a conversation already marked as told gets the time its first
-- sent message carrying the disclosure left, if one did. The sentence has had
-- one English, one Chinese and two Arabic wordings (the Arabic changed on
-- 2026-09-28); each is recognised by a phrase no other message contains.

alter table conversations
  add column if not exists ai_disclosure_delivered_at timestamptz;

comment on column conversations.ai_disclosure_delivered_at is
  'When a message carrying the AI disclosure was accepted by the provider for this conversation (any mode). Null until then. Read by the shop-opener rule and by the once-per-conversation disclosure; written by the send path only.';

update conversations c
   set ai_disclosure_delivered_at = told.first_sent
  from (
    select om.conversation_id, min(om.sent_at) as first_sent
      from outbound_messages om
      join conversations cc on cc.id = om.conversation_id
     where cc.ai_disclosed_at is not null
       and om.status in ('sent', 'delivered', 'read')
       and om.sent_at is not null
       and (   om.body like '%''s AI assistant. If you''d like a person from our team%'
            or om.body like '%的AI助手。如需人工服务请告诉我%'
            or om.body like '%المساعد الذكي لدى%'
            or om.body like '%مساعد آلي لدى%')
     group by om.conversation_id
  ) told
 where c.id = told.conversation_id
   and c.ai_disclosure_delivered_at is null;

insert into _migrations (version, name) values (79, 'disclosure_delivered')
on conflict (version) do nothing;
