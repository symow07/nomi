import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { labelNameOf } from '../../src/core/owner/labels.js';
import { renderLabels } from '../../src/api/web/labels.js';
import { buyersHref } from '../../src/api/web/inbox.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * S2 (Phase 5, item 19) — labels, the pure parts: what a label's name may be, the address of Buyers narrowed by one,
 * the labels' own page in five languages, and the line the item keeps — a label is not drawn on the Buyers row
 * (decision 5: the row is name, last message, time).
 */
describe('S2 · labels', () => {
  it('one line, 1 to 40, its spaces as one (the same whatever its capitals is the database\'s: labels_one_name)', () => {
    expect(labelNameOf('  Dubai   fair ')).toBe('Dubai fair');
    expect(labelNameOf('a\nb')).toBe('a b');
    expect(labelNameOf('')).toBeNull();
    expect(labelNameOf('x'.repeat(41))).toBeNull();
    expect(labelNameOf(7)).toBeNull();
  });

  it('Buyers narrowed by a label keeps the tab and the search with it', () => {
    expect(buyersHref({ filter: 'pending', q: 'tote', label: '00000000-0000-4000-8000-000000000001' }))
      .toBe('/app/inbox?filter=pending&q=tote&label=00000000-0000-4000-8000-000000000001');
    expect(buyersHref({ label: null })).toBe('/app/inbox');
  });

  it('the labels\' page, in every language: renamed in place, archive asks first, a door to the buyers carrying it', () => {
    const rows = [{ id: '00000000-0000-4000-8000-000000000001', name: 'Wholesale', archived: false, buyers: 3 },
      { id: '00000000-0000-4000-8000-000000000002', name: 'Old fair', archived: true, buyers: 0 }];
    for (const l of LOCALES) {
      const html = renderLabels(l, rows);
      expect(html, l).toContain('action="/app/labels/00000000-0000-4000-8000-000000000001"');
      expect(html, l).toContain('data-confirm=');
      expect(html, l).toContain('/app/inbox?filter=all&amp;label=00000000-0000-4000-8000-000000000001');
      expect(html, l).toContain('/app/labels/00000000-0000-4000-8000-000000000002/restore');
    }
  });

  it('decision 5 holds: the Buyers row draws no label; labels are a narrowing above the list and a block of the panel', () => {
    const inbox = readFileSync(new URL('../../src/api/web/inbox.ts', import.meta.url), 'utf8');
    const row = inbox.slice(inbox.indexOf('function rowOf') >= 0 ? inbox.indexOf('function rowOf') : 0);
    expect(inbox).toContain('<nav class="tabs labels"');
    expect(row).not.toMatch(/label-on/);
    expect(readFileSync(new URL('../../src/api/web/panes.ts', import.meta.url), 'utf8')).toContain('${labelsBlock(p, locale, conversationId)}');
  });
});
