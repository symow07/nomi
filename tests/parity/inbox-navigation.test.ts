import { describe, expect, it } from 'vitest';
import { safeInboxReturn } from '../../src/api/web/inboxNavigation.js';

describe('Inbox return navigation', () => {
  it('keeps the list scope, current page and exact row anchor', () => {
    const input = '/app/inbox?filter=quiet&lens=value&q=canvas%20bag&label=label-1&stage=order&after=cursor-1#inbox-11111111-1111-4111-8111-111111111111';
    const result = new URL(safeInboxReturn(input)!, 'https://nomi.invalid');
    expect(result.pathname).toBe('/app/inbox');
    expect(Object.fromEntries(result.searchParams)).toEqual({ filter: 'quiet', lens: 'value', q: 'canvas bag', label: 'label-1', stage: 'order', after: 'cursor-1' });
    expect(result.hash).toBe('#inbox-11111111-1111-4111-8111-111111111111');
  });
  it('keeps a backward page cursor but discards unrelated parameters and fragments', () => {
    expect(safeInboxReturn('/app/inbox?before=cursor-2&redirect=https%3A%2F%2Foutside.example#outside')).toBe('/app/inbox?before=cursor-2');
    expect(safeInboxReturn('/app/inbox')).toBe('/app/inbox');
  });
  it('refuses external addresses, other app pages, malformed and unbounded values', () => {
    for (const input of [null, {}, 4, '//outside.example/app/inbox', 'https://outside.example/app/inbox', '/app/books', '/app/inbox/customer', '/app/inbox/../settings', '/app/inbox?q=' + 'x'.repeat(5000)]) {
      expect(safeInboxReturn(input), String(input)).toBeNull();
    }
  });
});
