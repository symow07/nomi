import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { addressPolitely } from '../../src/core/safety/politeChinese.js';
import { HANDOFF_REPLIES, SAFE_REPLIES, orderConfirmedReply } from '../../src/core/conversation/templates.js';
import { disclosureFor } from '../../src/core/conversation/disclosure.js';
import { SAFE_FALLBACK_REPLIES } from '../../src/core/safety/injection.js';
import { OPT_OUT_REPLIES } from '../../src/core/safety/optOut.js';
import { messages } from '../../src/core/owner/i18n/messages.js';

describe('the writer\'s 你 becomes 您', () => {
  it.each([
    ['你好，请问你想要哪一款？', '您好，请问您想要哪一款？'],
    ['谢谢你们的询问。', '谢谢您的询问。'],
    ['你的订单', '您的订单'],
    ['你們好，妳的訂單', '您好，您的訂單'],
  ])('%s', (from, to) => { expect(addressPolitely(from)).toBe(to); });

  it.each([
    ['the word for mini', '这款迷你包很轻。您要吗？'],
    ['nothing to change', '您好，请问您想要哪一款？'],
    ['English', 'Which one would you like?'],
    ['Arabic', 'ما المنتج المقصود؟'],
    ['Japanese, even with the character', 'あなたは你と書きました'],
  ])('leaves alone: %s', (_why, text) => { expect(addressPolitely(text)).toBe(text); });

  it('keeps a product\'s own name, and still fixes the rest of the sentence', () => {
    expect(addressPolitely('你想要爱你杯吗？', ['爱你杯', 'Tote'])).toBe('您想要爱你杯吗？');
    expect(addressPolitely('你想要迷你爱你杯吗？', ['迷你爱你杯'])).toBe('您想要迷你爱你杯吗？');
  });
});

describe('every fixed Chinese sentence a customer can get says 您', () => {
  it('the replies', () => {
    const sentences = [
      HANDOFF_REPLIES.zh, SAFE_REPLIES.zh, SAFE_FALLBACK_REPLIES.zh, OPT_OUT_REPLIES.zh,
      disclosureFor({ detected: 'zh', name: 'Lily', business: 'Westlake' }) ?? '',
      orderConfirmedReply({ orderReference: 'R-1', productName: 'Tote', quantity: 2, unit: 'pcs', language: 'zh' }),
    ];
    for (const s of sentences) expect(s, s).not.toMatch(/[你妳]/u);
  });

  it('no Chinese in the file of fixed replies says 你', () => {
    const source = readFileSync(new URL('../../src/core/conversation/templates.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/[你妳]/u);
  });

  it('the pages a customer reads: privacy, deletion, contact, unsubscribe', () => {
    const zh = messages.zh as Record<string, string>;
    const pages = Object.entries(zh).filter(([k]) => /^(legal\.(privacy|deletion|contact)|unsub)\b/.test(k));
    expect(pages.length).toBeGreaterThan(40);
    for (const [k, v] of pages) expect(`${k}: ${v}`).not.toMatch(/[你妳]/u);
  });

  it('the owner\'s pages keep 你', () => {
    const zh = messages.zh as Record<string, string>;
    expect(zh['legal.terms.service.body']).toContain('你');
    expect(zh['proof.owner.none']).toContain('你');
  });
});

describe('the prompts say so, and ask for the warm sentence', () => {
  const writer = readFileSync(new URL('../../prompts/response.txt', import.meta.url), 'utf8');
  const analysis = readFileSync(new URL('../../prompts/analysis.txt', import.meta.url), 'utf8');

  it('您', () => {
    expect(writer).toMatch(/always address the client as 您, never 你/);
    expect(analysis).toMatch(/addresses the client as 您, never 你/);
  });

  it('no question alone, no second hello, and the warmth carries nothing', () => {
    expect(writer).toMatch(/never send a question on its own/);
    expect(writer).toMatch(/no figure, no promise and no claim/);
    expect(writer).toMatch(/Say hello at most once/);
    expect(writer).toMatch(/A hello does not count as that sentence/);
    expect(writer).toMatch(/never write «obrigado» or «obrigada»/);
  });

  it('the examples it gives break no rule of its own', () => {
    const line = writer.split('\n').find((l) => l.includes('never send a question on its own')) ?? '';
    expect(line).not.toMatch(/[你妳]/u);
    expect(line).not.toMatch(/تحتاج|تريد|تبحث|عزيزي/u);
    expect(line).not.toMatch(/\d/);
  });
});
