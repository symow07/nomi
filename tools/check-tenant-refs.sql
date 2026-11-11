-- Read-only: counts the rows that point at another workspace's row, for each of the four references 0239 guards.
-- Run it on a database BEFORE 0239 (0239 stops, naming the same counts, if any is above zero). Changes nothing.
--
--   psql -X -v ON_ERROR_STOP=1 -f tools/check-tenant-refs.sql      (the connection from the PG* environment)
--
-- Every count should be 0. A count above 0 is a finding to report, never something to fix by hand before 0239.
begin transaction read only;
select 'outbound_messages.conversation_id -> conversations' as reference, count(*) as other_workspace
  from outbound_messages o join conversations c on c.id = o.conversation_id
 where c.business_id <> o.business_id
union all
select 'outbound_messages.quote_id -> quotes', count(*)
  from outbound_messages o join quotes q on q.id = o.quote_id
 where q.business_id <> o.business_id
union all
select 'conversations.client_id -> clients', count(*)
  from conversations c join clients cl on cl.id = c.client_id
 where cl.business_id <> c.business_id
union all
select 'quotes.conversation_id -> conversations', count(*)
  from quotes q join conversations c on c.id = q.conversation_id
 where c.business_id <> q.business_id;
rollback;
