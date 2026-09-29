import { describe, it, expect } from 'vitest';
import { renderPeople, namedLikeBusiness, type TeamMember } from '../../src/api/web/people.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t, messages, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { OWNER_ONLY } from '../../src/core/conversation/people.js';
import { esc } from '../../src/api/web/layout.js';

/**
 * The design pass, People (UI-PASS 5 and 8): pills only for states — "online
 * now" — and who someone IS said in plain words; a person called by the
 * business's name is asked for their own. The route that saves it:
 * tests/integration/people.test.ts.
 */

const NOW = new Date('2026-09-30T08:00:00Z');
const owner: TeamMember = { id: 'p-owner', name: 'Westlake Canvas Co.', isOwner: true, addedAt: NOW, signsInWithEmail: true, lastSeenAt: NOW };
const chen: TeamMember = { id: 'p-chen', name: 'Xiao Chen', isOwner: false, addedAt: NOW, signsInWithEmail: false, lastSeenAt: null };
const view = (people: readonly TeamMember[], business: string | null = 'Westlake Canvas Co.') =>
  ({ people, justIssued: null, business });

describe('People: pills for states, words for who someone is', () => {
  it('"You" is plain text; "online now" is the only pill', () => {
    for (const l of LOCALES) {
      const html = renderPeople(view([{ ...owner, name: 'Mrs Wang' }, chen]), l, null, NOW);
      expect(html, l).toContain(`<span class="muted">· ${esc(t(l, 'people.owner'))}</span>`);
      expect(html, l).not.toContain(`<span class="pill ok">${esc(t(l, 'people.owner'))}</span>`);
      const pills = [...html.matchAll(/<span class="pill[^"]*">([^<]*)<\/span>/g)].map((m) => m[1]);
      expect(pills, l).toEqual([esc(t(l, 'people.online'))]);
    }
  });
});

describe('a person called by the business\'s name is asked for their own', () => {
  it('the owner named after the business: asked, with a form that posts the name', () => {
    for (const l of LOCALES) {
      const html = renderPeople(view([owner, chen]), l, null, NOW);
      expect(html, l).toContain('action="/app/settings/people/p-owner/name"');
      expect(html, l).toContain(esc(t(l, 'people.name.askYou')));
      expect(html, l).not.toContain('action="/app/settings/people/p-chen/name"');
    }
  });

  it('a colleague given the business\'s name is asked about in the third person', () => {
    const html = renderPeople(view([{ ...owner, name: 'Mrs Wang' }, { ...chen, name: 'westlake  canvas co.' }]), 'en', null, NOW);
    expect(html).toContain('action="/app/settings/people/p-chen/name"');
    expect(html).toContain(esc(t('en', 'people.name.askThem')));
    expect(html).not.toContain('action="/app/settings/people/p-owner/name"');
  });

  it('nobody is asked when the names differ, or the business has none', () => {
    expect(renderPeople(view([{ ...owner, name: 'Mrs Wang' }, chen]), 'en', null, NOW)).not.toContain('/name"');
    expect(renderPeople(view([owner, chen], null), 'en', null, NOW)).not.toContain('/name"');
  });

  it('the same name means the same words: case, width and spacing aside', () => {
    expect(namedLikeBusiness('WESTLAKE canvas co.', 'Westlake Canvas Co.')).toBe(true);
    expect(namedLikeBusiness('  义乌宏发日用品厂 ', '义乌宏发日用品厂')).toBe(true);
    expect(namedLikeBusiness('Ｗｅｓｔｌａｋｅ', 'Westlake')).toBe(true);   // full-width letters
    expect(namedLikeBusiness('Westlake Canvas', 'Westlake Canvas Co.')).toBe(false);
    expect(namedLikeBusiness('Owner', '')).toBe(false);
  });
});

describe('"Only you can do these" names every one of them', () => {
  it('each owner-only act has its line in every language — the page printed a raw key for data_rights (found 2026-09-30)', () => {
    for (const l of LOCALES) {
      for (const a of OWNER_ONLY) expect(messages[l][`people.ownerOnly.${a}` as MessageKey], `${l} ${a}`).toBeTruthy();
      expect(renderPeople(view([{ ...owner, name: 'Mrs Wang' }]), l, null, NOW), l).not.toMatch(/people\.ownerOnly\./);
    }
  });
});
