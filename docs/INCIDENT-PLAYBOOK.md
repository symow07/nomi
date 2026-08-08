# Incident Playbook

One person ops. Every scenario: **detect → contain → tell the owner (in owner
language) → repair → record**. Owner copy already exists — never improvise it.

## Kill switches (migration 0014, `ops_flags`)
```sql
-- silence one tenant's employee entirely
insert into ops_flags (business_id, flag, reason, set_by) values ($biz, 'global_silence', '...', 'simo');
-- force a capability back to draft, platform-wide
insert into ops_flags (flag, capability, reason, set_by) values ('force_draft', 'quote', '...', 'simo');
-- clear
update ops_flags set cleared_at = now() where id = $id;
```
Switches only reduce authority (monotone by construction). Messages still
ingest and queue under every switch — nothing is dropped.

## Scenarios

### 1. LLM outage (Anthropic down/degraded)
- Detect: consecutive analyzer/replyWriter failures; ladder in `core/ops/degrade.ts` engages automatically.
- Behavior: ≤3 bounded retries silently → after 5 min, owner gets `needManualReply` copy; night shift sends the one-time hold ack instead. Messages hold, never drop.
- You: watch recovery; nothing else needed. Postmortem if >30 min.

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
- This is a REPAIR, not an incident: open a repair record (`core/trust/repair.ts` lifecycle), the owner card and containment are automatic.
- If capability-systemic: platform `force_draft` switch + fix + new spot checks.

### 7. Meta quality rating drops
- Stop all template/proactive sends (`force_draft` on follow_up).
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
