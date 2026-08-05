import { describe, it, expect } from 'vitest';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { renderOperationsHome } from '../../src/api/web/operations.js';
import { renderInboxList } from '../../src/api/web/inbox.js';
import { renderEmployee } from '../../src/api/web/employee.js';
import { renderFactory } from '../../src/api/web/factory.js';
import { renderCustomerList } from '../../src/api/web/conversations.js';
import type { OperationsSnapshot } from '../../src/api/web/operations.js';
import type { FactoryView } from '../../src/api/web/factory.js';
import type { EmployeeProfile, HerContext } from '../../src/api/web/employee.js';
import type { CustomerList } from '../../src/api/web/conversations.js';

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
  channel: { provider: 'disabled', status: 'not_connected' },
};
const emptyToday = renderOperationsHome(emptyTodaySnapshot, 'en');

const emptyProfile: EmployeeProfile = {
  stage: 'probation', hireDate: null, knows: 0, canDo: [], needConfirm: [], capabilities: [],
  growth: [], promoted: false, conditions: [],
};
const emptyContext: HerContext = {
  handled: 0, draftsPrepared: 0, neededYou: 0, taughtRecently: 0, corrected: 0, gaps: [],
};
const emptyHer = renderEmployee(emptyProfile, 'en', null, emptyContext);

const emptyBuyers = (filter: 'pending' | 'all') =>
  renderInboxList({ filter, waitingCount: 0, blockedCount: 0, conversations: [] }, 'en', NOW);

// M22 — TYPED, not `as never`. It was cast, so nothing checked it, and it
// drifted twice behind the real FactoryView: `promises` still carried Phase-E's
// pre-rename field names, `floorLowUsd` was undefined, `undefined !== null` was
// true, and formatUsd(undefined) threw before a single assertion in this file
// ran. Typing it is the fix; the comment was only a warning.
const emptyFactoryView: FactoryView = {
  profile: { name: '', description: null, location: null, workingHours: null,
    contactEmail: null, contactPhone: null, languagesServed: [], categories: [] },
  products: { total: 0, needPrice: 0, names: [] },
  promises: { certs: [], floorLowUsd: null, floorHighUsd: null, ceilingPct: null, ceilingVaries: false },
  connection: { channel: { kind: 'whatsapp', connected: false, status: 'not_connected', healthOk: false,
    displayId: null, lastActivityAt: null, problem: null }, ownerPhone: null },
  nextStep: 'profile',
  readiness: { canActivate: false, blockers: ['no_channel'], recipients: [], lifecycle: 'not_connected',
    live: false, activatedAt: null, activatedBy: null },
  // Nothing to rehearse on day one — no products means no probes, so the block
  // is absent rather than reporting an empty success.
  rehearsal: { findings: [], violations: [], probesRun: 0, productsChecked: 0, productsTotal: 0 },
};
const emptyFactory = renderFactory(emptyFactoryView, 'en');

const emptyCustomerList: CustomerList = { query: '', customers: [] };
const emptyCustomers = renderCustomerList(emptyCustomerList, 'en', NOW);

const SURFACES: readonly (readonly [string, string])[] = [
  ['Today', emptyToday],
  ['Buyers · needs you', emptyBuyers('pending')],
  ['Buyers · all', emptyBuyers('all')],
  ['小雅', emptyHer],
  ['My factory', emptyFactory],
  ['Customers', emptyCustomers],
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
    // The worst version of this shipped on 小雅: a green ✓ saying she had
    // answered everything taught, on an account where she had answered nothing.
    expect(emptyHer).not.toContain('answered everything');
    expect(emptyHer).toContain('No buyer has asked her anything yet');
    expect(emptyHer).toContain('href="/app/knowledge"');
    // and a factory with no customers is not an achievement
    expect(emptyCustomers).not.toContain('class="ok"');
  });

  it('the quiet branches still lead somewhere', () => {
    expect(emptyToday).toContain('href="/app/knowledge"');   // nothing learned yet
    expect(emptyBuyers('all')).toContain('href="/app/factory"');
    expect(emptyCustomers).toContain('href="/app/factory"');
  });

  it('does not offer a door into another empty room', () => {
    // "Everyone you have talked to" is pointless when nobody has talked to you.
    expect(emptyBuyers('all')).not.toContain('/app/conversations');
  });

  it('reads the same way in every locale — nothing falls back to English', () => {
    for (const l of LOCALES) {
      const html = renderInboxList({ filter: 'all', waitingCount: 0, blockedCount: 0, conversations: [] }, l, NOW);
      expect(html.length).toBeGreaterThan(100);
      expect(html).toContain('href="/app/factory"');           // the way forward, every locale
      if (l !== 'en') expect(html).not.toContain('No conversations yet');
    }
  });
});
