-- 0123 — THE WARMTH RUN (2026-10-03): customers' faces.
--
-- The owner: "Use the customer's profile photo where the channel provides one
-- (WhatsApp, Instagram, Messenger)… Cache them; never block a page render on
-- fetching a photo; handle a missing or failed photo silently."
--
-- Instagram and Messenger answer a profile's photo to the Page's token (the
-- same call that already asks for a name). WhatsApp's Cloud API gives none, and
-- e-mail has none: those customers are a coloured initial, drawn by the page.
--
-- The photo is KEPT here, not linked: Meta's photo addresses expire within
-- days, and a page that pointed at them would show holes; and a page must
-- never wait on Meta. A background job fills this table (src/worker/faces.ts);
-- pages read only `version` (to draw the <img>) and the route that serves the
-- bytes reads the row by the customer's id, under the business's row security.
--
--   kept    — a photo, its type and a version (the start of its SHA-256), so
--             the address changes when the photo does and the browser keeps it
--             until then;
--   none    — the channel answered, and has no photo for them;
--   failed  — the channel or the photo did not answer; tried again later.

create table if not exists client_faces (
  client_id    uuid primary key references clients(id) on delete cascade,
  business_id  uuid not null references businesses(id) on delete cascade,
  state        text not null check (state in ('kept', 'none', 'failed')),
  content_type text check (content_type is null or content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  bytes        bytea check (bytes is null or octet_length(bytes) between 1 and 524288),
  version      text check (version is null or version ~ '^[0-9a-f]{12}$'),
  tried_at     timestamptz not null default now(),
  kept_at      timestamptz,
  attempts     integer not null default 1 check (attempts >= 1),
  constraint client_faces_kept_whole check (
    (state = 'kept') = (bytes is not null and content_type is not null and version is not null and kept_at is not null))
);
create index if not exists client_faces_business on client_faces (business_id);

alter table client_faces enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'client_faces' and policyname = 'client_faces_tenant') then
    create policy client_faces_tenant on client_faces
      for all to nomi_app
      using (business_id = current_business_id())
      with check (business_id = current_business_id());
  end if;
end $$;
grant select, insert, update on client_faces to nomi_app;
revoke delete, truncate on client_faces from nomi_app;

-- Who is due a look, across the businesses (the job is not inside any one):
-- an Instagram or Messenger customer of a business whose Page is connected and
-- answering, with no face on record, or one whose time has come again —
--   kept    after 30 days (a customer changes their photo);
--   none    after 30 days;
--   failed  after a day, five times; then every 30 days.
-- Newest customers first: the face the owner is about to see.
create or replace function faces_due(max_rows integer)
returns table (business_id uuid, client_id uuid, channel text, channel_user_id text)
language sql stable security definer set search_path = public as $$
  select cl.business_id, cl.id, cc.channel, cc.channel_user_id
    from clients cl
    join lateral (select c.channel, c.channel_user_id from client_channels c
                   where c.client_id = cl.id and c.channel in ('instagram', 'messenger')
                   order by c.channel limit 1) cc on true
    left join client_faces f on f.client_id = cl.id
   where exists (select 1 from meta_accounts m
                  where m.business_id = cl.business_id and m.archived_at is null and m.last_error is null)
     and (f.client_id is null
          or (f.state in ('kept', 'none') and f.tried_at < now() - interval '30 days')
          or (f.state = 'failed' and f.attempts < 5 and f.tried_at < now() - interval '1 day')
          or (f.state = 'failed' and f.tried_at < now() - interval '30 days'))
   order by cl.last_seen_at desc nulls last
   limit greatest(0, least(max_rows, 200));
$$;
revoke all on function faces_due(integer) from public;
grant execute on function faces_due(integer) to nomi_app;

insert into _migrations (version, name) values (123, 'client_faces')
on conflict (version) do nothing;
