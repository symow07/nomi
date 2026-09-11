# Nomi — First Run Guide

Start here. Do every step in order. Do not skip checkpoints.

---

## STEP 1 — Create Supabase Project

1. Go to [supabase.com](https://supabase.com) → Sign in → **New project**
2. Fill in:
   - **Name:** `nomi`
   - **Database password:** generate a strong one and save it somewhere safe
   - **Region:** choose closest to your target customers (Singapore or Frankfurt for Yiwu exporters)
   - **Plan:** Free tier is sufficient for MVP
3. Click **Create new project** — wait ~2 minutes for provisioning

4. Once ready, go to **Settings → API**. Copy and save:
   - **Project URL** → this is `SUPABASE_URL`
   - **anon public** key → not used by Nomi. After `rls_policies.sql`, RLS
     denies it everything. You can ignore it.
   - **service_role** key → this is `SUPABASE_SERVICE_KEY` (click the eye icon to reveal)

> Keep `SUPABASE_SERVICE_KEY` private. It bypasses Row Level Security.

### Checkpoint 1
You have three values saved:
```
SUPABASE_URL         = https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY = eyJhbGc...
```

---

## STEP 2 — Run schema.sql

1. In your Supabase project, go to **SQL Editor** (left sidebar)
2. Click **New query**
3. Open `supabase/schema.sql` from this project
4. Copy the entire contents and paste into the SQL editor
5. Click **Run** (or Ctrl+Enter)

You should see: `Success. No rows returned`

### Checkpoint 2
Run each of these queries in the SQL editor to confirm:

```sql
-- Should return 13 tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```
Expected tables: `businesses`, `channel_sources`, `client_channels`, `clients`, `conversation_state`, `conversations`, `email_confirmations`, `escalation_events`, `messages`, `orders`, `product_aliases`, `product_images`, `products`

```sql
-- Should return the view
SELECT viewname FROM pg_views WHERE schemaname = 'public';
```
Expected: `active_conversations_summary`

```sql
-- Should return 2 functions
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_type = 'FUNCTION'
ORDER BY routine_name;
```
Expected: `find_client_by_channel`, `generate_order_reference`, `search_product_by_text`, `set_updated_at`

```sql
-- Should confirm pg_trgm is enabled
SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';
```
Expected: one row with `pg_trgm`

If any check fails, re-run `schema.sql` from the beginning.

---

## STEP 3 — Run seed_products.sql

1. In SQL Editor, click **New query**
2. Open `supabase/seed_products.sql`
3. Copy the entire contents, paste, and click **Run**

You should see: `Success. No rows returned`

### Checkpoint 3
Run these queries:

```sql
SELECT id, name FROM businesses;
```
Expected: 1 row — `a0000000-0000-0000-0000-000000000001` | `Yiwu Global Trading Co.`

```sql
SELECT COUNT(*) FROM products;
```
Expected: `15`

```sql
SELECT COUNT(*) FROM product_aliases;
```
Expected: 60 or more rows

```sql
SELECT COUNT(*) FROM product_images;
```
Expected: 18 rows

```sql
-- Verify exactly one primary image per product
SELECT product_id, COUNT(*) FROM product_images
WHERE is_primary = true GROUP BY product_id
HAVING COUNT(*) > 1;
```
Expected: 0 rows (each product has exactly one primary image)

```sql
-- Test the fuzzy search function works
SELECT * FROM search_product_by_text(
  'a0000000-0000-0000-0000-000000000001',
  'non woven bag'
);
```
Expected: 1–3 rows with similarity scores

---

## STEP 4 — Update businesses row with your real values

You can do this now with placeholder values and update later. The key fields are:

```sql
UPDATE businesses SET
  escalation_email            = 'your@email.com',
  escalation_telegram_chat_id = 'FILL_IN_STEP_6',
  google_sheet_id             = 'FILL_IN_STEP_4B'
WHERE id = 'a0000000-0000-0000-0000-000000000001';
```

Come back and fill in the real values as you complete Steps 5 and 6.

---

## STEP 4B — Prepare Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) → Create new spreadsheet
2. Rename the spreadsheet to: `Nomi Orders`
3. Click the default tab name (`Sheet1`) → Rename it to exactly: `Confirmed Orders`
   (case-sensitive — the n8n node looks for this exact name)

4. In Row 1, enter these headers in columns A through T exactly:

| A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P | Q | R | S | T |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Order Ref | Date | Client | Email | Channel | Contact | Country | Product | SKU | Qty | Unit | Unit Price USD | Total USD | Payment Terms | Ship To | Lead Time | Notes | Status | DB Order ID | Conv ID |

5. Copy the spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

6. Go back to Supabase SQL Editor and update:
   ```sql
   UPDATE businesses SET google_sheet_id = 'YOUR_SHEET_ID_HERE'
   WHERE id = 'a0000000-0000-0000-0000-000000000001';
   ```

7. Set up Google Sheets access for n8n — two options:

   **Option A — OAuth2 (easier):**
   - Skip service account setup
   - In n8n, configure Google Sheets credential → OAuth2 → sign in with your Google account
   - The spreadsheet must be owned by or shared with the same Google account

   **Option B — Service Account (recommended for production):**
   - Go to [console.cloud.google.com](https://console.cloud.google.com)
   - Create a project → Enable **Google Sheets API**
   - Go to **IAM & Admin → Service Accounts → Create service account**
   - Name it `nomi-sheets`, click through, create key → **JSON** → download
   - Copy the `client_email` value from the JSON (looks like `nomi-sheets@your-project.iam.gserviceaccount.com`)
   - Back in Google Sheets: **Share** the spreadsheet with that service account email → **Editor** access
   - In n8n: configure Google Sheets credential → Service Account → paste the JSON content

### Checkpoint 4B
Manually add one dummy row to the `Confirmed Orders` tab and then delete it. If the sheet accepts the data and you can delete it, the sheet is writable. The n8n credential test happens in Step 7.

---

## STEP 5 — Prepare SendGrid

1. Go to [sendgrid.com](https://sendgrid.com) → Sign up or log in
2. Complete **Sender Authentication**:
   - Go to **Settings → Sender Authentication**
   - Click **Authenticate Your Domain** — follow DNS instructions for your domain
   - If you don't have a domain yet, use **Single Sender Verification** (Settings → Sender Authentication → Verify a Single Sender) — add your email address and verify it
   - Wait for DNS propagation (can take a few minutes to several hours)

3. Create an API key:
   - Go to **Settings → API Keys → Create API Key**
   - Name: `nomi-mvp`
   - Permission: **Restricted Access → Mail Send → Full Access**
   - Click **Create & View** — copy the key immediately (shown only once)

4. Save:
   ```
   SENDGRID_API_KEY    = SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   SENDGRID_FROM_EMAIL = the verified sender email or domain email you set up
   ```

### Checkpoint 5
```bash
curl -s --request GET \
  --url https://api.sendgrid.com/v3/scopes \
  --header "Authorization: Bearer YOUR_SENDGRID_API_KEY"
```
Expected: JSON containing `"mail.send"` in the scopes array. If you get a 403, the key permissions are wrong.

---

## STEP 6 — Prepare Telegram Bot

1. Open Telegram → search for **@BotFather** → start a conversation
2. Send: `/newbot`
3. Follow prompts:
   - Bot name: `Nomi Escalations` (display name)
   - Bot username: something like `nomi_alerts_bot` (must end in `bot`)
4. BotFather replies with your bot token. Save it:
   ```
   TELEGRAM_BOT_TOKEN = 123456789:AAFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

5. Create or open your escalation group/channel:
   - Create a new Telegram group (or use an existing private group)
   - Add your new bot to the group as a member

6. Get the chat ID:
   - Send any message to the group
   - Visit in a browser (replace YOUR_BOT_TOKEN):
     ```
     https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
     ```
   - Find `"chat":{"id":` in the response — copy the number (negative for groups, e.g. `-1001234567890`)
   - Save it:
     ```
     TELEGRAM_ESCALATION_CHAT_ID = -1001234567890
     ```

7. Update the businesses table:
   ```sql
   UPDATE businesses SET escalation_telegram_chat_id = '-1001234567890'
   WHERE id = 'a0000000-0000-0000-0000-000000000001';
   ```

### Checkpoint 6
Send a test message directly:
```bash
curl -s "https://api.telegram.org/botYOUR_BOT_TOKEN/sendMessage" \
  -d "chat_id=YOUR_CHAT_ID&text=Nomi+test+alert"
```
Expected: JSON with `"ok":true`. Message appears in your group.

If you get `"Bad Request: chat not found"`: the bot is not in the group. Add it and try again.

---

## STEP 7 — Prepare n8n and Set Credentials

### 7a — Access n8n

**n8n Cloud:** Go to [n8n.io](https://n8n.io) → sign up → create a workspace.

**Self-hosted:** Install with Docker:
```bash
docker run -it --rm \
  --name n8n \
  -p 5678:5678 \
  -v ~/.n8n:/home/node/.n8n \
  n8nio/n8n
```
Then open `http://localhost:5678`.

### 7b — Set environment variables

Go to **Settings → Environment Variables** → add each one:

```
BUSINESS_ID                  = a0000000-0000-0000-0000-000000000001
SUPABASE_URL                 = https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY         = eyJhbGc...
ANTHROPIC_API_KEY            = sk-ant-api03-...
TELEGRAM_BOT_TOKEN           = 123456789:AAF...
TELEGRAM_ESCALATION_CHAT_ID  = -1001234567890
SENDGRID_API_KEY             = SG.your-key-here
SENDGRID_FROM_EMAIL          = sales@yourdomain.com
MOCK_CALLBACK_URL            = https://webhook.site/your-unique-url
```

For `MOCK_CALLBACK_URL`: go to [webhook.site](https://webhook.site), copy your unique URL from the page, paste it here.

### 7c — Configure Google Sheets credential

Go to **Settings → Credentials → Add credential → Google Sheets**:

- **OAuth2:** Click **Sign in with Google** → authorise the account that owns the spreadsheet
- **Service Account:** paste the full JSON content of the key file you downloaded in Step 4B

### 7d — Confirm Supabase connectivity

Run this curl to verify your keys work before touching n8n nodes:
```bash
curl -s "https://YOUR_SUPABASE_URL/rest/v1/businesses?select=id,name&limit=1" \
  -H "apikey: YOUR_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY"
```
Expected:
```json
[{"id":"a0000000-0000-0000-0000-000000000001","name":"Yiwu Global Trading Co."}]
```

### Checkpoint 7
- [ ] All 10 environment variables are set in n8n
- [ ] Google Sheets credential is configured and tested (click **Test** in the credential form)
- [ ] Supabase curl returns the businesses row
- [ ] Telegram test message arrived (from Step 6 checkpoint)

---

## STEP 8 — Build the First Workflow (Phases 1–3 only)

Follow `docs/n8n-mvp-build-order.md`. Build Phase 1, Phase 2, and Phase 3 in that order. Do not build Phase 4 (image) yet.

### Create the sub-workflows first

In n8n, create six empty workflows with these exact names (you'll build inside them in order):
1. `Nomi - Intake`
2. `Nomi - Multimodal Analysis`
3. `Nomi - Conversation + Decision`
4. `Nomi - Confirmation`
5. `Nomi - Escalation`
6. `Nomi - Dispatch`

### Build Phase 1 inside `Nomi - Intake`

Add nodes in this order (refer to `docs/n8n-workflow.md` for exact parameters):

1. **Webhook - Simulated Intake** (Webhook node)
   - Path: `/webhook/simulate`
   - Method: POST
   - Authentication: Header Auth
   - Header Name: `x-webhook-secret`
   - Header Value: `test_secret_xyz`
   - Response mode: Respond immediately

2. **Adapter - Simulated Passthrough** (Set node)
   - Pass body through; add `message_id` if absent

3. **Supabase - Dedup Check** (HTTP Request)
   - Method: GET
   - URL: `{{ $env.SUPABASE_URL }}/rest/v1/messages?external_id=eq.{{ $json.external_id }}&select=id&limit=1`
   - Headers: `apikey: {{ $env.SUPABASE_ANON_KEY }}`, `Authorization: Bearer {{ $env.SUPABASE_ANON_KEY }}`

4. **Is Duplicate?** (IF node)
   - Condition: `{{ $json.length > 0 }}`
   - YES branch: add a **NoOp** node (stops execution silently)

5. **Injection Check** (Code node)
   - Copy code from `docs/n8n-workflow.md` Node 2.2

6. **Route by Input Type** (Switch node)
   - Field: `{{ $json.input_type }}`
   - Cases: `text`, `image`, `image_text`
   - Default: `text`

Connect: 1 → 2 → 3 → 4(NO) → 5 → 6

**Save the workflow. Do not activate yet.**

### Build Phase 2 — still inside `Nomi - Intake`

Add after node 6 (connect from the `text` output of the Switch for now):

7. **Supabase - Client Lookup** (HTTP Request GET)
8. **New Client?** (IF node)
9. (TRUE branch) **Create Client** → **Create Client Channel** → **Create Conversation** → **Create Conv State**
10. (FALSE branch) **Supabase - Load Active Conv** (HTTP Request GET)
11. **Enrich Input Object** (Code node — merges both branches)
12. **→ Multimodal Analysis** (Execute Workflow node — target: `Nomi - Multimodal Analysis`)

### Build Phase 3 — inside `Nomi - Multimodal Analysis`

This workflow starts with a **When Called by Another Workflow** trigger node.

Add in order:
1. **Skip to Dispatch?** (IF node)
2. **Fast Path - Yes/No Detection** (Code node)
3. **Is Fast Path?** (IF node)
4. (TRUE) **Handle Fast Path Response** (Code node)
5. (FALSE) **Supabase - Load Product Catalog** (HTTP Request GET)
6. **Supabase - Load Recent Messages** (HTTP Request GET)
7. **Build Analysis Prompt** (Code node)
8. **Claude - Full Analysis** (HTTP Request POST to Anthropic)
9. **Parse Analysis JSON** (Code node)

At the end of Phase 3, the output flows into `Nomi - Conversation + Decision` via an Execute Workflow node. Build a minimal stub of that workflow (trigger + one NoOp) so the Execute Workflow node has a target.

### Build Phase 5 — inside `Nomi - Conversation + Decision`

This is the response generation and dispatch loop. Build all nodes from Phase 5 in `docs/n8n-mvp-build-order.md`.

For the Dispatch step, build a minimal `Nomi - Dispatch` with just the **Test Echo** node (Node 6.4) connected to a **Respond to Webhook** node. This sends the reply back to `MOCK_CALLBACK_URL`.

---

## STEP 9 — Run First Payload Tests

### 9a — Get your webhook URL

In `Nomi - Intake`, click the Webhook node → copy the **Test URL** (use this for manual testing) or activate the workflow to get the **Production URL**.

For first-run testing, use the **Test URL** so you can watch executions in real time.

### 9b — Send TC-001

```bash
curl -X POST YOUR_WEBHOOK_TEST_URL \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: test_secret_xyz" \
  -d '{
    "message_id": "msg_tc001",
    "external_id": "ext_tc001",
    "business_id": "a0000000-0000-0000-0000-000000000001",
    "channel": "webhook_test",
    "client_channel_id": "webhook_test:user_tc001",
    "timestamp": "2026-04-14T09:00:00Z",
    "input_type": "text",
    "text": "Hi, I need some products from Yiwu",
    "audio_url": null,
    "image_url": null,
    "image_caption": null,
    "raw_payload": {},
    "metadata": { "wa_profile_name": "Omar Khalid" }
  }'
```

**Watch the execution** in n8n's execution panel. Each node should show green.

**Check these in Supabase:**
```sql
-- New client created
SELECT id, display_name FROM clients ORDER BY created_at DESC LIMIT 1;

-- New conversation created
SELECT id, phase, channel FROM conversations ORDER BY created_at DESC LIMIT 1;

-- Conversation state initialised
SELECT conversation_id, phase, turn_count FROM conversation_state ORDER BY updated_at DESC LIMIT 1;
```

**Check webhook.site:** Your `MOCK_CALLBACK_URL` should have received a POST with `reply_text` in it.

### 9c — Send TC-001 again (duplicate test)

Change only `message_id` but keep `external_id` = `ext_tc001`:
```bash
curl -X POST YOUR_WEBHOOK_TEST_URL \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: test_secret_xyz" \
  -d '{
    "message_id": "msg_tc001_dup",
    "external_id": "ext_tc001",
    ...
  }'
```
**Expected:** Execution stops at the **Is Duplicate?** node. No new DB rows. No reply sent to webhook.site.

### 9d — Send TC-012 (injection test)

Use the TC-012 payload from `samples/payloads.json`.
**Expected:** Execution stops at **Injection Check**. `safe_fallback_reply` is set. No Claude call fires.

### 9e — Send TC-003 (Arabic test)

Use the TC-003 payload from `samples/payloads.json`.
**Expected:** `reply_text` on webhook.site is in Arabic script.

### 9f — Send TC-002 (product identification)

Use the TC-002 payload from `samples/payloads.json`.
**Expected:**
- Claude identifies a product (non-null `product_id` in analysis)
- Reply mentions the product naturally
- `conversation_state.identified_product_id` is set in Supabase
- Phase advances to `clarification` or `qualification`

### Checkpoint 9
- [ ] TC-001: new client + conversation rows created in Supabase; reply on webhook.site
- [ ] TC-001 duplicate: execution stops at dedup node; no second reply
- [ ] TC-012: stops at injection check; no Claude call
- [ ] TC-003: Arabic reply returned
- [ ] TC-002: product identified in analysis; phase advanced

---

## STEP 10 — Build and Test Remaining Phases

Once all Checkpoint 9 items pass, build the remaining phases in this order:

| Phase | What to build | Key test |
|-------|--------------|----------|
| Phase 4 | Image pipeline (Nodes 4.1–4.5 in build order doc) | TC-006 (image only), TC-007 (image + text) |
| Phase 6 | Escalation sub-workflow (Nodes 6.1–6.7) | TC-009 (human escalation request) |
| Phase 7 | Confirmation sub-workflow (Nodes 7.1–7.11) | TC-011 (order confirmation) |

Each phase has its own checkpoint in `docs/n8n-mvp-build-order.md`. Follow them in order.

---

## Common first-run errors

| Error | Cause | Fix |
|-------|-------|-----|
| Supabase returns 401 | Wrong key used, or anon key used on a write endpoint | All operations — reads included — use `SUPABASE_SERVICE_KEY`. RLS denies the anon key everything by design. Check the failing node's headers. |
| Supabase returns 404 on RPC | `search_product_by_text` or `generate_order_reference` not found | Re-run `schema.sql` — these functions must exist before the seed runs. |
| Claude returns non-JSON | Model added prose around the JSON output | The parse nodes strip code fences and use safe fallbacks. If frequent: add `"Return only a valid JSON object, no prose, no explanation"` as the last line of the relevant prompt file. |
| `$json.analysis` is undefined in Node 3.4 | Fast path or injection path sets `skip_ai` but Node 3.1 condition is wrong | Verify Node 3.1 condition is exactly: `($json.skip_ai === true OR $json.skip_response_generation === true) AND $json.phase_action !== 'confirm_order'` |
| Google Sheets append fails with 403 | Service account not given editor access to the sheet | Open the sheet → Share → add the service account email with Editor permission |
| Google Sheets append fails with "sheet not found" | Tab name mismatch | Tab must be named exactly `Confirmed Orders` — check for extra spaces or wrong capitalisation |
| Telegram `chat not found` | Bot not in the group | Add the bot to the group, send a message in the group, then re-run `getUpdates` to get the chat ID |
| Webhook returns 200 but n8n never fires | Using production URL while workflow is not active, or using test URL after refreshing | Test URL is only live while n8n is listening in the editor. Activate the workflow to use the production URL. |
| Duplicate row in `clients` on second message | `client_channel_id` changed between messages | The dedup key is `(channel, channel_user_id)`. Ensure `client_channel_id` is stable across messages from the same user. |
