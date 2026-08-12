-- =============================================================================
-- 0029 — M37.5: the words she may never say.
--
-- claims_policy governs what may be CLAIMED. This governs what may be SAID.
-- Same shape, same default-deny instinct, a different axis.
--
-- NOT the same thing as BANNED_OWNER_TERMS (core/owner/vocabulary.ts), which
-- governs what the PRODUCT shows the OWNER and is one global list in code.
-- These rows are per-tenant, free text, in whatever language the owner types,
-- and they govern what SHE says to a BUYER.
--
-- The FLOOR — never curse, never insult a buyer — lives in code
-- (core/safety/forbiddenWords.ts FORBIDDEN_FLOOR), not here, precisely so no
-- row can remove it. The owner extends the floor; she cannot delete it.
--
-- Additive and forward-only (ADR-0007).
-- =============================================================================

create table if not exists forbidden_terms (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  term         text not null check (length(btrim(term)) > 0),
  -- Why she added it, in her words. Optional, and never shown to a buyer.
  note         text,
  created_at   timestamptz not null default now(),
  -- Archive, never erase: removing a term is an UPDATE, so the record of what
  -- was once forbidden survives the owner changing her mind.
  archived_at  timestamptz
);

-- One live row per term per tenant. Re-adding a term she archived revives it
-- rather than creating a duplicate she would have to remove twice.
create unique index if not exists idx_forbidden_terms_live
  on forbidden_terms (business_id, lower(btrim(term))) where archived_at is null;

alter table forbidden_terms enable row level security;
drop policy if exists tenant_isolation_app on forbidden_terms;
create policy tenant_isolation_app on forbidden_terms
  for all to nomi_app
  using (business_id = current_business_id())
  with check (business_id = current_business_id());

insert into _migrations (version, name) values (29, 'forbidden_terms')
on conflict (version) do nothing;
