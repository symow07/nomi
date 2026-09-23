import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  guardForbidden, effectiveForbidden, findForbidden, FORBIDDEN_FLOOR,
} from '../../src/core/safety/forbiddenWords.js';
import { renderForbidden, type ForbiddenView } from '../../src/api/web/settings.js';
import { BANNED_OWNER_TERMS } from '../../src/core/owner/vocabulary.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, type MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * M37.5 — the words she may never say.
 *
 * `claims_policy` governs what may be CLAIMED; this governs what may be SAID.
 * The tests that matter are the floor (she cannot switch off "do not insult a
 * buyer") and the separation from BANNED_OWNER_TERMS, which is a different list
 * for a different audience and will be conflated by whoever touches this next.
 */

describe('M37.5 · the floor cannot be removed', () => {
  it('applies even when the owner has added nothing', () => {
    const r = guardForbidden({ reply: 'You are an idiot.', ownerTerms: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.terms.some((x) => x.source === 'floor')).toBe(true);
  });

  it('an owner who types a floor word into her own list does not take it over', () => {
    // There is no ordering by which her row can shadow the floor and then be
    // deleted to disable it.
    const eff = effectiveForbidden(['idiot']);
    const idiot = eff.filter((x) => x.term.toLowerCase() === 'idiot');
    expect(idiot).toHaveLength(1);
    expect(idiot[0]!.source).toBe('owner');
    // and removing it from her list leaves the floor's copy in force
    expect(findForbidden('you idiot', effectiveForbidden([])).length).toBeGreaterThan(0);
  });

  it('the floor covers all three of the product’s languages', () => {
    for (const reply of ['You are stupid', '你个傻逼', 'أنت غبي']) {
      expect(guardForbidden({ reply, ownerTerms: [] }).ok, reply).toBe(false);
    }
  });

  it('there is no code path that empties the floor', async () => {
    const src = await readFile(new URL('../../src/core/safety/forbiddenWords.ts', import.meta.url), 'utf8');
    // The floor is a const in core, never read from a row, so no tenant edit
    // can reach it. Asserted structurally because that is the guarantee.
    expect(src).toMatch(/export const FORBIDDEN_FLOOR: readonly string\[\]/);
    expect(FORBIDDEN_FLOOR.length).toBeGreaterThan(5);
    expect(effectiveForbidden([]).filter((x) => x.source === 'floor').length)
      .toBe(FORBIDDEN_FLOOR.length);
  });
});

describe('M37.5 · her own terms, in whatever language she typed them', () => {
  it('blocks a term she added', () => {
    const r = guardForbidden({ reply: 'We are cheaper than Guangzhou Textile.', ownerTerms: ['Guangzhou Textile'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.terms[0]!.term).toBe('Guangzhou Textile');
  });

  it('matches case-insensitively and inside a longer word', () => {
    // A false positive costs one regeneration; a false negative is an insult
    // delivered in writing. The asymmetry is why matching is blunt.
    expect(guardForbidden({ reply: 'FUCKING late', ownerTerms: [] }).ok).toBe(false);
    expect(guardForbidden({ reply: '他傻逼的很', ownerTerms: [] }).ok).toBe(false);
  });

  it('works with no word boundaries — Chinese does not delimit words with spaces', () => {
    expect(guardForbidden({ reply: '这个价格不含税', ownerTerms: ['不含税'] }).ok).toBe(false);
  });

  it('a clean reply passes untouched', () => {
    const r = guardForbidden({ reply: 'For 20,000 pcs the unit price is $0.38.', ownerTerms: ['discount'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('For 20,000 pcs the unit price is $0.38.');
  });

  it('ignores blank and duplicate entries rather than matching everything', () => {
    // An empty term would substring-match every reply ever written.
    const eff = effectiveForbidden(['', '   ', 'spam', 'SPAM']);
    expect(eff.filter((x) => x.source === 'owner').map((x) => x.term)).toEqual(['spam']);
    expect(guardForbidden({ reply: 'anything at all', ownerTerms: ['', '  '] }).ok).toBe(true);
  });
});

describe('M37.5 · it is NOT BANNED_OWNER_TERMS', () => {
  /**
   * The two will be conflated by whoever touches this next: both are "lists of
   * words we do not say". They are not the same thing.
   *
   *   BANNED_OWNER_TERMS — what the PRODUCT shows the OWNER. Global, in code,
   *     enforced over the i18n catalogue. "model", "confidence", "系统".
   *   FORBIDDEN_FLOOR + rows — what SHE says to a BUYER. Per-tenant, free text,
   *     enforced at reply time.
   */
  it('the two lists share no contents', () => {
    const owner = new Set(BANNED_OWNER_TERMS.map((x) => x.toLowerCase()));
    const overlap = FORBIDDEN_FLOOR.filter((x) => owner.has(x.toLowerCase()));
    expect(overlap, `these appear in both lists: ${overlap.join(', ')}`).toEqual([]);
  });

  it('a banned OWNER term is not forbidden to say to a buyer', () => {
    // "model" is software talk to the owner; to a buyer it is a product model.
    expect(guardForbidden({ reply: 'This model ships in 25 days.', ownerTerms: [] }).ok).toBe(true);
  });

  it('the module says so, because the comment is the only thing that will stop it', async () => {
    const src = await readFile(new URL('../../src/core/safety/forbiddenWords.ts', import.meta.url), 'utf8');
    expect(src).toContain('THIS IS NOT `BANNED_OWNER_TERMS`');
  });
});

describe('M37.5 · the guard is reached by the production reply path', () => {
  /**
   * BOTH call sites, asserted DISTINCTLY.
   *
   * The first version of these two checked for the same expression string,
   * which appears in both paths — so deleting one left the other and the
   * mutation passed. A check that cannot tell its two subjects apart is the
   * "pointed at the wrong artifact" defect in miniature; caught by running the
   * mutation rather than trusting the assertion.
   */
  it('the GENERATED-reply loop guards, and binds the result it then uses', async () => {
    const src = await readFile(new URL('../../src/pipeline/turn.ts', import.meta.url), 'utf8');
    expect(src).toContain('const clean = guardForbidden({');
    expect(src).toMatch(/if \(!clean\.ok\) \{[\s\S]{0,120}forbiddenHits = clean\.error\.terms/);
    expect(src).toContain('reply = clean.value;');
    expect(src).toContain('const forbiddenTerms = await tenant.catalog.forbiddenTerms()');
  });

  it('the TAUGHT-answer path guards too — she may have forbidden her own words', async () => {
    const src = await readFile(new URL('../../src/pipeline/turn.ts', import.meta.url), 'utf8');
    expect(src).toContain('const wordSafe = claimed.ok');
    expect(src).toContain('guardForbidden({ reply: claimed.value, ownerTerms: forbiddenTerms })');
    // and the numeral guard must consume the WORD-guarded text, not the raw one
    expect(src).toContain('const guarded = wordSafe.ok');
  });

  it('the owner is told WHICH term stopped it', async () => {
    const src = await readFile(new URL('../../src/pipeline/turn.ts', import.meta.url), 'utf8');
    expect(src).toContain('forbidden: r.forbiddenHits.map');
  });
});

describe('M37.5 · the owner surface', () => {
  const view: ForbiddenView = {
    own: [{ id: 'a1b2', term: 'Guangzhou Textile' }],
    floor: [...FORBIDDEN_FLOOR],
  };

  it('shows her list, and the floor she cannot switch off', () => {
    const html = renderForbidden(view, 'en', null);
    expect(html).toContain('Guangzhou Textile');
    expect(html).toContain('Always enforced');
    // The floor is rendered, not hidden: a guarantee she cannot see is one she
    // cannot rely on.
    expect(html).toContain(FORBIDDEN_FLOOR[0]!);
  });

  it('offers add and remove, and no way to remove a floor term', () => {
    const html = renderForbidden(view, 'en', null);
    expect(html).toContain('action="/app/settings/forbidden"');
    expect(html).toContain('/app/settings/forbidden/a1b2/remove');
    // The floor list carries no form at all.
    const floorBlock = html.slice(html.indexOf('Always enforced'));
    expect(floorBlock).not.toContain('<form');
  });

  it('is reachable from the assistant\'s page (D), and registered as a route', async () => {
    const settings = await readFile(new URL('../../src/api/web/employee.ts', import.meta.url), 'utf8');
    expect(settings).toContain("deeper('/app/settings/forbidden'");
    const app = await readFile(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    expect(app).toContain("app.get('/app/settings/forbidden'");
    expect(app).toContain("app.post('/app/settings/forbidden'");
    expect(app).toContain("app.post('/app/settings/forbidden/:id/remove'");
  });

  it('empty state names the next action, in every locale', () => {
    for (const locale of LOCALES) {
      const html = renderForbidden({ own: [], floor: [...FORBIDDEN_FLOOR] }, locale, null);
      const visible = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
      expect(visible).toContain(t(locale, 'forbidden.empty'));
      expect(visible).toContain(t(locale, 'forbidden.add.button'));
      expect(visible.toLowerCase()).not.toContain('no data');
    }
  });

  it('every string exists in all three locales', () => {
    const KEYS: MessageKey[] = [
      'forbidden.title', 'forbidden.intro', 'forbidden.add.label', 'forbidden.add.placeholder',
      'forbidden.add.button', 'forbidden.remove', 'forbidden.empty', 'forbidden.floor.title',
      'forbidden.floor.body', 'forbidden.flash.added', 'forbidden.flash.removed',
      'forbidden.flash.duplicate', 'forbidden.flash.empty', 'forbidden.flash.failed',
    ];
    for (const locale of LOCALES) {
      for (const k of KEYS) {
        const s = t(locale, k, { name: '小雅' });
        expect(s.length, `${locale} ${k}`).toBeGreaterThan(1);
        expect(s, `${locale} ${k}`).not.toContain('{');
      }
    }
  });
});
