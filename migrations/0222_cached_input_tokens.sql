-- ---------------------------------------------------------------------------
-- 0222 — WHAT WAS READ FROM THE CACHE, BESIDE THE INPUT (2026-11-04)
--
-- input_tokens read only the provider's `input_tokens`, which leaves out what it read from or wrote to its cache. A
-- provider that caches by itself therefore looked several times cheaper on the ledger and the allowance than it was.
-- From this version on input_tokens is ALL the input, and this column is the part of it read from the cache, so an
-- estimate can price that part at its own rate.
--
-- Rows from before stay as they are: nothing can tell how much they left out. The allowance and the installation's
-- ceiling go on reading input_tokens + output_tokens, so from here on they count what was really sent.
-- ---------------------------------------------------------------------------

alter table usage_ledger add column if not exists cached_input_tokens bigint not null default 0;
alter table turns add column if not exists cached_input_tokens integer;

insert into _migrations (version, name) values (222, 'cached_input_tokens')
  on conflict (version) do nothing;
