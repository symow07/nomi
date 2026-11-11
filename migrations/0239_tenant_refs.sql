-- 0239 — A row may point only at its own workspace's rows.
--
-- Four references were single-column foreign keys, and a foreign key's check runs past row security: the database
-- accepted, from the app role scoped to workspace A and from the admin role alike, a row of A pointing at B's row.
--
--   · outbound_messages.conversation_id → conversations   (0010, on delete cascade)
--   · outbound_messages.quote_id        → quotes          (0224, on delete set null)
--   · conversations.client_id           → clients         (on delete cascade; on update too)
--   · quotes.conversation_id            → conversations   (0006, on delete cascade)
--
-- WHY A TRIGGER AND NOT A COMPOSITE KEY. `(business_id, x_id) → target (business_id, id)` would be the textbook form,
-- but both erasure walks follow single-column keys only: `customer_erasure_problems()` (0126/0144) and
-- tools/erase-buyer.mjs `coverage()` name "a key over 2 columns" as a problem, and every one of these four tables is
-- in a customer's reach, so every erasure would stop. Instead the foreign keys stay exactly as they are (so every
-- delete behaviour — cascade, set null — is untouched, and the erasure sees the same edges), and the database refuses
-- the cross-workspace reference itself, on insert and on any update of either column:
--
--   · `tenant_ref_check()` — an AFTER row trigger on each referencing column. AFTER, and named in lower case, so it
--     fires after the foreign key's own check (`RI_ConstraintTrigger_…` sorts first): the target is known to exist and
--     is already held FOR KEY SHARE by that check. It reads the target's workspace FOR KEY SHARE again (no new wait:
--     the lock is the one the foreign key took) and refuses a different one with SQLSTATE 23503 and a constraint name
--     of its own. A null reference (`quote_id`, and `on delete set null` writing one) passes; an UPDATE that changes
--     neither the column nor `business_id` is skipped, as the key's own check skips it.
--   · `workspace_fixed()` — the three targets' `business_id` never changes (nothing in the product changes it), so
--     a row checked once cannot be moved under its references afterwards.
--
-- EXISTING ROWS. A trigger checks new writes only, so this migration first counts the rows that already break any of
-- the four and stops, naming the counts, if there is one: a violation is reported, never kept quietly or fixed here.
-- tools/check-tenant-refs.sql is the same count, read-only, for running on a database before this migration.

do $$
declare
  v_out_conv  bigint;
  v_out_quote bigint;
  v_conv_cli  bigint;
  v_quote_cnv bigint;
begin
  select count(*) into v_out_conv from outbound_messages o join conversations c on c.id = o.conversation_id
   where c.business_id <> o.business_id;
  select count(*) into v_out_quote from outbound_messages o join quotes q on q.id = o.quote_id
   where q.business_id <> o.business_id;
  select count(*) into v_conv_cli from conversations c join clients cl on cl.id = c.client_id
   where cl.business_id <> c.business_id;
  select count(*) into v_quote_cnv from quotes q join conversations c on c.id = q.conversation_id
   where c.business_id <> q.business_id;
  if v_out_conv + v_out_quote + v_conv_cli + v_quote_cnv > 0 then
    raise exception 'rows already point at another workspace: outbound_messages.conversation_id %, outbound_messages.quote_id %, conversations.client_id %, quotes.conversation_id % (run tools/check-tenant-refs.sql; nothing was changed)',
      v_out_conv, v_out_quote, v_conv_cli, v_quote_cnv using errcode = '23503';
  end if;
end $$;

-- TG_ARGV[0] = the referencing column, TG_ARGV[1] = the target table (its key is `id`), TG_ARGV[2] = the name the
-- refusal carries as its constraint.
create or replace function tenant_ref_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp set row_security = off as $$
declare
  v_ref    uuid := (to_jsonb(new) ->> tg_argv[0])::uuid;
  v_owner  uuid;
begin
  if v_ref is null then
    return null;
  end if;
  -- An UPDATE that names the column without changing it (nor the workspace) is no new reference: the key's own check
  -- skips it too, and taking a lock here would add a wait the database never had.
  if tg_op = 'UPDATE' and (to_jsonb(old) ->> tg_argv[0]) is not distinct from (to_jsonb(new) ->> tg_argv[0])
     and old.business_id is not distinct from new.business_id then
    return null;
  end if;
  execute format('select business_id from %I where id = $1 for key share', tg_argv[1]) into v_owner using v_ref;
  -- The foreign key's check has already passed (it fires first), so a missing target here can only mean something
  -- unforeseen: refuse rather than accept.
  if v_owner is distinct from new.business_id then
    raise exception '%.% names a % row of another workspace', tg_table_name, tg_argv[0], tg_argv[1]
      using errcode = '23503', constraint = tg_argv[2], table = tg_table_name, column = tg_argv[0];
  end if;
  return null;
end $$;
revoke all on function tenant_ref_check() from public;

create or replace function workspace_fixed() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a %''s workspace never changes', tg_table_name
    using errcode = '23514', constraint = tg_table_name || '_workspace_fixed', table = tg_table_name, column = 'business_id';
end $$;
revoke all on function workspace_fixed() from public;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('outbound_messages', 'conversation_id', 'conversations', 'outbound_messages_conversation_same_workspace'),
    ('outbound_messages', 'quote_id',        'quotes',        'outbound_messages_quote_same_workspace'),
    ('conversations',     'client_id',       'clients',       'conversations_client_same_workspace'),
    ('quotes',            'conversation_id', 'conversations', 'quotes_conversation_same_workspace')
  ) v(child, col, parent, name)
  loop
    if not exists (select 1 from pg_trigger where tgname = r.name and tgrelid = r.child::regclass) then
      execute format('create trigger %I after insert or update of business_id, %I on %I for each row '
                     'execute function tenant_ref_check(%L, %L, %L)', r.name, r.col, r.child, r.col, r.parent, r.name);
    end if;
  end loop;

  for r in select * from (values ('conversations'), ('quotes'), ('clients')) v(t)
  loop
    if not exists (select 1 from pg_trigger where tgname = r.t || '_workspace_fixed' and tgrelid = r.t::regclass) then
      execute format('create trigger %I before update of business_id on %I for each row '
                     'when (old.business_id is distinct from new.business_id) execute function workspace_fixed()',
                     r.t || '_workspace_fixed', r.t);
    end if;
  end loop;
end $$;

insert into _migrations (version, name) values (239, 'tenant_refs')
  on conflict (version) do nothing;
