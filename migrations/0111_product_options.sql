-- 0111 — a product's options (VAR, the onboarding plan's phase 7a; decision 31).
--
-- "Do you have it in M, in black?" could not be answered from the catalogue:
-- products had no options, and the store import kept them as a line of
-- knowledge text the reply might or might not retrieve. Now each product holds
-- its options — a name and its values ("Size": S, M, L) — with no price and no
-- stock of their own: a variant with its own price is its own product (the
-- store import splits those), and a stock question goes to the owner.
--
--   · products.options — a JSON array of {name, values[]}, empty by default.
--   · product_options(product) — for the CURRENT business: the product's
--     options, or for a practice copy its live product's, as quote_vetted()
--     reads a copy's source (the copy's refresh is left as 0095 wrote it).
--   · 'stock_asked' — a question about stock goes to the owner (decision 31):
--     a signal and a hand-off reason, in 0101's lists.

alter table products add column if not exists options jsonb not null default '[]'::jsonb;
alter table products drop constraint if exists products_options_array;
alter table products add constraint products_options_array check (jsonb_typeof(options) = 'array');

create or replace function product_options(p_product uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select coalesce(src.options, p.options)
      from products p
      join businesses me on me.id = current_business_id()
      left join products src on src.id = p.source_id and src.business_id = me.practice_of
     where p.id = p_product and p.business_id = me.id), '[]'::jsonb);
$$;
revoke all on function product_options(uuid) from public;
grant execute on function product_options(uuid) to nomi_app;

alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply',
    'assistant_stopped','ops_silenced','deletion_requested','not_answered','price_to_owner',
    'allowance_used','stock_asked'));

insert into _migrations (version, name) values (111, 'product_options')
on conflict (version) do nothing;
