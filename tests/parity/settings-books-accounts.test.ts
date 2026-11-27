import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderBooksAccountsPage, renderBooksChartPage, accountOption, moneyCandidates, type MoneyChoice } from '../../src/api/web/booksSettingsPages.js';
import { picked } from '../../src/api/web/settingsPage.js';
import { holdsMoney } from '../../src/core/books/moneyAccounts.js';
import { settingsApp, drawSettingsPage, postSettingsForm, mainOf } from './settings-harness.js';
import { t } from '../../src/api/web/say.js';
import { esc as attr } from '../../src/api/web/layout.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { BOOKS_AREA_CSS } from '../../src/api/web/booksAreaStyle.js';

/**
 * THE SETTINGS OVERHAUL (rule 104) — ACCOUNTS, rebuilt. With the Moroccan chart the page used to write the chart four
 * times as dropdowns (872 options each) and once more as 210 tick boxes: 468 KB of HTML, three save buttons, and the
 * chart's own action under an "Advanced" fold. This file pins what replaced it, on the REAL chart
 * (docs/cgnc/plan-normal.tsv, the list migration 0190 loads):
 *   - the chart is written ONCE on the page, as the list the four search fields complete from;
 *   - only the accounts that hold money are listed (those counted by their name, fixed; the owner's own, with Remove);
 *   - ONE Save; the chart's action is in sight; the page is a small fraction of what it was;
 *   - what the route is sent is read back to the account: its number and name (the search field), or its id (an older
 *     form): both are accepted, and words that match no account are refused under their field with what was typed kept.
 */
const ROOT = join(__dirname, '..', '..');
const tsv = readFileSync(join(ROOT, 'docs/cgnc/plan-normal.tsv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const chart = tsv.map(([code, parent, kind, , title], n) => ({ id: id(n + 1), code: code!, name: title!, kind: kind!, parent: parent! }));
const parents = new Set(chart.map((a) => a.parent));
/** As `moneyAccountChoices` reads them: active asset accounts with none under them; the rule's own are `byRule`. */
const money: MoneyChoice[] = chart.filter((a) => a.kind === 'asset' && !parents.has(a.code))
  .map((a) => ({ id: a.id, code: a.code, name: a.name, marked: false, byRule: holdsMoney(a.code, a.name) }));
const journals = ['AC', 'BQ', 'CA', 'OD', 'VE', 'AN'].map((code, n) => ({ id: id(9000 + n), code, name: code }));
const byCode = (code: string) => chart.find((a) => a.code === code)!;
const chosen = { salesJournalId: journals[4]!.id, receivableAccountId: byCode('3421').id, salesAccountId: byCode('7111').id,
  fxLossAccountId: byCode('6331').id, fxGainAccountId: byCode('7331').id };
const page = (o: Partial<Parameters<typeof renderBooksAccountsPage>[1]> = {}) => renderBooksAccountsPage('en', { accounts: chart, journals, chosen, money, cgnc: true, ...o });
const count = (html: string, part: string): number => html.split(part).length - 1;

describe('Accounts, on the Moroccan chart', () => {
  const html = page();
  it('the chart is on the page ONCE: one list, four search fields that complete from it, no dropdown of accounts', () => {
    expect(chart).toHaveLength(871);
    expect(count(html, '<datalist id="chart-accounts">')).toBe(1);
    const list = html.slice(html.indexOf('<datalist id="chart-accounts">'), html.indexOf('</datalist>'));
    expect(count(list, '<option ')).toBe(871);
    // An account's words are written once, in the chart's list. (Once more only where the account IS a choice: the
    // value of the field that holds it, a row of the money list, or the list of accounts that can be added.)
    for (const a of [byCode('6111'), byCode('1111'), byCode('4411')]) expect(count(html, attr(`${a.code} · ${a.name}`)), a.code).toBe(1);
    expect(count(html, ' list="chart-accounts"')).toBe(4);
    // the one dropdown left is the sales journal: a short list
    expect(count(html, '<select ')).toBe(1);
    expect(count(html.slice(html.indexOf('<select '), html.indexOf('</select>')), '<option ')).toBe(journals.length + 1);
  });

  it('each search field shows the account it holds, by number and name', () => {
    for (const [name, code] of [['receivable', '3421'], ['sales', '7111'], ['fxLoss', '6331'], ['fxGain', '7331']] as const) {
      expect(html, name).toContain(`name="${name}" list="chart-accounts" value="${attr(`${code} · ${byCode(code).name}`)}"`);
    }
  });

  it('no tick boxes: only the accounts that hold money are listed, the ones counted by their name fixed', () => {
    expect(html).not.toContain('type="checkbox"');
    const held = html.slice(html.indexOf('<ul class="rows bk-held">'), html.indexOf('</ul>', html.indexOf('<ul class="rows bk-held">')));
    const byRule = money.filter((a) => a.byRule);
    expect(byRule.length).toBeGreaterThan(0);
    expect(count(held, '<li class="row"')).toBe(byRule.length);
    expect(count(held, t('en', 'setBooks.acc.byName'))).toBe(byRule.length);
    expect(held).not.toContain('/app/books/accounts/money/remove');
    // an account the owner added is listed too, with its Remove, which asks first
    const mine = page({ money: money.map((a) => a.code === '51111' ? { ...a, marked: true } : a) });
    expect(count(mine, 'action="/app/books/accounts/money/remove"')).toBe(1);
    expect(mine).toMatch(/action="\/app\/books\/accounts\/money\/remove" class="set-act"><input type="hidden" name="account" value="[0-9a-f-]{36}" \/><button class="btn" type="submit"[^>]* data-confirm="/);
    // the accounts that can be added are a second, shorter list: those that can hold money and do not yet
    expect(count(html.slice(html.indexOf('<datalist id="money-accounts">'), html.indexOf('</datalist>', html.indexOf('<datalist id="money-accounts">'))), '<option ')).toBe(moneyCandidates(money).length);
    expect(html).toContain(t('en', 'setBooks.acc.addMoneyHelp', { n: String(moneyCandidates(money).length) }));
  });

  it('ONE Save, for the posting accounts; the chart\'s action in sight, with no fold', () => {
    expect(count(html, '>Save</button>')).toBe(1);
    expect(html).not.toContain('<details');
    expect(html).toContain('action="/app/books/chart/cgnc" class="set-act"');
    expect(html).toContain('href="/app/settings/books/accounts/chart"');
    expect(html).toContain('href="/app/books/orders"');
    expect(page({ cgnc: false })).not.toContain('/app/books/chart/cgnc');
  });

  it('the Save ends the page: the chart and the money list (rows that act at once) come first, the posting form last', () => {
    const at = (part: string) => html.indexOf(part);
    const save = at('<form method="post" action="/app/books/settings/accounts" class="set-form" data-save id="accounts">');
    expect(save).toBeGreaterThan(-1);
    expect(at('<section class="set-sec" id="chart">')).toBeLessThan(at('<section class="set-sec" id="money">'));
    expect(at('<section class="set-sec" id="money">')).toBeLessThan(save);
    // after the posting form, nothing: its Save and Cancel are the page's last controls
    expect(html.slice(html.indexOf('</form>', html.indexOf('<div class="set-save">')) + '</form>'.length).trim()).toBe('');
  });

  it('"Counted by its name" is always a line of its own under the account\'s name', () => {
    const held = html.slice(html.indexOf('<ul class="rows bk-held">'), html.indexOf('</ul>', html.indexOf('<ul class="rows bk-held">')));
    const rows = held.split('<li class="row"').slice(1);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toMatch(new RegExp(`^[^>]*><span class="bk-acc"><span><bdi dir="ltr">[^<]*</bdi> · <bdi>[^<]*</bdi></span><span class="caption muted">${t('en', 'setBooks.acc.byName')}</span></span></li>`));
    expect(BOOKS_AREA_CSS).toContain('.bk-acc{display:flex;flex-direction:column;');
  });

  it('the page is a small fraction of what it was (468 KB with this chart)', () => {
    expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(100_000);
  });

  it('the chart has its own page: every account once, in a list with search, 50 at a time', () => {
    const list = renderBooksChartPage('en', chart);
    expect(list).toContain('data-list="50"');
    expect(count(list, '<tr data-row=')).toBe(871);
    expect(list).toContain('href="/app/settings/books/accounts#chart"');
  });
});

describe('what the Accounts form sends is read back to the account', () => {
  const options = chart.map(accountOption);
  it('the number and name the person chose, or the id an older form sent; nothing for an empty field; no account for other words', () => {
    const a = byCode('3421');
    expect(picked(options, `${a.code} · ${a.name}`)?.value).toBe(a.id);
    expect(picked(options, a.id)?.value).toBe(a.id);
    expect(picked(options, '  ')).toBeNull();
    expect(picked(options, '3421')).toBeUndefined();
    expect(picked(options, 'no such account')).toBeUndefined();
  });

  const accounts: readonly (readonly [RegExp, readonly unknown[]])[] = [
    [/select id::text as id, code, name from accounts where/, chart.map((a) => ({ id: a.id, code: a.code, name: a.name }))],
    [/select id::text as id, code, name from journals where/, journals],
    [/a\.holds_money from accounts a/, money.map((a) => ({ id: a.id, code: a.code, name: a.name, holds_money: false }))],
  ];
  it('the route: words that match no account are refused under their field, with everything typed kept, in every language', async () => {
    const app = settingsApp({ answers: accounts });
    for (const l of LOCALES) {
      const r = await postSettingsForm(app, '/app/books/settings/accounts', l, { salesJournal: journals[4]!.id, receivable: '3421 · Clients', sales: 'ventes quelque chose', fxLoss: '', fxGain: byCode('7331').id });
      expect(r.status, l).toBe(422);
      const main = mainOf(r.html);
      expect(main, l).toContain('name="sales" list="chart-accounts" value="ventes quelque chose"');
      expect(main, l).toContain('aria-invalid="true" aria-describedby="acc-sales-err"');
      expect(main, l).toMatch(/<span class="fielderr" role="alert" id="acc-sales-err">[^<]+<\/span>/);
      // what was right is kept as it was typed, and has no error
      expect(main, l).toContain('name="receivable" list="chart-accounts" value="3421 · Clients"');
      expect(count(main, 'class="fielderr"'), l).toBe(1);
    }
  });
  it('the route: the search field\'s words and an older form\'s ids are both saved', async () => {
    const app = settingsApp({ answers: accounts });
    const words = await postSettingsForm(app, '/app/books/settings/accounts', 'en', { salesJournal: journals[4]!.id, receivable: '3421 · Clients', sales: `7111 · ${byCode('7111').name}`, fxLoss: '', fxGain: '' });
    expect([words.status, words.location]).toEqual([302, '/app/settings/books/accounts']);
    const ids = await postSettingsForm(app, '/app/books/settings/accounts', 'en', { salesJournal: journals[4]!.id, receivable: byCode('3421').id, sales: byCode('7111').id, fxLoss: byCode('6331').id, fxGain: byCode('7331').id });
    expect([ids.status, ids.location]).toEqual([302, '/app/settings/books/accounts']);
  });
  it('the route: "Add a bank or till" takes only an account that can hold money, and says so under the field otherwise', async () => {
    const app = settingsApp({ answers: accounts });
    const r = await postSettingsForm(app, '/app/books/accounts/money/add', 'en', { account: '6111 · not a bank' });
    expect(r.status).toBe(422);
    expect(mainOf(r.html)).toContain(`<span class="fielderr" role="alert" id="acc-money-err">${t('en', 'setBooks.acc.moneyUnknown')}</span>`);
  });

  it('the page the real app draws follows the template: one line under the title, the rule on the page, the chart once', async () => {
    const r = await drawSettingsPage(settingsApp({ answers: accounts }), '/app/settings/books/accounts', 'en');
    const main = mainOf(r.html);
    expect(main).toContain(`<p class="lede set-lede">${t('en', 'setBooks.acc.lede')}</p>`);
    expect(main).toContain(t('en', 'setBooks.acc.moneyRule'));
    expect(count(main, '<datalist id="chart-accounts">')).toBe(1);
  });
});
