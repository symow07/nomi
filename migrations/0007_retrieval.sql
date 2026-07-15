-- =============================================================================
-- 0007 — Hybrid retrieval: trigram now, semantic when an embedding key exists
--
-- The model must never see the whole catalog — only the top ~20 candidates for
-- THIS message (ADR-0001 §5.3). Trigram covers "non woven bag" and typos;
-- embeddings cover "something for a gift shop". Reciprocal Rank Fusion merges.
--
-- pgvector is OPTIONAL in this migration: on instances without the extension
-- (some local dev setups), everything still works trigram-only. Supabase has it.
-- =============================================================================

-- Trigram is already required by the baseline schema (pg_trgm on aliases).

-- pgvector, guarded: absence must not fail the chain.
do $$
begin
  create extension if not exists vector;
  -- voyage-3.5 / voyage-3.5-lite emit 1024 dims; provider is pluggable but the
  -- column is fixed-width, so changing providers with a different width means a
  -- new column + reindex. 1024 is the deliberate default.
  alter table products add column if not exists embedding vector(1024);
  create index if not exists idx_products_embedding
    on products using hnsw (embedding vector_cosine_ops);
exception when others then
  raise notice 'pgvector unavailable (%) — retrieval runs trigram-only', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- retrieve_products — hybrid search with RRF. p_embedding null → trigram-only.
-- SECURITY INVOKER: runs under the caller's RLS, so it is tenant-scoped by
-- construction (yiwuflow_app + app.business_id). The explicit business_id
-- predicate is belt-and-braces, not the isolation mechanism.
-- ---------------------------------------------------------------------------
create or replace function retrieve_products(
  p_business_id uuid,
  p_query       text,
  p_embedding   text default null,   -- vector literal as text; null = trigram only
  p_k           integer default 20
)
returns table (
  product_id  uuid,
  sku         text,
  name        text,
  category    text,
  moq         integer,
  relevance   real,
  matched_via text
)
language plpgsql stable as $$
declare
  has_vector boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_name = 'products' and column_name = 'embedding'
  ) into has_vector;

  if p_embedding is null or not has_vector then
    -- Trigram-only path: best alias similarity per product.
    return query
    select p.id, p.sku, p.name, p.category, p.moq,
           max(similarity(lower(pa.alias), lower(p_query)))::real as relevance,
           'trigram'::text
      from product_aliases pa
      join products p on p.id = pa.product_id
     where p.business_id = p_business_id
       and p.is_active
       and similarity(lower(pa.alias), lower(p_query)) > 0.15
     group by p.id, p.sku, p.name, p.category, p.moq
     order by relevance desc
     limit p_k;
    return;
  end if;

  -- Hybrid: Reciprocal Rank Fusion (k=60) over trigram rank and cosine rank.
  return query
  execute format($q$
    with trigram as (
      select p.id, row_number() over (
               order by max(similarity(lower(pa.alias), lower(%L))) desc) as r
        from product_aliases pa
        join products p on p.id = pa.product_id
       where p.business_id = %L and p.is_active
         and similarity(lower(pa.alias), lower(%L)) > 0.15
       group by p.id
       limit 50
    ),
    semantic as (
      select p.id, row_number() over (
               order by p.embedding <=> %L::vector) as r
        from products p
       where p.business_id = %L and p.is_active and p.embedding is not null
       limit 50
    ),
    fused as (
      select coalesce(t.id, s.id) as id,
             (coalesce(1.0 / (60 + t.r), 0) + coalesce(1.0 / (60 + s.r), 0))::real as score,
             case when t.id is not null and s.id is not null then 'both'
                  when t.id is not null then 'trigram'
                  else 'semantic' end as via
        from trigram t full outer join semantic s using (id)
    )
    select p.id, p.sku, p.name, p.category, p.moq, f.score, f.via
      from fused f join products p on p.id = f.id
     order by f.score desc
     limit %s
  $q$, p_query, p_business_id, p_query, p_embedding, p_business_id, p_k);
end;
$$;

insert into _migrations (version, name) values (7, 'retrieval')
on conflict (version) do nothing;
