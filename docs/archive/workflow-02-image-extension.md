> **⚠️ SUPERSEDED — DO NOT BUILD FROM THIS DOCUMENT.**
>
> This describes the abandoned *single flat workflow* architecture. YiwuFlow uses
> the **sub-workflow** architecture instead: `docs/n8n-workflow.md` (node reference)
> and `docs/n8n-mvp-build-order.md` (build order), now shipped as importable JSON
> in `n8n/`. See `n8n/README.md`.
>
> This path was also incomplete: it had no escalation, no order confirmation, no
> Sheets logging and no email, and there was never a `workflow-03` to add them.
>
> Kept only for reference. Nothing links to it.

---

# YiwuFlow — Workflow 02: Image Extension
## Adds image-only and image+text input to the existing v1 workflow

This document describes only the new nodes to add. Do not rebuild existing nodes.
Apply all changes to the same **`YiwuFlow - v1`** workflow.

---

## What changes and where

Two modifications to the existing workflow:

1. **Insert Node 10.5 (Switch)** between Node 10 (Enrich Input) and Node 11 (Load Product Catalog).
   - The Switch routes `text` to the existing path starting at Node 11.
   - The Switch routes `image` and `image_text` to the new image pipeline.

2. **Insert Node 10.6 (Merge)** between the text pipeline end (Node 15, Parse Analysis JSON) and Node 16 (Build Response Context).
   - Both the text path and the image path converge here before response generation.

3. **Update Node 16 code** to use `product_image_url` if present.

Everything from Node 16 onwards is unchanged except the code update noted below.

---

## New node map

```
Node 10 (Enrich Input — existing)
    ↓
Node 10.5 — Switch: Route by Input Type          ← NEW
    ├── text / default  → Node 11 (existing, unchanged)
    │                            ↓ ... Node 15 (Parse Analysis) ─────────────────┐
    │                                                                              ↓
    └── image / image_text → I1 → I2 → I3                            Node 10.6 — Merge ← NEW
                                        ├── YES → I4 ──┐                          ↓
                                        └── NO  → I3a ─┤              Node 16 (updated code)
                                                      I-Merge
                                                        ↓
                                                       I5
                                                        ↓
                                                       I6
                                                        ├── YES → PI1 → PI2 ──┐
                                                        └── NO  → PI-NO ───────┤
                                                                           PI-Merge ──────────┘
```

**New node names in build order:**

| Node ID | Name | Type |
|---------|------|------|
| 10.5 | Switch — Route by Input Type | Switch |
| I1 | Claude — Vision Analysis | HTTP Request |
| I2 | Extract + Parse Vision Response | Code |
| I3 | Has Vision Candidates? | IF |
| I3a | Set Empty Catalog Result | Code |
| I-Merge | Merge — Before Image Analysis Build | Merge |
| I4 | Supabase — Vision Alias Search | HTTP Request |
| I5 | Build Image Analysis Object | Code |
| I6 | Fetch Product Image? | IF |
| PI1 | Supabase — Fetch Product Image | HTTP Request |
| PI2 | Extract Product Image URL | Code |
| PI-NO | Set Product Image URL Null | Code |
| PI-Merge | Merge — Product Image Paths | Merge |
| 10.6 | Merge — Text + Image Paths | Merge |

---

## NODE 10.5 — Switch: Route by Input Type

**Insert between Node 10 (Enrich Input) and Node 11 (Load Product Catalog).**
Break the existing connection 10→11 and replace it with this Switch.

```
Type:    Switch
Name:    Switch — Route by Input Type
Field:   {{ $json.input_type }}
```

**Cases:**

| Value | Route to |
|-------|----------|
| `text` | Node 11 (Load Product Catalog — existing) |
| `image` | Node I1 (Claude Vision Analysis) |
| `image_text` | Node I1 (Claude Vision Analysis) |
| _(default / fallback)_ | Node 11 (treat unknown types as text) |

---

## NODE I1 — HTTP: Claude Vision Analysis

```
Type:    HTTP Request
Name:    Claude — Vision Analysis
Method:  POST
URL:     https://api.anthropic.com/v1/messages
```

**Headers:**
```
x-api-key:         {{ $env.ANTHROPIC_API_KEY }}
anthropic-version: 2023-06-01
content-type:      application/json
```

**Body — use Expression mode, paste as raw JSON:**
```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 600,
  "temperature": 0.2,
  "system": "PASTE THE FULL CONTENTS OF prompts/image_analysis.txt HERE",
  "messages": [
    {
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
          "text": "PRODUCT CATALOG CATEGORIES: packaging, lighting, storage, drinkware, kitchenware, stationery, accessories, electronics, textiles\n\nAnalyze this image and return the JSON output described in your instructions."
        }
      ]
    }
  ]
}
```

**Options:**
- Timeout: 30000ms
- On Error: Continue

> If `image_url` is not a directly accessible public URL, Claude will return an error. Anthropic does not follow redirects. URLs must resolve to the raw image file.

---

## NODE I2 — Code: Extract + Parse Vision Response

```
Type:    Code
Name:    Extract + Parse Vision Response
```

```javascript
const anthropicResponse = $input.first().json;
const rawText = anthropicResponse.content?.[0]?.text || '';

const cleaned = rawText
  .replace(/^```json\s*/i, '')
  .replace(/^```\s*/i, '')
  .replace(/```\s*$/i, '')
  .trim();

// Re-attach the enriched input from before the HTTP call
const enriched = $('Enrich Input').first().json;

let visionResult;
try {
  visionResult = JSON.parse(cleaned);
} catch (e) {
  visionResult = {
    product_candidates: [],
    image_quality:        'unusable',
    needs_more_info:      true,
    clarification_suggestion: "Could you describe what you're looking for, or send a clearer photo?",
    _parse_error:         true
  };
}

return [{
  json: {
    ...enriched,
    vision_result: visionResult
  }
}];
```

---

## NODE I3 — IF: Has Vision Candidates?

```
Type:      IF
Name:      Has Vision Candidates?
Condition: {{ $json.vision_result.image_quality !== 'unusable' AND $json.vision_result.product_candidates.length > 0 }}
```

- **TRUE:** continue to Node I4 (run catalog alias search)
- **FALSE:** continue to Node I3a (skip search, go straight to analysis build with no match)

---

## NODE I3a — Code: Set Empty Catalog Result

This runs when the image is unusable or Claude found no recognisable product.

```
Type:    Code
Name:    Set Empty Catalog Result
```

```javascript
// Pass the enriched input through unchanged.
// The empty catalog_search_result signals to I5 that no catalog match was found.
return [{
  json: {
    ...$json,
    catalog_search_result: []
  }
}];
```

---

## NODE I4 — HTTP: Supabase Vision Alias Search

```
Type:    HTTP Request
Name:    Supabase — Vision Alias Search
Method:  POST
URL:     {{ $env.SUPABASE_URL }}/rest/v1/rpc/search_product_by_text
```

**Headers:**
```
apikey:        {{ $env.SUPABASE_ANON_KEY }}
Authorization: Bearer {{ $env.SUPABASE_ANON_KEY }}
Content-Type:  application/json
```

**Body (JSON):**

Before this node, add a **Code: Build Vision Search Query** node:

```javascript
// Use the top candidate's description as the search query.
// For image_text inputs, append the caption to improve matching.
const vision    = $json.vision_result;
const topMatch  = vision.product_candidates?.[0];
const caption   = $json.text || '';  // non-null only for image_text inputs

let query = topMatch?.description || '';
if (caption && caption.length > 0 && caption.length < 200) {
  query = `${query} ${caption}`.trim();
}

return [{
  json: {
    ...$json,
    vision_search_query: query
  }
}];
```

Then in Node I4, body:
```json
{
  "p_business_id": "{{ $json.business_id }}",
  "p_query":       "{{ $json.vision_search_query }}"
}
```

---

## NODE I-Merge — Merge: Before Image Analysis Build

```
Type:    Merge
Name:    Merge — Before Image Analysis Build
Mode:    Append
```

Connect:
- Node I4 output → I-Merge input 1
- Node I3a output → I-Merge input 2

Since I3 is an exclusive IF, only one input fires. Append mode passes it through.

> **Important:** Node I4's output is the Supabase RPC response (an array of `{ product_id, product_name, sku, similarity }` objects). Node I3a's output is `{ ...enriched, catalog_search_result: [] }`. Node I5 must read the vision data from the named node reference `$('Extract + Parse Vision Response')`, not from `$json`, because I4's HTTP call overwrites `$json` with the Supabase response.

---

## NODE I5 — Code: Build Image Analysis Object

Produces an `analysis` object in the exact same shape as Node 15 (Parse Analysis JSON) in the text path. This is the convergence contract — both paths must output this shape.

```
Type:    Code
Name:    Build Image Analysis Object
```

```javascript
// I-Merge receives either I4's Supabase response or I3a's passthrough.
// I4 response is an array: [{ product_id, product_name, sku, similarity }, ...]
// I3a response is an object: { ...enriched, catalog_search_result: [] }
const mergedInput = $input.first().json;

// Recover original enriched input (before the HTTP calls overwrote $json)
const enriched = $('Enrich Input').first().json;

// Recover vision result from the parse node
const visionResult = $('Extract + Parse Vision Response').first().json.vision_result;

// Catalog matches: I4 returns array at top level; I3a returns it nested
let catalogMatches;
if (Array.isArray(mergedInput)) {
  catalogMatches = mergedInput;                             // I4 path
} else {
  catalogMatches = mergedInput.catalog_search_result || []; // I3a path
}

const topVision  = visionResult.product_candidates?.[0];
const topCatalog = catalogMatches[0];

const visionConf  = topVision?.confidence || 0;
const catalogConf = topCatalog?.similarity || 0;
// Weight: vision 60%, catalog text match 40%
const combinedConf = parseFloat(((visionConf * 0.6) + (catalogConf * 0.4)).toFixed(3));

const state = enriched.conversation_state;
const replyLang = state?.preferred_language || 'en';

// Build the clarification question, using the image analysis suggestion
const clarificationQ = visionResult.clarification_suggestion || null;

const analysis = {
  language: {
    detected:   'unknown',  // image-only: no text to detect from
    confidence: 0.5,
    script:     'unknown',
    formality:  'informal',
    reply_in:   replyLang
  },
  signals: {
    is_greeting:          false,
    is_question:          false,
    has_product_mention:  combinedConf > 0,
    has_quantity_mention: false,
    has_price_question:   false,
    urgency:              'none',
    sentiment:            'neutral'
  },
  intent: {
    primary_intent:          'product_search',
    product_mention_raw:     topVision?.description || null,
    product_candidates: topCatalog ? [{
      product_id:   topCatalog.product_id,
      product_name: topCatalog.product_name,
      confidence:   combinedConf,
      match_method: 'image_vision'
    }] : [],
    quantity_mentioned:       null,
    quantity_unit:            null,
    customization_requested:  topVision?.visual_attributes?.is_custom_product || false,
    customization_details:    null,
    destination_country:      null,
    timeline_mentioned:       null,
    missing_fields:           combinedConf >= 0.70 ? [] : ['product'],
    // clarification_suggestion from image_analysis.txt routed here
    next_logical_question:    combinedConf >= 0.70
      ? null   // confident match — response prompt will ask for quantity
      : clarificationQ
  },
  phase: {
    current_phase_valid: true,
    recommended_phase:   combinedConf >= 0.70 ? 'clarification' : 'warm_intake',
    phase_change_reason: combinedConf >= 0.70 ? 'product identified from image' : 'low image confidence',
    can_advance:         combinedConf >= 0.70,
    advance_blocked_by:  combinedConf >= 0.70 ? [] : ['missing_product_confirmation']
  }
};

// For image_text: override language detection using caption text heuristic
// (Full text analysis is not run — this is the simplified MVP approach)
if (enriched.input_type === 'image_text' && enriched.text) {
  // Keep reply_in from state preferred_language
  analysis.intent.quantity_mentioned = null; // text quantity extracted by response AI from context
}

return [{
  json: {
    ...enriched,
    analysis,
    analysis_complete:          true,
    image_combined_confidence:  combinedConf,
    vision_top_description:     topVision?.description || null,
    image_quality:              visionResult.image_quality,
    needs_clarification:        combinedConf < 0.55 || visionResult.image_quality === 'unusable'
  }
}];
```

---

## NODE I6 — IF: Fetch Product Image?

```
Type:      IF
Name:      Fetch Product Image?
Condition: {{ $json.image_combined_confidence >= 0.70 AND $json.conversation_state.product_confirmed_by_client !== true AND $json.analysis.intent.product_candidates.length > 0 }}
```

- **TRUE:** go to Node PI1 (fetch the catalog image to show for confirmation)
- **FALSE:** go to Node PI-NO (no image to attach)

---

## NODE PI1 — HTTP: Supabase Fetch Product Image

```
Type:    HTTP Request
Name:    Supabase — Fetch Product Image
Method:  GET
URL:     {{ $env.SUPABASE_URL }}/rest/v1/product_images?product_id=eq.{{ $json.analysis.intent.product_candidates[0].product_id }}&is_primary=eq.true&select=url&limit=1
```

**Headers:**
```
apikey:        {{ $env.SUPABASE_ANON_KEY }}
Authorization: Bearer {{ $env.SUPABASE_ANON_KEY }}
```

---

## NODE PI2 — Code: Extract Product Image URL

```
Type:    Code
Name:    Extract Product Image URL
```

```javascript
// PI1's HTTP response is an array (Supabase REST always returns arrays).
// $json here IS the Supabase response. Re-attach the working object from before.
const rows     = Array.isArray($json) ? $json : [];
const imageUrl = rows[0]?.url || null;

// Re-attach enriched working object from I5
const working = $('Build Image Analysis Object').first().json;

return [{
  json: {
    ...working,
    product_image_url: imageUrl
  }
}];
```

---

## NODE PI-NO — Code: Set Product Image URL Null

```
Type:    Code
Name:    Set Product Image URL Null
```

```javascript
return [{
  json: {
    ...$json,
    product_image_url: null
  }
}];
```

---

## NODE PI-Merge — Merge: Product Image Paths

```
Type:    Merge
Name:    Merge — Product Image Paths
Mode:    Append
```

Connect:
- Node PI2 output → PI-Merge input 1
- Node PI-NO output → PI-Merge input 2

---

## NODE 10.6 — Merge: Text + Image Paths

```
Type:    Merge
Name:    Merge — Text + Image Paths
Mode:    Append
```

Connect:
- Node 15 (Parse Analysis JSON — end of text path) → 10.6 input 1
- Node PI-Merge (end of image path) → 10.6 input 2

**Then connect Node 10.6 output → Node 16 (Build Response Context).**
Break the existing direct connection 15→16 and replace it with 15→10.6→16.

> For the text path, `product_image_url` is not set. Node 16's updated code handles this with `|| null`.

---

## Update Node 16 — Build Response Context

Replace the existing Node 16 code with this updated version. The only changes are:
- `attach_image` now uses `product_image_url` instead of hardcoded `false`
- `product_image_url` is passed through to the output

```javascript
const state    = $json.conversation_state;
const analysis = $json.analysis;

// Phase advance — only forward (unchanged from v1)
const phaseOrder = ['warm_intake','clarification','qualification','commercial_discussion','confirmation','escalated','closed'];
const currentIdx     = phaseOrder.indexOf($json.phase);
const recommendedIdx = phaseOrder.indexOf(analysis.phase?.recommended_phase || $json.phase);
const resolvedPhase  = recommendedIdx > currentIdx
  ? analysis.phase.recommended_phase
  : $json.phase;

// Escalation score (unchanged from v1)
let escalationScore = state.escalation_score || 0;
const text = ($json.text || '').toLowerCase();
if (analysis.intent?.customization_requested) escalationScore += 30;
const humanPhrases = ['speak to someone','real person','call me','human','manager'];
if (humanPhrases.some(p => text.includes(p))) escalationScore = 100;

// ── IMAGE EXTENSION: low-confidence image escalation rule ──
if ($json.image_quality === 'unusable' === false && $json.image_combined_confidence < 0.40 && $json.image_combined_confidence > 0) {
  escalationScore += 15; // repeated unclear images bump score toward escalation
}

const stateUpdates = {
  phase:             resolvedPhase,
  escalation_score:  Math.min(escalationScore, 100),
  turn_count:        (state.turn_count || 0) + 1,
  last_message_at:   $json.timestamp || new Date().toISOString()
};

const topMatch = analysis.intent?.product_candidates?.[0];
if (topMatch?.product_id) {
  stateUpdates.identified_product_id = topMatch.product_id;
  stateUpdates.product_confidence    = topMatch.confidence;
}
if (analysis.intent?.quantity_mentioned) {
  stateUpdates.inquiry_quantity = analysis.intent.quantity_mentioned;
  stateUpdates.inquiry_unit     = analysis.intent.quantity_unit || 'pcs';
}

// ── IMAGE EXTENSION: product_image_url from PI2 or null ──
const productImageUrl = $json.product_image_url || null;

const context = {
  phase:                resolvedPhase,
  client_name:          state.client_name || 'there',
  reply_language:       analysis.language?.reply_in || state.preferred_language || 'en',
  product_name:         state.product_name || topMatch?.product_name || null,
  product_moq:          state.product_moq || null,
  product_price_usd:    state.product_price_usd || null,
  product_lead_time:    state.lead_time_days || null,
  product_customizable: state.product_customizable || false,
  inquiry_quantity:     state.inquiry_quantity || analysis.intent?.quantity_mentioned || null,
  product_confirmed:    state.product_confirmed_by_client || false,
  next_question:        analysis.intent?.next_logical_question || null,
  attach_image:         productImageUrl !== null,   // ← updated
  missing_fields:       analysis.intent?.missing_fields || [],
  escalation_score:     escalationScore
};

return [{
  json: {
    ...$json,
    recommended_phase:  resolvedPhase,
    escalation_score:   escalationScore,
    state_updates:      stateUpdates,
    response_context:   context,
    product_image_url:  productImageUrl,              // ← new: passed to echo/dispatch
    response_prompt:    `CONTEXT:\n${JSON.stringify(context, null, 2)}\n\nCLIENT MESSAGE:\n${$json.text || '[image only — no caption]'}`
  }
}];
```

---

## Update Node 23 — Echo Reply

Update the **Code: Build Echo Body** node (immediately before Node 23) to include the image fields:

```javascript
return [{
  json: {
    ...$json,
    _echo_body: {
      status:            'ok',
      channel:           $json.channel || 'unknown',
      to:                $json.client_channel_id || 'unknown',
      reply_text:        $json.reply_text,
      attach_image:      $json.final_attach_image || false,
      product_image_url: $json.product_image_url || null,
      phase:             $json.recommended_phase || $json.phase || 'warm_intake',
      phase_action:      $json.phase_action || 'maintain',
      conversation_id:   $json.conversation_id || null,
      turn_count:        $json.state_updates?.turn_count || null,
      // Debug fields — useful during image pipeline testing
      image_confidence:  $json.image_combined_confidence || null,
      image_quality:     $json.image_quality || null,
      vision_description: $json.vision_top_description || null
    }
  }
}];
```

---

## Test payloads

### TC-006 — Image only (high confidence expected)

The Unsplash URL used below shows a water bottle. Claude should identify it as a drinkware product. Your seed catalog contains `BTL-SS-500-001` (stainless steel water bottle) — expect a match.

```bash
curl -X POST "YOUR_N8N_WEBHOOK_TEST_URL" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: test_secret_xyz" \
  -d '{
    "message_id":        "msg_tc006",
    "external_id":       "ext_tc006",
    "business_id":       "a0000000-0000-0000-0000-000000000001",
    "channel":           "webhook_test",
    "client_channel_id": "webhook_test:user_tc006",
    "timestamp":         "2026-04-14T10:00:00Z",
    "input_type":        "image",
    "text":              null,
    "audio_url":         null,
    "image_url":         "https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=800",
    "image_caption":     null,
    "raw_payload":       {},
    "metadata":          { "wa_profile_name": "Aisha Osei" }
  }'
```

**Expected in n8n execution:**
- Node I1 (Claude Vision): `content[0].text` contains valid JSON with at least one `product_candidates` entry
- Node I2: `vision_result.image_quality` = `"good"` or `"poor"`, `product_candidates.length > 0`
- Node I3: routes YES
- Node I4: Supabase RPC returns at least one row with `similarity > 0.2`
- Node I5: `image_combined_confidence` between 0 and 1, `analysis.intent.product_candidates[0].product_id` is a non-null UUID
- Node I6: routes YES if confidence >= 0.70, NO if below
- Node 23 echo on webhook.site includes `vision_description` and optionally `product_image_url`

**Expected reply_text:** Mentions the product with a natural confirmation question ("Is this the kind of bottle you're looking for?" or similar). Does not mention price or MOQ.

---

### TC-007 — Image + text (caption with quantity)

```bash
curl -X POST "YOUR_N8N_WEBHOOK_TEST_URL" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: test_secret_xyz" \
  -d '{
    "message_id":        "msg_tc007",
    "external_id":       "ext_tc007",
    "business_id":       "a0000000-0000-0000-0000-000000000001",
    "channel":           "webhook_test",
    "client_channel_id": "webhook_test:user_tc007",
    "timestamp":         "2026-04-14T10:05:00Z",
    "input_type":        "image_text",
    "text":              "How much for 500 of these? Need them by end of month",
    "audio_url":         null,
    "image_url":         "https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=800",
    "image_caption":     "How much for 500 of these? Need them by end of month",
    "raw_payload":       {},
    "metadata":          { "wa_profile_name": "David Park" }
  }'
```

**Expected:**
- Routes to image pipeline (Node 10.5 image_text case)
- Node I4 query includes both the vision description AND the caption text
- `analysis.intent.product_candidates[0]` is set
- `response_context.inquiry_quantity` is null (quantity parsing needs text analysis — MVP limitation; the response AI sees "500" in the client message and addresses it naturally)
- Reply acknowledges both the product and the quantity question — does not give a price (wrong phase)

---

### TC-unusable — Deliberately bad image (simulate low confidence)

```bash
curl -X POST "YOUR_N8N_WEBHOOK_TEST_URL" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: test_secret_xyz" \
  -d '{
    "message_id":        "msg_tc_bad",
    "external_id":       "ext_tc_bad",
    "business_id":       "a0000000-0000-0000-0000-000000000001",
    "channel":           "webhook_test",
    "client_channel_id": "webhook_test:user_tc_bad",
    "timestamp":         "2026-04-14T10:10:00Z",
    "input_type":        "image",
    "text":              null,
    "audio_url":         null,
    "image_url":         "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png",
    "image_caption":     null,
    "raw_payload":       {},
    "metadata":          { "wa_profile_name": "Test Low Confidence" }
  }'
```

This is a transparency test image — no product. Claude should return `image_quality: "unusable"`.

**Expected:**
- Node I2: `vision_result.image_quality = "unusable"`, `product_candidates = []`
- Node I3: routes NO
- Node I3a: `catalog_search_result = []`
- Node I5: `image_combined_confidence = 0`, `needs_clarification = true`, `analysis.intent.product_candidates = []`
- Node I6: routes NO (no product found)
- `reply_text` asks the client to describe what they need or send a clearer photo — uses `clarification_suggestion` from vision analysis
- No product_image_url in echo body

---

## Failure handling reference

| Failure condition | How it manifests | Where handled | Result |
|-------------------|-----------------|---------------|--------|
| `image_url` is null or empty | Claude Vision call fails (400 or model error) | Node I1 On Error: Continue → Node I2 handles empty `content` | `vision_result` parse error fallback: unusable image → clarification reply |
| `image_url` is not publicly accessible (403/404) | Claude Vision returns error or refuses | Node I1 On Error: Continue → Node I2 receives non-JSON | Same fallback as above |
| `image_quality: 'unusable'` | No product candidates | Node I3 routes NO → Node I3a → I5 | `image_combined_confidence = 0` → clarification reply |
| `product_candidates: []` after vision | Claude found no recognisable product | Node I3 routes NO (same as unusable) | Clarification reply using `visionResult.clarification_suggestion` |
| RPC `search_product_by_text` returns no results | Product described but not in catalog | Node I5: `topCatalog = undefined`, `catalogConf = 0` | Combined confidence = vision conf × 0.6 only — likely below 0.70 → clarification reply |
| Combined confidence 0.55–0.69 | Partial match, not confident enough to confirm | Node I5: `missing_fields: ['product']`, `recommended_phase: 'warm_intake'` | Reply asks for more detail or different photo — does NOT show product image |
| Combined confidence < 0.55 | Unclear image, bad match | Node I5: `needs_clarification: true` | Reply uses `clarification_suggestion` from image_analysis.txt |
| Combined confidence ≥ 0.70 | Good match | Node I6 routes YES → fetch product image | Reply shows catalog photo, asks client to confirm |
| Product image not in DB (PI1 returns `[]`) | `product_images` row missing for this product | Node PI2: `imageUrl = null` | `product_image_url = null`, `attach_image = false` in context — reply confirms product without image |
| Claude Vision parse error (`_parse_error: true`) | Malformed JSON from model | Node I2 fallback object | Unusable path → clarification reply — never crashes the workflow |

---

## Supabase checks after TC-006

```sql
-- Conversation state should have identified_product_id set
SELECT
  conversation_id,
  phase,
  identified_product_id,
  product_confidence,
  turn_count
FROM conversation_state
ORDER BY updated_at DESC LIMIT 1;

-- Inbound message should have ai_analysis with vision data
SELECT
  direction,
  input_type,
  LEFT(text_content, 60)            AS preview,
  ai_analysis->>'image_quality'     AS image_quality,
  ai_analysis->'intent'->>'primary_intent' AS intent
FROM messages
ORDER BY sent_at DESC LIMIT 4;
```

If `identified_product_id` is null after TC-006: the RPC search returned no results. Run this directly to confirm the function works:

```sql
SELECT * FROM search_product_by_text(
  'a0000000-0000-0000-0000-000000000001',
  'stainless steel vacuum insulated water bottle 500ml'
);
```

If this returns rows but Node I4 did not, check that the vision description was specific enough (inspect `vision_top_description` in the webhook.site echo body) and that Node I4's body has the correct `p_query` value.
