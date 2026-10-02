import { describe, it, expect } from 'vitest';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * Phase 9 — the conversation page, the draft card, the buyer file and Practice:
 * the findings of the merged audit (docs/UI-AUDIT.md §5), each held here.
 */

describe('V1-269 · the buyer file records the customer\'s request; the owner does not ask for one', () => {
  it('the fold and its button say the customer asked, and that pressing records it', () => {
    expect(t('en', 'conv.deletion.ask')).toMatch(/^This customer asked/);
    expect(t('en', 'conv.deletion.submit')).toBe('Record the request');
    for (const l of LOCALES) expect(t(l, 'conv.deletion.submit'), l).not.toBe(t(l, 'conv.deletion.ask'));
  });
});
