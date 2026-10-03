import { describe, it, expect } from 'vitest';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';

/**
 * Phase 9 — the conversation page, the draft card, the buyer file and Practice:
 * the findings of the merged audit (docs/UI-AUDIT-V2.md §5), each held here.
 */

describe('V1-269 · the buyer file acts on the customer\'s request; the owner does not ask for one', () => {
  it('the fold says the customer asked, and its button says pressing deletes their data now (0126)', () => {
    expect(t('en', 'conv.deletion.ask')).toMatch(/^This customer asked/);
    expect(t('en', 'conv.deletion.erase')).toBe("Delete this customer's data now");
    for (const l of LOCALES) expect(t(l, 'conv.deletion.erase'), l).not.toBe(t(l, 'conv.deletion.ask'));
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

describe('V1-225 · the back link and the panel door never say the same word', () => {
  it('in every locale', () => {
    for (const l of LOCALES) expect(t(l, 'panel.open'), l).not.toBe(t(l, 'inbox.detail.back'));
  });
});

describe('V1-504 · the forbidden-words page says how a word is matched', () => {
  it('in every locale, on the page itself', async () => {
    const { renderForbidden } = await import('../../src/api/web/settings.js');
    for (const l of LOCALES) {
      const html = renderForbidden({ own: [], floor: [] }, l, null);
      expect(html, l).toContain(t(l, 'forbidden.howMatched').slice(0, 10));
    }
  });
});
