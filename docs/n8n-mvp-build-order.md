# YiwuFlow — MVP Build Order
## Phase 1 Only: Simulated Webhook, Text + Image, Confirmation, Escalation

Build and test each phase completely before starting the next.
Use `samples/payloads.json` for all test inputs.
Full node parameters are in `docs/n8n-workflow.md` — this doc is the build sequence only.

---

## Environment prerequisites

Before building any node, configure these in n8n Settings → Environment Variables:

```
BUSINESS_ID
SUPABASE_URL
SUPABASE_SERVICE_KEY
ANTHROPIC_API_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_ESCALATION_CHAT_ID
SENDGRID_API_KEY
SENDGRID_FROM_EMAIL
MOCK_CALLBACK_URL        ← set to a webhook.site URL for testing
```

Run `supabase/schema.sql` then `supabase/seed_products.sql` before building Phase 2.

---

## Sub-workflows to create

Create these as separate n8n workflows before building nodes inside them:

| Workflow | Trigger |
|----------|---------|
| YiwuFlow - Intake | Webhook |
| YiwuFlow - Multimodal Analysis | Called by Intake |
| YiwuFlow - Conversation + Decision | Called by Multimodal |
| YiwuFlow - Confirmation | Called by Conversation |
| YiwuFlow - Escalation | Called by Conversation |
| YiwuFlow - Dispatch | Called by Conversation |

---

## PHASE 1 — Simulated Intake + Deduplication

**Goal:** Receive a test payload, reject duplicates, reject injections, identify input type.

### Build order

| Step | Node | Type | Purpose |
|------|------|------|---------|
| 1.1 | Webhook - Simulated Intake | Webhook | Receive POST to `/webhook/simulate`. Header auth: `x-webhook-secret`. Respond immediately = true. |
| 1.2 | Adapter - Simulated Passthrough | Set / Code | Pass body as-is. Add `message_id` if missing. |
| 1.3 | Supabase - Dedup Check | HTTP Request GET | Query `messages` table for `external_id`. URL: `/rest/v1/messages?external_id=eq.{{$json.external_id}}&select=id&limit=1`. Auth: SERVICE key (RLS denies anon — see supabase/rls_policies.sql). |
| 1.4 | Is Duplicate? | IF | Condition: `$json.length > 0`. YES → stop (no reply). NO → continue. |
| 1.5 | Injection Check | Code | Regex check on `$json.text`. If matched: set `skip_ai: true`, `safe_fallback_reply`, stop before any AI call. |
| 1.6 | Route by Input Type | Switch | Field: `$json.input_type`. Cases: `text` → Text Pipeline, `image` → Image Pipeline, `image_text` → Image+Text Pipeline. Default → Text Pipeline. |

**Required inputs:** UnifiedInputSchema payload (see `samples/payloads.json` for exact shape).

**Outputs after step 1.6:** `$json` has all original fields plus `input_type` routed to correct branch.

### Phase 1 test

Send TC-001 (vague text) to your n8n webhook URL:
```bash
curl -X POST https://YOUR-N8N-HOST/webhook/simulate \
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

**Pass criteria:**
- n8n execution visible, no error
- Step 1.4 routes to NO (not a duplicate)
- Step 1.5 does not flag injection
- Step 1.6 routes to `text` branch

Send TC-015 (duplicate message, same `external_id` as a prior sent payload) a second time.
**Pass criteria:** Execution stops at step 1.4. No further nodes fire.

Send TC-012 (injection attempt).
**Pass criteria:** Execution stops at step 1.5. `safe_fallback_reply` is set. No AI call made.

---

## PHASE 2 — Client + Conversation Lookup / Create

**Goal:** For every non-duplicate message, resolve or create the client record and active conversation.

Build inside **YiwuFlow - Intake**, after step 1.6's output rejoins (or before the Switch — Intake handles all input types).

### Build order

| Step | Node | Type | Purpose |
|------|------|------|---------|
| 2.1 | Supabase - Client Lookup | HTTP Request GET | Query `client_channels` by `channel` + `channel_user_id`. Returns `client_id` or empty array. Auth: SERVICE key (RLS denies anon — see supabase/rls_policies.sql). |
| 2.2 | New Client? | IF | Condition: `client_lookup.length === 0`. |
| 2.3a | Supabase - Create Client | HTTP Request POST | Insert into `clients`. Body: `business_id`, `display_name` from metadata, `last_seen_at`. Headers: `Prefer: return=representation`. Auth: SERVICE key. |
| 2.3b | Supabase - Create Client Channel | HTTP Request POST | Insert into `client_channels`. Body: `client_id` from 2.3a, `channel`, `channel_user_id`. Auth: SERVICE key. |
| 2.3c | Supabase - Create Conversation | HTTP Request POST | Insert into `conversations`. Body: `business_id`, `client_id`, `channel`, `phase: warm_intake`. Headers: `Prefer: return=representation`. Auth: SERVICE key. |
| 2.3d | Supabase - Create Conv State | HTTP Request POST | Insert into `conversation_state`. Body: `conversation_id` from 2.3c, `phase: warm_intake`, `turn_count: 0`. Auth: SERVICE key. |
| 2.4 | Supabase - Load Active Conv | HTTP Request GET | Query `active_conversations_summary` view by `client_id`. Returns full context. Auth: SERVICE key (RLS denies anon — see supabase/rls_policies.sql). |
| 2.5 | Enrich Input Object | Code | Merge `client_id`, `conversation_id`, `phase`, `conversation_state` onto the original unified input. Sets `is_new_client` flag. |
| 2.6 | → Multimodal Analysis | Execute Workflow | Pass enriched object to Multimodal sub-workflow. |

**Key output of step 2.5:**
```
$json.client_id
$json.conversation_id
$json.phase
$json.conversation_state   ← full row from active_conversations_summary
$json.is_new_client
```

### Phase 2 test

Send TC-001 (new client).
**Pass criteria:**
- Supabase `clients` has a new row
- Supabase `client_channels` has a new row with `channel: webhook_test`
- Supabase `conversations` has a new row with `phase: warm_intake`
- Supabase `conversation_state` has a new row with `turn_count: 0`

Send TC-001 again (same `client_channel_id`, different `external_id` — change `external_id` to avoid dedup).
**Pass criteria:**
- Step 2.2 routes to FALSE (existing client)
- Step 2.4 returns the existing conversation
- No new rows created in `clients` or `client_channels`

---

## PHASE 3 — Text Analysis Pipeline

**Goal:** Run Claude analysis on text messages. Produce structured `analysis` object covering language, intent, product candidates, and phase recommendation.

Build inside **YiwuFlow - Multimodal Analysis**, Text branch (from step 1.6).

### Build order

| Step | Node | Type | Purpose |
|------|------|------|---------|
| 3.1 | Skip to Dispatch? | IF | Condition: `($json.skip_ai === true OR $json.skip_response_generation === true) AND $json.phase_action !== 'confirm_order'`. YES → jump to save-message step (Phase 5). |
| 3.2 | Fast Path - Yes/No Detection | Code | Detect single-word yes/no against `pending_question`. If matched: set `fast_path: true`, `fast_path_type`, bypass AI. |
| 3.3 | Is Fast Path? | IF | Condition: `$json.fast_path === true`. YES → Handle Fast Path. NO → full AI. |
| 3.4 | Handle Fast Path Response | Code | Return pre-written reply + `state_updates` + `phase_action`. Set `skip_response_generation: true`. |
| 3.5 | Supabase - Load Product Catalog | HTTP Request GET | Query `products` table for active products. Cache in n8n static data for 30 min. Auth: SERVICE key (RLS denies anon — see supabase/rls_policies.sql). |
| 3.6 | Supabase - Load Recent Messages | HTTP Request GET | Query `messages` by `conversation_id`, `order=sent_at.desc`, `limit=6`. Auth: SERVICE key (RLS denies anon — see supabase/rls_policies.sql). |
| 3.7 | Build Analysis Prompt | Code | Format catalog as pipe-delimited string. Format history as CLIENT/US turns. Build full user message. |
| 3.8 | Claude - Full Analysis | HTTP Request POST | POST to Anthropic API. System: `prompts/analysis.txt`. Max tokens: 1200. Temperature: 0.2. |
| 3.9 | Parse Analysis JSON | Code | Extract `content[0].text` from Anthropic response. Strip code fences. JSON.parse. Safe fallback on parse error. Output: `$json.analysis`. |

**Required inputs at step 3.7:**
- `$json.text` — raw client message
- `$json.phase` — current phase
- `$json.conversation_state` — full state object
- `$json.product_catalog` — from step 3.5
- `$json.recent_messages` — from step 3.6

**Output of step 3.9:**
```
$json.analysis.language.detected
$json.analysis.language.reply_in
$json.analysis.intent.primary_intent
$json.analysis.intent.product_candidates[0].product_id
$json.analysis.intent.product_candidates[0].confidence
$json.analysis.intent.quantity_mentioned
$json.analysis.intent.next_logical_question
$json.analysis.intent.missing_fields
$json.analysis.phase.recommended_phase
$json.analysis.phase.can_advance
$json.analysis.phase.advance_blocked_by
```

### Phase 3 test

**Pin the Enrich Input Object output** in n8n to freeze a TC-001 item, then run the Multimodal sub-workflow manually.

Send TC-001 (vague inquiry — no product).
**Pass criteria:**
- `analysis.intent.primary_intent` = `"inquiry"`
- `analysis.intent.product_candidates` = `[]`
- `analysis.phase.recommended_phase` = `"warm_intake"`
- `analysis.language.detected` = `"en"`

Send TC-002 (product mentioned directly — "non-woven bags").
**Pass criteria:**
- `analysis.intent.product_candidates[0].product_id` is a non-null UUID from the catalog
- `analysis.intent.product_candidates[0].confidence` >= 0.70
- `analysis.phase.recommended_phase` = `"clarification"` or `"qualification"`

Send TC-003 (Arabic text).
**Pass criteria:**
- `analysis.language.detected` = `"ar"`
- `analysis.language.reply_in` = `"ar"`
- `analysis.intent.next_logical_question` is in Arabic script

---

## PHASE 4 — Image Analysis Pipeline

**Goal:** Run Claude Vision on image messages. Match result against product catalog via fuzzy alias search. Produce same `analysis` output shape as Phase 3.

Build inside **YiwuFlow - Multimodal Analysis**, Image branch (from step 1.6).

### Build order

| Step | Node | Type | Purpose |
|------|------|------|---------|
| 4.1 | Claude - Image Analysis | HTTP Request POST | POST to Anthropic API with image content block. System: `prompts/image_analysis.txt`. Max tokens: 600. Temperature: 0.2. |
| 4.2 | Extract Vision Response | Code | Extract `content[0].text` from Anthropic response. Strip code fences. Re-merge original `$json` from pre-HTTP node (use `$('Route by Input Type').first().json`). Output: `$json.vision_raw_text`. |
| 4.3 | Image Catalog Match | Code | Parse `vision_raw_text`. Extract top candidate description. If `image_quality === 'unusable'`: set `needs_clarification: true`, `image_confidence: 0`, skip to merge. Else: set `vision_search_query`, `image_confidence`. |
| 4.4 | Supabase - Vision Alias Search | HTTP Request POST | POST to `/rest/v1/rpc/search_product_by_text`. Body: `p_business_id`, `p_query: vision_search_query`. Auth: SERVICE key (RLS denies anon — see supabase/rls_policies.sql). Returns top 3 matches by similarity score. |
| 4.5 | Merge Image Analysis | Code | Combine vision confidence + catalog similarity into `combined_conf`. Build `analysis` object in same shape as text analysis output. Map `visionResult.clarification_suggestion` → `analysis.intent.next_logical_question`. |

**Required inputs at step 4.1:**
- `$json.image_url` — direct accessible URL
- `$json.business_id`

**Output of step 4.5:** Same `$json.analysis` shape as Phase 3 step 3.9.
Additional fields:
```
$json.image_analysis          ← raw vision result
$json.image_combined_confidence
```

**For Image+Text:** Run Image (steps 4.1–4.5) and Text (steps 3.5–3.9) in parallel branches. Merge in step 4.6: use image result for `product_candidates` if `image_combined_confidence` > text confidence; use text result for `language`, `quantity_mentioned`, `phase`.

### Phase 4 test

Send TC-006 (image only — requires an accessible image URL; update `image_url` in the payload with a real public URL of a product image).
**Pass criteria:**
- `image_analysis.image_quality` = `"good"` or `"poor"` (not `"unusable"`)
- `image_analysis.product_candidates[0].description` is a specific product description
- `analysis.intent.product_candidates[0].product_id` is non-null if similarity > 0.2
- `analysis.intent.next_logical_question` is non-null (from `clarification_suggestion`)

Send TC-007 (image + text).
**Pass criteria:**
- Both pipelines run
- Merged `analysis.intent.product_candidates` is populated
- `analysis.language` comes from text pipeline (not `"unknown"`)

---

## PHASE 5 — Response Generation + Dispatch (Echo Mode)

**Goal:** Generate a client-facing reply. Save all messages to DB. Update conversation state. Send reply to `MOCK_CALLBACK_URL`.

Build inside **YiwuFlow - Conversation + Decision** and **YiwuFlow - Dispatch**.

### Build order

| Step | Node | Type | Purpose |
|------|------|------|---------|
| 5.1 | Escalation Score Calculator | Code | Apply deterministic rules: high value (+40/60), customization (+30), human request (→100), logistics (+25), repeated ambiguity (+35). Output: `$json.escalation_score`, `$json.escalation_flags`. |
| 5.2 | Immediate Escalate? | IF | Condition: `$json.escalation_score >= 100`. YES → Escalation sub-workflow (Phase 6). NO → continue. |
| 5.3 | Phase Advance Decision | Code | Enforce forward-only phase. Set `recommended_phase`. Compute `attach_product_image` (true if confidence 0.70–0.89). Build `state_updates`. |
| 5.4 | Need Product Image? | IF | Condition: `$json.attach_product_image === true`. YES → fetch image. NO → set `product_image_url: null`. |
| 5.5 | Supabase - Fetch Product Image | HTTP Request GET | Query `product_images` by `product_id` and `is_primary=true`. Limit 1. Auth: SERVICE key (RLS denies anon — see supabase/rls_policies.sql). |
| 5.6 | Extract Product Image URL | Code | Extract `url` from array response. Re-merge with pre-HTTP `$json` from Phase Advance Decision. Output: `$json.product_image_url`. |
| 5.7 | Build Response Context | Code | Assemble CONTEXT object: `phase`, `client_name`, `reply_language`, `product_name`, `product_moq`, `product_price_usd`, `product_lead_time`, `product_customizable`, `inquiry_quantity`, `product_confirmed`, `next_question`, `attach_image`, `missing_fields`, `escalation_score`. |
| 5.8 | Claude - Generate Response | HTTP Request POST | POST to Anthropic API. System: `prompts/response.txt`. User: CONTEXT + client message. Max tokens: 600. Temperature: 0.3. |
| 5.9 | Parse Response JSON | Code | Extract `content[0].text`. Strip fences. JSON.parse. Extract: `reply_text`, `phase_action`, `final_attach_image`. Safe fallback on error. |
| 5.10 | Trigger Order Confirmation? | IF | Condition: `$json.phase_action === 'confirm_order'`. YES → Confirmation sub-workflow (Phase 7). NO → continue. |
| 5.11 | Supabase - Save Inbound Message | HTTP Request POST | Insert into `messages` (direction: inbound). Build body in Code node first — guard all `analysis` fields for null (fast path has no analysis). Auth: SERVICE key. |
| 5.12 | Supabase - Update Conv State | HTTP Request PATCH | PATCH `conversation_state` by `conversation_id`. Body: `$json.state_updates`. Auth: SERVICE key. |
| 5.13 | Supabase - Update Conv Phase | HTTP Request PATCH | PATCH `conversations` by `id`. Body: `{ phase, updated_at }`. Auth: SERVICE key. |
| 5.14 | Supabase - Save Outbound Message | HTTP Request POST | Insert into `messages` (direction: outbound). Auth: SERVICE key. |
| 5.15 | → Dispatch Reply | Execute Workflow | Pass full `$json` to Dispatch sub-workflow. |
| 5.16 | Test Echo (Dispatch) | Respond to Webhook | Return `{ status, reply_text, phase, conversation_id }` to `MOCK_CALLBACK_URL`. |

**Note:** Steps 5.11–5.14 write to DB in parallel and do not block step 5.15 (dispatch). In n8n, branch them as parallel paths after step 5.10.

**Required inputs at step 5.7:**
- `$json.conversation_state` — full state from view
- `$json.analysis` — from Phase 3 or 4 (or null on fast path)
- `$json.recommended_phase` — from step 5.3
- `$json.escalation_score` — from step 5.1
- `$json.product_image_url` — from step 5.6

**Key outputs of step 5.9:**
```
$json.reply_text
$json.phase_action        ← "maintain" | "advance" | "confirm_order"
$json.final_attach_image
```

### Phase 5 test

Send TC-001 (new client, vague inquiry).
**Pass criteria:**
- `MOCK_CALLBACK_URL` receives a POST with `reply_text` in English
- Reply does NOT mention price, MOQ, or payment terms
- Supabase `messages` has two new rows (inbound + outbound)
- Supabase `conversation_state.turn_count` = 1

Send TC-002 (product identified in first message).
**Pass criteria:**
- `reply_text` asks about the product naturally (possibly attaches image)
- `phase` advances toward `clarification`

Send TC-003 (Arabic input).
**Pass criteria:**
- `reply_text` is in Arabic
- No English in the reply body

Send TC-005 (early price question).
**Pass criteria:**
- `reply_text` redirects to quantity question
- Reply contains no price figures or ranges

---

## PHASE 6 — Escalation

**Goal:** When escalation score hits 100, notify operator on Telegram, update conversation to `escalated`, send client a handoff message.

Build inside **YiwuFlow - Escalation**.

### Build order

| Step | Node | Type | Purpose |
|------|------|------|---------|
| 6.1 | Supabase - Insert Escalation Event | HTTP Request POST | Insert into `escalation_events`. Body: `conversation_id`, `business_id`, `trigger_reason: escalation_flags[0] or 'manual'`, `trigger_details`, `escalation_score`, `notified_via: 'telegram'`, `notified_at`. Auth: SERVICE key. |
| 6.2 | Supabase - Update Conv to Escalated | HTTP Request PATCH | PATCH `conversations` by `id`. Body: `{ phase: 'escalated' }`. Auth: SERVICE key. |
| 6.3 | Telegram - Notify Operator | HTTP Request POST | POST to `https://api.telegram.org/bot{TOKEN}/sendMessage`. Body: HTML-formatted alert with client name, channel, contact, reason, score, product, quantity, conv ID. |
| 6.4 | Build Escalation Reply Context | Code | Set phase to `'escalated'` in context. Pass to response generation. |
| 6.5 | Claude - Generate Escalation Reply | HTTP Request POST | Same as step 5.8 but with phase `'escalated'`. System: `prompts/response.txt`. Returns handoff message ("a specialist will follow up"). |
| 6.6 | Parse Escalation Reply | Code | Same as step 5.9. Extract `reply_text`. |
| 6.7 | → Dispatch Reply | Execute Workflow | Send `reply_text` to client via Dispatch. |

**Required inputs:**
- `$json.escalation_flags` — from step 5.1
- `$json.escalation_score` — from step 5.1
- `$json.conversation_id`, `$json.business_id`
- `$json.conversation_state` — for Telegram message content

### Phase 6 test

Send TC-009 (client requests human — "I want to speak to someone").
**Pass criteria:**
- `escalation_score` = 100 (set by human-request rule)
- Supabase `escalation_events` has a new row with `trigger_reason: 'client_request'`
- Supabase `conversations.phase` = `'escalated'`
- Telegram message arrives in your escalation group
- `MOCK_CALLBACK_URL` receives a handoff reply ("specialist will follow up")

---

## PHASE 7 — Order Confirmation + Sheets + Email

**Goal:** When all 5 conditions are met and `phase_action = 'confirm_order'`, validate the order with AI, write it to DB and Google Sheets, send a confirmation email.

Build inside **YiwuFlow - Confirmation**. This sub-workflow is called from step 5.10 YES branch.

### Build order

| Step | Node | Type | Purpose |
|------|------|------|---------|
| 7.1 | Supabase - Generate Order Reference | HTTP Request POST | POST to `/rest/v1/rpc/generate_order_reference`. Body: `{}`. Auth: SERVICE key. Returns `"YW-2026-04-0001"` as the response body string. Store in Set node as `$json.order_reference`. |
| 7.2 | Build Order Draft | Code | Assemble `order_draft` object from `conversation_state`. Uses `order_reference` from step 7.1. Computes `total_value_usd = quantity * agreed_unit_price_usd`. |
| 7.3 | Claude - Order Validation | HTTP Request POST | POST to Anthropic API. System: `prompts/order_validation.txt`. User: `order_draft` + `conversation_state` (with current-turn `escalation_score` overriding stale DB value). Max tokens: 400. Temperature: 0. |
| 7.4 | Parse Validation Response | Code | Extract `content[0].text` from Anthropic response. Strip fences. JSON.parse. Re-merge with `Build Order Draft` output. Safe fallback: `{ safe_to_confirm: false, validation_failures: ['parse_error'] }`. |
| 7.5 | Order Safe to Confirm? | IF | Condition: `$json.validation_result.safe_to_confirm === true`. NO → return `blocking_issue` as reply to client, do not create order. YES → continue. |
| 7.6 | Supabase - Insert Order | HTTP Request POST | POST to `/rest/v1/orders`. Body: `$json.order_draft`. Headers: `Prefer: return=representation`. Auth: SERVICE key. |
| 7.7 | Extract Order ID | Code | Extract `$json[0].id` from Supabase array response. Re-merge with `Build Order Draft` output. Output: `$json.order_id`. |
| 7.8 | Sheets - Append Confirmed Order | Google Sheets | Append row to `Confirmed Orders` tab. 20 columns: Order Ref, Date, Client, Email, Channel, Contact, Country, Product, SKU, Qty, Unit, Unit Price USD, Total USD, Payment Terms, Ship To, Lead Time, Notes, Status, DB Order ID, Conv ID. |
| 7.9 | SendGrid - Send Confirmation | HTTP Request POST | POST to SendGrid API. To: `order_draft.client_email`. Subject: `Order Confirmation – {product} – {ref}`. HTML body with order summary. Auth: `SG.` key in header. |
| 7.10 | Supabase - Mark Order Logged | HTTP Request PATCH | PATCH `orders` by `id`. Body: `{ google_sheet_logged: true, confirmation_email_sent: true, confirmed_at }`. Auth: SERVICE key. |
| 7.11 | Supabase - Close Conversation | HTTP Request PATCH | PATCH `conversations` by `id`. Body: `{ phase: 'closed', is_active: false, closed_at }`. Auth: SERVICE key. |

**Required inputs at step 7.2:**
```
$json.conversation_state.identified_product_id
$json.conversation_state.product_name
$json.conversation_state.product_sku
$json.conversation_state.inquiry_quantity
$json.conversation_state.inquiry_unit
$json.conversation_state.product_price_usd
$json.conversation_state.client_email (or $json.conversation_state.client_email_collected)
$json.order_reference       ← from step 7.1
$json.business_id
$json.client_id
$json.conversation_id
```

**Key outputs:**
```
$json.order_id              ← DB-assigned UUID
$json.order_draft           ← full order object for Sheets + email
$json.validation_result     ← from step 7.4
```

### Phase 7 test

**Prerequisite:** Run through TC-002 through TC-010 manually to build up a conversation to `confirmation` phase with product confirmed, quantity set, price acknowledged, and email collected. Or use TC-011 which is a pre-built confirmation payload.

Send TC-011.
**Pass criteria:**
- Step 7.4: `validation_result.safe_to_confirm = true`, `validation_failures = []`
- Supabase `orders` has a new row with `order_reference` matching `YW-YYYY-MM-NNNN` format
- Supabase `orders.status` = `'confirmed'`
- Google Sheets `Confirmed Orders` tab has a new row with correct values in all 20 columns
- Confirmation email arrives at the test email address in `client_email`
- Supabase `orders.google_sheet_logged` = `true`, `confirmation_email_sent` = `true`
- Supabase `conversations.phase` = `'closed'`, `is_active` = `false`
- `MOCK_CALLBACK_URL` receives the confirmation reply text

**Validation failure test:** Send TC-011 but strip the `client_email` field from the test state.
**Pass criteria:**
- `validation_result.safe_to_confirm = false`
- `validation_failures` includes `'email_missing'`
- `blocking_issue` is returned as the reply to client
- No order inserted, no email sent

---

## Full MVP test sequence

Once all phases pass individually, run this end-to-end. All 18 payloads in
`samples/payloads.json` are covered — the core nine first, then the rest.

### Core path

| Test | Payload | Pass criteria |
|------|---------|----------|
| TC-001 | New client, vague inquiry | Phase 1–2: dedup, client create, warm_intake reply |
| TC-002 | Product named directly | Phase 3: product identified, image attached, phase advances |
| TC-003 | Arabic input | Phase 3: Arabic reply returned |
| TC-006 | Image only | Phase 4: vision analysis, catalog match or clarification question |
| TC-007 | Image + text | Phase 4: merged pipeline, quantity from text + product from image |
| TC-009 | Human escalation request | Phase 6: Telegram fires, phase = escalated |
| TC-011 | Order confirmation | Phase 7: order in DB + Sheets row + email |
| TC-012 | Injection attempt | Phase 1: stopped at injection check, no AI call |
| TC-015 | Duplicate message | Phase 1: stopped at dedup, no reply sent |

### Language, channel, and scoring coverage

Previously shipped as payloads with no stated pass criteria. Expected values come
from each case's `_expected_phase` / `_expected_action` fields.

| Test | Payload | Pass criteria |
|------|---------|----------|
| TC-004 | Spanish — water bottles | `analysis.language.reply_in = "es"`; reply body contains no English; water bottles identified; phase → `clarification` |
| TC-005 | Price asked in first message | Reply contains **no** price figure, range, or MOQ; redirects to quantity. Phase stays `warm_intake` |
| TC-008 | Customization request (10k printed bags) | `analysis.intent.customization_requested = true`; `escalation_score` rises by 30; reply asks for print specs; phase → `clarification` |
| TC-010 | Logistics / payment question | `escalation_flags` includes `logistics_payment`; `escalation_score` rises by 25 |
| TC-013 | Chinese — canvas totes, returning client | `reply_in = "zh"`; reply is in Chinese; canvas bags identified; **no** new `clients` row (existing client matched) |
| TC-014 | 200,000-unit wholesale order | `escalation_flags` includes `high_value`; score ≥ 60. If it reaches 100, escalation fires and phase → `escalated` |
| TC-016 | WeChat simulated channel | Processed identically to `webhook_test`; `conversations.channel = "wechat"`; reply echoes to `MOCK_CALLBACK_URL` |
| TC-017 | Instagram simulated channel | Same as TC-016 with `channel = "instagram"`. Confirms the unified pipeline is channel-agnostic |
| TC-018 | Client supplies email mid-discussion | Email extracted; `conversation_state.client_email_collected = true`; phase stays `commercial_discussion` |

### Automated pre-checks (no n8n, no API keys)

The deterministic nodes — injection filter, fast path, escalation scoring, phase
machine, dedup — run locally against these payloads:

```bash
node tools/test-logic.mjs
```

This covers TC-001, TC-009, TC-010, TC-012 and TC-015 without touching Supabase,
Anthropic, or n8n. Run it before every import; it is the fastest way to catch a
regression in the Code nodes.

Cases needing a live model (language, product identification, customization
detection — TC-002/003/004/008/013) can only be checked end-to-end in n8n.

---

## Deferred to v2

Do not build these in Phase 1:

| Item | Reason deferred |
|------|----------------|
| WhatsApp real channel (Nodes 1.1, 1.3, 1.4, 1.7) | Requires 360dialog account + WABA approval |
| Voice transcription (Node 2.16) | Whisper API pipeline not wired; placeholder only |
| Real WeChat / Instagram / RedNote | Requires platform API review and CN registration |
| WhatsApp image send (Node 6.2b) | Needs 360dialog media upload API |
| Advanced retry logic | Add after core flow is stable |
| n8n error workflow hooks | Add after core flow is stable |
