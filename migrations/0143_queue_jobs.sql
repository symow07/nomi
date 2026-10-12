-- ---------------------------------------------------------------------------
-- 0143 — D14 (the data-protection audit, 2026-10-12): A CUSTOMER'S ERASURE
-- REACHES EVERY QUEUED JOB THAT NAMES THEM.
--
-- The work queue (pg-boss) keeps a finished job about a week (its default
-- deletion: seven days after completion) with the job's data. The erasure took
-- every job of the customer's conversations (`data->>'conversationId'`), but
-- one kind names them without a conversation: the job that records an owner's
-- reply sent from the business's own Instagram or Messenger app (CH3,
-- `EchoJob`: the customer's account and the reply's text). It outlived the
-- erasure for a week.
--
-- From here the erasure also deletes, in the same business, every job with no
-- conversation whose `customer` is one of their accounts — refusing, like the
-- rest, while a worker holds one. Counted with the other jobs (`pgboss.job`),
-- as tools/erase-buyer.mjs plans them. The privacy page says how long the
-- queue keeps a copy.
-- ---------------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_proc where proname = 'erase_customer_rows_practice') then
    alter function erase_customer_rows(uuid, uuid, uuid, boolean) rename to erase_customer_rows_practice;
  end if;
end $$;
revoke all on function erase_customer_rows_practice(uuid, uuid, uuid, boolean) from public;

create or replace function erase_customer_rows(p_business uuid, p_client uuid, p_request uuid, p_restored boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = public set row_security = off as $$
declare
  v_vals text[];
  v_jobs uuid[] := '{}';
  v_active bigint := 0;
  v_n bigint;
  v_counts jsonb;
begin
  -- Who they are, before their accounts go: as the erasure reads it, every channel, written and normalised.
  v_vals := array(select distinct x.val from (
      select cc.channel, cc.channel_user_id as identity from client_channels cc
        join clients c on c.id = cc.client_id where cc.client_id = p_client and c.business_id = p_business
      union select 'whatsapp', phone from clients where id = p_client and business_id = p_business and phone is not null
      union select 'email', email from clients where id = p_client and business_id = p_business and email is not null
      union select 'email', client_email from orders where client_id = p_client and business_id = p_business and client_email is not null
      union select v.channel, o.to_wa_id from outbound_messages o join conversations v on v.id = o.conversation_id
             where v.client_id = p_client and v.business_id = p_business and o.to_wa_id is not null
    ) r cross join lateral (values (erasure_identity(r.channel, r.identity)), (erasure_trim(r.identity))) x(val)
    where x.val is not null and x.val <> '');

  v_counts := erase_customer_rows_practice(p_business, p_client, p_request, p_restored);

  if to_regclass('pgboss.job') is not null and cardinality(v_vals) > 0 then
    execute $q$select coalesce(array_agg(id) filter (where $3 or state::text <> 'active'), '{}'),
                      count(*) filter (where state::text = 'active')
                 from pgboss.job
                where data->>'businessId' = $1 and data->>'conversationId' is null and data->>'customer' = any($2)$q$
      into v_jobs, v_active
      using p_business::text, v_vals, p_restored;
    if v_active > 0 and not p_restored then
      raise exception 'erasure: a worker is handling this customer right now (% job(s)); nothing was changed — try again in a minute', v_active
        using errcode = 'NE002';
    end if;
    if cardinality(v_jobs) > 0 then
      execute 'delete from pgboss.job where id = any($1)' using v_jobs;
      get diagnostics v_n = row_count; perform erasure_expect('pgboss.job', v_n, cardinality(v_jobs)::bigint);
      v_counts := jsonb_set(v_counts, '{erased}', erasure_add(coalesce(v_counts->'erased', '{}'::jsonb), 'pgboss.job',
                    coalesce((v_counts->'erased'->>'pgboss.job')::bigint, 0) + v_n));
    end if;
  end if;
  return v_counts;
end $$;
revoke all on function erase_customer_rows(uuid, uuid, uuid, boolean) from public;

insert into _migrations (version, name) values (143, 'queue_jobs')
  on conflict (version) do nothing;
