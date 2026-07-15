# YiwuFlow MVP

Multi-channel B2B sales automation for Yiwu export businesses.
Handles WhatsApp (real) + WeChat / Instagram / RedNote (simulated via webhook).
Supports text and image input in any language.

---

## File Structure

```
yiwuflow/
├── n8n/                          — ★ IMPORTABLE WORKFLOWS — start here
│   ├── README.md                 — Import order, wiring, credentials, design notes
│   ├── intake.json               — Webhook → dedup → client/conversation resolve
│   ├── multimodal-analysis.json  — Injection guard, fast path, text + vision
│   ├── conversation-decision.json— Escalation, phase machine, reply, persistence
│   ├── confirmation.json         — Validation → order → Sheets → email → close
│   ├── escalation.json           — Escalation event → Telegram → handoff
│   └── dispatch.json             — Sends the reply to the channel
├── supabase/
│   ├── schema.sql          — Database schema (run 1st)
│   ├── seed_products.sql   — 15 products with aliases + images (run 2nd)
│   └── rls_policies.sql    — Row Level Security (run 3rd — REQUIRED)
├── tools/
│   ├── build-workflows.mjs    — Regenerates n8n/*.json from the spec
│   ├── validate-workflows.mjs — Structure, reachability, JS syntax
│   └── test-logic.mjs         — Runs the deterministic nodes against samples/
├── docs/
│   ├── n8n-workflow.md          — Node-by-node reference (source of truth)
│   ├── n8n-mvp-build-order.md   — Phased build + test order
│   ├── first-run-guide.md       — Step-by-step first run
│   ├── env-checklist.md         — Every env var, where it's used
│   └── archive/                 — Superseded flat-workflow docs. Do not build from these.
├── prompts/
│   ├── analysis.txt        — Combined language + intent + phase analysis prompt
│   ├── response.txt        — Response generation prompt
│   ├── image_analysis.txt  — Product identification from image prompt
│   └── order_validation.txt — Order safety check prompt
├── samples/
│   └── payloads.json       — 18 test payloads (text, image, Arabic, Chinese, etc.)
└── README.md
```

**The workflows in `n8n/` are the product.** They are generated from
`docs/n8n-workflow.md`; import them rather than building 112 nodes by hand.
See [`n8n/README.md`](n8n/README.md).

---

## Prerequisites

| Service | Purpose | Required for v1 |
|---------|---------|----------------|
| Supabase (free tier ok) | Database | Yes |
| n8n Cloud or self-hosted | Orchestration | Yes |
| Anthropic API (claude-sonnet-4-6) | AI analysis + response | Yes |
| 360dialog | WhatsApp messaging | Yes (real channel) |
| SendGrid | Email confirmation | Yes |
| Telegram Bot | Escalation alerts | Yes |
| Google Sheets API | Order logging | Yes |
| webhook.site or equivalent | Simulated channel testing | Yes (testing) |

---

## Setup Order

### Step 1 — Supabase

1. Create a new Supabase project at supabase.com
2. Go to **SQL Editor**
3. Paste and run `supabase/schema.sql` — creates all tables, indexes, views, and functions including `search_product_by_text` and `generate_order_reference`
4. Paste and run `supabase/seed_products.sql` — inserts business, products, aliases, images
5. Paste and run `supabase/rls_policies.sql` — **required.** Locks the database down (see the key note below). Skipping this leaves every table publicly readable and writable.
5. Update your `businesses` row with real values:
   ```sql
   UPDATE businesses SET
     escalation_email = 'your@email.com',
     escalation_telegram_chat_id = 'your-telegram-chat-id',
     google_sheet_id = 'your-google-sheet-id'
   WHERE id = 'a0000000-0000-0000-0000-000000000001';
   ```
6. Enable **pg_trgm** extension if not already enabled:
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```
7. Collect your Supabase project URL and **service_role** key from **Settings → API**.
   (The anon key is not used — see the key note below.)

**Note on Supabase keys — read this before going live:**

Run `supabase/rls_policies.sql` as step 3. Without it, every table is wide open:
Supabase grants the `anon` role access to the `public` schema by default and new
tables have RLS off, so anyone holding the anon key can read *and write*
`clients` (names, emails, phones), `messages` (full conversation history), and
`orders` (quantities, prices, totals). The anon key is designed to be publicly
distributable — treating it as a secret is not a defence.

`rls_policies.sql` enables RLS with **no policies for `anon`**, which denies it
everything, and revokes its table grants for good measure. `service_role` has
`BYPASSRLS`, so n8n keeps working.

**All n8n Supabase nodes therefore use `SUPABASE_SERVICE_KEY`, reads included.**
`SUPABASE_ANON_KEY` is not used anywhere and can be left unset — a leaked one now
does nothing. (This is safe precisely because n8n is a trusted server-side caller;
there is no browser client, so the anon key never bought any security here.)

**Product images — required for the image pipeline:**
The seed ships placeholder URLs containing `YOUR_PROJECT_REF`. Claude Vision fetches
these over the public internet, so **TC-006 and TC-007 fail until they resolve.**
1. Supabase → Storage → new bucket named `yiwuflow`, marked **public**
2. Upload product photos under `products/` using the filenames in the seed
3. Run the `UPDATE` at the bottom of `seed_products.sql` with your project ref

Verify by opening any `product_images.url` in a browser — it must load without auth.

---

### Step 2 — 360dialog (WhatsApp)

1. Create account at 360dialog.com
2. Complete WhatsApp Business API onboarding
3. Set webhook URL to: `https://your-n8n-host/webhook/whatsapp`
4. Set webhook secret
5. Note your API key

For testing without 360dialog: use the simulated webhook at `/webhook/simulate` with payloads from `samples/payloads.json`.

---

### Step 3 — Telegram Bot

1. Message @BotFather on Telegram
2. Run `/newbot` — follow instructions
3. Note the bot token
4. Add the bot to your escalation group/channel
5. Get the chat ID:
   ```
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   ```
   Send a message to the group, look for `chat.id` in the response.

---

### Step 4 — SendGrid

1. Create account at sendgrid.com
2. Verify your sender domain (Settings → Sender Authentication)
3. Create an API key with Mail Send permissions
4. Note the API key and verified sender email

---

### Step 5 — Google Sheets

1. Create a new Google Sheet
2. Rename the first tab to `Confirmed Orders`
3. Add these headers in Row 1 (columns A through T):
   ```
   Order Ref | Date | Client | Email | Channel | Contact | Country |
   Product | SKU | Qty | Unit | Unit Price USD | Total USD |
   Payment Terms | Ship To | Lead Time | Notes | Status | DB Order ID | Conv ID
   ```
4. Share the sheet with your Google service account email (from n8n Google Sheets credentials)
5. Note the Sheet ID from the URL: `https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`

---

### Step 6 — n8n

#### Environment Variables

In n8n Settings → Environment Variables (or via `.env` for self-hosted):

```
BUSINESS_ID                  = a0000000-0000-0000-0000-000000000001
SUPABASE_URL                 = https://your-project-ref.supabase.co
SUPABASE_SERVICE_KEY         = eyJhbGc...   # ALL Supabase calls, reads included
ANTHROPIC_API_KEY            = sk-ant-api03-...
MOCK_CALLBACK_URL            = https://webhook.site/your-unique-url
GOOGLE_SHEET_ID              = 1BxiMVs0XRA5...          # Confirmation only
TELEGRAM_BOT_TOKEN           = 123456789:AAF...         # Escalation only
TELEGRAM_ESCALATION_CHAT_ID  = -1001234567890           # Escalation only
SENDGRID_API_KEY             = SG.your-key-here         # Confirmation only
SENDGRID_FROM_EMAIL          = sales@yourdomain.com     # Confirmation only
DIALOG360_API_KEY            = your-360dialog-api-key   # real WhatsApp only (deferred)
WHATSAPP_WEBHOOK_SECRET      = whatsapp_secret_abc123   # real WhatsApp only (deferred)
```

`SUPABASE_ANON_KEY` is deliberately absent — see the key note above.

#### Credentials to Configure in n8n

Everything else is an env var; only these two need real n8n credentials:

- **Webhook (Intake)**: Header Auth — name `x-webhook-secret`, value `test_secret_xyz`
- **Google Sheets (Confirmation)**: OAuth2 or Service Account. The account needs **Editor** on the sheet.

#### Building Workflows

**Don't.** Import them: `n8n/*.json`, six workflows, 112 nodes, already built.
Follow [`n8n/README.md`](n8n/README.md) — import leaves-first, then set the
`workflowId` on each Execute Workflow node (the one manual step).

`docs/n8n-workflow.md` remains the node-by-node reference and the source the JSON
is generated from. Read it to understand a node; don't retype it.

Then test each stage in this order, per `docs/n8n-mvp-build-order.md`:
1. Intake (with simulated payloads first)
2. Multimodal Analysis — text branch
3. Multimodal Analysis — image branch
4. Conversation + Decision
5. Dispatch (echo mode)
6. Escalation
7. Confirmation + Sheets + Email

Use n8n's **Pin Data** feature to freeze node output for debugging.

---

### Step 7 — Testing

Use the payloads in `samples/payloads.json`.

Send each payload to your simulated webhook:

```bash
curl -X POST https://your-n8n-host/webhook/simulate \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: test_secret_xyz" \
  -d @- << 'EOF'
{
  "message_id": "msg_tc001",
  "external_id": "ext_tc001",
  "business_id": "a0000000-0000-0000-0000-000000000001",
  "channel": "webhook_test",
  "client_channel_id": "webhook_test:user_tc001",
  "timestamp": "2026-04-13T09:00:00Z",
  "input_type": "text",
  "text": "Hi, I need some products from Yiwu",
  "audio_url": null,
  "image_url": null,
  "image_caption": null,
  "raw_payload": {},
  "metadata": { "wa_profile_name": "Omar Khalid" }
}
EOF
```

The response comes back to `MOCK_CALLBACK_URL` (set it to a webhook.site URL to inspect it).

**Recommended test sequence:**
1. TC-001 — first message from new client
2. TC-002 — product identified in first message
3. TC-003 — Arabic text (verify Arabic reply)
4. TC-006 — image only (requires a real image URL)
5. TC-007 — image + text
6. TC-009 — escalation trigger (verify Telegram message arrives)
7. TC-011 — order confirmation (verify Sheets row + email)
8. TC-012 — injection attempt (verify no AI call, safe reply returned)
9. TC-015 — duplicate message (verify silent drop, no duplicate reply)

---

## Key Design Rules

**Phase advancement is one-way.** The conversation always moves forward:
`warm_intake → clarification → qualification → commercial_discussion → confirmation → closed`

It never goes backward. Escalation can happen from any phase.

**Price and MOQ are never discussed before `commercial_discussion` phase.**
The response prompt enforces this. Do not change this rule.

**Order confirmation requires 5 conditions met:**
1. Product confirmed by client
2. Quantity >= MOQ
3. Price acknowledged
4. Email present
5. Explicit "yes" from client in latest message

**AI calls per message:**
- Text: 2 calls (analysis + response generation)
- Image: 3 calls (vision + analysis + response generation)
- Fast path (yes/no detection): 0 calls

**Deduplication:** Based on `external_id` + `conversation_id`. Always fires before any processing.

**Injections:** Blocked before AI analysis. Safe fallback reply returned with no AI involvement.

---

## Latency Targets

| Flow | Target |
|------|--------|
| Text (fast path yes/no) | < 1s |
| Text (known product) | < 2.5s |
| Text (new client, product search) | < 4s |
| Image only | < 5s |
| Image + text | < 6s |

DB writes and state updates run in parallel with dispatch — they do not block the reply.

---

## What Is Not In v1

| Feature | Status |
|---------|--------|
| Real WeChat API | v2 — requires CN business registration |
| Real Instagram DMs | v2 — requires Meta API review |
| Real RedNote | v2 |
| Voice transcription (Whisper) | v2 — architecture ready, pipeline placeholder in place |
| Vector image search (pgvector) | v2 |
| Admin dashboard | v2 |
| Proactive follow-up sequences | v2 |
| Multi-tenant SaaS mode | v2 |

---

## Troubleshooting

**AI returns non-JSON text:**
The parse nodes have safe fallback defaults. Check n8n execution logs.
If frequent: add `"Return only a valid JSON object, no prose"` as last line in system prompt.

**Supabase query returns 401, or a read returns `[]` when rows clearly exist:**
That node is still using the anon key. After `rls_policies.sql`, `anon` is denied
everything by design — every Supabase node must send `SUPABASE_SERVICE_KEY`,
reads included. Check the node's `apikey` / `Authorization` headers.

**Do not "fix" this by disabling RLS.** That re-opens `clients`, `messages`, and
`orders` to anyone holding the anon key, which is a key meant to be public.

**A workflow branch just stops, with no error:**
Almost always the empty-array problem: PostgREST returns `[]`, n8n splits arrays
into items, and zero items halts that branch silently. Every Supabase node must
set **Response → Include Full Response** (`fullResponse`), then read the array
from `$json.body`. The generated workflows already do this.

**Product alias search returns empty:**
Verify `pg_trgm` extension is enabled. Run:
```sql
SELECT * FROM product_aliases WHERE lower(alias) ILIKE '%bag%' LIMIT 5;
```
If this returns results but the API query does not, check URL encoding of the query parameter.

**WhatsApp webhook signature fails:**
Ensure `WHATSAPP_WEBHOOK_SECRET` matches what is set in 360dialog dashboard exactly (case-sensitive).

**Google Sheets append fails:**
Verify the service account has **Editor** access to the sheet.
Check the sheet tab name matches exactly: `Confirmed Orders`.

**Telegram notification not arriving:**
Test the Telegram send directly:
```bash
curl "https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>&text=test"
```
Ensure the bot has been added to the group and is not muted.
