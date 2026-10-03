import { describe, it, expect } from 'vitest';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { t } from '../../src/core/owner/i18n/messages.js';
import { renderOperationsHome } from '../../src/api/web/operations.js';
import { NOTHING_TODAY } from '../../src/api/web/today.js';
import { renderInboxList } from '../../src/api/web/inbox.js';
import { everyScreen } from './employee-screens.js';
import { renderFactory } from '../../src/api/web/factory.js';
import type { OperationsSnapshot } from '../../src/api/web/operations.js';
import type { FactoryView } from '../../src/api/web/factory.js';
import type { EmployeeProfile, HerContext } from '../../src/api/web/employee.js';
import { renderCalendar, parseCalendarQuery } from '../../src/api/web/calendar.js';

/**
 * Phase F — every surface must answer "what happens next?" when it is empty.
 * Never a dead end, never error-styled, never a success that did not happen.
 */
const NOW = new Date('2026-08-02T10:00:00Z');

const emptyTodaySnapshot: OperationsSnapshot = {
  range: 'today',
  attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 },
  hasAttention: false,
  activity: { handled: 0, draftsCreated: 0, corrections: 0 },
  knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
  channel: { provider: 'disabled', status: 'not_connected' }, budget: null,
};
const emptyToday = renderOperationsHome(emptyTodaySnapshot, 'en', NOTHING_TODAY(NOW));

const emptyProfile: EmployeeProfile = {
  stage: 'probation', hireDate: null, knows: 0, canDo: [], needConfirm: [], capabilities: [],
  growth: [], promoted: false, conditions: [], assistantNamed: true,
 spotChecks: [],
};
const emptyContext: HerContext = {
  handled: 0, draftsPrepared: 0, neededYou: 0, taughtRecently: 0, corrected: 0, gaps: [],
};
// Phase 7 — the assistant's page is a menu; its empty rooms are its screens, read end to end.
const emptyHer = everyScreen(emptyProfile, 'en', null, emptyContext);

const emptyBuyers = (filter: 'pending' | 'all') =>
  renderInboxList({ filter, waitingCount: 0, blockedCount: 0, conversations: [] }, 'en', NOW);

// M22 — TYPED, not `as never`. It was cast, so nothing checked it, and it
// drifted twice behind the real FactoryView: `promises` still carried Phase-E's
// pre-rename field names, `floorLow` was undefined, `undefined !== null` was
// true, and formatMoney(undefined) threw before a single assertion in this file
// ran. Typing it is the fix; the comment was only a warning.
const emptyFactoryView: FactoryView = {
  profile: { name: '', description: null, location: null, workingHours: null,
    contactEmail: null, contactPhone: null, languagesServed: [] },
  products: { total: 0, needPrice: 0, names: [] },
  promises: { certs: [], floorLow: null, floorHigh: null, ceilingPct: null, ceilingVaries: false },
  connection: { channel: { kind: 'whatsapp', connected: false, status: 'not_connected', healthOk: false,
    displayId: null, lastActivityAt: null, problem: null, activated: false }, ownerPhone: null },
  nextStep: 'profile',
  readiness: { canActivate: false, blockers: ['no_channel'], recipients: [], lifecycle: 'not_connected',
    live: false, activatedAt: null, activatedBy: null },
  // Nothing to rehearse on day one — no products means no probes, so the block
  // is absent rather than reporting an empty success.
  rehearsal: { findings: [], violations: [], probesRun: 0, productsChecked: 0, productsTotal: 0 },
  prices: { businessDefault: null, products: [], unanswered: 0, volume: [], currency: 'USD' },
};
const emptyFactory = renderFactory(emptyFactoryView, 'en');

// A — Customers merged into Buyers; its empty room is a search that found nobody.
const emptySearch = renderInboxList({ filter: 'all', waitingCount: 0, blockedCount: 0, conversations: [], query: 'Zhang' }, 'en', NOW);

// V2 — a calendar with nothing dated in its month.
const emptyCalendar = renderCalendar({
  from: '2026-07-26', to: '2026-08-16', today: '2026-08-02', category: null, buyer: null,
  buyers: [], categories: [], entries: [],
}, 'en');

const SURFACES: readonly (readonly [string, string])[] = [
  ['Today', emptyToday],
  ['Buyers · needs you', emptyBuyers('pending')],
  ['Buyers · all', emptyBuyers('all')],
  ['小雅', emptyHer],
  ['My factory', emptyFactory],
  ['Buyers · a search that found nobody', emptySearch],
  ['Calendar', emptyCalendar],
];

describe('Phase F · every empty surface says what happens next', () => {
  it('each offers at least one way forward', () => {
    for (const [name, html] of SURFACES) {
      const links = [...html.matchAll(/href="(\/app[^"]*)"/g)].map((m) => m[1]);
      expect(links.length, `${name} is a dead end`).toBeGreaterThan(0);
    }
  });

  it('none of them looks like an error or a failure', () => {
    for (const [name, html] of SURFACES) {
      for (const bad of ['error', 'failed', 'no data', 'null', 'undefined', 'N/A'])
        expect(html.toLowerCase().includes(bad.toLowerCase()), `${name}: "${bad}"`).toBe(false);
    }
  });

  it('none of them claims work that never happened', () => {
    // The worst version of this shipped on 小雅: a green ✓ saying everything
    // taught had been answered, on an account where nothing had been answered.
    expect(emptyHer).not.toContain('answered everything');
    expect(emptyHer).not.toContain(t('en', 'her.teach.none'));
    expect(emptyHer).toContain(t('en', 'her.teach.unasked'));
    expect(emptyHer).toContain('href="/app/knowledge"');
    // and a search that found nobody is not an achievement
    expect(emptySearch).not.toContain('class="ok"');
    expect(emptySearch).not.toContain('ok-line');
  });

  it('the quiet branches still lead somewhere', () => {
    // nobody can reach the assistant yet: the setup step's own door, to connect where customers write (phase 9, w4-today-setup-16)
    expect(emptyToday).toContain('href="/app/business/channels"');
    // The warmth run — "Coming up" left Today (the calendar has its nav entry);
    // the day's figures keep their door to Results, whatever the day held.
    expect(emptyToday).toContain('href="/app/analytics"');
    expect(emptyBuyers('all')).toContain('href="/app/business"');
    // every buyer, the search let go — phase 4: the whole list is the list's own address
    expect(emptySearch).toContain('href="/app/inbox"');
    expect(emptySearch).not.toContain('filter=all');
    // the warmth run — an empty calendar's one door is adding a date to it
    expect(emptyCalendar).toContain('<details class="cal-add"><summary>Add a date</summary><form method="post" action="/app/calendar/entries"');
  });

  it('does not offer a door into another empty room', () => {
    // "Everyone you have talked to" is pointless when nobody has talked to you
    // — and since A there is no second list to send anyone to at all.
    expect(emptyBuyers('all')).not.toContain('/app/conversations');
    expect(emptyBuyers('pending')).not.toContain('/app/conversations');
  });

  it('reads the same way in every locale — nothing falls back to English', () => {
    for (const l of LOCALES) {
      const html = renderInboxList({ filter: 'all', waitingCount: 0, blockedCount: 0, conversations: [] }, l, NOW);
      expect(html.length).toBeGreaterThan(100);
      expect(html).toContain('href="/app/business"');           // the way forward, every locale
      if (l !== 'en') expect(html).not.toContain('No conversations yet');
    }
  });
});

describe('Phase 9 · the five empties phase 6 missed are panels too (cross-missed-01)', () => {
  it('an empty month and an empty chosen day say "nothing" in a panel, never a grey line (the warmth run: one warm panel)', () => {
    const base = { from: '2026-07-27', to: '2026-09-07', today: '2026-08-02', category: null, buyer: null, buyers: [], categories: [], entries: [] };
    const month = renderCalendar({ ...base }, 'en');
    const day = renderCalendar({ ...base }, 'en', { ask: parseCalendarQuery({ month: '2026-08', day: '2026-08-12' }, new Date('2026-08-02T04:00:00Z')) });
    for (const html of [month, day]) expect(html).not.toMatch(/<p class="muted">Nothing/);
    expect(month).toMatch(new RegExp(`<div class="empty cal-empty">[\\s\\S]*?<p class="cal-empty-t">${t('en', 'calendar.empty.month')}</p>`));
    expect(day).toMatch(new RegExp(`<div class="empty cal-empty">[\\s\\S]*?<p class="cal-empty-t">${t('en', 'calendar.empty.day')}</p>`));
  });
});
