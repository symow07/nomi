import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerWebApp } from '../../src/api/web/app.js';
import { renderPrivacy, renderCookies, type LegalFacts } from '../../src/api/web/legal.js';
import { DEFAULT_PROCESSOR, HOSTING } from '../../src/core/legal/processors.js';
import { PUBLIC_ROUTES } from '../../src/api/web/app.js';
import { renderSite } from '../../src/api/web/site.js';
import { COOKIES } from '../../src/api/web/thirdParty.js';
import { LOCALES, dirOf } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import { withoutIsolates } from './isolates.js';

/**
 * PRE-LAUNCH item 5 — the cookie policy as a page of its own: the privacy page's cookie section at /cookies, the
 * same table from the same registry, in all five languages, public, and linked from the site's foot.
 */

const FACTS: LegalFacts = { processor: DEFAULT_PROCESSOR, hosting: HOSTING };
const table = (html: string) => /<table class="cookies">[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';

describe('PRE-LAUNCH 5 · the cookie policy has a page of its own', () => {
  for (const l of LOCALES) {
    it(`${l} · /cookies is the privacy page's own cookie section: the same table, the same words, that page's date`, () => {
      const page = renderCookies(l, null, FACTS);
      const read = withoutIsolates(page);
      expect(page).toContain(`dir="${dirOf(l)}"`);
      expect(read).toContain(`<h1>${esc(t(l, 'legal.privacy.cookies.title'))}</h1>`);
      expect(read).toContain(esc(t(l, 'legal.privacy.cookies.body')));
      expect(table(page)).not.toBe('');
      expect(table(page)).toBe(table(renderPrivacy(l, null, FACTS)));
      for (const c of COOKIES) expect(page, c.name).toContain(`<code dir="ltr">${c.name}</code>`);
      expect(read).toContain(esc(t(l, 'legal.updated.privacy')));
      expect(page).toContain('href="/privacy"');
      expect(page).toContain('href="/terms"');
    });

    it(`${l} · the site's foot links it, beside the privacy page and the terms`, () => {
      const site = renderSite({ locale: l, path: '/', contact: null, signIn: '/login', noindex: false });
      const foot = /<nav class="site-links"[\s\S]*?<\/nav>/.exec(site)?.[0] ?? '';
      expect(foot).toContain(`<a href="/cookies">${esc(t(l, 'legal.privacy.cookies.title'))}</a>`);
      expect(foot.indexOf('/terms')).toBeLessThan(foot.indexOf('/cookies'));
    });
  }

  it('it is public, like the other legal pages: no sign-in, and it names no workspace', async () => {
    expect(PUBLIC_ROUTES.some((r) => r.method === 'GET' && r.url === '/cookies')).toBe(true);
    // served, signed out, from no database at all
    const app = Fastify({ logger: false });
    registerWebApp(app, {
      db: {} as never, sessionSecret: 'x'.repeat(64), accessCode: 'let-me-in', businessId: 'de300000-0000-4000-8000-0000000000b1',
      employeeName: 'Lily', avatar: '👩‍💼', provider: 'disabled', secureCookie: true,
      kickOutbound: async () => {}, resolveDns: async () => ({ spf: [], dkim: [], dmarc: [] }),
    } as unknown as Parameters<typeof registerWebApp>[1]);
    const res = await app.inject({ method: 'GET', url: '/cookies', headers: { cookie: 'yf_locale=fr' } });
    expect(res.statusCode).toBe(200);
    expect(table(res.body)).toBe(table(renderCookies('fr', null, FACTS)));
    await app.close();
  });
});
