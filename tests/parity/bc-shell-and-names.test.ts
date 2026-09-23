import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { messages, t as plainT } from '../../src/core/owner/i18n/messages.js';
import { shell, hubFor, NAV, CONTEXTUAL_ROUTES_BY_HUB } from '../../src/api/web/layout.js';
import { withAssistantName } from '../../src/api/web/say.js';
import { defaultAssistantName, DEFAULT_ASSISTANT_NAME } from '../../src/core/owner/assistants.js';

/**
 * B · the shell reads the hub map it already had (audit A7)
 * C · Results gets a door (CC-05), and a name comes from the table (CC-16)
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const page = (path: string, active = 'home') =>
  shell({ title: 'x', active, locale: 'en', path, avatar: '·', bodyHtml: '' });

describe('B · every page knows which hub it belongs to', () => {
  it('the four hubs light themselves', () => {
    for (const n of NAV) expect(hubFor(n.href, 'nonsense'), n.href).toBe(n.id);
  });

  it('EVERY contextual route lights something — this is the bug', () => {
    // Before this change the shell compared `active` to the four nav ids, and
    // pages pass eleven different values. Seven matched nothing.
    const ids = new Set(NAV.map((n) => n.id));
    for (const group of CONTEXTUAL_ROUTES_BY_HUB) {
      for (const route of group.routes) {
        const lit = hubFor(route, 'nonsense');
        expect(ids.has(lit), `${route} lit "${lit}", which is not a nav entry`).toBe(true);
      }
    }
  });

  it('the map CHAINS, and the chain is followed to a nav entry', () => {
    // /app/sequences is reached from /app/contacts, which is reached from
    // /app/conversations, which is reached from /app. Only the last is in the
    // nav, so stopping at the first hop would light nothing three times over.
    expect(hubFor('/app/sequences', 'nonsense')).toBe('home');
    expect(hubFor('/app/contacts', 'nonsense')).toBe('home');
    expect(hubFor('/app/conversations', 'nonsense')).toBe('home');
    expect(hubFor('/app/prospects', 'nonsense')).toBe('home');
  });

  it('a page BELOW a contextual route belongs to the same hub', () => {
    // D — /app/settings is Setup's own entry now; its sub-pages light Setup
    // unless the map sends them elsewhere (terms, samples… → My business).
    expect(hubFor('/app/settings/data', 'nonsense')).toBe('settings');
    expect(hubFor('/app/settings/terms', 'nonsense')).toBe('factory');
    expect(hubFor('/app/products/abc-123', 'nonsense')).toBe('factory');
    expect(hubFor('/app/sequences/abc-123', 'nonsense')).toBe('home');
    expect(hubFor('/app/inbox/abc-123', 'nonsense')).toBe('inbox');
  });

  it('longest match wins — /app is a prefix of everything', () => {
    // A plain startsWith would light Today on every page in the product.
    expect(hubFor('/app/knowledge', 'nonsense')).toBe('employee');   // D — what it knows sits under the assistant
    expect(hubFor('/app/analytics', 'nonsense')).toBe('home');
  });

  it('a query string and a trailing slash change nothing', () => {
    expect(hubFor('/app/products?flash=1', 'nonsense')).toBe('factory');
    expect(hubFor('/app/products/', 'nonsense')).toBe('factory');
    expect(hubFor('/app/', 'nonsense')).toBe('home');
  });

  it('a route nobody mapped falls back to what the page said, not to nothing', () => {
    expect(hubFor('/app/something-new', 'employee')).toBe('employee');
  });

  it('the page tells a screen reader where it is, exactly once', () => {
    const html = page('/app/settings/data');
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    // …and it is on Setup, the entry Your data sits under (D).
    const setup = NAV.find((n) => n.href === '/app/settings')!;
    expect(html).toMatch(new RegExp(`href="${setup.href}"[^>]*aria-current="page"`));
    // a page that MOVED lights its new entry: the payment terms are My business
    const terms = page('/app/settings/terms');
    expect(terms).toMatch(/href="\/app\/factory"[^>]*aria-current="page"/);
  });
});

describe('C · Results has a door', () => {
  it('the link is OUTSIDE the quiet branch', () => {
    const src = read('src/api/web/operations.ts');
    // The quiet branch stays — three zeros are not worth a section.
    expect(src).toContain("const activity = didNothing ? ''");
    // The way in does not live inside it any more.
    const branch = /const activity = didNothing[\s\S]*?\n  const toResults/.exec(src)?.[0] ?? '';
    expect(branch, 'the only door to Results is inside the branch that hides it')
      .not.toContain('/app/analytics');
    expect(src).toMatch(/const toResults = .*\/app\/analytics/);
    expect(src).toMatch(/\$\{toResults\}/);
  });
});

describe('C · the nav entry for the assistants', () => {
  it('is her NAME while there is one of her', () => {
    const html = withAssistantName('Sara', () => page('/app'), false);
    expect(html).toContain('>Sara</a>');
    expect(html).not.toContain('>Team</a>');
  });

  it('…and "Team" once there are several', () => {
    const html = withAssistantName('Sara', () => page('/app'), true);
    expect(html).toContain('>Team</a>');
    // Her name still appears in the header — that is the main assistant, and
    // the page is still hers. Only the MENU stops claiming to be one person.
    expect(html).toContain('Sara');
  });

  it('the word exists in all three languages and is not the name', () => {
    for (const locale of LOCALES) {
      expect(messages[locale]['nav.team'], `${locale} has no nav.team`).toBeTruthy();
      expect(plainT(locale, 'nav.team')).not.toContain('{name}');
    }
    expect(messages.zh['nav.team']).toBe('团队');
    expect(messages.ar['nav.team']).toBe('الفريق');
  });
});

describe('C · what she is called at the start comes from the signup language', () => {
  it('Chinese keeps 小雅; English and Arabic both take Lily', () => {
    expect(defaultAssistantName('zh')).toBe('小雅');
    expect(defaultAssistantName('en')).toBe('Lily');
    // Deliberate: a name is STORED once and then shown to everyone, whatever
    // language the page is in, so it is not a translation. CC-16.
    expect(defaultAssistantName('ar')).toBe('Lily');
    expect(defaultAssistantName('pt'), 'a locale this build does not know').toBe('Lily');
    expect(Object.keys(DEFAULT_ASSISTANT_NAME).sort()).toEqual(['ar', 'en', 'zh']);
  });

  it('it is NOT the catalogue constant — the two say different things for Arabic', () => {
    expect(defaultAssistantName('ar')).not.toBe(messages.ar['nav.employee']);
    // 2026-09-23 — the catalogue no longer holds a name at all. The row's name
    // at birth is `defaultAssistantName`; what `{name}` says before the owner
    // confirms one is a phrase, "your assistant". Different jobs, still.
    const cat = read('src/core/owner/i18n/messages.ts');
    expect(cat).not.toContain('EMPLOYEE_NAME');
    expect(cat).toContain("ar: 'مساعدك'");
  });

  it('the READER\'s page language no longer decides a stored name', () => {
    // Both write sites used to pass EMPLOYEE_NAME[locale] — the language of
    // whoever happened to open the team page first.
    const web = read('src/api/web/assistants.ts');
    // It may still be NAMED in a comment explaining why it went; what must be
    // gone is the import and the use.
    expect(web).not.toMatch(/import[^;]*EMPLOYEE_NAME[^;]*;/);
    expect(web).not.toMatch(/EMPLOYEE_NAME\s*\[/);
    expect(web).toMatch(/ensureDefaultAssistant\(tx, bid\.value\)/);
    expect(web).toMatch(/addAssistant\(tx, bid\.value, v\.value, actor\)/);
    // …and the business's own locale is what the db layer reads instead.
    const db = read('src/db/assistants.ts');
    expect(db).toContain('defaultAssistantName(parseLocale(b?.owner_locale');
    expect(db).not.toContain('EMPLOYEE_NAME');
  });
});
