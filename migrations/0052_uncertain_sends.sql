-- ---------------------------------------------------------------------------
-- 0052 — a message whose fate nobody knows waits for a person.
--
-- The worker marks a row 'sending', calls the provider, then records what came
-- back. A crash, a deploy or a dropped socket between those two steps leaves a
-- row that may or may not have reached the buyer. Until now it was re-queued
-- after two minutes and sent AGAIN: `SENDING_RECLAIM_MS` called that "a rare
-- duplicate send is the accepted cost of never losing a message".
--
-- That trade was the wrong way round for this product. A buyer who receives the
-- same price twice, or the same first e-mail twice, learns something false
-- about the factory — and the machine chose it for her. Losing the message is
-- not the alternative: the row stops here, she is told plainly that it is not
-- known whether it went, and she decides. Draft-first, applied to a send that
-- already left our hands.
--
--   'uncertain'  the provider was called and the answer never arrived
--
-- No row moves into this state by itself except through that interruption, and
-- nothing leaves it except a person choosing: send it again, or leave it.
-- ---------------------------------------------------------------------------

alter table outbound_messages drop constraint if exists outbound_messages_status_check;
alter table outbound_messages add constraint outbound_messages_status_check
  check (status in ('queued','sending','sent','delivered','read','failed','canceled','uncertain'));

-- The partial index that keeps one queued row per conversation is unaffected:
-- an uncertain row is not queued, so it neither blocks nor is blocked by one.

insert into _migrations (version, name) values (52, 'uncertain_sends')
on conflict (version) do nothing;
