import { describe, it, expect } from 'vitest';
import { renderPeople, type PeopleView, type TeamMember } from '../../src/api/web/people.js';
import { SETTINGS_AREA_CSS } from '../../src/api/web/settingsAreaStyle.js';
import { LOCALES, type Locale } from '../../src/core/owner/i18n/locale.js';
import { t, withWorkspace } from '../../src/api/web/say.js';
import { esc } from '../../src/api/web/layout.js';
import type { MessageKey } from '../../src/core/owner/i18n/messages.js';
import { OWNER_ONLY } from '../../src/core/conversation/people.js';

/**
 * UI Block 7 · F36 — Team, as RULE 104 (the settings overhaul, 2026-11-27) draws it. The people are still a concise
 * table (name, role, how they sign in, when last here), now with each person's place in the turn in their own row:
 * "in turn" a switch that acts at once, "away until" a date that waits for the page's ONE Save. Remove left the
 * per-person editor for the page's danger zone: still secondary, naming whom it removes and what follows, with the
 * same route and the same confirmation. Adding someone is a section of its own with its own button; the role is a
 * choice with its label beside its control. Roles and what each may do are ONE table to read.
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

const people = (html: string) => html.slice(html.indexOf('<section class="set-sec" id="people">'), html.indexOf('<section class="set-sec" id="turn">'));
const SAVE_ACTS = (l: Locale) => `<div class="set-save"><button class="btn send" type="submit">${esc(t(l, 'autonomy.save'))}</button><button class="btn" type="reset">${esc(t(l, 'common.cancel'))}</button></div>`;

describe('F36 · a concise member table; removing someone is in the danger zone', () => {
  it('a table with its column headings and one row per person, the name as the row heading, in every language', () => {
    for (const l of LOCALES) {
      const html = people(draw(l));
      expect(html, l).toContain('<table class="team-table">');
      for (const k of ['team.col.name', 'team.col.role', 'team.col.signIn', 'team.col.here', 'turn.inTurn', 'turn.away'] as MessageKey[]) {
        expect(html, `${l} ${k}`).toContain(`<th scope="col">${esc(t(l, k))}</th>`);
      }
      expect(html.match(/<tr class="tm">/g)?.length, l).toBe(3);
      expect(html.match(/<th scope="row">/g)?.length, l).toBe(3);
      for (const k of ['team.role.owner', 'team.role.team', 'people.kind.accountant'] as MessageKey[]) expect(html, `${l} ${k}`).toContain(esc(t(l, k)));
      // a role is chosen when someone is added, and stays: said under the table, not offered as a control
      expect(html, l).toContain(esc(t(l, 'ws.team.roleStays')));
    }
  });
  it('Remove is a row of the danger zone, the LAST section; it names them; the confirmation and route are as before', () => {
    for (const l of LOCALES) {
      const html = draw(l);
      const zone = html.slice(html.indexOf('<section class="set-sec" id="danger-zone">'));
      expect(html.indexOf('id="danger-zone"'), l).toBeGreaterThan(html.indexOf('id="roles"'));
      for (const p of [sam, dana]) {
        expect(zone, `${l} ${p.name}`).toContain(`<div class="set-danger-row" id="remove-${p.id}"><div class="fr-l"><span class="fr-name">${esc(t(l, 'team.remove.button', { who: p.name }))}</span><span class="fr-desc">${esc(t(l, 'team.remove.what'))}</span></div>`);
        expect(zone, `${l} ${p.name}`).toContain(`<form method="post" action="/app/settings/people/${p.id}/remove" class="set-act"><button class="btn danger" type="submit" onclick="return confirm(this.dataset.confirm)" data-confirm="${esc(t(l, 'people.remove.confirm', { who: p.name }))}">`);
      }
      expect(html, l).not.toContain('/app/settings/people/p-o/remove');
      // nothing removes from inside the table, and no per-person editor is left to open
      expect(people(html), l).not.toContain('/remove"');
      expect(html, l).not.toContain('<details class="team-edit"');
    }
    // A person called by the business's name is asked for their own: a field of the page's one Save.
    const asked = draw('en', { ...view, people: [{ ...owner, name: 'Juniper Skin' }, sam] });
    expect(asked).toContain(`<h2 class="set-h">${esc(t('en', 'people.name.yours'))}</h2>`);
    expect(asked).toContain('<input id="pp-name-p-o" name="name_p-o" maxlength="60" />');
  });
  it('Remove is secondary: the only filled act on the page is its one Save', () => {
    const html = draw('en');
    expect([...html.matchAll(/<button class="btn send"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual([t('en', 'autonomy.save')]);
    expect(html.match(/data-save/g)?.length).toBe(1);
    expect(html).toContain(`${SAVE_ACTS('en')}</form>`);
  });
});

describe('F36 · adding someone is a task of its own; the role is a choice beside its label', () => {
  it('a section headed "Add someone to the team", its own form with its own button; the code is shown once and nothing sends it', () => {
    for (const l of LOCALES) {
      const html = draw(l);
      const add = html.slice(html.indexOf('<section class="set-sec" id="add">'), html.indexOf('<section class="set-sec" id="people">'));
      expect(add, l).toContain(`<h2 class="set-h">${esc(t(l, 'people.add.title'))}</h2>`);
      expect(add, l).toContain(`<p class="set-note"><span>${esc(t(l, 'people.add.hint'))}</span></p>`);
      expect(add, l).toContain('<form method="post" action="/app/settings/people" class="sform">');
      expect(add, l).toContain(`<button class="btn" type="submit">${esc(t(l, 'people.add.button'))}</button>`);
      expect(add, l).not.toContain('data-save');
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

describe('F36 · roles are one table to read; a person\'s place in the turn is in their own row', () => {
  it('the roles table holds every owner-only ability, the team member and — where the books are on — the accountant', () => {
    for (const l of LOCALES) {
      const html = draw(l);
      const roles = html.slice(html.indexOf('<section class="set-sec" id="roles">'), html.indexOf('id="danger-zone"'));
      expect(roles, l).toContain(`<h2 class="set-h">${esc(t(l, 'team.roles.title'))}</h2>`);
      expect(roles.match(/<table\b/g)?.length, l).toBe(1);
      for (const k of ['ws.team.can.col', 'team.role.owner', 'team.role.team', 'people.kind.accountant'] as MessageKey[]) expect(roles, `${l} ${k}`).toContain(`<th scope="col">${esc(t(l, k))}</th>`);
      for (const a of OWNER_ONLY) {
        const row = new RegExp(`<tr class="tm"><th scope="row">${esc(t(l, `people.ownerOnly.${a}` as MessageKey)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</th>([\\s\\S]*?)</tr>`).exec(roles)?.[1] ?? '';
        // the owner: yes; the team member and the accountant: no
        expect([...row.matchAll(/<span(?: class="muted")?>([^<]+)<\/span><\/td>/g)].map((m) => m[1]), `${l} ${a}`)
          .toEqual([esc(t(l, 'ws.team.yes')), esc(t(l, 'ws.team.no')), esc(t(l, 'ws.team.no'))]);
      }
      // the accountant: the books and nothing else, and never a conversation in turn
      expect(roles, l).toContain(esc(t(l, 'team.role.accountantWhat')));
      expect(roles, l).toContain(esc(t(l, 'ws.team.never')));
      // no control in it: it is read, not set
      expect(roles, l).not.toMatch(/<(form|input|button|select)\b/);
      // without the books there is no accountant column
      expect(draw(l, view, false), l).not.toContain(`<th scope="col">${esc(t(l, 'people.kind.accountant'))}</th>`);
    }
  });
  it('each turn control is named for its person; the accountant is never offered one', () => {
    const html = draw('en');
    expect(html).toContain('<form method="post" action="/app/settings/people/p-s/in-turn" class="set-act"><input type="hidden" name="on" value="1" /><button class="set-switch" type="submit" role="switch" aria-checked="false" aria-label="In turn: Sam Rivera">');
    expect(html).toContain('<input id="tt-away-p-s" type="date" form="team-save" name="away_p-s" value="" aria-label="Away until: Sam Rivera" />');
    expect(html).not.toContain('/app/settings/people/p-d/in-turn');
    expect(html).not.toContain('name="away_p-d"');
    // the workspace's own switch, in its section, sent at once
    const turn = html.slice(html.indexOf('<section class="set-sec" id="turn">'));
    expect(turn).toContain('<form method="post" action="/app/settings/people/turn" class="set-act"><input type="hidden" name="on" value="1" /><button class="set-switch" type="submit" role="switch" aria-checked="false"');
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
