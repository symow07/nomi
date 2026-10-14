-- ---------------------------------------------------------------------------
-- 0156 — A CHINESE PRODUCT NAME IS FOUND FROM THE PART OF IT A BUYER SAYS
-- (the owner, 2026-10-14, the language sweep's finding 2).
--
-- A product is a candidate only when the buyer's words are close to one of its
-- names (0007, `retrieve_products`: trigram similarity above 0.15). Trigrams
-- are cut at word boundaries, and Chinese has no spaces: a whole sentence is
-- one "word", so «购物袋多少钱？» against the name «无纺布购物袋» scored 0.077 —
-- a literal substring of the name, read as unrelated. «无纺布袋» scored 0.038.
-- Arabic and English were unaffected; Chinese buyers were asked what they
-- wanted instead of being answered about the product they named.
--
-- The tokenizer is what was wrong, so that is what changes — NOT the 0.15:
-- lowering it would buy this query and sell a false match on every other.
-- `alias_match` reads a name's Chinese stretches as overlapping character
-- pairs and scores the share of them the buyer's words contain («购物袋» is 2
-- of «无纺布购物袋»'s 5: 0.40). One pair counts only when it is the name's
-- LAST — in Chinese the thing itself comes last («纸袋» for «牛皮纸袋», «布袋»
-- for «帆布袋») — or when the name has no other; otherwise two must be there.
-- So one common pair from the middle of a name — «购物», "shopping" — never
-- offers a product by itself, and a match that rests on one pair counts half:
-- «无纺布袋» finds «无纺布购物袋» (two pairs) before «帆布袋» (one). Every other name is scored exactly as before,
-- and a name is matched by whichever reading is higher.
-- ---------------------------------------------------------------------------

create or replace function alias_match(p_alias text, p_query text)
returns real
language plpgsql immutable parallel safe set search_path = public as $$
declare
  a text := lower(coalesce(p_alias, ''));
  q text := lower(coalesce(p_query, ''));
  trigram real := similarity(a, q);
  run text;
  grams text[] := '{}';
  last_gram text;
  i int;
  hits int;
begin
  -- The name's Chinese stretches, each as its overlapping character pairs (a lone character as itself).
  for run in select m[1] from regexp_matches(a, '([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+)', 'g') as m loop
    if char_length(run) = 1 then
      grams := grams || run;
      last_gram := run;
    else
      for i in 1 .. char_length(run) - 1 loop
        grams := grams || substr(run, i, 2);
      end loop;
      last_gram := substr(run, char_length(run) - 1, 2);
    end if;
  end loop;
  if cardinality(grams) = 0 then
    return trigram;
  end if;
  grams := array(select distinct g from unnest(grams) g);
  select count(*) into hits from unnest(grams) g where strpos(q, g) > 0;
  -- Two pairs, or the name's last pair (the thing itself), or a name of one pair.
  if hits < least(2, cardinality(grams)) and strpos(q, last_gram) = 0 then
    return trigram;
  end if;
  -- The share of the name said — halved when it rests on one pair, so two pairs of evidence outrank one
  -- («无纺布袋» is «无纺布购物袋» at 0.40, not «帆布袋» at 0.25). A two-character name said whole is 1.
  return greatest(trigram, (hits::real / cardinality(grams)) * least(1.0, hits::real / least(2, cardinality(grams))));
end $$;

-- retrieve_products, as 0007 wrote it, with alias_match where similarity was.
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
    -- Names only: the best name per product.
    return query
    select p.id, p.sku, p.name, p.category, p.moq,
           max(alias_match(pa.alias, p_query))::real as relevance,
           'trigram'::text
      from product_aliases pa
      join products p on p.id = pa.product_id
     where p.business_id = p_business_id
       and p.is_active
       and alias_match(pa.alias, p_query) > 0.15
     group by p.id, p.sku, p.name, p.category, p.moq
     order by relevance desc
     limit p_k;
    return;
  end if;

  -- Hybrid: Reciprocal Rank Fusion (k=60) over the name rank and cosine rank.
  return query
  execute format($q$
    with trigram as (
      select p.id, row_number() over (
               order by max(alias_match(pa.alias, %L)) desc) as r
        from product_aliases pa
        join products p on p.id = pa.product_id
       where p.business_id = %L and p.is_active
         and alias_match(pa.alias, %L) > 0.15
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

insert into _migrations (version, name) values (156, 'cjk_name_match')
  on conflict (version) do nothing;
