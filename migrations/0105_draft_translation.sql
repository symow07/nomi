-- 0105 — a draft in a language the owner may not be able to read (G10, the
-- onboarding plan's phase 5; decision 38).
--
-- The card says which language the reply is in, lists its figures in Western
-- digits, and — on the owner's request — shows it translated into the owner's
-- own language. The translation is kept on the draft, for the owner's eyes
-- only: it is never sent, never offered as the reply, and it is the model's
-- reading, not the business's words. It costs a model call, so it is counted
-- on the day's allowance (G3) like any other.

alter table drafts
  add column if not exists translation text check (translation is null or length(translation) <= 8000),
  add column if not exists translation_locale text check (translation_locale is null or translation_locale in ('en', 'zh', 'ar')),
  add column if not exists translated_at timestamptz;
alter table drafts drop constraint if exists drafts_translation_whole;
alter table drafts add constraint drafts_translation_whole
  check ((translation is null) = (translation_locale is null) and (translation is null) = (translated_at is null));

insert into _migrations (version, name) values (105, 'draft_translation')
on conflict (version) do nothing;
