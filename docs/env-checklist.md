# Nomi — Environment Variable Checklist

Set all variables in **n8n Settings → Environment Variables** before running any workflow.
Variables marked **[DB]** are stored in the `businesses` table, not in n8n — update them via SQL after running the seed.
Variables marked **[CRED]** are configured as n8n Credentials, not as env vars.

---

## Required — Core (needed for any test to run)

| Variable | Used in | What it does | Sample value |
|----------|---------|--------------|--------------|
| `BUSINESS_ID` | Intake: Node 1.4 (WhatsApp Adapter) | Hardcodes the business UUID into normalized payloads | `a0000000-0000-0000-0000-000000000001` |
| `SUPABASE_URL` | All sub-workflows — every Supabase HTTP Request node | Base URL for all Supabase REST and RPC calls | `https://abcdefghijkl.supabase.co` |
| ~~`SUPABASE_ANON_KEY`~~ | **Not used.** `supabase/rls_policies.sql` enables RLS with no policies for `anon`, so this key returns zero rows for every table — deliberately. n8n is a trusted server, so a leaked anon key should do nothing. Leave it unset. | — | — |
| `SUPABASE_SERVICE_KEY` | All INSERT / PATCH / RPC nodes: create client, create conversation, save messages, update state, insert order, generate order reference, escalation event | Write and RPC operations. Bypasses RLS. Never expose client-side. | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `ANTHROPIC_API_KEY` | Multimodal Analysis: Node 2.8 (text analysis), Node 2.10 (image vision); Conversation: Node 3.6 (response generation); Confirmation: Node 4.2 (order validation); Escalation: Node 6.5 (escalation reply) | Authenticates all Claude API calls via `x-api-key` header | `sk-ant-api03-...` |
| `MOCK_CALLBACK_URL` | Dispatch: Node 6.3 (simulated channel echo), Node 6.4 (test echo) | Where test replies are sent. Use a webhook.site URL to inspect responses during local testing. Falls back to a placeholder if not set, but responses will not be inspectable. | `https://webhook.site/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |

---

## Required — Escalation (needed for Phase 6 test)

| Variable | Used in | What it does | Sample value |
|----------|---------|--------------|--------------|
| `TELEGRAM_BOT_TOKEN` | Escalation: Node 5.3 (Telegram notify) | Bot token in the API URL: `https://api.telegram.org/bot{TOKEN}/sendMessage` | `123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `TELEGRAM_ESCALATION_CHAT_ID` | Escalation: Node 5.3 (Telegram notify) | Chat or group ID where escalation alerts are sent. Negative numbers indicate groups/channels. | `-1001234567890` |

---

## Required — Confirmation (needed for Phase 7 test)

| Variable | Used in | What it does | Sample value |
|----------|---------|--------------|--------------|
| `SENDGRID_API_KEY` | Confirmation: Node 4.6 (send confirmation email) | Used as `Authorization: Bearer` header in SendGrid HTTP Request, or as the key in the n8n SendGrid credential | `SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| `SENDGRID_FROM_EMAIL` | Confirmation: Node 4.6 — `from` field of the email | Must be a verified sender identity in your SendGrid account | `sales@yourdomain.com` |

---

## Deferred — Real WhatsApp only (do not set during simulated testing)

These are only needed when building the real WhatsApp intake path (Nodes 1.1, 1.3, 1.4, 1.7). Leave empty or unset for all simulated webhook testing.

| Variable | Used in | What it does | Sample value |
|----------|---------|--------------|--------------|
| `DIALOG360_API_KEY` | Intake: Node 1.7a (resolve WhatsApp media URL); Dispatch: Node 6.2 (send WhatsApp text + image) | 360dialog API key, sent as `D360-API-KEY` header | `your-360dialog-api-key` |
| `WHATSAPP_WEBHOOK_SECRET` | Intake: Node 1.3 (verify WhatsApp HMAC signature) | Used to validate `x-hub-signature-256` header on inbound WhatsApp webhooks | `whatsapp_secret_abc123` |

---

## n8n Credentials (configured in n8n UI — not environment variables)

These are not set as env vars. Configure them under **n8n Settings → Credentials**.

| Credential | Used in | How to configure |
|------------|---------|-----------------|
| Google Sheets (OAuth2 or Service Account) | Confirmation: Node 4.5 (Sheets append) | Use n8n's built-in Google Sheets credential. OAuth2: sign in with your Google account. Service Account: upload the JSON key file. Either works for MVP. |
| Simulated Webhook Secret | Intake: Node 1.2 (simulated webhook) | In the Webhook node settings, set **Authentication = Header Auth**, **Header Name = x-webhook-secret**, **Header Value = test_secret_xyz**. This is not an env var — it lives in the node config. |

---

## Database-stored config (update in `businesses` table after running seed)

These are stored in the `businesses` row, not in n8n. Run this SQL after `seed_products.sql`:

```sql
UPDATE businesses SET
  escalation_email              = 'your@email.com',
  escalation_telegram_chat_id   = '-1001234567890',
  google_sheet_id               = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms'
WHERE id = 'a0000000-0000-0000-0000-000000000001';
```

| Field | Used in | Notes |
|-------|---------|-------|
| `escalation_telegram_chat_id` | Escalation: Node 5.3 | MVP uses `$env.TELEGRAM_ESCALATION_CHAT_ID` directly. This DB field is for multi-tenant v2. Set both to the same value for now. |
| `escalation_email` | Not wired in MVP workflows | Reserved for v2 email escalation path. Set it now so the row is complete, but no workflow reads it yet. |
| `google_sheet_id` | Confirmation: Node 4.5 | The n8n Google Sheets node needs the spreadsheet ID. Either hardcode it in the node config, or load it from the DB via the `active_conversations_summary` context. MVP approach: hardcode in the node. |

---

## What can be left empty during local (simulated) testing

| Variable | Safe to leave empty? | Impact if empty |
|----------|---------------------|-----------------|
| `MOCK_CALLBACK_URL` | Yes — falls back to `https://webhook.site/your-test-url` | Replies are sent to a non-functional placeholder URL. Execution completes without error, but you cannot inspect the reply. Set a real webhook.site URL to test reply content. |
| `DIALOG360_API_KEY` | Yes | Only used on the real WhatsApp path (deferred). Simulated webhook bypasses all 360dialog nodes. |
| `WHATSAPP_WEBHOOK_SECRET` | Yes | Only used in Node 1.3 which is on the real WhatsApp path. The simulated webhook uses a separate Node 1.2 with its own header secret in node config. |
| `SENDGRID_API_KEY` | Yes — if skipping Phase 7 email test | Node 4.6 will error. Phases 1–6 are unaffected. To test Phase 7 without real email: disable Node 4.6 in the workflow temporarily. |
| `SENDGRID_FROM_EMAIL` | Yes — same as above | Same node, same impact as `SENDGRID_API_KEY`. |
| `TELEGRAM_BOT_TOKEN` | Yes — if skipping Phase 6 escalation test | Node 5.3 will error on escalation. Phases 1–5 and 7 are unaffected. |
| `TELEGRAM_ESCALATION_CHAT_ID` | Yes — same as above | Same node, same impact as `TELEGRAM_BOT_TOKEN`. |
| Google Sheets credential | Yes — if skipping Phase 7 Sheets test | Node 4.5 will error. Disable it temporarily to test the rest of Phase 7 (order insert + email) in isolation. |

---

## Minimum set for first-run testing (Phases 1–5 only)

```
BUSINESS_ID          = a0000000-0000-0000-0000-000000000001
SUPABASE_URL         = https://your-project.supabase.co
SUPABASE_SERVICE_KEY = eyJhbGc...
ANTHROPIC_API_KEY    = sk-ant-api03-...
MOCK_CALLBACK_URL    = https://webhook.site/your-unique-url
```

Add these when testing Phase 6 (escalation):
```
TELEGRAM_BOT_TOKEN           = 123456789:AAF...
TELEGRAM_ESCALATION_CHAT_ID  = -1001234567890
```

Add these when testing Phase 7 (confirmation):
```
SENDGRID_API_KEY    = SG.your-key-here
SENDGRID_FROM_EMAIL = sales@yourdomain.com
```
Configure Google Sheets credential in n8n UI.
Configure Simulated Webhook header secret in Node 1.2 node settings (value: `test_secret_xyz`).

---

## Quick validity checks

Run these after setting variables to confirm each service is reachable before building workflows:

**Supabase — the service key must read:**
```bash
curl -s "https://YOUR_PROJECT.supabase.co/rest/v1/businesses?select=id&limit=1" \
  -H "apikey: YOUR_SERVICE_KEY" \
  -H "Authorization: Bearer YOUR_SERVICE_KEY"
# Expected: [{"id":"a0000000-0000-0000-0000-000000000001"}]
```

**Supabase — the anon key must NOT read** (proves `rls_policies.sql` applied):
```bash
curl -s "https://YOUR_PROJECT.supabase.co/rest/v1/clients?select=email" \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
# Expected: []  — or a permission error. If this returns client emails,
# RLS is NOT applied and your customer data is publicly readable.
```

**Anthropic:**
```bash
curl -s https://api.anthropic.com/v1/messages \
  -H "x-api-key: YOUR_ANTHROPIC_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
# Expected: JSON with "content" array
```

**Telegram:**
```bash
curl -s "https://api.telegram.org/botYOUR_BOT_TOKEN/getMe"
# Expected: {"ok":true,"result":{"username":"your_bot_name",...}}
```

**SendGrid:**
```bash
curl -s --request GET \
  --url https://api.sendgrid.com/v3/scopes \
  --header "Authorization: Bearer YOUR_SENDGRID_KEY"
# Expected: {"scopes":["mail.send",...]}
```
