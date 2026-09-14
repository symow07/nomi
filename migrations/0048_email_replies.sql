-- ---------------------------------------------------------------------------
-- 0048 — C4.c: the reply is the opt-in.
--
-- C4.a sent a first e-mail and C4.b sent the follow-ups. Neither could hear an
-- answer: the adapter refused every inbound payload, on purpose, rather than
-- half-parse a buyer's reply and lose it. This is what an answer needs.
--
--   contact_consent.evidence += 'replied_to_email'
--     HE ANSWERED HER E-MAIL. The strongest evidence e-mail can produce, and
--     the only e-mail evidence this product OBSERVES rather than is told — the
--     sibling of 'inbound_message', which is his WhatsApp message. It is consent
--     for E-MAIL, to that address: M38's rule is that consent belongs to the
--     channel it was given on, and a reply to a mail does not hand anyone his
--     phone number. (The roadmap said it "opens WhatsApp for them later"; it
--     can only do that once he gives her a number, which is his own message.)
--
--   conversation_signals.kind      += 'email_reply'
--   escalation_events.trigger_reason += 'email_reply'
--     A PERSON ANSWERS HIM, not a schedule and not the employee. The reply is
--     recorded and the conversation moves to "needs you" through the existing
--     handoff, the way an unlisted number does (G10c): no model runs on a
--     stranger's first answer to a cold e-mail.
--
--   resolve_email_reply(ids)
--     WHICH OF HER MAILS HE ANSWERED, and so which tenant. The reply names the
--     mail it answers in In-Reply-To / References, which carry the Message-ID
--     the transport returned when it sent (`outbound_messages.provider_message_id`,
--     already unique). RLS rightly hides every tenant's rows from a webhook that
--     has no tenant yet, so the lookup is a SECURITY DEFINER function exactly
--     like `resolve_tenant` (0005): it returns the business, the conversation and
--     the address that mail went to — and nothing else — for the one outbound
--     e-mail row whose id he quoted. The tenant comes from HER record of what she
--     sent, never from anything in the request.
-- ---------------------------------------------------------------------------

alter table contact_consent drop constraint if exists contact_consent_evidence_check;
alter table contact_consent add constraint contact_consent_evidence_check
  check (evidence in ('inbound_message', 'owner_attestation', 'replied_to_email'));

alter table conversation_signals drop constraint if exists conversation_signals_kind_check;
alter table conversation_signals add constraint conversation_signals_kind_check
  check (kind in (
    'human_requested','complaint','repeated_ambiguity',
    'low_confidence_image','high_value','customization_requested',
    'logistics_discussed','moq_accepted','price_acknowledged',
    'audio_unheard','media_unreadable','unlisted_number','email_reply'));

alter table escalation_events drop constraint if exists escalation_events_trigger_reason_check;
alter table escalation_events add constraint escalation_events_trigger_reason_check
  check (trigger_reason in (
    'high_value','unclear_product','customization','complex_negotiation',
    'repeated_ambiguity','client_request','logistics_payment','manual',
    'low_confidence_image','audio_unheard','media_unreadable','unlisted_number','email_reply'));

create or replace function resolve_email_reply(p_ids text[])
returns table (business_id uuid, conversation_id uuid, identity text)
language sql stable security definer set search_path = public as $$
  select o.business_id, o.conversation_id, o.to_wa_id
    from outbound_messages o
   where o.channel = 'email'
     and o.provider_message_id = any(p_ids)
     and o.status in ('sent', 'delivered', 'read')
   order by o.sent_at desc nulls last
   limit 1
$$;
revoke all on function resolve_email_reply(text[]) from public;
grant execute on function resolve_email_reply(text[]) to nomi_app;

insert into _migrations (version, name) values (48, 'email_replies')
on conflict (version) do nothing;
