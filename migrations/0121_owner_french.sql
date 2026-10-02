-- 0121 — the owner's pages in French (phase 9 of the UI rebuild, V1-001).
-- French joins the owner's languages everywhere the schema lists them, as
-- Spanish did in 0119; nothing else moves.
--
--   · `businesses.owner_locale` takes 'fr' (the switch, and sign-up).
--   · `drafts.translation_locale` (0105, G10) — a draft in a language the
--     owner may not read is translated into the owner's own: French too.
--   · `provision_workspace` is redefined, same signature and body as 0119,
--     only so that a sign-up made in French keeps French; 0119 is not edited.
--
-- The customers' languages (`languages_served`, the disclosure's gate per
-- language) are another list and are untouched: French customers were
-- already served (#124, #182), and the French disclosure's gate stays shut.

alter table businesses drop constraint if exists businesses_owner_locale_check;
alter table businesses add constraint businesses_owner_locale_check
  check (owner_locale in ('en', 'zh', 'ar', 'es', 'fr'));

alter table drafts drop constraint if exists drafts_translation_locale_check;
alter table drafts add constraint drafts_translation_locale_check
  check (translation_locale is null or translation_locale in ('en', 'zh', 'ar', 'es', 'fr'));

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
  v_lang     text := case when p_language in ('en','zh','ar','es','fr') then p_language else 'en' end;
  v_zone     text := nullif(btrim(p_profile->>'zone'), '');
  v_currency text := coalesce(nullif(upper(btrim(p_profile->>'currency')), ''), 'USD');
begin
  if v_zone is null or not exists (select 1 from pg_timezone_names where name = v_zone) then
    v_zone := 'UTC';
  end if;

  if p_invite_required then
    update signup_invites set used_at = now(), used_by = null
     where id = p_invite and used_at is null and expires_at > now();
    if not found then
      raise exception 'invite_not_open' using errcode = 'P0001';
    end if;
  end if;

  insert into businesses (id, name, timezone, currency, default_language, owner_locale, engine,
                          kind, country, website, team_size, channels_used, description)
  values (v_business, btrim(p_business_name), v_zone, v_currency, v_lang, v_lang, 'service',
          nullif(p_profile->>'kind', ''), nullif(upper(p_profile->>'country'), ''),
          nullif(p_profile->>'website', ''), nullif(p_profile->>'teamSize', ''),
          coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_profile->'channels', '[]'::jsonb)) x), '{}'),
          nullif(btrim(p_profile->>'sells'), ''));

  insert into people (id, business_id, name, is_owner)
  values (v_person, v_business, btrim(p_owner_name), true);

  insert into logins (business_id, person_id, email, password_hash)
  values (v_business, v_person, lower(btrim(p_email)), p_password_hash);

  insert into autonomy_policy (business_id, capability, mode)
  select v_business, c, 'draft'
    from unnest(array['greet','qualify','recommend','quote','negotiate','confirm_order','follow_up']) as c;

  insert into tenant_budgets (business_id, daily_llm_calls, daily_tokens, soft_warn_pct, on_exceeded)
  values (v_business, 1000, 1000000, 80, 'pause');

  if p_invite_required then
    update signup_invites set used_by = v_business where id = p_invite;
  end if;

  return query select v_business, v_person;
end $$;
revoke all on function provision_workspace(text, text, text, text, text, uuid, boolean, jsonb) from public;
grant execute on function provision_workspace(text, text, text, text, text, uuid, boolean, jsonb) to nomi_app;

insert into _migrations (version, name) values (121, 'owner_french')
on conflict (version) do nothing;
