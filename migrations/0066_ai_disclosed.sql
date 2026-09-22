-- 0066 — when this conversation was told it is talking to an AI.
--
-- The rule: any message sent WITHOUT human approval carries a short AI
-- disclosure on the FIRST message of the conversation. A draft the owner read
-- and sent does not need one — a person is answering, through her.
--
-- "The first" needs a memory, and this is it. Without a column the turn would
-- have to infer it from the shape of the transcript, which is the kind of
-- derivation that is right until the day somebody changes how messages are
-- recorded. One timestamp, written the moment the disclosure goes out, read
-- once per auto-sent turn.
--
-- NULL means "not yet told", which is the honest default for every
-- conversation that existed before this migration: none of them was ever sent
-- a disclosure, so none of them should read as having had one.
--
-- It is on `conversations` rather than `conversation_state` because it is not
-- part of the sales state machine — it does not reset, it is not replayed, and
-- a new conversation with the same buyer is a new conversation that gets told
-- again. That is deliberate: a buyer who comes back three months later is owed
-- the sentence again, not a memory of having heard it once.

alter table conversations
  add column if not exists ai_disclosed_at timestamptz;

comment on column conversations.ai_disclosed_at is
  'When this conversation was sent the AI disclosure, on the first message sent without human approval. Null until then. Per conversation, never per buyer: a new conversation is told again.';

insert into _migrations (version, name) values (66, 'ai_disclosed')
on conflict (version) do nothing;
