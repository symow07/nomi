import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { seedRunTenant, RUN_BIZ, RUN_NS, runPhone } from './tenant.js';
import { FakeAnalyzer, FakeReplyWriter } from '../pipeline/fakes.js';
import type { Transcriber } from '../../src/llm/transcribe.js';
import type { VisionDescriber } from '../../src/llm/ports.js';

/**
 * G2b — a voice note and a photo, through the PRODUCTION composition.
 *
 * M34 and M4.5 were each "built": wired into the worker, tested, reachable by
 * every module check. Neither ever ran, because the worker was never handed a
 * transcriber or a media fetcher. Every existing test either called the
 * pipeline directly or read the worker's source text, so none of them could
 * see it.
 *
 * This one goes the whole way: a signed webhook → the real ingress → pg-boss →
 * the real worker → the real fetchers against the simulator's media endpoint →
 * a turn → a draft. Only three things are fakes, and each stands in for a paid
 * external account: the speech-to-text provider, and the two model calls.
 */

const DATABASE_URL = process.env['DATABASE_URL'];
const d = DATABASE_URL ? describe : describe.skip;

const until = async <T>(probe: () => Promise<T | undefined>, what: string, ms = 30_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

d('G2b · she hears a voice note and sees a photo in production (requires DATABASE_URL)', () => {
  let prod: import('../../src/main.js').Production;
  let sim: import('../../src/channels/whatsapp/simulator.js').Simulator;
  const heardAudio: string[] = [];
  const seenImages: string[] = [];

  const analyzer = new FakeAnalyzer();
  analyzer.next = {
    language: { detected: 'ar', replyIn: 'ar' },
    intent: { primary: 'inquiry', productCandidate: null, quantityMentioned: null, nextLogicalQuestion: null, missingFields: [] },
    recommendedPhase: 'clarification',
  };
  const replyWriter = new FakeReplyWriter();
  replyWriter.replies = ['Yes, we make bamboo cutting boards.'];

  // Whisper reports a language NAME. The product must store the code.
  // `hearOk` lets one test play a note the provider could not make out.
  let hearOk = true;
  const transcriber: Transcriber = async (audio) => {
    heardAudio.push(audio.mediaType);
    return hearOk
      ? { ok: true, text: 'Do you make bamboo cutting boards?', language: 'arabic' }
      : { ok: false, retryable: false, error: 'transcription 422' };
  };
  const vision: VisionDescriber = {
    async describe(input) {
      seenImages.push(input.mediaType);
      return {
        searchText: 'bamboo cutting board', attributes: ['bamboo', 'cutting board'],
        promptVersion: 'test@1', modelId: 'fake-vision', usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };

  const post = (w: { rawBody: string; headers: Record<string, string> }) =>
    prod.app.inject({ method: 'POST', url: '/webhook/whatsapp',
      payload: w.rawBody, headers: { 'content-type': 'application/json', ...w.headers } });

  const wamidOf = (w: { payload: unknown }) =>
    (w.payload as { entry: { changes: { value: { messages: { id: string }[] } }[] }[] })
      .entry[0]!.changes[0]!.value.messages[0]!.id;

  /**
   * Her answer to the message, whichever road it took. Which road is the
   * capability's autonomy mode, and not what this file tests: in draft mode it
   * waits for the owner as a draft; in auto mode it enters the ONE send path as
   * an outbound row (where, with messaging not activated here, the gate cancels
   * it — which is the gate working, not the answer missing).
   */
  const answerTo = (wamid: string) => tenant((tx) => sql<{ text: string }>`
    select d.draft_text as text from drafts d where d.turn_message_id = ${wamid}
    union all
    select o.body as text from outbound_messages o
     where o.origin = 'employee'
       and o.conversation_id = (select conversation_id from messages where external_id = ${wamid})
  `.execute(tx).then((r) => r.rows[0]));

  const tenant = async <T>(fn: (tx: import('../../src/db/client.js').Db) => Promise<T>) => {
    const { withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    return withTenantTx(prod.db, bid.value, fn as never) as Promise<T>;
  };

  beforeAll(async () => {
    await seedRunTenant();
    const { buildProduction } = await import('../../src/main.js');
    const { whatsappSimulator, SIM_MEDIA_BASE } = await import('../../src/channels/whatsapp/simulator.js');
    const { whatsappAudioFetcher, whatsappMediaFetcher } = await import('../../src/channels/whatsapp/media.js');
    const { createDb, withTenantTx } = await import('../../src/db/client.js');
    const { parseBusinessId } = await import('../../src/core/types/ids.js');

    sim = whatsappSimulator([], { tag: `${RUN_NS}g2b` });
    const setup = createDb(DATABASE_URL!);
    const bid = parseBusinessId(RUN_BIZ); if (!bid.ok) throw new Error('fixture');
    await withTenantTx(setup, bid.value, (tx) => sql`
      insert into channel_credentials (business_id, channel, external_ref, secret_ref, engine)
      values (${RUN_BIZ}, 'whatsapp', ${sim.phoneNumberId}, 'sim-test', 'service')
      on conflict (channel, external_ref) do nothing
    `.execute(tx));
    await setup.destroy();

    // G13 — the Command Center resolves the owner's tenant from the
    // environment, not from the cfg it is handed, so a session here would
    // otherwise look at whichever business another file left behind.
    process.env['PILOT_BUSINESS_ID'] = RUN_BIZ;
    const media = { baseUrl: SIM_MEDIA_BASE, apiKey: 'sim', fetchImpl: sim.mediaFetch };
    prod = await buildProduction({
      provider: 'meta',
      DATABASE_URL: DATABASE_URL!,
      ANTHROPIC_API_KEY: 'test-key-not-real-just-shape-valid',
      META_WHATSAPP_ACCESS_TOKEN: 'meta-token-not-real-shape-ok',
      META_WHATSAPP_PHONE_NUMBER_ID: '123456789012345',
      META_WHATSAPP_BUSINESS_ACCOUNT_ID: '987654321098765',
      META_APP_SECRET: 'meta-app-secret-not-real',
      META_GRAPH_API_VERSION: 'v23.0',
      WEBHOOK_VERIFY_TOKEN: 'g2b-verify-token-x',
      CREDENTIAL_KEY: 'a'.repeat(64),
      PORT: 0,
    }, {
      adapter: sim.adapter, logger: false,
      media: { transcriber, audio: whatsappAudioFetcher(media), image: whatsappMediaFetcher(media) },
      models: { analyzer, replyWriter, vision },
    });
  }, 60_000);

  afterAll(async () => { await prod?.close(); });

  it('a voice note is downloaded, transcribed, recorded, and answered', async () => {
    const w = sim.inboundAudio({ from: runPhone('971500009901') });
    expect((await post(w)).statusCode).toBe(200);
    const wamid = wamidOf(w);

    const heard = await until(() => tenant((tx) => sql<{
      input_type: string; text_content: string | null; detected_language: string | null;
    }>`select input_type, text_content, detected_language from messages where external_id = ${wamid}`
      .execute(tx).then((r) => r.rows[0])), 'the voice note to be recorded');

    // The ogg the provider sent reached the transcriber, codec parameter stripped.
    expect(heardAudio).toContain('audio/ogg');
    expect(heard).toEqual({
      input_type: 'voice_transcribed',
      text_content: 'Do you make bamboo cutting boards?',
      detected_language: 'ar',
    });

    // And she answered what she heard.
    const answer = await until(() => answerTo(wamid), 'an answer to the voice note');
    expect(answer.text).toBe('Yes, we make bamboo cutting boards.');
  }, 45_000);

  /* ── G13 · she can play the note she is asked to correct ───────────────── */

  const login = async () => {
    const res = await prod.app.inject({ method: 'POST', url: '/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `code=${encodeURIComponent(prod.ownerAccessCode)}` });
    return String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  };

  it('G13 · the recording is kept as a HANDLE and streamed back on demand', async () => {
    hearOk = false;                                   // a note she could not make out
    const w = sim.inboundAudio({ from: runPhone('971500009911') });
    expect((await post(w)).statusCode).toBe(200);
    const wamid = wamidOf(w);
    const row = await until(() => tenant((tx) => sql<{ id: string; conv: string; media: string | null }>`
      select id::text as id, conversation_id::text as conv, provider_media_id as media
        from messages where external_id = ${wamid}`.execute(tx).then((r) => r.rows[0])), 'the note');
    hearOk = true;
    // The provider's id, not a URL: a download link is signed and expires.
    expect(row.media).toBeTruthy();
    expect(row.media).not.toMatch(/^https?:/);

    const cookie = await login();
    const played = await prod.app.inject({
      method: 'GET', url: `/app/inbox/${row.conv}/voice/${row.id}`, headers: { cookie },
    });
    expect(played.statusCode).toBe(200);
    expect(String(played.headers['content-type'])).toContain('audio/');
    expect(played.headers['cache-control']).toBe('private, no-store');
    expect(played.rawPayload.length).toBeGreaterThan(0);

    // And the page offers it, beside the words she is being asked to fix.
    const page = await prod.app.inject({ method: 'GET', url: `/app/inbox/${row.conv}`, headers: { cookie } });
    expect(page.body).toContain(`/voice/${row.id}`);
    expect(page.body).toContain('<audio');
  }, 45_000);

  it('G13 · without a session it is not playable at all', async () => {
    const row = await tenant((tx) => sql<{ id: string; conv: string }>`
      select id::text as id, conversation_id::text as conv from messages
       where provider_media_id is not null order by sent_at desc limit 1`.execute(tx).then((r) => r.rows[0]!));
    const res = await prod.app.inject({ method: 'GET', url: `/app/inbox/${row.conv}/voice/${row.id}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login');
  }, 20_000);

  it('G13 · a note with no recording says so rather than pretending', async () => {
    const cookie = await login();
    const conv = await tenant((tx) => sql<{ id: string }>`
      select conversation_id::text as id from messages where provider_media_id is not null limit 1
    `.execute(tx).then((r) => r.rows[0]!.id));
    // A voice row from before 0043: recorded, with no handle to fetch.
    const old = await tenant((tx) => sql<{ id: string }>`
      insert into messages (conversation_id, external_id, direction, input_type, text_content, sent_at)
      values (${conv}::uuid, ${'legacy-' + Date.now()}, 'inbound', 'voice_transcribed', 'ten thousand pieces', now())
      returning id::text as id`.execute(tx).then((r) => r.rows[0]!.id));
    const res = await prod.app.inject({ method: 'GET', url: `/app/inbox/${conv}/voice/${old}`, headers: { cookie } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('no longer has this recording');
    const page = await prod.app.inject({ method: 'GET', url: `/app/inbox/${conv}`, headers: { cookie } });
    expect(page.body).toContain('The recording is not kept for this one.');
  }, 20_000);

  it('G13 · she types what he said and asks for an answer — the ordinary turn runs on her words', async () => {
    const cookie = await login();
    hearOk = false;
    const w = sim.inboundAudio({ from: runPhone('971500009912') });
    expect((await post(w)).statusCode).toBe(200);
    const wamid = wamidOf(w);
    const row = await until(() => tenant((tx) => sql<{ id: string; conv: string }>`
      select id::text as id, conversation_id::text as conv from messages where external_id = ${wamid}
    `.execute(tx).then((r) => r.rows[0])), 'the unheard note');
    hearOk = true;

    const form = (url: string, payload: string) => prod.app.inject({
      method: 'POST', url, headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload,
    });
    expect((await form(`/app/inbox/${row.conv}/heard`,
      `messageId=${row.id}&heard=${encodeURIComponent('Do you make bamboo cutting boards?')}`)).statusCode).toBe(302);
    const asked = await form(`/app/inbox/${row.conv}/answer-now`, `messageId=${row.id}`);
    expect(asked.statusCode).toBe(302);
    expect(decodeURIComponent(String(asked.headers['location']))).toContain('answering your words');

    // Her words, answered through the same pipeline as anything else.
    const answer = await until(() => tenant((tx) => sql<{ text: string }>`
      select d.draft_text as text from drafts d where d.turn_message_id = ${row.id + ':answer'}
      union all
      select o.body as text from outbound_messages o
       where o.conversation_id = ${row.conv}::uuid and o.origin = 'employee'
    `.execute(tx).then((r) => r.rows[0])), 'an answer to her words');
    expect(answer.text).toBe('Yes, we make bamboo cutting boards.');
  }, 45_000);

  it('a photo is downloaded, described, and matched to her own catalogue', async () => {
    const w = sim.inboundImage({ from: runPhone('971500009902'), caption: null });
    expect((await post(w)).statusCode).toBe(200);
    const wamid = wamidOf(w);

    const row = await until(() => tenant((tx) => sql<{ ai_analysis: { photoDescription?: string } | null }>`
      select ai_analysis from messages where external_id = ${wamid}
    `.execute(tx).then((r) => r.rows[0])), 'the photo to be recorded');

    expect(seenImages).toContain('image/jpeg');
    // `photoDescription` is written only when the match cleared both the
    // relevance floor and the margin over the runner-up — a matched photo.
    expect(row.ai_analysis?.photoDescription).toContain('bamboo');

    const answer = await until(() => answerTo(wamid), 'an answer to the photo');
    expect(answer.text).toBe('Yes, we make bamboo cutting boards.');
  }, 45_000);

  /* ── G2c · what she cannot read reaches a person ─────────────────────── */

  const conversationOf = (wamid: string) => tenant((tx) => sql<{
    id: string; assigned_to: string | null; input_type: string; received: string | null; text_content: string | null;
  }>`
    select c.id, c.assigned_to, m.input_type, m.ai_analysis->>'received' as received, m.text_content
      from messages m join conversations c on c.id = m.conversation_id
     where m.external_id = ${wamid}
  `.execute(tx).then((r) => r.rows[0]));

  const activeSignal = (conversationId: string, kind: string) => tenant((tx) => sql<{ payload: Record<string, unknown> }>`
    select payload from conversation_signals
     where conversation_id = ${conversationId} and kind = ${kind} and resolved_at is null
  `.execute(tx).then((r) => r.rows[0]));

  it('G2c · a sticker is recorded and ignored — no reply to nothing', async () => {
    const w = sim.inboundOther({ from: runPhone('971500009903'), type: 'sticker', body: { id: 'stk-1' } });
    expect((await post(w)).statusCode).toBe(200);
    const wamid = wamidOf(w);
    const c = await until(() => conversationOf(wamid), 'the sticker to be recorded');
    expect(c).toMatchObject({ input_type: 'unknown', received: 'sticker', assigned_to: null });
    // The job has committed: no turn ran, so there is no answer and never will be.
    expect(await answerTo(wamid)).toBeUndefined();
  }, 45_000);

  it('G2c · a document goes to a person, named, with his caption kept', async () => {
    const w = sim.inboundOther({
      from: runPhone('971500009904'), type: 'document',
      body: { id: 'doc-1', filename: 'rfq.pdf', mime_type: 'application/pdf', caption: 'RFQ attached' },
    });
    expect((await post(w)).statusCode).toBe(200);
    const wamid = wamidOf(w);
    const c = await until(() => conversationOf(wamid), 'the document to be recorded');
    expect(c).toMatchObject({ input_type: 'unknown', received: 'document', text_content: 'RFQ attached' });
    // Waiting for a person — it is now under "needs you".
    expect(c.assigned_to).toBe('unclaimed');
    expect(await activeSignal(c.id, 'media_unreadable')).toMatchObject({ payload: { received: 'document' } });
    // And no confident answer to a file she never opened.
    expect(await answerTo(wamid)).toBeUndefined();
  }, 45_000);

  it('G2c · a voice note she could not hear goes to a person, and counts on Today', async () => {
    hearOk = false;
    try {
      const w = sim.inboundAudio({ from: runPhone('971500009905') });
      expect((await post(w)).statusCode).toBe(200);
      const wamid = wamidOf(w);
      const c = await until(() => conversationOf(wamid), 'the unheard note to be recorded');
      expect(c).toMatchObject({ input_type: 'voice', assigned_to: 'unclaimed' });
      expect(await answerTo(wamid)).toBeUndefined();

      const { loadPilotFeedback } = await import('../../src/api/web/pilot.js');
      const today = await loadPilotFeedback(prod.db, RUN_BIZ, 'today');
      expect(today.handoffReasons.map((r) => r.kind)).toContain('audio_unheard');
      expect(today.handoffReasons.map((r) => r.kind)).toContain('media_unreadable');
    } finally {
      hearOk = true;
    }
  }, 45_000);
});
