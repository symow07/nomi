#!/usr/bin/env node
/**
 * Generates importable n8n workflow JSON for YiwuFlow from the node specs in
 * docs/n8n-workflow.md. Run: node tools/build-workflows.mjs
 *
 * Output: n8n/*.json — import each into n8n, then set the Execute Workflow
 * node IDs (see n8n/README.md).
 *
 * Prompt files are inlined at build time so the workflows are self-contained.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const prompt = (f) => readFileSync(join(ROOT, 'prompts', f), 'utf8').trim();

const ANALYSIS_PROMPT = prompt('analysis.txt');
const RESPONSE_PROMPT = prompt('response.txt');
const IMAGE_PROMPT = prompt('image_analysis.txt');
const VALIDATION_PROMPT = prompt('order_validation.txt');

const MODEL = 'claude-sonnet-4-6';

// ---------------------------------------------------------------- builder ---

let seq = 0;
const nid = () => `yf-${(++seq).toString(36).padStart(4, '0')}`;

class WF {
  constructor(name) {
    this.name = name;
    this.nodes = [];
    this.connections = {};
    this.col = 0;
  }
  add(node, { row = 0, col = null } = {}) {
    const c = col ?? this.col++;
    this.nodes.push({
      id: nid(),
      position: [260 + c * 220, 300 + row * 190],
      typeVersion: 1,
      ...node,
    });
    return node.name;
  }
  /** connect(from, to) or connect(from, to, outputIndex) */
  link(from, to, out = 0) {
    const c = (this.connections[from] ??= { main: [] });
    while (c.main.length <= out) c.main.push([]);
    c.main[out].push({ node: to, type: 'main', index: 0 });
    return to;
  }
  /** link a straight chain */
  chain(...names) {
    for (let i = 0; i < names.length - 1; i++) this.link(names[i], names[i + 1]);
    return names[names.length - 1];
  }
  json() {
    return {
      name: this.name,
      nodes: this.nodes,
      connections: this.connections,
      settings: { executionOrder: 'v1' },
      pinData: {},
    };
  }
}

// ------------------------------------------------------------ node helpers ---

const code = (name, js) => ({
  name,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  parameters: { mode: 'runOnceForAllItems', jsCode: js.trim() },
});

const noop = (name) => ({ name, type: 'n8n-nodes-base.noOp', typeVersion: 1, parameters: {} });

/** IF node driven by a boolean expression — loose validation keeps it forgiving. */
const ifBool = (name, expr) => ({
  name,
  type: 'n8n-nodes-base.if',
  typeVersion: 2,
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [
        {
          id: nid(),
          leftValue: `={{ ${expr} }}`,
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    looseTypeValidation: true,
    options: {},
  },
});

/**
 * Reads use the SERVICE key, not the anon key.
 *
 * supabase/rls_policies.sql enables RLS with no policies for `anon`, so the anon
 * key returns zero rows for every table. That is deliberate: n8n is a trusted
 * server-side caller (there is no browser client), so the anon key buys no
 * security and a leaked one should do nothing at all. `service_role` has
 * BYPASSRLS, so these reads keep working.
 */
const SB_ANON = [
  { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
  { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
];
const SB_SERVICE = [
  { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
  { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
  { name: 'Content-Type', value: 'application/json' },
];
const SB_SERVICE_REPR = [...SB_SERVICE, { name: 'Prefer', value: 'return=representation' }];

/**
 * fullResponse:true is REQUIRED on every Supabase call.
 * PostgREST returns a JSON array; n8n splits arrays into items, so an empty
 * result ([]) yields ZERO items and execution silently halts. fullResponse
 * keeps it as a single item — read the array from $json.body.
 */
const http = (name, { method, url, headers, body = null }) => ({
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  parameters: {
    method,
    url,
    sendHeaders: true,
    headerParameters: { parameters: headers },
    ...(body
      ? { sendBody: true, specifyBody: 'json', jsonBody: body }
      : { sendBody: false }),
    options: { response: { response: { fullResponse: true } } },
  },
});

/** Anthropic call. Body is built by the preceding Code node into $json._anthropic. */
const claude = (name) => ({
  name,
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  parameters: {
    method: 'POST',
    url: 'https://api.anthropic.com/v1/messages',
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: 'x-api-key', value: '={{ $env.ANTHROPIC_API_KEY }}' },
        { name: 'anthropic-version', value: '2023-06-01' },
        { name: 'content-type', value: 'application/json' },
      ],
    },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json._anthropic) }}',
    options: { timeout: 60000 },
  },
});

const subTrigger = (name = 'When Called by Parent') => ({
  name,
  type: 'n8n-nodes-base.executeWorkflowTrigger',
  typeVersion: 1,
  parameters: {},
});

/** Execute Workflow. workflowId must be set after import — see n8n/README.md. */
const callWF = (name, target) => ({
  name,
  type: 'n8n-nodes-base.executeWorkflow',
  typeVersion: 1.2,
  parameters: {
    workflowId: { __rl: true, mode: 'list', value: '', cachedResultName: target },
    options: { waitForSubWorkflow: false },
  },
  notes: `Set this to the "${target}" workflow after import.`,
});

/** Shared JS prelude: read a Supabase fullResponse array safely. */
const ROWS = `const rows = (x) => Array.isArray(x?.body) ? x.body : (Array.isArray(x) ? x : []);`;

// ============================================================ 1. INTAKE ======

function intake() {
  const w = new WF('YiwuFlow - Intake');

  w.add({
    name: 'Webhook - Simulated Intake',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    webhookId: 'yiwuflow-simulate',
    parameters: {
      httpMethod: 'POST',
      path: 'simulate',
      // Respond 200 immediately; the reply is delivered via MOCK_CALLBACK_URL.
      responseMode: 'onReceived',
      authentication: 'headerAuth',
      options: {},
    },
    notes: 'Create a Header Auth credential: name=x-webhook-secret, value=test_secret_xyz',
  });

  w.add(code('Normalize Payload', `
const b = $json.body ?? $json;
if (!b.message_id) b.message_id = \`msg_\${Date.now()}_sim\`;
if (!b.business_id) b.business_id = $env.BUSINESS_ID;
return [{ json: b }];
`));

  w.add(http('Supabase - Dedup Check', {
    method: 'GET',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/messages?external_id=eq.{{ $json.external_id }}&select=id&limit=1',
    headers: SB_ANON,
  }));

  w.add(code('Dedup Result', `
${ROWS}
const original = $('Normalize Payload').first().json;
return [{ json: { ...original, is_duplicate: rows($json).length > 0 } }];
`));

  w.add(ifBool('Is Duplicate?', '$json.is_duplicate'));
  w.add(noop('Drop Duplicate'), { row: -1 });

  w.add(http('Supabase - Client Lookup', {
    method: 'GET',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/client_channels?channel=eq.{{ $json.channel }}&channel_user_id=eq.{{ $json.client_channel_id }}&select=client_id&limit=1',
    headers: SB_ANON,
  }), { row: 1 });

  w.add(code('Client Lookup Result', `
${ROWS}
const original = $('Dedup Result').first().json;
const hit = rows($json)[0];
return [{ json: { ...original, existing_client_id: hit?.client_id ?? null } }];
`), { row: 1 });

  w.add(ifBool('New Client?', '$json.existing_client_id === null'), { row: 1 });

  // --- TRUE branch: create client -> channel -> conversation -> state
  w.add(code('Build Client Body', `
return [{ json: { ...$json, _body: {
  business_id:  $json.business_id,
  display_name: $json.metadata?.wa_profile_name || 'Unknown',
  last_seen_at: $json.timestamp || new Date().toISOString()
} } }];
`), { row: 0 });

  w.add(http('Supabase - Create Client', {
    method: 'POST',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/clients',
    headers: SB_SERVICE_REPR,
    body: '={{ JSON.stringify($json._body) }}',
  }), { row: 0 });

  w.add(code('Build Channel Body', `
${ROWS}
const original = $('Build Client Body').first().json;
const client_id = rows($json)[0]?.id;
if (!client_id) throw new Error('Create Client returned no row — check SUPABASE_SERVICE_KEY and RLS policies.');
return [{ json: { ...original, client_id, _body: {
  client_id,
  channel:         original.channel,
  channel_user_id: original.client_channel_id
} } }];
`), { row: 0 });

  w.add(http('Supabase - Create Client Channel', {
    method: 'POST',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/client_channels',
    headers: SB_SERVICE,
    body: '={{ JSON.stringify($json._body) }}',
  }), { row: 0 });

  // Two paths converge here: a brand-new client, and a returning client whose last
  // conversation was closed (e.g. by a completed order). Both need a fresh
  // conversation, so both feed this node — it reads client_id off $json rather
  // than referencing one specific upstream node.
  w.add(code('Resolve New Client', `
const o = { ...$('Build Channel Body').first().json };
delete o._body;
return [{ json: o }];
`), { row: 0 });

  w.add(code('Resolve Returning Client', `
// Known client, but no active conversation — their previous one was closed.
// Start a new conversation rather than throwing.
const o = $('Client Lookup Result').first().json;
return [{ json: { ...o, client_id: o.existing_client_id, is_returning_client: true } }];
`), { row: 3 });

  w.add(code('Build Conversation Body', `
const o = $json;
if (!o.client_id) throw new Error('Build Conversation Body reached with no client_id.');
return [{ json: { ...o, _body: {
  business_id: o.business_id,
  client_id:   o.client_id,
  channel:     o.channel,
  phase:       'warm_intake'
} } }];
`), { row: 0 });

  w.add(http('Supabase - Create Conversation', {
    method: 'POST',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/conversations',
    headers: SB_SERVICE_REPR,
    body: '={{ JSON.stringify($json._body) }}',
  }), { row: 0 });

  w.add(code('Build Conv State Body', `
${ROWS}
const original = $('Build Conversation Body').first().json;
const conversation_id = rows($json)[0]?.id;
if (!conversation_id) throw new Error('Create Conversation returned no row.');
return [{ json: { ...original, conversation_id, _body: {
  conversation_id, phase: 'warm_intake', turn_count: 0
} } }];
`), { row: 0 });

  w.add(http('Supabase - Create Conv State', {
    method: 'POST',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/conversation_state',
    headers: SB_SERVICE,
    body: '={{ JSON.stringify($json._body) }}',
  }), { row: 0 });

  // Synthesize the same shape active_conversations_summary would return.
  w.add(code('New Conversation Context', `
const o = $('Build Conv State Body').first().json;
return [{ json: {
  ...o,
  is_new_client: !o.is_returning_client,
  phase: 'warm_intake',
  conversation_state: {
    conversation_id: o.conversation_id,
    client_id:       o.client_id,
    business_id:     o.business_id,
    channel:         o.channel,
    phase:           'warm_intake',
    client_name:     o.metadata?.wa_profile_name || null,
    client_email:    null,
    preferred_language: null,
    identified_product_id: null,
    product_confidence: 0,
    product_confirmed_by_client: false,
    inquiry_quantity: null,
    inquiry_unit: null,
    client_email_collected: false,
    escalation_score: 0,
    pending_question: null,
    turn_count: 0
  }
} }];
`), { row: 0 });

  // --- FALSE branch: load existing conversation
  w.add(http('Supabase - Load Active Conv', {
    method: 'GET',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/active_conversations_summary?client_id=eq.{{ $json.existing_client_id }}&limit=1',
    headers: SB_ANON,
  }), { row: 2, col: 8 });

  // A known client may legitimately have NO active conversation — Confirmation
  // sets is_active = false when an order closes. The original code threw here,
  // which meant the first customer to ever complete an order could never message
  // again. Route them into a fresh conversation instead.
  w.add(code('Active Conv Result', `
${ROWS}
const o = $('Client Lookup Result').first().json;
const state = rows($json)[0] || null;
return [{ json: { ...o, active_conv: state, has_active_conv: state !== null } }];
`), { row: 2, col: 9 });

  w.add(ifBool('Has Active Conversation?', '$json.has_active_conv === true'), { row: 2, col: 10 });

  w.add(code('Existing Client Context', `
const o = $json;
const state = o.active_conv;
return [{ json: {
  ...o,
  is_new_client: false,
  client_id: state.client_id,
  conversation_id: state.conversation_id,
  phase: state.phase || 'warm_intake',
  conversation_state: state
} }];
`), { row: 2, col: 11 });

  w.add({
    name: 'Merge Client Branches',
    type: 'n8n-nodes-base.merge',
    typeVersion: 3,
    parameters: { mode: 'append', numberInputs: 2 },
  }, { row: 1, col: 16 });

  w.add(callWF('→ Multimodal Analysis', 'YiwuFlow - Multimodal Analysis'), { row: 1, col: 17 });

  // SHADOW MIRROR (ADR-0009). Fire-and-forget copy of every enriched turn to the
  // TypeScript service, which computes what it WOULD have done and records it in
  // shadow.turn_decisions. neverError + short timeout: if the service is down,
  // the live path neither knows nor cares. Parallel branch — never blocks.
  w.add({
    name: 'Shadow Mirror',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    parameters: {
      method: 'POST',
      url: '={{ $env.SHADOW_SERVICE_URL }}/shadow/turn',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody:
        '={{ JSON.stringify({ message_id: $json.external_id || $json.message_id, business_id: $json.business_id, conversation_id: $json.conversation_id, text: $json.text || "" }) }}',
      options: {
        timeout: 4000,
        response: { response: { fullResponse: true, neverError: true } },
      },
    },
    notes: 'Requires env var SHADOW_SERVICE_URL. Safe to leave failing — the live path ignores it.',
  }, { row: 2, col: 17 });

  // wiring
  w.chain('Webhook - Simulated Intake', 'Normalize Payload', 'Supabase - Dedup Check', 'Dedup Result', 'Is Duplicate?');
  w.link('Is Duplicate?', 'Drop Duplicate', 0);            // true  = duplicate
  w.link('Is Duplicate?', 'Supabase - Client Lookup', 1);  // false = proceed
  w.chain('Supabase - Client Lookup', 'Client Lookup Result', 'New Client?');
  w.link('New Client?', 'Build Client Body', 0);           // true  = new client
  w.link('New Client?', 'Supabase - Load Active Conv', 1); // false = known client

  // New client: create client + channel, then fall through to conversation setup.
  w.chain('Build Client Body', 'Supabase - Create Client', 'Build Channel Body',
    'Supabase - Create Client Channel', 'Resolve New Client', 'Build Conversation Body');

  // Known client: use the active conversation, or start a fresh one if it closed.
  w.chain('Supabase - Load Active Conv', 'Active Conv Result', 'Has Active Conversation?');
  w.link('Has Active Conversation?', 'Existing Client Context', 0);
  w.link('Has Active Conversation?', 'Resolve Returning Client', 1);
  w.link('Resolve Returning Client', 'Build Conversation Body');

  // Shared conversation-creation tail (new client AND returning client).
  w.chain('Build Conversation Body', 'Supabase - Create Conversation',
    'Build Conv State Body', 'Supabase - Create Conv State', 'New Conversation Context');

  w.link('New Conversation Context', 'Merge Client Branches', 0);
  w.link('Existing Client Context', 'Merge Client Branches', 0);
  w.link('Merge Client Branches', '→ Multimodal Analysis');
  w.link('Merge Client Branches', 'Shadow Mirror'); // parallel, non-blocking

  // Merge inputs are addressed by the connection's index field.
  w.connections['New Conversation Context'].main[0][0].index = 0;
  w.connections['Existing Client Context'].main[0][0].index = 1;

  return w;
}

// ====================================================== 2. MULTIMODAL =======

function multimodal() {
  const w = new WF('YiwuFlow - Multimodal Analysis');

  w.add(subTrigger());

  w.add(code('Injection Check', `
const text = ($json.text || '').toLowerCase();
// NOTE: the qualifier group is *repeating* (\`*\`), not optional-single (\`?\`).
// The original spec used /ignore (all |previous |your |the )?instructions/, which
// does NOT match "ignore all previous instructions" — two qualifiers, not one —
// i.e. the single most common injection string bypassed the filter entirely.
const QUAL = '(?:all\\\\s+|previous\\\\s+|prior\\\\s+|the\\\\s+|your\\\\s+|above\\\\s+|earlier\\\\s+)*';
const patterns = [
  new RegExp('ignore\\\\s+' + QUAL + '(?:instructions|prompts?|rules|context)'),
  new RegExp('disregard\\\\s+' + QUAL + '(?:instructions|prompts?|rules|everything|context)'),
  new RegExp('forget\\\\s+' + QUAL + '(?:instructions|prompts?|rules|everything)'),
  /you are now/,
  /act as (?:a |an )?(?:different|new|unrestricted)/,
  /pretend (?:you are|to be)/,
  /jailbreak/,
  /system prompt/,
  /reveal your (?:instructions|prompt|rules)/
];
if (patterns.some(p => p.test(text))) {
  return [{ json: { ...$json,
    skip_ai: true,
    injection_detected: true,
    safe_fallback_reply: "Thanks for your message — what products are you looking to source today?"
  } }];
}
return [{ json: { ...$json, skip_ai: false } }];
`));

  w.add(ifBool('Skip AI?', '$json.skip_ai === true'));

  w.add({
    name: 'Route by Input Type',
    type: 'n8n-nodes-base.switch',
    typeVersion: 3,
    parameters: {
      rules: {
        values: [
          { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, conditions: [{ id: nid(), leftValue: '={{ $json.input_type }}', rightValue: 'text', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, outputKey: 'text' },
          { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, conditions: [{ id: nid(), leftValue: '={{ $json.input_type }}', rightValue: 'image', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, outputKey: 'image' },
          { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, conditions: [{ id: nid(), leftValue: '={{ $json.input_type }}', rightValue: 'image_text', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, outputKey: 'image_text' },
          { conditions: { options: { caseSensitive: true, typeValidation: 'loose', version: 2 }, conditions: [{ id: nid(), leftValue: '={{ $json.input_type }}', rightValue: 'voice', operator: { type: 'string', operation: 'equals' } }], combinator: 'and' }, outputKey: 'voice' },
        ],
      },
      options: { fallbackOutput: 0, renameFallbackOutput: 'text' },
    },
  }, { row: 1 });

  w.add(code('Voice - Deferred Placeholder', `
return [{ json: { ...$json,
  skip_ai: true,
  voice_deferred: true,
  safe_fallback_reply: $json.conversation_state?.preferred_language === 'ar'
    ? 'شكراً لرسالتك الصوتية. هل يمكنك كتابة رسالتك؟ سيساعدني ذلك على مساعدتك بشكل أفضل.'
    : 'Thanks for your voice message. Could you type out your question? That will help me assist you better.'
} }];
`), { row: -1 });

  // ---- text: fast path
  w.add(code('Fast Path - Yes/No Detection', `
const text = ($json.text || '').toLowerCase().trim();
const pending = $json.conversation_state?.pending_question;
const YES = ['yes','yeah','yep','correct','right','exactly','sure','ok','okay','confirm','confirmed','agreed','نعم','صح','是','对','好','sí','oui','да'];
const NO  = ['no','nope','not','wrong','incorrect','different','other','لا','不是','non','нет'];

if (pending === 'product_confirmation') {
  if (YES.includes(text)) return [{ json: { ...$json, fast_path: true, fast_path_type: 'product_confirmed_yes' } }];
  if (NO.includes(text))  return [{ json: { ...$json, fast_path: true, fast_path_type: 'product_confirmed_no' } }];
}
if (pending === 'order_confirmation' && YES.includes(text)) {
  return [{ json: { ...$json, fast_path: true, fast_path_type: 'order_confirm_yes' } }];
}
return [{ json: { ...$json, fast_path: false } }];
`), { row: 1 });

  w.add(ifBool('Is Fast Path?', '$json.fast_path === true'), { row: 1 });

  w.add(code('Handle Fast Path Response', `
const type = $json.fast_path_type;
const state = $json.conversation_state || {};
const lang = state.preferred_language || 'en';

const replies = {
  product_confirmed_yes: {
    en: "Great — glad we're on the same page. Now, roughly how many pieces are you looking at?",
    ar: 'ممتاز، نعم هذا هو المنتج. كم قطعة تقريباً تحتاج؟',
    zh: '好的，就是这个产品。您大概需要多少件？',
    es: 'Perfecto. ¿Aproximadamente cuántas piezas necesitas?'
  },
  product_confirmed_no: {
    en: "No problem — could you describe what you're looking for in more detail, or send another photo?",
    ar: 'لا مشكلة، هل يمكنك وصف المنتج بشكل أدق أو إرسال صورة أخرى؟',
    zh: '没关系，能再描述一下您需要的产品，或者发一张其他的图片吗？',
    es: 'Sin problema — ¿puedes describir lo que buscas con más detalle o enviar otra foto?'
  },
  order_confirm_yes: {
    en: "Perfect — I'll get your confirmation sent right away.",
    ar: 'ممتاز، سأرسل لك تأكيد الطلب فوراً.',
    zh: '好的，我马上发送确认信息给您。',
    es: 'Perfecto — te envío la confirmación ahora mismo.'
  }
};
const map = replies[type] || {};
const reply = map[lang] || map.en || 'Got it — thank you.';

// The question we asked has now been answered — clear it, or the fast path would
// keep re-firing on the next message.
const state_updates = { pending_question: null };
if (type === 'product_confirmed_yes') { state_updates.product_confirmed_by_client = true; state_updates.phase = 'qualification'; }
if (type === 'product_confirmed_no')  { state_updates.product_confirmed_by_client = false; state_updates.identified_product_id = null; }
if (type === 'order_confirm_yes')     { state_updates.phase = 'confirmation'; }

return [{ json: { ...$json,
  analysis_complete: true,
  reply_text: reply,
  attach_product_image: false,
  state_updates,
  phase_action: type === 'order_confirm_yes' ? 'confirm_order' : 'advance',
  skip_response_generation: true
} }];
`), { row: 0 });

  // ---- text pipeline
  w.add(http('Supabase - Load Product Catalog', {
    method: 'GET',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/products?business_id=eq.{{ $json.business_id }}&is_active=eq.true&select=id,sku,name,name_zh,category,moq,price_usd_per_unit,customizable',
    headers: SB_ANON,
  }), { row: 2 });

  w.add(code('Attach Catalog', `
${ROWS}
const original = $('Route by Input Type').first().json;
return [{ json: { ...original, ...$('Fast Path - Yes/No Detection').first().json, product_catalog: rows($json) } }];
`), { row: 2 });

  w.add(http('Supabase - Load Recent Messages', {
    method: 'GET',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/messages?conversation_id=eq.{{ $json.conversation_id }}&order=sent_at.desc&limit=6&select=direction,text_content,input_type,sent_at',
    headers: SB_ANON,
  }), { row: 2 });

  w.add(code('Build Analysis Prompt', `
${ROWS}
const o = $('Attach Catalog').first().json;
const recent = rows($json);

const catalog = (o.product_catalog || []).map(p =>
  \`\${p.id}|\${p.sku}|\${p.name}|\${p.category}|MOQ:\${p.moq}|USD:\${p.price_usd_per_unit}\`
).join('\\n');

const history = recent.slice().reverse().map(m =>
  \`[\${m.direction === 'inbound' ? 'CLIENT' : 'US'}] \${m.text_content || '[media]'}\`
).join('\\n');

const user = \`PRODUCT CATALOG:\\n\${catalog}\\n\\nCONVERSATION HISTORY:\\n\${history}\\n\\nCLIENT MESSAGE:\\n\${o.text || '[no text]'}\\n\\nCURRENT PHASE: \${o.phase}\\nCURRENT STATE: \${JSON.stringify(o.conversation_state)}\`;

return [{ json: { ...o, recent_messages: recent, _anthropic: {
  model: ${JSON.stringify(MODEL)},
  max_tokens: 1200,
  temperature: 0.2,
  system: ${JSON.stringify(ANALYSIS_PROMPT)},
  messages: [{ role: 'user', content: user }]
} } }];
`), { row: 2 });

  w.add(claude('Claude - Full Analysis'), { row: 2 });

  w.add(code('Parse Analysis JSON', `
const o = $('Build Analysis Prompt').first().json;
let raw = $json.content?.[0]?.text || '';
raw = raw.replace(/\`\`\`json\\n?/g, '').replace(/\`\`\`\\n?/g, '').trim();
try {
  return [{ json: { ...o, analysis: JSON.parse(raw), analysis_complete: true } }];
} catch (e) {
  return [{ json: { ...o, analysis_complete: true, analysis_parse_error: true, analysis: {
    language: { detected: 'en', confidence: 0.5, reply_in: 'en' },
    intent: { primary_intent: 'inquiry', product_candidates: [], missing_fields: ['product'] },
    phase: { recommended_phase: o.phase, can_advance: false, escalation_recommended: false }
  } } }];
}
`), { row: 2 });

  // ---- image pipeline
  w.add(code('Build Vision Request', `
return [{ json: { ...$json, _anthropic: {
  model: ${JSON.stringify(MODEL)},
  max_tokens: 600,
  temperature: 0.2,
  system: ${JSON.stringify(IMAGE_PROMPT)},
  messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'url', url: $json.image_url } },
    { type: 'text', text: 'PRODUCT CATALOG CATEGORIES: packaging, lighting, storage, drinkware, kitchenware, stationery, accessories, electronics, textiles\\n\\nAnalyze this image and return the JSON.' }
  ] }]
} } }];
`), { row: 4 });

  w.add(claude('Claude - Image Analysis'), { row: 4 });

  w.add(code('Extract Vision Response', `
const o = $('Build Vision Request').first().json;
let raw = $json.content?.[0]?.text || '{}';
raw = raw.replace(/\`\`\`json\\n?/g, '').replace(/\`\`\`\\n?/g, '').trim();

let vision;
try { vision = JSON.parse(raw); }
catch (e) { vision = { product_candidates: [], image_quality: 'unusable', needs_more_info: true }; }

const top = vision.product_candidates?.[0];
if (!top || vision.image_quality === 'unusable') {
  return [{ json: { ...o, image_analysis: vision, image_confidence: 0, needs_clarification: true, has_vision_candidate: false } }];
}
return [{ json: { ...o,
  image_analysis: vision,
  vision_search_query: top.description,
  image_confidence: top.confidence,
  has_vision_candidate: true
} }];
`), { row: 4 });

  w.add(ifBool('Has Vision Candidate?', '$json.has_vision_candidate === true'), { row: 4 });

  w.add(http('Supabase - Vision Alias Search', {
    method: 'POST',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/rpc/search_product_by_text',
    headers: [...SB_ANON, { name: 'Content-Type', value: 'application/json' }],
    body: '={{ JSON.stringify({ p_business_id: $json.business_id, p_query: $json.vision_search_query }) }}',
  }), { row: 3 });

  w.add(code('Attach Vision Matches', `
${ROWS}
const o = $('Extract Vision Response').first().json;
return [{ json: { ...o, catalog_search_result: rows($json) } }];
`), { row: 3 });

  w.add(code('No Vision Matches', `
return [{ json: { ...$json, catalog_search_result: [] } }];
`), { row: 5 });

  // NOTE: the spec's Node 2.13 referenced `visionResult` here, which is out of
  // scope in this node and throws a ReferenceError. Read it from $json instead.
  w.add(code('Build Image Analysis', `
const vision = $json.image_analysis || {};
const match  = $json.catalog_search_result?.[0];
const visionConf  = $json.image_confidence || 0;
const catalogConf = match?.similarity || 0;
const combined = (visionConf * 0.6) + (catalogConf * 0.4);

return [{ json: { ...$json,
  image_combined_confidence: combined,
  analysis_complete: true,
  analysis: {
    language: {
      detected: 'unknown',
      confidence: 0.5,
      reply_in: $json.conversation_state?.preferred_language || 'en'
    },
    intent: {
      primary_intent: 'product_search',
      product_candidates: match ? [{
        product_id:   match.product_id,
        product_name: match.product_name,
        confidence:   combined,
        match_method: 'image_vision'
      }] : [],
      quantity_mentioned: null,
      customization_requested: false,
      missing_fields: combined < 0.70 ? ['product'] : [],
      next_logical_question: vision.clarification_suggestion || null
    },
    phase: {
      recommended_phase: combined >= 0.70 ? 'clarification' : 'warm_intake',
      can_advance: combined >= 0.70,
      escalation_recommended: false
    }
  }
} }];
`), { row: 4 });

  // image_text: after vision, also run the text pipeline, then merge
  w.add(ifBool('Also Has Text?', "$json.input_type === 'image_text'"), { row: 4 });

  w.add(code('Merge Image + Text Analysis', `
const o = $json;
// Only image_text reaches here with image_analysis present.
if (!o.image_analysis) return [{ json: o }];

const imageCand = $('Build Image Analysis').first().json;
const imgConf  = imageCand.image_combined_confidence || 0;
const textConf = o.analysis?.intent?.product_candidates?.[0]?.confidence || 0;

return [{ json: { ...o, analysis: {
  language: o.analysis.language,
  intent: {
    ...o.analysis.intent,
    product_candidates: imgConf > textConf
      ? imageCand.analysis.intent.product_candidates
      : o.analysis.intent.product_candidates
  },
  phase: o.analysis.phase
} } }];
`), { row: 2 });

  w.add(callWF('→ Conversation + Decision', 'YiwuFlow - Conversation + Decision'), { row: 1 });

  // wiring
  w.chain('When Called by Parent', 'Injection Check', 'Skip AI?');
  w.link('Skip AI?', '→ Conversation + Decision', 0);  // true  = injection, skip
  w.link('Skip AI?', 'Route by Input Type', 1);        // false = analyse

  w.link('Route by Input Type', 'Fast Path - Yes/No Detection', 0);  // text
  w.link('Route by Input Type', 'Build Vision Request', 1);          // image
  w.link('Route by Input Type', 'Build Vision Request', 2);          // image_text
  w.link('Route by Input Type', 'Voice - Deferred Placeholder', 3);  // voice
  w.link('Voice - Deferred Placeholder', '→ Conversation + Decision');

  w.link('Fast Path - Yes/No Detection', 'Is Fast Path?');
  w.link('Is Fast Path?', 'Handle Fast Path Response', 0);
  w.link('Is Fast Path?', 'Supabase - Load Product Catalog', 1);
  w.link('Handle Fast Path Response', '→ Conversation + Decision');

  w.chain('Supabase - Load Product Catalog', 'Attach Catalog', 'Supabase - Load Recent Messages',
    'Build Analysis Prompt', 'Claude - Full Analysis', 'Parse Analysis JSON',
    'Merge Image + Text Analysis', '→ Conversation + Decision');

  w.chain('Build Vision Request', 'Claude - Image Analysis', 'Extract Vision Response', 'Has Vision Candidate?');
  w.link('Has Vision Candidate?', 'Supabase - Vision Alias Search', 0);
  w.link('Has Vision Candidate?', 'No Vision Matches', 1);
  w.chain('Supabase - Vision Alias Search', 'Attach Vision Matches', 'Build Image Analysis');
  w.link('No Vision Matches', 'Build Image Analysis');
  w.link('Build Image Analysis', 'Also Has Text?');
  w.link('Also Has Text?', 'Supabase - Load Product Catalog', 0); // image_text -> run text too
  w.link('Also Has Text?', '→ Conversation + Decision', 1);       // image only -> done

  return w;
}

// ==================================================== 3. CONVERSATION =======

function conversation() {
  const w = new WF('YiwuFlow - Conversation + Decision');

  w.add(subTrigger());

  w.add(ifBool('Skip to Dispatch?',
    "($json.skip_ai === true || $json.skip_response_generation === true) && $json.phase_action !== 'confirm_order'"));

  w.add(code('Prepare Skip Path', `
const s = $json.conversation_state || {};
return [{ json: { ...$json,
  reply_text: $json.reply_text || $json.safe_fallback_reply || 'Thanks for your message.',
  recommended_phase: $json.state_updates?.phase || $json.phase || 'warm_intake',
  escalation_score: $json.escalation_score ?? s.escalation_score ?? 0,
  final_attach_image: false,
  product_image_url: null,
  state_updates: {
    ...($json.state_updates || {}),
    turn_count: (s.turn_count || 0) + 1,
    last_message_at: new Date().toISOString()
  }
} }];
`), { row: -1 });

  // M0: nothing in the original design ever captured an email address, so
  // order_validation rule 7 (client_email present) could never pass and no order
  // could ever be confirmed. Extract it deterministically — a regex is free,
  // reliable, and cannot hallucinate an address the client never gave us.
  w.add(code('Extract Contact Details', `
const text = $json.text || '';
const m = text.match(/[a-z0-9._%+\\-]+@[a-z0-9.\\-]+\\.[a-z]{2,}/i);
const state = $json.conversation_state || {};

return [{ json: { ...$json,
  extracted_email: m ? m[0].toLowerCase() : null,
  client_email: m ? m[0].toLowerCase() : (state.client_email || null)
} }];
`), { row: 1 });

  w.add(code('Escalation Score Calculator', `
const state    = $json.conversation_state || {};
const analysis = $json.analysis || {};
const text     = ($json.text || '').toLowerCase();
let score      = state.escalation_score || 0;
const flags    = [];

const totalValueEst = (state.inquiry_quantity || 0) * (state.product_price_usd || 2);
if (totalValueEst > 10000)     { score += 60; flags.push('high_value'); }
else if (totalValueEst > 3000) { score += 40; flags.push('high_value'); }

if (analysis.intent?.customization_requested) { score += 30; flags.push('customization'); }

const humanPhrases = ['speak to someone','real person','call me','human','manager','speak to a person','التحدث مع شخص','اريد احد','找人工','找真人'];
if (humanPhrases.some(p => text.includes(p))) { score = 100; flags.push('client_request'); }

const logisticsPhrases = ['letter of credit','lc at sight','ddp','ddu','incoterms','customs clearance','lcl','fcl','freight'];
if (logisticsPhrases.some(p => text.includes(p))) { score += 25; flags.push('logistics_payment'); }

if (analysis.intent?.primary_intent === 'complaint') { score += 40; flags.push('complex_negotiation'); }

const top = analysis.intent?.product_candidates?.[0];
if (!top && (state.turn_count || 0) >= 2) { score += 35; flags.push('repeated_ambiguity'); }

return [{ json: { ...$json, escalation_score: Math.min(score, 100), escalation_flags: flags } }];
`), { row: 1 });

  w.add(ifBool('Immediate Escalate?', '$json.escalation_score >= 100'), { row: 1 });
  w.add(callWF('→ Escalation', 'YiwuFlow - Escalation'), { row: 0 });

  w.add(code('Phase Advance Decision', `
const state    = $json.conversation_state || {};
const analysis = $json.analysis || {};
const current  = state.phase || 'warm_intake';
const top      = analysis.intent?.product_candidates?.[0];
const order    = ['warm_intake','clarification','qualification','commercial_discussion','confirmation','escalated','closed'];

let recommended = analysis.phase?.recommended_phase || current;
if (order.indexOf(recommended) < order.indexOf(current)) recommended = current;

let attach_image = false;
if (top && !state.product_confirmed_by_client && top.confidence >= 0.70 && top.confidence < 0.90) {
  attach_image = true;
}

const state_updates = {
  phase: recommended,
  escalation_score: $json.escalation_score,
  turn_count: (state.turn_count || 0) + 1,
  last_message_at: new Date().toISOString()
};
if (top) {
  state_updates.identified_product_id = top.product_id;
  state_updates.product_confidence    = top.confidence;
}
if (analysis.intent?.quantity_mentioned) {
  state_updates.inquiry_quantity = analysis.intent.quantity_mentioned;
  state_updates.inquiry_unit     = analysis.intent.quantity_unit || 'pcs';
}

// --- M0: write the state the close actually depends on -----------------------
// Previously none of these three were ever written, so order_validation rules 2
// and 7 could never pass and safe_to_confirm was permanently false.

// (a) product_confirmed_by_client. Once true it stays true. Set it when the
//     client says yes (fast path), when the model reports an explicit
//     confirmation, or on a >=0.90 match — the spec's own auto-accept threshold.
let confirmed = state.product_confirmed_by_client === true;
if (!confirmed && analysis.intent?.product_confirmed === true) confirmed = true;
if (!confirmed && top && top.confidence >= 0.90) confirmed = true;
if (confirmed) state_updates.product_confirmed_by_client = true;

// (b) client_email — captured by Extract Contact Details.
if ($json.extracted_email) {
  state_updates.client_email_collected = true;
}

return [{ json: { ...$json,
  recommended_phase: recommended,
  phase_blocked_by: analysis.phase?.advance_blocked_by || [],
  attach_product_image: attach_image,
  product_confirmed: confirmed,
  state_updates
} }];
`), { row: 2 });

  w.add(ifBool('Need Product Image?', '$json.attach_product_image === true'), { row: 2 });

  w.add(http('Supabase - Fetch Product Image', {
    method: 'GET',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/product_images?product_id=eq.{{ $json.analysis.intent.product_candidates[0].product_id }}&is_primary=eq.true&select=url&limit=1',
    headers: SB_ANON,
  }), { row: 1 });

  w.add(code('Extract Product Image URL', `
${ROWS}
const o = $('Phase Advance Decision').first().json;
return [{ json: { ...o, product_image_url: rows($json)[0]?.url || null } }];
`), { row: 1 });

  w.add(code('No Product Image', `
return [{ json: { ...$json, product_image_url: null } }];
`), { row: 3 });

  w.add(code('Build Response Context', `
const state    = $json.conversation_state || {};
const analysis = $json.analysis || {};

const context = {
  phase:                $json.recommended_phase,
  client_name:          state.client_name || 'there',
  reply_language:       analysis.language?.reply_in || state.preferred_language || 'en',
  product_name:         state.product_name || null,
  product_moq:          state.product_moq || null,
  product_price_usd:    state.product_price_usd || null,
  product_lead_time:    state.lead_time_days || null,
  product_customizable: state.product_customizable || false,
  inquiry_quantity:     state.inquiry_quantity || null,
  product_confirmed:    state.product_confirmed_by_client || false,
  next_question:        analysis.intent?.next_logical_question || null,
  attach_image:         $json.attach_product_image,
  missing_fields:       analysis.intent?.missing_fields || [],
  escalation_score:     $json.escalation_score
};

const user = \`CONTEXT:\\n\${JSON.stringify(context, null, 2)}\\n\\nCLIENT MESSAGE:\\n\${$json.text || '[image/media only]'}\`;

return [{ json: { ...$json, response_context: context, _anthropic: {
  model: ${JSON.stringify(MODEL)},
  max_tokens: 600,
  temperature: 0.3,
  system: ${JSON.stringify(RESPONSE_PROMPT)},
  messages: [{ role: 'user', content: user }]
} } }];
`), { row: 2 });

  w.add(claude('Claude - Generate Response'), { row: 2 });

  w.add(code('Parse Response JSON', `
const o = $('Build Response Context').first().json;
let raw = $json.content?.[0]?.text || '';
raw = raw.replace(/\`\`\`json\\n?/g, '').replace(/\`\`\`\\n?/g, '').trim();

let r;
try { r = JSON.parse(raw); }
catch (e) {
  r = { reply_text: 'Thanks for your message — let me get back to you shortly.',
        phase_action: 'maintain', attach_product_image: false };
}

const phase_action = r.phase_action || 'maintain';

// --- M0 (c): record what we just ASKED, so the next turn can fast-path it -----
// pending_question was read by the fast path and by order_validation rule 8, but
// never written by anything — which made the fast path unreachable dead code and
// left product_confirmed_by_client permanently false. It has to be set here,
// after the reply exists, because it describes the question we actually asked.
const top = o.analysis?.intent?.product_candidates?.[0];
let pending_question = null;
if (phase_action === 'confirm_order' || o.recommended_phase === 'confirmation') {
  pending_question = 'order_confirmation';
} else if (top && !o.product_confirmed) {
  // We named a product the client hasn't confirmed yet — a yes/no is expected.
  pending_question = 'product_confirmation';
}

return [{ json: { ...o,
  reply_text: r.reply_text,
  phase_action,
  final_attach_image: r.attach_product_image === true,
  state_updates: { ...(o.state_updates || {}), pending_question }
} }];
`), { row: 2 });

  w.add(ifBool('Trigger Order Confirmation?', "$json.phase_action === 'confirm_order'"), { row: 2 });
  w.add(callWF('→ Confirmation', 'YiwuFlow - Confirmation'), { row: 1 });

  // ---- persist + dispatch
  w.add(code('Build Inbound Message', `
const a = $json.analysis || null;
return [{ json: { ...$json, _body: {
  conversation_id:   $json.conversation_id,
  external_id:       $json.external_id || null,
  direction:         'inbound',
  input_type:        $json.input_type || 'text',
  text_content:      $json.text || null,
  image_url:         $json.image_url || null,
  detected_language: a?.language?.detected || null,
  ai_analysis:       a,
  sent_at:           $json.timestamp || new Date().toISOString(),
  processed_at:      new Date().toISOString()
} } }];
`), { row: 3 });

  w.add(http('Supabase - Save Inbound Message', {
    method: 'POST',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/messages',
    headers: SB_SERVICE,
    body: '={{ JSON.stringify($json._body) }}',
  }), { row: 3 });

  w.add(code('Prepare State Update', `
const o = $('Build Inbound Message').first().json;
return [{ json: { ...o, _body: o.state_updates || {} } }];
`), { row: 3 });

  w.add(http('Supabase - Update Conv State', {
    method: 'PATCH',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/conversation_state?conversation_id=eq.{{ $json.conversation_id }}',
    headers: SB_SERVICE,
    body: '={{ JSON.stringify($json._body) }}',
  }), { row: 3 });

  w.add(code('Prepare Phase Update', `
const o = $('Build Inbound Message').first().json;
return [{ json: { ...o, _body: {
  phase: o.recommended_phase,
  updated_at: new Date().toISOString()
} } }];
`), { row: 3 });

  w.add(http('Supabase - Update Conv Phase', {
    method: 'PATCH',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/conversations?id=eq.{{ $json.conversation_id }}',
    headers: SB_SERVICE,
    body: '={{ JSON.stringify($json._body) }}',
  }), { row: 3 });

  w.add(code('Prepare Outbound Message', `
const o = $('Build Inbound Message').first().json;
return [{ json: { ...o, _body: {
  conversation_id: o.conversation_id,
  direction: 'outbound',
  input_type: 'text',
  text_content: o.reply_text,
  sent_at: new Date().toISOString()
} } }];
`), { row: 3 });

  w.add(http('Supabase - Save Outbound Message', {
    method: 'POST',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/messages',
    headers: SB_SERVICE,
    body: '={{ JSON.stringify($json._body) }}',
  }), { row: 3 });

  // M0: persist the captured email onto `clients`, so active_conversations_summary
  // surfaces it as conversation_state.client_email on every later turn.
  w.add(code('Prepare Client Update', `
const o = $('Build Inbound Message').first().json;
const body = { last_seen_at: new Date().toISOString() };
if (o.extracted_email) body.email = o.extracted_email;
return [{ json: { ...o, _body: body } }];
`), { row: 3 });

  w.add(http('Supabase - Update Client', {
    method: 'PATCH',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/clients?id=eq.{{ $json.client_id }}',
    headers: SB_SERVICE,
    body: '={{ JSON.stringify($json._body) }}',
  }), { row: 3 });

  w.add(code('Restore Context', `
return [{ json: $('Build Inbound Message').first().json }];
`), { row: 3 });

  w.add(callWF('→ Dispatch', 'YiwuFlow - Dispatch'), { row: 3 });

  // wiring
  w.link('When Called by Parent', 'Skip to Dispatch?');
  w.link('Skip to Dispatch?', 'Prepare Skip Path', 0);
  w.link('Skip to Dispatch?', 'Extract Contact Details', 1);
  w.link('Extract Contact Details', 'Escalation Score Calculator');
  w.link('Prepare Skip Path', 'Build Inbound Message');

  w.link('Escalation Score Calculator', 'Immediate Escalate?');
  w.link('Immediate Escalate?', '→ Escalation', 0);
  w.link('Immediate Escalate?', 'Phase Advance Decision', 1);

  w.link('Phase Advance Decision', 'Need Product Image?');
  w.link('Need Product Image?', 'Supabase - Fetch Product Image', 0);
  w.link('Need Product Image?', 'No Product Image', 1);
  w.link('Supabase - Fetch Product Image', 'Extract Product Image URL');
  w.link('Extract Product Image URL', 'Build Response Context');
  w.link('No Product Image', 'Build Response Context');

  w.chain('Build Response Context', 'Claude - Generate Response', 'Parse Response JSON', 'Trigger Order Confirmation?');
  w.link('Trigger Order Confirmation?', '→ Confirmation', 0);
  w.link('Trigger Order Confirmation?', 'Build Inbound Message', 1);

  w.chain('Build Inbound Message', 'Supabase - Save Inbound Message', 'Prepare State Update',
    'Supabase - Update Conv State', 'Prepare Phase Update', 'Supabase - Update Conv Phase',
    'Prepare Outbound Message', 'Supabase - Save Outbound Message',
    'Prepare Client Update', 'Supabase - Update Client', 'Restore Context', '→ Dispatch');

  return w;
}

// ==================================================== 4. CONFIRMATION ======

function confirmation() {
  const w = new WF('YiwuFlow - Confirmation');

  w.add(subTrigger());

  w.add(http('Supabase - Generate Order Reference', {
    method: 'POST',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/rpc/generate_order_reference',
    headers: SB_SERVICE,
    body: '={{ JSON.stringify({}) }}',
  }));

  w.add(code('Build Order Draft', `
const o = $('When Called by Parent').first().json;
const state = o.conversation_state || {};
// rpc returns the string directly as the response body
const ref = typeof $json.body === 'string' ? $json.body : ($json.body ?? $json);
if (!ref) throw new Error('generate_order_reference returned nothing.');

const qty   = state.inquiry_quantity || 0;
const price = state.product_price_usd || 0;

return [{ json: { ...o, order_reference: ref, order_draft: {
  order_reference:       ref,
  business_id:           o.business_id,
  client_id:             o.client_id,
  conversation_id:       o.conversation_id,
  product_id:            state.identified_product_id,
  product_name:          state.product_name,
  quantity:              qty,
  unit:                  state.inquiry_unit || 'pcs',
  agreed_unit_price_usd: price,
  total_value_usd:       qty * price,
  // o.client_email is this turn's freshly-extracted address; the view-backed
  // state.client_email is one turn stale and would be null on the very turn the
  // client supplies it — which is exactly the turn the order gets confirmed.
  client_email:          o.client_email || state.client_email || null,
  payment_terms:         '30% deposit, 70% before shipment',
  shipping_address:      null,
  notes:                 null,
  status:                'confirmed'
} } }];
`));

  w.add(code('Build Validation Request', `
const o = $json;
const state = { ...(o.conversation_state || {}),
  escalation_score: o.escalation_score ?? o.conversation_state?.escalation_score };
const user = \`\${JSON.stringify(o.order_draft)}\\n\\nCONVERSATION STATE:\\n\${JSON.stringify(state)}\`;

return [{ json: { ...o, _anthropic: {
  model: ${JSON.stringify(MODEL)},
  max_tokens: 400,
  temperature: 0,
  system: ${JSON.stringify(VALIDATION_PROMPT)},
  messages: [{ role: 'user', content: user }]
} } }];
`));

  w.add(claude('Claude - Order Validation'));

  w.add(code('Parse Validation Response', `
const o = $('Build Order Draft').first().json;
let raw = $json.content?.[0]?.text || '{}';
raw = raw.replace(/\`\`\`json\\n?/g, '').replace(/\`\`\`\\n?/g, '').trim();

let validation_result;
try { validation_result = JSON.parse(raw); }
catch (e) {
  validation_result = {
    order_valid: false,
    safe_to_confirm: false,
    validation_failures: ['parse_error'],
    blocking_issue: 'Unable to validate order — please review manually.',
    estimated_risk: 'high'
  };
}
return [{ json: { ...o, validation_result } }];
`));

  w.add(ifBool('Order Safe to Confirm?', '$json.validation_result.safe_to_confirm === true'));

  // --- unsafe: reply with the blocking issue, create nothing
  w.add(code('Blocked - Build Reply', `
return [{ json: { ...$json,
  reply_text: $json.validation_result.blocking_issue || 'I need a little more information before I can confirm this order.',
  recommended_phase: $json.phase || 'confirmation',
  final_attach_image: false,
  product_image_url: null,
  order_blocked: true
} }];
`), { row: -1 });

  w.add(callWF('→ Dispatch (Blocked)', 'YiwuFlow - Dispatch'), { row: -1 });

  // --- safe: insert order
  w.add(code('Prepare Order Insert', `
return [{ json: { ...$json, _body: $json.order_draft } }];
`), { row: 1 });

  w.add(http('Supabase - Insert Order', {
    method: 'POST',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/orders',
    headers: SB_SERVICE_REPR,
    body: '={{ JSON.stringify($json._body) }}',
  }), { row: 1 });

  w.add(code('Extract Order ID', `
${ROWS}
const o = $('Build Order Draft').first().json;
const order_id = rows($json)[0]?.id;
if (!order_id) throw new Error('Insert Order returned no row.');
return [{ json: { ...o, order_id } }];
`), { row: 1 });

  w.add({
    name: 'Sheets - Append Confirmed Order',
    type: 'n8n-nodes-base.googleSheets',
    typeVersion: 4.5,
    parameters: {
      operation: 'append',
      documentId: { __rl: true, mode: 'id', value: '={{ $env.GOOGLE_SHEET_ID }}' },
      sheetName: { __rl: true, mode: 'name', value: 'Confirmed Orders' },
      dataMode: 'autoMapInputData',
      options: {},
    },
    notes: 'Needs a Google Sheets credential. Requires env var GOOGLE_SHEET_ID.',
  }, { row: 1 });

  // Sheets autoMap needs a flat row object, so build it first.
  w.add(code('Build Sheet Row', `
const o = $json;
const d = o.order_draft;
const s = o.conversation_state || {};
return [{ json: {
  ...o,
  _sheet: {
    'Order Ref':      d.order_reference,
    'Date':           new Date().toISOString().slice(0, 10),
    'Client':         s.client_name || '',
    'Email':          d.client_email || '',
    'Channel':        o.channel || '',
    'Contact':        o.client_channel_id || '',
    'Country':        s.country || '',
    'Product':        d.product_name || '',
    'SKU':            s.product_sku || '',
    'Qty':            d.quantity,
    'Unit':           d.unit,
    'Unit Price USD': d.agreed_unit_price_usd,
    'Total USD':      d.total_value_usd,
    'Payment Terms':  d.payment_terms,
    'Ship To':        d.shipping_address || '',
    'Lead Time':      s.lead_time_days || '',
    'Notes':          d.notes || '',
    'Status':         'Confirmed',
    'DB Order ID':    o.order_id,
    'Conv ID':        o.conversation_id
  }
} }];
`), { row: 1 });

  w.add(code('Build Confirmation Email', `
const o = $('Build Sheet Row').first().json;
const d = o.order_draft;
const s = o.conversation_state || {};
const money = (n) => Number(n || 0).toFixed(2);

const html = \`
<h2>Order Confirmation</h2>
<p>Hi \${s.client_name || 'there'},</p>
<p>Thank you — your order is confirmed. Here are the details:</p>
<table cellpadding="6" style="border-collapse:collapse">
  <tr><td><b>Order Reference</b></td><td>\${d.order_reference}</td></tr>
  <tr><td><b>Product</b></td><td>\${d.product_name || ''} (\${s.product_sku || ''})</td></tr>
  <tr><td><b>Quantity</b></td><td>\${d.quantity} \${d.unit}</td></tr>
  <tr><td><b>Unit Price</b></td><td>USD \${money(d.agreed_unit_price_usd)}</td></tr>
  <tr><td><b>Total</b></td><td>USD \${money(d.total_value_usd)}</td></tr>
  <tr><td><b>Payment Terms</b></td><td>\${d.payment_terms}</td></tr>
  <tr><td><b>Lead Time</b></td><td>\${s.lead_time_days ? s.lead_time_days + ' days' : 'To be confirmed'}</td></tr>
</table>
<p>We'll follow up shortly with payment and shipping details.</p>\`;

return [{ json: { ...o, _body: {
  personalizations: [{ to: [{ email: d.client_email }] }],
  from: { email: $env.SENDGRID_FROM_EMAIL },
  subject: \`Order Confirmation – \${d.product_name} – \${d.order_reference}\`,
  content: [{ type: 'text/html', value: html }]
} } }];
`), { row: 1 });

  w.add({
    name: 'SendGrid - Send Confirmation',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    parameters: {
      method: 'POST',
      url: 'https://api.sendgrid.com/v3/mail/send',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: '=Bearer {{ $env.SENDGRID_API_KEY }}' },
          { name: 'Content-Type', value: 'application/json' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json._body) }}',
      options: { response: { response: { fullResponse: true, neverError: true } } },
    },
    notes: 'SendGrid returns 202 with an empty body on success.',
  }, { row: 1 });

  w.add(code('Prepare Order Flags', `
const o = $('Build Confirmation Email').first().json;
return [{ json: { ...o, _body: {
  google_sheet_logged: true,
  confirmation_email_sent: true,
  confirmed_at: new Date().toISOString()
} } }];
`), { row: 1 });

  w.add(http('Supabase - Mark Order Logged', {
    method: 'PATCH',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/orders?id=eq.{{ $json.order_id }}',
    headers: SB_SERVICE,
    body: '={{ JSON.stringify($json._body) }}',
  }), { row: 1 });

  w.add(code('Prepare Close Conversation', `
const o = $('Build Confirmation Email').first().json;
return [{ json: { ...o, _body: {
  phase: 'closed',
  is_active: false,
  closed_at: new Date().toISOString()
} } }];
`), { row: 1 });

  w.add(http('Supabase - Close Conversation', {
    method: 'PATCH',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/conversations?id=eq.{{ $json.conversation_id }}',
    headers: SB_SERVICE,
    body: '={{ JSON.stringify($json._body) }}',
  }), { row: 1 });

  w.add(code('Build Confirmation Reply', `
const o = $('Build Confirmation Email').first().json;
const d = o.order_draft;
return [{ json: { ...o,
  reply_text: \`Your order is confirmed. Reference \${d.order_reference} — \${d.quantity} \${d.unit} of \${d.product_name}. A confirmation email is on its way to \${d.client_email}.\`,
  recommended_phase: 'closed',
  final_attach_image: false,
  product_image_url: null
} }];
`), { row: 1 });

  w.add(callWF('→ Dispatch (Confirmed)', 'YiwuFlow - Dispatch'), { row: 1 });

  // wiring
  w.chain('When Called by Parent', 'Supabase - Generate Order Reference', 'Build Order Draft',
    'Build Validation Request', 'Claude - Order Validation', 'Parse Validation Response',
    'Order Safe to Confirm?');
  w.link('Order Safe to Confirm?', 'Prepare Order Insert', 0);
  w.link('Order Safe to Confirm?', 'Blocked - Build Reply', 1);
  w.link('Blocked - Build Reply', '→ Dispatch (Blocked)');

  w.chain('Prepare Order Insert', 'Supabase - Insert Order', 'Extract Order ID', 'Build Sheet Row',
    'Sheets - Append Confirmed Order', 'Build Confirmation Email', 'SendGrid - Send Confirmation',
    'Prepare Order Flags', 'Supabase - Mark Order Logged', 'Prepare Close Conversation',
    'Supabase - Close Conversation', 'Build Confirmation Reply', '→ Dispatch (Confirmed)');

  return w;
}

// ====================================================== 5. ESCALATION ======

function escalation() {
  const w = new WF('YiwuFlow - Escalation');

  w.add(subTrigger());

  w.add(code('Build Escalation Event', `
const flags = $json.escalation_flags || [];
// trigger_reason must match the CHECK constraint in supabase/schema.sql
const VALID = ['high_value','unclear_product','customization','complex_negotiation',
  'repeated_ambiguity','client_request','logistics_payment','manual','low_confidence_image'];
const reason = VALID.includes(flags[0]) ? flags[0] : 'manual';

return [{ json: { ...$json, _body: {
  conversation_id:  $json.conversation_id,
  business_id:      $json.business_id,
  trigger_reason:   reason,
  trigger_details:  \`Score: \${$json.escalation_score}. Flags: \${flags.join(', ') || 'none'}\`,
  escalation_score: $json.escalation_score,
  notified_via:     'telegram',
  notified_at:      new Date().toISOString()
} } }];
`));

  w.add(http('Supabase - Insert Escalation', {
    method: 'POST',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/escalation_events',
    headers: SB_SERVICE,
    body: '={{ JSON.stringify($json._body) }}',
  }));

  w.add(code('Prepare Escalate Phase', `
const o = $('Build Escalation Event').first().json;
return [{ json: { ...o, _body: { phase: 'escalated' } } }];
`));

  w.add(http('Supabase - Set Phase Escalated', {
    method: 'PATCH',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/conversations?id=eq.{{ $json.conversation_id }}',
    headers: SB_SERVICE,
    body: '={{ JSON.stringify($json._body) }}',
  }));

  w.add(code('Build Telegram Alert', `
const o = $('Build Escalation Event').first().json;
const s = o.conversation_state || {};
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const text = [
  '🔔 <b>ESCALATION — YiwuFlow</b>', '',
  \`Client: \${esc(s.client_name || 'Unknown')}\`,
  \`Channel: \${esc(o.channel)}\`,
  \`Contact: \${esc(o.client_channel_id)}\`, '',
  \`Reason: \${esc((o.escalation_flags || []).join(', ') || 'manual')}\`,
  \`Score: \${esc(o.escalation_score)}\`,
  \`Product: \${esc(s.product_name || 'Unknown')}\`,
  \`Qty: \${esc(s.inquiry_quantity || 'Not stated')}\`, '',
  \`Action: Reply to client directly on \${esc(o.channel)}\`,
  \`Conv ID: \${esc(o.conversation_id)}\`
].join('\\n');

return [{ json: { ...o, _body: {
  chat_id: $env.TELEGRAM_ESCALATION_CHAT_ID,
  parse_mode: 'HTML',
  text
} } }];
`));

  w.add({
    name: 'Telegram - Notify Operator',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    parameters: {
      method: 'POST',
      url: '=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json._body) }}',
      options: {},
    },
  });

  w.add(code('Build Escalation Reply Request', `
const o = $('Build Telegram Alert').first().json;
const s = o.conversation_state || {};
const a = o.analysis || {};

const context = {
  phase: 'escalated',
  client_name: s.client_name || 'there',
  reply_language: a.language?.reply_in || s.preferred_language || 'en',
  product_name: s.product_name || null,
  escalation_score: o.escalation_score
};
const user = \`CONTEXT:\\n\${JSON.stringify(context, null, 2)}\\n\\nCLIENT MESSAGE:\\n\${o.text || '[media]'}\`;

return [{ json: { ...o, recommended_phase: 'escalated', _anthropic: {
  model: ${JSON.stringify(MODEL)},
  max_tokens: 600,
  temperature: 0.3,
  system: ${JSON.stringify(RESPONSE_PROMPT)},
  messages: [{ role: 'user', content: user }]
} } }];
`));

  w.add(claude('Claude - Escalation Reply'));

  w.add(code('Parse Escalation Reply', `
const o = $('Build Escalation Reply Request').first().json;
let raw = $json.content?.[0]?.text || '';
raw = raw.replace(/\`\`\`json\\n?/g, '').replace(/\`\`\`\\n?/g, '').trim();
let reply;
try { reply = JSON.parse(raw).reply_text; } catch (e) { reply = null; }

return [{ json: { ...o,
  reply_text: reply || 'Thanks — one of our specialists will follow up with you shortly.',
  final_attach_image: false,
  product_image_url: null,
  recommended_phase: 'escalated'
} }];
`));

  w.add(callWF('→ Dispatch', 'YiwuFlow - Dispatch'));

  w.chain('When Called by Parent', 'Build Escalation Event', 'Supabase - Insert Escalation',
    'Prepare Escalate Phase', 'Supabase - Set Phase Escalated', 'Build Telegram Alert',
    'Telegram - Notify Operator', 'Build Escalation Reply Request', 'Claude - Escalation Reply',
    'Parse Escalation Reply', '→ Dispatch');

  return w;
}

// ======================================================== 6. DISPATCH ======

function dispatch() {
  const w = new WF('YiwuFlow - Dispatch');

  w.add(subTrigger());

  w.add({
    name: 'Route by Channel',
    type: 'n8n-nodes-base.switch',
    typeVersion: 3,
    parameters: {
      rules: {
        values: [
          {
            conditions: {
              options: { caseSensitive: true, typeValidation: 'loose', version: 2 },
              conditions: [{ id: nid(), leftValue: '={{ $json.channel }}', rightValue: 'whatsapp', operator: { type: 'string', operation: 'equals' } }],
              combinator: 'and',
            },
            outputKey: 'whatsapp',
          },
        ],
      },
      // Everything else (wechat / instagram / rednote / webhook_test) echoes to MOCK_CALLBACK_URL.
      options: { fallbackOutput: 'extra', renameFallbackOutput: 'simulated' },
    },
  });

  w.add(code('Build WhatsApp Payload', `
const to = String($json.client_channel_id || '').replace('whatsapp:', '');
const sendImage = $json.final_attach_image === true && !!$json.product_image_url;

const body = sendImage
  ? { messaging_product: 'whatsapp', to, type: 'image',
      image: { link: $json.product_image_url, caption: $json.reply_text } }
  : { messaging_product: 'whatsapp', to, type: 'text',
      text: { body: $json.reply_text } };

return [{ json: { ...$json, _body: body } }];
`), { row: -1 });

  w.add({
    name: '360dialog - Send Message',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    parameters: {
      method: 'POST',
      url: 'https://waba.360dialog.io/v1/messages',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'D360-API-KEY', value: '={{ $env.DIALOG360_API_KEY }}' },
          { name: 'Content-Type', value: 'application/json' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json._body) }}',
      options: {},
    },
    notes: 'Deferred for v1 — only fires when channel = whatsapp.',
  }, { row: -1 });

  w.add(code('Build Echo Payload', `
return [{ json: { ...$json, _body: {
  channel:         $json.channel,
  to:              $json.client_channel_id,
  reply_text:      $json.reply_text,
  attach_image:    $json.final_attach_image === true,
  product_image:   $json.product_image_url || null,
  conversation_id: $json.conversation_id,
  phase:           $json.recommended_phase || $json.phase || null
} } }];
`), { row: 1 });

  w.add({
    name: 'Echo to MOCK_CALLBACK_URL',
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    parameters: {
      method: 'POST',
      url: '={{ $env.MOCK_CALLBACK_URL }}',
      sendHeaders: true,
      headerParameters: { parameters: [{ name: 'Content-Type', value: 'application/json' }] },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json._body) }}',
      options: { response: { response: { fullResponse: true, neverError: true } } },
    },
  }, { row: 1 });

  w.link('When Called by Parent', 'Route by Channel');
  w.link('Route by Channel', 'Build WhatsApp Payload', 0);
  w.link('Route by Channel', 'Build Echo Payload', 1);
  w.link('Build WhatsApp Payload', '360dialog - Send Message');
  w.link('Build Echo Payload', 'Echo to MOCK_CALLBACK_URL');

  return w;
}

// ============================================================== emit ========

const workflows = [intake(), multimodal(), conversation(), confirmation(), escalation(), dispatch()];

const slug = (s) => s.replace('YiwuFlow - ', '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let total = 0;
for (const w of workflows) {
  const file = join(ROOT, 'n8n', `${slug(w.name)}.json`);
  writeFileSync(file, JSON.stringify(w.json(), null, 2) + '\n');
  total += w.nodes.length;
  console.log(`${String(w.nodes.length).padStart(3)} nodes  →  n8n/${slug(w.name)}.json`);
}
console.log(`\n${total} nodes across ${workflows.length} workflows.`);
