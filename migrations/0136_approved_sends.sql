-- 0136 · The reopening template carries only what a person approved (the messaging-policy audit, 2026-10-10).
--
-- After a customer's 24 hours, WhatsApp allows only an approved template. WA-S sends the business's reopening
-- template ("we have a reply for you") for a reply someone approved, and its words wait in the owner's box. The
-- worker could not tell an approved draft from a reply the assistant sent alone — both are origin 'employee' — so
-- an automatic reply that waited past the 24 hours went as the template too, which its own comment said it never
-- would, and with no disclosure (rule 3 cannot ride on a template).
--
-- `approved`: a person decided this row should go — the owner pressing send on a draft, or confirming an order.
-- Written once, when the row is queued (every `kickOutbound` is a person's act); the turn's own sends leave it
-- false. Only such a row, or the owner's own words, may reopen a window.

alter table outbound_messages add column if not exists approved boolean not null default false;

insert into _migrations (version, name) values (136, 'approved_sends')
  on conflict (version) do nothing;
