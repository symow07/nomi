-- ---------------------------------------------------------------------------
-- 0043 — G13: the owner can play the buyer's voice note.
--
-- WHAT WAS WRONG. M34 transcribes a voice note and shows the owner the words,
-- and when the machine could not make them out it asks her to type what was
-- said — about a recording she has no way to hear. The provider's media id
-- existed only inside the pg-boss job that processed the message; once that
-- job finished, nothing in the product could ask WhatsApp for the audio again.
-- So the one person who can correct a transcript was the one person who could
-- not listen to it.
--
-- WHAT THIS ADDS:
--
--   messages.provider_media_id — the id the CHANNEL knows the file by. Not a
--     URL: Meta's download links are short-lived and signed, and storing one
--     would be storing a credential that expires. The id is a handle we
--     exchange for bytes through the same fetcher M34 already uses, with the
--     tenant's own channel credential, at the moment she presses play.
--
-- NOT BACKFILLED, because it cannot be: for every note received before this
-- migration the id only ever lived in a job payload. Those rows keep their
-- transcript and say plainly that no recording is kept.
--
-- The bytes are never stored. WhatsApp holds media for a limited time and then
-- stops; when it does, the page says the recording has expired rather than
-- pretending to have it.
--
-- Additive and forward-only (ADR-0007).
-- ---------------------------------------------------------------------------

alter table messages add column if not exists provider_media_id text;

insert into _migrations (version, name) values (43, 'voice_playback')
on conflict (version) do nothing;
