-- ---------------------------------------------------------------------------
-- 0171 — CHART TEMPLATES (Phase 5, A2.3).
--
-- A template is a chart of accounts and a set of journals that a workspace starts its books from: the CGNC for
-- every Moroccan shop (D4 fills it, built from the CGNC's own text and checked against it), others later. This
-- migration is the MECHANISM only; it ships no chart.
--
--   · Templates are shared: every workspace may read them, only a migration writes them.
--   · `apply_chart_template(code)` gives the CALLING workspace (current_business_id()) every account and journal
--     of the template it does not have yet, parents linked by code. It never changes an account or a journal the
--     workspace already has — a code the owner made their own stays theirs — so applying twice adds nothing.
--   · It runs as the caller (security invoker): row security keeps it inside the workspace, and the books' rules
--     (0169) apply to what it writes like to anything else.
-- ---------------------------------------------------------------------------

create table if not exists chart_templates (
  code        text primary key check (code ~ '^[a-z0-9-]{1,40}$'),
  name        text not null check (length(btrim(name)) between 1 and 120),
  country     text check (country is null or country ~ '^[A-Z]{2}$'),
  version     text not null check (length(btrim(version)) between 1 and 40),
  -- The text the template follows, as cited ("Code Général de Normalisation Comptable, …").
  source      text not null check (length(btrim(source)) between 1 and 500),
  created_at  timestamptz not null default now()
);

create table if not exists chart_template_accounts (
  template    text not null references chart_templates(code) on delete cascade,
  code        text not null check (code ~ '^[0-9A-Za-z][0-9A-Za-z.\-]{0,19}$'),
  name        text not null check (length(btrim(name)) between 1 and 200),
  kind        text not null check (kind in ('asset', 'liability', 'equity', 'income', 'expense', 'off_balance')),
  parent_code text,
  primary key (template, code),
  foreign key (template, parent_code) references chart_template_accounts (template, code) on delete cascade
);

create table if not exists chart_template_journals (
  template    text not null references chart_templates(code) on delete cascade,
  code        text not null check (code ~ '^[A-Z0-9]{1,8}$'),
  name        text not null check (length(btrim(name)) between 1 and 120),
  kind        text not null check (kind in ('sales', 'purchases', 'bank', 'cash', 'general', 'closing')),
  primary key (template, code)
);

-- Read by every workspace, written by migrations only. The default privileges (0005) would give the app insert and
-- update: not on these.
grant select on chart_templates, chart_template_accounts, chart_template_journals to nomi_app;
revoke insert, update, delete, truncate on chart_templates, chart_template_accounts, chart_template_journals from nomi_app;

create or replace function apply_chart_template(p_template text)
returns table (accounts_added integer, journals_added integer)
language plpgsql security invoker set search_path = public as $$
declare
  biz uuid := current_business_id();
  a integer;
  j integer;
  added text[];
begin
  if biz is null then
    raise exception 'books: a chart is applied inside a workspace' using errcode = 'NB013';
  end if;
  if not exists (select 1 from chart_templates where code = p_template) then
    raise exception 'books: there is no chart template "%"', p_template using errcode = 'NB013';
  end if;

  with ins as (
    insert into accounts (business_id, code, name, kind)
    select biz, t.code, t.name, t.kind from chart_template_accounts t
     where t.template = p_template
    on conflict (business_id, code) do nothing
    returning code
  ) select coalesce(array_agg(code), '{}') into added from ins;
  a := cardinality(added);

  -- Parents, by code — only for the accounts this call added: an existing account keeps its own place.
  update accounts c set parent_id = p.id
    from chart_template_accounts t
    join accounts p on p.business_id = biz and p.code = t.parent_code
   where c.business_id = biz and c.code = t.code and t.template = p_template
     and t.parent_code is not null and c.code = any(added);

  insert into journals (business_id, code, name, kind)
  select biz, t.code, t.name, t.kind from chart_template_journals t
   where t.template = p_template
  on conflict (business_id, code) do nothing;
  get diagnostics j = row_count;

  return query select a, j;
end $$;
revoke all on function apply_chart_template(text) from public;
grant execute on function apply_chart_template(text) to nomi_app;

insert into _migrations (version, name) values (171, 'chart_templates')
  on conflict (version) do nothing;
