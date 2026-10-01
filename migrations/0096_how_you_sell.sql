-- 0096 — "How you sell" (HS, the onboarding plan's Stage 3; decisions 29, 41).
--
-- The owner answers plain questions one at a time; every answer writes rows
-- that already exist (the price-first choice, products' minimums, the claim
-- switches, trade terms, hours, closures, forbidden words, and business-level
-- answers in product_knowledge), and only the lines the owner ticked.
--
-- This table holds only where she is: each question's last answer as she typed
-- it (so the confirm page can show its lines, and a question can be changed
-- later from what she said), whether it was answered or skipped, and the
-- answer customers receive word for word that the flow wrote last, so a new
-- one replaces it instead of standing beside it.
--
-- None of it belongs to a customer: a customer's erasure never reaches it, and
-- a workspace's erasure takes it (both tools find a table by its columns). The
-- practice copy does not need it: what the answers wrote is copied already.

create table if not exists selling_answers (
  business_id uuid not null references businesses(id),
  question text not null check (question in (
    'price', 'minimum', 'returns', 'delivery', 'payment', 'certifications', 'hours', 'words',
    'offered', 'area', 'duration', 'next_step')),
  -- draft: typed, its lines not yet saved · answered: lines saved (or nothing
  -- to change) · skipped: she chose not to answer it now.
  state text not null check (state in ('draft', 'answered', 'skipped')),
  answer jsonb check (answer is null or jsonb_typeof(answer) = 'object'),
  -- The business-level answer this flow last wrote for the question.
  told_id uuid references product_knowledge(id),
  updated_at timestamptz not null default now(),
  updated_by text,
  answered_at timestamptz,
  primary key (business_id, question),
  constraint selling_answers_answered check ((state = 'answered') = (answered_at is not null))
);

alter table selling_answers enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'selling_answers' and policyname = 'selling_answers_tenant') then
    create policy selling_answers_tenant on selling_answers for all to nomi_app
      using (business_id = current_business_id()) with check (business_id = current_business_id());
  end if;
end $$;
grant select, insert, update on selling_answers to nomi_app;
revoke delete, truncate on selling_answers from nomi_app;

-- The audit verb: one row per question saved, naming the lines written
-- (0095's list, copied from the live constraint, plus one).
alter table channel_audit drop constraint if exists channel_audit_action_check;
alter table channel_audit add constraint channel_audit_action_check
  check (action in ('connect','reconnect','disconnect','test','rotate_credential',
                    'set_owner_phone','update_profile','activate','deactivate',
                    'blocked_not_allowlisted','allowlist_add','allowlist_archive',
                    'send_refused','activation_refused','product_edited',
                    'price_rules_set','transcript_corrected',
                    'assistant_added','assistant_changed','assistant_archived',
                    'export_data','deletion_requested','deletion_withdrawn',
                    'assistant_stop','assistant_start',
                    'deletion_dismissed',
                    'product_imported','import_confirmed','prices_to_owner_set',
                    'selling_set','how_you_sell_saved'));

insert into _migrations (version, name) values (96, 'how_you_sell')
on conflict (version) do nothing;
