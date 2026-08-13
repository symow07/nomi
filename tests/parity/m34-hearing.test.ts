import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { decideHearing } from '../../src/core/conversation/hearing.js';
import { hearVoiceNote } from '../../src/pipeline/voiceTurn.js';
import { whisperTranscriber, MAX_AUDIO_BYTES } from '../../src/llm/transcribe.js';
import { renderConversationDetail, type ConversationDetail } from '../../src/api/web/inbox.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { isProblemSignal } from '../../src/core/scoring/signals.js';

/**
 * M34 — she can hear, and when she cannot she says so.
 *
 * THE ONE INVARIANT THIS FILE EXISTS FOR: a voice note is heard or it is
 * refused. Never silence, never an answer to a question nobody asked. Before
 * this milestone the webhook parser had recognised audio since M3 and nothing
 * downstream looked — so an unheard question reached `computeTurn` as empty
 * text and she replied confidently to it.
 */

const NOW = new Date('2026-08-11T10:00:00Z');
const OK_AUDIO = { ok: true as const, retryable: false, error: '' };

/* ── fail closed, on every road to failure ───────────────────────────────── */

describe('M34 · an unheard voice note is refused, never treated as silence', () => {
  /**
   * Each row is a different way the hearing can fail. What matters is that ALL
   * of them end in `unheard` — a table rather than four tests, so a new failure
   * mode added to `decideHearing` without a row here is visible as a gap.
   */
  const failures = [
    ['no transcriber configured', { transcriberConfigured: false, mediaId: 'm1' }, 'not_configured'],
    ['audio message with no media id', { transcriberConfigured: true, mediaId: null }, 'no_media'],
    ['media download failed', {
      transcriberConfigured: true, mediaId: 'm1',
      fetch: { ok: false, retryable: true, error: 'media bytes 500' },
    }, 'transcription_failed'],
    ['format nothing can open', {
      transcriberConfigured: true, mediaId: 'm1',
      fetch: { ok: false, retryable: false, error: 'unsupported audio: audio/x-weird' },
    }, 'unsupported_format'],
    ['provider refused', {
      transcriberConfigured: true, mediaId: 'm1', fetch: OK_AUDIO,
      transcript: { ok: false as const, retryable: true, error: 'transcription 503' },
    }, 'transcription_failed'],
    ['transcript with no words in it', {
      transcriberConfigured: true, mediaId: 'm1', fetch: OK_AUDIO,
      transcript: { ok: true as const, text: '  …?!  ', language: 'en' },
    }, 'transcription_failed'],
  ] as const;

  for (const [name, input, reason] of failures) {
    it(`${name} → unheard (${reason})`, () => {
      const out = decideHearing(input);
      expect(out.kind).toBe('unheard');
      if (out.kind === 'unheard') expect(out.reason).toBe(reason);
    });
  }

  it('a real transcript is heard, and carries the language the provider reported', () => {
    const out = decideHearing({
      transcriberConfigured: true, mediaId: 'm1', fetch: OK_AUDIO,
      transcript: { ok: true, text: '  Do you make canvas tote bags?  ', language: 'en' },
    });
    expect(out).toEqual({ kind: 'heard', transcript: 'Do you make canvas tote bags?', language: 'en' });
  });

  it('an unheard note is a PROBLEM signal — it gates the close like an unclear photo', () => {
    expect(isProblemSignal({ kind: 'audio_unheard', reason: 'transcription_failed' })).toBe(true);
  });

  it('no transcriber configured: hearVoiceNote refuses without touching the network', async () => {
    let called = false;
    const out = await hearVoiceNote(
      { audio: async () => { called = true; return { ok: true, base64: 'AA==', mediaType: 'audio/ogg' }; } },
      'media-1',
    );
    expect(out.kind).toBe('unheard');
    if (out.kind === 'unheard') expect(out.reason).toBe('not_configured');
    expect(called, 'must not download audio it cannot transcribe').toBe(false);
  });

  it('a provider outage is retryable; an expired media id is not', async () => {
    const gone = await hearVoiceNote({
      transcriber: async () => ({ ok: false, retryable: false, error: 'x' }),
      audio: async () => ({ ok: false, retryable: false, error: 'media meta 404' }),
    }, 'dead');
    const flaky = await hearVoiceNote({
      transcriber: async () => ({ ok: false, retryable: true, error: 'transcription 503' }),
      audio: async () => ({ ok: true, base64: 'AA==', mediaType: 'audio/ogg' }),
    }, 'ok');
    expect(gone.kind === 'unheard' && gone.retryable).toBe(false);
    expect(flaky.kind === 'unheard' && flaky.retryable).toBe(true);
  });
});

/* ── the worker is actually wired to it (the M4 lesson) ──────────────────── */

describe('M34 · the pipeline is CALLED, not merely built', () => {
  /**
   * `imageTurn.ts` was written in M4 and never called from the worker — a whole
   * pipeline only its own tests exercised, which is why the roadmap could claim
   * the vision half "exists" while no buyer photo ever reached it. This asserts
   * the audio path does not repeat that: the worker imports the pipeline, calls
   * it, and refuses on `unheard`.
   */
  it('worker/main.ts hears audio jobs and records the refusal', async () => {
    const src = await readFile(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    expect(src).toContain('hearVoiceNote');
    expect(src).toMatch(/messageType === 'audio'/);
    expect(src, 'an unheard note must record the signal').toMatch(/kind: 'audio_unheard'/);
    expect(src, 'and must not reach computeTurn').toMatch(/if \(heard\?\.kind === 'unheard'\)/);
  });

  it('the transcript becomes the turn text — one pipeline, not two', async () => {
    const src = await readFile(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    // Assert the SHAPE, not the exact expression: this originally pinned the
    // literal ternary and broke the moment M4.5 added the photo branch beside
    // it — pinned source text, the brittleness this repo keeps paying for.
    // What matters is that the turn's text can come from a transcript and
    // falls back to what the buyer typed.
    const req = src.slice(src.indexOf('const req = {'), src.indexOf('const result = await computeTurn'));
    expect(req).toContain('heard.transcript');
    expect(req).toContain('job.data.text');
  });

  it('the ingress carries what the parser already knew', async () => {
    const src = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/messageType: e\.messageType/);
    expect(src).toMatch(/mediaId: e\.mediaId/);
  });
});

/* ── the Whisper adapter refuses rather than inventing ───────────────────── */

describe('M34 · the transcriber fails closed', () => {
  const key = 'sk-test';

  it('refuses a format it cannot send, without calling the provider', async () => {
    let called = false;
    const tr = whisperTranscriber({ apiKey: key, fetchImpl: (async () => { called = true; return new Response('{}'); }) as typeof fetch });
    const r = await tr({ base64: 'AA==', mediaType: 'video/mp4' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryable).toBe(false);
    expect(called).toBe(false);
  });

  it('refuses audio past the ceiling rather than paying for it', async () => {
    const tr = whisperTranscriber({ apiKey: key, fetchImpl: (async () => new Response('{}')) as typeof fetch });
    const big = Buffer.alloc(MAX_AUDIO_BYTES + 1).toString('base64');
    const r = await tr({ base64: big, mediaType: 'audio/ogg' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too large/);
  });

  it('an EMPTY transcript is a refusal — the buyer said something', async () => {
    const tr = whisperTranscriber({
      apiKey: key,
      fetchImpl: (async () => new Response(JSON.stringify({ text: '   ', language: 'ar' }))) as typeof fetch,
    });
    const r = await tr({ base64: Buffer.from('audio').toString('base64'), mediaType: 'audio/ogg' });
    expect(r.ok, 'a blank transcript is not a successful reading of silence').toBe(false);
  });

  it('429 and 5xx are retryable; a 400 is not', async () => {
    const at = (status: number) => whisperTranscriber({
      apiKey: key, fetchImpl: (async () => new Response('{}', { status })) as typeof fetch,
    })({ base64: Buffer.from('a').toString('base64'), mediaType: 'audio/ogg' });
    for (const s of [429, 500, 503]) {
      const r = await at(s);
      expect(r.ok === false && r.retryable, `status ${s}`).toBe(true);
    }
    const bad = await at(400);
    expect(bad.ok === false && bad.retryable).toBe(false);
  });

  it('never puts the API key or a provider body into the error it returns', async () => {
    const tr = whisperTranscriber({
      apiKey: 'sk-super-secret-value',
      fetchImpl: (async () => new Response('{"error":{"message":"buyer said X"}}', { status: 400 })) as typeof fetch,
    });
    const r = await tr({ base64: Buffer.from('a').toString('base64'), mediaType: 'audio/ogg' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).not.toContain('sk-super-secret-value');
      expect(r.error).not.toContain('buyer said X');
    }
  });

  it('sends the audio as a real upload and reports the language back', async () => {
    let sentModel: unknown = null;
    const tr = whisperTranscriber({
      apiKey: key,
      fetchImpl: (async (_url: string, init: { body: FormData }) => {
        sentModel = init.body.get('model');
        return new Response(JSON.stringify({ text: 'هل تصنعون الأكياس؟', language: 'arabic' }));
      }) as unknown as typeof fetch,
    });
    const r = await tr({ base64: Buffer.from('oggdata').toString('base64'), mediaType: 'audio/ogg' });
    expect(sentModel).toBe('whisper-1');
    expect(r.ok && r.text).toBe('هل تصنعون الأكياس؟');
    expect(r.ok && r.language).toBe('arabic');
  });
});

/* ── what the owner sees ─────────────────────────────────────────────────── */

const detail = (over: Partial<ConversationDetail> = {}): ConversationDetail => ({
  conversationId: 'c1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
  product: { name: null, nameZh: null }, quantity: null, quote: null, order: null,
  messages: [], pendingDraft: null, ownership: 'AI', refusals: [],
  handoffReasons: [], unheardReason: null, lastHumanAction: null, knowledgeUsed: [], rate: null, leadTimeBlocked: null, proof: { quoteId: null, token: null },
  ...over,
});

describe('M34 · the owner is told, in her own language', () => {
  it('the unheard card says what happened, why, and what to do — in all three locales', () => {
    for (const l of LOCALES) {
      const html = renderConversationDetail(
        detail({ unheardReason: 'transcription_failed' }), l, NOW, null);
      expect(html, l).toContain(t(l, 'unheard.title'));
      expect(html, l).toContain(t(l, 'unheard.why.transcription_failed'));
      expect(html, l).toContain(t(l, 'unheard.do.transcription_failed'));
    }
  });

  it('each reason gets its own what-to-do — they are different actions', () => {
    const doings = new Set(
      (['not_configured', 'transcription_failed', 'unsupported_format', 'no_media'] as const)
        .map((r) => t('en', `unheard.do.${r}`)),
    );
    expect(doings.size, 'a shared "something went wrong" would be the M22 defect').toBe(4);
  });

  it('no card when nothing went unheard', () => {
    expect(renderConversationDetail(detail(), 'en', NOW, null)).not.toContain(t('en', 'unheard.title'));
  });

  it('a spoken message is labelled as heard, and offers a correction', () => {
    const html = renderConversationDetail(detail({
      messages: [{ direction: 'inbound', text: 'Do you make tote bags?', at: NOW, heard: 'voice', id: 'm1' }],
    }), 'en', NOW, null);
    expect(html).toContain(t('en', 'voice.heardAs'));
    expect(html).toContain('Do you make tote bags?');
    expect(html).toContain('name="messageId" value="m1"');
    expect(html).toContain('/heard');
  });

  it('when she heard nothing, the bubble says so instead of showing blank', () => {
    const html = renderConversationDetail(detail({
      messages: [{ direction: 'inbound', text: '', at: NOW, heard: 'voice', id: 'm1' }],
    }), 'en', NOW, null);
    expect(html).toContain(t('en', 'voice.notHeard'));
    // …and does NOT also claim to have heard it as something. "Heard as →
    // she could not make out the words" contradicts itself.
    expect(html).not.toContain(t('en', 'voice.heardAs'));
    // The correction form is still offered — that is how the owner supplies
    // the words the machine could not.
    expect(html).toContain('name="messageId" value="m1"');
  });

  it('spoken words keep their own line breaks; the bubble does not keep the markup\'s', async () => {
    const src = await readFile(new URL('../../src/api/web/inbox.ts', import.meta.url), 'utf8');
    // A voiced bubble holds several elements inside a pre-wrap component, so
    // the wrapper opts out and only the words opt back in. Without this the
    // file's own indentation renders as blank lines inside every voice bubble
    // — which no assertion caught and one screenshot did.
    expect(src).toMatch(/\.bubble\.voiced \{[^}]*white-space:normal/);
    expect(src).toMatch(/\.bubble\.voiced \.said \{[^}]*white-space:pre-wrap/);
  });

  it('a corrected transcript shows the owner\'s words AND keeps the original visible', () => {
    const html = renderConversationDetail(detail({
      messages: [{
        direction: 'inbound', text: '20,000 tote bags', at: NOW,
        heard: 'voice_corrected', originalTranscript: 'twenty thousand toe bags', id: 'm1',
      }],
    }), 'en', NOW, null);
    expect(html).toContain('20,000 tote bags');
    expect(html, 'archive, never erase').toContain('twenty thousand toe bags');
    expect(html).toContain(t('en', 'voice.corrected'));
  });

  it('spoken words are in the voice serif; the label about them is not', async () => {
    const src = await readFile(new URL('../../src/api/web/inbox.ts', import.meta.url), 'utf8');
    // .bubble is voiced by the shell; the label is the product speaking ABOUT
    // the speech, so it opts back into the sans family.
    expect(src).toMatch(/\.heard-label \{[^}]*font-family:var\(--font-family\)/);
  });
});

/* ── the correction supersedes, and is recorded as a correction ──────────── */

describe('M34 · a correction supersedes without erasing', () => {
  it('the route keeps the machine reading and records both sides', async () => {
    const src = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    const route = src.slice(src.indexOf("'/app/inbox/:conversationId/heard'"));
    // coalesce() is what makes a SECOND correction keep the ORIGINAL machine
    // reading rather than overwriting it with the owner's first attempt.
    expect(route).toMatch(/transcription = coalesce\(transcription,/);
    expect(route).toContain("'transcript_corrected'");
    expect(route).toMatch(/before:[\s\S]{0,80}after: heard/);
  });

  it('migration 0027 admits both new words, or the writes fail at the CHECK', async () => {
    const sql = await readFile(new URL('../../migrations/0027_audio_unheard.sql', import.meta.url), 'utf8');
    expect(sql).toContain("'audio_unheard'");
    expect(sql).toContain("'transcript_corrected'");
    // toTriggerReason is total over Signal, so escalation_events needs the word too.
    expect(sql).toMatch(/escalation_events[\s\S]*audio_unheard/);
  });
});
