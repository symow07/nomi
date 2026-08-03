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
    languagesServed: ['en', 'zh'], categories: ['drinkware'],
  },
  products: { total: 12, needPrice: 0, names: [
    { name: 'Vacuum cup', nameZh: '保温杯' }, { name: 'Lunch box', nameZh: '饭盒' },
    { name: 'Thermos', nameZh: '热水瓶' }, { name: 'Kettle', nameZh: '水壶' }] },
  promises: { certs: ['food_grade', 'BPA_free'], floorLowUsd: 0.75, floorHighUsd: 0.75, ceilingPct: 8, ceilingVaries: false },
  connection: { channel: channel(true), ownerPhone: '971500001111' },
  nextStep: null,
  readiness: { canActivate: true, blockers: [], live: false, activatedAt: null, activatedBy: null,
    recipients: [{ phone: '971500001111', label: 'my phone' }, { phone: '971500002222', label: null }] },
};

/** A factory on its first day. */
const fresh: FactoryView = {
  profile: {
    name: '', description: null, location: null, workingHours: null,
    contactEmail: null, contactPhone: null, languagesServed: [], categories: [],
  },
  products: { total: 0, needPrice: 0, names: [] },
  promises: { certs: [], floorLowUsd: null, floorHighUsd: null, ceilingPct: null, ceilingVaries: false },
  connection: { channel: channel(false), ownerPhone: null },
  nextStep: 'profile',
  readiness: { canActivate: false, blockers: ['no_channel', 'no_allowlist'], recipients: [], live: false,
    activatedAt: null, activatedBy: null },
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

  it('states only the two rules the guard actually enforces', () => {
    // quote.ts clamps the price at the floor and the discount at the ceiling.
    // humanRequiredAbovePct sets `requiresHuman`, which lands in the quote audit
    // and NEVER decides draft-vs-send (turn.ts asks resolveMode only) — so the
    // page must not promise the owner that a big discount waits for her.
    const rules = renderFactory(complete, 'en').match(/<ul class="frules">[\s\S]*?<\/ul>/)![0];
    expect(rules).toContain('never quotes below $0.75');
    expect(rules).toContain('never discounts more than 8%');
    expect(rules).not.toContain('waits for you');
    expect(rules).not.toContain('on her own');
  });

  it('a catalogue with different floors reports the range, never one product’s number', () => {
    // The guard reads the PER-PRODUCT policy; quoting a single business-wide
    // floor described numbers no quote had ever used.
    const html = renderFactory({ ...complete, promises: {
      ...complete.promises, floorLowUsd: 0.30, floorHighUsd: 2.40, ceilingVaries: true } }, 'en');
    expect(html).toContain('$0.30');
    expect(html).toContain('$2.40');
    expect(html).toContain('less on some products');
    expect(html).not.toMatch(/never quotes below \$0\.30\./);   // not stated as THE floor
  });

  it('price rules appear only when the owner actually has them', () => {
    const none = renderFactory({ ...complete, promises: { certs: [], floorLowUsd: null, floorHighUsd: null, ceilingPct: null, ceilingVaries: false } }, 'en');
    expect(none).not.toContain('never quotes below');
    expect(none).not.toContain('never discounts more than');
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
    for (const [step, href] of [['profile', '/app/settings'], ['products', '/app/products'], ['channels', '/app/channels'], ['first_success', '/app/inbox']] as const) {
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
    for (const href of ['/app/settings', '/app/products', '/app/knowledge', '/app/channels', '/app/onboarding', '/app/sandbox'])
      expect(html, href).toContain(`href="${href}"`);
  });

  it('is a page, not a settings panel — the only form is the go-live decision', () => {
    const html = renderFactory(complete, 'en');
    // M20.3 adds activate/deactivate here deliberately; nothing else on this
    // page collects input — every edit still happens on the surface that owns it.
    for (const f of html.match(/<form[^>]*action="([^"]*)"/g) ?? [])
      expect(f).toMatch(/\/app\/factory\/(activate|deactivate)/);
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

  it('uses the shell’s one “go deeper” link rather than a page-local variant', () => {
    const html = renderFactory(complete, 'en');
    expect(html).toContain('<a class="deeper" href="/app/settings">');
    expect(html).toContain('<span class="go" aria-hidden="true">›</span>');
    expect(html).not.toContain('class="fmore"');
  });

  it('Latin runs are isolated so an Arabic reader gets them in source order', () => {
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
      products: { ...complete.products, names: [{ name: '</p><script>bad()</script>', nameZh: null }] },
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
      for (const m of html.match(/\d+%/g) ?? []) expect(['8%']).toContain(m);
    }
  });
});

/**
 * Release hardening — the wording on My factory must come from the SAME policy
 * the quote engine obeys. The Phase E defect was a second interpretation: the
 * page read `pricingPolicy(null)` while `turn.ts` reads `pricingPolicy(productId)`
 * and a per-product row wins, so the page described numbers no quote had used.
 */
describe('Release hardening · My factory quotes the guard, not a second reading', () => {
  it('what the page promises is what computeQuote actually enforces', async () => {
    const { computeQuote } = await import('../../src/core/commerce/quote.js');
    const { product, tiers, policy } = await import('./fixtures.js');

    // A catalogue with two products on DIFFERENT rules — the shape that broke it.
    // (Floors sit under the fixture's $0.38 tier price so both quotes are real.)
    const policies = [
      policy({ floorPriceUsd: 0.30, maxDiscountPct: 8, humanRequiredAbovePct: 5 }),
      policy({ floorPriceUsd: 0.36, maxDiscountPct: 12, humanRequiredAbovePct: 5 }),
    ];
    const floors = policies.map((p) => p.floorPriceUsd);
    const view = {
      ...complete,
      promises: {
        certs: [], floorLowUsd: Math.min(...floors), floorHighUsd: Math.max(...floors),
        ceilingPct: Math.min(...policies.map((p) => p.maxDiscountPct)), ceilingVaries: true,
      },
    };
    const html = renderFactory(view as never, 'en');

    // 1. Every floor the page states must bound every real quote.
    for (const policy of policies) {
      const r = computeQuote({ product: product(), tiers: tiers(), policy, rules: [], quantity: 20000 });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.unitPriceUsd).toBeGreaterThanOrEqual(view.promises.floorLowUsd);
    }

    // 2. The page must show the RANGE, never one product's number as "the" floor.
    expect(html).toContain('$0.30');
    expect(html).toContain('$0.36');
    expect(html).not.toMatch(/never quotes below \$0\.36\./);

    // 3. The stated ceiling must be the strictest one, so it is never a promise
    //    the guard would exceed on some product.
    expect(view.promises.ceilingPct).toBe(Math.min(...policies.map((p) => p.maxDiscountPct)));
    expect(html).toContain('8%');
    expect(html).not.toContain('12%');
  });

  it('states nothing about escalation, because escalation is not a gate', async () => {
    // quote.ts sets requiresHuman from humanRequiredAbovePct, but turn.ts decides
    // draft-vs-send from resolveMode(capability) alone and never reads it. A page
    // that promised "between X% and Y% she waits for you" described nothing.
    const { readFile } = await import('node:fs/promises');
    const turn = await readFile(new URL('../../src/pipeline/turn.ts', import.meta.url), 'utf8');
    const decision = turn.slice(turn.indexOf('const mode = resolveMode'), turn.indexOf('const mode = resolveMode') + 400);
    expect(decision).not.toContain('requiresHuman');

    for (const l of LOCALES) {
      const rules = renderFactory(complete, l).match(/<ul class="frules">[\s\S]*?<\/ul>/)?.[0] ?? '';
      expect(rules).not.toContain('waits for you');
      expect(rules).not.toContain('on her own');
      expect(rules).not.toContain('بنفسها');
      expect(rules).not.toContain('自己最多');
    }
  });
});

describe('Release hardening · the catalogue speaks the owner’s language', () => {
  it('a Chinese owner sees the Chinese product names her catalogue already holds', () => {
    // Scope to the names line: the business DESCRIPTION is owner-entered text
    // and stays exactly as she typed it, in whatever language that was.
    const names = (l: 'en' | 'zh') => renderFactory(complete, l).match(/<p class="fnames">.*?<\/p>/s)![0];
    expect(names('zh')).toContain('保温杯');
    expect(names('zh')).not.toContain('Vacuum cup');
    expect(names('en')).toContain('Vacuum cup');
    expect(names('en')).not.toContain('保温杯');
  });

  it('falls back to whichever name exists, never to a blank', () => {
    const html = renderFactory({ ...complete, products: { ...complete.products,
      names: [{ name: 'Only English', nameZh: null }, { name: null, nameZh: '只有中文' }] } }, 'zh');
    expect(html).toContain('Only English');
    expect(html).toContain('只有中文');
  });
});

/**
 * M20.2 — "Can she be activated now?" answered by the gate itself. The page may
 * never say more than the preconditions say, and never less.
 */
describe('M20.2 · the activation readiness surface', () => {
  const withReadiness = (r: Partial<FactoryView['readiness']>, l: 'en' | 'zh' | 'ar' = 'en') =>
    renderFactory({ ...complete, readiness: { ...complete.readiness, ...r } } as FactoryView, l);

  it('ready: says so, and names exactly who can receive a message', () => {
    const html = withReadiness({ canActivate: true, blockers: [], live: false });
    expect(html).toContain('can start talking to real buyers whenever you say so');
    expect(html).toContain('Only these people can receive a message from Lily');
    expect(html).toContain('my phone');
    expect(html).toContain('971500002222');          // no label → the number itself
  });

  it('ready: still says the owner decides — activation is not autonomy', () => {
    expect(withReadiness({ canActivate: true, blockers: [] }))
      .toContain('she still writes, you still send');
  });

  it('not ready: states each blocker the gate reported, and nothing else', () => {
    const html = withReadiness({ canActivate: false, blockers: ['no_channel', 'secrets_not_rotated'] });
    expect(html).toContain('Connect WhatsApp.');
    expect(html).toContain('Confirm you have changed your keys.');
    expect(html).not.toContain('Finish getting Lily ready');        // not a reported blocker
    expect(html).not.toContain('whenever you say so');
  });

  it('not ready: each blocker links to the place that fixes it', () => {
    expect(withReadiness({ canActivate: false, blockers: ['no_channel'] }))
      .toContain('<a class="blink" href="/app/channels">');
    expect(withReadiness({ canActivate: false, blockers: ['secrets_not_rotated'] }))
      .toContain('<a class="blink" href="/app/onboarding">');
  });

  it('a blocker with no surface yet states the requirement instead of a dead link', () => {
    // The allowlist UI arrives in M20.4; until then this must not pretend.
    const html = withReadiness({ canActivate: false, blockers: ['no_allowlist'] });
    expect(html).toContain('start with your own');
    expect(html).not.toMatch(/<a class="blink"[^>]*>[^<]*start with your own/);
  });

  it('live: reports that she is talking to real buyers, and to whom', () => {
    const html = withReadiness({ live: true, canActivate: true, blockers: [] });
    expect(html).toContain('is talking to real buyers');
    expect(html).toContain('my phone');
    expect(html).not.toContain('whenever you say so');   // she already started
  });

  it('invents no grade: no score, no percentage, no “n of m ready”', () => {
    for (const l of LOCALES) {
      for (const r of [{ canActivate: true, blockers: [] as never },
                       { canActivate: false, blockers: ['not_ready', 'no_allowlist'] as never }]) {
        const html = withReadiness(r, l).replace(/<style>[\s\S]*?<\/style>/g, '')
          .replace(/<ul class="frules">[\s\S]*?<\/ul>/, '');
        expect(html).not.toMatch(/\d+\s*%/);
        expect(html).not.toMatch(/\d+\s*(of|\/)\s*\d+/);
        for (const banned of ['score', 'grade', 'rating', '评分', '得分'])
          expect(html.toLowerCase().includes(banned), `${l}:${banned}`).toBe(false);
      }
    }
  });

  it('speaks owner language in every locale — no leaked blocker codes', () => {
    for (const l of LOCALES) {
      const html = withReadiness({ canActivate: false,
        blockers: ['schema_stale', 'not_ready', 'no_allowlist', 'secrets_not_rotated', 'no_channel'] as never }, l);
      for (const code of ['schema_stale', 'not_ready', 'no_allowlist', 'secrets_not_rotated', 'no_channel'])
        expect(html.includes(code), `${l} leaks ${code}`).toBe(false);
    }
    expect(withReadiness({ canActivate: false, blockers: ['no_channel'] }, 'zh')).toContain('连接WhatsApp');
    expect(withReadiness({ canActivate: false, blockers: ['no_channel'] }, 'ar')).toContain('اربط واتساب');
  });
});

/** M20.3 — going live is an owner decision, made here, and reversible here. */
describe('M20.3 · activate and deactivate as owner actions', () => {
  const view = (r: Partial<FactoryView['readiness']>, l: 'en' | 'zh' | 'ar' = 'en') =>
    renderFactory({ ...complete, readiness: { ...complete.readiness, ...r } } as FactoryView, l);

  it('ready: offers the decision, and says what it does before it is taken', () => {
    const html = view({ canActivate: true, blockers: [], live: false });
    expect(html).toContain('action="/app/factory/activate"');
    expect(html).toContain('Let Lily start');
    expect(html).toMatch(/data-confirm="[^"]*writes every reply and waits for your OK[^"]*"/);
    expect(html).toMatch(/data-confirm="[^"]*stop her at any time[^"]*"/);
    expect(html).toContain('she still writes, you still send');   // draft-first, stated
    expect(html).toContain('Only these people can receive a message');
  });

  it('not ready: no way to activate — the decision is not offered at all', () => {
    const html = view({ canActivate: false, blockers: ['no_channel'], live: false });
    expect(html).not.toContain('action="/app/factory/activate"');
    expect(html).toContain('Connect WhatsApp.');
  });

  it('live: the stop control is there, and explains what stopping does', () => {
    const html = view({ live: true, canActivate: true, blockers: [] });
    expect(html).toContain('action="/app/factory/deactivate"');
    expect(html).toContain('Stop messaging');
    expect(html).toContain('sends nothing further');
    expect(html).toContain('stay exactly as they are');          // nothing is deleted
    expect(html).toContain('start again whenever you want');     // rollback is possible
    expect(html).not.toContain('action="/app/factory/activate"');
  });

  it('live: says when it started and who started it — from the stored row', () => {
    const html = view({ live: true, activatedAt: new Date('2026-08-03T09:00:00Z'), activatedBy: 'owner' });
    expect(html).toMatch(/Started .* by owner/);
  });

  it('both decisions confirm first — neither fires on a stray tap', () => {
    expect(view({ canActivate: true, blockers: [] })).toContain('onclick="return confirm(this.dataset.confirm)"');
    expect(view({ live: true })).toContain('onclick="return confirm(this.dataset.confirm)"');
  });

  it('the controls and their warnings are localized', () => {
    expect(view({ canActivate: true, blockers: [] }, 'zh')).toContain('让小雅开始');
    expect(view({ live: true }, 'zh')).toContain('停止发消息');
    expect(view({ live: true }, 'zh')).toContain('什么都不会删掉');
    expect(view({ canActivate: true, blockers: [] }, 'ar')).toContain('دع ياسمين تبدأ');
    expect(view({ live: true }, 'ar')).toContain('أوقف المراسلة');
  });

  it('activation is never described as autonomy', () => {
    for (const l of LOCALES) {
      const html = (view({ canActivate: true, blockers: [] }, l) + view({ live: true }, l)).toLowerCase();
      for (const banned of ['automatic', 'automatically', 'on its own', '自动', 'تلقائي'])
        expect(html.includes(banned), `${l}:${banned}`).toBe(false);
    }
  });
});
