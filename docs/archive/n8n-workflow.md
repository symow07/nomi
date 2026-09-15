# Nomi — n8n Workflow Design
## Node-by-Node Implementation Reference

> **You do not need to build these by hand.** All six sub-workflows are generated
> from this document and ship as importable JSON in [`n8n/`](../n8n/) — see
> [`n8n/README.md`](../n8n/README.md). Use this document to *understand* a node;
> don't retype it.
>
> This is the source of truth for node parameters. If you change a node here,
> re-run `node tools/build-workflows.mjs` to regenerate the JSON.
>
> **The generated workflows deliberately differ from this document in five
> places** — each is a bug here that would break a fresh install (empty-array
> halts, the impossible Respond-to-Webhook node, an injection regex that misses
> `"ignore all previous instructions"`, a `ReferenceError` in Node 2.13, and the
> anon/service key split). All five are listed under "Design notes" in
> `n8n/README.md`.

All workflows are designed for n8n Cloud or self-hosted n8n ≥ 1.30.
Use **claude-sonnet-4-6** for all AI nodes.
Use **Supabase** nodes (HTTP Request to REST API) for all DB operations.
Reads and writes both use `SUPABASE_SERVICE_KEY` — RLS denies the anon key.

---

## Overview: Sub-Workflows

```
INTAKE          → normalizes channel payload
MULTIMODAL      → handles text / image branching
CONVERSATION    → state machine + AI analysis
CONFIRMATION    → order creation + email + sheets
ESCALATION      → human notification
DISPATCH        → sends reply back to channel
```

Each sub-workflow is a separate n8n workflow connected by **Execute Workflow** nodes.
This keeps execution trees clean and enables independent testing.

---

## SUB-WORKFLOW 1: INTAKE

**Purpose:** Receive raw payloads from any channel. Normalize. Deduplicate. Route.

---

### Node 1.1 — Webhook (WhatsApp)
```
Type:       Webhook
Name:       Webhook - WhatsApp Intake
Method:     POST
Path:       /webhook/whatsapp
Auth:       Header Auth (x-hub-signature-256 verified in Node 1.2)
Response:   Respond immediately = true (200 OK returned before processing)
```

### Node 1.2 — Webhook (Simulated Channels)
```
Type:       Webhook
Name:       Webhook - Simulated Intake
Method:     POST
Path:       /webhook/simulate
Auth:       Header Auth (x-webhook-secret)
Response:   Respond immediately = true
```
Use this for WeChat, Instagram, RedNote, and test payloads.
The payload must already be in UnifiedInputSchema format (see samples/payloads.json).

---

### Node 1.3 — Signature Verify (WhatsApp only)
```
Type:       Code (JavaScript)
Name:       Verify WhatsApp Signature
```
```javascript
const crypto = require('crypto');
const secret = $env.WHATSAPP_WEBHOOK_SECRET;
const signature = $input.headers['x-hub-signature-256'];
const body = JSON.stringify($input.body);
const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

if (signature !== expected) {
  throw new Error('Invalid webhook signature');
}
return $input.all();
```

---

### Node 1.4 — WhatsApp Adapter
```
Type:       Code (JavaScript)
Name:       Adapter - WhatsApp
```
```javascript
const body = $input.first().json;
const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
const contact = body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];

if (!msg) return []; // ignore status updates, delivery receipts

const typeMap = { text: 'text', image: 'image', audio: 'voice', voice: 'voice' };
let inputType = typeMap[msg.type] || 'unknown';
if (msg.type === 'image' && msg.image?.caption) inputType = 'image_text';

return [{
  json: {
    message_id:        `msg_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    external_id:       msg.id,
    business_id:       $env.BUSINESS_ID,
    channel:           'whatsapp',
    client_channel_id: `whatsapp:${msg.from}`,
    timestamp:         new Date(parseInt(msg.timestamp) * 1000).toISOString(),
    input_type:        inputType,
    text:              msg.text?.body || msg.image?.caption || null,
    audio_url:         msg.audio?.id  ? `MEDIA_ID:${msg.audio.id}`  : null,
    image_url:         msg.image?.id  ? `MEDIA_ID:${msg.image.id}`  : null,
    image_mime_type:   msg.image?.mime_type || null,
    raw_payload:       body,
    metadata: {
      channel_message_id: msg.id,
      wa_profile_name:    contact?.profile?.name || null
    }
  }
}];
```

---

### Node 1.5 — Simulated Channel Passthrough
```
Type:       Set
Name:       Adapter - Simulated (Passthrough)
```
Pass the body directly — simulation payloads must already be in UnifiedInputSchema.
Add `message_id` if not present:
```javascript
if (!$input.first().json.message_id) {
  $input.first().json.message_id = `msg_${Date.now()}_sim`;
}
return $input.all();
```

---

### Node 1.6 — Merge Adapters
```
Type:       Merge
Name:       Merge Adapters
Mode:       Pass-through (each branch flows independently)
```
Both adapter branches flow into this merge point.

---

### Node 1.7 — Resolve WhatsApp Media URLs
```
Type:       IF
Name:       Has Media ID to Resolve?
Condition:  {{ $json.audio_url starts with "MEDIA_ID:" OR $json.image_url starts with "MEDIA_ID:" }}
```

If YES → Node 1.7a (resolve media)
If NO  → Node 1.8 (skip)

**Node 1.7a — Resolve Media URL (HTTP Request)**
```
Type:       HTTP Request
Name:       360dialog - Resolve Media URL
Method:     GET
URL:        https://waba.360dialog.io/v1/media/{{ $json.audio_url.replace('MEDIA_ID:','') OR $json.image_url.replace('MEDIA_ID:','') }}
Headers:    D360-API-KEY: {{ $env.DIALOG360_API_KEY }}
```
Set the resolved URL back into `audio_url` or `image_url` using a Set node after this.

---

### Node 1.8 — Deduplication Check
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Dedup Check
Method:     GET
URL:        {{ $env.SUPABASE_URL }}/rest/v1/messages?external_id=eq.{{ $json.external_id }}&select=id&limit=1
Headers:
  apikey:        {{ $env.SUPABASE_SERVICE_KEY }}
  Authorization: Bearer {{ $env.SUPABASE_SERVICE_KEY }}
```
```
Type:       IF
Name:       Is Duplicate?
Condition:  {{ $json.length > 0 }}
```
If YES → Stop (no response, 200 already sent).
If NO  → Continue to Node 1.9.

---

### Node 1.9 — Client Lookup
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Client Lookup
Method:     GET
URL:        {{ $env.SUPABASE_URL }}/rest/v1/client_channels?channel=eq.{{ $json.channel }}&channel_user_id=eq.{{ $json.client_channel_id }}&select=client_id&limit=1
```
Result stored as `client_lookup`.

---

### Node 1.10 — IF New Client
```
Type:       IF
Name:       New Client?
Condition:  {{ client_lookup.length === 0 }}
```

**Branch TRUE (new client):**

**Node 1.10a — Create Client**
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Create Client
Method:     POST
URL:        {{ $env.SUPABASE_URL }}/rest/v1/clients
Body:
{
  "business_id":   "{{ $json.business_id }}",
  "display_name":  "{{ $json.metadata.wa_profile_name || 'Unknown' }}",
  "last_seen_at":  "{{ $json.timestamp }}"
}
Headers:    Prefer: return=representation
```

**Node 1.10b — Create Client Channel**
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Create Client Channel
Method:     POST
URL:        {{ $env.SUPABASE_URL }}/rest/v1/client_channels
Body:
{
  "client_id":       "{{ $node['Create Client'].json[0].id }}",
  "channel":         "{{ $json.channel }}",
  "channel_user_id": "{{ $json.client_channel_id }}"
}
```

**Node 1.10c — Create Conversation**
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Create Conversation
Method:     POST
URL:        {{ $env.SUPABASE_URL }}/rest/v1/conversations
Body:
{
  "business_id": "{{ $json.business_id }}",
  "client_id":   "{{ client_id }}",
  "channel":     "{{ $json.channel }}",
  "phase":       "warm_intake"
}
Headers:    Prefer: return=representation
```

**Node 1.10d — Create Conversation State**
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Create Conv State
Method:     POST
URL:        {{ $env.SUPABASE_URL }}/rest/v1/conversation_state
Body:
{
  "conversation_id": "{{ conversation_id }}",
  "phase":           "warm_intake",
  "turn_count":      0
}
```

---

**Branch FALSE (existing client):**

**Node 1.11 — Load Conversation**
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Load Active Conv
Method:     GET
URL:        {{ $env.SUPABASE_URL }}/rest/v1/active_conversations_summary?client_id=eq.{{ client_id }}&limit=1
```
Returns full context object from the view.

---

### Node 1.12 — Merge Client Branches + Enrich Input
```
Type:       Code (JavaScript)
Name:       Enrich Input Object
```
Combines client_id, conversation_id, conversation state, and the original unified input into one object passed to the multimodal sub-workflow.

```javascript
const input = $('Merge Adapters').first().json;
const state = $('Load Active Conv').first().json || $('Create Conv State').first().json;

return [{
  json: {
    ...input,
    client_id:       state.client_id || $('Create Client').first().json[0].id,
    conversation_id: state.conversation_id,
    phase:           state.phase || 'warm_intake',
    conversation_state: state,
    is_new_client:   $('New Client?').first().json.condition === true
  }
}];
```

---

### Node 1.13 — Execute Multimodal Sub-Workflow
```
Type:       Execute Workflow
Name:       → Multimodal Analysis
Workflow:   Nomi - Multimodal Analysis
```

---

## SUB-WORKFLOW 2: MULTIMODAL ANALYSIS

**Input:** EnrichedInputObject from Intake workflow.

---

### Node 2.1 — Route by Input Type
```
Type:       Switch
Name:       Route by Input Type
Field:      {{ $json.input_type }}
Cases:
  text           → Text Pipeline
  image          → Image Pipeline
  image_text     → Image+Text Pipeline
  voice          → (deferred) return placeholder
  default        → Text Pipeline (treat as text if unknown)
```

---

### TEXT PIPELINE

### Node 2.2 — Injection Check
```
Type:       Code (JavaScript)
Name:       Injection Check
```
```javascript
const text = ($json.text || '').toLowerCase();
const patterns = [
  /ignore (all |previous |your |the )?instructions/,
  /you are now/,
  /act as (a |an )?(different|new|unrestricted)/,
  /disregard (everything|all|your)/,
  /jailbreak/,
  /pretend (you are|to be)/
];

const isInjection = patterns.some(p => p.test(text));

if (isInjection) {
  return [{
    json: {
      ...$json,
      skip_ai: true,
      injection_detected: true,
      safe_fallback_reply: "Thanks for your message — what products are you looking to source today?"
    }
  }];
}
return $input.all();
```

---

### Node 2.3 — Fast Path: Simple Yes/No Detection
```
Type:       Code (JavaScript)
Name:       Fast Path - Yes/No Detection
```
```javascript
const text = ($json.text || '').toLowerCase().trim();
const pending = $json.conversation_state?.pending_question;

const YES = ['yes','yeah','yep','correct','right','exactly','sure','ok','okay','confirm','confirmed','agreed','نعم','صح','是','对','好','sí','oui','да'];
const NO  = ['no','nope','not','wrong','incorrect','different','other','لا','不是','no','non','нет'];

if (pending === 'product_confirmation') {
  if (YES.includes(text)) {
    return [{ json: { ...$json, fast_path: true, fast_path_type: 'product_confirmed_yes' } }];
  }
  if (NO.includes(text)) {
    return [{ json: { ...$json, fast_path: true, fast_path_type: 'product_confirmed_no' } }];
  }
}

if (pending === 'order_confirmation') {
  if (YES.includes(text)) {
    return [{ json: { ...$json, fast_path: true, fast_path_type: 'order_confirm_yes' } }];
  }
}

return [{ json: { ...$json, fast_path: false } }];
```

---

### Node 2.4 — IF Fast Path
```
Type:       IF
Name:       Is Fast Path?
Condition:  {{ $json.fast_path === true }}
```

**Branch TRUE → Node 2.5 (Handle Fast Path)**
**Branch FALSE → Node 2.6 (Full AI Analysis)**

---

### Node 2.5 — Fast Path Handler
```
Type:       Code (JavaScript)
Name:       Handle Fast Path Response
```
```javascript
const type = $json.fast_path_type;
const state = $json.conversation_state;
const lang = state.preferred_language || 'en';

const replies = {
  product_confirmed_yes: {
    en: `Great — glad we're on the same page. Now, roughly how many pieces are you looking at?`,
    ar: `ممتاز، نعم هذا هو المنتج. كم قطعة تقريباً تحتاج؟`,
    zh: `好的，就是这个产品。您大概需要多少件？`,
    es: `Perfecto. ¿Aproximadamente cuántas piezas necesitas?`
  },
  product_confirmed_no: {
    en: `No problem — could you describe what you're looking for in more detail, or send another photo?`,
    ar: `لا مشكلة، هل يمكنك وصف المنتج بشكل أدق أو إرسال صورة أخرى؟`,
    zh: `没关系，能再描述一下您需要的产品，或者发一张其他的图片吗？`,
    es: `Sin problema — ¿puedes describir lo que buscas con más detalle o enviar otra foto?`
  },
  order_confirm_yes: {
    en: `Perfect — I'll get your confirmation sent right away.`,
    ar: `ممتاز، سأرسل لك تأكيد الطلب فوراً.`,
    zh: `好的，我马上发送确认信息给您。`,
    es: `Perfecto — te envío la confirmación ahora mismo.`
  }
};

const replyMap = replies[type] || {};
const reply = replyMap[lang] || replyMap['en'] || 'Got it — thank you.';

const stateUpdates = {};
if (type === 'product_confirmed_yes') {
  stateUpdates.product_confirmed_by_client = true;
  stateUpdates.phase = 'qualification';
}
if (type === 'order_confirm_yes') {
  stateUpdates.phase = 'confirmation';
}

return [{
  json: {
    ...$json,
    analysis_complete: true,
    reply_text: reply,
    attach_product_image: false,
    state_updates: stateUpdates,
    phase_action: type === 'order_confirm_yes' ? 'confirm_order' : 'advance',
    skip_response_generation: true
  }
}];
```

---

### Node 2.6 — Load Product Catalog (for AI context)
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Load Product Catalog
Method:     GET
URL:        {{ $env.SUPABASE_URL }}/rest/v1/products?business_id=eq.{{ $json.business_id }}&is_active=eq.true&select=id,sku,name,name_zh,category,moq,price_usd_per_unit,customizable
```
**Cache this node:** Use n8n's static data (`$getWorkflowStaticData`) to cache catalog for 30 minutes.

```javascript
// In a Code node before the HTTP Request:
const staticData = $getWorkflowStaticData('global');
const now = Date.now();
if (staticData.catalogCache && (now - staticData.catalogCacheTime < 1800000)) {
  return [{ json: { ...$json, product_catalog: staticData.catalogCache } }];
}
// else: proceed to HTTP request, then store result in staticData.catalogCache
```

---

### Node 2.7 — Load Recent Messages
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Load Recent Messages
Method:     GET
URL:        {{ $env.SUPABASE_URL }}/rest/v1/messages?conversation_id=eq.{{ $json.conversation_id }}&order=sent_at.desc&limit=6&select=direction,text_content,input_type,sent_at
```

---

### Node 2.8 — AI Analysis (Prompts A+B+C Combined)
```
Type:       AI Agent or HTTP Request to Anthropic API
Name:       Claude - Full Analysis
Model:      claude-sonnet-4-6
Max tokens: 800
Temperature: 0.2
```
System prompt: contents of `prompts/analysis.txt`

**IMPORTANT:** Set `Max tokens: 1200` (not 800 — the full JSON output including all fields, multilingual next_logical_question, and customization_details can exceed 800 tokens for complex inquiries).

User message (built in preceding Code node):
```javascript
const catalog = $json.product_catalog.map(p =>
  `${p.id}|${p.sku}|${p.name}|${p.category}|MOQ:${p.moq}|USD:${p.price_usd_per_unit}`
).join('\n');

const history = $json.recent_messages.reverse().map(m =>
  `[${m.direction === 'inbound' ? 'CLIENT' : 'US'}] ${m.text_content || '[media]'}`
).join('\n');

return [{
  json: {
    ...$json,
    prompt_user_content: `PRODUCT CATALOG:\n${catalog}\n\nCONVERSATION HISTORY:\n${history}\n\nCLIENT MESSAGE:\n${$json.text || '[no text]'}\n\nCURRENT PHASE: ${$json.phase}\nCURRENT STATE: ${JSON.stringify($json.conversation_state)}`
  }
}];
```

---

### Node 2.9 — Parse Analysis Output
```
Type:       Code (JavaScript)
Name:       Parse Analysis JSON
```
```javascript
let raw = $input.first().json.message?.content?.[0]?.text || $input.first().json.text || '';
// Strip markdown code fences if present
raw = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
try {
  const analysis = JSON.parse(raw);
  return [{ json: { ...$json, analysis, analysis_complete: true } }];
} catch (e) {
  // Parsing failed — use safe defaults
  return [{
    json: {
      ...$json,
      analysis: {
        language: { detected: 'en', confidence: 0.5, reply_in: 'en' },
        intent: { primary_intent: 'inquiry', product_candidates: [], missing_fields: ['product'] },
        phase: { recommended_phase: $json.phase, can_advance: false, escalation_recommended: false }
      },
      analysis_complete: true,
      analysis_parse_error: true
    }
  }];
}
```

---

### IMAGE PIPELINE

### Node 2.10 — Claude Vision Analysis
```
Type:       HTTP Request to Anthropic API
Name:       Claude - Image Analysis
Method:     POST
URL:        https://api.anthropic.com/v1/messages
Headers:
  x-api-key:         {{ $env.ANTHROPIC_API_KEY }}
  anthropic-version: 2023-06-01
  content-type:      application/json
Body:
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 600,
  "temperature": 0.2,
  "system": "[contents of prompts/image_analysis.txt]",
  "messages": [{
    "role": "user",
    "content": [
      {
        "type": "image",
        "source": {
          "type": "url",
          "url": "{{ $json.image_url }}"
        }
      },
      {
        "type": "text",
        "text": "PRODUCT CATALOG CATEGORIES: packaging, lighting, storage, drinkware, kitchenware, stationery, accessories, electronics, textiles\n\nAnalyze this image and return the JSON."
      }
    ]
  }]
}
```

---

### Node 2.10.5 — Extract Vision Text (insert between 2.10 and 2.11)
```
Type:       Code (JavaScript)
Name:       Extract Vision Response
```
```javascript
// Node 2.10 (HTTP Request to Anthropic) outputs the raw API response as $json.
// $json here IS the Anthropic response body — the original enriched input is lost.
// We re-attach it from the last node before the HTTP request.
// In n8n: reference the node immediately before the Claude call (e.g., "Route by Input Type" or the image branch entry node).

const anthropicResponse = $json; // output of Node 2.10
const rawText = anthropicResponse.content?.[0]?.text || '{}';

// Strip code fences Claude may add despite instructions
const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

// Re-merge with the original enriched input object from before the HTTP call
// Replace 'Route by Input Type' with the actual name of the last node that had the full $json
const originalInput = $('Route by Input Type').first().json;

return [{
  json: {
    ...originalInput,
    vision_raw_text: cleaned
  }
}];
```

---

### Node 2.11 — Image: Catalog Match
```
Type:       Code (JavaScript)
Name:       Image Catalog Match
```
```javascript
// vision_raw_text was set by Node 2.10.5 from the Anthropic response
let visionResult;
try {
  visionResult = JSON.parse($json.vision_raw_text || '{}');
} catch (e) {
  visionResult = { product_candidates: [], image_quality: 'unusable', needs_more_info: true };
}

const topCandidate = visionResult.product_candidates?.[0];

if (!topCandidate || visionResult.image_quality === 'unusable') {
  return [{
    json: {
      ...$json,
      image_analysis: visionResult,
      catalog_match: null,
      image_confidence: 0,
      needs_clarification: true
    }
  }];
}

// Use the visual description to search aliases via Supabase in next node
return [{
  json: {
    ...$json,
    image_analysis: visionResult,
    vision_search_query: topCandidate.description,
    image_confidence: topCandidate.confidence
  }
}];
```

---

### Node 2.12 — Image: Alias Search from Vision Description
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Vision Alias Search
Method:     POST
URL:        {{ $env.SUPABASE_URL }}/rest/v1/rpc/search_product_by_text
Headers:
  apikey:           {{ $env.SUPABASE_SERVICE_KEY }}
  Authorization:    Bearer {{ $env.SUPABASE_SERVICE_KEY }}
  Content-Type:     application/json
Body:
{
  "p_business_id": "{{ $json.business_id }}",
  "p_query":       "{{ $json.vision_search_query }}"
}
```
NOTE: Supabase RPC functions MUST be called with POST, not GET. GET with a body is rejected by most HTTP clients and Supabase.

The `search_product_by_text` function is defined in `supabase/schema.sql`. No need to run it separately.

---

### Node 2.13 — Image: Merge Vision + Catalog
```
Type:       Code (JavaScript)
Name:       Merge Image Analysis
```
```javascript
const catalogMatch = $json.catalog_search_result?.[0];
const visionConf   = $json.image_confidence || 0;
const catalogConf  = catalogMatch?.similarity || 0;
const combinedConf = (visionConf * 0.6) + (catalogConf * 0.4);

return [{
  json: {
    ...$json,
    analysis: {
      language: { detected: 'unknown', confidence: 0.5, reply_in: $json.conversation_state?.preferred_language || 'en' },
      intent: {
        primary_intent: 'product_search',
        product_candidates: catalogMatch ? [{
          product_id:   catalogMatch.product_id,
          product_name: catalogMatch.product_name,
          confidence:   combinedConf,
          match_method: 'image_vision'
        }] : [],
        quantity_mentioned:       null,
        customization_requested:  false,
        missing_fields:           combinedConf < 0.70 ? ['product'] : [],
        // Map image clarification suggestion so response AI receives it as next_question context
        next_logical_question:    visionResult.clarification_suggestion || null
      },
      phase: {
        recommended_phase:      combinedConf >= 0.70 ? 'clarification' : 'warm_intake',
        can_advance:            combinedConf >= 0.70,
        escalation_recommended: false
      }
    },
    image_combined_confidence: combinedConf,
    analysis_complete: true
  }
}];
```

---

### IMAGE+TEXT PIPELINE

### Node 2.14 — Split Image+Text to Parallel
```
Type:       Split In Batches or just route both to Image and Text pipelines
```
Run image analysis (Nodes 2.10–2.13) AND text analysis (Nodes 2.6–2.9) in parallel using n8n's parallel branch execution. Then merge results.

### Node 2.15 — Merge Image+Text Results
```
Type:       Merge
Name:       Merge Image+Text Analysis
Mode:       Combine by position
```
```javascript
// Code node after merge:
const imageResult = $('Merge Image Analysis').first().json;
const textResult  = $('Parse Analysis JSON').first().json;

// Image provides product candidate, text provides quantity + intent
const analysis = {
  language: textResult.analysis.language,
  intent: {
    ...textResult.analysis.intent,
    // Override product candidate with image result if image confidence is higher
    product_candidates: (imageResult.image_combined_confidence > (textResult.analysis.intent.product_candidates?.[0]?.confidence || 0))
      ? imageResult.analysis.intent.product_candidates
      : textResult.analysis.intent.product_candidates
  },
  phase: textResult.analysis.phase
};

return [{ json: { ...$json, analysis, analysis_complete: true } }];
```

---

### VOICE PIPELINE (Minimal — MVP Deferred)

### Node 2.16 — Voice Placeholder
```
Type:       Code (JavaScript)
Name:       Voice - Deferred Placeholder
```
```javascript
return [{
  json: {
    ...$json,
    skip_ai: true,
    safe_fallback_reply: $json.conversation_state?.preferred_language === 'ar'
      ? 'شكراً لرسالتك الصوتية. هل يمكنك كتابة رسالتك؟ سيساعدني ذلك على مساعدتك بشكل أفضل.'
      : 'Thanks for your voice message. Could you type out your question? That will help me assist you better.',
    voice_deferred: true
  }
}];
```

---

## SUB-WORKFLOW 3: CONVERSATION STATE + DECISION

**Input:** Analysis-complete object from Multimodal workflow.

---

### Node 3.1 — IF Skip AI (fast path or injection)
```
Type:       IF
Name:       Skip to Dispatch?
Condition:  {{ ($json.skip_ai === true OR $json.skip_response_generation === true) AND $json.phase_action !== 'confirm_order' }}
```
If YES → Node 3.9 (Save Message) → Execute Dispatch Workflow
If NO  → Node 3.2

IMPORTANT: The `AND $json.phase_action !== 'confirm_order'` guard is required.
Without it, the `order_confirm_yes` fast path (which sets both `skip_response_generation: true`
AND `phase_action: 'confirm_order'`) would bypass Node 3.8's order confirmation trigger entirely,
and no order would ever be created on the fast path.

---

### Node 3.2 — Escalation Score Calculator
```
Type:       Code (JavaScript)
Name:       Escalation Score Calculator
```
```javascript
const state    = $json.conversation_state;
const analysis = $json.analysis;
const text     = ($json.text || '').toLowerCase();
let score      = state.escalation_score || 0;
const flags    = [];

// Deterministic escalation rules
// FIX: was `state.conversation_state?.product_price_usd` (double reference — state IS conversation_state)
const totalValueEst = (state.inquiry_quantity || 0) * (state.product_price_usd || 2);
if (totalValueEst > 10000) { score += 60; flags.push('high_value'); }
else if (totalValueEst > 3000) { score += 40; flags.push('high_value'); }

if (analysis.intent?.customization_requested) { score += 30; flags.push('customization'); }

const humanPhrases = ['speak to someone','real person','call me','human','manager','speak to a person','التحدث مع شخص','اريد احد','找人工','找真人'];
// FIX: was 'client_requested_human' — not in schema CHECK constraint. Use 'client_request'.
if (humanPhrases.some(p => text.includes(p))) { score = 100; flags.push('client_request'); }

const logisticsPhrases = ['letter of credit','lc at sight','ddp','ddu','incoterms','customs clearance','lcl','fcl','freight'];
// FIX: was 'logistics_question' — schema requires 'logistics_payment'
if (logisticsPhrases.some(p => text.includes(p))) { score += 25; flags.push('logistics_payment'); }

// FIX: was 'complaint' — not in schema. Use 'complex_negotiation' as nearest match.
if (analysis.intent?.primary_intent === 'complaint') { score += 40; flags.push('complex_negotiation'); }

const topCandidate = analysis.intent?.product_candidates?.[0];
// FIX: was 'unknown_product_repeated' — schema requires 'repeated_ambiguity'
if (!topCandidate && state.turn_count >= 2) { score += 35; flags.push('repeated_ambiguity'); }

// Valid trigger_reason values per schema CHECK constraint:
// 'high_value','unclear_product','customization','complex_negotiation',
// 'repeated_ambiguity','client_request','logistics_payment','manual','low_confidence_image'

return [{
  json: {
    ...$json,
    escalation_score: Math.min(score, 100),
    escalation_flags: flags
  }
}];
```

---

### Node 3.3 — IF Immediate Escalate
```
Type:       IF
Name:       Immediate Escalate?
Condition:  {{ $json.escalation_score >= 100 }}
```
If YES → Execute Escalation Sub-Workflow
If NO  → Node 3.4

---

### Node 3.4 — Phase Advance Logic
```
Type:       Code (JavaScript)
Name:       Phase Advance Decision
```
```javascript
const state    = $json.conversation_state;
const analysis = $json.analysis;
const current  = state.phase || 'warm_intake';
const topMatch = analysis.intent?.product_candidates?.[0];
const phaseOrder = ['warm_intake','clarification','qualification','commercial_discussion','confirmation','escalated','closed'];

let recommended = analysis.phase?.recommended_phase || current;
let blocked_by  = analysis.phase?.advance_blocked_by || [];
let attach_image = false;
let product_image_url = null;

// Enforce phase only moves forward
const currentIdx   = phaseOrder.indexOf(current);
const recommendedIdx = phaseOrder.indexOf(recommended);
if (recommendedIdx < currentIdx) recommended = current;

// Product image logic
if (topMatch && !state.product_confirmed_by_client) {
  if (topMatch.confidence >= 0.90) {
    // Auto-accept, no image needed unless first time
  } else if (topMatch.confidence >= 0.70) {
    attach_image = true; // Send image for confirmation
  }
}

// Build state updates
const stateUpdates = {
  phase:                    recommended,
  escalation_score:         $json.escalation_score,
  turn_count:               (state.turn_count || 0) + 1,
  last_message_at:          new Date().toISOString()
};

if (topMatch) {
  stateUpdates.identified_product_id = topMatch.product_id;
  stateUpdates.product_confidence    = topMatch.confidence;
}
if (analysis.intent?.quantity_mentioned) {
  stateUpdates.inquiry_quantity = analysis.intent.quantity_mentioned;
  stateUpdates.inquiry_unit     = analysis.intent.quantity_unit || 'pcs';
}

return [{
  json: {
    ...$json,
    recommended_phase: recommended,
    phase_blocked_by:  blocked_by,
    attach_product_image: attach_image,
    state_updates: stateUpdates
  }
}];
```

---

### Node 3.5 — Fetch Product Image (if needed)
```
Type:       IF
Name:       Need Product Image?
Condition:  {{ $json.attach_product_image === true }}
```
If YES → Node 3.5a (HTTP Request) → Node 3.5b (extract URL)

**Node 3.5a — HTTP Request**
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Fetch Product Image
Method:     GET
URL:        {{ $env.SUPABASE_URL }}/rest/v1/product_images?product_id=eq.{{ $json.analysis.intent.product_candidates[0].product_id }}&is_primary=eq.true&select=url&limit=1
Headers:
  apikey:        {{ $env.SUPABASE_SERVICE_KEY }}
  Authorization: Bearer {{ $env.SUPABASE_SERVICE_KEY }}
```

**Node 3.5b — Extract Image URL (Code node — REQUIRED)**
```
Type:       Code (JavaScript)
Name:       Extract Product Image URL
```
```javascript
// Supabase REST returns an array. Extract the URL and merge back onto the original item.
// $json here is the Supabase response array. Re-merge with previous node data.
const imageRows = Array.isArray($json) ? $json : [$json];
const imageUrl = imageRows[0]?.url || null;

// Re-attach original input (from Phase Advance Decision node)
const original = $('Phase Advance Decision').first().json;

return [{
  json: {
    ...original,
    product_image_url: imageUrl
  }
}];
```
If NO (attach_product_image is false) → set product_image_url: null via Set node and continue.

---

### Node 3.6 — Response Generation
```
Type:       HTTP Request to Anthropic API
Name:       Claude - Generate Response
```
System prompt: contents of `prompts/response.txt`

User message (Code node before this):
```javascript
const state    = $json.conversation_state;
const analysis = $json.analysis;
const product  = $json.conversation_state; // has product_name etc from view

const context = {
  phase:               $json.recommended_phase,
  client_name:         state.client_name || 'there',
  reply_language:      analysis.language?.reply_in || state.preferred_language || 'en',
  product_name:        state.product_name || null,
  product_moq:         state.product_moq || null,
  product_price_usd:   state.product_price_usd || null,
  product_lead_time:   state.lead_time_days || null,
  product_customizable: state.product_customizable || false,
  inquiry_quantity:    state.inquiry_quantity || null,
  product_confirmed:   state.product_confirmed_by_client || false,
  next_question:       analysis.intent?.next_logical_question || null,
  attach_image:        $json.attach_product_image,
  missing_fields:      analysis.intent?.missing_fields || [],
  escalation_score:    $json.escalation_score
};

return [{
  json: {
    ...$json,
    response_context: context,
    response_prompt: `CONTEXT:\n${JSON.stringify(context, null, 2)}\n\nCLIENT MESSAGE:\n${$json.text || '[image/media only]'}`
  }
}];
```

---

### Node 3.7 — Parse Response Output
```
Type:       Code (JavaScript)
Name:       Parse Response JSON
```
```javascript
let raw = $input.first().json.message?.content?.[0]?.text || '';
raw = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

try {
  const resp = JSON.parse(raw);
  return [{ json: { ...$json, reply_text: resp.reply_text, phase_action: resp.phase_action, final_attach_image: resp.attach_product_image } }];
} catch (e) {
  return [{ json: { ...$json, reply_text: "Thanks for your message — let me get back to you shortly.", phase_action: 'maintain', final_attach_image: false } }];
}
```

---

### Node 3.8 — Order Confirmation Check
```
Type:       IF
Name:       Trigger Order Confirmation?
Condition:  {{ $json.phase_action === 'confirm_order' }}
```
If YES → Execute Confirmation Sub-Workflow
If NO  → Node 3.9

---

### Node 3.9 — Save Inbound Message
```
Type:       Code (JavaScript) → then HTTP Request (Supabase REST)
Name:       Supabase - Save Inbound Message
```
Use a Code node to build the body safely, then pass to HTTP Request POST:
```javascript
// analysis may be undefined on fast path or injection path — guard all fields
const analysis = $json.analysis || null;
return [{
  json: {
    ...$json,
    _message_body: {
      conversation_id:   $json.conversation_id,
      external_id:       $json.external_id || null,
      direction:         'inbound',
      input_type:        $json.input_type || 'text',
      text_content:      $json.text || null,
      image_url:         $json.image_url || null,
      detected_language: analysis?.language?.detected || null,
      ai_analysis:       analysis,
      sent_at:           $json.timestamp || new Date().toISOString(),
      processed_at:      new Date().toISOString()
    }
  }
}];
```
Then HTTP Request POST with body: `{{ JSON.stringify($json._message_body) }}`

### Node 3.10 — Update Conversation State
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Update Conv State
Method:     PATCH
URL:        {{ $env.SUPABASE_URL }}/rest/v1/conversation_state?conversation_id=eq.{{ $json.conversation_id }}
Body:       {{ JSON.stringify($json.state_updates) }}
```

### Node 3.11 — Update Conversation Phase
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Update Conv Phase
Method:     PATCH
URL:        {{ $env.SUPABASE_URL }}/rest/v1/conversations?id=eq.{{ $json.conversation_id }}
Body:
{
  "phase":      "{{ $json.recommended_phase }}",
  "updated_at": "{{ new Date().toISOString() }}"
}
```

### Node 3.12 — Save Outbound Message
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Save Outbound Message
Method:     POST
URL:        {{ $env.SUPABASE_URL }}/rest/v1/messages
Body:
{
  "conversation_id": "{{ $json.conversation_id }}",
  "direction":       "outbound",
  "input_type":      "text",
  "text_content":    "{{ $json.reply_text }}",
  "sent_at":         "{{ new Date().toISOString() }}"
}
```

---

### Node 3.13 — Execute Dispatch Sub-Workflow
```
Type:       Execute Workflow
Name:       → Dispatch Reply
```

---

## SUB-WORKFLOW 4: CONFIRMATION

### Node 4.0 — Generate Order Reference (Supabase RPC — runs BEFORE Node 4.1)
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Generate Order Reference
Method:     POST
URL:        {{ $env.SUPABASE_URL }}/rest/v1/rpc/generate_order_reference
Headers:
  apikey:        {{ $env.SUPABASE_SERVICE_KEY }}
  Authorization: Bearer {{ $env.SUPABASE_SERVICE_KEY }}
  Content-Type:  application/json
Body:       {}
```
Supabase returns the reference string directly as the response body (e.g. `"YW-2026-04-0001"`).
Store in a Set node: `order_reference = {{ $json }}` (the full body is the string value).

---

### Node 4.1 — Build Order Draft
```
Type:       Code (JavaScript)
Name:       Build Order Draft
```
```javascript
const state = $json.conversation_state;
// FIX: was `new Date().toISOString().slice(0,7).replace('-','')` which produced "202604" not "2026-04"
// Order reference now comes from Node 4.0 (DB sequence via generate_order_reference()).
const ref = $json.order_reference; // set by Node 4.0

return [{
  json: {
    ...$json,
    order_draft: {
      order_reference:        ref,
      business_id:            $json.business_id,
      client_id:              $json.client_id,
      conversation_id:        $json.conversation_id,
      product_id:             state.identified_product_id,
      product_name:           state.product_name,
      quantity:               state.inquiry_quantity,
      unit:                   state.inquiry_unit || 'pcs',
      agreed_unit_price_usd:  state.product_price_usd,
      total_value_usd:        (state.inquiry_quantity || 0) * (state.product_price_usd || 0),
      client_email:           state.client_email || $json.conversation_state.client_email,
      payment_terms:          '30% deposit, 70% before shipment',
      shipping_address:       null,
      notes:                  null,
      status:                 'confirmed'
    }
  }
}];
```

---

### Node 4.2 — AI Order Validation
```
Type:       HTTP Request to Anthropic API
Name:       Claude - Order Validation
```
System prompt: contents of `prompts/order_validation.txt`
User: `{{ JSON.stringify($json.order_draft) }}\n\nCONVERSATION STATE:\n{{ JSON.stringify({ ...$json.conversation_state, escalation_score: $json.escalation_score ?? $json.conversation_state.escalation_score }) }}`

NOTE: `$json.escalation_score` is the current-turn score computed by Node 3.2. `conversation_state.escalation_score` is the value loaded from DB at intake (previous turn). Always pass the current-turn value so validation rule 9 checks against the correct score.

---

### Node 4.2.5 — Parse Validation Response (REQUIRED — insert between 4.2 and 4.3)
```
Type:       Code (JavaScript)
Name:       Parse Validation Response
```
```javascript
// Node 4.2 returns the Anthropic API response body as $json.
// The actual validation JSON is inside content[0].text.
// Without this node, $json.validation_result is undefined and Node 4.3 always fails.
let raw = $json.content?.[0]?.text || '{}';
raw = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

let validation_result;
try {
  validation_result = JSON.parse(raw);
} catch (e) {
  // If parsing fails, block confirmation as a safety measure
  validation_result = {
    order_valid: false,
    safe_to_confirm: false,
    validation_failures: ['parse_error'],
    blocking_issue: 'Unable to validate order — please review manually.',
    estimated_risk: 'high'
  };
}

// Re-merge with original input (order_draft etc. was on the item before the HTTP call)
const original = $('Build Order Draft').first().json;
return [{
  json: {
    ...original,
    validation_result
  }
}];
```

---

### Node 4.3 — IF Order Valid
```
Type:       IF
Name:       Order Safe to Confirm?
Condition:  {{ $json.validation_result.safe_to_confirm === true }}
```
If NO → return blocking_issue as reply, do NOT create order.
If YES → Node 4.4

---

### Node 4.4 — Insert Order
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Insert Order
Method:     POST
URL:        {{ $env.SUPABASE_URL }}/rest/v1/orders
Body:       {{ JSON.stringify($json.order_draft) }}
Headers:
  apikey:        {{ $env.SUPABASE_SERVICE_KEY }}
  Authorization: Bearer {{ $env.SUPABASE_SERVICE_KEY }}
  Content-Type:  application/json
  Prefer:        return=representation
```

### Node 4.4.5 — Extract Order ID (REQUIRED — insert between 4.4 and 4.5)
```
Type:       Code (JavaScript)
Name:       Extract Order ID
```
```javascript
// Node 4.4 with Prefer: return=representation returns the inserted row as an array.
// Without this node, $json.order_id is undefined in Nodes 4.5, 4.6, and 4.7.
const insertedOrder = Array.isArray($json) ? $json[0] : $json;
const original = $('Build Order Draft').first().json;

return [{
  json: {
    ...original,
    order_id: insertedOrder.id
  }
}];
```

---

### Node 4.5 — Google Sheets Append
```
Type:       Google Sheets
Name:       Sheets - Append Confirmed Order
Operation:  Append
Sheet:      Confirmed Orders
```
Row values (map exactly to columns A–T defined in architecture doc):
```javascript
[
  $json.order_draft.order_reference,
  new Date().toISOString().slice(0,10),
  $json.conversation_state.client_name,
  $json.order_draft.client_email,
  $json.channel,
  $json.client_channel_id,
  $json.conversation_state.country || '',
  $json.order_draft.product_name,
  $json.conversation_state.product_sku,
  $json.order_draft.quantity,
  $json.order_draft.unit,
  $json.order_draft.agreed_unit_price_usd,
  $json.order_draft.total_value_usd,
  $json.order_draft.payment_terms,
  $json.order_draft.shipping_address || '',
  $json.conversation_state.lead_time_days || '',
  $json.order_draft.notes || '',
  'Confirmed',
  $json.order_id,
  $json.conversation_id
]
```

---

### Node 4.6 — Send Confirmation Email
```
Type:       SendGrid (or HTTP Request to SendGrid API)
Name:       SendGrid - Send Confirmation
```
```javascript
// Build email payload
const o = $json.order_draft;
const s = $json.conversation_state;

return [{
  json: {
    to:      o.client_email,
    from:    $env.SENDGRID_FROM_EMAIL,
    subject: `Order Confirmation – ${o.product_name} – ${o.order_reference}`,
    html: `[Build from template — see Email Confirmation section in architecture doc]`
  }
}];
```

---

### Node 4.7 — Update Order Flags
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Mark Order Logged
Method:     PATCH
URL:        {{ $env.SUPABASE_URL }}/rest/v1/orders?id=eq.{{ $json.order_id }}
Body:
{
  "google_sheet_logged":     true,
  "confirmation_email_sent": true,
  "confirmed_at":            "{{ new Date().toISOString() }}"
}
```

---

### Node 4.8 — Update Conversation to Closed
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Close Conversation
Method:     PATCH
URL:        {{ $env.SUPABASE_URL }}/rest/v1/conversations?id=eq.{{ $json.conversation_id }}
Body:
{
  "phase":     "closed",
  "is_active": false,
  "closed_at": "{{ new Date().toISOString() }}"
}
```

---

## SUB-WORKFLOW 5: ESCALATION

### Node 5.1 — Insert Escalation Event
```
Type:       HTTP Request (Supabase REST)
Name:       Supabase - Insert Escalation
Method:     POST
URL:        {{ $env.SUPABASE_URL }}/rest/v1/escalation_events
Body:
{
  "conversation_id": "{{ $json.conversation_id }}",
  "business_id":     "{{ $json.business_id }}",
  "trigger_reason":  "{{ $json.escalation_flags[0] || 'manual' }}",
  "trigger_details": "Score: {{ $json.escalation_score }}. Flags: {{ $json.escalation_flags.join(', ') }}",
  "escalation_score": {{ $json.escalation_score }},
  "notified_via":    "telegram",
  "notified_at":     "{{ new Date().toISOString() }}"
}
```

### Node 5.2 — Update Conversation to Escalated
```
Type:       HTTP Request (Supabase REST)
Method:     PATCH
URL:        {{ $env.SUPABASE_URL }}/rest/v1/conversations?id=eq.{{ $json.conversation_id }}
Body:       { "phase": "escalated" }
```

### Node 5.3 — Telegram Notification
```
Type:       HTTP Request
Name:       Telegram - Notify Operator
Method:     POST
URL:        https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage
Body:
{
  "chat_id": "{{ $env.TELEGRAM_ESCALATION_CHAT_ID }}",
  "parse_mode": "HTML",
  "text": "🔔 <b>ESCALATION — Nomi</b>\n\nClient: {{ $json.conversation_state.client_name }}\nChannel: {{ $json.channel }}\nContact: {{ $json.client_channel_id }}\n\nReason: {{ $json.escalation_flags.join(', ') }}\nScore: {{ $json.escalation_score }}\nProduct: {{ $json.conversation_state.product_name || 'Unknown' }}\nQty: {{ $json.conversation_state.inquiry_quantity || 'Not stated' }}\n\nAction: Reply to client directly on {{ $json.channel }}\nConv ID: {{ $json.conversation_id }}"
}
```

### Node 5.4 — Generate Escalation Reply
Use Prompt D with phase = 'escalated'. Return reply to client.

---

## SUB-WORKFLOW 6: DISPATCH

### Node 6.1 — Route by Channel
```
Type:       Switch
Name:       Route by Channel
Cases:
  whatsapp     → Node 6.2
  wechat       → Node 6.3 (mock)
  instagram    → Node 6.3 (mock)
  rednote      → Node 6.3 (mock)
  webhook_test → Node 6.4 (echo)
```

### Node 6.2 — WhatsApp Send (Text)
```
Type:       HTTP Request
Name:       360dialog - Send Text
Method:     POST
URL:        https://waba.360dialog.io/v1/messages
Headers:    D360-API-KEY: {{ $env.DIALOG360_API_KEY }}
Body:
{
  "messaging_product": "whatsapp",
  "to": "{{ $json.client_channel_id.replace('whatsapp:','') }}",
  "type": "text",
  "text": { "body": "{{ $json.reply_text }}" }
}
```

### Node 6.2b — WhatsApp Send (Image + Caption)
```
Type:       IF
Condition:  {{ $json.final_attach_image === true AND $json.product_image_url }}
```
If YES:
```
Body:
{
  "messaging_product": "whatsapp",
  "to": "{{ $json.client_channel_id.replace('whatsapp:','') }}",
  "type": "image",
  "image": {
    "link":    "{{ $json.product_image_url }}",
    "caption": "{{ $json.reply_text }}"
  }
}
```

### Node 6.3 — Simulated Channel Echo
```
Type:       HTTP Request
Name:       Mock - Simulated Channel Response
Method:     POST
URL:        {{ $env.MOCK_CALLBACK_URL || 'https://webhook.site/your-test-url' }}
Body:
{
  "channel":         "{{ $json.channel }}",
  "to":              "{{ $json.client_channel_id }}",
  "reply_text":      "{{ $json.reply_text }}",
  "attach_image":    {{ $json.final_attach_image }},
  "product_image":   "{{ $json.product_image_url }}",
  "conversation_id": "{{ $json.conversation_id }}",
  "phase":           "{{ $json.recommended_phase }}"
}
```

### Node 6.4 — Test Echo
```
Type:       Respond to Webhook
Name:       Test Echo Response
Body:
{
  "status":          "ok",
  "reply_text":      "{{ $json.reply_text }}",
  "phase":           "{{ $json.recommended_phase }}",
  "conversation_id": "{{ $json.conversation_id }}"
}
```

---

## ENVIRONMENT VARIABLES

Set these in n8n Settings → Environment:

```
BUSINESS_ID                   = a0000000-0000-0000-0000-000000000001
SUPABASE_URL                  = https://your-project.supabase.co
SUPABASE_ANON_KEY             = your-supabase-anon-key
SUPABASE_SERVICE_KEY          = your-supabase-service-key
ANTHROPIC_API_KEY             = sk-ant-...
DIALOG360_API_KEY             = your-360dialog-key
WHATSAPP_WEBHOOK_SECRET       = whatsapp_secret_abc123
TELEGRAM_BOT_TOKEN            = your-telegram-bot-token
TELEGRAM_ESCALATION_CHAT_ID   = -1001234567890
SENDGRID_API_KEY              = SG.your-key
SENDGRID_FROM_EMAIL           = sales@yourdomain.com
MOCK_CALLBACK_URL             = https://webhook.site/your-test-url
```

---

## PARALLEL EXECUTION NOTE

For Node 3.9, 3.10, 3.11, 3.12 (DB writes), connect them all from Node 3.8 in parallel branches.
Do NOT wait for DB writes before dispatching reply.
Use n8n's **Split** → parallel branches for write operations.
Dispatch (Node 3.13) runs independently of DB writes.
