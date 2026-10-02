import { describe, it, expect } from 'vitest';
import { checkMetaAccount } from '../../src/channels/meta/health.js';
import { META_LOGIN_SCOPES } from '../../src/channels/meta/connect.js';
import { renderYourAccounts, type YourAccounts } from '../../src/api/web/yourAccounts.js';
import { renderMetaHelp, META_HELP_STEPS } from '../../src/api/web/help.js';
import { isMark, liveNews } from '../../src/api/web/live.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { readFileSync } from 'node:fs';

/**
 * CH1 + CH2 — the parts no database is needed for: how Meta's answers are
 * read, how each step is drawn, and the help page's promises. Through the real
 * routes and rows: tests/integration/your-accounts.test.ts.
 */

const login = { appId: '4070500000000001', appSecret: 'secret', configId: '1234567890' };
type Answer = { status: number; body: unknown } | 'throw';
const fake = (debug: Answer, subscribed: Answer) => async (url: string) => {
  const a = url.includes('/debug_token') ? debug : subscribed;
  if (a === 'throw') throw new Error('network');
  return { status: a.status, text: async () => JSON.stringify(a.body) };
};
const check = (debug: Answer, subscribed: Answer) =>
  checkMetaAccount({ pageId: '103300000001', token: 'page-token', login, graphVersion: 'v23.0', fetchImpl: fake(debug, subscribed) });
const ours = { status: 200, body: { data: [{ id: login.appId, subscribed_fields: ['messages'] }] } };

describe('CH1 · Meta\'s answers, read', () => {
  it('all granted, subscribed, token good', async () => {
    expect(await check({ status: 200, body: { data: { is_valid: true, scopes: [...META_LOGIN_SCOPES] } } }, ours))
      .toEqual({ token: 'valid', missing: [], subscribed: true });
  });

  it('names what was not granted', async () => {
    const got = await check({ status: 200, body: { data: { is_valid: true, scopes: ['pages_show_list', 'pages_messaging'] } } }, ours);
    expect(got.missing).toEqual(META_LOGIN_SCOPES.filter((s) => s !== 'pages_show_list' && s !== 'pages_messaging'));
  });

  it('a token Meta refuses is invalid, and its scopes are not read', async () => {
    expect(await check({ status: 200, body: { data: { is_valid: false } } }, { status: 400, body: {} }))
      .toEqual({ token: 'invalid', missing: null, subscribed: null });
  });

  it('subscribed means THIS app, for messages', async () => {
    const valid = { status: 200, body: { data: { is_valid: true, scopes: [...META_LOGIN_SCOPES] } } };
    expect((await check(valid, { status: 200, body: { data: [{ id: '999', subscribed_fields: ['messages'] }] } })).subscribed).toBe(false);
    expect((await check(valid, { status: 200, body: { data: [{ id: login.appId, subscribed_fields: ['feed'] }] } })).subscribed).toBe(false);
    expect((await check(valid, { status: 200, body: { data: [] } })).subscribed).toBe(false);
  });

  it('Meta down, slow or strange is "unknown" — never a verdict', async () => {
    expect(await check('throw', 'throw')).toEqual({ token: 'unknown', missing: null, subscribed: null });
    expect(await check({ status: 500, body: {} }, { status: 500, body: {} })).toEqual({ token: 'unknown', missing: null, subscribed: null });
    expect((await check({ status: 200, body: { data: {} } }, ours)).token).toBe('unknown');
  });
});

const base: YourAccounts = {
  page: 'Yara Candles', instagram: '@yara.candles', needsAttention: false,
  check: { token: 'valid', missing: [], subscribed: true },
  firstMessage: { instagram: null, messenger: null },
};

describe('CH1 · each step drawn from what is there', () => {
  it('every step in every language, each with its help anchor, and the mark said for a screen reader', () => {
    for (const l of LOCALES) {
      const html = renderYourAccounts(base, l);
      for (const id of ['page', 'instagram', 'connect', 'permissions', 'subscription', 'test-message']) {
        expect(html, `${l} ${id}`).toContain(`href="/app/help/meta#${id}"`);
      }
      expect(html, l).toContain(`<span class="sr">${t(l, 'accounts.mark.done')}</span>`);
    }
  });

  it('a dead token turns the steps after it into "after connecting again"', () => {
    const html = renderYourAccounts({ ...base, needsAttention: true }, 'en');
    expect(html).toContain('<div class="pr bad">');
    expect(html.split(t('en', 'accounts.afterReconnect')).length - 1).toBe(2);
  });

  it('no Page yet: nothing claims to be done', () => {
    const html = renderYourAccounts({ page: null, instagram: null, needsAttention: false, check: null, firstMessage: { instagram: null, messenger: null } }, 'en');
    expect(html).not.toContain('<div class="pr done">');
    expect(html).not.toContain('<div class="pr bad">');
  });
});

describe('CH2 · the help page', () => {
  it('one section per step, in the panel\'s order, each saying what to check and why, in every language', () => {
    expect(META_HELP_STEPS.map((s) => s.id)).toEqual(['page', 'instagram', 'connect', 'permissions', 'subscription', 'test-message']);
    for (const l of LOCALES) {
      const html = renderMetaHelp(l);
      for (const s of META_HELP_STEPS) {
        expect(html, `${l} ${s.id}`).toContain(`id="${s.id}"`);
        expect(html, `${l} ${s.id}`).toContain(t(l, s.check, { section: t(l, 'accounts.title'), page: t(l, 'nav.channels') }).slice(0, 12));
      }
    }
  });

  it('links only to Meta\'s own help pages that were read and named — never anything else', () => {
    const links = META_HELP_STEPS.flatMap((s) => s.meta.map((m) => m.href));
    expect(links).toEqual([
      'https://www.facebook.com/help/104002523024878',
      'https://www.facebook.com/business/help/502981923235522',
      'https://www.facebook.com/business/help/898752960195806',
    ]);
    const html = renderMetaHelp('en');
    for (const href of [...html.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1])) expect(links, href).toContain(href);
  });
});

describe('CH1 · the Channels page\'s live mark', () => {
  it('a channels mark is a count and sixteen hex; any change is news', () => {
    expect(isMark('channels', '2.0123456789abcdef')).toBe(true);
    expect(isMark('channels', '2.xyz')).toBe(false);
    expect(liveNews('channels', '1.0123456789abcdef', '1.0123456789abcdef')).toEqual({ news: false });
    expect(liveNews('channels', '1.0123456789abcdef', '2.fedcba9876543210')).toEqual({ news: true, what: 'channels' });
  });
});

/* ── Phase 9 · B5 — the help page, as the re-audit read it ──────────────── */

describe('Phase 9 · B5 · Connecting Messenger and Instagram', () => {
  const css = readFileSync(new URL('../../src/api/web/layout.ts', import.meta.url), 'utf8');
  const visible = (html: string) => html.replace(/<[^>]*>/g, ' ');

  it('V1-456 · Meta’s jargon is said in plain words', () => {
    const en = visible(renderMetaHelp('en'));
    for (const w of ['subscribes', 'not subscribed', 'Page role', 'gives an app', 'whole road', 'professional account (business or creator)']) {
      expect(en.includes(w), w).toBe(false);
    }
    expect(visible(renderMetaHelp('zh'))).not.toContain('主页角色');
    expect(visible(renderMetaHelp('ar'))).not.toContain('إلى أي تطبيق');
  });

  it('V1-457 · V1-459 · the back link names the page it returns to, above the heading', () => {
    for (const l of LOCALES) {
      const html = renderMetaHelp(l);
      expect(html, l).toContain(`<span class="go" aria-hidden="true">‹</span>${t(l, 'nav.channels')}</a></div>\n    <h1 class="page">`);
    }
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(app).toContain("app.get('/app/help/meta', authed('settings',");   // it lights Setup, where Channels sits
  });

  it('V1-458 · a link to Meta looks like a link and says it leaves', () => {
    const html = renderMetaHelp('en');
    expect(html).toContain('<span class="go ext" aria-hidden="true">↗</span><span class="sr">(opens Meta’s site)</span></a>');
    expect(css).toMatch(/\.help-links a \{ color:var\(--color-ink\); text-decoration:underline;/);
  });

  it('V1-460 · Arabic: the apps are named in Arabic, as on the Channels page', () => {
    const ar = visible(renderMetaHelp('ar'));
    expect(ar).not.toMatch(/Facebook|Instagram|Messenger/);
    expect(ar).toContain('فيسبوك');
    expect(ar).toContain('إنستغرام');
  });

  it('V1-461 · the rules are the Channels page’s own sentences', () => {
    for (const l of LOCALES) {
      const html = renderMetaHelp(l);
      for (const k of ['meta.rules.window', 'meta.rules.first', 'meta.rules.media'] as const) {
        expect(html.replace(/[\u2068\u2069]/g, ''), `${l} ${k}`).toContain(t(l, k).replace(/&/g, '&amp;'));
      }
    }
  });

  it('missed-22 · where the Channels page shows no step list, the page does not send the owner to look for one', () => {
    for (const l of LOCALES) {
      const html = renderMetaHelp(l, { statusShown: false });
      expect(html, l).toContain(t(l, 'help.meta.lead.noStatus'));
      expect(html, l).toContain(t(l, 'help.meta.connect.check.noStatus'));
      expect(html, l).toContain(t(l, 'help.meta.subscription.check.noStatus'));
      expect(html, l).not.toContain(t(l, 'accounts.title'));
    }
    // where it does, the section is named as the Channels page names it
    expect(renderMetaHelp('en')).toContain('Under “Your Facebook Page and Instagram”');
  });

  it('V1-462 · V1-463 · missed-23 · the title names Messenger; a step’s two lines sit under its title; a business, not a shop', () => {
    expect(t('en', 'help.meta.title')).toContain('Messenger');
    for (const l of LOCALES) expect(renderMetaHelp(l), l).toContain('<p class="help-line"><b>');
    expect(css).toMatch(/\.help-line \{ font-size:var\(--font-size-small\);/);
    const words: Record<string, RegExp> = { en: /\bshop\b/, zh: /店铺/, ar: /المتجر/, es: /\btienda\b/, fr: /\bboutique\b/ };
    for (const l of LOCALES) {
      expect(visible(renderMetaHelp(l)), l).not.toMatch(words[l]!);
      expect(t(l, 'accounts.test.todo'), l).not.toMatch(words[l]!);
    }
  });
});
