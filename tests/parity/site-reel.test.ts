import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderSiteReel, REEL_NATIVE_REVIEW, reelReady } from '../../src/api/web/siteReel.js';
import { disclosureFor } from '../../src/core/conversation/disclosure.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { messages, t } from '../../src/core/owner/i18n/messages.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * PHASE 3a — THE REEL (the owner's decisions at the stop-gate, 2026-10-13):
 *   · the beats are the headline's verbs ("It closes" — the beat is "Closes", not "Sells");
 *   · FIGURES: only inside the made-up shop, marked as an example, a quantity and a per-piece price; never, anywhere,
 *     a figure about results, speed, revenue, conversion, time saved or how many customers;
 *   · "Coming" for the books: no date, nothing to click;
 *   · "AI" stays out of the site's own words — the one place it is said is the customer's disclosure, word for word;
 *   · the first screen stays today's until all five languages have had a native read.
 */

const page = (locale: Locale) => renderSiteReel({ locale, path: '/site/next', noindex: true, contact: 'hello@example.test', signIn: '/login', signUp: null });
const visible = (html: string): string => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<title>[\s\S]*?<\/title>/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/[\u2068\u2069]/g, '').replace(/\s+/g, ' ');
/** The reel's conversation — the made-up shop, marked as an example. */
const example = (html: string): string => /<div class="rl-chat" data-example>[\s\S]*?<\/figure>/.exec(html)?.[0] ?? '';
const outsideExample = (html: string): string => html.replace(/<figure class="rl-phone"[\s\S]*?<\/figure>/, ' ');

/** A figure about performance, in any of the five languages: what the site may never claim. */
const PERFORMANCE = /[0-9٠-٩][0-9٠-٩.,]*\s*(%|٪|percent|per ?cent|x\b|×|times|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|customers?|clients?|buyers?|sales|revenue|conversions?|秒|分钟|小时|天|客户|销售|转化|倍|ثانية|ثوان|دقيقة|دقائق|ساعة|ساعات|عملاء|مبيعات|تحويل|segundos?|minutos?|horas?|clientes?|ventas|conversi[oó]n|secondes?|heures?|ventes)/i;

describe('Phase 3a · the reel says what the headline says', () => {
  it('the headline\'s verbs are the beats: answers, negotiates, closes — and the books, coming', () => {
    const head = t('en', 'site.reel.title').toLowerCase();
    for (const b of ['answers', 'negotiates', 'closes']) {
      expect(head, b).toContain(t('en', `site.reel.${b}.title` as never).toLowerCase());
    }
    expect(t('en', 'site.reel.closes.title')).toBe('Closes');
    const html = page('en');
    expect(visible(html)).not.toMatch(/\bSells\b/);
    for (const b of ['Answers', 'Negotiates', 'Closes', 'Keeps the books']) expect(visible(html), b).toContain(b);
  });

  it('in every language: the page\'s direction, never indexed, the example marked, every line from the catalogue', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(html, l).toContain(`<html lang="${l}" dir="${l === 'ar' ? 'rtl' : 'ltr'}"`);
      expect(html, l).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(example(html), l).not.toBe('');
      expect(html, l).toContain(`<span class="rl-mark">${t(l, 'site.reel.example')}</span>`);
      for (const k of Object.keys(messages.en).filter((x) => x.startsWith('site.reel.') && !x.includes('{'))) {
        expect(messages[l][k as keyof typeof messages.en], `${l} ${k}`).toBeTruthy();
      }
    }
  });
});

describe('Phase 3a · figures: an example\'s price, never a claim', () => {
  it('the catalogue\'s own reel words carry no figure: the example\'s come in as parameters', () => {
    for (const l of LOCALES) for (const [k, v] of Object.entries(messages[l])) {
      if (k.startsWith('site.reel.')) expect(String(v), `${l} ${k}`).not.toMatch(/[0-9٠-٩%٪$€£¥￥]/);
    }
  });

  it('figures appear only inside the made-up shop\'s conversation — a quantity and a per-piece price moving', () => {
    for (const l of LOCALES) {
      const html = page(l);
      expect(visible(outsideExample(html)), `${l}: a figure outside the example`).not.toMatch(/[0-9٠-٩]/);
      const shop = visible(example(html));
      expect(shop, l).toMatch(/[0-9٠-٩]/);
      expect(example(html), l).toMatch(/<s class="rl-was[^"]*"><bdi>[^<]+<\/bdi><\/s> <b class="[^"]*"><bdi>[^<]+<\/bdi><\/b>/);
    }
  });

  it('no figure about results, speed, revenue, conversion, time saved or how many customers — anywhere, the reel included', () => {
    for (const l of LOCALES) {
      expect(visible(page(l)), l).not.toMatch(PERFORMANCE);
      for (const [k, v] of Object.entries(messages[l])) if (k.startsWith('site.')) expect(String(v), `${l} ${k}`).not.toMatch(PERFORMANCE);
    }
    // The net itself catches the claims the rule names.
    for (const claim of ['30% more sales', 'replies in 2 seconds', '3x faster', 'saves 5 hours', '1,000 customers', '回复只要2秒', 'زيادة ٣٠٪']) {
      expect(claim, claim).toMatch(PERFORMANCE);
    }
    expect('500 pcs · $4.20 → $3.80').not.toMatch(PERFORMANCE);
  });
});

describe('Phase 3a · "Coming" promises nothing', () => {
  it('the books beat and its scene: no date, no figure, nothing to click', () => {
    for (const l of LOCALES) {
      const html = page(l);
      for (const part of [...html.matchAll(/<(li|div) class="[^"]*rl-books[^"]*">[\s\S]*?<\/\1>/g)].map((m) => m[0])) {
        expect(part, l).not.toMatch(/<a\b|<button\b|href=/);
        expect(visible(part), l).not.toMatch(/[0-9٠-٩]/);
        expect(part, l).toContain(t(l, 'site.reel.coming'));
      }
    }
  });
});

describe('Phase 3a · "AI" is the customer\'s disclosure, never the site\'s own words', () => {
  it('the site\'s own words name no banned owner term; the disclosure is the product\'s, word for word', () => {
    for (const l of LOCALES) {
      const html = page(l);
      const disclosure = disclosureFor({ detected: l, name: 'Mira', business: 'Linden Totes' })!;
      const escaped = esc(disclosure);
      expect(html, l).toContain(escaped);
      // The made-up shop's name ends in no full stop: the disclosure puts one after the name (no "Co..").
      expect(visible(html), l).not.toMatch(/\.\./);
      const own = visible(html.replace(escaped, ' '));
      // A Latin term as a whole word ("AI", not the "ai" inside a word); a Chinese or Arabic one as written.
      const says = (term: string) => (/^[\x20-\x7e]+$/.test(term)
        ? new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(own) : own.includes(term));
      expect(BANNED_OWNER_TERMS.filter(says), l).toEqual([]);
    }
  });
});

describe('Phase 3a · the first screen stays today\'s until every language is read', () => {
  it('the native reads: English (the owner\'s), and the four others still waiting — so `/` is the site as it is', () => {
    expect(REEL_NATIVE_REVIEW).toEqual({ en: true, zh: false, ar: false, es: false, fr: false });
    expect(reelReady()).toBe(false);
    const app = readFileSync('src/api/web/app.ts', 'utf8');
    expect(app).toMatch(/app\.get\('\/', async[\s\S]{0,300}reelReady\(\)\s*\?\s*renderSiteReel\([\s\S]{0,80}:\s*await site\(req, '\/', false\)/);
    expect(app).toContain("app.get('/site/next'");
  });

  it('the review list says the first screen waits on it', () => {
    const list = readFileSync('docs/NATIVE-REVIEW-UI.md', 'utf8');
    expect(list).toMatch(/Phase 3a — the reel[\s\S]{0,600}GATE/);
  });
});

describe('Phase 4 gate · the hooks (the owner\'s notes, 2026-10-14)', () => {
  it('a · the order card carries the stakes: the quantity, the price agreed, and the total they make', async () => {
    const show = await import('../../src/api/web/values.js');
    const { usd } = await import('../../src/core/types/money.js');
    for (const l of LOCALES) {
      const sum = /<p class="rl-card-text rl-sum">[\s\S]*?<\/p>/.exec(page(l))?.[0] ?? '';
      expect(sum, l).toContain(esc(show.money(l, usd('3.8'))));
      expect(sum, l).toContain(esc(show.money(l, usd('1900'))));   // the total IS 500 × 3.80
      expect(sum, l).toContain('×');
    }
  });

  it('b · the proforma line draws the product\'s own document icon, never an empty box', () => {
    const html = page('en');
    expect(html).not.toContain('rl-doc-mark');
    expect(html).toMatch(/<p class="rl-doc [^"]*"><svg class="rl-doc-icon sl"[^>]*aria-hidden="true"/);
  });

  it('c · a tapped button folds away, and the hooks show one scene, as tall as its words', () => {
    const html = page('en');
    expect(html).not.toMatch(/<p class="rl-act rl-\d-rl-out-/);
    expect(html).toMatch(/<p class="rl-act rl-\d-rl-fold-/);
    expect(html).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.rl-act \{ display:none; \}|\.rl-play, \.rl-act \{ display:none; \}/);
    const hooks = readFileSync('tools/record-hooks.mjs', 'utf8');
    expect(hooks).toContain('.hook .rl-scene.rl-s${scene} { display:flex; }');
    expect(hooks).toContain('.hook .rl-chat { block-size:auto; }');
  });

  it('d · one made-up shop everywhere: the reel never names a real business, and the hooks are drawn from the reel', () => {
    for (const l of LOCALES) expect(page(l), l).not.toMatch(/Westlake|Hongfa|义乌宏发/);
    expect(page('en')).toContain('Linden Totes');
    expect(readFileSync('tools/record-hooks.mjs', 'utf8')).toContain("const { renderSiteReel } = await import('../dist/api/web/siteReel.js');");
  });
});

describe('Phase 3a · motion', () => {
  it('nothing moves under reduced motion, and the page runs no script', () => {
    const html = page('en');
    expect(html).toContain('@media (prefers-reduced-motion: reduce)');
    expect(html).not.toContain('<script');
  });
});
