import { describe, it, expect } from 'vitest';
import { renderPeople, type PeopleView, type TeamMember } from '../../src/api/web/people.js';
import { SETTINGS_AREA_CSS } from '../../src/api/web/settingsAreaStyle.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, withWorkspace } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import type { MessageKey } from '../../src/core/owner/i18n/messages.js';

/**
 * UI Block 7 · F36 — Team. The people are a concise table (name, role, how they sign in, when last here); each one
 * else has a deliberate editor under their row, closed, and Remove lives in it: secondary, naming whom it removes and
 * what follows, with the same route and the same confirmation. Adding someone is a task of its own, opened when
 * wanted; the role is a choice with its label beside its control. Roles and what each may do are one section;
 * availability (hand-offs in turn) another, its labels each on their own control, apart.
 */

const NOW = new Date('2026-11-24T09:00:00Z');
const owner: TeamMember = { id: 'p-o', name: 'Mei Lin', isOwner: true, kind: 'team', addedAt: NOW, signsInWithEmail: true, lastSeenAt: NOW };
const sam: TeamMember = { id: 'p-s', name: 'Sam Rivera', isOwner: false, kind: 'team', addedAt: NOW, signsInWithEmail: false, lastSeenAt: null };
const dana: TeamMember = { id: 'p-d', name: 'Dana Whitfield', isOwner: false, kind: 'accountant', addedAt: NOW, signsInWithEmail: false, lastSeenAt: null };
const view: PeopleView = {
  people: [owner, sam, dana], justIssued: null, business: 'Juniper Skin',
  rotation: { on: false, people: [
    { id: 'p-o', name: 'Mei Lin', inRotation: true, awayUntil: null, lastGivenAt: null, accountant: false },
    { id: 'p-s', name: 'Sam Rivera', inRotation: false, awayUntil: null, lastGivenAt: null, accountant: false },
    { id: 'p-d', name: 'Dana Whitfield', inRotation: false, awayUntil: null, lastGivenAt: null, accountant: true }] },
};
const SCOPE = { name: null, several: false, outreach: false, setup: null, business: 'Juniper Skin' };
const draw = (l: Locale, v: PeopleView = view, books = true) => withWorkspace({ ...SCOPE, books }, () => renderPeople(v, l, null, NOW));
const named = (l: Locale, k: MessageKey, who: string) => esc(t(l, k, { who: '\u0001' })).replace('\u0001', `<bdi>${esc(who)}</bdi>`);

describe('F36 · a concise member table, and a deliberate editor per person', () => {
  it('a table with its four column headings and one row per person, the name as the row heading, in every language', () => {
    for (const l of LOCALES) {
      const html = draw(l);
      expect(html, l).toContain('<table class="team-table">');
      for (const k of ['team.col.name', 'team.col.role', 'team.col.signIn', 'team.col.here'] as MessageKey[]) {
        expect(html, `${l} ${k}`).toContain(`<th scope="col">${esc(t(l, k))}</th>`);
      }
      expect(html.match(/<tr class="tm">/g)?.length, l).toBe(3);
      expect(html.match(/<th scope="row">/g)?.length, l).toBe(3);
      for (const k of ['team.role.owner', 'team.role.team', 'people.kind.accountant'] as MessageKey[]) expect(html, `${l} ${k}`).toContain(esc(t(l, k)));
    }
  });
  it('Remove is in the person\'s own editor, closed, after their row; it names them; the confirmation and route are as before', () => {
    for (const l of LOCALES) {
      const html = draw(l);
      for (const p of [sam, dana]) {
        const row = html.indexOf(`<bdi>${p.name}</bdi>`);
        const fold = html.indexOf('<details class="team-edit">', row);
        const form = html.indexOf(`action="/app/settings/people/${p.id}/remove"`);
        expect(fold, `${l} ${p.name}`).toBeGreaterThan(row);
        expect(form, `${l} ${p.name}`).toBeGreaterThan(fold);
        expect(html, l).toContain(`<summary><span>${named(l, 'team.edit.open', p.name)}</span></summary>`);
        expect(html, l).toContain(`data-confirm="${esc(t(l, 'people.remove.confirm', { who: p.name }))}">${named(l, 'team.remove.button', p.name)}</button>`);
      }
      expect(html, l).toContain('onclick="return confirm(this.dataset.confirm)"');
      expect(html, l).toContain(esc(t(l, 'team.remove.what')));
      expect(html, l).not.toContain('/app/settings/people/p-o/remove');
      // The owner has no editor unless a name is asked for — and then it is open.
      expect(html.match(/<details class="team-edit"/g)?.length, l).toBe(2);
    }
    const asked = draw('en', { ...view, people: [{ ...owner, name: 'Juniper Skin' }, sam] });
    expect(asked).toContain(`<details class="team-edit" open>\n        <summary><span>${esc(t('en', 'people.name.yours'))}</span></summary>`);
    expect(asked).toContain('action="/app/settings/people/p-o/name"');
  });
  it('Remove is secondary: the only filled act on the page is adding someone', () => {
    const html = draw('en');
    expect([...html.matchAll(/<button class="btn send"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual([t('en', 'people.add.button')]);
    expect(SETTINGS_AREA_CSS).toContain('.settings-area .tm-remove .btn,.settings-area .team-avail .btn{background:transparent;');
  });
});

describe('F36 · adding someone is a task of its own; the role is a choice beside its label', () => {
  it('a fold headed "Add someone to the team", closed while others are here, open while the owner is alone', () => {
    for (const l of LOCALES) {
      expect(draw(l), l).toContain(`<details class="sa-subject team-add"><summary><h2>${esc(t(l, 'people.add.title'))}</h2></summary>`);
      expect(draw(l, { ...view, people: [owner] }), l).toContain('<details class="sa-subject team-add" open>');
    }
  });
  it('where the books are on, the role is two choices with their labels attached, a team member by default; the route reads the same field', () => {
    for (const l of LOCALES) {
      const html = draw(l);
      expect(html, l).toContain(`<label class="tm-choice" for="pp-add-team"><input id="pp-add-team" type="radio" name="accountant" value="off" checked /> <span>${esc(t(l, 'team.add.asTeam'))}</span></label>`);
      expect(html, l).toContain(`<label class="tm-choice" for="pp-add-accountant"><input id="pp-add-accountant" type="radio" name="accountant" value="on" /> <span>${esc(t(l, 'people.add.accountant'))}</span></label>`);
    }
    // A6 kept: no books, no accountant to choose.
    expect(draw('en', view, false)).not.toContain('name="accountant"');
  });
});

describe('F36 · roles apart from availability; availability\'s labels on their own controls', () => {
  it('the roles section holds what only the owner may do; availability is its own section after it', () => {
    for (const l of LOCALES) {
      const html = draw(l);
      const roles = html.indexOf('id="roles"'); const turn = html.indexOf('id="turn"');
      expect(roles, l).toBeGreaterThan(-1);
      expect(turn, l).toBeGreaterThan(roles);
      expect(html.slice(roles, turn), l).toContain('<ul class="owner-only">');
      expect(html.slice(roles, turn), l).toContain(`<h2>${esc(t(l, 'team.roles.title'))}</h2>`);
      expect(html.slice(turn), l).toContain(`<h2>${esc(t(l, 'team.avail.title'))}</h2>`);
      expect(html.slice(turn), l).not.toContain('owner-only');
    }
  });
  it('each turn control has its own label by id, and each Save names whose place it saves', () => {
    const html = draw('en');
    expect(html).toContain('<label class="chkbox turn-in" for="tt-in-p-s"><input id="tt-in-p-s" type="checkbox" name="inTurn" value="1" />');
    expect(html).toContain('<label class="caption" for="tt-away-p-s">Away until</label><input id="tt-away-p-s" type="date" name="awayUntil" value="" />');
    expect(html).toContain('Save<span class="sa-vh"> <bdi>Sam Rivera</bdi></span></button>');
    expect(html).not.toContain('/app/settings/people/p-d/turn');
    expect(SETTINGS_AREA_CSS).toContain('.team-avail .turn{display:flex;flex-wrap:wrap;align-items:flex-end;gap:var(--space-12) var(--space-24);');
  });
  it('the table stacks on a phone, each value with its column\'s name', () => {
    expect(SETTINGS_AREA_CSS).toMatch(/@media\(max-width:600px\)\{\.team-table thead\{[^}]*\}\.team-table,\.team-table tbody,\.team-table tr,\.team-table th,\.team-table td\{display:block;\}/);
    expect(draw('en')).toContain(`<td><span class="tm-k" aria-hidden="true">${esc(t('en', 'team.col.role'))}</span>`);
  });
  it('every new line is its own language in zh, ar, es and fr', () => {
    const keys = ['team.col.name', 'team.col.role', 'team.col.signIn', 'team.col.here', 'team.role.owner', 'team.role.team',
      'team.role.accountantWhat', 'team.roles.title', 'team.avail.title', 'team.edit.open', 'team.edit.role', 'team.remove.what',
      'team.remove.button', 'team.add.asTeam'] as MessageKey[];
    for (const k of keys) for (const l of LOCALES) if (l !== 'en') expect(t(l, k), `${l} ${k}`).not.toBe(t('en', k));
  });
});
