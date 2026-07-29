-- =============================================================================
-- 0016 — Owner locale + alert destination (P3, ADR-0008)
-- The owner's UI language is a per-browser cookie, but a WhatsApp alert can't
-- read a cookie — it needs a persisted preference. owner_phone is where alerts
-- are delivered (notify.team consumer); null = no owner destination configured.
-- =============================================================================

alter table businesses
  add column if not exists owner_locale text not null default 'en'
    check (owner_locale in ('en', 'zh', 'ar')),
  add column if not exists owner_phone text;

comment on column businesses.owner_locale is
  'Owner UI + notification language (ADR-0008): en | zh | ar.';
comment on column businesses.owner_phone is
  'Owner WhatsApp number for alerts (notify.team). Null = no owner destination.';

-- The owner-phone settings action audits into channel_audit; allow its verb.
alter table channel_audit drop constraint if exists channel_audit_action_check;
alter table channel_audit add constraint channel_audit_action_check
  check (action in ('connect','reconnect','disconnect','test','rotate_credential','set_owner_phone'));

insert into _migrations (version, name) values (16, 'owner_locale_and_alerts')
on conflict (version) do nothing;
