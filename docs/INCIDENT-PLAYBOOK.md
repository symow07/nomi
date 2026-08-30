# Incident Playbook

One person ops. Every scenario: **detect → contain → tell the owner (in owner
language) → repair → record**. Owner copy already exists — never improvise it.

## Stopping her (verified 2026-08-12)

What stops a message is `gateOutbound` (`core/channel/sendGate.ts`) — the single
authority, evaluated at SEND time, so it also binds messages that were queued
before you acted. Every control below works by changing one of its inputs.

| Blast radius | Do this | Why it stops her |
|---|---|---|
| The whole factory | `/app/factory` → **Stop messaging** (停止发消息) | `not_activated` — binds the employee *and* the owner |
| One conversation | `/app/inbox` → the conversation → **Take over** | `handed_off` — employee only; you keep replying as yourself |
| One capability | `/app/employee` → the capability → **Revoke** | drops it to draft. This is the real "force_draft", per tenant |
| One buyer | `/app/factory` → allowlist → remove the number | `not_allowlisted` — binds everyone, owner included |
| The connection | `/app/channels` → **Disconnect** | queued employee messages are canceled at send time, by design |

If the app itself is unreachable, this is **Stop messaging** straight against the
database — the same two statements `deactivate()` runs:

```sql
update channels set activated_at = null, status = 'disconnected',
                    disconnected_at = now(), updated_at = now()
 where business_id = $biz and kind = 'whatsapp';
insert into channel_audit (business_id, action, actor, detail)
values ($biz, 'deactivate', 'ops', '{"reason":"incident"}'::jsonb);
```

It works because the send path resolves `activated` from `channels.activated_at`
on every send (`db/channels.ts`). Nothing is deleted — allowlist, conversations
and history all survive, so reactivating resumes rather than rebuilds.

Under every control above, inbound messages still ingest and queue: the webhook
persists the message *before* it enqueues the job, so containment never costs a
buyer's message.

### Ops kill switches (`ops_flags`, migration 0014) — for when the owner cannot act

The controls above are the owner's, through his own screens, and are the right
answer almost always. These are ours, for when the owner is asleep, unreachable,
or the problem spans tenants. **Wired in M34.6** — until then this table was
written by the runbook and read by nothing, so the rows committed and the
employee kept sending. It is read now, on every send, by `db/opsFlags.ts`.

```sql
-- silence one tenant's employee entirely (business_id null = platform-wide)
insert into ops_flags (business_id, flag, reason, set_by) values ($biz, 'global_silence', '...', 'simo');
-- force one capability back to draft, platform-wide
insert into ops_flags (flag, capability, reason, set_by) values ('force_draft', 'quote', '...', 'simo');
-- clear
update ops_flags set cleared_at = now() where id = $id;
```

- Effect is immediate — no deploy, no restart. `global_silence` is resolved at
  SEND time, so replies already queued are refused too; `force_draft` and
  `silence_capability` are resolved when a turn runs, so they bind the next turn.
- A switch only ever REDUCES authority (`core/ops/killSwitch.ts` is monotone by
  construction): auto → draft → silent, never the other way.
- It silences the **employee**, not the owner. He can still reply to every buyer
  from `/app/inbox`, and the refusal he sees says so in his own language.
- Refusals are recorded as `silenced` and surfaced like every other refusal — a
  silenced employee is visible, not mysteriously quiet.
- Ops writes these rows as the table owner; the app role holds SELECT only, so a
  compromised app can neither silence a tenant nor un-silence one.

**Verify it took effect** rather than assuming, which is the whole lesson here:

```sql
select flag, capability, business_id, set_at from ops_flags where cleared_at is null;
```

## Scenarios

### 1. LLM outage (Anthropic down/degraded)
- Detect: `notify.dead_letter` alerts reaching the owner ("有条消息可能没送达，麻烦你看一下。"), plus repeated analyzer/replyWriter failures in worker logs.
- What actually happens: the Anthropic SDK retries internally; if the call still
  fails, the turn throws, the tenant transaction rolls back (nothing half-written),
  and pg-boss retries the inbound job 5× with backoff (10s, doubling). Exhausted →
  the job dead-letters → the `.dead` handler alerts the owner.
- The buyer's message is not lost: ingress persists it before enqueueing, and
  wamid dedup makes replay safe.
- **There is no degradation ladder, and there is no module pretending to be
  one either.** `core/ops/degrade.ts` was reached by no production path and was
  DELETED in M51.3. What it modelled beyond the behaviour above was a
  five-minute owner threshold and a night-shift hold line reading "we will get
  back to you first thing in the morning" — a promise about her behaviour that
  she never made, and the same reason `BUDGET_PAUSE_REPLY` went with it. The
  buyer gets silence and the owner gets an alert, which is the honest pair.
  (A malformed *response* to a successful call does fall back safely — unknown
  intent, stay in phase — which is a different thing.)
- **KNOWN GAP, recorded rather than fixed here:** a dead-lettered inbound job
  is not replayed when the model comes back. The buyer's message is not lost —
  ingress persisted it and wamid dedup makes a replay safe — but the replay is
  a person's decision today, not an automatic one. If an outage dead-letters
  jobs, re-enqueue them after recovery.
- You: watch recovery; if it runs long, **Stop messaging** (§ above) so retries
  stop reaching a live buyer. Postmortem if >30 min.

### 2. WhatsApp/360dialog outage
- Detect: send failures spike / webhook silence. Channel health flips to 暂时异常 automatically (`consecutive_send_failures ≥ 3`).
- Contain: outbound retry queue absorbs (bounded backoff → dead-letter alerts you).
- Owner copy: `OWNER_PROBLEM.sendDelayed` — already routed. Never promise a time.

### 3. Database down
- Total outage: ingress returns 5xx → provider retries up to 7 days; dedup on wamid makes replay safe. Nothing to do but restore.
- Restore: follow **`BACKUP-RESTORE.md`** — it is the executed, verified procedure.
  **Restore roles before the database**, or every RLS policy silently fails to
  restore and you get a database with tenant isolation missing. Do not skip that
  document's verify block. After restore: reconcile `sending` rows (auto-reclaim),
  re-run parity spot checks.
- No continuous archiving is configured — the recovery point is the age of the
  last dump.

### 4. Bad deploy
- Rollback = redeploy the previous commit (**`DEPLOYMENT.md`**). Migrations are
  additive and do **not** roll back; an older build runs fine against a newer schema.
- Confirm what is actually live: `/app/onboarding` → *This installation* → Running
  version (owner login required; deliberately not on `/health`).
- Before any deploy: `npm run check` green is mandatory, no exceptions solo.
- Post-deploy: `bash .claude/skills/run-nomi/verify-remote.sh https://<host> <code>`.

### 5. Credential leak (API key / DB password)
- Rotate at source (Meta app / Railway Postgres / Anthropic console) FIRST.
  Exact commands and blast radius per secret: **`SECRET-ROTATION.md`**.
- Re-encrypt: write new `secret_ciphertext` with bumped `secret_key_version`.
  `CREDENTIAL_KEY` is the dangerous one — check
  `select count(*) from channel_credentials` first; a blind swap makes stored
  credentials undecryptable.
- Audit: `channel_audit` rotate_credential row + check `pg_stat_activity` / provider logs for misuse window.
- **Outstanding:** the setup-era Anthropic key and Railway database passwords were
  pasted into a chat transcript and are still un-rotated. Treat as compromised.

### 6. Employee said something wrong to a buyer
- Contain first: **Take over** that conversation (`/app/inbox`) — she goes silent
  there immediately — or **Revoke** the capability (`/app/employee`) if the
  mistake is systemic rather than one-off. If it spans tenants, `force_draft` on
  that capability platform-wide (§ Ops kill switches).
- Correct it yourself in the same thread, through the same send path.
- **None of this is automatic.** `core/trust/repair.ts` models the repair
  lifecycle and is wired to nothing: there is no repair record written, no owner
  repair card, and no containment that happens by itself. Record it in a
  postmortem instead.

### 7. Meta quality rating drops
- Stop proactive sends: `force_draft` on `follow_up` platform-wide (§ Ops kill
  switches), or **Revoke** it at `/app/employee` for a single tenant.
- Audit last 50 outbound for spam-feel; check opt-in records. Re-enable gradually.

### 8. Replies accepted but not going out (M17.4)
- Detect: `/app/onboarding` → **Delivery health** shows a count under "Replies
  accepted but not yet delivered" (queued longer than 15 minutes) and how long the
  oldest has waited. Nothing stuck ⇒ the section says so plainly.
- Usually the channel, not the app: `/app/channels` shows the connection state.
  Sending resumes by itself once the connection is healthy — queued rows are
  retried, not dropped.
- Confirm directly if needed:
  ```sql
  select status, count(*) from outbound_messages group by status;
  select id, created_at, attempts, last_error from outbound_messages
   where status = 'queued' order by created_at limit 10;
  ```
- Rows stuck in `sending` are auto-reclaimed by the drive loop on the next tick;
  no manual action.
- If the channel was disconnected deliberately, queued **employee** messages are
  canceled at send time by design — that is containment, not data loss.

### 9. A human must take a conversation over
- `/app/inbox` → the conversation → **Take over**. The employee goes silent there
  immediately (the decide-turn gate), and you reply as yourself through the same
  send path — there is no second messaging system.
- **Hand back** when done; the problem signals that triggered the handoff are
  soft-resolved (kept as history, never deleted) so it does not instantly re-escalate.
- Who touched a conversation last is on the conversation itself ("Last action").

## Postmortem template (docs/postmortems/YYYY-MM-DD-slug.md)
What happened / timeline / owner impact (which businesses, what they saw) /
root cause / what prevents recurrence / test added.
