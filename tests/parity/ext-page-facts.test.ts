import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pageText, containFacts, parseFactsAnswer, PAGE_FACTS_MAX } from '../../src/core/owner/pageFacts.js';
import { pageAddress, renderProposal } from '../../src/api/web/pageFacts.js';
import { anthropicPageFactsReader } from '../../src/llm/anthropic.js';

/**
 * EXT — a page of the owner's site, proposed as facts: only what the page
 * says, each with the sentence it came from, and nothing ticked for her.
 * No test reaches a model: the client is a fake.
 */

const src = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const PAGE = `<html><head><title>Shipping</title><style>p{color:red}</style></head><body>
  <nav><a href="/">Home</a></nav>
  <script>var x = "Free shipping on everything";</script>
  <h1>Shipping &amp; returns</h1>
  <p>We ship within 2&nbsp;business days.</p>
  <p>Returns are accepted within 30 days of delivery.</p><!-- Free returns forever -->
  <p>&#20840;&#29699;&#21253;&#37038;&#12290;</p>
</body></html>`;

describe('EXT · a page read as text', () => {
  it('scripts, styles, comments and markup gone; entities decoded; one line per paragraph', () => {
    const text = pageText(PAGE);
    expect(text).toContain('We ship within 2 business days.');
    expect(text).toContain('Shipping & returns');
    expect(text).toContain('全球包邮。');
    expect(text).not.toContain('Free shipping on everything');
    expect(text).not.toContain('Free returns forever');
    expect(text).not.toContain('color:red');
    expect(text.split('\n')).toContain('Returns are accepted within 30 days of delivery.');
  });
  it('a code point that is not a character is a space', () => {
    expect(pageText('a&#xD800;b&#0;c')).toBe('a b c');
  });
});

describe('EXT · what may be proposed', () => {
  const text = pageText(PAGE);
  it('a fact whose sentence is on the page survives; one whose sentence is not, never', () => {
    expect(containFacts([
      { fact: 'Orders ship within 2 business days.', quote: 'We ship within 2 business days.' },
      { fact: 'Shipping is free on everything.', quote: 'Free shipping on everything' },
      { fact: 'Returns are free.', quote: 'Free returns forever' },
    ], text)).toEqual([{ fact: 'Orders ship within 2 business days.', quote: 'We ship within 2 business days.' }]);
  });
  it('the quote is matched however its spaces and width were written; the same fact twice is one', () => {
    const out = containFacts([
      { fact: 'Returns within 30 days.', quote: '  returns are accepted   within 30 days ' },
      { fact: 'returns within 30  days.', quote: 'Returns are accepted within 30 days of delivery.' },
    ], text);
    expect(out).toHaveLength(1);
  });
  it('too short, too long, at most twenty', () => {
    expect(containFacts([{ fact: 'Ok', quote: 'We ship within 2 business days.' }], text)).toEqual([]);
    expect(containFacts([{ fact: 'x'.repeat(301), quote: 'We ship within 2 business days.' }], text)).toEqual([]);
    const many = Array.from({ length: 30 }, (_, i) => ({ fact: `Fact number ${i}`, quote: 'We ship within 2 business days.' }));
    expect(containFacts(many, text)).toHaveLength(PAGE_FACTS_MAX);
  });
  it('the answer, read defensively', () => {
    expect(parseFactsAnswer('Sure: {"facts":[{"fact":"A b c d","quote":"A b c d"},{"fact":1,"quote":"x"},{"quote":"y"}]}')).toEqual([{ fact: 'A b c d', quote: 'A b c d' }]);
    expect(parseFactsAnswer('nothing')).toEqual([]);
    expect(parseFactsAnswer('{"facts":"x"}')).toEqual([]);
  });
});

describe('EXT · the address', () => {
  it('a bare address is https; credentials, other schemes and odd hosts are not addresses', () => {
    expect(pageAddress('myshop.com/pages/shipping')).toBe('https://myshop.com/pages/shipping');
    expect(pageAddress('http://myshop.com/a')).toBe('http://myshop.com/a');
    expect(pageAddress('https://user:pw@myshop.com/')).toBeNull();
    expect(pageAddress('ftp://myshop.com/')).toBeNull();
    expect(pageAddress('file:///etc/passwd')).toBeNull();
    expect(pageAddress('localhost')).toBeNull();
    expect(pageAddress('')).toBeNull();
  });
});

describe('EXT · the proposal, as she sees it', () => {
  it('every line with its sentence, none ticked', () => {
    const html = renderProposal({
      id: '00000000-0000-4000-8000-000000000001', source: 'https://myshop.com/pages/shipping', createdAt: new Date(), decidedAt: null, written: null,
      lines: [{ key: 'f1', fact: 'Orders ship within 2 business days.', quote: 'We ship within 2 business days.' }],
    }, 'en', null);
    expect(html).toContain('name="line:f1"');
    expect(html).not.toMatch(/name="line:f1"[^>]*checked/);
    expect(html).toContain('We ship within 2 business days.');
  });
});

describe('EXT · the model, faked', () => {
  it('temperature 0, the page as the only user text, its answer parsed', async () => {
    const sent: { temperature: number; messages: { content: { type: string; text: string }[] }[] }[] = [];
    const client = { messages: { create: async (req: (typeof sent)[number]) => { sent.push(req); return { content: [{ type: 'text', text: '{"facts":[{"fact":"Ships in 2 days.","quote":"We ship"}]}' }], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 4 } }; } } };
    const out = await anthropicPageFactsReader(client as unknown as Parameters<typeof anthropicPageFactsReader>[0]).read({ text: 'We ship within 2 days.' });
    expect(sent[0]!.temperature).toBe(0);
    expect(sent[0]!.messages[0]!.content).toEqual([{ type: 'text', text: 'We ship within 2 days.' }]);
    expect(out.facts).toEqual([{ fact: 'Ships in 2 days.', quote: 'We ship' }]);
    expect(out.usage).toEqual({ inputTokens: 3, outputTokens: 4 });
  });
});

describe('EXT · where it is asked', () => {
  it('the public fetcher, within the allowance, the spend recorded; nothing written but ticked lines', () => {
    const app = src('src/api/web/app.ts');
    const route = app.slice(app.indexOf("app.post('/app/knowledge/from-page'"));
    expect(route).toContain('fetcher: deps.storeFetcher ?? publicFetcher');
    expect(route).toContain("spent: (u) => recordSpendAlone(deps.db, s.businessId, u, { turn: false }),");
    const web = src('src/api/web/pageFacts.ts');
    expect(web).toContain('if (allowanceUsed(allowance)) return { ok: false, reason: \'allowance_used\' };');
    expect(web).toContain('const facts = containFacts(read.facts, text);');
    expect(web).toContain("if (chosen.length === 0) return { kind: 'none_ticked' } as const;");
  });
});
