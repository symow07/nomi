import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { messages, t, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { FLASH_REFUSALS, FLASH_CONFIRMATIONS, flashTone } from '../../src/core/owner/flashTone.js';
import { countryCodes, countryOptions, canonicalCountry, isCountryCode } from '../../src/core/owner/business.js';
import { errorPage } from '../../src/api/web/layout.js';
import { mintFlash, readFlash, flashBanner, saidFlash, FLASH_TTL_MS } from '../../src/api/web/flash.js';

/**
 * PR 3 — the three things the audit found that this group fixes:
 * CC-19 / A13 (no page for a wrong address or a fault), the country list that
 * named six countries twice, and A1 + D5 (a notice that travelled as raw text
 * in the URL, and arrived green whether or not anything happened).
 */

const WEB = fileURLToPath(new URL('../../src/api/web/', import.meta.url));
const webFiles = () => readdirSync(WEB).filter((f) => f.endsWith('.ts'));
const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

const SECRET = 'a-test-secret-long-enough-to-sign-with';
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);

describe('CC-19 · a wrong address, and a page that broke', () => {
  it('both pages exist in all three languages, and say something different', () => {
    for (const locale of LOCALES) {
      const lost = errorPage({ locale, path: '/app/nope', kind: 'notfound' });
      const broke = errorPage({ locale, path: '/app/inbox', kind: 'crash', reference: 'deadbeef' });
      expect(lost).toContain(t(locale, 'error.notfound.title'));
      expect(broke).toContain(t(locale, 'error.crash.title'));
      expect(lost).not.toContain(t(locale, 'error.crash.title'));
      expect(lost).toContain(`lang="${locale}"`);
    }
  });

  it('the broken page admits nothing but a reference', () => {
    const html = errorPage({ locale: 'en', path: '/app/x', kind: 'crash', reference: 'c0ffee11' });
    expect(html, 'the reference is the whole point — it ties a report to one log line').toContain('c0ffee11');
    // Whatever threw, its message, its stack and the route it threw in stay in
    // the log. A 500 page is read by whoever provoked it, deliberately or not.
    expect(html).not.toMatch(/stack|Error:|at Object|node_modules/);
  });

  it('a 404 offers a way out, and it is a place that exists', () => {
    const html = errorPage({ locale: 'ar', path: '/app/nope', kind: 'notfound' });
    expect(html).toContain('href="/app"');
    expect(html, 'never "go back" — going back is what produced this').not.toMatch(/history\.back|javascript:/);
  });

  it('a request that did not ask for HTML keeps the shape it had', () => {
    // `/hooks/*` and `/health` sit on the SAME instance as these handlers
    // (mountCommandCenter in main.ts). Meta's retries and the uptime probe must
    // not start receiving a web page, so both handlers negotiate on Accept.
    const src = read('src/api/web/app.ts');
    expect(src).toMatch(/wantsHtml[\s\S]{0,200}text\/html/);
    expect(src).toMatch(/setNotFoundHandler[\s\S]{0,400}if \(!wantsHtml\(req\)\)/);
    expect(src).toMatch(/setErrorHandler[\s\S]{0,700}if \(!wantsHtml\(req\)\)/);
  });

  it('a 4xx a route threw on purpose is still the framework\'s to answer', () => {
    const src = read('src/api/web/app.ts');
    expect(src, 'only a real fault becomes the page that says nothing')
      .toMatch(/const status = err\.statusCode \?\? 500;\s*\n\s*if \(status < 500\) return reply\.code\(status\)\.send\(err\);/);
  });
});

describe('the country list names each country once', () => {
  it('no two codes in the dropdown carry the same name, in any locale', () => {
    for (const locale of LOCALES) {
      const byName = new Map<string, string[]>();
      for (const c of countryOptions(locale)) {
        byName.set(c.name, [...(byName.get(c.name) ?? []), c.code]);
      }
      const doubled = [...byName].filter(([, codes]) => codes.length > 1);
      expect(doubled, `${locale}: ${doubled.map(([n, c]) => `${n} = ${c.join('+')}`).join(', ')}`).toEqual([]);
    }
  });

  it('the six that were doubled are gone, and the modern one stayed', () => {
    const superseded = { DY: 'BJ', HV: 'BF', NH: 'VU', RH: 'ZW', UK: 'GB', VD: 'VN' } as const;
    for (const [old, now] of Object.entries(superseded)) {
      expect(countryCodes(), `${old} was offered twice under one name`).not.toContain(old);
      expect(countryCodes(), `${now} is the code in force`).toContain(now);
    }
  });

  it('a workspace that already stored one is not orphaned', () => {
    // Nobody in production holds one today — but a stored value that stops
    // validating means a business cannot save its own profile page at all,
    // and the page would show no country selected where one was chosen.
    for (const old of ['DY', 'HV', 'NH', 'RH', 'UK', 'VD']) {
      expect(isCountryCode(old), `${old} is in the database; it must still read back`).toBe(true);
    }
    expect(canonicalCountry('UK')).toBe('GB');
    expect(canonicalCountry('MA'), 'a code in force is returned untouched').toBe('MA');
    expect(canonicalCountry('ZZ'), 'an unknown code is not this function\'s to judge').toBe('ZZ');
    expect(isCountryCode('ZZ'), 'and it is still not a country').toBe(false);
  });

  it('what is WRITTEN is always the code in force', () => {
    expect(read('src/core/owner/signup.ts')).toContain('country: canonicalCountry(country)');
    expect(read('src/api/web/businessKind.ts')).toMatch(/const stored = canonicalCountry\(country\)/);
    // …and the page preselects the successor, so her own country is shown.
    expect(read('src/api/web/businessKind.ts')).toMatch(/canonicalCountry\(v\.country\)/);
  });
});

describe('A1 · a notice no longer travels in the address bar', () => {
  it('nothing in the owner app builds a ?flash= URL any more', () => {
    for (const f of webFiles()) {
      const src = readFileSync(WEB + f, 'utf8');
      // Prose may still describe the old shape; a template that BUILDS one may
      // not. `flash=` alone, not `?flash=`: one site wrote the separator as a
      // template expression (`${…? `${back}&` : '?'}flash=`) and slipped a
      // narrower version of this test.
      const built = src.split('\n').filter((l) =>
        /[?&}]flash=|`flash=/.test(l) && !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'));
      expect(built, `${f} still puts a notice in a URL`).toEqual([]);
    }
  });

  it('a sentence a stranger writes is not spoken by the product', () => {
    expect(readFlash(SECRET, 'Your%20card%20was%20declined', 'en', NOW)).toBeNull();
    expect(readFlash(SECRET, undefined, 'en', NOW)).toBeNull();
    // Minted by someone else's installation: the signature is what refuses it.
    const theirs = mintFlash('a-different-installations-secret', [{ key: 'people.flash.added' }], NOW);
    expect(readFlash(SECRET, theirs, 'en', NOW)).toBeNull();
    // And a payload edited after signing.
    const mine = mintFlash(SECRET, [{ key: 'people.flash.added' }], NOW);
    expect(readFlash(SECRET, `x${mine}`, 'en', NOW)).toBeNull();
  });

  it('it is said in the language of the page being READ, not the one that posted', () => {
    const token = mintFlash(SECRET, [{ key: 'account.flash.changed' }], NOW);
    for (const locale of LOCALES) {
      expect(readFlash(SECRET, token, locale, NOW)?.text).toBe(t(locale, 'account.flash.changed'));
    }
    // Three different sentences, one token — which is the whole point.
    const said = new Set(LOCALES.map((l) => readFlash(SECRET, token, l, NOW)!.text));
    expect(said.size).toBe(LOCALES.length);
  });

  it('it does not outlive the journey it was minted for', () => {
    const token = mintFlash(SECRET, [{ key: 'people.flash.added' }], NOW);
    expect(readFlash(SECRET, token, 'en', NOW + FLASH_TTL_MS - 1)).not.toBeNull();
    expect(readFlash(SECRET, token, 'en', NOW + FLASH_TTL_MS + 1)).toBeNull();
  });

  it('a key this build no longer has shows nothing, never the key', () => {
    const gone = mintFlash(SECRET, [{ key: 'people.flash.gone.for.good' as MessageKey }], NOW);
    expect(readFlash(SECRET, gone, 'en', NOW)).toBeNull();
  });

  it('what a page is handed is a value, not words it has to trust', () => {
    // Every renderer takes `Flash | null` now, so a route cannot hand a page a
    // string it built from a query parameter — the types refuse it.
    for (const f of webFiles()) {
      const src = readFileSync(WEB + f, 'utf8');
      expect(src.includes('flash: string | null'), `${f} still takes a notice as text`).toBe(false);
    }
  });

  it('a notice made of several sentences joins them and travels as keys', () => {
    const token = mintFlash(SECRET, [
      { key: 'product.flash.updated', params: { n: 1 } },
      { key: 'product.flash.alreadyHere', params: { n: 2 } },
    ], NOW);
    const f = readFlash(SECRET, token, 'en', NOW)!;
    expect(f.text).toBe(`${t('en', 'product.flash.updated', { n: 1 })} ${t('en', 'product.flash.alreadyHere', { n: 2 })}`);
  });
});

describe('D5 · a refusal stops looking like good news', () => {
  it('every flash sentence has been classified, exactly once', () => {
    const flashKeys = Object.keys(messages.en).filter((k) => k.includes('.flash.'));
    expect(flashKeys.length, 'sanity: the catalogue still has flash sentences').toBeGreaterThan(150);
    for (const k of flashKeys) {
      const inRefusals = FLASH_REFUSALS.has(k);
      const inConfirmations = FLASH_CONFIRMATIONS.has(k);
      expect(inRefusals || inConfirmations, `${k} has no tone — decide how it looks`).toBe(true);
      expect(inRefusals && inConfirmations, `${k} is in both lists`).toBe(false);
    }
  });

  it('neither list names a sentence that no longer exists', () => {
    for (const k of [...FLASH_REFUSALS, ...FLASH_CONFIRMATIONS]) {
      expect(k in messages.en, `${k} is classified but is not in the catalogue`).toBe(true);
    }
  });

  it('the ones the audit named arrive as refusals', () => {
    for (const k of ['staff.notAllowed', 'allowlist.flash.invalid', 'account.flash.wrong',
      'takeover.flash.must_take_over', 'seq.flash.notApproved', 'inbox.flash.sentNotLive'] as MessageKey[]) {
      expect(flashTone(k), `${k} is a refusal`).toBe('bad');
    }
    for (const k of ['account.flash.changed', 'inbox.flash.sent', 'people.flash.added',
      'prices.flash.unchanged'] as MessageKey[]) {
      expect(flashTone(k), `${k} happened`).toBe('ok');
    }
  });

  it('a sentence nobody classified is drawn as a refusal, not as success', () => {
    // `activation.blocker.*` and `refused.why.*` reach a notice from outside
    // the flash family and are all refusals; so is the next one somebody adds.
    expect(flashTone('activation.blocker.no_products' as MessageKey)).toBe('bad');
    expect(flashTone('nav.home')).toBe('bad');
  });

  it('the two tones are told apart by more than colour', () => {
    const good = flashBanner({ text: 'Sent.', bad: false });
    const bad = flashBanner({ text: 'Only the owner can do that.', bad: true });
    expect(good).toContain('class="flash"');
    expect(bad).toContain('class="flash bad"');
    // A refusal interrupts; a confirmation does not.
    expect(good).toContain('role="status"');
    expect(bad).toContain('role="alert"');
    expect(flashBanner(null)).toBe('');
  });

  it('the banner is drawn in ONE place, so no page can paint its own', () => {
    for (const f of webFiles()) {
      if (f === 'flash.ts') continue;
      const src = readFileSync(WEB + f, 'utf8');
      expect(src.includes('class="flash"'), `${f} draws its own notice`).toBe(false);
    }
  });

  it('a notice rendered without a redirect gets the same tone', () => {
    expect(saidFlash('en', 'contacts.flash.empty').bad).toBe(true);
    expect(saidFlash('en', 'contacts.flash.queued').bad).toBe(false);
    const withParams = saidFlash('zh', 'closures.flash.added', { label: '春节' });
    expect(withParams.text).toContain('春节');
  });

  it('the warning tone is a token, never a literal colour', () => {
    const style = read('src/api/web/layout.ts');
    const rule = /\.flash\.bad \{([^}]*)\}/.exec(style)?.[1] ?? '';
    expect(rule, 'the .flash.bad rule is in the stylesheet').not.toBe('');
    expect(rule).toContain('var(--color-warn');
    expect(rule, 'no hex, no rgb — tokens only').not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
  });
});

describe('the sentences themselves', () => {
  it('the error pages say something in every locale, and nothing empty', () => {
    const keys: MessageKey[] = ['error.notfound.title', 'error.notfound.body',
      'error.crash.title', 'error.crash.body', 'error.reference', 'error.home'];
    for (const locale of LOCALES as readonly Locale[]) {
      for (const k of keys) {
        expect(messages[locale][k], `${locale} is missing ${k}`).toBeTruthy();
        expect(t(locale, k), `${locale}/${k} fell back to English`).toBe(messages[locale][k]);
      }
    }
  });

  it('the reference is shown, not described', () => {
    expect(messages.en['error.reference']).toContain('{ref}');
    expect(messages.zh['error.reference']).toContain('{ref}');
    expect(messages.ar['error.reference']).toContain('{ref}');
  });
});
