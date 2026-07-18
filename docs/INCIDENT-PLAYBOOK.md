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
- Restore: from the standalone PostgreSQL host's backups (PITR availability depends on the selected provider and MUST be verified there — see the OPS-RUNBOOK drill; off-host `pg_dump` cron is the floor). After restore: reconcile `sending` rows (auto-reclaim), re-run parity spot checks.

### 4. Bad deploy
- Rollback = redeploy previous tag. Engine rollback = `update businesses set engine='n8n'` (ADR-0009) — no deploy.
- Before any deploy: `npm run check` green is mandatory, no exceptions solo.

### 5. Credential leak (API key / DB password)
- Rotate at source (360dialog hub / Supabase / Anthropic console) FIRST.
- Re-encrypt: write new `secret_ciphertext` with bumped `secret_key_version`.
- Audit: `channel_audit` rotate_credential row + check `pg_stat_activity` / provider logs for misuse window.

### 6. Employee said something wrong to a buyer
- This is a REPAIR, not an incident: open a repair record (`core/trust/repair.ts` lifecycle), the owner card and containment are automatic.
- If capability-systemic: platform `force_draft` switch + fix + new spot checks.

### 7. Meta quality rating drops
- Stop all template/proactive sends (`force_draft` on follow_up).
- Audit last 50 outbound for spam-feel; check opt-in records. Re-enable gradually.

## Postmortem template (docs/postmortems/YYYY-MM-DD-slug.md)
What happened / timeline / owner impact (which businesses, what they saw) /
root cause / what prevents recurrence / test added.
