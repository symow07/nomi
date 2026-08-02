import { describe, it, expect } from 'vitest';
import { renderFactory, type FactoryView } from '../../src/api/web/factory.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

const channel = (connected: boolean) => ({
  kind: 'whatsapp', connected, status: (connected ? 'connected' : 'not_connected') as never,
  healthOk: connected, displayId: connected ? '+971 50 ••• 4444' : null,
  lastActivityAt: null, problem: null,
});

/** A factory the owner has finished setting up. */
const complete: FactoryView = {
  profile: {
    name: 'Yiwu Sunrise Housewares', description: 'Vacuum cups and kitchen goods since 2011.',
    location: 'Yiwu, Zhejiang', workingHours: 'Mon–Sat 9:00–18:00',
    contactEmail: 'sales@sunrise.example', contactPhone: null,
    languagesServed: ['en', 'zh'], categories: ['drinkware'], checklist: [],
  },
  products: { total: 12, needPrice: 0, names: ['Vacuum cup', 'Lunch box', 'Thermos', 'Kettle'] },
  promises: { certs: ['food_grade', 'BPA_free'], floorPriceUsd: 0.75, ownAuthorityPct: 7, ceilingPct: 10 },
  connection: { channel: channel(true), ownerPhone: '971500001111' },
  nextStep: null,
};

/** A factory on its first day. */
const fresh: FactoryView = {
  profile: {
    name: '', description: null, location: null, workingHours: null,
    contactEmail: null, contactPhone: null, languagesServed: [], categories: [], checklist: [],
  },
  products: { total: 0, needPrice: 0, names: [] },
  promises: { certs: [], floorPriceUsd: null, ownAuthorityPct: null, ceilingPct: null },
  connection: { channel: channel(false), ownerPhone: null },
  nextStep: 'introduce',
};

describe('Phase E · My factory answers the owner’s four questions', () => {
  it('every section is present, in the order an owner thinks about them', () => {
    const html = renderFactory(complete, 'en');
    const at = (s: string) => html.indexOf(s);
    expect(at('About your factory')).toBeGreaterThan(-1);
    expect(at('What you sell')).toBeGreaterThan(at('About your factory'));
    expect(at('What you promise buyers')).toBeGreaterThan(at('What you sell'));
    expect(at('Where buyers reach you')).toBeGreaterThan(at('What you promise buyers'));
    // each section carries the owner's own question
    for (const q of ['Who are we?', 'What do we sell?', 'Where can buyers reach us?',
                     'What should Lily never get wrong?'])
      expect(html).toContain(q);
  });

  it('shows the real business facts it was given, and omits the ones it was not', () => {
    const html = renderFactory(complete, 'en');
    expect(html).toContain('Yiwu Sunrise Housewares');
    expect(html).toContain('Vacuum cups and kitchen goods since 2011.');
    expect(html).toContain('Yiwu, Zhejiang');
    expect(html).toContain('sales@sunrise.example');
    expect(html).toContain('English · 中文');
    const noHours = renderFactory({ ...complete, profile: { ...complete.profile, workingHours: null } }, 'en');
    expect(noHours).not.toContain('Working hours');   // absent facts leave no empty row

    // a phone is labelled a phone, even when there is no email beside it
    const phoneOnly = renderFactory({ ...complete, profile: { ...complete.profile, contactEmail: null, contactPhone: '+86 579 8888 1234' } }, 'en');
    expect(phoneOnly).toContain('+86 579 8888 1234');
    expect(phoneOnly).not.toContain('Contact email');
    expect(phoneOnly).toContain('Contact phone');
  });

  it('products are a real count with the honest pricing state', () => {
    expect(renderFactory(complete, 'en')).toContain('>12<span');
    expect(renderFactory(complete, 'en')).toContain('Lily can quote every one of them');
    const some = renderFactory({ ...complete, products: { ...complete.products, needPrice: 3 } }, 'en');
    expect(some).toContain('3 still need a price');
  });

  it('promises are the guard’s allowlist, named in the owner’s words not the guard’s keys', () => {
    const html = renderFactory(complete, 'en');
    expect(html).toContain('Food-safe materials'); expect(html).toContain('BPA free');
    expect(html).not.toContain('food_grade');        // never an internal key
    expect(html).toContain('Lily may state these to a buyer');
    expect(html).toContain('she will not say');      // default-deny, in owner language
    // meaning arrives before the tokens it explains
    expect(html.indexOf('may state these')).toBeLessThan(html.indexOf('Food-safe materials'));
  });

  it('price rules match the guard: settles alone, waits in the band, never past the ceiling', () => {
    // quote.ts settles alone up to humanRequiredAbovePct (7), escalates above
    // it, and clamps at maxDiscountPct (10). The ceiling is the HIGHER number —
    // a single "up to X% on her own, asks above Y%" sentence inverts it.
    const html = renderFactory(complete, 'en');
    expect(html).toContain('never quotes below $0.75');
    expect(html).toContain('settles up to 7% off on her own');
    expect(html).toContain('Between 7% and 10% she writes the reply and waits for you');
    expect(html).toContain('never goes past 10%');
    // the thresholds must read in ascending order — the inversion guard
    expect(html.indexOf('7% off on her own')).toBeLessThan(html.indexOf('never goes past 10%'));
    expect(html).not.toContain('up to 10% off on her own');
  });

  it('no phantom band when the owner’s two thresholds are the same number', () => {
    const html = renderFactory({ ...complete, promises: { ...complete.promises, ownAuthorityPct: 10, ceilingPct: 10 } }, 'en');
    expect(html).toContain('settles up to 10% off on her own');
    expect(html).toContain('never goes past 10%');
    expect(html).not.toContain('waits for you');     // there is no band to wait in
  });

  it('price rules appear only when the owner actually has them', () => {
    const none = renderFactory({ ...complete, promises: { certs: [], floorPriceUsd: null, ownAuthorityPct: null, ceilingPct: null } }, 'en');
    expect(none).not.toContain('never quotes below');
    expect(none).not.toContain('off on her own');
    expect(none).not.toContain('never goes past');
    expect(none).toContain('You have not confirmed anything');
    expect(none).toContain('she will not say');       // the rule holds even with nothing allowed
  });

  it('connection says connected or not, and what that means — not how it works', () => {
    const on = renderFactory(complete, 'en');
    expect(on).toContain('Connected');
    expect(on).toContain('reach Lily');
    expect(on).toContain('+971 50 ••• 4444');
    const off = renderFactory(fresh, 'en');
    expect(off).toContain('Not connected');
    expect(off).toContain('cannot receive or answer a buyer');
  });

  it('a finished factory shows no next step; a new one shows exactly one', () => {
    expect(renderFactory(complete, 'en')).not.toContain('class="fnext"');
    for (const [step, href] of [['introduce', '/app/settings'], ['products', '/app/products'], ['connect', '/app/channels']] as const) {
      const html = renderFactory({ ...fresh, nextStep: step }, 'en');
      expect(html.split('class="fnext"').length - 1, step).toBe(1);
      expect(html).toContain(`class="fnext" href="${href}"`);
    }
  });

  it('an empty factory is honest about being empty, never a wall of zeros', () => {
    const html = renderFactory(fresh, 'en');
    expect(html).toContain('nothing to tell buyers about you yet');
    expect(html).toContain('nothing to quote yet');
    expect(html).not.toContain('>0<');
    expect(html.toLowerCase()).not.toContain('no data');
  });

  it('every section offers a way through to the surface that owns it', () => {
    const html = renderFactory(complete, 'en');
    for (const href of ['/app/settings', '/app/products', '/app/knowledge', '/app/channels'])
      expect(html, href).toContain(`href="${href}"`);
  });

  it('reads nothing back to the owner as a form — it is a page, not a settings panel', () => {
    const html = renderFactory(complete, 'en');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('<table');
  });
});

describe('Phase E · language (all locales, RTL-safe)', () => {
  it('renders fully in every locale and each keeps its own words', () => {
    for (const l of LOCALES) expect(renderFactory(complete, l).length).toBeGreaterThan(800);
    const zh = renderFactory(complete, 'zh');
    expect(zh).toContain('我的工厂'); expect(zh).toContain('我们是谁？'); expect(zh).toContain('你对买家的承诺');
    expect(zh).not.toContain('About your factory');
    const ar = renderFactory(complete, 'ar');
    expect(ar).toContain('مصنعي'); expect(ar).toContain('من نحن؟'); expect(ar).toContain('ما تعد به المشترين');
    expect(ar).not.toContain('About your factory');
  });

  it('the empty and next-step states are localized too — no English leaks', () => {
    for (const l of ['zh', 'ar'] as const) {
      const html = renderFactory(fresh, l).replace(/<style>[\s\S]*?<\/style>/g, '');
      expect(html).not.toMatch(/nothing to (tell|quote)/);
      expect(html).not.toContain('Not connected');
      expect(html).not.toContain('Tell Lily');
    }
  });

  it('keyboard focus is visible, matching the rest of the app', () => {
    const style = renderFactory(complete, 'en').match(/<style>[\s\S]*<\/style>/)![0];
    expect(style).toContain('a:focus-visible');
    expect(style).toContain('outline:2px solid #60a5fa');
  });

  it('forward affordances mirror in RTL, and Latin runs are isolated from Arabic', () => {
    const style = renderFactory(complete, 'ar').match(/<style>[\s\S]*<\/style>/)![0];
    expect(style).toContain('[dir="rtl"] .fgo { transform:scaleX(-1)');
    const ar = renderFactory(complete, 'ar');
    // product names and field values are Latin inside an Arabic paragraph
    expect(ar).toContain('<bdi>Vacuum cup</bdi>');
    expect(ar).toContain('<bdi class="fval">');
  });

  it('a disconnected channel is its own remedy — the block links to the fix', () => {
    const off = renderFactory(fresh, 'ar');
    expect(off).toContain('<a class="fconn off" href="/app/channels"');
    const on = renderFactory(complete, 'en');
    expect(on).toContain('<div class="fconn on"');
    expect(on).not.toContain('fconn off');
  });

  it('RTL-safe layout: no physical left/right in the page’s own styles', () => {
    const style = renderFactory(complete, 'ar').match(/<style>[\s\S]*<\/style>/)![0];
    expect(style).not.toMatch(/\bmargin-left\b|\bmargin-right\b|\bpadding-left\b|\bpadding-right\b/);
    expect(style).not.toMatch(/\bborder-left\b|\bborder-right\b|\btext-align:\s*(left|right)\b/);
  });

  it('no message is left half-written: every placeholder is filled, every locale', () => {
    for (const l of LOCALES) {
      for (const view of [complete, fresh]) {
        const html = renderFactory(view, l).replace(/<style>[\s\S]*?<\/style>/g, '');
        expect(html.match(/\{[a-zA-Z]+\}/g) ?? [], `${l}: unsubstituted placeholder`).toEqual([]);
      }
    }
  });

  it('escapes everything the owner typed', () => {
    const evil = renderFactory({
      ...complete,
      profile: { ...complete.profile, name: '<script>alert(1)</script>', description: '<img src=x onerror=alert(1)>' },
      products: { ...complete.products, names: ['</p><script>bad()</script>'] },
    }, 'en');
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).not.toContain('<img src=x onerror');
    expect(evil).not.toContain('<script>bad()</script>');
    expect(evil).toContain('&lt;script&gt;');
  });

  it('speaks about a business, never about software — any locale', () => {
    for (const l of LOCALES) {
      const all = (renderFactory(complete, l) + renderFactory(fresh, l)).toLowerCase();
      for (const banned of [
        'ai', 'llm', 'model', 'token', 'api', 'webhook', 'database', 'confidence', 'automation', 'prompt',
        'configure', 'configuration', 'settings panel', 'policy engine', 'validation', 'constraint',
        'provider', 'adapter', 'credential', 'tenant', 'claims_policy', 'pricing policy',
        '模型', '人工智能', '数据库', '置信度', '接口', '配置',
      ]) {
        const hit = /^[a-z_ ]+$/.test(banned) ? new RegExp(`\\b${banned}\\b`).test(all) : all.includes(banned);
        expect(hit, `${l}:"${banned}"`).toBe(false);
      }
    }
  });

  it('invents no metric: no score, no rating, no performance percentage', () => {
    for (const l of LOCALES) {
      const html = renderFactory(complete, l).replace(/<style>[\s\S]*?<\/style>/g, '');
      for (const banned of ['score', 'rating', 'ranking', 'accuracy', 'performance', '评分', '成功率'])
        expect(html.toLowerCase().includes(banned), `${l}:${banned}`).toBe(false);
      // the only percentages on the page are the owner's OWN discount rules
      for (const m of html.match(/\d+%/g) ?? []) expect(['7%', '10%']).toContain(m);
    }
  });
});
