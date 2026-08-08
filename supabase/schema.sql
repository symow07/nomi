-- =============================================================================
-- Nomi MVP — Supabase Schema
-- Version: 1.0
-- Run this in Supabase SQL editor or via psql
-- =============================================================================

-- Enable required extensions
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm"; -- fuzzy text search on aliases

-- =============================================================================
-- BUSINESSES
-- One record per Yiwu business using the platform
-- =============================================================================
create table if not exists businesses (
  id                              uuid primary key default gen_random_uuid(),
  name                            text not null,
  contact_email                   text,
  escalation_email                text,
  escalation_telegram_chat_id     text,
  timezone                        text not null default 'Asia/Shanghai',
  default_language                text not null default 'en',
  google_sheet_id                 text,
  created_at                      timestamptz not null default now(),
  is_active                       boolean not null default true
);

-- =============================================================================
-- CHANNEL SOURCES
-- Tracks which channels are configured per business
-- =============================================================================
create table if not exists channel_sources (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references businesses(id) on delete cascade,
  channel             text not null check (channel in ('whatsapp','wechat','instagram','rednote','webhook_test')),
  channel_account_id  text not null,
  webhook_secret      text,
  api_token           text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (business_id, channel)
);

create index idx_channel_sources_business on channel_sources(business_id);

-- =============================================================================
-- PRODUCTS
-- Product catalog per business
-- =============================================================================
create table if not exists products (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references businesses(id) on delete cascade,
  sku                   text not null,
  name                  text not null,
  name_zh               text,
  description           text,
  category              text,
  unit                  text not null default 'pcs',
  moq                   integer not null default 100,
  price_usd_per_unit    numeric(10,4),
  price_rmb_per_unit    numeric(10,2),
  lead_time_days        integer,
  customizable          boolean not null default false,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (business_id, sku)
);

create index idx_products_business_active on products(business_id, is_active);
create index idx_products_category on products(business_id, category);

-- =============================================================================
-- PRODUCT ALIASES
-- All text variants that map to a product (multilingual, typos, abbreviations)
-- =============================================================================
create table if not exists product_aliases (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  alias       text not null,
  language    text not null default 'en',
  alias_type  text not null default 'common' check (alias_type in ('common','typo','abbreviation','brand','zh','ar','es','fr','ru','tr'))
);

create index idx_aliases_product on product_aliases(product_id);
create index idx_aliases_alias_trgm on product_aliases using gin(alias gin_trgm_ops);
create index idx_aliases_alias_exact on product_aliases(lower(alias));

-- =============================================================================
-- PRODUCT IMAGES
-- One or more images per product; is_primary = true is used for confirmation
-- =============================================================================
create table if not exists product_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  url         text not null,
  is_primary  boolean not null default false,
  label       text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index idx_product_images_product on product_images(product_id);
create index idx_product_images_primary on product_images(product_id, is_primary);
create unique index idx_product_images_one_primary on product_images(product_id) where is_primary = true;

-- =============================================================================
-- CLIENTS
-- One record per unique buyer identity
-- =============================================================================
create table if not exists clients (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references businesses(id) on delete cascade,
  display_name        text,
  email               text,
  phone               text,
  country             text,
  preferred_language  text,
  total_orders        integer not null default 0,
  is_vip              boolean not null default false,
  notes               text,
  created_at          timestamptz not null default now(),
  last_seen_at        timestamptz not null default now()
);

create index idx_clients_business on clients(business_id);
create index idx_clients_email on clients(business_id, email);

-- =============================================================================
-- CLIENT CHANNELS
-- Maps a client to their identity on each platform
-- Critical: (channel, channel_user_id) must be globally unique for dedup
-- =============================================================================
create table if not exists client_channels (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references clients(id) on delete cascade,
  channel          text not null check (channel in ('whatsapp','wechat','instagram','rednote','webhook_test')),
  channel_user_id  text not null,
  created_at       timestamptz not null default now(),
  unique (channel, channel_user_id)
);

create index idx_client_channels_client on client_channels(client_id);
create index idx_client_channels_lookup on client_channels(channel, channel_user_id);

-- =============================================================================
-- CONVERSATIONS
-- One active conversation per client at a time
-- =============================================================================
create table if not exists conversations (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  client_id    uuid not null references clients(id) on delete cascade,
  channel      text not null check (channel in ('whatsapp','wechat','instagram','rednote','webhook_test')),
  phase        text not null default 'warm_intake'
    check (phase in ('warm_intake','clarification','qualification','commercial_discussion','confirmation','escalated','closed')),
  is_active    boolean not null default true,
  assigned_to  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  closed_at    timestamptz
);

create index idx_conversations_client_active on conversations(client_id) where is_active = true;
create index idx_conversations_business_phase on conversations(business_id, phase);

-- =============================================================================
-- MESSAGES
-- Full log of all inbound and outbound messages
-- message_id is the external channel ID — used for deduplication
-- =============================================================================
create table if not exists messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references conversations(id) on delete cascade,
  external_id       text,
  direction         text not null check (direction in ('inbound','outbound')),
  input_type        text not null default 'text'
    check (input_type in ('text','voice','image','image_text','voice_transcribed','unknown')),
  text_content      text,
  audio_url         text,
  image_url         text,
  transcription     text,
  detected_language text,
  ai_analysis       jsonb,
  sent_at           timestamptz not null default now(),
  processed_at      timestamptz,
  is_duplicate      boolean not null default false
);

create index idx_messages_conversation_time on messages(conversation_id, sent_at);
create unique index idx_messages_dedup on messages(external_id, conversation_id) where external_id is not null;

-- =============================================================================
-- CONVERSATION STATE
-- Current working state for ongoing conversation — one row per conversation
-- Updated on every turn
-- =============================================================================
create table if not exists conversation_state (
  id                          uuid primary key default gen_random_uuid(),
  conversation_id             uuid not null references conversations(id) on delete cascade,
  phase                       text not null default 'warm_intake',
  identified_product_id       uuid references products(id),
  product_confidence          numeric(3,2) not null default 0.00,
  product_confirmed_by_client boolean not null default false,
  inquiry_quantity            integer,
  inquiry_unit                text,
  client_email_collected      boolean not null default false,
  escalation_score            integer not null default 0,
  pending_question            text,
  last_message_at             timestamptz not null default now(),
  turn_count                  integer not null default 0,
  context_summary             text,
  updated_at                  timestamptz not null default now(),
  unique (conversation_id)
);

create index idx_conv_state_conversation on conversation_state(conversation_id);
create index idx_conv_state_product on conversation_state(identified_product_id) where identified_product_id is not null;

-- =============================================================================
-- ORDERS
-- Confirmed orders only. Created only when validation passes.
-- =============================================================================
create table if not exists orders (
  id                        uuid primary key default gen_random_uuid(),
  order_reference           text unique not null,
  business_id               uuid not null references businesses(id),
  client_id                 uuid not null references clients(id),
  conversation_id           uuid not null references conversations(id),
  product_id                uuid not null references products(id),
  quantity                  integer not null,
  unit                      text not null,
  agreed_unit_price_usd     numeric(10,4),
  total_value_usd           numeric(12,2),
  client_email              text,
  payment_terms             text,
  shipping_address          text,
  notes                     text,
  status                    text not null default 'confirmed'
    check (status in ('pending_confirmation','confirmed','in_production','shipped','cancelled')),
  google_sheet_logged       boolean not null default false,
  confirmation_email_sent   boolean not null default false,
  created_at                timestamptz not null default now(),
  confirmed_at              timestamptz
);

create index idx_orders_business on orders(business_id);
create index idx_orders_client on orders(client_id);
create index idx_orders_status on orders(business_id, status);
create index idx_orders_conversation on orders(conversation_id);

-- =============================================================================
-- ORDER REFERENCE SEQUENCE
-- Generates YW-YYYY-MM-NNNN style references
-- =============================================================================
create sequence if not exists order_seq start 1;

create or replace function generate_order_reference()
returns text language plpgsql as $$
declare
  ref text;
begin
  ref := 'YW-' || to_char(now(), 'YYYY-MM') || '-' || lpad(nextval('order_seq')::text, 4, '0');
  return ref;
end;
$$;

-- =============================================================================
-- ESCALATION EVENTS
-- One record per escalation trigger
-- =============================================================================
create table if not exists escalation_events (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  business_id      uuid not null references businesses(id),
  trigger_reason   text not null
    check (trigger_reason in (
      'high_value','unclear_product','customization','complex_negotiation',
      'repeated_ambiguity','client_request','logistics_payment','manual','low_confidence_image'
    )),
  trigger_details  text,
  escalation_score integer,
  notified_via     text check (notified_via in ('email','telegram','both')),
  notified_at      timestamptz,
  resolved_at      timestamptz,
  resolved_by      text,
  resolution_notes text,
  created_at       timestamptz not null default now()
);

create index idx_escalation_conversation on escalation_events(conversation_id);
create index idx_escalation_business on escalation_events(business_id, created_at);

-- =============================================================================
-- EMAIL CONFIRMATIONS
-- Track sent confirmation emails and their delivery status
-- =============================================================================
create table if not exists email_confirmations (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references orders(id),
  to_email              text not null,
  subject               text,
  body_html             text,
  sent_at               timestamptz,
  sendgrid_message_id   text,
  status                text not null default 'pending'
    check (status in ('pending','sent','failed','bounced','blocked'))
);

create index idx_email_conf_order on email_confirmations(order_id);

-- =============================================================================
-- UPDATED_AT TRIGGER FUNCTION
-- Keeps updated_at current on key tables
-- =============================================================================
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_products_updated_at
  before update on products
  for each row execute function set_updated_at();

create trigger trg_conversations_updated_at
  before update on conversations
  for each row execute function set_updated_at();

create trigger trg_conv_state_updated_at
  before update on conversation_state
  for each row execute function set_updated_at();

-- =============================================================================
-- HELPER VIEW: active_conversations_summary
-- Used by n8n to load full context in one query
-- =============================================================================
create or replace view active_conversations_summary as
select
  c.id                                as conversation_id,
  c.business_id,
  c.client_id,
  c.channel,
  c.phase,
  c.is_active,
  c.assigned_to,
  cl.display_name                     as client_name,
  cl.email                            as client_email,
  cl.preferred_language,
  cl.is_vip,
  cs.identified_product_id,
  cs.product_confidence,
  cs.product_confirmed_by_client,
  cs.inquiry_quantity,
  cs.inquiry_unit,
  cs.client_email_collected,
  cs.escalation_score,
  cs.pending_question,
  cs.turn_count,
  cs.context_summary,
  cs.last_message_at,
  p.name                              as product_name,
  p.sku                               as product_sku,
  p.moq                               as product_moq,
  p.price_usd_per_unit                as product_price_usd,
  p.lead_time_days,
  p.customizable                      as product_customizable,
  pi.url                              as product_primary_image_url
from conversations c
join clients cl on cl.id = c.client_id
left join conversation_state cs on cs.conversation_id = c.id
left join products p on p.id = cs.identified_product_id
-- DISTINCT ON prevents fan-out when multiple product images have is_primary = true
left join lateral (
  select url from product_images
  where product_id = p.id and is_primary = true
  limit 1
) pi on true
where c.is_active = true;

-- =============================================================================
-- HELPER FUNCTION: search_product_by_text
-- Used by image pipeline (Node 2.12) for vision-to-catalog matching
-- Requires pg_trgm extension (enabled above)
-- =============================================================================
create or replace function search_product_by_text(p_business_id uuid, p_query text)
returns table(product_id uuid, product_name text, sku text, similarity real)
language sql as $$
  select p.id, p.name, p.sku,
         similarity(lower(pa.alias), lower(p_query)) as sim
  from product_aliases pa
  join products p on p.id = pa.product_id
  where p.business_id = p_business_id
    and p.is_active = true
    and similarity(lower(pa.alias), lower(p_query)) > 0.2
  order by sim desc
  limit 3;
$$;

-- =============================================================================
-- HELPER FUNCTION: find_client_by_channel
-- Used for debugging. n8n uses direct REST queries against client_channels.
-- =============================================================================
create or replace function find_client_by_channel(
  p_channel         text,
  p_channel_user_id text
)
returns table(
  client_id         uuid,
  conversation_id   uuid,
  is_new_client     boolean
) language plpgsql as $$
declare
  v_client_id       uuid;
  v_conversation_id uuid;
  v_is_new          boolean := false;
begin
  select cc.client_id into v_client_id
  from client_channels cc
  where cc.channel = p_channel and cc.channel_user_id = p_channel_user_id;

  if v_client_id is null then
    v_is_new := true;
  end if;

  -- Only query conversations if client exists; avoids NULL = NULL comparison
  if v_client_id is not null then
    select c.id into v_conversation_id
    from conversations c
    where c.client_id = v_client_id and c.is_active = true
    limit 1;
  end if;

  return query select v_client_id, v_conversation_id, v_is_new;
end;
$$;
