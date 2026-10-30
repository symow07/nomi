import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderProposal, renderReread, type Proposal } from '../../src/api/web/pageFacts.js';
import { readingShareAtMost, PAGE_READING_TOKENS_AT_MOST, PAGE_TEXT_MAX, PAGE_FACTS_OUTPUT_MAX } from '../../src/core/owner/pageFacts.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { withoutIsolates } from './isolates.js';

/**
 * 0220 — READ THE PAGE AGAIN, as the pages draw it. The routes and the rows are in
 * tests/integration/page-reread.test.ts.
 */

const ID = '0f000000-0000-4000-8000-000000000001';
const base = (over: Partial<Proposal> = {}): Proposal => ({
  id: ID, source: 'https://shop.example/pages/shipping', createdAt: new Date('2026-10-30T09:00:00Z'), decidedAt: null, written: null,
  replacedBy: null, rereadOf: null, lines: [{ key: 'f1', fact: 'We ship in 2 days.', quote: 'We ship in 2 days.' }], ...over,
});

describe('what one reading uses of the day\'s allowance, at most', () => {
  it('the page\'s text and the instructions counted a token a character, and the longest answer; the larger share of calls or tokens, rounded up', () => {
    expect(PAGE_READING_TOKENS_AT_MOST).toBe(PAGE_TEXT_MAX + 1_000 + PAGE_FACTS_OUTPUT_MAX);
    // G2's day: 1,000 calls, 1,000,000 tokens — 64,000 tokens is 6.4%, said as 7%.
    expect(readingShareAtMost({ dailyLlmCalls: 1000, dailyTokens: 1_000_000 })).toBe(7);
    // A day of few calls: the call is the larger share.
    expect(readingShareAtMost({ dailyLlmCalls: 10, dailyTokens: 100_000_000 })).toBe(10);
  });
  it('the reader is held to the same longest answer the ceiling counts', () => {
    expect(readFileSync('src/llm/anthropic.ts', 'utf8')).toContain('max_tokens: PAGE_FACTS_OUTPUT_MAX');
  });
});

describe('the confirm step', () => {
  it('says, before its button, what happens to this reading, what the new one uses, and that finding nothing uses it — in every language', () => {
    for (const l of LOCALES) {
      for (const [p, fate] of [[base(), 'pageFacts.reread.replacesWaiting'], [base({ decidedAt: new Date(), written: 1 }), 'pageFacts.reread.keepsApproved']] as const) {
        const html = withoutIsolates(renderReread(p, { kind: 'share', atMost: 7, used: 12 }, l));
        const button = html.indexOf(`>${t(l, 'pageFacts.reread.button')}</button>`);
        expect(button, l).toBeGreaterThan(0);
        for (const said of [t(l, fate), withoutIsolates(t(l, 'pageFacts.reread.charge', { at: 7, used: 12 })), t(l, 'pageFacts.reread.nothingCounts')]) {
          expect(html.indexOf(said), `${l}: ${said}`).toBeGreaterThan(0);
          expect(html.indexOf(said), `${l}: ${said}`).toBeLessThan(button);
        }
        expect(html).toContain(`<form method="post" action="/app/knowledge/from-page/${ID}/again"`);
        expect(html.match(/class="btn send"/g)?.length).toBe(1);
      }
    }
  });
  it('a workspace with no daily limit is told so; today\'s allowance used is the reason and no button', () => {
    expect(renderReread(base(), { kind: 'no_limit' }, 'en')).toContain(t('en', 'pageFacts.reread.noLimit'));
    const used = renderReread(base(), { kind: 'used' }, 'en');
    expect(used).toContain(t('en', 'pageFacts.refused.allowance_used'));
    expect(used).not.toContain('<form');
  });
});

describe('the reading\'s own page', () => {
  it('a reading of an address offers "Read the page again" as a door, waiting or approved — only where a reader exists', () => {
    const door = `href="/app/knowledge/from-page/${ID}/again"`;
    expect(renderProposal(base(), 'en', null, true)).toContain(door);
    expect(renderProposal(base({ decidedAt: new Date(), written: 2 }), 'en', null, true)).toContain(door);
    expect(renderProposal(base(), 'en', null, false)).not.toContain(door);
    expect(renderProposal(base({ source: 'pasted:0123456789abcdef' }), 'en', null, true)).not.toContain(door);
  });
  it('replaced: says so, leads to the newer one, and offers neither ticks nor "again"', () => {
    const html = renderProposal(base({ replacedBy: '0f000000-0000-4000-8000-000000000002' }), 'en', null, true);
    expect(html).toContain(t('en', 'pageFacts.replaced'));
    expect(html).toContain('href="/app/knowledge/from-page/0f000000-0000-4000-8000-000000000002"');
    expect(html).not.toContain('name="line:');
    expect(html).not.toContain('/again"');
  });
  it('a reading that would replace an approved one says so above its lines', () => {
    const html = renderProposal(base({ rereadOf: { id: 'x', decidedAt: new Date('2026-10-01T09:00:00Z') } }), 'en', null, true);
    expect(html.indexOf('id="replaces"')).toBeGreaterThan(0);
    expect(html.indexOf('id="replaces"')).toBeLessThan(html.indexOf('name="line:f1"'));
  });
});
