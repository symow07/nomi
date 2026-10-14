import { describe, it, expect } from 'vitest';
import { namesWanted, scriptLanguagesOf, scriptPattern, writtenIn, SCRIPT_LANGUAGES, type ScriptLanguage } from '../../src/core/onboard/scriptNames.js';
import { setupFrom, SETUP_STEPS, type NamesWanted } from '../../src/db/setup.js';
import { renderGuide } from '../../src/api/web/guide.js';
import { renderOperationsHome, type OperationsSnapshot } from '../../src/api/web/operations.js';
import { NOTHING_TODAY } from '../../src/api/web/today.js';
import { renderProductList, renderProductDetail, type ProductListItem, type ProductDetail } from '../../src/api/web/products.js';
import { languageCalled } from '../../src/api/web/namesWanted.js';
import { withWorkspace, type RequestScope } from '../../src/api/web/say.js';
import { STEP_LINK } from '../../src/api/web/onboarding.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { esc } from '../../src/api/web/layout.js';
import * as show from '../../src/api/web/values.js';
import { usd } from '../../src/core/types/money.js';

/**
 * "Row 13 in onboarding. Put the Chinese names requirement in the onboarding path itself, not only in the pilot kit —
 * any owner selling to Chinese buyers has this problem on day one." (the owner, 2026-10-14)
 *
 * The products step of setting up is done only once every active product has a name in each served language written
 * in its own script (Chinese, Arabic, Russian); Getting started, Home, the list and the product's page say which.
 * Over Postgres: tests/integration/setup-names.test.ts.
 */

const bare = (x: string): string => x.replace(/[\u2066-\u2069]/g, '');

describe('a name in each script the buyers write', () => {
  it('tells the scripts apart, and a Latin name is no script\'s', () => {
    expect(writtenIn('zh', '无纺布购物袋')).toBe(true);
    expect(writtenIn('zh', 'Non-woven bag')).toBe(false);
    expect(writtenIn('ar', 'حقيبة قماشية')).toBe(true);
    expect(writtenIn('ar', '无纺布购物袋')).toBe(false);
    expect(writtenIn('ru', 'холщовая сумка')).toBe(true);
    expect(writtenIn('ru', 'bolsa de tela')).toBe(false);
  });
  it('a name may mix scripts: «PP无纺布袋» is a Chinese name', () => {
    expect(writtenIn('zh', 'PP无纺布袋 40g')).toBe(true);
  });
  it('only the served languages with a script of their own are asked for, in a fixed order', () => {
    expect(scriptLanguagesOf(['en', 'zh', 'ar'])).toEqual(['zh', 'ar']);
    expect(scriptLanguagesOf(['ar', 'es', 'fr', 'ru'])).toEqual(['ar', 'ru']);
    expect(scriptLanguagesOf(['en', 'es', 'fr', 'pt', 'de', 'tr'])).toEqual([]);
  });
  it('what is wanted: the served script languages none of the names is in', () => {
    expect(namesWanted(['en', 'zh', 'ar'], ['Canvas tote', null])).toEqual(['zh', 'ar']);
    expect(namesWanted(['en', 'zh', 'ar'], ['Canvas tote', '帆布袋'])).toEqual(['ar']);
    expect(namesWanted(['en', 'zh', 'ar'], ['Canvas tote', '帆布袋', 'حقيبة قماشية'])).toEqual([]);
    expect(namesWanted(['en'], ['Canvas tote'])).toEqual([]);
  });
  it('one pattern, read the same by the database and the page: a bracket of code-point ranges', () => {
    for (const l of SCRIPT_LANGUAGES) expect(scriptPattern(l)).toMatch(/^\[(.-.)+\]$/u);
  });
});

const NAMES: readonly NamesWanted[] = [{ lang: 'zh', missing: 3, of: 5 }, { lang: 'ar', missing: 5, of: 5 }];
const line = (l: Locale, w: NamesWanted): string => bare(esc(t(l, 'setup.names.missing', {
  language: languageCalled(l, w.lang), n: show.count(l, w.missing), total: show.count(l, w.of),
})));

describe('Getting started: the products step says which names are missing', () => {
  it('in every language, one line per language, only while the step waits', () => {
    for (const l of LOCALES) {
      const steps = SETUP_STEPS.map((step) => ({ step, done: step === 'profile' }));
      const html = bare(renderGuide({ steps, next: 'products', names: NAMES }, l, 'Lily', () => false));
      const step = html.slice(html.indexOf('id="products"'), html.indexOf('id="name"'));
      for (const w of NAMES) expect(step, `${l} ${w.lang}`).toContain(line(l, w));
      const done = bare(renderGuide({ steps: SETUP_STEPS.map((s) => ({ step: s, done: true })), next: null, names: [] }, l, 'Lily', () => false));
      expect(done, l).not.toContain('fwarn');
    }
  });
});

const SNAP: OperationsSnapshot = {
  range: 'today',
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0, deletionAsks: 0, ordersWaiting: 0 },
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { status: 'connected', provider: 'meta', live: true }, budget: null, hasAttention: false,
};
const scope = (over: Partial<RequestScope>): RequestScope => ({
  name: 'Lily', several: false, outreach: false, setup: null,
  business: 'Westlake', needsYou: 0, zone: 'Asia/Shanghai', country: 'CN', ...over,
});
const home = (l: Locale, setup: RequestScope['setup'], snap: OperationsSnapshot = SNAP): string =>
  bare(withWorkspace(scope({ setup }), () => renderOperationsHome(snap, l, { ...NOTHING_TODAY(new Date('2026-10-14T09:00:00Z')), sending: ['whatsapp'] })));

describe('Home: when names are what the products step waits for, Home says so', () => {
  const waiting = setupFrom({ profile: true, products: false, name: true, channels: true, first_success: false }, NAMES);
  it('the next step\'s card says which names, in every language', () => {
    for (const l of LOCALES) {
      const html = home(l, waiting);
      const at = html.indexOf('<section class="block home-start"');
      expect(at, l).toBeGreaterThan(-1);
      const card = html.slice(at, html.indexOf('</section>', at));
      for (const w of NAMES) expect(card, `${l} ${w.lang}`).toContain(line(l, w));
      expect(card, l).not.toContain(esc(t(l, 'start.why.products', { name: 'Lily' })));
    }
  });
  it('a busy day keeps the small line: its door names the names', () => {
    const busy: OperationsSnapshot = { ...SNAP, attention: { ...SNAP.attention, blockedMessages: 1 }, hasAttention: true };
    for (const l of LOCALES) {
      const html = home(l, waiting, busy);
      expect(html, l).toContain(esc(t(l, 'setup.names.door')));
      expect(html, l).toContain(`href="${STEP_LINK.products}"`);
    }
  });
  it('products not added at all: the step\'s own words, as before', () => {
    const none = setupFrom({ profile: true, products: false, name: true, channels: true, first_success: false });
    expect(home('en', none)).toContain(esc(t('en', 'start.why.products', { name: 'Lily' })));
  });
});

describe('the list and the product\'s page say it of each product', () => {
  const item = (namesWanted: readonly ScriptLanguage[]): ProductListItem => ({
    id: 'p1', name: 'Canvas tote', nameZh: null, sku: 'CT-1', moq: 100, unit: 'pcs',
    entryQty: 100, entryPrice: usd(1.2), learned: true, status: 'learned', imageMatchable: true, isActive: true, namesWanted,
  });
  it('the list marks a product with no name in a served script, and only that one', () => {
    for (const l of LOCALES) {
      const html = withWorkspace(scope({}), () => renderProductList([item(['zh', 'ar']), { ...item([]), id: 'p2', name: 'Paper bag' }], l));
      for (const lang of ['zh', 'ar'] as const) {
        expect(html, `${l} ${lang}`).toContain(esc(t(l, 'product.list.noName', { language: languageCalled(l, lang) })));
      }
      const second = html.slice(html.indexOf('/app/products/p2'));
      expect(second, l).not.toContain(esc(t(l, 'product.list.noName', { language: languageCalled(l, 'zh') })));
    }
  });
  it('the product\'s page says it where its names are, before the box that adds one', () => {
    const detail = (namesWanted: ProductDetail['namesWanted'], aliases: string[]): ProductDetail => ({
      id: 'p1', name: 'Canvas tote', nameZh: null, sku: 'CT-1', category: null, unit: 'pcs', moq: 100, leadTimeDays: null,
      customizable: false, learned: true, status: 'learned', imageMatchable: true, isActive: true,
      tiers: [{ minQty: 100, maxQty: null, unitPrice: usd(1.2) }], aliases, images: [], recentQuotes: [],
      photo: null, currency: 'USD', source: null, namesWanted,
    } as unknown as ProductDetail);
    for (const l of LOCALES) {
      for (const aliases of [['canvas tote'], []]) {
        const html = withWorkspace(scope({}), () => renderProductDetail(detail(['zh'], aliases), l));
        const names = html.indexOf('id="names"');
        const said = html.indexOf(esc(t(l, 'product.detail.noName', { language: languageCalled(l, 'zh') })));
        expect(said, `${l} ${aliases.length}`).toBeGreaterThan(names);
        expect(names, l).toBeGreaterThan(-1);
      }
      const fine = withWorkspace(scope({}), () => renderProductDetail(detail([], ['canvas tote', '帆布袋']), l));
      expect(fine, l).not.toContain(esc(t(l, 'product.detail.noName', { language: languageCalled(l, 'zh') })));
    }
  });
  it('the language is named in the owner\'s own language', () => {
    expect(languageCalled('en', 'zh')).toBe('Chinese');
    expect(languageCalled('zh', 'zh')).toBe('中文');
    expect(languageCalled('ar', 'zh')).toBe('الصينية');
    expect(languageCalled('fr', 'ar')).toBe('arabe');
  });
});
