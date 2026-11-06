import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BOOKS_COUNTRIES, COUNTRY_PACKS, US_STATES, einAsTyped, isBooksCountry, isEin, stateOfTaxCode, stateTaxCode, taxRateOf, usStateOf,
} from '../../src/core/books/countryPacks.js';
import { BOOKS_RETENTION } from '../../src/core/legal/booksRetention.js';
import { REQUIRED_SCHEMA_VERSION } from '../../src/db/schemaVersion.js';
import { holdsMoney } from '../../src/core/books/moneyAccounts.js';
import { renderBooksCountry, renderMoneyAccounts } from '../../src/api/web/booksCountry.js';
import type { CountryBooksView } from '../../src/db/booksCountry.js';
import { unisolatedFigures, withoutIsolates } from './isolates.js';

/**
 * Block 2 PR 1 (0225) — the country packs' pure parts: the three packs as defined, held to the migrations they point
 * at; the EIN and the state code; the page drawn for each country. Over Postgres, through the routes:
 * tests/integration/books-country-packs.test.ts.
 */
const ROOT = join(__dirname, '..', '..');
const m0190 = readFileSync(join(ROOT, 'migrations/0190_cgnc_chart.sql'), 'utf8');
const m0225 = readFileSync(join(ROOT, 'migrations/0225_books_country_packs.sql'), 'utf8');
const TAX_CODE = /^[A-Z0-9_-]{1,12}$/;   // tax_codes.code (0170)
const templateRows = (template: string) => [...m0225.matchAll(new RegExp(`\\('${template}', '([^']+)', '((?:[^']|'')*)', '(\\w+)', null, (true|false)\\)`, 'g'))]
  .map((m) => ({ code: m[1]!, name: m[2]!.replace(/''/g, "'"), kind: m[3]!, holdsMoney: m[4] === 'true' }));

describe('the three packs, as defined', () => {
  it('Morocco, the United Kingdom and the United States; nobody else is a books country', () => {
    expect(BOOKS_COUNTRIES).toEqual(['MA', 'GB', 'US']);
    for (const c of ['FR', 'ES', 'CN', '', null, undefined]) expect(isBooksCountry(c)).toBe(false);
    expect(Object.keys(COUNTRY_PACKS).sort()).toEqual(['GB', 'MA', 'US']);
  });

  it('every tax code has a shape the database takes, is unique in its pack, and an exempt code alone has no account', () => {
    for (const pack of Object.values(COUNTRY_PACKS)) {
      const codes = pack.taxCodes.map((c) => c.code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const c of pack.taxCodes) {
        expect(c.code).toMatch(TAX_CODE);
        expect(c.account === null).toBe(c.kind === 'exempt');
        expect(Number(c.rate)).toBeGreaterThanOrEqual(0);
        expect(Number(c.rate)).toBeLessThanOrEqual(100);
      }
    }
  });

  it('Morocco: the CGNC chart; TVA 20/14/10/7 collected on 4455 and deductible on 34552, EXO exempt; months; ten years', () => {
    const ma = COUNTRY_PACKS.MA;
    expect(ma.chart).toBe('cgnc-normal');
    expect(ma.periodDefault).toBe('month');
    expect(ma.identifier).toBe('morocco');
    expect(ma.retentionYears).toBe(10);
    expect(ma.taxCodes.filter((c) => c.kind === 'collected').map((c) => [c.code, c.rate, c.account])).toEqual([
      ['TVA20', '20', '4455'], ['TVA14', '14', '4455'], ['TVA10', '10', '4455'], ['TVA7', '7', '4455']]);
    expect(ma.taxCodes.filter((c) => c.kind === 'deductible').map((c) => [c.code, c.rate, c.account])).toEqual([
      ['TVA20_D', '20', '34552'], ['TVA14_D', '14', '34552'], ['TVA10_D', '10', '34552'], ['TVA7_D', '7', '34552']]);
    expect(ma.taxCodes.filter((c) => c.kind === 'exempt').map((c) => c.code)).toEqual(['EXO']);
    // the accounts it names are the CGNC's, as 0190 prints them
    expect(m0190).toContain("('cgnc-normal', '4455', 'Etat, T.V.A. facturée', 'liability', '445')");
    expect(m0190).toContain("('cgnc-normal', '34552', 'ETAT - T.V.A. récupérable sur les charges', 'asset', '3455')");
    for (const code of Object.values(ma.drafts)) expect(m0190.includes(`('cgnc-normal', '${code}', `), code).toBe(true);
  });

  it('the United Kingdom: a plain chart; VAT 20 and 5, a ZERO RATE that is collected (not exempt), EXEMPT; the company number; six years', () => {
    const gb = COUNTRY_PACKS.GB;
    expect(gb.chart).toBe('uk-plain');
    expect(gb.identifier).toBe('company_number');
    expect(gb.retentionYears).toBe(6);
    expect(gb.taxCodes.map((c) => [c.code, c.rate, c.kind, c.account])).toEqual([
      ['VAT20', '20', 'collected', '2100'], ['VAT5', '5', 'collected', '2100'], ['VAT0', '0', 'collected', '2100'], ['EXEMPT', '0', 'exempt', null]]);
    expect(gb.salesTaxAccount).toBeNull();
  });

  it('the United States: a plain chart with Sales tax payable, no VAT, a rate per state typed by the owner; the EIN; seven years', () => {
    const us = COUNTRY_PACKS.US;
    expect(us.chart).toBe('us-plain');
    expect(us.identifier).toBe('ein');
    expect(us.retentionYears).toBe(7);
    expect(us.taxCodes).toEqual([]);
    expect(us.salesTaxAccount).toBe('2100');
    expect(templateRows('us-plain').find((a) => a.code === '2100')).toEqual({ code: '2100', name: 'Sales tax payable', kind: 'liability', holdsMoney: false });
    expect(templateRows('us-plain').some((a) => /VAT/i.test(a.name))).toBe(false);
  });

  it('the retention the packs say is the retention the privacy page and the table say', () => {
    for (const pack of Object.values(COUNTRY_PACKS)) {
      expect(BOOKS_RETENTION.find((r) => r.country === pack.country)?.years, pack.country).toBe(pack.retentionYears);
    }
    expect(m0225).toMatch(/insert into books_retention \(country, years, law\) values\s*\('US', 7, '[^']*Nomi''s own choice/);
  });
});

describe('the two plain charts in 0225, and the money marker', () => {
  for (const template of ['uk-plain', 'us-plain'] as const) {
    it(`${template}: about forty accounts, four-digit codes, unique, every kind present; the bank and cash accounts alone hold money`, () => {
      const rows = templateRows(template);
      expect(rows.length).toBeGreaterThanOrEqual(40);
      expect(rows.length).toBeLessThanOrEqual(45);
      expect(new Set(rows.map((r) => r.code)).size).toBe(rows.length);
      for (const r of rows) expect(r.code).toMatch(/^\d{4}$/);
      expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(['asset', 'liability', 'equity', 'income', 'expense']));
      expect(rows.filter((r) => r.holdsMoney).map((r) => r.code)).toEqual(['1000', '1010', '1020']);
      // the accounts the pack drafts with are in its chart
      const pack = template === 'uk-plain' ? COUNTRY_PACKS.GB : COUNTRY_PACKS.US;
      for (const code of [pack.drafts.receivable, pack.drafts.sales, pack.drafts.fxLoss, pack.drafts.fxGain]) expect(rows.some((r) => r.code === code), code).toBe(true);
      for (const c of pack.taxCodes) if (c.account) expect(rows.some((r) => r.code === c.account), c.code).toBe(true);
      expect(m0225).toContain(`('${template}', '${pack.drafts.salesJournal}', 'Sales', 'sales')`);
    });
  }

  it('the marker is what the code\'s rule could not see: "Checking account" is marked in the chart and recognised by no name', () => {
    expect(holdsMoney('1000', 'Checking account')).toBe(false);
    expect(holdsMoney('1000', 'Barclays Current')).toBe(false);
    expect(templateRows('us-plain').find((a) => a.code === '1000')).toEqual({ code: '1000', name: 'Checking account', kind: 'asset', holdsMoney: true });
  });

  it('the CGNC template is marked by UPDATE (0190 is applied, never edited), on the 514 and 516 families as the rule reads them', () => {
    expect(m0225).toMatch(/update chart_template_accounts set holds_money = true where template = 'cgnc-normal' and code ~ '\^51\[46\]'/);
    expect(m0190).not.toContain('holds_money');
    expect(m0225).toMatch(/insert into accounts \(business_id, code, name, kind, holds_money\)/);
    expect(m0225).toMatch(/update accounts set holds_money = true\s+where kind = 'asset'/);
  });

  it('the schema this build needs is 0225', () => {
    expect(REQUIRED_SCHEMA_VERSION).toBe(225);
    expect(m0225).toContain("insert into _migrations (version, name) values (225, 'books_country_packs')");
  });
});

describe('the EIN, the state and the rate, as typed', () => {
  it('an EIN is nine digits however typed, kept as 00-0000000; anything else is refused', () => {
    expect(einAsTyped('12-3456789')).toBe('12-3456789');
    expect(einAsTyped('123456789')).toBe('12-3456789');
    expect(einAsTyped(' 12 345 6789 ')).toBe('12-3456789');
    expect(isEin(einAsTyped('123456789'))).toBe(true);
    for (const bad of ['12-345678', '1234567890', '12-34567A9', 'EIN', '']) expect(isEin(einAsTyped(bad)), bad).toBe(false);
  });

  it('a state is one of the fifty or the District, upper-cased; its tax code is ST_ and the state, and reads back', () => {
    expect(US_STATES.length).toBe(51);
    expect(new Set(US_STATES).size).toBe(51);
    expect(usStateOf('ca')).toBe('CA');
    expect(usStateOf(' dc ')).toBe('DC');
    for (const bad of ['XX', 'C', 'CAL', 'PR', '']) expect(usStateOf(bad), bad).toBeNull();
    expect(stateTaxCode('CA')).toBe('ST_CA');
    expect(stateTaxCode('CA')).toMatch(TAX_CODE);
    expect(stateOfTaxCode('ST_CA')).toBe('CA');
    expect(stateOfTaxCode('VAT20')).toBeNull();
    expect(stateOfTaxCode('ST_')).toBeNull();
  });

  it('a rate is a percentage from 0 to 100 with at most four decimals, either decimal mark, a % sign allowed', () => {
    expect(taxRateOf('8.25')).toBe('8.25');
    expect(taxRateOf('8,25')).toBe('8.25');
    expect(taxRateOf('7%')).toBe('7');
    expect(taxRateOf('10.50')).toBe('10.5');
    expect(taxRateOf('0')).toBe('0');
    expect(taxRateOf('100')).toBe('100');
    for (const bad of ['101', '-1', '8.12345', 'abc', '', '8.2.5']) expect(taxRateOf(bad), bad).toBeNull();
  });
});

describe('the page, drawn for each country', () => {
  const view = (o: Partial<CountryBooksView>): CountryBooksView => ({
    country: null, currency: 'USD', start: null, firstYear: null, companyNumber: null, ein: null, moroccanIds: false, posted: 0, accounts: 0, taxCodes: [], ...o,
  });
  const draw = (v: CountryBooksView, locale: 'en' | 'ar' = 'en', states: { state: string; rate: string }[] = []) => renderBooksCountry(locale, v, null, states, '2026-11-06');

  it('the United Kingdom asks for the company number; the United States for the EIN and, once saved, a rate per state; Morocco points at the identifiers', () => {
    const gb = draw(view({ country: 'GB', currency: 'GBP' }));
    expect(gb).toContain('name="company_number"');
    expect(gb).toContain('VAT at 20%, 5% and 0%');
    expect(gb).toContain('6 years after the end');
    expect(gb).not.toContain('name="ein"');
    expect(gb).not.toContain('id="states"');
    const us = draw(view({ country: 'US', accounts: 42 }), 'en', [{ state: 'CA', rate: '8.25' }]);
    expect(us).toContain('name="ein"');
    expect(us).toContain('id="states"');
    expect(us).toContain('8.25%');
    expect(us).toContain('42 accounts');
    expect(us).toContain('7 years after the end');
    expect(us).not.toContain('<option value="CA">');   // a state with a rate is not offered again
    expect(us).toContain('<option value="NY">');
    const ma = draw(view({ country: 'MA', currency: 'MAD' }));
    expect(ma).toContain('href="/app/settings/business/profile#identifiers"');
    expect(ma).toContain('TVA at 20%, 14%, 10% and 7%');
    expect(ma).toContain('10 years after the end');
  });

  it('a country the packs do not cover is named, with the three Nomi keeps books for; the currency is read here and changed on its own page', () => {
    const fr = draw(view({ country: 'FR', currency: 'EUR' }));
    expect(fr).toContain('Books for France are not ready yet.');
    expect(fr).toContain('Morocco, the United Kingdom and the United States');
    expect(fr).toContain('href="/app/settings/business/currency"');
    expect(fr).toContain('<option value="FR" selected>');
    expect(fr).not.toContain('name="company_number"');
  });

  it('what is decided once is drawn as a value, not a control: the period and the first year', () => {
    const open = draw(view({ country: 'GB' }));
    expect(open).toContain('name="period"');
    expect(open).toContain('name="year_start"');
    const started = draw(view({ country: 'GB', start: { day: '2026-04-06', length: 'quarter' }, firstYear: { startsOn: '2026-04-06', endsOn: '2027-04-05' } }));
    expect(started).not.toContain('name="period"');
    expect(started).not.toContain('name="year_start"');
    expect(started).toContain('Quarters, since');
    expect(started).toContain('Chosen once');
  });

  it('one Save, drawn as the main button; a door is words, never a button; no raw key; every figure isolated in Arabic', () => {
    const en = draw(view({ country: 'US', accounts: 42 }), 'en', [{ state: 'TX', rate: '6.25' }]);
    expect(en.match(/class="btn send"/g)?.length).toBe(1);
    expect(en).not.toMatch(/<a[^>]*class="btn/);
    expect(en).not.toMatch(/books\.country\./);
    const ar = draw(view({ country: 'US', accounts: 42 }), 'ar', [{ state: 'TX', rate: '6.25' }]);
    expect(withoutIsolates(ar)).toContain('مخطط الحسابات');
    expect(unisolatedFigures(ar)).toEqual([]);
  });

  it('the money subject on the accounts page: an account the rule knows is ticked and fixed; "Barclays Current" is the owner\'s tick', () => {
    const html = renderMoneyAccounts('en', [
      { id: 'a1', code: '5141', name: 'Banques', marked: true, byRule: true },
      { id: 'a2', code: '1000', name: 'Barclays Current', marked: false, byRule: false },
      { id: 'a3', code: '1010', name: 'Savings account', marked: true, byRule: false },
    ]);
    expect(html).toContain('action="/app/books/accounts/money"');
    expect(html).toMatch(/value="a1" checked disabled/);
    expect(html).toMatch(/value="a2" \/>/);
    expect(html).toMatch(/value="a3" checked \/>/);
    expect(html).toContain('by its name');
    expect(renderMoneyAccounts('en', [])).toContain('No asset account yet.');
  });
});
