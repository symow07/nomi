-- ---------------------------------------------------------------------------
-- 0220 — A PAGE OF HER SITE, READ AGAIN (2026-10-31; the owner's follow-up to #410's B19).
--
-- Since B19 the same address sent while its reading waits opens that reading, so a site that changed gave back the
-- old one. "Read the page again" makes one new, paid reading, after the owner has seen what it uses of the day's
-- allowance. What happens to the old reading depends on where it stands:
--   · still waiting for her ticks — the new reading REPLACES it (`replaced_by` on the old; it leaves every list);
--   · already approved — its knowledge stays live and untouched; the new reading waits (`reread_of` = the old), and
--     only approving it archives the lines the old one wrote and marks the old replaced.
-- For that, each knowledge line a reading wrote names its reading (`product_knowledge.from_proposal`).
--
-- `reread_started_at` is the claim that keeps two clicks (or two tabs) from paying for two readings: set before the
-- page is fetched, cleared when the reading ends either way; a claim older than five minutes is stale (a fetch is
-- ten seconds, a reading at most two tries of ninety).
--
-- Both references are ON DELETE SET NULL: the erasures delete a workspace's proposals and its knowledge in whatever
-- order they choose, and a line outliving its reading is still her knowledge.
-- ---------------------------------------------------------------------------

alter table knowledge_proposals
  add column if not exists reread_of uuid references knowledge_proposals(id) on delete set null,
  -- Deferred: the old reading is pointed at the new one in the transaction that writes the new one.
  add column if not exists replaced_by uuid references knowledge_proposals(id) on delete set null deferrable initially deferred,
  add column if not exists reread_started_at timestamptz;

alter table product_knowledge
  add column if not exists from_proposal uuid references knowledge_proposals(id) on delete set null;

-- The lines an approved reading wrote were inserted in the transaction that decided it (0118's confirm): their
-- created_at IS the reading's decided_at, to the microsecond. Nothing else writes that combination.
update product_knowledge k
   set from_proposal = p.id
  from knowledge_proposals p
 where k.business_id = p.business_id
   and p.decided_at is not null
   and k.created_at = p.decided_at
   and k.product_id is null and k.kind = 'faq' and k.source = 'owner_confirmed'
   and k.from_proposal is null;

-- At most one reading waits to replace a given reading.
create unique index if not exists knowledge_proposals_one_reread
  on knowledge_proposals (reread_of)
  where reread_of is not null and decided_at is null and replaced_by is null;

insert into _migrations (version, name) values (220, 'page_reread')
  on conflict (version) do nothing;
