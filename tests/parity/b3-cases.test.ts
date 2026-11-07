import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { touchWords, compareCase, CASES_MAX } from '../../src/core/owner/cases.js';
import { stagedChangeOf } from '../../src/pipeline/caseChecks.js';
import { renderChecksPage, renderCheckPage } from '../../src/api/web/cases.js';
import { PRACTICE_SKIP } from '../integration/practice-tables.js';
import type { CaseCheck } from '../../src/db/cases.js';

/**
 * Block 3 PR 3 (0230) — "DID TEACHING BREAK ANYTHING?", the pure parts: which words a change touches, what counts as
 * changed (the figures, or no reply where there was one — never the prose), the staged change read back from its row,
 * and the two pages. The re-run itself is proven in tests/integration/b3-cases.test.ts.
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

describe('what a change touches', () => {
  it('words of four letters or more, two Han characters, once each, lower-cased', () => {
    expect(touchWords(['Amber candle', 'the amber Candle burns 40 hours', null, '无纺布袋 价格'])).toEqual(['amber', 'candle', 'burns', 'hours', '无纺布袋', '价格']);
    expect(touchWords([])).toEqual([]);
    expect(CASES_MAX).toBe(20);
  });
});

describe('what counts as changed', () => {
  it('the figures: a price that moved is a change, a reply worded differently with the same figures is not', () => {
    expect(compareCase('It is 12.00 each.', 'The amber candle is 12 each, happy to help.')).toMatchObject({ changed: false, reason: 'same', figuresAccepted: ['12'], figuresReply: ['12'] });
    expect(compareCase('It is 12.00 each.', 'The amber candle is 15.00 each.')).toMatchObject({ changed: true, reason: 'figures', figuresAccepted: ['12'], figuresReply: ['15'] });
    expect(compareCase('We ship across Europe.', 'Yes — we ship to every country in Europe.')).toMatchObject({ changed: false, figuresAccepted: [], figuresReply: [] });
  });
  it('no reply where there was one is a change: the case would now go to a person', () => {
    expect(compareCase('It is 12.00 each.', null)).toMatchObject({ changed: true, reason: 'silent' });
  });
});

describe('the staged change, read back from its row', () => {
  it('each kind by its own shape; anything else is nothing', () => {
    expect(stagedChangeOf('price', { kind: 'price', productId: 'p', edit: { price: '15' } })).toEqual({ kind: 'price', productId: 'p', edit: { price: '15' } });
    expect(stagedChangeOf('knowledge', { kind: 'knowledge', productId: null, knowledgeKind: 'faq', label: 'Shipping', content: 'Three days' })).toMatchObject({ kind: 'knowledge', label: 'Shipping' });
    expect(stagedChangeOf('procedure', { kind: 'procedure', title: 'A return', steps: 'ask' })).toMatchObject({ kind: 'procedure' });
    expect(stagedChangeOf('voice', { kind: 'voice', assistantId: 'a', input: { name: 'Lily', role: 'sales', note: '', channels: [] } })).toMatchObject({ kind: 'voice' });
    expect(stagedChangeOf('price', { kind: 'knowledge' })).toBeNull();
    expect(stagedChangeOf('price', null)).toBeNull();
    expect(stagedChangeOf('procedure', { kind: 'procedure', title: 1 })).toBeNull();
  });
});

describe('the lists', () => {
  it('the table is the workspace\'s own: never Practice\'s, unrelated to any customer, the erasure tool agreeing', () => {
    expect(PRACTICE_SKIP).toContain('case_checks');
    expect(read('migrations/0230_case_checks.sql')).toContain("('case_checks', 'unrelated', null, null, null, null)");
    expect(read('tools/erase-buyer.mjs')).toContain("case_checks: { do: 'unrelated' }");
  });
});

const check = (over: Partial<CaseCheck> = {}): CaseCheck => ({
  id: '0230aaaa-0000-4000-8000-000000000001', kind: 'price', change: { kind: 'price' }, summary: 'Amber candle', status: 'done',
  refs: [{ kind: 'message', id: 'm1' }, { kind: 'message', id: 'm2' }], touching: 1, spentCalls: 4, stoppedByAllowance: false,
  results: [
    { ref: { kind: 'message', id: 'm1' }, reply: 'The amber candle is 15.00 each.', path: 'model', touching: true, changed: true, reason: 'figures', figuresAccepted: ['12'], figuresReply: ['15'] },
    { ref: { kind: 'message', id: 'm2' }, reply: 'Yes, we ship across Europe.', path: 'model', touching: false, changed: false, reason: 'same', figuresAccepted: [], figuresReply: [] },
  ],
  createdAt: new Date('2026-11-07T10:00:00Z'), finishedAt: new Date('2026-11-07T10:01:00Z'), decidedAt: null, ...over,
});

describe('the pages', () => {
  it('the list says each check\'s kind, state and count; one check shows each case both ways and offers Keep and Revert to the owner while it waits', () => {
    const list = renderChecksPage('en', [check()], null);
    expect(list).toContain('A price');
    expect(list).toContain('Waiting for you: keep or revert');
    expect(list).toContain('2 cases ran');
    expect(list).toContain('1 changed');
    const texts = new Map([['message:m1', { question: 'How much is the amber candle?', accepted: 'It is 12.00 each.' }], ['message:m2', null]]);
    const one = renderCheckPage('en', true, check(), texts, null);
    expect(one).toContain('How much is the amber candle?');
    expect(one).toContain('It is 12.00 each.');
    expect(one).toContain('The amber candle is 15.00 each.');
    expect(one).toContain('Changed: the figures differ');
    expect(one).toContain('(this customer&#39;s words were erased)'.replace('&#39;', "'"));
    expect(one).toContain('does not touch the change');
    expect(one).toContain('/keep"');
    expect(one).toContain('/revert"');
    expect(renderCheckPage('en', false, check(), texts, null)).not.toContain('/keep"');
    expect(renderCheckPage('en', true, check({ status: 'kept' }), texts, null)).not.toContain('/keep"');
    expect(renderCheckPage('en', true, check({ status: 'running', results: [] }), texts, null)).toContain('The cases are running');
  });
});
