import { CONTROLS_CSS } from '../../src/api/web/controlsStyle.js';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { filterBar } from '../../src/api/web/filterBar.js';
import { FILTER_BAR_CSS } from '../../src/api/web/filterBarStyle.js';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/api/web/say.js';

/**
 * UI Block 9 · F07 — one filter toolbar for every filtered list. Each label wraps its words and its control (so at
 * 390 px they cannot part); every control and both actions share one 44 px height and one bottom edge on a desk; the
 * search stays in view and the other filters sit behind an explicit "Filters" button on a phone, which the shared
 * script closes only when none is on. The browser half (alignment measured, the fold clicked, base as the negative
 * control) is /private/tmp/ui-block9-build/bin/f07probe.mjs; its result is in FINDINGS.
 */

const src = (p: string) => readFileSync(new URL(`../../src/api/web/${p}`, import.meta.url), 'utf8');
const PAGES = ['booksInvoices.ts', 'booksPapers.ts', 'customers.ts', 'customerOrders.ts', 'products.ts', 'savedReplies.ts',
  'assistantKnowledge.ts', 'contacts.ts'];

const bar = (active = 0) => filterBar({
  locale: 'en', action: '/app/books/invoices', cls: 'bd-filters', name: 'Search invoices',
  search: { label: 'Search invoices', control: '<input type="search" name="q" value="">' },
  fields: [{ label: 'Show', control: '<select name="state"><option value="all">All invoices</option></select>' }],
  submit: 'Show results', clear: active ? { href: '/app/books/invoices', label: 'Clear' } : null, active,
});

describe('UI Block 9 · F07 — the shared filter bar', () => {
  it('each field is a label that wraps its words and its control', () => {
    const html = bar();
    // The controls pass (2026-11-25): the search control sits in its mark's frame (`field-search`), still inside its label.
    const labels = html.match(/<label class="fbar-f[^"]*"><span class="fbar-l">[^<]+<\/span>(?:<span class="field-search">)?<(input|select)[^]*?<\/label>/g) ?? [];
    expect(labels).toHaveLength(2);
    expect(html).not.toMatch(/<label[^>]*for=/);
    expect(html).toMatch(/^<form method="get" action="\/app\/books\/invoices" class="fbar bd-filters" role="search" aria-label="Search invoices">/);
  });

  it('the search stays in view; the other filters sit in the phone fold, open when the page arrives', () => {
    const html = bar();
    const fold = html.indexOf('<details class="fbar-more" data-fbar data-fbar-on="0" open>');
    expect(fold).toBeGreaterThan(html.indexOf('name="q"'));
    expect(html.indexOf('name="state"')).toBeGreaterThan(fold);
    expect(html).toContain('<summary class="fbar-toggle">Filters</summary>');
    expect(bar(1)).toContain('data-fbar-on="1" open><summary class="fbar-toggle">Filters <span class="fbar-n"><bdi>1</bdi></span></summary>');
    expect(filterBar({ locale: 'en', action: '/a', name: 'n', search: { label: 'q', control: '<input name="q">' }, submit: 's' })).not.toContain('<details');
  });

  it('"Show results" is a secondary act, never the page\'s fill; Clear sits beside it', () => {
    const html = bar(1);
    expect(html).toContain('<div class="fbar-acts"><button class="btn" type="submit">Show results</button><a class="fbar-clear" href="/app/books/invoices">Clear</a></div>');
    expect(html).not.toContain('btn send');
    expect(FILTER_BAR_CSS).toMatch(/\.fbar \.fbar-acts \.btn \{[^}]*background:var\(--color-surface\)/);
  });

  it('one height and one bottom edge on a desk; the words above, full width, and the fold on a phone', () => {
    expect(FILTER_BAR_CSS).toMatch(/\.fbar \{ display:flex; flex-wrap:wrap; align-items:flex-end;/);
    expect(FILTER_BAR_CSS).toMatch(/\.fbar \.fbar-f \{ display:flex; flex-direction:column;/);
    // The controls pass (2026-11-25): the height is the shared field's and the shared button's (controlsStyle.ts), 40 and
    // 36 on a desk, 44 under a finger; the bar keeps its bottom edge (align-items:flex-end) and sizes nothing itself.
    expect(FILTER_BAR_CSS).toMatch(/\.fbar \.fbar-f input, \.fbar \.fbar-f select \{ flex:none; box-sizing:border-box; inline-size:100%; \}/);
    expect(FILTER_BAR_CSS).toMatch(/\.fbar \.fbar-acts \.btn \{ box-sizing:border-box; padding-block:0;/);
    expect(CONTROLS_CSS).toMatch(/block-size:var\(--control-field\)/);
    expect(CONTROLS_CSS).toMatch(/@media \(max-width: 720px\), \(pointer: coarse\) \{[^@]*block-size:var\(--control-touch\)/);
    expect(FILTER_BAR_CSS).toMatch(/\.fbar \.fbar-more > summary \{ display:none; \}/);
    const phone = FILTER_BAR_CSS.slice(FILTER_BAR_CSS.indexOf('@media (max-width:720px)'));
    expect(phone).toMatch(/\.fbar \{ flex-direction:column; align-items:stretch;/);
    expect(phone).toMatch(/\.fbar \.fbar-more > summary \{ display:flex;[^}]*min-block-size:44px;/);
  });

  it('the shared script folds the filters on a phone only when none is on, and opens them on a desk', () => {
    expect(LIVE_SCRIPT).toContain("doc.querySelectorAll('details[data-fbar]')");
    expect(LIVE_SCRIPT).toContain("window.matchMedia('(max-width:720px)')");
    expect(LIVE_SCRIPT).toContain("all[i].open = !mq.matches || all[i].getAttribute('data-fbar-on') !== '0';");
    expect(LIVE_SCRIPT).toMatch(/\n {2}copying\(\);\n {2}filters\(\);\n/);
  });

  it('every filtered list draws its filters through the bar, and no filter form of its own is left', () => {
    for (const p of PAGES) {
      const s = src(p);
      expect(s, p).toContain("import { filterBar } from './filterBar.js';");
      expect(s, p).toMatch(/filterBar\(\{/);
      expect(s, p).not.toMatch(/<form (method="get" )?(class="(bd-filters|ca-filters|pa-search|saved-search|ak-search|bs-filter|search)")/);
      expect(s, p).not.toMatch(/<form method="get" action="[^"]*" class="(pform )?(bd-filters|ca-filters|pa-search|saved-search|bs-filter|bb-account)"/);
    }
  });

  it('"Filters" is written in every catalogue, in its own language', () => {
    const words = LOCALES.map((l) => t(l, 'filters.more'));
    expect(new Set(words).size).toBe(LOCALES.length);
    for (const w of words) expect(w.length).toBeGreaterThan(0);
  });
});
