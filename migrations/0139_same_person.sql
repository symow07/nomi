-- ---------------------------------------------------------------------------
-- 0139 — D3 (the data-protection audit, 2026-10-12): A CUSTOMER'S ERASURE
-- REACHES THE SAME PERSON ON EVERY CHANNEL.
--
-- The deletion page promises "who you are on every channel", and the owner is
-- told the same. But each channel a person writes on can make its own customer
-- row — a WhatsApp number, an e-mail address, an Instagram account — and the
-- erasure (0126, 0130) took only the row the request named. Another row in the
-- same business with the same phone number or e-mail address stayed, with its
-- conversations; the operator tool only said so.
--
-- From here a buyer request is carried out over THE SAME PERSON: every customer
-- row of the business reached from the requested one through a shared identity
-- — their channel accounts, their phone, their e-mail, an order's e-mail,
-- normalised the erasure's way (`erasure_identity`) — and from those rows
-- onward, until nothing new is reached. Exact matches only, inside one
-- business: the same person in another business is that business's customer.
-- (The erasure also reads the number a reply went to; that is the
-- conversation's own channel account, already here, and scanning every reply
-- the business sent would cost each buyer page that reads this set.)
--
--   · `same_person_clients(business, client)` — the set, the requested row
--     first. One definition, read by the erasure, the owner's page (through
--     `customer_same_person`) and tools/erase-buyer.mjs.
--   · `carry_out_customer_request` erases the requested row first (its counts
--     are what erase-buyer's plan checks), then each other row, each through
--     the same `erase_customer_rows`, each with its own ledger line under the
--     same request — so tools/replay-erasures.mjs carries every one out again
--     after a restore, unchanged. An open request the owner recorded for one
--     of those rows is closed as done by this one.
--   · More than 20 rows refuses, changing nothing: an identity that many
--     customers share is not one person's, and a person looks first.
-- ---------------------------------------------------------------------------

-- Every customer row of the business reached from p_client through a shared,
-- normalised identity; the requested row first, then by id.
create or replace function same_person_clients(p_business uuid, p_client uuid) returns uuid[]
language sql stable security definer set search_path = public set row_security = off as $$
  with recursive ids as (
    select cc.client_id as id, cc.channel as ch, cc.channel_user_id as identity
      from client_channels cc join clients c on c.id = cc.client_id where c.business_id = p_business
    union all select id, 'whatsapp', phone from clients where business_id = p_business and phone is not null
    union all select id, 'email', email from clients where business_id = p_business and email is not null
    union all select client_id, 'email', client_email from orders
               where business_id = p_business and client_id is not null and client_email is not null
  ), norm as materialized (
    select distinct id, ch, erasure_identity(ch, identity) as val from ids
     where erasure_identity(ch, identity) is not null
  ), reach(id) as (
    select c.id from clients c where c.id = p_client and c.business_id = p_business
    union
    select n2.id from reach r join norm n1 on n1.id = r.id join norm n2 on n2.ch = n1.ch and n2.val = n1.val
  )
  select coalesce(array_agg(id order by id <> p_client, id), '{}') from reach
$$;
revoke all on function same_person_clients(uuid, uuid) from public;

-- THE APP'S DOOR: the other rows of the same person, in this transaction's
-- workspace (never an argument) — what the owner's page names before deleting.
create or replace function customer_same_person(p_client uuid) returns setof uuid
language sql stable security definer set search_path = public set row_security = off as $$
  select x from unnest(same_person_clients(current_business_id(), p_client)) x where x <> p_client
$$;
revoke all on function customer_same_person(uuid) from public;
grant execute on function customer_same_person(uuid) to nomi_app;

-- Two erasures' counts, added table by table.
create or replace function erasure_merge(a jsonb, b jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
    select k, sum(v)::bigint as n from (
      select key as k, value::text::bigint as v from jsonb_each(coalesce(a, '{}'::jsonb))
      union all select key, value::text::bigint from jsonb_each(coalesce(b, '{}'::jsonb))
    ) x group by k
  ) y where n > 0
$$;
revoke all on function erasure_merge(jsonb, jsonb) from public;

-- How many rows of one person an erasure takes before a person looks first.
create or replace function same_person_limit() returns integer language sql immutable as $$ select 20 $$;
revoke all on function same_person_limit() from public;

-- An open customer request of this business, carried out over the same person:
-- the erasures, the request closed as done, a ledger line per row, the audit
-- trail. One transaction.
create or replace function carry_out_customer_request(p_business uuid, p_request uuid, p_by text, p_via text)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_req record;
  v_same uuid[];
  v_other uuid;
  v_counts jsonb;
  v_one jsonb;
  v_total jsonb;
  v_more jsonb := '{}'::jsonb;
  v_ledger uuid;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_also text := '';
begin
  if p_via not in ('owner', 'operator') then
    raise exception 'erasure: % is not a way to carry out a request', p_via using errcode = 'NE004';
  end if;
  if length(btrim(coalesce(p_by, ''))) not between 1 and 120 then
    raise exception 'erasure: say who is carrying it out' using errcode = 'NE004';
  end if;
  select * into v_req from deletion_requests where id = p_request for update;
  if not found or v_req.business_id <> p_business then
    raise exception 'erasure: no deletion request % in this workspace', p_request using errcode = 'NE004';
  end if;
  if v_req.scope <> 'buyer' then
    raise exception 'erasure: request % is for a whole workspace, not a customer', p_request using errcode = 'NE004';
  end if;
  if v_req.state <> 'open' then
    raise exception 'erasure: request % is %, not open', p_request, v_req.state using errcode = 'NE004';
  end if;

  v_same := same_person_clients(p_business, v_req.client_id);
  if cardinality(v_same) > same_person_limit() then
    raise exception 'erasure: % customer rows share this customer''s phone numbers or e-mail addresses — more than % is not one person; nothing was changed', cardinality(v_same), same_person_limit()
      using errcode = 'NE011';
  end if;

  -- The requested row first: these counts are the ones erase-buyer planned.
  v_counts := erase_customer_rows(p_business, v_req.client_id, p_request, false);
  v_total := v_counts;
  insert into erasure_ledger as l (kind, business_id, customer_id, request_id, via, by_who, counts)
  values ('customer', p_business, v_req.client_id, p_request, p_via, btrim(p_by), v_counts)
  returning l.id, to_jsonb(l.*) into v_ledger, v_line;
  v_lines := v_lines || jsonb_build_array(v_line);

  -- Then the same person's other rows, each its own erasure and ledger line.
  foreach v_other in array coalesce(v_same[2:], '{}'::uuid[]) loop
    v_one := erase_customer_rows(p_business, v_other, p_request, false);
    v_more := erasure_merge(v_more, v_one->'erased');
    v_total := jsonb_build_object(
      'erased', erasure_merge(v_total->'erased', v_one->'erased'),
      'kept', erasure_merge(v_total->'kept', v_one->'kept'),
      'changed', erasure_merge(v_total->'changed', v_one->'changed'));
    insert into erasure_ledger as l (kind, business_id, customer_id, request_id, via, by_who, counts)
    values ('customer', p_business, v_other, p_request, p_via, btrim(p_by), v_one)
    returning to_jsonb(l.*) into v_line;
    v_lines := v_lines || jsonb_build_array(v_line);
    -- A request the owner recorded for that row is answered by this one.
    update deletion_requests
       set state = 'done', closed_at = now(), closed_by = btrim(p_by),
           closed_note = format('carried out with request %s: the same person', p_request)
     where business_id = p_business and client_id = v_other and scope = 'buyer' and state = 'open';
  end loop;
  -- The note: the requested row's counts, as before, then what the other rows
  -- added to the erased. (Kept rows found by a shared identity — a do-not-contact
  -- entry, say — belong to every row of the person, so their counts are not added.)
  if cardinality(v_same) > 1 then
    v_also := format(' · the same person''s %s other customer record%s too, erased %s: %s', cardinality(v_same) - 1,
                     case when cardinality(v_same) = 2 then '' else 's' end,
                     erasure_total(v_more), coalesce(erasure_list(v_more), 'nothing'));
  end if;

  update deletion_requests
     set state = 'done', closed_at = now(), closed_by = p_by, closed_note = erasure_note(v_counts, p_via) || v_also
   where id = p_request and state = 'open';
  -- The business's own trail says it happened, and which request — never whose.
  insert into channel_audit (business_id, channel_id, action, actor, detail)
  values (p_business, null, 'customer_erased', btrim(p_by),
          jsonb_build_object('request', p_request, 'erasure', v_ledger, 'records', cardinality(v_same)));
  -- The requested row's counts, as before; `same_person` the other rows, in
  -- order; `total` every row's counts added (a kept row found by a shared
  -- identity is counted once per row); `lines` every ledger line written (what
  -- the operator is sent, and what tools/replay-erasures.mjs --ledger reads back).
  return v_counts || jsonb_build_object('ledger', v_ledger, 'request', p_request, 'client', v_req.client_id, 'line', v_lines->0,
    'lines', v_lines, 'same_person', to_jsonb(coalesce(v_same[2:], '{}'::uuid[])), 'total', v_total);
end $$;
revoke all on function carry_out_customer_request(uuid, uuid, text, text) from public;

insert into _migrations (version, name) values (139, 'same_person')
  on conflict (version) do nothing;
