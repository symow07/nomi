import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { anthropicPageTranscriber } from '../../src/llm/anthropic.js';
import { importFromPhoto } from '../../src/api/web/products.js';
import type { PageTranscriber } from '../../src/llm/ports.js';
import { t, messages } from '../../src/core/owner/i18n/messages.js';
import { CHANNEL_REGISTRY, INSTEAD } from '../../src/core/channel/registry.js';

/**
 * T5 — THE READER, AND TWO PROMISES THE PRODUCT DID NOT KEEP (the one-month
 * build order, 2026-09-29).
 *
 *   · a photo read that stopped before the page did (the model ran out of
 *     room) is refused — half a price sheet is worse than none, because the
 *     owner cannot tell which half is missing — with the way to send it whole;
 *   · a transcription has one right answer: temperature 0;
 *   · "a buyer comments and {name} answers them privately" was offered as what
 *     works instead of writing first — nothing answers a comment; and "talks"
 *     said follow-ups go out by themselves — none does. Both are gone.
 */

type Sent = { temperature?: number };
const client = (stop: string, text: string, seen: Sent[]): Anthropic => ({
  messages: {
    create: async (req: Sent) => {
      seen.push(req);
      return { stop_reason: stop, content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 2000 } };
    },
  },
} as unknown as Anthropic);

describe('T5 · the page reader', () => {
  it('asks at temperature 0, and says when its read was cut off', async () => {
    const seen: Sent[] = [];
    const whole = await anthropicPageTranscriber(client('end_turn', 'Tote bag $2.40', seen)).transcribe({ imageBase64: 'x', mediaType: 'image/png' });
    expect(seen[0]!.temperature).toBe(0);
    expect(whole.cutOff).toBe(false);
    const half = await anthropicPageTranscriber(client('max_tokens', 'Tote bag $2.40\nCanvas pouch $1.', seen)).transcribe({ imageBase64: 'x', mediaType: 'image/png' });
    expect(half.cutOff).toBe(true);
  });

  it('a cut-off page adds nothing, and says to send it as two photos', async () => {
    const reader: PageTranscriber = {
      transcribe: async () => ({ text: 'Tote bag $2.40\nCanvas pouch $1.', unreadable: false, cutOff: true, promptVersion: 'p', modelId: 'm' }),
    } as unknown as PageTranscriber;
    const out = await importFromPhoto({ transcriber: reader }, { imageBase64: 'x', mediaType: 'image/png' });
    expect(out).toEqual({ kind: 'refused', reason: 'cut_off' });
    for (const l of ['en', 'zh', 'ar'] as const) expect(t(l, 'product.photo.refused.cut_off').length).toBeGreaterThan(10);
    expect(t('en', 'product.photo.refused.cut_off')).toContain('two photos');
  });
});

describe('T5 · no page promises what the product does not do', () => {
  it('nothing answers a comment privately, so it is not offered instead of writing first', () => {
    expect(INSTEAD).not.toContain('comment_to_dm' as never);
    for (const c of Object.values(CHANNEL_REGISTRY)) expect(c.instead).not.toContain('comment_to_dm' as never);
    expect(Object.keys(messages.en).filter((k) => k.includes('comment_to_dm'))).toEqual([]);
  });

  it('"talks" sends greetings, questions and recommendations alone — not follow-ups', () => {
    expect(t('en', 'autonomy.level.talks.note')).not.toMatch(/follow/i);
    expect(t('zh', 'autonomy.level.talks.note')).not.toContain('跟进');
    expect(t('ar', 'autonomy.level.talks.note')).not.toContain('المتابعات');
  });
});
