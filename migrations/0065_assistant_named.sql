-- 0065 — the owner names her assistant before a buyer ever meets it.
--
-- WHY THIS IS A GATE AND NOT A DEFAULT. Since C, a business's first assistant
-- is named from its signup locale — 小雅 for a Chinese workspace, Lily
-- otherwise. That was a reasonable default while the name was an owner-facing
-- label. It is not one now: `prompts/response.txt` has the assistant sign off
-- with that name, so it is the name a BUYER reads, and a business should not
-- discover what its customers are being called by reading a transcript.
--
-- So the name becomes a required step in Getting ready, gating activation the
-- same way `secrets_rotated_at` does. The locale default stays — it pre-fills
-- the box, so confirming takes one tap and nobody starts from a blank field.
--
-- THE NAME ITSELF IS NOT STORED HERE. It lives in `assistants`, which is the
-- one source for it since A5 and which the team page already edits. This
-- column records only that a person looked at it and said yes — the same
-- distinction the other four attestations make: the fact lives elsewhere, the
-- confirmation lives here.
--
-- `onboarding_state.employee_name` is left alone. It predates A5, nothing
-- reads it for a reply, and removing a column is a separate decision from
-- adding one.

alter table onboarding_state
  add column if not exists assistant_named_at timestamptz;

comment on column onboarding_state.assistant_named_at is
  'When the owner confirmed what her assistant is called. The name is in assistants.name; this is the attestation that a person chose it. Gates activation (channels/activation.ts).';

insert into _migrations (version, name) values (65, 'assistant_named')
on conflict (version) do nothing;
