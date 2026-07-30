-- =============================================================================
-- 0018 — Factory Knowledge Foundation (M13)
--
-- Descriptive product/business knowledge the employee answers FROM: specs,
-- materials, production notes, FAQs, buyer-facing answers, usage, restrictions.
--
-- WHAT DOES NOT LIVE HERE: committing claims. Certifications, incoterms,
-- payment terms, guarantees, shipping methods and delivery promises remain in
-- claims_policy (the claims guard's allowlist). The `kind` check below has NO
-- 'certification' value on purpose — teaching a cert writes claims_policy.
--
-- Trigram-only for now (like aliases). A vector column + semantic fusion is a
-- later, additive migration; keyword/label matching carries the FAQ path today.
-- =============================================================================

create table if not exists product_knowledge (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  product_id      uuid references products(id) on delete cascade,   -- null = business-level
  kind            text not null check (kind in
                    ('specification','material','production_note','faq','buyer_answer','usage','restriction')),
  label           text not null,
  content         text not null,
  source_language text not null default 'en',
  -- confidence tier: owner_confirmed > owner_corrected > system_seed
  source          text not null default 'owner_confirmed'
                    check (source in ('owner_confirmed','owner_corrected','system_seed')),
  status          text not null default 'active' check (status in ('active','archived')),
  supersedes_id   uuid references product_knowledge(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_pk_lookup on product_knowledge (business_id, product_id, status);
create index if not exists idx_pk_trgm_label   on product_knowledge using gin (lower(label)   gin_trgm_ops);
create index if not exists idx_pk_trgm_content on product_knowledge using gin (lower(content) gin_trgm_ops);

alter table product_knowledge enable row level security;
drop policy if exists tenant_isolation_app on product_knowledge;
create policy tenant_isolation_app on product_knowledge
  for all to yiwuflow_app
  using      (business_id = current_business_id())
  with check (business_id = current_business_id());
-- select/insert/update only — corrections ARCHIVE, they never delete (the app
-- role has no DELETE anywhere; migration 0005's blanket grant covers this table).

-- ---------------------------------------------------------------------------
-- retrieve_knowledge — trigram search, tenant-scoped (SECURITY INVOKER under
-- RLS). Scope: the identified product's rows PLUS business-level (product_id
-- null). Active only. Ranked by relevance, then confidence tier.
-- ---------------------------------------------------------------------------
create or replace function retrieve_knowledge(
  p_business_id uuid,
  p_query       text,
  p_product_id  uuid default null,
  p_k           integer default 6
)
returns table (id uuid, product_id uuid, kind text, label text, content text, source text, relevance real)
language sql stable as $$
  select k.id, k.product_id, k.kind, k.label, k.content, k.source,
         greatest(similarity(lower(k.label), lower(p_query)),
                  similarity(lower(k.content), lower(p_query)))::real as relevance
    from product_knowledge k
   where k.business_id = p_business_id
     and k.status = 'active'
     and (p_product_id is not null and k.product_id = p_product_id or k.product_id is null)
     and greatest(similarity(lower(k.label), lower(p_query)),
                  similarity(lower(k.content), lower(p_query))) > 0.10
   order by relevance desc,
            case k.source when 'owner_confirmed' then 3 when 'owner_corrected' then 2 else 1 end desc,
            k.created_at desc
   limit p_k;
$$;

insert into _migrations (version, name) values (18, 'product_knowledge')
on conflict (version) do nothing;
