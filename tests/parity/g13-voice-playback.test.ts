import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderConversationDetail, type ConversationDetail, type TimelineMessage } from '../../src/api/web/inbox.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * G13 — she can play the note she is asked to correct. The production walk
 * (webhook → worker → the owner pressing play → her words answered) is in
 * tests/integration/hear-and-see.test.ts.
 */

const src = (rel: string) => readFile(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const NOW = new Date('2026-09-11T08:00:00Z');

const detail = (m: TimelineMessage): ConversationDetail => ({
  conversationId: 'conv-1', buyer: 'Ahmed', country: 'AE', status: 'awaiting',
  product: { name: null, nameZh: null }, quantity: null, quote: null, order: null,
  messages: [m], pendingDraft: null, ownership: 'WAITING_HUMAN', refusals: [],
  handoffReasons: ['audio_unheard'], unheardReason: 'transcription_failed', lastHumanAction: null,
  knowledgeUsed: [], rate: null, leadTimeBlocked: null, sampleAsked: null,
  proof: { quoteId: null, token: null },
});
const note = (over: Partial<TimelineMessage> = {}): TimelineMessage => ({
  direction: 'inbound', text: '', at: NOW, heard: 'voice', id: 'msg-1', ...over,
});

describe('G13 · the recording is offered where the correction is asked for', () => {
  it('a note with a handle gets a player, pointing at this conversation and message', () => {
    const html = renderConversationDetail(detail(note({ playable: true })), 'en', NOW, null);
    expect(html).toContain('<audio class="voiceplay" controls preload="none" src="/app/inbox/conv-1/voice/msg-1"');
    // preload="none": twenty notes must not fetch twenty files to draw a page.
    expect(html).toContain('preload="none"');
  });

  it('a note recorded before the handle existed says so — never a player that cannot play', () => {
    const html = renderConversationDetail(detail(note()), 'en', NOW, null);
    expect(html).not.toContain('<audio');
    expect(html).toContain(esc(t('en', 'voice.noRecording')));
  });

  it('"Answer this now" is offered only once a person has typed the words', () => {
    const machine = renderConversationDetail(detail(note({ text: 'ten thousand', heard: 'voice', playable: true })), 'en', NOW, null);
    expect(machine).not.toContain('/answer-now');
    const hers = renderConversationDetail(detail(note({ text: 'ten thousand pieces', heard: 'voice_corrected', playable: true })), 'en', NOW, null);
    expect(hers).toContain('action="/app/inbox/conv-1/answer-now"');
    expect(hers).toContain(esc(t('en', 'voice.answerNow')));
  });

  it('every string exists in all three locales', () => {
    for (const l of LOCALES) {
      for (const k of ['voice.noRecording', 'voice.expired', 'voice.answerNow', 'voice.flash.answering'] as MessageKey[]) {
        const said = t(l, k);
        expect(said, `${l} ${k}`).not.toBe(k);
        expect(said, `${l} ${k}`).not.toContain('{');
      }
    }
  });
});

describe('G13 · what is stored, and what is not', () => {
  it('a HANDLE, never a URL and never the bytes', async () => {
    const m = await src('migrations/0043_voice_playback.sql');
    expect(m).toContain('provider_media_id text');
    const voice = await src('src/pipeline/voiceTurn.ts');
    expect(voice).toContain('provider_media_id');
    // The bytes are fetched at the moment she presses play and never written.
    const app = await src('src/api/web/app.ts');
    const route = app.slice(app.indexOf("app.get('/app/inbox/:conversationId/voice/:messageId'"));
    const body = route.slice(0, route.indexOf('app.post('));
    expect(body).not.toMatch(/insert into/i);
    expect(body).toContain("header('cache-control', 'private, no-store')");
  });

  it('the id comes from the ROW, never from the URL', async () => {
    const app = await src('src/api/web/app.ts');
    const route = app.slice(app.indexOf("app.get('/app/inbox/:conversationId/voice/:messageId'"));
    const body = route.slice(0, route.indexOf('app.post('));
    expect(body).toContain('select provider_media_id as media from messages');
    expect(body).toContain("input_type in ('voice', 'voice_transcribed')");
    // Session first: a recording is a buyer's own voice.
    expect(body).toContain("if (!s) return reply.redirect('/login')");
  });

  it('her words run the ORDINARY turn — no second pipeline', async () => {
    const worker = await src('src/worker/main.ts');
    const branch = worker.slice(worker.indexOf('if (job.data.answerOnly)'));
    expect(branch.slice(0, branch.indexOf('}'))).toContain('runTurn(');
    // M34.5 still holds a price built on one human's reading of a recording.
    expect(branch.slice(0, 600)).toContain("provenance: 'transcribed'");
  });
});
