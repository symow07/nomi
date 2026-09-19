-- 0061 — N2a: her own understanding of the message, beside the model's.
--
-- The rules that decide a turn use four things from a model's analysis —
-- product, quantity, stage, complaint — and the language to answer in. 0061
-- stores what HER OWN rules made of the same message, and where the two agree,
-- on the turn's replay row. It is a SHADOW: nothing reads it to decide a turn.
-- Whether any field may stop asking a model is a question for these rows.
--
-- Null on every turn where no model analysed the message (there is nothing to
-- compare with) and on every turn from before this migration.

alter table turns add column if not exists own_understanding jsonb;

insert into _migrations (version, name) values (61, 'turn_own_understanding')
on conflict (version) do nothing;
