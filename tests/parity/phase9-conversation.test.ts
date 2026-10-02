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

describe('V1-219, V1-255 · marking a conversation as your own test is an act, and asks first', () => {
  it('the button says what it does, and carries the question the dialog asks', async () => {
    const { renderConversationDetail } = await import('../../src/api/web/inbox.js');
    const { conversationDetail } = await import('./fixtures.js');
    for (const l of LOCALES) {
      const html = renderConversationDetail(conversationDetail(), l, new Date(), null, { isOwner: true });
      const form = html.slice(html.indexOf('/testing"'), html.indexOf('</form>', html.indexOf('/testing"')));
      expect(form, l).toContain('data-confirm=');
      expect(form, l).toContain(t(l, 'conv.testing.mark'));
    }
    expect(t('en', 'conv.testing.mark')).toMatch(/^Mark /);
  });
});
