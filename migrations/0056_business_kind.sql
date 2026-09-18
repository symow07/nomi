-- ---------------------------------------------------------------------------
-- 0056 — A2: what KIND of business signed up.
--
-- Nomi was built for one factory and said "factory" everywhere. It is for any
-- business that talks to buyers on social channels — a manufacturer, a trading
-- company, a brand, an agency. Sign-up now asks, and the answers live on the
-- business row because they describe the business, not the person.
--
-- Five columns, all nullable: the first factory, and every workspace made
-- before today, never answered these questions, and "not asked" must not read
-- as an answer.
--
--   kind           one of eight categories she picks
--   country        ISO 3166-1 alpha-2, upper case
--   website        optional, https only
--   team_size      a band, not a number she has to look up
--   channels_used  where she talks to buyers TODAY — for whoever sells Nomi;
--                  the product connects channels for real on its own page
-- ---------------------------------------------------------------------------

alter table businesses
  add column if not exists kind text
    check (kind is null or kind in
      ('manufacturer','trading','wholesale','brand','retail','agency','services','other')),
  add column if not exists country text check (country is null or country ~ '^[A-Z]{2}$'),
  add column if not exists website text check (website is null or website ~ '^https://[^\s]{4,200}$'),
  add column if not exists team_size text
    check (team_size is null or team_size in ('1','2-5','6-20','21-100','100+')),
  add column if not exists channels_used text[] not null default '{}';

-- THE one way a tenant comes to exist, again — with what sign-up now asks.
-- A NEW function rather than new arguments on `provision_account`: the app and
-- the schema deploy seconds apart, and the old name must go on answering the
-- old code until the new code is up. The profile is one jsonb so the next
-- question sign-up asks is not another signature.
--
-- Everything in the profile is validated AGAIN here by the column checks; a
-- value that does not fit raises, and nothing is half-made.
create or replace function provision_workspace(
  p_business_name text, p_language text, p_owner_name text,
  p_email text, p_password_hash text, p_invite uuid, p_invite_required boolean,
  p_profile jsonb
)
returns table (business_id uuid, person_id uuid)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_business uuid := gen_random_uuid();
  v_person   uuid := gen_random_uuid();
  v_lang     text := case when p_language in ('en','zh','ar') then p_language else 'en' end;
begin
  if p_invite_required then
    update signup_invites set used_at = now(), used_by = null
     where id = p_invite and used_at is null and expires_at > now();
    if not found then
      raise exception 'invite_not_open' using errcode = 'P0001';
    end if;
  end if;

  insert into businesses (id, name, timezone, default_language, owner_locale, engine,
                          kind, country, website, team_size, channels_used, description)
  values (v_business, btrim(p_business_name), 'Asia/Shanghai', v_lang, v_lang, 'service',
          nullif(p_profile->>'kind', ''), nullif(upper(p_profile->>'country'), ''),
          nullif(p_profile->>'website', ''), nullif(p_profile->>'teamSize', ''),
          coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_profile->'channels', '[]'::jsonb)) x), '{}'),
          nullif(btrim(p_profile->>'sells'), ''));

  insert into people (id, business_id, name, is_owner)
  values (v_person, v_business, btrim(p_owner_name), true);

  insert into logins (business_id, person_id, email, password_hash)
  values (v_business, v_person, lower(btrim(p_email)), p_password_hash);

  if p_invite_required then
    update signup_invites set used_by = v_business where id = p_invite;
  end if;

  return query select v_business, v_person;
end $$;
revoke all on function provision_workspace(text, text, text, text, text, uuid, boolean, jsonb) from public;
grant execute on function provision_workspace(text, text, text, text, text, uuid, boolean, jsonb) to nomi_app;

insert into _migrations (version, name) values (56, 'business_kind')
on conflict (version) do nothing;
