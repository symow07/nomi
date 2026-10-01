import { describe, it, expect } from 'vitest';
import { checklistFor, NOT_YET, CHECKLIST_ITEMS, type ChecklistItem } from '../../src/db/practiceChecklist.js';
import { renderSandbox, parseTotal, type SandboxView } from '../../src/api/web/sandbox.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * P4 part two — THE PRACTICE CHECKLIST, per kind of business (docs/PRACTICE.md),
 * and "your total first".
 */
const view = (over: Partial<SandboxView> = {}): SandboxView => ({
  hasConversation: true, messages: [], lastTurn: null, ownership: 'AI', ...over,
});
const draw = (items: readonly ChecklistItem[], seen: readonly ChecklistItem[], locale: 'en' | 'zh' | 'ar' | 'es' = 'en') =>
  renderSandbox(view(), locale, { flash: null, checklist: { items, seen: new Set(seen), totals: [] } });

describe('P4 · the checklist, per kind of business', () => {
  it('a catalogue: eight items, the order among them; a shop adds "how much is this?"; no catalogue swaps the product items', () => {
    const catalogue = checklistFor('catalogue');
    expect(catalogue).toHaveLength(8);
    expect(catalogue).toContain('quoted');
    expect(catalogue).toContain('order_tapped');
    expect(catalogue).not.toContain('retail_price');
    const retail = checklistFor('retail');
    expect(retail).toEqual(expect.arrayContaining([...catalogue, 'retail_price']));
    expect(retail).toHaveLength(9);
    const none = checklistFor('no_catalogue');
    expect(none).toEqual(['price_handed', 'offer_answered', 'handed_over', 'bot_answered', 'person_handoff', 'stop_handoff']);
    for (const gone of ['quoted', 'found_by_name', 'discount_held', 'retail_price', 'order_tapped'] as const) expect(none).not.toContain(gone);
  });

  it('every item has its words in every language, with no key left showing', () => {
    for (const l of LOCALES) {
      for (const i of CHECKLIST_ITEMS) {
        const k = `practice.check.${i}` as MessageKey;
        expect(t(l, k, { name: 'Lily' }), `${l}:${i}`).not.toBe(k);
      }
    }
  });

  it('RT (0095) — "how much is this?" is ticked once a shop\'s price question got a price; nothing waits on a later item', () => {
    expect(NOT_YET.size).toBe(0);
    const seen = draw(checklistFor('retail'), ['retail_price', 'quoted']);
    const row = seen.match(/<li class="chk ok">[\s\S]*?<\/li>/g)?.find((r) => r.includes(esc(t('en', 'practice.check.retail_price')))) ?? '';
    expect(row).toContain('✓');
    const unseen = draw(checklistFor('retail'), ['quoted']);
    expect(unseen).not.toMatch(/<li class="chk gap">/);
  });

  it('the count is what was seen of this list, and each seen item is ticked', () => {
    const html = draw(checklistFor('catalogue'), ['quoted', 'stop_handoff', 'price_handed']);   // price_handed is not on this list
    expect(html).toMatch(/2\/8/);
    expect(html).toMatch(/<li class="chk ok"><span class="mk" aria-hidden="true">✓<\/span>\s*<span class="lbl">One of your products quoted/);
  });

  it('your total first: the box only where there is a price list; a total is read as a number or not at all', () => {
    expect(draw(checklistFor('catalogue'), [])).toContain('name="expected"');
    expect(draw(checklistFor('no_catalogue'), [])).not.toContain('name="expected"');
    expect(parseTotal('1,250.50', 'USD')).toBe(1250.5);
    // CUR — read the way the workspace's currency writes a figure.
    expect(parseTotal('1.250,50', 'BRL')).toBe(1250.5);
    expect(parseTotal('150.000', 'IDR')).toBe(150000);
    expect(parseTotal(' 500 ', 'USD')).toBe(500);
    for (const bad of ['', 'abc', '-3', '0', undefined, null]) expect(parseTotal(bad, 'USD'), String(bad)).toBeNull();
  });
});
