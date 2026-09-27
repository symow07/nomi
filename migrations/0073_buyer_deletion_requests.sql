-- 0073 — CC-02a: a buyer's deletion request can be made, and its deadline is kept.
--
-- WHAT WAS WRONG. /data-deletion told every buyer that a person at the business
-- removes their records by hand within 30 days and tells them on the same
-- channel. 0064 modelled a buyer's request (scope 'buyer') and nothing ever
-- wrote one: a business could not record it, nothing counted the 30 days, and
-- nobody was told when they ran out. The page now states what happens — the
-- business records the request on the buyer's page, and Nomi's operator
-- carries it out within 30 days of it being recorded — and this migration
-- holds the two things the code needs for that sentence to be true.
--
--   deletion_requests_one_open_buyer
--     ONE OPEN REQUEST PER BUYER. Pressing it twice is one request, and the
--     operator never has to reconcile duplicates — the rule 0064 gave the
--     workspace request, for the same reason. A withdrawn, refused or done
--     request does not count, so a buyer may ask again.
--
--   deletion_requests_due()
--     WHICH REQUESTS ARE NEARLY LATE, across every business. The deadline is
--     the operator's to keep, not any one business's, and row-level security
--     rightly hides each tenant's requests from every other. So, as
--     `inboxes_to_read` (0063) does for its own question, the daily check asks
--     through a definer function that answers it and nothing more: the
--     business's name, the scope, and when it was asked, for each OPEN request
--     whose 30 days end within the next 7 or have already ended. Never the
--     buyer, never the note, never an id a caller could take anywhere else.
--     The 30 and the 7 are also written in src/core/ops/deletions.ts and in
--     the alert's words; tests/parity/deletion-page.test.ts holds them equal.

create unique index if not exists deletion_requests_one_open_buyer
  on deletion_requests (client_id) where scope = 'buyer' and state = 'open';

create or replace function deletion_requests_due()
returns table (business_name text, scope text, asked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.name, r.scope, r.asked_at
    from deletion_requests r
    join businesses b on b.id = r.business_id
   where r.state = 'open'
     and r.asked_at + interval '30 days' <= now() + interval '7 days'
   order by r.asked_at
   limit 200
$$;
revoke all on function deletion_requests_due() from public;
grant execute on function deletion_requests_due() to nomi_app;

insert into _migrations (version, name) values (73, 'buyer_deletion_requests')
on conflict (version) do nothing;
