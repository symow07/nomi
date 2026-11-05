-- 0224 — Block 1 of the finishing roadmap (2026-11-06): three records the product lacked.
--
-- #5 · THE QUOTE A REPLY CARRIED. The customer panel said "Prices worked out" because a quote row was never linked to
--     the message that carried its figure: the turn records the quote, the reply leaves later (alone, or approved
--     as written days after), and nothing joined the two. `quote_id` now travels with the reply the way `asks`
--     does (0080): on the draft, on the outbound row, and — when the provider accepts the message — onto the
--     `messages` row the 'sent' transition writes. An owner's edit carries none (the figure may have changed).
--     The panel can then say "Told 12.50 on Tue" for a quote that reached the customer, and "worked out" for one
--     that did not. `on delete set null`: an erasure takes the quote and leaves the message's words.
--
-- #6 · A LARGER-ORDER PRICE CAN BE TAKEN OFF. The app role deletes nothing (grants.test.ts), and `price_tiers` has
--     no archive column, so a band the owner typed wrong stayed for good. The one removal is this function, as
--     0122's is for a name customers use: ONE band of ONE product of the business the transaction is for, and
--     never the product's first band — that is its price, and a product with no price cannot be quoted. R3's
--     trigger (0107) unvets the product on the delete, so its next quote waits for the owner, as any price change.
--     The caller writes the removal on the audit trail, so the figure is kept there.
--
-- #11 · PRACTICE HAS A PHOTO AND A VOICE NOTE. The owner uploads one on the Practice page; its bytes are kept here,
--     on the practice copy, and the worker's media port reads them back where a channel's download would be — so
--     the photo goes through the real vision and the voice note through the real transcriber, metered on the
--     workspace like every practice turn. Only a practice copy may hold one (a trigger refuses the rest); Start over
--     and the thirty days erase them with the conversation they were sent in (`practice_erase_conversations`).
-- ---------------------------------------------------------------------------

-- #5 — the quote a reply carried.
alter table drafts add column if not exists quote_id uuid references quotes(id) on delete set null;
comment on column drafts.quote_id is
  'The quote whose figure this draft carries, if any. Carried to the outbound message when the owner sends it unchanged; an edit carries none.';
alter table outbound_messages add column if not exists quote_id uuid references quotes(id) on delete set null;
comment on column outbound_messages.quote_id is
  'The quote whose figure this message carries, if any; copied onto the sent message row when the provider accepts it.';
alter table messages add column if not exists quote_id uuid references quotes(id) on delete set null;
comment on column messages.quote_id is
  'For an outbound message: the quote whose figure reached the customer in it (0224). The customer panel reads "told" from this.';
create index if not exists messages_quote on messages (quote_id) where quote_id is not null;

-- #6 — one larger-order price, taken off.
create or replace function remove_price_tier(p_product_id uuid, p_min_qty integer)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  v_first integer;
  v_n integer;
begin
  select min(pt.min_qty) into v_first
    from price_tiers pt join products p on p.id = pt.product_id
   where pt.product_id = p_product_id and p.business_id = current_business_id();
  -- No such product of this business, or the band asked for is its first: nothing moves.
  if v_first is null or p_min_qty is null or p_min_qty <= v_first then return false; end if;
  delete from price_tiers pt
   using products p
   where pt.product_id = p_product_id
     and p.id = pt.product_id
     and p.business_id = current_business_id()
     and pt.min_qty = p_min_qty;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;
revoke all on function remove_price_tier(uuid, integer) from public;
grant execute on function remove_price_tier(uuid, integer) to nomi_app;

-- #11 — a practice photo or voice note, kept until its conversation goes.
create table if not exists practice_media (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null check (kind in ('image', 'audio')),
  media_type text not null check (length(media_type) between 3 and 80),
  bytes bytea not null check (octet_length(bytes) between 1 and 8388608),
  created_at timestamptz not null default now()
);
create index if not exists practice_media_business on practice_media (business_id, created_at);
alter table practice_media enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'practice_media' and policyname = 'practice_media_tenant') then
    create policy practice_media_tenant on practice_media for all to nomi_app
      using (business_id = current_business_id()) with check (business_id = current_business_id());
  end if;
end $$;
grant select, insert on practice_media to nomi_app;

-- Only a practice copy holds one: nothing a real customer sent is ever kept here.
create or replace function practice_media_only_copy() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from businesses b where b.id = new.business_id and b.practice_of is not null) then
    raise exception 'practice_media: only a practice copy keeps one' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists practice_media_only_copy on practice_media;
create trigger practice_media_only_copy before insert or update on practice_media
  for each row execute function practice_media_only_copy();

-- 0142's erasure, with the media of the erased conversations' messages taken too (a message's external id is the
-- job's message id, `practice:<uuid>`; the media row's id is what that job named as the media).
create or replace function practice_erase_conversations(p_copy uuid, p_ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
begin
  if not exists (select 1 from businesses where id = p_copy and practice_of is not null) then
    raise exception 'practice_erase_conversations: not a practice copy' using errcode = '42501';
  end if;
  v_ids := array(select id from conversations where business_id = p_copy and id = any(coalesce(p_ids, '{}'::uuid[])));
  if cardinality(v_ids) = 0 then return 0; end if;

  -- 0224 — the photos and voice notes sent in these conversations.
  delete from practice_media pm
   where pm.business_id = p_copy
     and exists (select 1 from messages m where m.conversation_id = any(v_ids)
                   and m.provider_media_id = 'practice:' || pm.id::text);

  -- What points at a conversation without going with it, first (0135's order).
  delete from opt_outs o
   where o.business_id = p_copy
     and exists (select 1 from client_channels cc join conversations c on c.client_id = cc.client_id
                  where c.id = any(v_ids) and cc.channel = o.channel and cc.channel_user_id = o.identity);
  delete from promised_dates where conversation_id = any(v_ids);
  delete from deletion_asks where conversation_id = any(v_ids);
  delete from email_confirmations where order_id in (select id from orders where conversation_id = any(v_ids));
  delete from order_proposals where conversation_id = any(v_ids)
     or order_id in (select id from orders where conversation_id = any(v_ids));
  delete from orders where conversation_id = any(v_ids);
  delete from sequence_sends where outbound_id in (select id from outbound_messages where conversation_id = any(v_ids));
  delete from sequence_enrollments where conversation_id = any(v_ids);
  delete from deliveries where conversation_id = any(v_ids);
  delete from spot_checks where conversation_id = any(v_ids);
  delete from repairs where conversation_id = any(v_ids);
  delete from conversation_events where conversation_id = any(v_ids);
  if to_regclass('shadow.turn_decisions') is not null then
    execute 'delete from shadow.turn_decisions where conversation_id = any($1)' using v_ids;
  end if;
  -- The rest goes with the conversation (messages, turns, drafts, quotes, sends, signals, state…).
  delete from conversations where id = any(v_ids);
  return cardinality(v_ids);
end $$;
revoke all on function practice_erase_conversations(uuid, uuid[]) from public;

insert into _migrations (version, name) values (224, 'block1_records')
  on conflict (version) do nothing;
