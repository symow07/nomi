-- ---------------------------------------------------------------------------
-- 0209 — THE FEC'S FILE NAME: Nomi's default, the workspace's to change (Phase 5, R2; the owner, 2026-10-23).
--
-- No official Moroccan FEC file name exists. CNC Avis n° 24 names the file and its eighteen fields and nothing of
-- its envelope; CGI art. 210 asks for "une copie du fichier des écritures comptables" with no name; the DGI's 2025
-- activity report says its system to receive FECs is built and publishes no specification (docs/PHASE-5.md, R2).
-- So the name is a DEFAULT, never presented as required: `{ICE}FEC{YYYYMMDD}.txt` — the business's ICE, "FEC", the
-- fiscal year's last day — and each workspace may set its own (an accountant may ask for another).
--
-- Stored as a pattern: letters, digits, dots, dashes, underscores and the two placeholders' braces, at most 80
-- characters, never starting with a dot. The placeholders themselves are checked by the app (src/core/books/fec.ts).
-- ---------------------------------------------------------------------------

alter table books_settings add column if not exists fec_filename text not null default '{ICE}FEC{YYYYMMDD}.txt';
alter table books_settings drop constraint if exists books_settings_fec_filename_shape;
alter table books_settings add constraint books_settings_fec_filename_shape
  check (fec_filename ~ '^[A-Za-z0-9_{}-][A-Za-z0-9_.{}-]{0,79}$');

insert into _migrations (version, name) values (209, 'fec_filename')
  on conflict (version) do nothing;
