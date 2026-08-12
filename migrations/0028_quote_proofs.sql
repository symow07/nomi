-- =============================================================================
-- 0028 — M35: the proof link. The first BUYER-facing surface in this product.
--
-- A quote she sends carries a link. The buyer opens it with no login and sees
-- the price, the tier it came from, the MOQ, the lead time, and where each fact
-- came from — the owner's catalogue, her taught knowledge, a certification the
-- owner explicitly authorised.
--
-- WHY A TABLE AND NOT A COLUMN ON quotes. Revocation and issuance are their own
-- events with their own timestamps, and a revoked link must stay revoked rather
-- than being overwritten by re-issuing. Keeping them here also means the public
-- lookup touches one small table instead of the row that holds `inputs` — which
-- contains the pricing policy, i.e. the floor price. Nothing about the public
-- path should have that jsonb within easy reach.
--
-- Additive and forward-only (ADR-0007).
-- =============================================================================

create table if not exists quote_proofs (
  -- The token IS the primary key: an unguessable 32-byte value, base64url.
  -- Anything shorter invites enumeration, and this page has no second factor.
  token         text primary key check (length(token) >= 32),
  business_id   uuid not null references businesses(id) on delete cascade,
  quote_id      uuid not null references quotes(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  created_at    timestamptz not null default now(),
  -- Revoked, never deleted: archive-never-erase, and the owner may need to see
  -- that a link existed and was withdrawn.
  revoked_at    timestamptz
);

-- One live link per quote. Re-issuing returns the existing token rather than
-- minting a second one the owner cannot see or revoke.
create unique index if not exists idx_quote_proofs_live
  on quote_proofs (quote_id) where revoked_at is null;
create index if not exists idx_quote_proofs_biz on quote_proofs (business_id);

alter table quote_proofs enable row level security;
drop policy if exists tenant_isolation_app on quote_proofs;
create policy tenant_isolation_app on quote_proofs
  for all to nomi_app
  using (business_id = current_business_id())
  with check (business_id = current_business_id());

-- ---------------------------------------------------------------------------
-- The public lookup.
--
-- The page has no session and therefore no tenant context, so RLS would refuse
-- the read that WOULD establish it — the same bootstrap problem inbound
-- webhooks have, solved the same way: one SECURITY DEFINER function that
-- resolves a token to its tenant and nothing else. It returns no quote data.
-- Everything after this runs inside a normal tenant transaction under RLS.
--
-- A revoked link resolves to zero rows, exactly like a token that never
-- existed. The caller cannot tell the difference, which is the point: a
-- distinguishable revoked link is an oracle confirming the quote is real.
-- ---------------------------------------------------------------------------
create or replace function resolve_quote_proof(p_token text)
returns table (business_id uuid, quote_id uuid, conversation_id uuid)
language sql stable security definer set search_path = public as $$
  select business_id, quote_id, conversation_id
    from quote_proofs
   where token = p_token and revoked_at is null
   limit 1
$$;
revoke all on function resolve_quote_proof(text) from public;
grant execute on function resolve_quote_proof(text) to nomi_app;

insert into _migrations (version, name) values (28, 'quote_proofs')
on conflict (version) do nothing;
