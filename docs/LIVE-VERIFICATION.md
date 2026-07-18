# M3 Live Verification Runbook

Everything in M3 is implemented and tested against the local simulator
(`src/channels/whatsapp/simulator.ts`). This runbook is the **only** remaining
work, and it is blocked exclusively on external credentials. Budget: **under
30 minutes** once credentials exist.

## Credentials required (where each one goes)

| Credential | Source | Where it goes |
|---|---|---|
| 360dialog sandbox API key | 360dialog Hub → free sandbox (no verification needed) | env `D360_API_KEY` |
| Webhook HMAC secret | you choose it (any 32+ char random string) | env `WEBHOOK_SECRET` — also given to 360dialog webhook config |
| Webhook verify token | you choose it | env `WEBHOOK_VERIFY_TOKEN` |
| Credential encryption key | `openssl rand -hex 32` | env `CREDENTIAL_KEY` |
| Database password (`yiwuflow_app`) | Supabase dashboard | env `DATABASE_URL` |
| Anthropic API key | console.anthropic.com | env `ANTHROPIC_API_KEY` (AI replies only — not needed for channel verification) |

Secrets go in `.env` (gitignored) only. Never in code, fixtures, or chat.

## Steps

1. **Start the webhook** (any public tunnel works for the sandbox):
   ```bash
   npx tsx src/api/server.ts &          # or the ingress standalone
   cloudflared tunnel --url http://localhost:8787
   ```
2. **Register the callback** with 360dialog (sandbox: one API call):
   ```bash
   curl -X POST https://waba-sandbox.360dialog.io/v1/configs/webhook \
     -H "D360-API-KEY: $D360_API_KEY" -H 'Content-Type: application/json' \
     -d '{"url":"https://<tunnel>/webhook/whatsapp"}'
   ```
   (No owner ever does this — the wizard automates it at onboarding.)
3. **Connection test** — run `runTestConnection` against the real adapter
   (ownerPhone = your own WhatsApp). Expected owner result: `连接正常，可以开始接待客户`.
4. **Incoming**: send a WhatsApp message to the sandbox number. Verify a
   `channel_events` row (PK = wamid) and an enqueued inbound job.
5. **Outgoing**: enqueue an outbound row; verify the worker sends it and
   `outbound_transitions` shows `queued→sending→sent`.
6. **Delivery receipts**: watch the status webhook flip the row to
   `delivered` (and `read`), and that a duplicate/late status is logged as
   `ignored` in `outbound_transitions`.
7. **Expired-window flow**: with a >24h-old conversation, enqueue a reply.
   Expected: canceled with `window_closed`, owner copy `暂时不能主动发送，客户回复后即可继续`.
   Then reply from the buyer phone → window reopens → send succeeds.
8. **Reconnection**: set the credential inactive (`channels.status`), confirm
   the owner card shows `需要处理` + 「重新连接」 copy; reactivate; re-run step 3.

## Expected owner-facing results
Only the five statuses (已连接/正在连接/需要处理/已断开/暂时异常), the four
test-connection results, and three-part problem copy. If anything shows an
error code or English, that is a bug — file it against `src/core/owner/channel.ts`.

## Rollback
The channel layer is additive. To stop live traffic: deactivate the
credential row (`channel_credentials.is_active = false`) — ingress rejects,
worker sends nothing. No deploy needed. n8n remains the live engine
regardless (`businesses.engine` flag, ADR-0009).
