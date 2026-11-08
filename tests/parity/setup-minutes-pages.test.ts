import { describe, expect, it } from 'vitest';
import {
  FIXTURE_CONTACT_IMPORT_COLUMNS as columns, FIXTURE_CONTACT_IMPORT_PREVIEW as preview,
  FIXTURE_CONTACT_IMPORT_CONFIRM as confirmed, FIXTURE_SHOPIFY_FORM as shopify, FIXTURE_SHOPIFY_REFUSALS,
  FIXTURE_SETUP_MILESTONES as milestones, FIXTURE_SETUP_MILESTONES_DONE as done,
  FIXTURE_SETUP_MILESTONES_OPERATOR as operator, FIXTURE_SETUP_NOW as now,
  FIXTURE_SETUP_MILESTONES_PENDING as pending,
} from '../fixtures/setupMinutes.js';
import { renderContactImportUpload, renderContactImportColumns, renderContactImportCheck, renderContactImportDone } from '../../src/api/web/contactImport.js';
import { renderShopifyCredentials, renderStoreForms } from '../../src/api/web/storeImport.js';
import { renderAddForm } from '../../src/api/web/products.js';
import { renderGuide, renderSetupMilestones } from '../../src/api/web/guide.js';
import { shell } from '../../src/api/web/layout.js';
import { withAssistantName } from '../../src/api/web/say.js';
import { buttonsAndDoors } from './buttons-and-doors.js';
import { unisolatedFigures, withoutIsolates } from './isolates.js';
import { linkedCss } from './linked-css.js';

const plain = (html: string) => withoutIsolates(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const forms = (html: string) => [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(m => m[0]);
const base = `/app/customers/import/${preview.importId}`;

describe('Block 4.4 · setup views', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: the fixture pages have one heading, isolated values, commands and doors, and no script or raw key`, () => {
      for (const html of [renderContactImportUpload(locale), renderContactImportColumns(columns, locale), renderContactImportCheck(preview, locale), renderContactImportDone(confirmed, locale)]) {
        expect(html.match(/<h1\b/g)).toHaveLength(1);
        expect(plain(html)).not.toMatch(/(?:contactImport|storeToken|setupClock)\.[a-z]|\{(?:n|name|rows)\}/);
        expect(html).not.toMatch(/<script|onchange=|onclick=/);
        expect(buttonsAndDoors(html)).toEqual([]);
        if (locale === 'ar') expect(unisolatedFigures(html)).toEqual([]);
      }
    });
  }

  it('offers separate file and paste forms and an international-number example', () => {
    const html = renderContactImportUpload('en');
    expect(forms(html)).toHaveLength(2);
    expect(forms(html).every(f => f.includes('action="/app/customers/import"'))).toBe(true);
    expect(html).toContain('enctype="multipart/form-data"');
    expect(html).toContain('name="file"');
    expect(html).toContain('.xlsx');
    expect(html).toContain('name="text"');
    expect(plain(html)).toContain('sends nobody a message');
    expect(plain(html)).toContain('name,phone,language,notes');
    expect(plain(html)).toContain('+12025550101');
  });

  it('keeps file reading as the only main action on the upload page, including refusals', () => {
    for (const locale of ['en', 'ar'] as const) {
      for (const html of [renderContactImportUpload(locale), ...(['file', 'paste'] as const).map(source =>
        renderContactImportUpload(locale, { problem: { source, reason: 'not_a_table' } }))]) {
        expect(html.match(/<button class="btn send"/g)).toHaveLength(1);
        expect(forms(html)[0]).toContain('<button class="btn send" type="submit">');
        expect(forms(html)[1]).toContain('<button class="btn" type="submit">');
      }
    }
  });

  it('puts upload refusal under its own input and safely retains a pasted table', () => {
    const html = renderContactImportUpload('ar', { problem: { source: 'paste', reason: 'not_a_table' }, text: '</textarea><script>bad</script>' });
    expect(forms(html)[0]).not.toContain('role="alert"');
    expect(forms(html)[1]).toContain('role="alert"');
    expect(html).toContain('aria-describedby="contact-paste-error"');
    expect(html).toContain('&lt;/textarea&gt;&lt;script&gt;bad&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('maps four columns, keeps the header choice and previews only the first three records', () => {
    const html = renderContactImportColumns(columns, 'en', { problem: 'no_phone_column' });
    expect(html.match(/<select\b/g)).toHaveLength(4);
    expect(html).toContain(`action="${base}/columns"`);
    expect(html).toMatch(/name="header"[^>]*checked/);
    expect(html).toContain('aria-describedby="contact-columns-error"');
    expect(html).toContain('Casey from file');
    expect(html).not.toContain('Avery again');
    expect(renderContactImportColumns({ ...columns, hasHeader: false, headers: ['', '', '', ''] }, 'en')).toContain('Column 3');
  });

  it('focuses only the refused upload field or missing phone column, with no initial autofocus', () => {
    for (const locale of ['en', 'ar'] as const) {
      expect(renderContactImportUpload(locale)).not.toContain('autofocus');
      expect(renderContactImportColumns(columns, locale)).not.toContain('autofocus');
      for (const source of ['file', 'paste'] as const) {
        const html = renderContactImportUpload(locale, { problem: { source, reason: 'not_a_table' } });
        expect(html.match(/\bautofocus\b/g)).toHaveLength(1);
        expect(html).toMatch(source === 'file' ? /<input[^>]*id="contact-file"[^>]*autofocus/ : /<textarea[^>]*id="contact-text"[^>]*autofocus/);
      }
      const html = renderContactImportColumns(columns, locale, { problem: 'no_phone_column' });
      expect(html.match(/\bautofocus\b/g)).toHaveLength(1);
      expect(html).toMatch(/<select[^>]*id="contact-column-phone"[^>]*autofocus/);
    }
  });

  it('only selects eligible rows, with honest counts, first-row duplicates and untouched matches', () => {
    const html = renderContactImportCheck(preview, 'en');
    expect(html.match(/name="rows"/g)).toHaveLength(2);
    expect(html.match(/name="rows"[^>]*checked/g)).toHaveLength(2);
    expect(html).toContain(`action="${base}/confirm"`);
    expect(html).toContain(`formaction="${base}/select"`);
    expect(html).toContain('name="selection" value="all"');
    expect(html).toContain('name="selection" value="none"');
    expect(plain(html)).toContain("11 rows: 2 to add, 1 already your customers, 8 that can't be added");
    expect(plain(html)).toContain('On record as Casey on record');
    expect(plain(html)).toContain('Same phone number as row 2');
    expect(plain(html)).toContain('nothing in them is changed');
    expect(plain(html)).toContain('Leave out anyone who asked you to delete their data.');
    expect(html).toContain('N'.repeat(1001));
    expect(html).toMatch(/<details class="ci-notes"><summary>/);
    expect(html).toContain(`action="${base}/discard"`);
    expect(html).toMatch(/<button[^>]*data-confirm=/);
  });

  it('keeps unticked rows unticked, escapes customer text and never silently shortens notes', () => {
    const row = preview.rows[0]!;
    if (row.verdict.kind !== 'to_add') throw Error('fixture needs an add row');
    const html = renderContactImportCheck({ ...preview, rows: [{ ...row, verdict: { ...row.verdict, selected: false, contact: { ...row.verdict.contact, name: '<script>bad</script>', notes: 'n'.repeat(200) } } }], counts: { total: 1, toAdd: 1, existing: 0, refused: 0, duplicateInFile: 0, selected: 0 } }, 'ar');
    expect(html).not.toMatch(/name="rows"[^>]*checked/);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(html).toContain('n'.repeat(200));
    expect(html).toContain('<details');
    expect(unisolatedFigures(html)).toEqual([]);
  });

  it('reports the confirmed counts, including a match that arrived during review', () => {
    const html = plain(renderContactImportDone(confirmed, 'en'));
    expect(html).toContain('Added 1 customer. Nobody was sent a message.');
    expect(html).toContain('1 matched while you were checking');
    expect(html).not.toContain('Avery');
  });

  it('keeps the Add action truthful when the saved selection changes without script', () => {
    for (const selected of [0, 1, 2]) {
      const html = renderContactImportCheck({ ...preview, counts: { ...preview.counts, selected } }, 'ar');
      const confirm = forms(html).find(form => form.includes(`action="${base}/confirm"`)) ?? '';
      const add = confirm.match(/<button class="btn send"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';
      expect(plain(add)).toBe('Add the ticked customers');
    }
  });

  it('keeps the Shopify door closed initially and uses one credential form with two fieldsets', () => {
    const html = renderShopifyCredentials('en', 'USD', { form: shopify });
    expect(html).not.toMatch(/<details[^>]*\bopen/);
    expect(forms(html)).toHaveLength(1);
    expect(html.match(/<fieldset\b/g)).toHaveLength(2);
    expect(html.match(/<legend\b/g)).toHaveLength(2);
    expect(html).toContain('action="/app/products/add/shopify"');
    expect(html).toContain('name="currency"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toMatch(/<script|onchange=/);
    expect(buttonsAndDoors(html)).toEqual([]);
    expect(forms(renderStoreForms('en', 'USD'))).toHaveLength(3);
    expect(renderStoreForms('ar', 'USD', { form: 'store', reason: 'password_protected', address: shopify.address })).toMatch(/<details class="store-token" open>/);
  });

  it('shows a typed Shopify refusal on the add page with empty credentials and the currency choice kept', () => {
    for (const locale of ['en', 'ar'] as const) {
      const html = renderAddForm(locale, undefined, 'USD', null, null, false, false, {
        shopify: { form: FIXTURE_SHOPIFY_REFUSALS.token_401, currencyConfirmed: true },
      }, now);
      expect(html).toContain('<details class="store-token" open>');
      const credentials = forms(html).find(form => form.includes('action="/app/products/add/shopify"')) ?? '';
      expect(credentials).toContain('role="alert" id="shopify-result-error"');
      expect(plain(credentials)).toContain('Shopify did not accept this “Admin API access token”.');
      expect(credentials).toContain(`value="${shopify.address}"`);
      expect(credentials).toContain('name="currency" value="on" checked');
      for (const name of ['token', 'client_id', 'client_secret']) {
        const input = credentials.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? '';
        expect(input).toContain('type="password"');
        expect(input).toContain('value=""');
      }
      expect(buttonsAndDoors(html)).toEqual([]);
    }
  });

  it('keeps the product page main action when the Shopify form is closed or refused', () => {
    for (const locale of ['en', 'ar'] as const) {
      for (const html of [renderAddForm(locale), renderAddForm(locale, undefined, 'USD', null, null, false, false, {
        shopify: { form: FIXTURE_SHOPIFY_REFUSALS.token_401 },
      }, now)]) {
        expect(html.match(/<button class="btn send"/g)).toHaveLength(1);
        expect(forms(html).find(form => form.includes('action="/app/products/add/review"'))).toContain('<button class="btn send"');
        expect(forms(html).find(form => form.includes('action="/app/products/add/shopify"'))).toContain('<button class="btn" type="submit">');
      }
    }
  });

  it('says password-protected once under the store address and opens the credentials without repeating it', () => {
    for (const html of [
      renderStoreForms('ar', 'USD', { form: 'store', reason: 'password_protected', address: shopify.address }),
      renderStoreForms('ar', 'USD', null, { form: FIXTURE_SHOPIFY_REFUSALS.password_protected }),
    ]) {
      expect(html.match(/role="alert"/g)).toHaveLength(1);
      const store = forms(html).find(form => form.includes('action="/app/products/add/store"')) ?? '';
      expect(store).toContain('role="alert"');
      expect(store.indexOf('name="address"')).toBeLessThan(store.indexOf('role="alert"'));
      expect(store.indexOf('role="alert"')).toBeLessThan(store.indexOf('<button'));
      expect(plain(store)).toContain('This Shopify store is password-protected');
      expect(html).toContain('<details class="store-token" open>');
      expect(forms(html).find(form => form.includes('action="/app/products/add/shopify"'))).not.toContain('role="alert"');
    }
  });

  for (const [code, form] of Object.entries(FIXTURE_SHOPIFY_REFUSALS)) {
    it(`Shopify ${code}: opens the refusal with empty protected credentials`, () => {
      const html = renderShopifyCredentials('ar', 'USD', { form });
      expect(html).toMatch(/<details[^>]*\bopen/);
      if (code === 'password_protected') expect(html).not.toContain('role="alert"');
      else {
        expect(html.match(/role="alert"/g)).toHaveLength(1);
        expect(html).toMatch(/<button class="btn"[^>]*>[\s\S]*?<\/button>\s*<p class="perr" role="alert"/);
      }
      for (const name of ['token', 'client_id', 'client_secret']) {
        const input = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? '';
        for (const attr of ['type="password"', 'autocomplete="off"', 'spellcheck="false"', 'autocapitalize="off"', 'dir="ltr"', 'value=""']) expect(input).toContain(attr);
      }
      expect(plain(html)).not.toMatch(/storeToken\.|import\.store\./);
      expect(unisolatedFigures(html)).toEqual([]);
      if (code === 'application_cannot_be_found') expect(plain(html)).toContain("the store's organization");
      if (code === 'exchange_401') expect(plain(html)).toContain("the app's Settings");
    });
  }

  it('never reflects credential props, unsafe addresses or raw provider messages', () => {
    const malicious = { ...shopify, address: 'https://secret@example.myshopify.com/?token=LEAK', token: 'LEAK', client_id: 'LEAK', client_secret: 'LEAK' } as unknown as typeof shopify;
    const html = renderShopifyCredentials('en', 'USD', { form: malicious });
    expect(html).not.toContain('LEAK');
    expect(html).not.toContain('secret@');
  });

  it('draws the static running and completed clocks from the injected dates', () => {
    const running = plain(renderSetupMilestones(milestones, 'en', { now, canManage: true }));
    expect(running).toContain('20 min since you signed up');
    expect(running).toContain('Done, 4 min after you signed up');
    expect(running).toContain('Done, 12 min after you signed up');
    expect(plain(renderSetupMilestones(done, 'en', { now, canManage: true }))).toContain('All four done in 18 min');
    const later = plain(renderSetupMilestones(milestones, 'en', { now: new Date('2026-11-09T13:00:00Z'), canManage: true }));
    expect(later).toContain('2 days 3 h since you signed up');
  });

  it('shows operator dates without a clock, staff without owner doors, and isolates Arabic figures', () => {
    const html = renderSetupMilestones(operator, 'ar', { now, canManage: false });
    expect(plain(html)).toContain('Done on');
    expect(plain(html)).not.toContain('since you signed up');
    expect(plain(html)).toContain('The owner does this');
    expect(html).not.toContain('<a');
    expect(html).not.toMatch(/<script|setInterval|Date\.now/);
    expect(unisolatedFigures(html)).toEqual([]);
  });

  it('keeps all pending owner actions out of the staff milestone view', () => {
    const html = renderSetupMilestones(pending, 'en', { now, canManage: false });
    expect(plain(html).match(/The owner does this/g)).toHaveLength(3);
    expect(plain(html).match(/Not yet/g)).toHaveLength(4);
    expect(plain(html)).toContain('20 min since you signed up');
    expect(html).not.toContain('<a');
  });

  it('places four milestone rows before the existing five setup steps without changing them', () => {
    const html = withAssistantName('Lily', () => renderGuide({ steps: [], next: 'profile' }, 'en', 'Lily', undefined, { milestones, now, canManage: true }));
    expect(html.match(/class="guide-step/g)).toHaveLength(5);
    expect(html.match(/data-milestone=/g)).toHaveLength(4);
    expect(html.indexOf('setup-clock')).toBeLessThan(html.indexOf('guide setup-steps'));
    expect(html).toContain('href="/app/customers/import"');
    expect(buttonsAndDoors(html)).toEqual([]);
  });

  it('serves scoped styles with black primary actions and phone rows that wrap', () => {
    const css = linkedCss(shell({ title: 'Customers', active: 'customers', path: '/app/customers/import', locale: 'ar', bodyHtml: renderContactImportCheck(preview, 'ar') }));
    expect(css).toContain('.contact-import');
    expect(css).toContain('.store-token');
    expect(css).toContain('.setup-clock');
    expect(css).toContain('overflow-wrap:anywhere');
    expect(css).toMatch(/\.contact-import \.btn\.send[^}]*background:var\(--color-ink\)/);
    expect(css).toMatch(/\.ci-count\{color:var\(--color-ink\)/);
  });
});
