/**
 * THE SETTINGS OVERHAUL (the owner's decision 2026-11-27; rule 104) — "Keep every setting, safety rule and honesty
 * message. Nothing gets lost, only reorganized and shortened."
 *
 * This file is how that is held, page by page, on the pages as the REAL app draws them (settings-harness.ts):
 *
 *   1. SAFETY_LINES — page → the safety and honesty lines (by i18n key) that must be ON that page, in all five
 *      languages. A line is never moved only to help. Each builder ADDS their pages' lines here as they convert a
 *      page; a line that moves to another page moves in this table with it, and is never dropped.
 *   2. Every settings page's title is its menu label, word for word, in all five languages (so the chooser on a phone
 *      folds into the title: one heading, not two).
 *   3. CONVERTED — the pages that already follow the one template: ONE Save (and its Cancel) outside row forms.
 *      A builder adds a page's address here when it is converted; the check then holds it.
 */
import { describe, expect, it } from 'vitest';
import { SETTINGS_MENU_PAGES, settingsApp, drawSettingsPage, mainOf, h1Of, type Answers } from './settings-harness.js';
import { AREAS } from '../../src/api/web/sections.js';
import { SAVE_KEY, saveForm, saveActs, rowAction, rowSwitch } from '../../src/api/web/settingsPage.js';
import { LIVE_SCRIPT } from '../../src/api/web/liveScript.js';
import { esc } from '../../src/api/web/layout.js';
import { t } from '../../src/api/web/say.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { messages, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * Page → the lines that must be on it. `answers` gives the quiet database rows of its own where a line is drawn only
 * when something is there. A key whose words carry a value ({name}, {from}) is matched around the value.
 */
type Guarded = { readonly lines: readonly MessageKey[]; readonly answers?: Answers };
export const SAFETY_LINES: Readonly<Record<string, Guarded>> = {
  // Billing is not open: the page says so, and that nothing is charged.
  '/app/settings/billing': { lines: ['billing.notConfigured', 'state.billing.h'] },
  // A new person's code is shown once, and nothing here sends it to anyone.
  '/app/settings/team': { lines: ['people.add.hint'] },
  // ── Settings › Connections and Settings › You ──────────────────────────────────────────────────────────────────
  // A channel this installation cannot connect says so (the owner's condition 3) as a ROW on Channels, which opens
  // nothing; what is not available yet, and what connecting never does, stay under the table.
  '/app/settings/channels': { lines: ['connect.state.notHere', 'channel.soon.note', 'channel.footer'] },
  // What the place allows: where you cannot write first that is its own rule; the 24 hours to answer freely.
  '/app/settings/channels/whatsapp': { lines: ['reach.intro', 'reach.cold.conditional', 'reach.window'] },
  // Replies for 24 hours then in the app; nobody writes first there; written messages only.
  '/app/settings/channels/meta': { lines: ['meta.rules.window', 'meta.rules.first', 'meta.rules.media'] },
  // Going around a place's rule gets accounts closed; no address of yours sends yet.
  '/app/settings/channels/email': { lines: ['reach.intro', 'domain.none'] },
  // Nomi only reads an order; what a customer is told and when; every such reply waits; the access is kept locked.
  '/app/settings/business/shopify': { lines: ['shopifyOrders.lede', 'shopifyOrders.rule', 'shopifyOrders.drafts', 'shopifyOrders.connect.kept'] },
  // No password to change with an access code, and who can give a new code.
  '/app/settings/personal/account': { lines: ['account.codeOnly', 'account.lost.code'] },
  // The two things that reach you; everything else waits in Nomi; what the number is for and when WhatsApp is used.
  '/app/settings/personal/notifications': { lines: ['alerts.two.order', 'alerts.two.handover', 'alerts.rest', 'settings.alerts.desc'] },
};

/** The pages that already follow the one template (rule 104). Add a page's address when it is converted. */
export const CONVERTED: readonly string[] = [
  // Settings › Connections and Settings › You
  '/app/settings/channels', '/app/settings/channels/whatsapp', '/app/settings/channels/meta', '/app/settings/channels/email',
  '/app/settings/business/shopify', '/app/settings/personal/account', '/app/settings/personal/notifications',
];

/** Is the line on the page? Its words, escaped as a page writes them, in order around any value they carry. */
const hasLine = (main: string, locale: Locale, key: MessageKey): boolean => {
  const pieces = messages[locale][key].split(/\{\w+\}/).map((p) => esc(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter((p) => p.trim() !== '');
  // Right to left, a page isolates each figure of a sentence ("24", "#1001"): the marks are not words.
  return new RegExp(pieces.join('[\\s\\S]{0,240}?')).test(main.replace(/[\u2066-\u2069\u200e\u200f]/g, ''));
};

/**
 * The one-Save rule, as a check a page either passes or fails: outside row forms (`set-act`), a page has at most ONE
 * submit button labelled Save, it is inside the form the script watches (`data-save`), and its Cancel is beside it.
 * Returns what is wrong, or [] when the page follows the rule.
 */
export const oneSaveProblems = (main: string, locale: Locale): string[] => {
  const outsideRows = main.replace(/<form\b[^>]*class="set-act"[\s\S]*?<\/form>/g, '');
  const save = esc(t(locale, SAVE_KEY));
  const saves = [...outsideRows.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter((m) => !/type="(?:button|reset)"/.test(m[1]!) && m[2]!.replace(/<[^>]+>/g, '').trim() === save);
  const problems: string[] = [];
  if (saves.length > 1) problems.push(`${saves.length} Save buttons outside row forms`);
  const watched = [...outsideRows.matchAll(/<form\b[^>]*\bdata-save\b[\s\S]*?<\/form>/g)].map((m) => m[0]);
  if (saves.length === 1 && !watched.some((f) => f.includes(saves[0]![0]))) problems.push('the Save is not inside the data-save form');
  if (watched.length > 1) problems.push(`${watched.length} data-save forms`);
  for (const f of watched) if (!/<button\b[^>]*type="reset"/.test(f)) problems.push('a data-save form with no Cancel');
  if (/class="savebar"/.test(main)) problems.push('the older save bar is still drawn');
  return problems;
};

describe('the harness draws every page of the Settings menu', () => {
  it('each of the menu\'s pages answers 200 for the owner, with one h1', async () => {
    const app = settingsApp();
    for (const p of SETTINGS_MENU_PAGES) {
      const r = await drawSettingsPage(app, p.href, 'en');
      expect(r.status, p.href).toBe(200);
      expect(mainOf(r.html).match(/<h1\b/g), p.href).toHaveLength(1);
    }
  });

  it('the menu is the 23 pages of rule 104, and the three channels that are listed only where they can be connected', () => {
    const comesAndGoes = ['/app/settings/channels/chat', '/app/settings/channels/telegram', '/app/settings/channels/tiktok'];
    expect(SETTINGS_MENU_PAGES.map((p) => p.href).filter((h) => !comesAndGoes.includes(h))).toHaveLength(23);
    expect(AREAS.settings.map((g) => g.id)).toEqual(['workspace', 'connections', 'assistant', 'books', 'you']);
  });
});

describe('safety and honesty lines stay on their page, in every language', () => {
  for (const [path, guarded] of Object.entries(SAFETY_LINES)) {
    it(`${path}: ${guarded.lines.join(', ')}`, async () => {
      const app = settingsApp(guarded.answers ? { answers: guarded.answers } : {});
      for (const l of LOCALES) {
        const r = await drawSettingsPage(app, path, l);
        expect(r.status, `${l} ${path}`).toBe(200);
        const main = mainOf(r.html);
        for (const key of guarded.lines) expect(hasLine(main, l, key), `${l} ${path}: "${messages[l][key]}" (${key}) must be on the page`).toBe(true);
      }
    });
  }

  it('every guarded page is a page of the Settings menu', () => {
    const menu = SETTINGS_MENU_PAGES.map((p) => p.href);
    for (const path of [...Object.keys(SAFETY_LINES), ...CONVERTED]) expect(menu, path).toContain(path);
  });
});

describe('a settings page\'s title is its menu label, word for word', () => {
  it('in all five languages, so the phone\'s chooser folds into the title', async () => {
    const app = settingsApp();
    const comesAndGoes = ['/app/settings/channels/chat', '/app/settings/channels/telegram', '/app/settings/channels/tiktok'];
    for (const l of LOCALES) for (const p of SETTINGS_MENU_PAGES) {
      const r = await drawSettingsPage(app, p.href, l);
      expect(h1Of(r.html), `${l} ${p.href}`).toBe(esc(t(l, p.label)));
      // The chooser IS the title where they say the same (a channel that cannot be connected here is not listed).
      if (!comesAndGoes.includes(p.href)) expect(r.html, `${l} ${p.href}`).toContain('<details class="area-chooser" data-titled>');
    }
  });
});

describe('the one saving rule', () => {
  it('the check itself: one Save in the watched form passes; a second Save, a Save outside it, or no Cancel fails; row forms never count', () => {
    const good = saveForm('/x', '<input name="a" />' + saveActs('en')) + rowAction({ action: '/y', label: t('en', SAVE_KEY) }) + rowSwitch('en', { action: '/z', on: true, label: 'A' });
    expect(oneSaveProblems(good, 'en')).toEqual([]);
    expect(oneSaveProblems(good + `<form method="post" action="/w"><button class="btn send" type="submit">${t('en', SAVE_KEY)}</button></form>`, 'en'))
      .toEqual(['2 Save buttons outside row forms']);
    expect(oneSaveProblems(`<form method="post" action="/w"><button class="btn send" type="submit">${t('en', SAVE_KEY)}</button></form>`, 'en'))
      .toEqual(['the Save is not inside the data-save form']);
    expect(oneSaveProblems(`<form method="post" action="/w" data-save><button class="btn send" type="submit">${t('en', SAVE_KEY)}</button></form>`, 'en'))
      .toEqual(['a data-save form with no Cancel']);
    expect(oneSaveProblems(good + '<div class="savebar"></div>', 'en')).toEqual(['the older save bar is still drawn']);
  });

  it('every converted page has ONE Save, in every language', async () => {
    const app = settingsApp();
    for (const path of CONVERTED) for (const l of LOCALES) {
      const r = await drawSettingsPage(app, path, l);
      expect(oneSaveProblems(mainOf(r.html), l), `${l} ${path}`).toEqual([]);
    }
  });

  it('Save is one word, the same key on every page, written in all five languages', () => {
    for (const l of LOCALES) expect(messages[l][SAVE_KEY], l).toBeTruthy();
    expect(saveActs('en')).toBe('<div class="set-save"><button class="btn send" type="submit">Save</button><button class="btn" type="reset">Cancel</button></div>');
  });

  it('unsaved changes: the page\'s script marks a changed data-save form and asks, in the browser\'s own words, before the page is left', () => {
    const at = LIVE_SCRIPT.indexOf('function unsaved()');
    const fn = LIVE_SCRIPT.slice(at, LIVE_SCRIPT.indexOf('function lists()', at));
    expect(at).toBeGreaterThan(0);
    expect(LIVE_SCRIPT).toMatch(/\n {2}unsaved\(\);\n/);
    for (const part of ["doc.addEventListener('input', changed)", "doc.addEventListener('change', changed)", "doc.addEventListener('submit', clean)",
      "doc.addEventListener('reset', clean)", "window.addEventListener('beforeunload'", "form[data-save][data-dirty]", 'e.preventDefault();', "e.returnValue = '';"])
      expect(fn, part).toContain(part);
    // The browser's own prompt only: no dialog of the product's, and no alert.
    expect(fn).not.toMatch(/\balert\(|\bconfirm\(|showModal/);
    // A list's search box is not a field.
    expect(fn).toContain("data-list-q");
  });
});
