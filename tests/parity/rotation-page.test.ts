import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderPeople, type PeopleView, type TeamMember } from '../../src/api/web/people.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';

/**
 * S3 (Phase 5, item 21) — hand-offs in turn on the team page (the owner's: `people`), and the one place the worker
 * gives a hand-off in turn: after it commits, before its alert, never for a deletion request.
 */
const NOW = new Date('2026-10-22T09:00:00Z');
const person = (id: string, name: string, o: Partial<{ isOwner: boolean; kind: 'team' | 'accountant' }> = {}): TeamMember => ({
  id, name, isOwner: o.isOwner ?? false, kind: o.kind ?? 'team', addedAt: NOW, lastSeenAt: null, signsInWithEmail: false,
});

describe('S3 · the turn on the team page', () => {
  const view: PeopleView = {
    people: [person('o', 'Symow', { isOwner: true }), person('a', 'Amina'), person('b', 'Books', { kind: 'accountant' })], justIssued: null,
    rotation: { on: true, people: [
      { id: 'o', name: 'Symow', inRotation: false, awayUntil: null, lastGivenAt: null, accountant: false },
      { id: 'a', name: 'Amina', inRotation: true, awayUntil: new Date('2026-10-25T00:00:00Z'), lastGivenAt: new Date('2026-10-22T08:00:00Z'), accountant: false },
      { id: 'b', name: 'Books', inRotation: false, awayUntil: null, lastGivenAt: null, accountant: true }] },
  };
  it('in every language: the switch, each person in turn or not and away until a day; the accountant never offered', () => {
    for (const l of LOCALES) {
      const html = renderPeople(view, l, null, NOW);
      const turn = html.slice(html.indexOf('id="turn"'));
      expect(turn, l).toContain('action="/app/settings/people/turn"');
      // Rule 104 — "in turn" is a switch in the person's row, sent at once; "away until" is a date in the row that
      // waits for the page's one Save (the field belongs to the Save's form).
      expect(html, l).toMatch(/action="\/app\/settings\/people\/a\/in-turn" class="set-act"><input type="hidden" name="on" value="0" \/><button class="set-switch" type="submit" role="switch" aria-checked="true"/);
      expect(html, l).toMatch(/action="\/app\/settings\/people\/o\/in-turn" class="set-act"><input type="hidden" name="on" value="1" \/><button class="set-switch" type="submit" role="switch" aria-checked="false"/);
      expect(html, l).toContain('type="date" form="team-save" name="away_a" value="2026-10-25"');
      expect(html, l).toContain('<form method="post" action="/app/settings/team" class="set-form" data-save id="team-save">');
      expect(html, l).not.toContain('/app/settings/people/b/in-turn');
      expect(html, l).not.toContain('name="away_b"');
    }
  });

  it('the routes are the owner\'s; the worker gives a hand-off in turn before its alert, and never a deletion request', () => {
    const app = readFileSync(new URL('../../src/api/web/app.ts', import.meta.url), 'utf8');
    for (const r of ["app.post('/app/settings/people/turn'", "app.post('/app/settings/people/:id/turn'", "app.post('/app/settings/people/:id/in-turn'", 'app.post(TEAM_PAGE']) {
      const body = app.slice(app.indexOf(r), app.indexOf(r) + 400);
      expect(body, r).toContain("ownerOnly(req, reply, 'people'");
    }
    const worker = readFileSync(new URL('../../src/worker/main.ts', import.meta.url), 'utf8');
    expect(worker).toMatch(/await inTurn\(input\.businessId, input\.conversationId, effects\);\s+const alertKind = alertKindFor\(effects\);/);
    expect(worker).toMatch(/if \(effects\) await inTurn\(businessId, conversationId, effects\);\s+const kind = effects \? alertKindFor\(effects\) : null;/);
    expect(worker).toContain('if (!effects.handoffAlert || effects.deletionAlert) return;');
  });
});
