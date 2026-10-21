-- ---------------------------------------------------------------------------
-- 0176 — THE BOOKS ARE SWITCHED ON PER WORKSPACE (Phase 5, A6), OFF by default — like the outreach area (0068).
--
-- Off: every /app/books address answers "not found", no page links there, nobody is offered the switch, and an
-- accountant cannot be added. On: the owner switches between the sales side and the books with one login; an
-- accountant has the books alone; staff the sales side alone. No owner switch yet: the operator's tool
-- (tools/books-area.mjs) turns it on, until the books' pages are complete enough to offer it.
-- ---------------------------------------------------------------------------

alter table businesses add column if not exists books_area boolean not null default false;

insert into _migrations (version, name) values (176, 'books_area')
  on conflict (version) do nothing;
