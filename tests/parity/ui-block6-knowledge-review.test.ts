// UI Block 6 · F31 — a reading's review: the page's sentence and what would be learned from it side by side, in two
// neutral columns named once; the tick beside what it approves; one linked section per line on a phone; no wash. The
// reread step is one compact confirmation that keeps its allowance note before its one button.
import { describe, it, expect } from 'vitest';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { renderProposal, renderReread, type Proposal } from '../../src/api/web/pageFacts.js';
import { ASSISTANT_AREA_CSS } from '../../src/api/web/assistantAreaStyle.js';
import { withoutIsolates } from './isolates.js';

const ID = '0f000000-0000-4000-8000-0000000000f3';
const base = (over: Partial<Proposal> = {}): Proposal => ({
  id: ID, source: 'https://shop.example/pages/shipping', createdAt: new Date('2026-11-20T09:00:00Z'), decidedAt: null, written: null,
  replacedBy: null, rereadOf: null,
  lines: [{ key: 'f1', fact: 'We ship in 2 days.', quote: 'Every order leaves within two days.' }, { key: 'f2', fact: 'Returns within 14 days.', quote: 'Send it back within 14 days.' }],
  ...over,
});
const css = ASSISTANT_AREA_CSS.replace(/\s+/g, ' ');
const phone = (css.match(/@media\s*\(max-width:650px\)\{(.*?)\}\s*$/m)?.[1] ?? css.slice(css.lastIndexOf('@media(max-width:650px)')));

describe('UI Block 6 · F31 — the reading\'s review', () => {
  it('names the two columns once, above the lines, in every language; each line keeps the page\'s sentence and the fact', () => {
    for (const l of LOCALES) {
      const html = withoutIsolates(renderProposal(base(), l, null, true));
      const heads = html.indexOf('<div class="reading-heads" aria-hidden="true">');
      const list = html.indexOf('<ul class="rows reading-lines">');
      expect(heads, l).toBeGreaterThan(0);
      expect(list, l).toBeGreaterThan(heads);
      const head = html.slice(heads, list);
      expect(head, l).toContain(`<span>${esc(t(l, 'pageFacts.colSource'))}</span>`);
      expect(head, l).toContain(`<span>${esc(t(l, 'pageFacts.colFact'))}</span>`);
      expect(html.match(/class="reading-heads"/g)?.length, l).toBe(1);
      for (const line of base().lines) {
        expect(html, l).toContain(esc(line.quote));
        expect(html, l).toContain(esc(line.fact));
      }
    }
  });
  it('the tick sits beside what it approves: the checkbox and the fact share one label; each part says its own name for a phone', () => {
    const html = renderProposal(base(), 'en', null, true);
    for (const k of ['f1', 'f2']) {
      expect(html).toMatch(new RegExp(`<label class="pcheck"><input type="checkbox" name="line:${k}"><span class="rl-fact"><span class="caption muted rl-name">${esc(t('en', 'pageFacts.colFact'))}</span>`));
    }
    expect(html.match(/class="caption muted rl-name">/g)?.length).toBe(4);
    // An approved reading draws the same two parts, without a box to tick.
    const done = renderProposal(base({ decidedAt: new Date('2026-11-21T09:00:00Z'), written: 2 }), 'en', null, true);
    expect(done).not.toContain('type="checkbox"');
    expect(done).toContain(`<div class="reading-fact"><span class="caption muted rl-name">${esc(t('en', 'pageFacts.colFact'))}</span>`);
  });
  it('no blanket wash: the lines are neutral; the heads and the rows share one width; the names show on a phone, hidden on a wide screen', () => {
    const rules = css.split('}').filter(r => r.includes('reading-line'));
    for (const r of rules) expect(r, r).not.toContain('--color-assistant-wash');
    expect(css).toContain('.reading-review .reading-lines,.reading-heads{margin:0;max-width:var(--measure-prose);}');
    expect(css).toMatch(/\.reading-review \.rl-name\{position:absolute;width:1px;height:1px;/);
    expect(phone).toContain('.reading-heads{display:none;}');
    expect(phone).toMatch(/\.reading-review \.rl-name\{position:static;/);
    expect(phone).toContain('border-inline-start:2px solid var(--color-border)');
  });
  it('the reread step is one compact confirmation: the page, what happens, then the allowance note and the button together', () => {
    for (const l of LOCALES) {
      const html = withoutIsolates(renderReread(base(), { kind: 'share', atMost: 7, used: 12 }, l));
      const box = html.indexOf('<section class="reread-confirm">');
      const cost = html.indexOf('<div class="rr-cost">');
      const button = html.indexOf(`>${t(l, 'pageFacts.reread.button')}</button>`);
      const end = html.indexOf('</section>');
      expect(box, l).toBeGreaterThan(0);
      expect(cost, l).toBeGreaterThan(box);
      expect(html.indexOf('id="reread-cost"'), l).toBeGreaterThan(cost);
      expect(html.indexOf('id="reread-nothing"'), l).toBeGreaterThan(cost);
      expect(button, l).toBeGreaterThan(html.indexOf('id="reread-nothing"'));
      expect(end, l).toBeGreaterThan(button);
      expect(html.match(/class="btn send"/g)?.length, l).toBe(1);
    }
    // Today's allowance used: the reason, inside the box, and still no form.
    const used = renderReread(base(), { kind: 'used' }, 'en');
    expect(used).toContain('<section class="reread-confirm">');
    expect(used).toContain(t('en', 'pageFacts.refused.allowance_used'));
    expect(used).not.toContain('<form');
    expect(css).toMatch(/\.reread-confirm\{max-width:var\(--measure-column\);border:1px solid var\(--color-border\)/);
  });
});
