import { describe, it, expect } from 'vitest';
import { parseTelegramUpdate, telegramAdapter, telegramSecretMatches, TELEGRAM_TEXT_MAX, type TelegramFetch } from '../../src/channels/telegram/adapter.js';

/**
 * S7 (Phase 5, item 22) — the Telegram adapter, alone: the webhook's secret, which updates are a buyer's message, and
 * what a send returns for each of Telegram's answers — the token never in an error.
 */
const BOT = '7012345678';
const TOKEN = `${BOT}:AAH-not-a-real-token_xyz`;
const update = (message: Record<string, unknown>, id = 101) => ({ update_id: id, message: { message_id: 7, date: 1_761_120_000, chat: { id: 555, type: 'private' }, from: { id: 555, first_name: 'Amal', last_name: 'B.' }, ...message } });

describe('S7 · Telegram in', () => {
  it('the secret Telegram echoes, compared whole; anything else refused', () => {
    expect(telegramSecretMatches('s3cret-value', 's3cret-value')).toBe(true);
    for (const h of [undefined, '', 's3cret-valu', 's3cret-value ', 'S3CRET-VALUE']) expect(telegramSecretMatches(h, 's3cret-value'), String(h)).toBe(false);
    expect(telegramSecretMatches('x', '')).toBe(false);
  });
  it('a person writing in a private chat is a message, by chat; the bot is the account; a retry is the same message', () => {
    const [e] = parseTelegramUpdate(BOT, update({ text: 'Do you make tote bags?' }));
    expect(e).toMatchObject({ kind: 'message', waId: '555', phoneNumberId: BOT, eventId: 'tg:555:7', dedupKey: 'tg:555:7', profileName: 'Amal B.',
      messageType: 'text', received: 'text', text: 'Do you make tote bags?', mediaId: null });
    expect(parseTelegramUpdate(BOT, update({ text: 'Do you make tote bags?' }, 102))[0]!.dedupKey).toBe(e!.dedupKey);
  });
  it('a photo, a voice note, a file: named, never opened (its caption kept)', () => {
    expect(parseTelegramUpdate(BOT, update({ photo: [{ file_id: 'f' }], caption: 'this one' }))[0]).toMatchObject({ messageType: 'unsupported', received: 'photo', text: 'this one', mediaId: null });
    expect(parseTelegramUpdate(BOT, update({ voice: { file_id: 'v' } }))[0]).toMatchObject({ messageType: 'unsupported', received: 'voice' });
  });
  it('not a buyer\'s message: a group, a channel, a bot, an edit, a button, nonsense', () => {
    for (const u of [
      update({ text: 'hi', chat: { id: -100, type: 'group' } }), update({ text: 'hi', chat: { id: -100, type: 'channel' } }),
      update({ text: 'hi', from: { id: 9, is_bot: true } }), { update_id: 3, edited_message: { text: 'x' } }, { update_id: 4, callback_query: {} },
      null, 'x', { message: { text: 'no id' } },
    ]) expect(parseTelegramUpdate(BOT, u), JSON.stringify(u)).toEqual([]);
  });
});

describe('S7 · Telegram out', () => {
  const scripted = (answers: { status: number; body: unknown }[] | 'down') => {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl: TelegramFetch = async (url, init) => {
      calls.push({ url, body: init.body });
      if (answers === 'down') throw new Error(`connect ECONNREFUSED ${url}`);
      const a = answers.shift()!;
      return { ok: a.status < 300, status: a.status, json: async () => a.body };
    };
    return { calls, adapter: telegramAdapter({ botId: BOT, token: TOKEN, secretToken: 's', fetchImpl }) };
  };
  it('sent: the chat and the words, and the message\'s own id back', async () => {
    const { calls, adapter } = scripted([{ status: 200, body: { ok: true, result: { message_id: 42 } } }]);
    expect(await adapter.sendText('555', 'Yes, from 500 pieces.')).toEqual({ ok: true, providerMessageId: 'tg:555:42' });
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(calls[0]!.body)).toEqual({ chat_id: '555', text: 'Yes, from 500 pieces.' });
  });
  it('a flood limit or Telegram down is tried again; a buyer who blocked the bot, or a bad request, is not; the token never shows', async () => {
    const cases: [{ status: number; body: unknown }[] | 'down', boolean][] = [
      [[{ status: 429, body: { ok: false, description: 'Too Many Requests: retry after 3' } }], true],
      [[{ status: 502, body: null }], true],
      ['down', true],
      [[{ status: 403, body: { ok: false, description: `Forbidden: bot was blocked by the user (bot${TOKEN})` } }], false],
      [[{ status: 400, body: { ok: false, description: 'Bad Request: chat not found' } }], false],
    ];
    for (const [answers, retryable] of cases) {
      const r = await scripted(answers).adapter.sendText('555', 'hi');
      expect(r.ok).toBe(false);
      if (!r.ok) { expect(r.retryable).toBe(retryable); expect(r.error).not.toContain('AAH-not-a-real-token'); }
    }
  });
  it('longer than Telegram takes: refused before any call', async () => {
    const { calls, adapter } = scripted([]);
    expect(await adapter.sendText('555', 'x'.repeat(TELEGRAM_TEXT_MAX + 1))).toMatchObject({ ok: false, retryable: false });
    expect(calls).toHaveLength(0);
  });
});
