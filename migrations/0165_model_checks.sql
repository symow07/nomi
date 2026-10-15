-- ---------------------------------------------------------------------------
-- 0165 — THE MODEL'S HEALTH IS WHAT A REAL CALL SAID (the owner, 2026-10-15:
-- "/health reported 'answering' while every single call failed… it must make
-- a real call and report what actually happened — answering, slow, or not
-- answering — not just billing refusals.")
--
-- Until now `/health`'s `model` said `refusing` only while the provider
-- refused for BILLING (0128), and `answering` otherwise — including a whole
-- day on which every call timed out.
--
-- One row per provider role (`primary`; `fallback` once one is configured).
-- Written by two things:
--   · the check: every five minutes, the smallest real call to each provider,
--     timed (`source = 'probe'`);
--   · every real call the app makes — a turn, a photo, a page read — when its
--     outcome says something new about the provider (`source = 'call'`).
-- `/health` and the heartbeat read it (src/core/ops/modelHealth.ts): a row
-- older than its freshness reads as `unknown`, never as `answering`.
--
-- No workspace's data is here, and no workspace's ledger pays for the check:
-- 288 calls a day on the operator's workspace would eat its daily model
-- allowance. The check's own calls and tokens are counted on this row.
-- ---------------------------------------------------------------------------

create table if not exists model_checks (
  role            text primary key check (role in ('primary', 'fallback')),
  provider        text not null,
  model           text not null,
  state           text not null check (state in ('answering', 'slow', 'not_answering')),
  ms              integer check (ms is null or ms >= 0),
  reason          text check (reason is null or length(reason) <= 40),
  source          text not null check (source in ('probe', 'call')),
  checked_at      timestamptz not null,
  last_answer_at  timestamptz,
  probes          bigint not null default 0,
  probe_tokens    bigint not null default 0
);

grant select, insert, update on model_checks to nomi_app;
revoke delete, truncate on model_checks from nomi_app;

insert into _migrations (version, name) values (165, 'model_checks')
  on conflict (version) do nothing;
