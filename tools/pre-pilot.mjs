#!/usr/bin/env node
/**
 * The pre-pilot walkthrough — the twelve things a buyer can do on day one,
 * driven through the REAL production composition before a real number is
 * connected. Not a CI gate: a rehearsal, run before this pilot and every
 * future one.
 *
 * WHY IT EXISTS. Every one of the twelve below has unit and integration tests.
 * What no test does is watch them happen in sequence, in one running app, with
 * the real webhook ingress, the real worker, the real send gate and the owner's
 * own screens — the shape the factory will actually meet. A defect that only
 * appears when two of these meet has nowhere else to be caught.
 *
 * WHAT IS REAL AND WHAT IS NOT. Everything is real except the transport and,
 * unless you pass --live, the model: `buildProduction` is the same function the
 * server's entry point calls, with the WhatsApp simulator in place of Meta.
 * Media CONTENT is always simulated (the simulator serves stand-in bytes), so
 * the voice note and the photo are scripted in both modes; --live governs the
 * analyzer and the reply writer, which is the part a buyer reads.
 *
 * ITS OWN TENANT, EVERY RUN. It seeds a private copy of the demo factory under
 * a fresh namespace, because the seeds are `on conflict do nothing` and would
 * never repair a tenant a previous run had mutated. Buyers are created by the
 * webhook, never the pre-seeded conversations: those have no `client_channels`
 * row, so a draft approved on one reports "sent" while nothing is queued.
 *
 *   node tools/pre-pilot.mjs                  scripted models, all twelve
 *   node tools/pre-pilot.mjs --live           the real model writes the replies
 *   node tools/pre-pilot.mjs --only 5,6,7     just those scenarios
 *   node tools/pre-pilot.mjs --keep           leave the app running afterwards
 *
 * Needs DATABASE_URL and MIGRATE_DATABASE_URL, and a built dist (it builds
 * unless you pass --no-build). Do not run it while the integration suite runs:
 * both start real pg-boss workers on the same queues.
 */
import { spawnSync } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

const ADMIN_URL = process.env.MIGRATE_DATABASE_URL;
const APP_URL = process.env.DATABASE_URL;
if (!ADMIN_URL || !APP_URL) {
  console.error('MIGRATE_DATABASE_URL and DATABASE_URL are both required');
  process.exit(1);
}
const LIVE = flag('live');
const PORT = Number(opt('port') ?? 8788);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = 'pre-pilot-owner-code';
const OUT = path.resolve(ROOT, opt('out') ?? 'pre-pilot');
const NS = (opt('namespace') ?? randomBytes(4).toString('hex')).toLowerCase();
const BIZ = `${NS}-0000-4000-8000-0000000000b1`;
const TAG = `pp${NS}`;
/** Buyer numbers for this run only: `client_channels` is unique per number globally. */
const block = String((parseInt(NS.slice(0, 6), 16) % 900_000) + 100_000);
const buyer = (n) => `88${block}${n}`;

const only = (opt('only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/* ── small helpers ───────────────────────────────────────────────────────── */

const db = new pg.Client({ connectionString: ADMIN_URL });
const q = async (text, params = []) => (await db.query(text, params)).rows;
const one = async (text, params = []) => (await q(text, params))[0] ?? null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(probe, what, ms = 40_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined && v !== null && v !== false) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
}

let cookie = '';
const post = (url, body, headers = {}) =>
  fetch(`${BASE}${url}`, { method: 'POST', body, redirect: 'manual', headers: { cookie, ...headers } });
const form = (url, fields) =>
  post(url, new URLSearchParams(fields).toString(), { 'content-type': 'application/x-www-form-urlencoded' });
const get = async (url) => {
  const res = await fetch(`${BASE}${url}`, { headers: { cookie }, redirect: 'manual' });
  return { status: res.status, body: await res.text(), location: res.headers.get('location') ?? '' };
};
/** A webhook, exactly as the provider would send it: signed over these bytes. */
const hook = (w) => post('/webhook/whatsapp', w.rawBody, { 'content-type': 'application/json', ...w.headers });
/**
 * A1 — what she was told, read the way a browser reads it.
 *
 * The notice used to be in the redirect's query string. It rides a signed,
 * one-shot cookie now (`src/api/web/flash.ts`), minted with the web session
 * secret this walkthrough's own CREDENTIAL_KEY derives — the same derivation
 * `main.ts` makes.
 */
const WEB_SECRET = createHmac('sha256', 'c'.repeat(64)).update('yf-web-session').digest('hex');
let flashMod = null;
const flashOf = async (res) => {
  // From `dist/`, like everything else here — a static import of `src/` would
  // make the simulator production-reachable and fail `npm run boundaries`.
  flashMod ??= await import('../dist/api/web/flash.js');
  const set = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''];
  const c = set.map(String).find((x) => x.startsWith(`${flashMod.FLASH_COOKIE}=`));
  if (!c) return '';
  const token = c.slice(flashMod.FLASH_COOKIE.length + 1).split(';')[0] ?? '';
  return flashMod.readFlash(WEB_SECRET, token, 'en', Date.now())?.text ?? '';
};

const convOf = (wa) => until(() => one(
  `select c.id::text as id from conversations c
     join client_channels cc on cc.client_id = c.client_id and cc.channel = 'whatsapp'
    where cc.channel_user_id = $1 and c.business_id = $2 and c.is_active
    order by c.created_at desc limit 1`, [wa, BIZ]).then((r) => r?.id), `a conversation for ${wa}`);

const draftOf = (conv) => until(() => one(
  `select id::text as id, draft_text, status from drafts
    where conversation_id = $1 and status = 'pending' order by created_at desc limit 1`, [conv]).then((r) => r ?? undefined),
  `a draft in ${conv}`);

const eventOf = (conv, type) => until(() => one(
  `select payload from conversation_events where conversation_id = $1 and type = $2
    order by created_at desc limit 1`, [conv, type]).then((r) => r ?? undefined), `a ${type} event`);

const signalOf = (conv, kind) => until(() => one(
  `select payload from conversation_signals where conversation_id = $1 and kind = $2
    order by created_at desc limit 1`, [conv, kind]).then((r) => r ?? undefined), `a ${kind} signal`);

const countOf = async (table, conv) =>
  Number((await one(`select count(*)::int as n from ${table} where conversation_id = $1`, [conv]))?.n ?? 0);

/** Approve the pending draft as the owner would, and return her flash. */
const approve = async (conv, draftId) =>
  await flashOf(await form(`/app/inbox/${conv}/act`, { draftId, command: '发送' }));

const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

/* ── the scripted model ──────────────────────────────────────────────────── */

/**
 * It reads the SAME inputs the real one gets — the retriever's candidates and
 * the buyer's own words — so the product and the quantity are found the way
 * production finds them. Only the prose is fixed.
 */
const scripted = {
  transcript: 'Hello, I need five thousand canvas tote bags.',
  reply: null,           // set per scenario; null = derive from the quote
  vision: 'bamboo cutting board chopping board',   // distinctive: two bag products would tie
};

const usage = { inputTokens: 0, outputTokens: 0 };
const scriptedAnalyzer = {
  async analyze({ text, candidates, state }) {
    const m = /(\d[\d,]*)\s*(?:pcs|pieces|units)?/i.exec(text.replace(/[,\s](?=\d{3}\b)/g, ''));
    const qty = m ? Number(m[1].replace(/,/g, '')) : null;
    const top = candidates[0];
    return {
      analysis: {
        language: { detected: 'en', replyIn: 'en' },
        intent: {
          primary: qty ? 'quote_request' : 'inquiry',
          productCandidate: top
            ? { productId: top.productId, confidence: 0.92, confirmedByClient: false, matchMethod: 'text' }
            : null,
          quantityMentioned: qty ? { value: qty, unit: 'pcs' } : null,
          nextLogicalQuestion: null,
          missingFields: [],
        },
        recommendedPhase: qty ? 'commercial_discussion' : (state.phase ?? 'clarification'),
      },
      promptVersion: 'pre-pilot@1', modelId: 'scripted', usage,
    };
  },
};
const scriptedWriter = {
  async write({ quote }) {
    // Numbers only from the quote it was handed — the same rule the guard applies.
    const reply = scripted.reply ?? (quote
      ? `For ${quote.quantity.value} pcs: $${quote.unitPrice.amount} per piece.`
      : 'Thanks — could you tell me a little more about what you need?');
    return { reply, promptVersion: 'pre-pilot@1', modelId: 'scripted', usage };
  },
};
const scriptedVision = {
  async describe() {
    return { searchText: scripted.vision, attributes: ['canvas', 'tote'], promptVersion: 'pre-pilot@1', modelId: 'scripted', usage };
  },
};
const scriptedTranscriber = async () => ({ ok: true, text: scripted.transcript, language: 'en' });

/** The real pair, for --live. The key comes from the environment, or from .env. */
function anthropicKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const line = readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')
      .find((l) => l.startsWith('ANTHROPIC_API_KEY='));
    if (line) return line.slice('ANTHROPIC_API_KEY='.length).trim();
  } catch { /* no .env */ }
  console.error('--live needs ANTHROPIC_API_KEY (in the environment or .env)');
  process.exit(1);
}
let anthropic = null;
const client = async () => {
  if (!anthropic) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropic = new Anthropic({ apiKey: anthropicKey() });
  }
  return anthropic;
};
const realAnalyzer = () => ({
  async analyze(input) {
    const { anthropicAnalyzer } = await import('../dist/llm/anthropic.js');
    return anthropicAnalyzer(await client()).analyze(input);
  },
});
const realWriter = () => ({
  async write(input) {
    const { anthropicReplyWriter } = await import('../dist/llm/anthropic.js');
    return anthropicReplyWriter(await client()).write(input);
  },
});
/** A forced line wins; otherwise the real model writes. */
const forcedOrReal = (real) => ({
  async write(input) {
    if (scripted.reply === null) return real.write(input);
    return { reply: scripted.reply, promptVersion: 'pre-pilot@1', modelId: 'forced', usage };
  },
});

/* ── setup ───────────────────────────────────────────────────────────────── */

const step = (s) => console.log(`  · ${s}`);

async function setup() {
  if (!flag('no-build')) {
    step('building');
    if (spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'ignore' }).status !== 0) {
      console.error('build failed'); process.exit(1);
    }
  }
  step(`seeding a private copy of the demo factory (${BIZ})`);
  const seed = spawnSync('node', ['tools/seed-demo.mjs'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, DEMO_NAMESPACE: NS },
  });
  if (seed.status !== 0) { console.error(seed.stderr || seed.stdout); process.exit(1); }

  await db.connect();

  const { whatsappSimulator, SIM_MEDIA_BASE } = await import('../dist/channels/whatsapp/simulator.js');
  const { whatsappAudioFetcher, whatsappMediaFetcher } = await import('../dist/channels/whatsapp/media.js');
  const sim = whatsappSimulator([], { tag: TAG });

  step('connecting the simulator to that tenant, and switching messaging on');
  await q(`insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
           values ($1,'whatsapp',$2,'pre-pilot','service')
           on conflict (channel, external_ref) do nothing`, [BIZ, sim.phoneNumberId]);
  await q(`update channels set status='connected', activated_at=now(), pilot_mode=true
            where business_id=$1 and kind='whatsapp'`, [BIZ]);
  // Debounce is 6s in production so a buyer's three lines arrive as one message.
  // A rehearsal should not wait six seconds twelve times.
  await q(`update businesses set batch_debounce_ms=500, batch_max_window_ms=1500 where id=$1`, [BIZ]);
  // Her price rules already came from the seed. What no owner screen can write
  // is a discount rule — so scenario 7 stages it here, and that gap is a
  // finding in its own right.
  const tote = await one(`select id::text as id from products where business_id=$1 and sku='ZX-100'`, [BIZ]);
  await q(`insert into negotiation_rules (business_id, priority, condition, action, is_active)
           values ($1, 10, $2::jsonb, $3::jsonb, true)`,
    [BIZ, JSON.stringify({ qtyGte: 10000, productId: tote.id }), JSON.stringify({ kind: 'discount_pct', value: 8 })]);
  // A held turn must prove the HOLD stopped it, not a policy that was going to
  // draft anyway. So quoting is on auto for this rehearsal.
  await q(`update autonomy_policy set mode='auto', time_window=null
            where business_id=$1 and capability='quote'`, [BIZ]);

  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    await q(`insert into pilot_allowlist (business_id, phone, label, added_by)
             values ($1,$2,$3,'owner') on conflict (business_id, phone) do nothing`,
      [BIZ, buyer(n), `rehearsal ${n}`]);   // digits only: the column checks the shape
  }
  // Buyer 0 is deliberately NOT on the list — that is scenario 12.

  if (LIVE) {
    // One cheap call first. A refused key would otherwise show up as twelve
    // turns retrying five times each and landing in the dead-letter queue —
    // true, but a long way round to "the key is wrong".
    step('checking the key before spending twelve turns on it');
    try {
      const c = await client();
      await c.messages.create({ model: 'claude-haiku-4-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] });
    } catch (err) {
      console.error(`\n  the model refused the key: ${err.message?.split('\n')[0] ?? err}`);
      console.error('  set a working ANTHROPIC_API_KEY, or run without --live for the scripted pass.\n');
      process.exit(2);
    }
  }

  step('booting the app on the production composition');
  process.env.PILOT_BUSINESS_ID = BIZ;
  process.env.OWNER_ACCESS_CODE = CODE;
  delete process.env.NODE_ENV;                       // a Secure cookie never comes back over http
  const { buildProduction } = await import('../dist/main.js');
  const media = { baseUrl: SIM_MEDIA_BASE, apiKey: 'sim', fetchImpl: sim.mediaFetch };
  const prod = await buildProduction({
    provider: 'meta',
    DATABASE_URL: APP_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'pre-pilot-key-not-real-shape-ok',
    META_WHATSAPP_ACCESS_TOKEN: 'pre-pilot-token-not-real',
    META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
    META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
    META_APP_SECRET: 'pre-pilot-app-secret-not-real',
    META_GRAPH_API_VERSION: 'v23.0',
    WEBHOOK_VERIFY_TOKEN: 'pre-pilot-verify-token',
    CREDENTIAL_KEY: 'c'.repeat(64),
    PORT,
  }, {
    adapter: sim.adapter,
    logger: false,
    media: { transcriber: scriptedTranscriber, audio: whatsappAudioFetcher(media), image: whatsappMediaFetcher(media) },
    // --live leaves the analyzer and the writer to the real model; the picture
    // and the voice are stand-in bytes either way, so those stay scripted.
    // Scenarios 8 and 9 still force their reply text: you cannot reliably ask a
    // model to break the owner's rules, and what those two show is what happens
    // to a reply that does.
    models: LIVE
      ? { analyzer: realAnalyzer(), replyWriter: forcedOrReal(realWriter()), vision: scriptedVision }
      : { analyzer: scriptedAnalyzer, replyWriter: scriptedWriter, vision: scriptedVision },
  });
  await prod.app.listen({ port: PORT, host: '127.0.0.1' });

  const login = await form('/login', { code: CODE });
  cookie = String(login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  ok(cookie !== '', 'the owner could not sign in');

  step('stating her terms, her closure and a word she forbids');
  // Terms authorise the FOB claim too, which is what lets a quote reply read
  // like a real one instead of being refused as an unauthorised claim.
  await form('/app/settings/terms', { payment: '30% deposit, 70% before shipment', incoterm: 'FOB' });
  const from = new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 20 * 86400e3).toISOString().slice(0, 10);
  await form('/app/settings/closures', { label: 'Factory holiday', from, to });
  // Deliberately a plain word, not a claim: "guarantee" would be refused by the
  // claims guard before the forbidden-word guard ever saw it, and the scenario
  // would pass for the wrong reason.
  await form('/app/settings/forbidden', { term: 'catalogue', note: 'we say price list' });
  await form('/app/knowledge/teach', {
    kind: 'faq', label: 'Do you print logos?',
    content: 'Yes — we print your logo, and our catalogue lists every colour we stock.',
  });

  return { prod, sim };
}

/**
 * The provider's other half: a delivery receipt for everything that leaves.
 *
 * Found by this rehearsal. A second message to the same buyer waits until the
 * one before it is confirmed at his handset, or 90 seconds (DELIVERY_WAIT_CAP_MS
 * in outbound/sequencer.ts) — so that two replies can never arrive out of
 * order. WhatsApp confirms in a second or two; a simulator that never confirms
 * makes every follow-up look like a 90-second stall that production would not
 * have. So the rehearsal plays that part too.
 */
function startReceipts(sim) {
  const seen = new Set();
  return setInterval(async () => {
    for (const id of sim.sentIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      try { await hook(sim.status(id, 'delivered')); } catch { /* the app is closing */ }
    }
  }, 300);
}

/* ── the twelve ──────────────────────────────────────────────────────────── */

const scenarios = [
  {
    n: 1, title: 'a voice note is heard, recorded, and answered',
    async run({ sim }) {
      const wa = buyer(1);
      scripted.transcript = 'Hello, I need 5000 canvas tote bags.';
      ok((await hook(sim.inboundAudio({ from: wa }))).status === 200, 'the webhook refused the voice note');
      const conv = await convOf(wa);
      const row = await until(() => one(
        `select input_type, transcription, provider_media_id, detected_language from messages
          where conversation_id = $1 and input_type = 'voice_transcribed' limit 1`, [conv]).then((r) => r ?? undefined),
        'the transcribed voice message');
      ok(row.transcription.includes('canvas'), 'the transcript was not stored');
      ok(row.provider_media_id, 'the media id was not kept, so she cannot play it back');
      await until(() => countOf('turns', conv).then((n) => n > 0 || undefined), 'a turn');
      const page = await get(`/app/inbox/${conv}`);
      ok(page.body.includes('<audio'), 'no player on the conversation page');
      ok(page.body.includes('/voice/'), 'the player has no recording to fetch');
      return { conv, note: `heard: "${row.transcription.slice(0, 40)}…"` };
    },
  },
  {
    n: 2, title: 'a photo is described, matched to her catalogue, and answered',
    async run({ sim }) {
      const wa = buyer(2);
      await hook(sim.inboundImage({ from: wa, caption: 'need 5000 like this' }));
      const conv = await convOf(wa);
      const row = await until(() => one(
        `select input_type, ai_analysis->>'photoDescription' as described from messages
          where conversation_id = $1 and input_type in ('image','image_text') limit 1`, [conv]).then((r) => r ?? undefined),
        'the photo message');
      ok(row.described, 'the photo was recorded but never described');
      // `photoDescription` is written only when the match cleared the relevance
      // floor AND the margin over the runner-up — i.e. she is sure which product.
      const state = await until(() => one(
        `select identified_product_id::text as product from conversation_state where conversation_id=$1`, [conv])
        .then((r) => (r?.product ? r : undefined)), 'the product the photo was matched to');
      const p = await one(`select name from products where id=$1`, [state.product]);
      return { conv, note: `matched: ${p.name}` };
    },
  },
  {
    n: 3, title: 'a sticker is recorded and ignored — no reply to nothing',
    async run({ sim }) {
      const wa = buyer(3);
      await hook(sim.inboundText({ from: wa, text: 'Hi there' }));
      const conv = await convOf(wa);
      await until(() => countOf('turns', conv).then((n) => n > 0 || undefined), 'the first turn');
      const before = { turns: await countOf('turns', conv), drafts: await countOf('drafts', conv) };
      await hook(sim.inboundOther({ from: wa, type: 'sticker', body: { id: 'stk-1' } }));
      await until(() => one(
        `select 1 from messages where conversation_id=$1 and ai_analysis->>'received' = 'sticker'`, [conv])
        .then((r) => r ?? undefined), 'the sticker to be recorded');
      await sleep(3000);                              // past the batch window: nothing may follow
      ok(await countOf('turns', conv) === before.turns, 'the sticker ran a turn');
      ok(await countOf('drafts', conv) === before.drafts, 'the sticker produced a draft');
      return { conv, note: 'recorded, no turn, no draft' };
    },
  },
  {
    n: 4, title: 'a PDF reaches a person, named, with his caption kept',
    async run({ sim }) {
      const wa = buyer(4);
      await hook(sim.inboundOther({
        from: wa, type: 'document',
        body: { id: 'doc-1', filename: 'rfq.pdf', mime_type: 'application/pdf', caption: 'RFQ attached' },
      }));
      const conv = await convOf(wa);
      await signalOf(conv, 'media_unreadable');
      const handoff = await eventOf(conv, 'handoff');
      ok(handoff.payload.reason === 'media_unreadable', `handed over for the wrong reason: ${handoff.payload.reason}`);
      const c = await one(`select assigned_to from conversations where id=$1`, [conv]);
      ok(c.assigned_to !== null, 'the document did not hand the conversation to a person');
      const msg = await one(`select text_content from messages where conversation_id=$1 order by sent_at desc limit 1`, [conv]);
      ok((msg?.text_content ?? '').includes('RFQ'), 'his caption was dropped');
      return { conv, note: 'handed over, caption kept' };
    },
  },
  {
    n: 5, title: 'a quote inside a closure promises no date, and says why',
    async run({ sim }) {
      const wa = buyer(5);
      await hook(sim.inboundText({ from: wa, text: 'Do you have canvas tote bags? I need 5000 pcs.' }));
      const conv = await convOf(wa);
      const quote = await until(() => one(
        `select lead_time_days, lead_time_withheld, unit_price_usd from quotes
          where conversation_id=$1 order by created_at desc limit 1`, [conv]).then((r) => r ?? undefined), 'a quote');
      ok(quote.lead_time_days === null, `a date was promised inside the closure: ${quote.lead_time_days} days`);
      ok(quote.lead_time_withheld, 'the closure that withheld the date was not recorded');
      const page = await get(`/app/inbox/${conv}`);
      ok(page.body.includes('Factory holiday'), 'her closure is not named on the conversation');
      return { conv, note: `no date; withheld by "${quote.lead_time_withheld.label}"` };
    },
  },
  {
    n: 6, title: 'a price higher than one he already has waits for her',
    async run({ sim }) {
      const wa = buyer(6);
      await hook(sim.inboundText({ from: wa, text: 'Canvas tote bags, 5000 pcs please.' }));
      const conv = await convOf(wa);
      const first = await until(() => one(
        `select unit_price_usd from quotes where conversation_id=$1 order by created_at desc limit 1`, [conv])
        .then((r) => r ?? undefined), 'the first quote');
      // The price she gave him must count as history, so it has to have gone out.
      await until(() => one(
        `select 1 from outbound_messages o join conversations c on c.id=o.conversation_id
          where o.conversation_id=$1`, [conv]).then((r) => r ?? undefined), 'the first quote to be sent');
      await q(`update price_tiers set unit_price_usd = unit_price_usd * 1.4
                where product_id = (select id from products where business_id=$1 and sku='ZX-100')`, [BIZ]);
      await hook(sim.inboundText({ from: wa, text: 'Now I need 8000 pcs.' }));
      const held = await until(() => one(
        `select payload from conversation_events where conversation_id=$1 and type='draft_pending'
           and payload->>'heldBecause' = 'contradicts_history' order by created_at desc limit 1`, [conv])
        .then((r) => r ?? undefined), 'the held draft');
      ok(held.payload.contradicts, 'the card has no prices to show her');
      const page = await get(`/app/inbox/${conv}`);
      ok(page.body.includes('held-then'), 'both prices are not shown on the draft card');
      await q(`update price_tiers set unit_price_usd = round(unit_price_usd / 1.4, 4)
                where product_id = (select id from products where business_id=$1 and sku='ZX-100')`, [BIZ]);
      return { conv, note: `was $${Number(first.unit_price_usd)}, now higher — held` };
    },
  },
  {
    n: 7, title: 'a discount past her ask-me line waits for her',
    async run({ sim }) {
      const wa = buyer(7);
      await hook(sim.inboundText({ from: wa, text: 'I want 10000 canvas tote bags.' }));
      const conv = await convOf(wa);
      const held = await until(() => one(
        `select payload from conversation_events where conversation_id=$1 and type='draft_pending'
           and payload->>'heldBecause' = 'discount_needs_owner' order by created_at desc limit 1`, [conv])
        .then((r) => r ?? undefined), 'the held draft');
      const quote = await one(
        `select requires_human, discount_pct from quotes where conversation_id=$1 order by created_at desc limit 1`, [conv]);
      ok(quote.requires_human, 'the quote was not marked as needing her');
      ok(Number(quote.discount_pct) > 5, `the discount did not pass her line: ${quote.discount_pct}%`);
      ok(held, 'no held draft');
      return { conv, note: `${Number(quote.discount_pct)}% off — above her 5%` };
    },
  },
  {
    n: 8, title: 'a word she forbade never reaches him — in her employee’s words or her own',
    async run({ sim }) {
      const wa = buyer(8);
      scripted.reply = 'Our catalogue lists every size we make.';        // the word she forbade
      await hook(sim.inboundText({ from: wa, text: 'Can you tell me about your bags?' }));
      const conv = await convOf(wa);
      const violation = await eventOf(conv, 'guard_violation');
      const terms = (violation.payload.forbidden ?? []).map((f) => f.term ?? f);
      ok(terms.some((t) => String(t).includes('catalogue')), `the forbidden word was not named: ${JSON.stringify(terms)}`);
      const sent = await q(`select body from outbound_messages where conversation_id=$1`, [conv]);
      ok(!sent.some((s) => /catalogue/i.test(s.body)), 'the forbidden word reached the buyer');
      scripted.reply = null;

      // …and the same word inside HER OWN taught answer: shown to her, tagged,
      // and never counted against the employee who did not write it.
      const wa2 = buyer(9);
      await hook(sim.inboundText({ from: wa2, text: 'Do you print logos?' }));
      const conv2 = await convOf(wa2);
      const hers = await eventOf(conv2, 'forbidden_in_her_text');
      ok(hers.payload.hits?.[0]?.path === 'taught_answer', `wrong path: ${JSON.stringify(hers.payload.hits)}`);
      const page = await get(`/app/inbox/${conv2}`);
      ok(page.body.includes('/app/knowledge'), 'her own words are not shown to her with a way to fix them');
      return { conv, note: 'stopped in both paths' };
    },
  },
  {
    n: 9, title: 'a reply that fails her rules twice becomes a stand-in, held for her',
    async run({ sim }) {
      const wa = buyer(5);                                  // reuse: a second question
      scripted.reply = 'Yes — these bags are CE certified and FDA approved.';   // she authorised neither
      await hook(sim.inboundText({ from: wa, text: 'Are these certified?' }));
      const conv = await convOf(wa);
      const held = await until(() => one(
        `select payload from conversation_events where conversation_id=$1 and type='draft_pending'
           and payload->>'heldBecause' = 'guards_failed_twice' order by created_at desc limit 1`, [conv])
        .then((r) => r ?? undefined), 'the held stand-in draft');
      const draft = await one(
        `select draft_text from drafts where conversation_id=$1 order by created_at desc limit 1`, [conv]);
      ok(!/CE certified|FDA/i.test(draft.draft_text), `the unauthorised claim survived: ${draft.draft_text}`);
      const sent = await q(`select body from outbound_messages where conversation_id=$1`, [conv]);
      ok(!sent.some((s) => /CE certified|FDA/i.test(s.body)), 'an unauthorised claim reached the buyer');
      scripted.reply = null;
      ok(held, 'nothing was held');
      return { conv, note: 'stand-in drafted, nothing claimed' };
    },
  },
  {
    n: 10, title: 'a confirmed order answers "where is my order?" in a new conversation',
    async run({ sim }) {
      const wa = buyer(6);
      const conv = await convOf(wa);
      // Stage the conversation the way a real one arrives at the close: his
      // e-mail captured, the product confirmed, a quote on the table.
      await q(`update clients set email='buyer@example.com'
                where id = (select client_id from conversations where id=$1)`, [conv]);
      await q(`update conversation_state set product_confirmed_by_client=true, client_email_collected=true,
                 pending_question='order_confirmation' where conversation_id=$1`, [conv]);
      await hook(sim.inboundText({ from: wa, text: 'yes' }));
      const order = await until(() => one(
        `select o.id::text as id, o.order_reference from orders o
          where o.business_id=$1 and o.client_id = (select client_id from conversations where id=$2)
          order by o.created_at desc limit 1`, [BIZ, conv]).then((r) => r ?? undefined), 'the order');
      const head = await one(
        `select state from order_updates where order_id=$1 order by at asc limit 1`, [order.id]);
      ok(head?.state === 'confirmed', `the order has no first state row: ${JSON.stringify(head)}`);

      await form(`/app/orders/${order.id}/update`, { state: 'in_production', note: 'cutting started', tracking: '' });
      // He writes again. Confirming CLOSED that conversation, so this is a new
      // one — which is the whole point: the lookup is by buyer, not by thread.
      await hook(sim.inboundText({ from: wa, text: 'where is my order?' }));
      const fresh = await until(() => one(
        `select c.id::text as id from conversations c
           join client_channels cc on cc.client_id = c.client_id and cc.channel='whatsapp'
          where cc.channel_user_id=$1 and c.business_id=$2 and c.id <> $3 and c.is_active
          order by c.created_at desc limit 1`, [wa, BIZ, conv]).then((r) => r?.id), 'a new conversation');
      const said = await until(() => one(
        `select body from outbound_messages where conversation_id=$1 order by created_at desc limit 1`, [fresh])
        .then((r) => r ?? undefined), 'the status answer');
      ok(said.body.includes(order.order_reference), `his order was not named: ${said.body}`);
      ok(/production/i.test(said.body), `the state was not told to him: ${said.body}`);
      return { conv, note: `${order.order_reference} · in production` };
    },
  },
  {
    n: 11, title: 'each buyer has his own 24-hour window, and a late approval says so',
    async run({ sim }) {
      const fresh = buyer(2);                    // wrote just now, in scenario 2
      const stale = buyer(3);
      // The chatty buyer's message must not hold the quiet one's window open.
      await q(`update client_channels set last_inbound_at = now() - interval '25 hours'
                where channel='whatsapp' and channel_user_id=$1`, [stale]);
      await hook(sim.inboundText({ from: fresh, text: 'Still interested — what is the price for 5000?' }));
      const freshConv = await convOf(fresh);
      const staleConv = await convOf(stale);
      const d1 = await draftOf(freshConv).catch(() => null);
      if (d1) {
        const flash = await approve(freshConv, d1.id);
        ok(!/can.t message|window/i.test(flash), `an open window was refused: ${flash}`);
      }
      // A draft for the quiet buyer, approved past his window.
      await q(`insert into drafts (business_id, conversation_id, capability, draft_text, turn_message_id, status)
               values ($1,$2,'quote','Following up on your enquiry.',null,'pending')`, [BIZ, staleConv]);
      const d2 = await draftOf(staleConv);
      const flash = await approve(staleConv, d2.id);
      ok(/can.t message|as soon as/i.test(flash), `a closed window did not say why: "${flash}"`);
      const after = await one(`select status from drafts where id=$1`, [d2.id]);
      ok(after.status === 'pending', `the draft did not survive the refusal: ${after.status}`);
      return { conv: staleConv, note: 'late approval refused, draft kept' };
    },
  },
  {
    n: 12, title: 'a number she never listed is recorded and shown — and costs no model call',
    async run({ sim }) {
      const wa = buyer(0);                        // never added to the allowlist
      await hook(sim.inboundText({ from: wa, text: 'Hello, do you make canvas bags?' }));
      const conv = await convOf(wa);
      await signalOf(conv, 'unlisted_number');
      const c = await one(`select assigned_to from conversations where id=$1`, [conv]);
      ok(c.assigned_to !== null, 'an unlisted number was left with the employee');
      await sleep(3000);                          // past the batch window
      ok(await countOf('turns', conv) === 0, 'a model was asked about an unlisted number');
      ok(await countOf('drafts', conv) === 0, 'a draft was written that could never be sent');
      const page = await get(`/app/inbox/${conv}`);
      ok(page.body.includes('canvas bags'), 'his message is not on her timeline');
      return { conv, note: 'recorded, shown, no model call' };
    },
  },
];

/* ── run ─────────────────────────────────────────────────────────────────── */

async function main() {
  console.log(`\npre-pilot walkthrough · ${LIVE ? 'the REAL model writes the replies' : 'scripted replies'} · tenant ${BIZ}\n`);
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const { prod, sim } = await setup();
  const receipts = startReceipts(sim);
  const results = [];
  console.log('');
  try {
    for (const s of scenarios) {
      if (only.length && !only.includes(String(s.n))) continue;
      const started = Date.now();
      try {
        const out = await s.run({ sim, prod });
        results.push({ n: s.n, title: s.title, ok: true, note: out?.note ?? '', ms: Date.now() - started });
        console.log(`  ✓ ${String(s.n).padStart(2)} ${s.title}${out?.note ? ` — ${out.note}` : ''}`);
        if (out?.conv) {
          const page = await get(`/app/inbox/${out.conv}`);
          await writeFile(path.join(OUT, `${s.n}-${out.conv}.html`), page.body);
        }
      } catch (err) {
        results.push({ n: s.n, title: s.title, ok: false, note: err.message, ms: Date.now() - started });
        console.log(`  ✗ ${String(s.n).padStart(2)} ${s.title}\n       ${err.message}`);
      }
    }
  } finally {
    clearInterval(receipts);
    await writeFile(path.join(OUT, 'report.json'), JSON.stringify({ tenant: BIZ, live: LIVE, results }, null, 2));
    if (!flag('keep')) { await prod.close(); await db.end(); }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n  ${results.length - failed.length} of ${results.length} scenarios passed · pages and report in ${OUT}`);
  if (flag('keep')) console.log(`  the app is still running on ${BASE} (login code ${CODE}) — stop it with ctrl-c`);
  if (failed.length) { console.log(`  ${failed.length} to look at: ${failed.map((f) => f.n).join(', ')}\n`); process.exit(1); }
  console.log('');
  if (!flag('keep')) process.exit(0);
}

main().catch(async (err) => { console.error(err); process.exit(1); });
