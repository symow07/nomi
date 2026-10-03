import { describe, it, expect } from 'vitest';
import { shell, esc, NAV, CONTEXTUAL_ROUTES_BY_HUB, CONTEXTUAL_ROUTES, hubFor, isOutreachRoute, OUTREACH_PREFIXES } from '../../src/api/web/layout.js';
import { withWorkspace, withAssistantName, outreachShown, setupState, type RequestScope } from '../../src/api/web/say.js';
import { renderSetup } from '../../src/api/web/settings.js';
import { renderOperationsHome } from '../../src/api/web/operations.js';
import { NOTHING_TODAY } from '../../src/api/web/today.js';
import { renderInboxList } from '../../src/api/web/inbox.js';
import { renderAccounts } from '../../src/api/web/connect.js';
import { renderReach } from '../../src/api/web/channels.js';
import { STEP_LINK } from '../../src/api/web/onboarding.js';
import { setupFrom, SETUP_STEPS, NOTHING_DONE } from '../../src/db/setup.js';
import { t, messages, type MessageKey } from '../../src/core/owner/i18n/messages.js';
import { LOCALES } from '../../src/core/owner/i18n/locale.js';
import { withSheets } from './linked-css.js';

/**
 * D — the drawer split (docs/IA-PROPOSAL.md §D, decided 2026-09-21).
 *
 * Five entries. What you SELL under My business, how the assistant BEHAVES
 * under its own entry, how the installation is WIRED under Setup. While setup
 * is unfinished, Setup carries a count and Today carries a card. The outreach
 * area exists only where it is switched on — no route, no link, no switch.
 * URLs did not move.
 */

const facts = (over: Partial<RequestScope> = {}): RequestScope => ({
  name: null, several: false, outreach: false,
  setup: setupFrom({ profile: true, products: true, name: false, channels: true, first_success: false }),
  ...over,
});
const COMPLETE = setupFrom({ profile: true, products: true, name: true, channels: true, first_success: true });

const page = (path: string, scope: RequestScope | null = null) => {
  const draw = () => shell({ title: 'T', active: 'home', locale: 'en', path, avatar: '·', bodyHtml: '' });
  return scope ? withWorkspace(scope, draw) : draw();
};
const navOf = (html: string) => html.split('<nav class="side"')[1]?.split('</nav>')[0] ?? '';

describe('D · five entries', () => {
  it('Today, Buyers, the assistant, My business, Setup — in that order, and no conditional sixth', () => {
    expect(NAV.map((n) => n.href)).toEqual(['/app', '/app/inbox', '/app/employee', '/app/business', '/app/settings']);
    expect(NAV.map((n) => n.id)).toEqual(['home', 'inbox', 'employee', 'factory', 'settings']);
  });

  it('Setup is named in every language, in owner words', () => {
    expect(t('en', 'nav.settings')).toBe('Setup');
    for (const l of LOCALES) expect(messages[l]['nav.settings'].length).toBeGreaterThan(0);
  });

  it('the map puts what you sell under My business, behaviour under the assistant, wiring under Setup', () => {
    const under = (hub: string) => CONTEXTUAL_ROUTES_BY_HUB.find((g) => g.hub === hub)?.routes ?? [];
    // THE WARMTH RUN, phase 7 — My business is a menu; How you sell is a menu
    // of its own a level down; the channels' one home is My business.
    expect(under('/app/business')).toEqual(expect.arrayContaining([
      '/app/settings/profile', '/app/settings/business', '/app/business/channels', '/app/business/ready',
      '/app/products', '/app/business/prices', '/app/business/promises', '/app/business/how-you-sell',
    ]));
    expect(under('/app/business/how-you-sell')).toEqual(expect.arrayContaining([
      '/app/business/selling', '/app/settings/terms', '/app/settings/samples', '/app/settings/closures', '/app/settings/rate',
    ]));
    expect(under('/app/business/channels')).toEqual(['/app/channels']);
    expect(under('/app/employee')).toEqual(expect.arrayContaining(['/app/knowledge', '/app/settings/forbidden', '/app/sandbox']));
    expect(under('/app/settings')).toEqual(['/app/business', '/app/settings/setup']);
    expect(under('/app/settings/setup')).toEqual(expect.arrayContaining(['/app/onboarding', '/app/settings/people', '/app/settings/language']));
    expect(under('/app/settings/setup')).not.toContain('/app/channels');
    // and Settings itself is a nav entry now, not somebody's contextual route
    expect(CONTEXTUAL_ROUTES).not.toContain('/app/settings');
  });

  it('every page lights the entry it now sits under — URLs did not move, doors did', () => {
    expect(hubFor('/app/settings/terms', 'x')).toBe('factory');
    expect(hubFor('/app/settings/rate', 'x')).toBe('factory');
    expect(hubFor('/app/products/abc', 'x')).toBe('factory');
    expect(hubFor('/app/knowledge', 'x')).toBe('employee');
    expect(hubFor('/app/settings/forbidden', 'x')).toBe('employee');
    expect(hubFor('/app/sandbox', 'x')).toBe('employee');
    expect(hubFor('/app/settings', 'x')).toBe('settings');
    expect(hubFor('/app/settings/people', 'x')).toBe('settings');
    expect(hubFor('/app/settings/data', 'x')).toBe('settings');
    expect(hubFor('/app/channels', 'x')).toBe('settings');
    expect(hubFor('/app/onboarding', 'x')).toBe('settings');
    // the outreach chain still resolves, for a workspace that has it — under
    // Buyers since A (contacts hung off Customers, which merged into Buyers)
    expect(hubFor('/app/sequences/abc', 'x')).toBe('inbox');
  });
});

describe('D · the Setup count', () => {
  it('shows "done/total" on Setup while setup is unfinished, with a spoken form', () => {
    const html = page('/app', facts());
    const nav = navOf(html);
    expect(nav).toContain('<span class="navcount" aria-hidden="true">3/5</span>');
    expect(nav).toContain(`aria-label="${t('en', 'nav.settings')}, ${t('en', 'nav.setup.progress', { done: 3, total: 5 })}"`);
    // only on Setup
    expect(nav.split('navcount').length - 1).toBe(1);
  });

  it('disappears when the last step is done, and the entry stays', () => {
    const nav = navOf(page('/app', facts({ setup: COMPLETE })));
    expect(nav).not.toContain('navcount');
    expect(nav).toContain('href="/app/settings"');
  });

  it('is absent outside a workspace — a public page, a bare render', () => {
    expect(navOf(page('/app'))).not.toContain('navcount');
    expect(setupState()).toBeNull();
  });

  it('the count is a figure in secondary ink, not a state colour', () => {
    // V1 close-out — the rule is in the sheet the page links.
    const html = withSheets(page('/app', facts()));
    const rule = html.match(/nav\.side \.navcount \{[^}]*\}/)?.[0] ?? '';
    expect(rule, 'the rule is found').not.toBe('');
    expect(rule).toContain('var(--color-ink-secondary)');
    expect(rule).not.toMatch(/warn|jade|ok|waiting/);
  });
});

describe('D · the Today card', () => {
  const snapshot: Parameters<typeof renderOperationsHome>[0] = {
    range: 'today',
    attention: { pendingApprovals: 0, handoffs: 0, ownerHandling: 0, blockedMessages: 0 },
    activity: { handled: 0, draftsCreated: 0, corrections: 0 },
    knowledge: { openGaps: 0, recentCorrections: 0, recentlyTaught: 0 },
    channel: { status: 'connected', provider: 'active', live: true }, budget: null,
    hasAttention: false,
  };

  const QUIET = NOTHING_TODAY(new Date('2026-09-29T08:00:00Z'));

  it('names the next step and opens its door while setup is unfinished', () => {
    const html = withWorkspace(facts(), () => renderOperationsHome(snapshot, 'en', QUIET));
    // The design pass: one line at the foot, the count in its sentence.
    expect(html).toContain(t('en', 'today.setup.line', { done: 3, total: 5 }));
    // the next step here is the name — confirmed on Getting ready
    expect(html).toContain(`href="${STEP_LINK.name}"`);
    expect(html).toContain(t('en', 'factory.next.name'));
  });

  it('is gone when setup is complete, and absent outside a workspace', () => {
    expect(withWorkspace(facts({ setup: COMPLETE }), () => renderOperationsHome(snapshot, 'en', QUIET))).not.toContain('today-foot setup');
    expect(renderOperationsHome(snapshot, 'en', QUIET)).not.toContain('today-foot setup');
  });

  it('the five steps are the ones the badge counts, the name among them, and each has a door', () => {
    expect(SETUP_STEPS).toEqual(['profile', 'products', 'name', 'channels', 'first_success']);
    for (const s of SETUP_STEPS) {
      expect(STEP_LINK[s]).toMatch(/^\/app/);
      for (const l of LOCALES) expect(messages[l][`factory.next.${s}` as MessageKey], `${l} ${s}`).toBeTruthy();
    }
    expect(NOTHING_DONE.next).toBe('profile');
    expect(setupFrom({ profile: true, products: true, name: false, channels: true, first_success: true }).next).toBe('name');
  });
});

describe('D · the doors moved, the pages did not', () => {
  it('phase 7 · Setup holds getting started, going live, alerts, the language, people, sign-in, billing, data — and none of the business', () => {
    const html = withWorkspace(facts(), () => renderSetup({ people: 3 }, 'en', null));
    for (const href of ['/app/guide', '/app/onboarding', '/app/settings/alerts', '/app/settings/language',
      '/app/settings/people', '/app/settings/account', '/app/settings/billing', '/app/settings/data'])
      expect(html).toContain(`href="${href}"`);
    // the business has ONE home, My business — channels included
    for (const href of ['/app/channels', '/app/business/channels', '/app/settings/profile', '/app/settings/business', '/app/business/selling',
      '/app/settings/terms', '/app/settings/samples', '/app/settings/closures', '/app/settings/rate', '/app/settings/forbidden'])
      expect(html).not.toContain(`href="${href}"`);
    expect(html).toContain(`<h1 class="page">${t('en', 'nav.setup')}</h1>`);
  });

  it('phase 3 · each row says what the setting is, what it is set to now, and opens it; the profile\'s form is not on Setup', () => {
    const html = withWorkspace(facts(), () => renderSetup({ people: 1 }, 'en', null));
    const rows = Object.fromEntries([...html.matchAll(/<a class="srow sr-menu[^"]*" href="([^"]+)">[\s\S]*?<\/a>/g)].map((m) => [m[1], m[0]]));
    // The guided path (/app/guide) is Setup's first row, and carries where setup stands.
    expect(Object.keys(rows)[0]).toBe('/app/guide');
    expect(rows['/app/guide']).toContain(t('en', 'nav.setup.progress', { done: 3, total: 5 }));
    // phase 7 — a menu: no line under a row that its value already says
    expect(html).not.toContain('class="sr-desc"');
    expect(rows['/app/onboarding']).toBeDefined();
    expect(rows['/app/settings/language']).toContain('<bdi>English</bdi>');
    expect(rows['/app/settings/people']).toContain('1 person');
    expect(html).not.toContain('method="post" action="/app/settings"');   // the form lives on its own page
    expect(withWorkspace(facts({ setup: COMPLETE }), () => renderSetup({ people: 4 }, 'en', null)))
      .toContain(`<span class="sr-value ok"><bdi>${t('en', 'setup.state.done')}</bdi></span>`);
  });

  it('phase 7 · two labelled groups, one card of rows each; the switch a tap down; the owner\'s pages only the owner\'s', () => {
    const v = { people: 2, alerts: { available: true, phones: 0 }, signIn: { email: 'owner@example.test' },
      billing: { configured: false, exempt: false, status: 'none' }, dataWaiting: 1 };
    const html = withWorkspace(facts(), () => renderSetup(v, 'en', null));
    const groups = [...html.matchAll(/<h2 class="sgroup-h" id="sg-([a-z]+)">([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(groups).toEqual(['start', 'account']);
    expect(html.match(/<ul class="scard">/g)).toHaveLength(2);
    expect(html).toContain(`<span class="sr-value"><bdi>${t('en', 'setup.value.off')}</bdi></span>`);
    expect(html).toContain('<span class="sr-value"><bdi>owner@example.test</bdi></span>');
    expect(html).toContain(`<span class="sr-value"><bdi>${t('en', 'setup.value.notSetUp')}</bdi></span>`);
    expect(html).toContain('1 request waiting');
    expect(html).not.toContain('role="search"');
    expect(html).not.toContain('class="langsw"');
    // a sales assistant: who works here is read, not opened; billing and the data are the owner's
    const staff = withWorkspace(facts(), () => renderSetup({ ...v, billing: null, dataWaiting: null, viewer: { isOwner: false } }, 'en', null));
    expect(staff).not.toContain('href="/app/settings/people"');
    expect(staff).toMatch(/<div class="srow sr-menu">[^]*?<span class="sr-label">Who works here<\/span>[^]*?2 people/);
    for (const href of ['/app/settings/billing', '/app/settings/data']) expect(staff).not.toContain(`href="${href}"`);
    expect(staff).toContain('href="/app/settings/account"');
  });
});

describe('D · the outreach area exists only where it is switched on', () => {
  it('its addresses are known by prefix, query strings and sub-pages included', () => {
    expect(OUTREACH_PREFIXES).toEqual(['/app/contacts', '/app/prospects', '/app/sequences', '/app/channels/outreach']);
    for (const u of ['/app/contacts', '/app/contacts/write', '/app/contacts?flash=1', '/app/prospects', '/app/sequences/abc/steps', '/app/channels/outreach', '/app/channels/outreach/cap'])
      expect(isOutreachRoute(u), u).toBe(true);
    for (const u of ['/app', '/app/channels', '/app/contactsx', '/app/inbox/abc', '/app/settings'])
      expect(isOutreachRoute(u), u).toBe(false);
    // the groups that need it say so in the map
    for (const g of CONTEXTUAL_ROUTES_BY_HUB)
      expect(g.outreach === true, g.hub).toBe(g.routes.some(isOutreachRoute) || g.hub === '/app/contacts');
  });

  it('outside a scope, and with the area off, nothing is shown; inside, with it on, it is', () => {
    expect(outreachShown()).toBe(false);
    expect(withWorkspace(facts({ outreach: false }), outreachShown)).toBe(false);
    expect(withWorkspace(facts({ outreach: true }), outreachShown)).toBe(true);
    // narrowing to one conversation's assistant keeps the request's facts
    expect(withWorkspace(facts({ outreach: true }), () => withAssistantName('Noor', outreachShown))).toBe(true);
  });

  // A — the contacts door moved with the list it hangs off: Customers is Buyers now.
  const list: Parameters<typeof renderInboxList>[0] = { filter: 'all', waitingCount: 0, blockedCount: 0, conversations: [] };
  const accounts: Parameters<typeof renderAccounts>[0] = {
    mail: null, connectable: { google: true, microsoft: false }, sendingDomain: 'example.com', smtpFrom: null,
    apollo: { kind: 'none' },
  };

  it('the door to contacts, the Apollo card and the writing-first switch appear only with the area on', () => {
    const off = facts({ outreach: false }); const on = facts({ outreach: true });
    expect(withWorkspace(off, () => renderInboxList(list, 'en', new Date()))).not.toContain('href="/app/contacts"');
    expect(withWorkspace(on, () => renderInboxList(list, 'en', new Date()))).toContain('href="/app/contacts"');

    // Phase 9 (V1-434) — Apollo is not one of the owner's accounts: its key is set on Prospects, in the area itself.
    expect(withWorkspace(off, () => renderAccounts(accounts, 'en'))).not.toContain('/app/prospects');
    expect(withWorkspace(on, () => renderAccounts(accounts, 'en'))).not.toContain('Apollo');

    const reach = (s: RequestScope) => withWorkspace(s, () => renderReach('en', new Set(['domain_verified', 'template_approved'] as never[]), new Map([['email', false]] as never)));
    expect(reach(off)).not.toContain('action="/app/channels/outreach"');
    expect(reach(off)).not.toContain('action="/app/channels/outreach/cap"');
    expect(reach(on)).toContain('action="/app/channels/outreach"');
  });
});
