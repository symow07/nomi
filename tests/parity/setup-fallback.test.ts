import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderContactImportUpload, renderContactImportColumns, renderContactImportCheck, renderContactImportDone } from '../../src/api/web/contactImport.js';
import { renderStoreForms } from '../../src/api/web/storeImport.js';
import { renderGuide } from '../../src/api/web/guide.js';
import { shell } from '../../src/api/web/layout.js';
import { FIXTURE_CONTACT_IMPORT_COLUMNS as columns, FIXTURE_CONTACT_IMPORT_PREVIEW as preview, FIXTURE_CONTACT_IMPORT_CONFIRM as done, FIXTURE_SHOPIFY_REFUSALS, FIXTURE_SETUP_MILESTONES_PENDING as milestones, FIXTURE_SETUP_NOW as now } from '../fixtures/setupMinutes.js';
import { unisolatedEnglish } from './english-isolates.js';
import { linkedCss } from './linked-css.js';

const pages = {
  upload: () => renderContactImportUpload('ar'),
  columns: () => renderContactImportColumns(columns, 'ar'),
  check: () => renderContactImportCheck(preview, 'ar'),
  done: () => renderContactImportDone(done, 'ar'),
  shopify: () => renderStoreForms('ar', 'USD', null, { form: FIXTURE_SHOPIFY_REFUSALS.token_401 }),
  guide: () => renderGuide({ steps: [], next: 'products' }, 'ar', 'ياسمين', undefined, { milestones, now, canManage: true }),
  completed: () => renderGuide({ steps: [], next: null }, 'ar', 'ياسمين'),
};
describe('F3 · English fallback sweep of Arabic setup pages', () => {
  for (const [name, render] of Object.entries(pages)) it(name, () => {
    expect(unisolatedEnglish(shell({ locale: 'ar', title: 'Nomi', active: 'home', path: '/app/get-started', bodyHtml: render() }))).toEqual([]);
  });
  it('isolates the standalone route heading as well as the embedded guide', () => {
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    const route = app.slice(app.indexOf("app.get('/app/get-started'"), app.indexOf("app.get('/app/onboarding/practice'"));
    for (const key of ['area1.setup.title', 'area1.setup.intro']) expect(route).toContain(`wordsHtml(locale, '${key}')`);
  });
  it('keeps a wrapping English help door and summary at the Arabic page edge', () => {
    const css = linkedCss(shell({ locale: 'ar', title: 'Nomi', active: 'products', path: '/app/products/add', bodyHtml: pages.shopify() }));
    expect(css).toMatch(/\[dir="rtl"\] \.store-token \.deeper>bdi\[lang="en"\][^{]*\{[^}]*text-align:end/);
    expect(css).toMatch(/\.gs-help>summary>bdi\[lang="en"\][^{]*\{[^}]*text-align:match-parent/);
  });
});
