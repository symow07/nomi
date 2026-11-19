import { describe, it, expect } from 'vitest';
import { renderBank } from '../../src/api/web/booksInvoices.js';
import { decimal } from '../../src/core/types/decimal.js';
import { messages } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * F23 (UI correction, Block 5) — bank matching: each line leads with the statement's facts (date, money in or out,
 * what the bank wrote) and its best candidate (date, entry, who, amount) with Match; others behind Choose another; the
 * bank's reference behind a detail; three empty states that never contradict one another. Suggestions, the match,
 * its undo and the import are unchanged.
 */
const d = decimal;
const owner = { isOwner: true };
const accountant = { isOwner: false, kind: 'accountant' as const };
const s = (n: number, party: string | null = null) => ({ journalLineId: `jl${n}`, entryId: `e${n}`, key: `BK-2026-${n}`, date: `2026-11-1${n}`, label: `Entry ${n}`, amount: d('-1200'), party });
const line = (id: string, suggestions: ReturnType<typeof s>[]) => ({ id, bookedOn: '2026-11-16', amount: d('-1200'), currency: 'USD', wording: 'STUDIO RENT', reference: 'FT2611160004', suggestions });
const accounts = [{ id: 'bank', code: '1000', name: 'Checking account' }];
const matched = { ...line('done', []), matchId: 'm1', entryId: 'e9', key: 'BK-2026-9' };

describe('F23 · bank matching', () => {
  it('a line leads with its date, money in or out and words, then its best candidate with Match; the reference behind a detail', () => {
    const html = renderBank('en', owner, { accounts, accountId: 'bank', open: [line('l1', [s(1, 'Studio Lessor'), s(2), s(3)])], matched: [] });
    const li = html.slice(html.indexOf('id="bank-line-l1"'));
    expect(li.indexOf('class="bb-date"')).toBeLessThan(li.indexOf('STUDIO RENT'));
    expect(li).toMatch(/<span class="bb-amount"><span class="bb-flow">Money out<\/span> <bdi>\$1,200\.00<\/bdi><\/span>/);
    expect(li).toContain('<details class="bb-ref"><summary>Bank reference</summary><p><bdi>FT2611160004</bdi></p></details>');
    const best = li.slice(li.indexOf('Best match'), li.indexOf('<details class="bb-others">'));
    expect(best).toContain('href="/app/books/advanced/entries/e1"'); expect(best).toContain('Studio Lessor'); expect(best).toContain('Entry amount');
    expect(best).toContain('name="journalLine" value="jl1"'); expect(best).toContain('Match with BK-2026-1');
    const others = li.slice(li.indexOf('<details class="bb-others">'), li.indexOf('</details>', li.indexOf('<details class="bb-others">')));
    expect(others).toContain('<summary>Choose another (2)</summary>'); expect(others).toContain('value="jl2"'); expect(others).toContain('value="jl3"');
    expect(li).not.toContain('Suggested:');
  });
  it('one candidate says there is no other; none says so; the accountant sees the facts without forms', () => {
    const one = renderBank('en', owner, { accounts, accountId: 'bank', open: [line('l1', [s(1)])], matched: [] });
    expect(one).toContain('No other entry of the same amount within a week.'); expect(one).not.toContain('bb-others');
    expect(renderBank('en', owner, { accounts, accountId: 'bank', open: [line('l1', [])], matched: [] })).toContain('No entry of the same amount within a week.');
    const read = renderBank('en', accountant, { accounts, accountId: 'bank', open: [line('l1', [s(1), s(2)])], matched: [matched] });
    expect(read).not.toContain('method="post"'); expect(read).toContain('Best match'); expect(read).toContain('Choose another (1)');
  });
  it('three empty states, never contradicting: nothing read; all matched; no bank account', () => {
    const none = renderBank('en', owner, { accounts, accountId: 'bank', open: [], matched: [] });
    expect(none).toContain('No statement has been read for this account yet.'); expect(none).not.toContain('is matched');
    const all = renderBank('en', owner, { accounts, accountId: 'bank', open: [], matched: [matched] });
    expect(all).toContain('Every statement line read for this account is matched.'); expect(all).not.toContain('Nothing matched yet');
    expect(renderBank('en', owner, { accounts: [], accountId: null, open: [], matched: [] })).toContain('has no bank or cash account');
  });
  it('the new words are in all five languages', () => {
    for (const k of ['bankMatch.best', 'bankMatch.chooseAnother', 'bankMatch.noOther', 'bankMatch.noneRead', 'bankMatch.allMatched', 'bankMatch.moneyIn', 'bankMatch.moneyOut', 'bankMatch.entryAmount', 'bankMatch.details', 'bankMatch.entry'] as const)
      for (const l of LOCALES) { expect(messages[l][k], `${l} ${k}`).toBeTruthy(); if (l !== 'en') expect(messages[l][k]).not.toBe(messages.en[k]); }
  });
});
