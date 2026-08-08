-- =============================================================================
-- Nomi — Row Level Security
-- Run this AFTER schema.sql and seed_products.sql.
-- =============================================================================
--
-- WHY THIS EXISTS
--
-- Supabase grants the `anon` role access to every table in the `public` schema
-- by default, and new tables have RLS DISABLED. Left as-is, anyone holding the
-- anon key can read and write `clients` (names, emails, phones, countries),
-- `messages` (the full conversation history), and `orders` (quantities, prices,
-- totals). The anon key is designed to be publicly distributable, so treating
-- it as a secret is not a defence.
--
-- THE MODEL
--
-- Nomi has no browser client. n8n is a trusted server-side caller, so it
-- can hold the service key, and nothing else ever needs database access. We
-- therefore deny `anon` and `authenticated` outright:
--
--   * RLS on, with NO policies  →  anon/authenticated get zero rows. Deny by
--     default. Adding a policy later is an explicit, reviewable act.
--   * `service_role` has the BYPASSRLS attribute, so n8n keeps working with no
--     policies needed. This is the intended Supabase design, not a loophole.
--   * We also REVOKE the table grants, so a future `disable row level security`
--     by mistake still leaves anon with no privileges. Belt and braces.
--
-- CONSEQUENCE FOR n8n
--
-- Every Supabase node must send SUPABASE_SERVICE_KEY — reads included.
-- SUPABASE_ANON_KEY is no longer used by any workflow and can be left unset.
-- If a read starts returning [] after applying this file, that node is still on
-- the anon key.
-- =============================================================================

-- --- 1. Enable RLS. No policies = deny all for anon/authenticated. -----------

alter table businesses          enable row level security;
alter table channel_sources     enable row level security;
alter table products            enable row level security;
alter table product_aliases     enable row level security;
alter table product_images      enable row level security;
alter table clients             enable row level security;
alter table client_channels     enable row level security;
alter table conversations       enable row level security;
alter table messages            enable row level security;
alter table conversation_state  enable row level security;
alter table orders              enable row level security;
alter table escalation_events   enable row level security;
alter table email_confirmations enable row level security;

-- --- 2. Remove the default public-schema grants. -----------------------------
-- Defence in depth: even with RLS accidentally off, anon holds no privileges.

revoke all on all tables     in schema public from anon, authenticated;
revoke all on all sequences  in schema public from anon, authenticated;
revoke all on all functions  in schema public from anon, authenticated;

-- Stop future tables/functions from being granted to anon automatically.
alter default privileges in schema public
  revoke all on tables    from anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges in schema public
  revoke all on functions from anon, authenticated;

-- --- 3. Views ---------------------------------------------------------------
-- active_conversations_summary runs with the *view owner's* rights, so it would
-- otherwise be a way around RLS on the underlying tables. security_invoker makes
-- it run as the caller instead, so anon gets nothing through it either.
-- (Postgres 15+ / current Supabase. If this errors on an older instance, the
-- REVOKE below is what actually protects you.)

alter view active_conversations_summary set (security_invoker = true);
revoke all on active_conversations_summary from anon, authenticated;

-- --- 4. Secrets stored in the database ---------------------------------------
-- channel_sources.webhook_secret / api_token hold plaintext credentials. RLS now
-- blocks anon from reading them, but they remain readable by anyone with the
-- service key or SQL console access. Prefer keeping these in n8n's credential
-- store or environment; treat these columns as a migration convenience, not a
-- vault, and do not put production API tokens here.

-- =============================================================================
-- VERIFY
-- =============================================================================
--
-- Every table below must report rls_enabled = true:
--
--   select tablename, rowsecurity as rls_enabled
--   from pg_tables where schemaname = 'public' order by tablename;
--
-- And this must return ZERO rows (no policy silently re-opens access):
--
--   select schemaname, tablename, policyname, roles
--   from pg_policies where schemaname = 'public';
--
-- Finally, confirm the anon key is now inert. This must return an error or [],
-- never data:
--
--   curl -s "https://YOUR_PROJECT.supabase.co/rest/v1/clients?select=email" \
--     -H "apikey: YOUR_ANON_KEY" -H "Authorization: Bearer YOUR_ANON_KEY"
--
-- =============================================================================
