import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { shell, assetAt } from '../../src/api/web/layout.js';
import { withWorkspace } from '../../src/api/web/say.js';
import { settingsArea } from '../../src/api/web/settingsArea.js';
import { pageHead, setRow, setSection, saveForm, saveActs, rowSwitch, rowAction, searchList, listRow, dangerZone, pickList, pickField } from '../../src/api/web/settingsPage.js';

/**
 * THE SETTINGS OVERHAUL (rule 104) — the template's parts in real Chromium, on a page the shell draws with its own
 * stylesheet and script (no database, no network: every request is answered here).
 *
 * The owner's condition 2: leaving a page with a changed, unsaved field asks first, in the browser's own words; Save
 * and Cancel clear it; a page nobody changed never asks. And the parts that need a browser to be believed: a list
 * over ten rows shows 25 at a time behind "Show more" and filters as its search box is typed in; a row switch is a
 * 44 px target on a phone; nothing widens the page at 390.
 */
const CHROMIUM = await import('playwright').then(({ chromium }) => existsSync(chromium.executablePath())).catch(() => false);

const rows = Array.from({ length: 30 }, (_, i) => ({ value: String(5100 + i), label: `${5100 + i} Account ${i + 1}` }));
const body = (): string => settingsArea(
  pageHead('Team', 'Who can sign in.')
  + saveForm('/saved', setSection({ title: 'Details', rows: [
    setRow('en', { label: 'Name', forId: 'f-name', needed: true, control: '<input id="f-name" name="name" value="Before" />' }),
    setRow('en', { label: 'Account', forId: 'f-acc', control: pickField('en', { id: 'f-acc', name: 'account', list: 'accs', current: rows[0]! }) }),
  ] }) + pickList('accs', rows) + saveActs('en'))
  + setSection({ title: 'Accounts', rows: searchList('en', `<table class="team-table"><tbody>${rows.map((r, i) =>
    `<tr${listRow()}><th scope="row">${r.label}</th><td>${rowSwitch('en', { action: '/switched', on: i % 2 === 0, label: r.label })}</td><td>${rowAction({ action: '/removed', label: 'Remove', confirm: 'Remove it?', danger: true })}</td></tr>`).join('')}</tbody></table>`) })
  + dangerZone('en', [{ title: 'Close this workspace', what: 'Everything is deleted at once and for good.', action: '/closed', verb: 'Close', confirm: 'Close it?' }])
  + '<p><a id="away" href="/elsewhere">Elsewhere</a></p>', 'en', '/app/settings/team', { isOwner: true } as never);

describe('rule 104: the settings page template in a real browser', () => {
  const app = Fastify({ logger: false });
  let base = '';
  const posted: string[] = [];
  beforeAll(async () => {
    app.get('/assets/:file', (req, reply) => {
      const found = assetAt((req.params as { file: string }).file);
      return found ? reply.type(found.type).send(found.body) : reply.code(404).send();
    });
    app.get('/app/settings/team', (_req, reply) => reply.type('text/html; charset=utf-8').send(
      withWorkspace({ name: 'Lily', several: false, outreach: false, setup: null, viewerRole: 'owner', business: 'Atlas Studio' },
        () => shell({ title: 'Team', active: 'settings', locale: 'en', path: '/app/settings/team', bodyHtml: body() }))));
    app.get('/elsewhere', (_req, reply) => reply.type('text/html').send('<!doctype html><title>Elsewhere</title><p id="there">there</p>'));
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, text, done) => done(null, text));
    for (const path of ['/saved', '/switched', '/removed', '/closed'])
      app.post(path, (req, reply) => { posted.push(`${path} ${String(req.body)}`); return reply.type('text/html').send('<!doctype html><title>Posted</title><p id="there">posted</p>'); });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
  });
  afterAll(async () => { await app.close(); });

  it.skipIf(!CHROMIUM)('unsaved changes ask before the page is left; Save and Cancel clear them; the list searches and shows 25 at a time; 44 px on a phone', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const open = async (width: number) => {
        // Reduced motion: the pages' cross-page transition is off, so a navigation the person declines leaves no
        // "transition was aborted" message of the browser's own among the page's errors (it came and went by timing).
        const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        await context.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const asked: string[] = [];
        let stay = true;
        page.on('dialog', (d) => { asked.push(d.type()); void (stay ? d.dismiss() : d.accept()); });
        await page.goto(`${base}/app/settings/team`, { waitUntil: 'networkidle' });
        return { context, page, errors, asked, leave: (go: boolean) => { stay = !go; } };
      };

      // 1 · Nothing changed: leaving asks nothing.
      let w = await open(1440);
      await w.page.click('#away');
      await w.page.waitForSelector('#there');
      expect(w.asked).toEqual([]);
      await w.context.close();

      // 2 · A field typed in: leaving asks (the browser's own prompt); staying keeps the page and what was typed.
      w = await open(1440);
      await w.page.fill('#f-name', 'After');
      expect(await w.page.getAttribute('form[data-save]', 'data-dirty')).toBe('');
      await w.page.click('#away');
      await w.page.waitForTimeout(300);
      expect(w.asked).toEqual(['beforeunload']);
      expect(new URL(w.page.url()).pathname).toBe('/app/settings/team');
      expect(await w.page.inputValue('#f-name')).toBe('After');
      // 3 · Cancel puts the form back and clears the mark: leaving asks nothing more.
      await w.page.click('form[data-save] button[type="reset"]');
      expect(await w.page.inputValue('#f-name')).toBe('Before');
      expect(await w.page.getAttribute('form[data-save]', 'data-dirty')).toBeNull();
      await w.page.click('#away');
      await w.page.waitForSelector('#there');
      expect(w.asked).toEqual(['beforeunload']);
      expect(w.errors).toEqual([]);
      await w.context.close();

      // 4 · Save sends the form without asking; a row's act on a changed page does ask (the fields would be lost).
      w = await open(1440);
      await w.page.fill('#f-name', 'Saved name');
      await w.page.click('form[data-save] button[type="submit"]');
      await w.page.waitForSelector('#there');
      expect(w.asked).toEqual([]);
      expect(posted.at(-1)).toMatch(/^\/saved name=Saved\+name&account=5100\+Account\+1$/);
      await w.context.close();
      w = await open(1440);
      await w.page.fill('#f-name', 'Half done');
      await w.page.click('.set-list tr:first-child .set-switch');
      await w.page.waitForTimeout(300);
      expect(w.asked).toEqual(['beforeunload']);
      expect(new URL(w.page.url()).pathname).toBe('/app/settings/team');
      w.leave(true);
      await w.page.click('form[data-save] button[type="reset"]');
      // The switch sends the state to switch TO, at once, in its own form.
      await w.page.click('.set-list tr:first-child .set-switch');
      await w.page.waitForSelector('#there');
      expect(posted.at(-1)).toBe('/switched on=0');
      await w.context.close();

      // 5 · The list: 30 rows, 25 shown, "Show more" shows the rest; the search box filters and never marks the form.
      w = await open(1440);
      const shown = () => w.page.locator('.set-list [data-row]:visible').count();
      expect(await w.page.isVisible('.set-find')).toBe(true);
      expect(await shown()).toBe(25);
      await w.page.click('[data-list-more]');
      expect(await shown()).toBe(30);
      expect(await w.page.isVisible('[data-list-more]')).toBe(false);
      await w.page.fill('[data-list-q]', 'account 17');
      expect(await shown()).toBe(1);
      await w.page.fill('[data-list-q]', 'no such row');
      expect(await shown()).toBe(0);
      expect(await w.page.isVisible('[data-list-none]')).toBe(true);
      expect(await w.page.getAttribute('form[data-save]', 'data-dirty')).toBeNull();
      // Save is not sticky: it sits in the flow at the end of its form.
      expect(await w.page.evaluate(`getComputedStyle(document.querySelector('.set-save')).position`)).toBe('static');
      await w.context.close();

      // 6 · On a phone: the row stacks, the switch is a 44 px target, and nothing widens the page.
      w = await open(390);
      const box = await w.page.locator('.set-switch').first().boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      const row = await w.page.evaluate(`(() => {
        const r = document.querySelector('.set-rows .setrow');
        const [l, c] = [r.querySelector('.fr-l').getBoundingClientRect(), r.querySelector('.fr-c').getBoundingClientRect()];
        return { stacked: c.top >= l.bottom - 1, wide: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      })()`);
      expect(row).toEqual({ stacked: true, wide: 0 });
      expect(w.errors).toEqual([]);
      await w.context.close();
    } finally { await browser.close(); }
  }, 120_000);

  it.skipIf(!CHROMIUM)('with no script every row is on the page, the search box stays away, and Cancel still resets the form', async () => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(`${base}/app/settings/team`);
      expect(await page.locator('.set-list [data-row]:visible').count()).toBe(30);
      expect(await page.isVisible('.set-find')).toBe(false);
      expect(await page.isVisible('[data-list-more]')).toBe(false);
      await page.fill('#f-name', 'After');
      await page.click('form[data-save] button[type="reset"]');
      expect(await page.inputValue('#f-name')).toBe('Before');
    } finally { await browser.close(); }
  }, 60_000);
});
