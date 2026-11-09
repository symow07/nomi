-- 0236 — Comments have their own inbox. They never establish an inbound DM window.
-- Only the owner's explicit action can later reserve the one private reply.

create unique index if not exists meta_accounts_comment_binding on meta_accounts (id, business_id, ig_account_id);
create table ig_comment_settings (
  business_id uuid not null references businesses(id) on delete cascade,
  meta_account_id uuid primary key references meta_accounts(id) on delete cascade,
  account_id text not null,
  enabled boolean not null default false,
  changed_at timestamptz not null default now(), changed_by text not null,
  foreign key (meta_account_id,business_id,account_id) references meta_accounts(id,business_id,ig_account_id) on delete cascade
);
create table ig_comment_login_states (
  business_id uuid not null references businesses(id) on delete cascade,
  nonce_hash text primary key,
  meta_account_id uuid not null references meta_accounts(id) on delete cascade,
  person_id text not null, session_hash text not null,
  expires_at timestamptz not null, consumed_at timestamptz
);
create table ig_comments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  meta_account_id uuid not null,
  account_id text not null, comment_id text not null,
  channel text not null default 'instagram' check (channel='instagram'),
  identity text not null, username text, words text not null, media_id text not null,
  received_at timestamptz not null default clock_timestamp(), notified_at timestamptz,
  created_at timestamptz,
  asking boolean not null default false,
  match_state text not null default 'none' check (match_state in ('none','matched','several')),
  product_id uuid references products(id) on delete set null,
  post_url text,
  enriched_at timestamptz, read_failed boolean not null default false,
  conversation_id uuid references conversations(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  attribution_ambiguous boolean not null default false,
  unique (business_id,account_id,comment_id), unique (id,business_id),
  foreign key (meta_account_id,business_id,account_id) references meta_accounts(id,business_id,ig_account_id) on delete cascade,
  check (length(words)<=4000), check (username is null or length(username)<=100)
);
create index ig_comments_identity on ig_comments (business_id,identity);
create index ig_comments_recent on ig_comments (business_id,received_at desc);
create table ig_comment_replies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  comment_id uuid not null unique,
  outbound_id uuid unique references outbound_messages(id) on delete set null,
  owner_id text not null,
  public_requested boolean not null default false,
  attempted_at timestamptz, accepted_at timestamptz,
  outcome text not null default 'reserved' check (outcome in ('reserved','accepted','uncertain','refused')),
  recipient_id text, provider_message_id text,
  context_used_at timestamptz,
  foreign key (comment_id) references ig_comments(id) on delete cascade
);
create table ig_comment_public_replies (
  business_id uuid not null references businesses(id) on delete cascade,
  comment_id uuid primary key,
  attempted_at timestamptz, finished_at timestamptz,
  outcome text not null default 'waiting' check (outcome in ('waiting','accepted','failed','uncertain')),
  foreign key (comment_id) references ig_comments(id) on delete cascade
);
create table ig_comment_alerts (
  business_id uuid not null references businesses(id) on delete cascade,
  comment_id uuid primary key,
  claimed_at timestamptz, finished_at timestamptz, outcome text,
  foreign key (comment_id) references ig_comments(id) on delete cascade
);
-- Single-column keys keep the installed erasure walker valid. These new links
-- also require an exact tenant match, checked independently of row visibility.
create function ig_comment_links_rules() returns trigger
language plpgsql security definer set search_path=public set row_security=off as $$
declare row_data jsonb:=to_jsonb(new); link record; linked_business uuid;
begin
  for link in select * from (values
    ('ig_comments','product_id','products'),('ig_comments','conversation_id','conversations'),('ig_comments','client_id','clients'),
    ('ig_comment_login_states','meta_account_id','meta_accounts'),
    ('ig_comment_replies','comment_id','ig_comments'),('ig_comment_replies','outbound_id','outbound_messages'),
    ('ig_comment_public_replies','comment_id','ig_comments'),('ig_comment_alerts','comment_id','ig_comments')) x(child,col,parent)
    where child=tg_table_name loop
    if row_data->>link.col is not null then
      execute format('select business_id from %I where id=$1',link.parent) into linked_business using (row_data->>link.col)::uuid;
      if linked_business is distinct from new.business_id then raise exception 'Comment link belongs to another workspace' using errcode='23514'; end if;
    end if;
  end loop;
  return new;
end $$;
revoke all on function ig_comment_links_rules() from public,nomi_app;
do $$ declare t text; begin
  foreach t in array array['ig_comments','ig_comment_login_states','ig_comment_replies','ig_comment_public_replies','ig_comment_alerts'] loop
    execute format('create trigger ig_comment_links_rules before insert or update on %I for each row execute function ig_comment_links_rules()',t);
  end loop;
end $$;

-- Exactly these three fields. No customer/account identifier or text survives here.
create table ig_comment_tombstones (
  digest text primary key check (digest ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('used','erased')),
  expires_at timestamptz not null
);
alter table ig_comment_tombstones enable row level security;
revoke all on ig_comment_tombstones from public, nomi_app;

do $$ declare t text; begin
  foreach t in array array['ig_comment_settings','ig_comment_login_states','ig_comments','ig_comment_replies','ig_comment_public_replies','ig_comment_alerts'] loop
    execute format('alter table %I enable row level security',t);
    execute format('create policy tenant on %I for all to nomi_app using (business_id=current_business_id()) with check (business_id=current_business_id())',t);
    execute format('create policy not_for_accountants on %I as restrictive for all using (not (select viewer_is_accountant())) with check (not (select viewer_is_accountant()))',t);
    execute format('grant select,insert,update on %I to nomi_app',t);
    execute format('revoke delete,truncate on %I from nomi_app',t);
  end loop;
end $$;

-- A tuple encoding, not concatenation: different component boundaries cannot collide.
create function ig_comment_digest(b uuid, a text, c text) returns text
language sql immutable set search_path=public as $$
  select encode(digest(jsonb_build_array(b::text,a,c)::text,'sha256'),'hex')
$$;
revoke all on function ig_comment_digest(uuid,text,text) from public;
create function ig_comment_was_erased(a text,c text) returns boolean
language sql stable security definer set search_path=public set row_security=off as $$
  select exists(select 1 from ig_comment_tombstones where digest=ig_comment_digest(current_business_id(),a,c) and expires_at>now())
$$;
revoke all on function ig_comment_was_erased(text,text) from public;
grant execute on function ig_comment_was_erased(text,text) to nomi_app;

-- Internal row ids survive digest expiry so a restored backup can still be erased.
alter table erasure_ledger add column comment_ids uuid[];
alter table erasure_ledger add constraint erasure_ledger_comments check
  (kind <> 'comment' or (customer_id is null and comment_ids is not null and cardinality(comment_ids)>0));
-- Extend, rather than transcribe, the installed ledger kinds.
alter table erasure_ledger add column comment_digests jsonb not null default '[]'::jsonb check (jsonb_typeof(comment_digests)='array');
do $$ declare old_check text; begin
  select pg_get_expr(conbin,conrelid) into old_check from pg_constraint where conrelid='erasure_ledger'::regclass and conname='erasure_ledger_kind_check';
  alter table erasure_ledger drop constraint erasure_ledger_kind_check;
  execute format('alter table erasure_ledger add constraint erasure_ledger_kind_check check ((%s) or kind=''comment'')',old_check);
end $$;

-- Internal erasure shared by customer deletion, the comment-only door and restore.
create function ig_comment_erase_rows(b uuid, ids uuid[], actor text, via text, keep_ledger boolean default true) returns integer
language plpgsql volatile security definer set search_path=public set row_security=off as $$
declare c record; candidate record; stones jsonb := '[]'; erased_ids uuid[]:='{}'; n integer:=0; d text; until_at timestamptz; state_of text;
begin
  for candidate in select id,account_id,comment_id from ig_comments where business_id=b and id=any(ids) order by id loop
    perform pg_advisory_xact_lock(hashtextextended('ig-comment:'||b::text||':'||candidate.account_id||':'||candidate.comment_id,0));
    select * into c from ig_comments where id=candidate.id and business_id=b for update;
    if not found then continue; end if;
    d:=ig_comment_digest(b,c.account_id,c.comment_id);
    until_at:=c.received_at+interval '8 days';
    state_of:=case when exists(select 1 from ig_comment_replies where comment_id=c.id and attempted_at is not null) then 'used' else 'erased' end;
    insert into ig_comment_tombstones(digest,state,expires_at) values(d,state_of,until_at)
      on conflict(digest) do update set expires_at=least(ig_comment_tombstones.expires_at,excluded.expires_at);
    stones:=stones||jsonb_build_array(jsonb_build_object('digest',d,'state',state_of,'expires_at',to_char(until_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
    -- Jobs carry this internal id only. Active work must re-read before it writes or alerts.
    if to_regclass('pgboss.job') is not null then
      delete from pgboss.job where data->>'businessId'=b::text and data->>'commentId'=c.id::text;
    end if;
    delete from undelivered_alerts where business_id=b and job->>'commentId'=c.id::text;
    erased_ids:=array_append(erased_ids,c.id);
    delete from outbound_messages where id in (select outbound_id from ig_comment_replies where comment_id=c.id);
    delete from ig_comments where id=c.id;
    n:=n+1;
  end loop;
  if keep_ledger and n>0 then
    insert into erasure_ledger(kind,business_id,via,by_who,counts,comment_ids,comment_digests)
      values('comment',b,via,actor,jsonb_build_object('erased',jsonb_build_object('ig_comments',n)),erased_ids,stones);
  end if;
  return n;
end $$;
revoke all on function ig_comment_erase_rows(uuid,uuid[],text,text,boolean) from public,nomi_app;

create function ig_comment_erase(p_id uuid,p_by text) returns integer
language plpgsql volatile security definer set search_path=public set row_security=off as $$
declare b uuid:=current_business_id(); v text:=nullif(current_setting('app.viewer_id',true),'');
begin
  if b is null or not erasure_owner_of(b,p_by) or (v is not null and v<>p_by) or viewer_is_accountant() then
    raise exception 'Only the owner can delete comment data' using errcode='42501';
  end if;
  if not exists(select 1 from ig_comments where id=p_id and business_id=b) then raise exception 'Comment not found' using errcode='P0002'; end if;
  return ig_comment_erase_rows(b,array[p_id],p_by,'owner',true);
end $$;
revoke all on function ig_comment_erase(uuid,text) from public;
grant execute on function ig_comment_erase(uuid,text) to nomi_app;

-- Restore accepts only the approved digest/state/expiry records; it cannot restore words or author identity.
create function ig_comment_replay(b uuid, comment_ids uuid[], stones jsonb) returns integer
language plpgsql volatile security definer set search_path=public set row_security=off as $$
declare s jsonb; n integer:=0; ids uuid[];
begin
  n:=ig_comment_erase_rows(b,coalesce(comment_ids,'{}'::uuid[]),'restore','restore',false);
  if jsonb_typeof(stones)<>'array' then raise exception 'Invalid comment erasure record'; end if;
  for s in select value from jsonb_array_elements(stones) loop
    if jsonb_typeof(s)<>'object' or (select count(*) from jsonb_object_keys(s))<>3 or s->>'digest' is null or s->>'state' is null or s->>'digest' !~ '^[0-9a-f]{64}$' or s->>'state' not in ('used','erased') or s->>'expires_at' is null then raise exception 'Invalid comment erasure record'; end if;
    ids:=array(select id from ig_comments c where c.business_id=b and ig_comment_digest(b,c.account_id,c.comment_id)=s->>'digest');
    n:=n+ig_comment_erase_rows(b,ids,'restore','restore',false);
    if (s->>'expires_at')::timestamptz>now() then
      insert into ig_comment_tombstones(digest,state,expires_at) values(s->>'digest',s->>'state',(s->>'expires_at')::timestamptz)
        on conflict(digest) do update set expires_at=least(ig_comment_tombstones.expires_at,excluded.expires_at);
    end if;
  end loop;
  return n;
end $$;
revoke all on function ig_comment_replay(uuid,uuid[],jsonb) from public,nomi_app;

create function ig_comment_sweep() returns integer
language plpgsql volatile security definer set search_path=public set row_security=off as $$
declare n integer;
begin
  delete from ig_comment_tombstones where expires_at<=now(); get diagnostics n=row_count;
  update erasure_ledger l set comment_digests=coalesce((select jsonb_agg(d) from jsonb_array_elements(l.comment_digests) d where (d->>'expires_at')::timestamptz>now()),'[]'::jsonb)
    where exists(select 1 from jsonb_array_elements(l.comment_digests) d where (d->>'expires_at')::timestamptz<=now());
  delete from ig_comment_login_states where expires_at<=now();
  return n;
end $$;
revoke all on function ig_comment_sweep() from public;
grant execute on function ig_comment_sweep() to nomi_app;

-- Preserve the actual installed contracts, including other branches' additions.
alter function customer_erasure_contract() rename to customer_erasure_contract_before_0236;
-- customer_erasure_contract, re-made from its latest definition (0230) by wrapping the installed function.
create function customer_erasure_contract()
returns table(tbl text,action text,clear text[],blank text[],detach text[],match text)
language sql immutable set search_path=public as $$
  select * from customer_erasure_contract_before_0236()
  union all select * from (values
    ('ig_comment_settings', 'unrelated', null::text[], null::text[], null::text[], null::text),
    ('ig_comment_login_states', 'unrelated', null, null, null, null),
    ('ig_comments', 'erase', null, null, null, 'any-identity'),
    ('ig_comment_replies', 'erase', null, null, null, null),
    ('ig_comment_public_replies', 'erase', null, null, null, null),
    ('ig_comment_alerts', 'erase', null, null, null, null),
    ('ig_comment_tombstones', 'unrelated', null, null, null, null)
  ) x
$$;
revoke all on function customer_erasure_contract() from public;
revoke all on function customer_erasure_contract_before_0236() from public;
alter function customer_erasure_edges() rename to customer_erasure_edges_before_0236;
-- customer_erasure_edges, re-made from its latest definition (0226) by wrapping the installed function.
create function customer_erasure_edges() returns table(child text,col text,parent text,pcol text)
language sql immutable set search_path=public as $$
 select * from customer_erasure_edges_before_0236()
 union all select * from (values
 ('ig_comments','client_id','clients','id'),('ig_comments','conversation_id','conversations','id'),
 ('ig_comment_replies','comment_id','ig_comments','id'),('ig_comment_replies','outbound_id','outbound_messages','id'),
 ('ig_comment_public_replies','comment_id','ig_comments','id'),('ig_comment_alerts','comment_id','ig_comments','id')) x
$$;
revoke all on function customer_erasure_edges() from public;
revoke all on function customer_erasure_edges_before_0236() from public;
alter function erase_customer_rows(uuid,uuid,uuid,boolean) rename to erase_customer_rows_before_0236;
-- erase_customer_rows, re-made from its latest definition (0226) by wrapping the installed function.
create function erase_customer_rows(p_business uuid,p_client uuid,p_request uuid,p_restored boolean default false) returns jsonb
language plpgsql volatile security definer set search_path=public set row_security=off as $$
declare ids uuid[]; n integer; counts jsonb; stones jsonb;
begin
  -- Same order as the existing erasure: conversation advisory locks, then customer row, then comment rows.
  perform pg_advisory_xact_lock(hashtextextended(id::text,0)) from conversations where client_id=p_client and business_id=p_business order by id;
  perform 1 from clients where id=p_client and business_id=p_business for update;
  ids:=array(select c.id from ig_comments c where c.business_id=p_business and
    (c.client_id=p_client or c.conversation_id in(select id from conversations where client_id=p_client and business_id=p_business)
     or c.identity in(select channel_user_id from client_channels where client_id=p_client and channel='instagram')));
  select coalesce(jsonb_agg(jsonb_build_object('digest',ig_comment_digest(c.business_id,c.account_id,c.comment_id),
    'state',case when exists(select 1 from ig_comment_replies r where r.comment_id=c.id and r.attempted_at is not null) then 'used' else 'erased' end,
    'expires_at',to_char((c.received_at+interval '8 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),'[]') into stones from ig_comments c where c.business_id=p_business and c.id=any(ids);
  n:=ig_comment_erase_rows(p_business,ids,'customer-erasure','operator',false);
  counts:=erase_customer_rows_before_0236(p_business,p_client,p_request,p_restored);
  perform set_config('app.erased_comment_ledger',jsonb_build_object('business',p_business,'customer',p_client,'ids',ids,'digests',stones)::text,true);
  return jsonb_set(counts,'{erased}',coalesce(counts->'erased','{}'::jsonb)||jsonb_build_object('ig_comments',n));
end $$;
revoke all on function erase_customer_rows(uuid,uuid,uuid,boolean) from public;
revoke all on function erase_customer_rows_before_0236(uuid,uuid,uuid,boolean) from public;

-- The installed customer-erasure writer retains its kind and all its own checks.
-- Only its immediately preceding erasure can fill these new columns. App roles cannot insert ledger rows.
create function ig_comment_customer_ledger() returns trigger
language plpgsql security definer set search_path=public as $$
declare context jsonb:=nullif(current_setting('app.erased_comment_ledger',true),'')::jsonb;
begin
  if new.kind='customer' and new.comment_ids is null and jsonb_array_length(context->'ids')>0 and context->>'business'=new.business_id::text and context->>'customer'=new.customer_id::text then
    new.comment_ids:=array(select value::uuid from jsonb_array_elements_text(context->'ids'));
    new.comment_digests:=context->'digests';
    perform set_config('app.erased_comment_ledger','',true);
  end if;
  return new;
end $$;
revoke all on function ig_comment_customer_ledger() from public,nomi_app;
create trigger ig_comment_customer_ledger before insert on erasure_ledger for each row execute function ig_comment_customer_ledger();

alter function erasure_ledger_unmailed(integer) rename to erasure_ledger_unmailed_before_0236;
-- erasure_ledger_unmailed, re-made from its latest definition (0141) by wrapping the installed function.
create function erasure_ledger_unmailed(p_limit integer default 200) returns setof jsonb
language sql stable security definer set search_path=public as $$
  select line - 'comment_digests' from erasure_ledger_unmailed_before_0236(p_limit) line
$$;
revoke all on function erasure_ledger_unmailed(integer) from public;
revoke all on function erasure_ledger_unmailed_before_0236(integer) from public,nomi_app;
grant execute on function erasure_ledger_unmailed(integer) to nomi_app;

alter function erasure_ledger_unkept() rename to erasure_ledger_unkept_before_0236;
-- erasure_ledger_unkept, re-made from its latest definition (0172) by wrapping the installed function.
create function erasure_ledger_unkept() returns table(ledger_id uuid,kind text,business_id uuid,customer_id uuid,reason text)
language sql stable security definer set search_path=public set row_security=off as $$
 select * from erasure_ledger_unkept_before_0236()
 union all select l.id,l.kind,l.business_id,l.customer_id,'comment data or an unexpired erasure marker is missing' from erasure_ledger l
 where exists(select 1 from ig_comments c where c.business_id=l.business_id and c.id=any(l.comment_ids))
 or exists(select 1 from jsonb_array_elements(l.comment_digests) d where
   exists(select 1 from ig_comments c where c.business_id=l.business_id and ig_comment_digest(c.business_id,c.account_id,c.comment_id)=d->>'digest')
   or ((d->>'expires_at')::timestamptz>now() and not exists(select 1 from ig_comment_tombstones t where t.digest=d->>'digest')))
$$;
revoke all on function erasure_ledger_unkept() from public;
revoke all on function erasure_ledger_unkept_before_0236() from public;

insert into _migrations (version, name) values (236, '0236_ig_comments') on conflict (version) do nothing;
