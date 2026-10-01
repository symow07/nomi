-- 0100 — a workspace is born with what the cohort needs (G2, the onboarding
-- plan's phase 5). `provision_workspace` (0056) is redefined, same signature;
-- 0056 is never edited.
--
--   · The time zone and the currency sign-up chose (TZ, CUR) are written by
--     the function itself, in the insert that makes the business. Until now
--     the function wrote Asia/Shanghai and USD and the app overwrote both in
--     the same transaction: two writers of one fact. A zone Postgres does not
--     know is UTC; a currency outside the list raises (the column's check),
--     and nothing is half-made.
--   · The seven capabilities, each in `draft`: nothing sends alone until the
--     owner's approvals earn it. A missing row already meant draft; now a new
--     workspace has the rows, so what it is set to is on the record.
--   · A budget row with a HARD cap (`on_exceeded = 'pause'`): 1,000,000
--     tokens and 1,000 model calls a day. Production's ledger (2026-10-01):
--     about 1,000 tokens and 1.2 calls a turn, 2,100 tokens at p95 — the cap
--     is some 500 turns a day, ten times the 50 sends a day a new workspace
--     may make (CEIL), and bounds one workspace's spend at well under a
--     dollar a day. G3 enforces it before the model; until then the send
--     gate's existing check reads it (db/channels.ts). Workspaces made before
--     this have no row and no cap, as before.

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

insert into _migrations (version, name) values (100, 'provision_defaults')
on conflict (version) do nothing;
