-- 0068 · D — the outreach area is per workspace, OFF by default.
--
-- Decided 2026-09-21 (docs/IA-PROPOSAL.md, "Decided"): sequences, prospects
-- and writing first sit behind a switch a new workspace does not have. Off
-- means no route answers (404), no page links there, and nothing is written
-- first — `outreachFacts` reads this column at the send decision, whatever
-- the per-channel `outreach_settings` rows say. There is no owner-facing
-- switch; `tools/outreach-area.mjs` flips it.
--
-- On for exactly one workspace: the pilot's, Westlake Canvas Co., whose id the
-- owner confirmed on 2026-09-23. Against a database without that row (a fresh
-- local one) the update touches nothing, which is the intended state there.

alter table businesses
  add column if not exists outreach_area boolean not null default false;

comment on column businesses.outreach_area is
  'D — the outreach area (sequences, prospects, writing first) exists for this workspace. Off: its routes are 404, nothing links there, nothing is written first.';

update businesses set outreach_area = true
 where id = '7dc89f42-852e-465a-920f-8af170dc83cd';

insert into _migrations (version, name) values (68, 'outreach_area')
on conflict (version) do nothing;
